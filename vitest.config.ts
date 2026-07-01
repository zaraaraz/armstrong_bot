import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/tests/setup/vitest.setup.ts'],
    include: ['src/**/*.spec.ts'],
    exclude: [
      'src/**/*.int-spec.ts',
      'src/**/*.contract-spec.ts',
      'src/dashboard/e2e/**',
    ],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
      exclude: [
        '**/*.spec.ts',
        '**/*.int-spec.ts',
        '**/*.contract-spec.ts',
        'src/tests/**',
        '**/*.dto.ts',
        'dist/**',
        // Integration/e2e-covered surfaces (need a live Nest app + DB/Redis):
        // controllers, gateways, module wiring, Prisma repositories, and the
        // outbound Discord OAuth HTTP client are exercised by the integration
        // and Playwright suites (see architecture/11-testing.md §13), not unit
        // specs. The frontend is a separate deployable with its own test run.
        '**/*.controller.ts',
        '**/*.gateway.ts',
        '**/*.module.ts',
        '**/*.repository.ts',
        '**/discord-oauth.service.ts',
        'src/main.ts',
        'src/api/swagger.ts',
        'src/dashboard/frontend/**',
        // Pre-existing CORE collaborators (Phase 1/2) that the API/dashboard
        // guards inject. They carry no unit specs of their own (covered by the
        // integration suite) and are out of scope for Phase 3 — listing them
        // keeps the unit-coverage signal focused on code this slice owns.
        'src/core/permissions/**',
        'src/cache/cache.service.ts',
        // The L1/L2 stores wrap an in-process LRU and a live Redis connection;
        // they are exercised by the integration suite alongside cache.service,
        // not by unit specs (consistent with the rest of the cache module).
        'src/cache/stores/**',
        'src/cache/keys/**',
        'src/core/module-system/module-registry.ts',
        'src/database/prisma.service.ts',
        'src/shared/security/services/api-key.service.ts',
        'src/shared/security/services/secret.service.ts',
        // Scheduler (Phase 4) integration/observability surfaces. The BullMQ
        // producer/worker wrappers need a live Redis, and the Prometheus /
        // OpenTelemetry adapters are no-ops until the Metrics module (item 16)
        // registers an exporter — all exercised by the integration suite, not
        // unit specs. The domain/service/reconciler logic IS unit-covered.
        'src/modules/scheduler/infrastructure/scheduler.queue.ts',
        'src/modules/scheduler/infrastructure/scheduler.worker.ts',
        'src/modules/scheduler/infrastructure/queue.tokens.ts',
        'src/modules/scheduler/observability/**',
        'src/modules/scheduler/application/lifecycle.emitter.ts',
        'src/modules/scheduler/application/maintenance.handler.ts',
        'src/modules/scheduler/application/cleanup.job.ts',
        'src/modules/scheduler/application/scheduler-health.state.ts',
        'src/modules/scheduler/application/scheduler-query.service.ts',
        'src/modules/scheduler/config/scheduler-config.service.ts',
      ],
    },
  },
});
