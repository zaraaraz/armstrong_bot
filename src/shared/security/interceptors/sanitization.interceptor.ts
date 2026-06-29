import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { SanitizerService } from '../services/sanitizer.service';

/**
 * Strips HTML tags from every string in the incoming request body before it
 * reaches the controller. Defence-in-depth — DTO validation still runs after.
 * Skips bodies larger than a sane depth to avoid pathological recursion.
 */
@Injectable()
export class SanitizationInterceptor implements NestInterceptor {
  private static readonly MAX_DEPTH = 6;

  constructor(private readonly sanitizer: SanitizerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.body && typeof req.body === 'object') {
      req.body = this.sanitizeDeep(req.body, 0);
    }
    return next.handle();
  }

  private sanitizeDeep(value: unknown, depth: number): unknown {
    if (depth > SanitizationInterceptor.MAX_DEPTH) return value;

    if (typeof value === 'string') {
      return this.sanitizer.sanitizeHtml(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeDeep(item, depth + 1));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.sanitizeDeep(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}
