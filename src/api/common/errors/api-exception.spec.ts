import { ApiException } from './api-exception';
import { ApiErrorCode, errorCodeForStatus } from '../envelope/error-envelope';

describe('ApiException', () => {
  it('maps each code to the correct HTTP status', () => {
    expect(ApiException.validation('x').status).toBe(400);
    expect(ApiException.unauthorized().status).toBe(401);
    expect(ApiException.forbidden().status).toBe(403);
    expect(ApiException.notFound().status).toBe(404);
    expect(ApiException.conflict('x').status).toBe(409);
    expect(ApiException.rateLimited().status).toBe(429);
    expect(ApiException.webhookSignature().status).toBe(401);
  });

  it('carries field details on validation errors', () => {
    const ex = ApiException.validation('bad', [
      { field: 'label', issue: 'too short' },
    ]);
    expect(ex.code).toBe(ApiErrorCode.ValidationFailed);
    expect(ex.details).toEqual([{ field: 'label', issue: 'too short' }]);
  });
});

describe('errorCodeForStatus', () => {
  it.each([
    [400, ApiErrorCode.ValidationFailed],
    [401, ApiErrorCode.Unauthorized],
    [403, ApiErrorCode.Forbidden],
    [404, ApiErrorCode.NotFound],
    [409, ApiErrorCode.Conflict],
    [429, ApiErrorCode.RateLimited],
    [500, ApiErrorCode.Internal],
    [502, ApiErrorCode.Internal],
  ])('maps %i -> %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code);
  });
});
