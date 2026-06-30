import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../context/request-id';
import {
  ApiErrorCode,
  errorCodeForStatus,
  type ErrorEnvelope,
  type FieldError,
} from '../envelope/error-envelope';
import { ApiException } from '../errors/api-exception';

/**
 * Translates every throwable into a sanitized {@link ErrorEnvelope}. Internal
 * errors, stack traces and ORM errors are logged server-side only — the client
 * receives a stable {@link ApiErrorCode} and a safe message. Validation field
 * details are surfaced only for client (4xx) errors.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('api.error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = getRequestId(req);

    const { status, code, message, details } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error({
        msg: 'unhandled.error',
        requestId,
        path: req.path,
        error: exception instanceof Error ? exception.stack : String(exception),
      });
    } else {
      this.logger.warn({
        msg: 'request.error',
        requestId,
        path: req.path,
        code,
        status,
      });
    }

    const body: ErrorEnvelope = {
      success: false,
      error: { code, message, requestId, ...(details ? { details } : {}) },
    };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: ReadonlyArray<FieldError>;
  } {
    if (exception instanceof ApiException) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = errorCodeForStatus(status);
      return { status, code, message: this.safeMessage(exception, status) };
    }

    // Anything else is an unexpected internal error — never leak its content.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.Internal,
      message: 'An unexpected error occurred.',
    };
  }

  /** For client errors we may surface the Nest message; never for 5xx. */
  private safeMessage(exception: HttpException, status: number): string {
    if (status >= 500) {
      return 'An unexpected error occurred.';
    }
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const msg = (response as { message?: unknown }).message;
      if (typeof msg === 'string') return msg;
      if (Array.isArray(msg)) return msg.join(', ');
    }
    return exception.message;
  }
}
