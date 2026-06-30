import { PluginLifecycleService } from './plugin-lifecycle.service';
import { PluginStatus, PluginScope } from '../contracts/plugin.enums';
import { PluginErrorCode } from '../errors/plugin.errors';
import type { LoadedPluginEntry } from './plugin-registry';
import type { Plugin } from '../contracts/plugin.interface';
import type { PluginContext } from '../contracts/plugin-context.interface';
import { z } from 'zod';

function makeEntry(overrides: Partial<Plugin> = {}): LoadedPluginEntry {
  return {
    plugin: {
      manifest: {
        name: 'test-plugin',
        version: '1.0.0',
        displayName: 'Test',
        description: 'Test plugin',
        author: 'test',
        scope: PluginScope.Guild,
        sdkRange: '>=1.0.0',
        dependencies: [],
        permissions: [],
        services: [],
        configSchema: z.object({}),
        i18nNamespaces: [],
      },
      onEnable: jest.fn().mockResolvedValue(undefined),
      onDisable: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    status: PluginStatus.Installed,
    enabledGuilds: new Set(),
    registeredCommandIds: [],
    disposers: [],
  };
}

const fakeCtx = {} as unknown as PluginContext;

describe('PluginLifecycleService', () => {
  let service: PluginLifecycleService;

  beforeEach(() => {
    service = new PluginLifecycleService();
  });

  describe('assertTransition', () => {
    it('allows Installed -> Enabled', () => {
      expect(() =>
        service.assertTransition(
          PluginStatus.Installed,
          PluginStatus.Enabled,
          'test',
        ),
      ).not.toThrow();
    });

    it('rejects Removed -> Enabled', () => {
      expect(() =>
        service.assertTransition(
          PluginStatus.Removed,
          PluginStatus.Enabled,
          'test',
        ),
      ).toThrow(
        expect.objectContaining({ code: PluginErrorCode.InvalidTransition }),
      );
    });

    it('rejects Enabled -> Installed', () => {
      expect(() =>
        service.assertTransition(
          PluginStatus.Enabled,
          PluginStatus.Installed,
          'test',
        ),
      ).toThrow(
        expect.objectContaining({ code: PluginErrorCode.InvalidTransition }),
      );
    });
  });

  describe('runHook', () => {
    it('invokes onEnable and resolves', async () => {
      const onEnable = jest.fn().mockResolvedValue(undefined);
      const entry = makeEntry({ onEnable });
      await service.runHook(entry, 'enable', fakeCtx, 5000);
      expect(onEnable).toHaveBeenCalledWith(fakeCtx);
    });

    it('skips optional hooks when undefined', async () => {
      const entry = makeEntry({ onInstall: undefined });
      await expect(
        service.runHook(entry, 'install', fakeCtx, 5000),
      ).resolves.toBeUndefined();
    });

    it('throws PluginError on hook failure', async () => {
      const entry = makeEntry({
        onEnable: jest.fn().mockRejectedValue(new Error('boom')),
      });
      await expect(
        service.runHook(entry, 'enable', fakeCtx, 5000),
      ).rejects.toThrow(
        expect.objectContaining({ code: PluginErrorCode.HookFailed }),
      );
    });

    it('throws HookTimeout when hook exceeds timeoutMs', async () => {
      const entry = makeEntry({
        onEnable: jest.fn().mockImplementation(() => new Promise(() => {})),
      });
      await expect(
        service.runHook(entry, 'enable', fakeCtx, 50),
      ).rejects.toThrow(
        expect.objectContaining({ code: PluginErrorCode.HookTimeout }),
      );
    });
  });

  describe('drainDisposers', () => {
    it('calls all disposers and empties the array', () => {
      const d1 = jest.fn();
      const d2 = jest.fn();
      const entry = makeEntry();
      entry.disposers.push(d1, d2);
      service.drainDisposers(entry);
      expect(d1).toHaveBeenCalled();
      expect(d2).toHaveBeenCalled();
      expect(entry.disposers).toHaveLength(0);
    });
  });
});
