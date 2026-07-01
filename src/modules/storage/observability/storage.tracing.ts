import { Injectable } from '@nestjs/common';
import {
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

/**
 * Thin wrapper over the OpenTelemetry API. When no SDK/exporter is registered
 * the global tracer is a no-op, so this is safe to use unconditionally — the
 * Metrics/Telemetry module (item 16) wires the real exporter later.
 */
@Injectable()
export class StorageTracing {
  private readonly tracer: Tracer = trace.getTracer('storage');

  /** Run `fn` inside a span, recording exceptions and returning its result. */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, async (span) => {
      span.setAttributes(attributes);
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /** The current active trace id, or a synthetic one when tracing is disabled. */
  currentTraceId(): string {
    const span = trace.getActiveSpan();
    const ctx = span?.spanContext();
    return ctx?.traceId ?? randomTraceId();
  }
}

function randomTraceId(): string {
  // 16 random bytes as hex, matching the W3C trace-id width.
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}
