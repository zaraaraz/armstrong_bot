import { StorageServiceImpl } from './storage.service';
import { StorageNamespace } from '../domain/storage-namespace';
import { StorageQuotaExceededError } from '../domain/storage.errors';
import { StorageEvents } from '../events/storage.events';
import type { StorageObjectEntity } from '../domain/storage-object.entity';
import type { StorageObjectMeta } from '../contracts/storage-object.types';
import type { StoreParams } from './storage.service';

/** Build a catalog entity with sensible defaults, overridable per-test. */
function makeEntity(
  over: Partial<StorageObjectEntity> = {},
): StorageObjectEntity {
  return {
    id: 'obj-1',
    guildId: 'g1',
    namespace: StorageNamespace.Transcripts,
    key: 'g1/transcripts/hash-1',
    contentHash: 'hash-1',
    size: 11,
    contentType: 'text/plain',
    filename: null,
    ownerType: 'ticket',
    ownerId: 't-1',
    immutable: true,
    refCount: 1,
    metadata: null,
    createdAt: new Date('2026-06-30T09:00:00Z'),
    updatedAt: new Date('2026-06-30T09:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

/** A valid store() call: a small text buffer scoped to guild g1. */
function makeStoreParams(over: Partial<StoreParams> = {}): StoreParams {
  return {
    guildId: 'g1',
    namespace: StorageNamespace.Transcripts,
    body: Buffer.from('hello world'),
    contentType: 'text/plain',
    ownerType: 'ticket',
    ownerId: 't-1',
    ...over,
  };
}

/** Driver test double — only the methods the service touches are stubbed. */
interface DriverMock {
  name: string;
  supportsSignedUrls: boolean;
  put: ReturnType<typeof vi.fn>;
  getBuffer: ReturnType<typeof vi.fn>;
  signGetUrl: ReturnType<typeof vi.fn>;
}

interface Mocks {
  repo: {
    findByHash: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    incrementRefCount: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
    decrementRefCount: ReturnType<typeof vi.fn>;
    getUsage: ReturnType<typeof vi.fn>;
    addUsage: ReturnType<typeof vi.fn>;
  };
  driver: DriverMock;
  config: {
    global: () => { defaultQuotaBytes: number; maxSignedUrlSeconds: number };
    forGuild: ReturnType<typeof vi.fn>;
  };
  emit: ReturnType<typeof vi.fn>;
  metrics: {
    recordStore: ReturnType<typeof vi.fn>;
    recordDelete: ReturnType<typeof vi.fn>;
    setUsedBytes: ReturnType<typeof vi.fn>;
  };
}

function build(): { service: StorageServiceImpl; mocks: Mocks } {
  const created = makeEntity();

  const putMeta: StorageObjectMeta = {
    key: 'g1/transcripts/hash-1',
    size: 11,
    contentType: 'text/plain',
    contentHash: 'hash-1',
    lastModified: new Date('2026-06-30T09:00:00Z'),
  };

  const repo = {
    findByHash: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(created),
    incrementRefCount: vi.fn().mockResolvedValue(makeEntity({ refCount: 2 })),
    findById: vi.fn().mockResolvedValue(created),
    softDelete: vi.fn().mockResolvedValue(undefined),
    decrementRefCount: vi.fn().mockResolvedValue(0),
    getUsage: vi.fn().mockResolvedValue({
      guildId: 'g1',
      usedBytes: 0,
      objectCount: 0,
      updatedAt: new Date(),
    }),
    addUsage: vi.fn().mockResolvedValue({
      guildId: 'g1',
      usedBytes: 11,
      objectCount: 1,
      updatedAt: new Date(),
    }),
  };

  const driver: DriverMock = {
    name: 'local',
    supportsSignedUrls: true,
    put: vi.fn().mockResolvedValue(putMeta),
    getBuffer: vi.fn().mockResolvedValue(Buffer.from('hello world')),
    signGetUrl: vi.fn().mockResolvedValue({
      url: 'https://example.test/dl',
      method: 'GET',
      expiresAt: new Date('2026-06-30T10:00:00Z'),
    }),
  };

  const registry = { active: () => driver, byName: () => driver };

  const config = {
    global: () => ({
      defaultQuotaBytes: 1_073_741_824,
      maxSignedUrlSeconds: 900,
    }),
    forGuild: vi.fn().mockResolvedValue({ quotaBytes: 1_073_741_824 }),
  };

  const emit = vi.fn().mockResolvedValue(undefined);
  const emitter = { emit, events: StorageEvents };

  const metrics = {
    recordStore: vi.fn(),
    recordDelete: vi.fn(),
    setUsedBytes: vi.fn(),
  };

  const tracing = {
    currentTraceId: () => 'trace-1',
    withSpan: vi.fn(),
  };

  const localDriver = {
    verifySignature: vi.fn().mockReturnValue(true),
    get: vi.fn(),
  };

  const service = new StorageServiceImpl(
    repo as never,
    registry as never,
    config as never,
    emitter as never,
    metrics as never,
    tracing as never,
    localDriver as never,
  );

  return { service, mocks: { repo, driver, config, emit, metrics } };
}

describe('StorageServiceImpl', () => {
  describe('store', () => {
    it('stores new bytes via the driver, catalogs the row, and emits ObjectStored', async () => {
      const { service, mocks } = build();

      const ref = await service.store(makeStoreParams());

      // Bytes moved through the active driver exactly once.
      expect(mocks.driver.put).toHaveBeenCalledOnce();
      // Catalog row written after a successful put.
      expect(mocks.repo.create).toHaveBeenCalledOnce();
      // No dedupe path taken.
      expect(mocks.repo.incrementRefCount).not.toHaveBeenCalled();
      // Lifecycle event published.
      expect(mocks.emit).toHaveBeenCalledWith(
        StorageEvents.ObjectStored,
        expect.objectContaining({ objectId: 'obj-1', size: 11 }),
      );
      expect(ref.deduped).toBe(false);
      expect(ref.id).toBe('obj-1');
    });

    it('dedupes identical bytes: bumps ref-count, skips the driver put, reports deduped', async () => {
      const { service, mocks } = build();
      mocks.repo.findByHash.mockResolvedValueOnce(
        makeEntity({ id: 'existing', refCount: 1 }),
      );

      const ref = await service.store(makeStoreParams());

      // Bytes already exist — no upload, only a ref-count bump.
      expect(mocks.driver.put).not.toHaveBeenCalled();
      expect(mocks.repo.create).not.toHaveBeenCalled();
      expect(mocks.repo.incrementRefCount).toHaveBeenCalledWith('existing');
      expect(ref.deduped).toBe(true);
      // Still an ObjectStored event, flagged as a dedupe.
      expect(mocks.emit).toHaveBeenCalledWith(
        StorageEvents.ObjectStored,
        expect.objectContaining({ objectId: 'existing', deduped: true }),
      );
    });

    it('rejects with StorageQuotaExceededError and emits QuotaExceeded when over quota', async () => {
      const { service, mocks } = build();
      // Guild quota of 10 bytes, already fully used; the 11-byte body overflows it.
      mocks.config.forGuild.mockResolvedValueOnce({ quotaBytes: 10 });
      mocks.repo.getUsage.mockResolvedValueOnce({
        guildId: 'g1',
        usedBytes: 10,
        objectCount: 1,
        updatedAt: new Date(),
      });

      await expect(service.store(makeStoreParams())).rejects.toBeInstanceOf(
        StorageQuotaExceededError,
      );

      // Quota is enforced before any byte write.
      expect(mocks.driver.put).not.toHaveBeenCalled();
      expect(mocks.repo.create).not.toHaveBeenCalled();
      expect(mocks.emit).toHaveBeenCalledWith(
        StorageEvents.QuotaExceeded,
        expect.objectContaining({ guildId: 'g1', quotaBytes: 10 }),
      );
    });
  });

  describe('delete', () => {
    it('soft-deletes the catalog row and emits ObjectDeleted', async () => {
      const { service, mocks } = build();

      await service.delete('obj-1', 'g1');

      expect(mocks.repo.softDelete).toHaveBeenCalledWith('obj-1');
      expect(mocks.emit).toHaveBeenCalledWith(
        StorageEvents.ObjectDeleted,
        expect.objectContaining({ objectId: 'obj-1' }),
      );
    });

    it('throws when the object does not exist', async () => {
      const { service, mocks } = build();
      mocks.repo.findById.mockResolvedValueOnce(null);

      await expect(service.delete('missing', 'g1')).rejects.toThrow();
      expect(mocks.repo.softDelete).not.toHaveBeenCalled();
    });
  });
});
