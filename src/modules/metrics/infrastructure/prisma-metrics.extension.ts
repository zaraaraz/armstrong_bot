import { Prisma } from '@prisma/client';
import { MetricName } from '../domain/metric-name.enum';
import type { MetricsService } from '../application/metrics.service.contract';

/**
 * Builds a Prisma client extension that times every query and records it into
 * {@link MetricsService} under {@link MetricName.DbQueryDurationSeconds}, labelled
 * by model + action (both low-cardinality). It is a *passive observer*: on
 * failure it swallows the timing error and rethrows the original query error, so
 * instrumentation can never change query behaviour.
 *
 * Wiring is a single opt-in at client construction:
 *   `prisma.$extends(createPrismaMetricsExtension(metrics))`
 * Kept as a factory (rather than mutating the shared PrismaService) so the
 * database core stays untouched and the extension is unit-testable in isolation.
 */
export function createPrismaMetricsExtension(metrics: MetricsService) {
  return Prisma.defineExtension({
    name: 'metrics-query-timing',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const stop = metrics.startTimer(MetricName.DbQueryDurationSeconds, {
            model: model ?? 'raw',
            action: operation,
          });
          try {
            return await query(args);
          } finally {
            stop();
          }
        },
      },
    },
  });
}
