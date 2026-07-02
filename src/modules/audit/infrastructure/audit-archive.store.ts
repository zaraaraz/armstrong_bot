import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, open } from 'fs/promises';
import { dirname, join } from 'path';

export interface WrittenArchive {
  readonly storageRef: string; // absolute file path (future: object-store key)
  readonly byteSize: number;
  readonly checksum: string; // sha256 of the archive bytes
}

/**
 * Writes verified archive segments to the local filesystem under the
 * configured archive root, streaming chunk by chunk. An object-store backend
 * (S3/GCS) is a future extension — `storageRef` is already opaque to callers.
 */
@Injectable()
export class AuditArchiveStore {
  private readonly logger = new Logger(AuditArchiveStore.name);

  async write(
    rootDir: string,
    relativePath: string,
    chunks: AsyncIterable<string>,
  ): Promise<WrittenArchive> {
    const fullPath = join(rootDir, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });

    const digest = createHash('sha256');
    let byteSize = 0;
    const handle = await open(fullPath, 'wx'); // never overwrite an archive
    try {
      for await (const chunk of chunks) {
        const bytes = Buffer.from(chunk, 'utf8');
        await handle.write(bytes);
        digest.update(bytes);
        byteSize += bytes.byteLength;
      }
    } finally {
      await handle.close();
    }

    const checksum = digest.digest('hex');
    this.logger.log(`archive written ref=${fullPath} bytes=${byteSize}`);
    return { storageRef: fullPath, byteSize, checksum };
  }
}
