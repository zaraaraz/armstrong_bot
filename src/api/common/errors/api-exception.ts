import { HttpStatus } from '@nestjs/common';
import { ApiErrorCode, type FieldError } from '../envelope/error-envelope';

const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  [ApiErrorCode.ValidationFailed]: HttpStatus.BAD_REQUEST,
  [ApiErrorCode.Unauthorized]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.Forbidden]: HttpStatus.FORBIDDEN,
  [ApiErrorCode.NotFound]: HttpStatus.NOT_FOUND,
  [ApiErrorCode.Conflict]: HttpStatus.CONFLICT,
  [ApiErrorCode.RateLimited]: HttpStatus.TOO_MANY_REQUESTS,
  [ApiErrorCode.WebhookSignatureInvalid]: HttpStatus.UNAUTHORIZED,
  [ApiErrorCode.Internal]: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Domain-agnostic API error carrying a stable {@link ApiErrorCode}. Thrown by
 * the API layer; the {@link GlobalExceptionFilter} serializes it directly into
 * an {@link ErrorEnvelope} without leaking internals.
 */
export class ApiException extends Error {
  readonly status: number;
  readonly details?: ReadonlyArray<FieldError>;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    details?: ReadonlyArray<FieldError>,
  ) {
    super(message);
    this.name = 'ApiException';
    this.status = STATUS_FOR_CODE[code];
    this.details = details;
  }

  static validation(
    message: string,
    details?: ReadonlyArray<FieldError>,
  ): ApiException {
    return new ApiException(ApiErrorCode.ValidationFailed, message, details);
  }

  static unauthorized(message = 'Authentication required.'): ApiException {
    return new ApiException(ApiErrorCode.Unauthorized, message);
  }

  static forbidden(
    message = 'You do not have access to this resource.',
  ): ApiException {
    return new ApiException(ApiErrorCode.Forbidden, message);
  }

  static notFound(message = 'Resource not found.'): ApiException {
    return new ApiException(ApiErrorCode.NotFound, message);
  }

  static conflict(message: string): ApiException {
    return new ApiException(ApiErrorCode.Conflict, message);
  }

  static rateLimited(message = 'Too many requests.'): ApiException {
    return new ApiException(ApiErrorCode.RateLimited, message);
  }

  static webhookSignature(
    message = 'Webhook signature verification failed.',
  ): ApiException {
    return new ApiException(ApiErrorCode.WebhookSignatureInvalid, message);
  }
}
