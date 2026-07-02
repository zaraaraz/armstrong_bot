import { Logger } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { resolveMetricsConfig } from './config/metrics.config';

const logger = new Logger('metrics.tracing');
let sdk: NodeSDK | null = null;

/**
 * Bootstraps OpenTelemetry tracing. MUST be called before NestFactory.create so
 * the auto-instrumentations can patch http/express/ioredis/prisma before those
 * libraries are required. No-op if tracing is disabled in config. Idempotent.
 *
 * Spans share their `trace_id` with Pino logs and correlate with metric spikes;
 * the OTLP exporter ships to the configured collector endpoint.
 */
export function startTracing(
  env: Record<string, string | undefined> = process.env,
): void {
  if (sdk) return;
  const cfg = resolveMetricsConfig(env);
  if (!cfg.enabled || !cfg.tracing.enabled) {
    logger.log('tracing disabled by config');
    return;
  }

  try {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: cfg.tracing.serviceName,
      }),
      sampler: new TraceIdRatioBasedSampler(cfg.tracing.sampleRatio),
      traceExporter: new OTLPTraceExporter({ url: cfg.tracing.otlpEndpoint }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs spans are noisy and low value for this service.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });
    sdk.start();
    logger.log(
      `OTLP tracing started -> ${cfg.tracing.otlpEndpoint} (sample ${cfg.tracing.sampleRatio})`,
    );
  } catch (err) {
    logger.error(
      `tracing init failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    sdk = null;
  }
}

/** Flushes and shuts down the tracer (call on graceful shutdown). */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
    logger.log('tracing shut down');
  } catch (err) {
    logger.warn(
      `tracing shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    sdk = null;
  }
}
