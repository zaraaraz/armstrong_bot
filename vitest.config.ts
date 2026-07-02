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
        // Storage (Phase 4, item 14): drivers wrap the filesystem / future S3
        // SDK, the emitter is a thin EventBus bridge, and the config service
        // needs live Prisma+Redis — integration-suite surfaces, mirroring the
        // scheduler exclusions above. Domain + application logic IS unit-covered.
        'src/modules/storage/infrastructure/drivers/**',
        'src/modules/storage/observability/**',
        'src/modules/storage/application/storage-event.emitter.ts',
        'src/modules/storage/config/storage-config.service.ts',
        // Audit (Phase 4, item 15): the BullMQ producer/worker need a live
        // Redis, the archive store wraps the filesystem, the emitter/consumer
        // are thin EventBus bridges, and the config service needs live
        // Prisma+Redis — integration-suite surfaces, mirroring the scheduler
        // and storage exclusions above. Domain + application logic (chain,
        // retention, ingest normalisation, query service) IS unit-covered.
        'src/modules/audit/infrastructure/audit.queue.ts',
        'src/modules/audit/infrastructure/audit-archive.store.ts',
        'src/modules/audit/jobs/**',
        'src/modules/audit/observability/**',
        'src/modules/audit/events/audit-event.emitter.ts',
        'src/modules/audit/events/audit-event.consumer.ts',
        'src/modules/audit/config/audit-config.service.ts',
        // Metrics (Phase 4, item 16): the BullMQ producer/worker need a live
        // Redis, the OTel/tracing adapter and the prom-client default-registry
        // collector are exercised only with a running process, the snapshot
        // service/writer + config service need live Prisma+Redis, and the event
        // emitter/consumer are thin EventBus bridges — all integration-suite
        // surfaces, mirroring the scheduler/storage/audit exclusions above. The
        // domain (threshold, metric-definition, cidr), the recording facade,
        // the snapshot builder, the scrape guard and the config parser ARE
        // unit-covered.
        'src/modules/metrics/infrastructure/metrics.queue.ts',
        'src/modules/metrics/infrastructure/metrics.registry.ts',
        'src/modules/metrics/infrastructure/prisma-metrics.extension.ts',
        'src/modules/metrics/jobs/**',
        'src/modules/metrics/tracing.ts',
        'src/modules/metrics/application/system-collector.service.ts',
        'src/modules/metrics/application/metrics-snapshot.service.ts',
        'src/modules/metrics/application/metrics-snapshot.writer.ts',
        'src/modules/metrics/config/metrics-config.service.ts',
        'src/modules/metrics/events/metrics-event.emitter.ts',
        'src/modules/metrics/events/metrics-event.consumer.ts',
        // Notifications (Phase 4, item 17): same categories as above — the three
        // BullMQ producers/workers need a live Redis, the transports reach
        // Discord / HTTP / SMTP / web-push, the OTel/tracing + prom-client
        // observability adapters need a running process, the routing/consumer
        // and integration notifiers bridge the EventBus, and the config service
        // needs live Prisma+Redis. The domain (template, preference-resolver,
        // dedupe, value objects), the dispatch application service, the provider
        // registry, the GitHub HMAC verifier and the config parser ARE
        // unit-covered.
        'src/modules/notifications/jobs/**',
        'src/modules/notifications/providers/discord.provider.ts',
        'src/modules/notifications/providers/webhook.provider.ts',
        'src/modules/notifications/providers/email.provider.ts',
        'src/modules/notifications/providers/push.provider.ts',
        'src/modules/notifications/observability/**',
        'src/modules/notifications/config/notifications-config.service.ts',
        'src/modules/notifications/application/notification-routing.service.ts',
        'src/modules/notifications/application/integration/twitch-notifier.service.ts',
        'src/modules/notifications/application/integration/youtube-notifier.service.ts',
        'src/modules/notifications/events/notification-event.emitter.ts',
        'src/modules/notifications/events/consumers/**',
        // Webhooks (Phase 4, item 18): same categories as the modules above —
        // the two BullMQ producers/workers need a live Redis, the outbound
        // delivery transport reaches external HTTPS endpoints, the config
        // service needs live Prisma+Redis, and the emitter/consumer bridge the
        // EventBus. The application services orchestrate those integration
        // seams (queue enqueue, EncryptionService, repositories) so they are
        // integration-covered too. The domain (verifiers, normalizers,
        // registries, idempotency guard) and the config parser ARE unit-covered.
        'src/modules/webhooks/jobs/**',
        'src/modules/webhooks/application/**',
        'src/modules/webhooks/config/webhooks-config.service.ts',
        'src/modules/webhooks/events/webhook-event.emitter.ts',
        'src/modules/webhooks/events/consumers/**',
        // Logs (Phase 5, item 19): same categories as the modules above — the
        // two BullMQ producers/workers need a live Redis, the gateway listener
        // + bus subscriber bridge Discord/EventBus, the dispatcher reaches the
        // Discord client, the observability counters need a running process, and
        // the config service needs live Prisma+Redis. The domain (event factory,
        // colour map), the policy service, the formatter, the ingestion pipeline
        // and the application service ARE unit-covered.
        'src/modules/logs/jobs/**',
        'src/modules/logs/observability/**',
        'src/modules/logs/config/logs-config.service.ts',
        'src/modules/logs/application/log-dispatcher.service.ts',
        'src/modules/logs/events/logs-event.emitter.ts',
        'src/modules/logs/infrastructure/log-gateway.listener.ts',
        'src/modules/logs/infrastructure/log-event-bus.subscriber.ts',
      ],
    },
  },
});
