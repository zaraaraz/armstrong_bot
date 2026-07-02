import { Injectable } from '@nestjs/common';
import {
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

/**
 * OpenTelemetry wrapper for the audit pipeline. No-op until an SDK/exporter
 * is registered (Metrics module, roadmap item 16).
 */
@Injectable()
export class AuditTracing {
  private readonly tracer: Tracer = trace.getTracer('audit');

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
}
