import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

/**
 * Whole-application DI smoke test. Compiling the real `AppModule` resolves the
 * entire provider graph — every constructor dependency of every module — WITHOUT
 * starting the app (no `app.init()`, so no BullMQ workers spin up and the lazy
 * Redis/Prisma clients never connect).
 *
 * This is the guard that hand-built unit specs cannot be: a provider that is
 * injected but not exported by its owning module (e.g. `MemoryCacheStore` needed
 * by the metrics `SystemCollectorService`) compiles under `tsc` and passes every
 * unit test, then crashes NestJS at boot in production. Keep this test green and
 * that class of regression is caught in CI, not on the server.
 */
describe('AppModule DI graph', () => {
  it('compiles — every provider dependency resolves', async () => {
    // Necord validates a token is present at module construction.
    process.env['DISCORD_TOKEN'] = process.env['DISCORD_TOKEN'] ?? 'test-token';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
