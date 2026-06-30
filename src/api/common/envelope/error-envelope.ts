/** Stable, client-facing error taxonomy. Frozen as part of the v1 contract. */
export enum ApiErrorCode {
  ValidationFailed = 'VALIDATION_FAILED',
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  Conflict = 'CONFLICT',
  RateLimited = 'RATE_LIMITED',
  WebhookSignatureInvalid = 'WEBHOOK_SIGNATURE_INVALID',
  Internal = 'INTERNAL_ERROR',
}

export interface FieldError {
  readonly field: string;
  readonly issue: string;
}

export interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string; // i18n-resolved, user-facing
    readonly details?: ReadonlyArray<FieldError>;
    readonly requestId: string;
  };
}

/** Maps an HTTP status code to the canonical {@link ApiErrorCode}. */
export function errorCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return ApiErrorCode.ValidationFailed;
    case 401:
      return ApiErrorCode.Unauthorized;
    case 403:
      return ApiErrorCode.Forbidden;
    case 404:
      return ApiErrorCode.NotFound;
    case 409:
      return ApiErrorCode.Conflict;
    case 429:
      return ApiErrorCode.RateLimited;
    default:
      return ApiErrorCode.Internal;
  }
}
