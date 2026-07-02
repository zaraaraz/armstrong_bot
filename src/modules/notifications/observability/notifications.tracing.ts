import { Injectable } from '@nestjs/common';
import {
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

/**
 * OpenTelemetry wrapper for the notifications pipeline. The global SDK/exporter
 * is registered by the Metrics module (item 16); spans are real once it is up
 * and a no-op otherwise. Every span carries `guildId`/`notificationId` where
 * available for correlation with the Pino logs.
 */
@Injectable()
export class NotificationsTracing {
  private readonly tracer: Tracer = trace.getTracer('notifications');

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
