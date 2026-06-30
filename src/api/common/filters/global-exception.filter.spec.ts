import {
  ArgumentsHost,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ApiException } from '../errors/api-exception';
import { ApiErrorCode } from '../envelope/error-envelope';

interface CapturedResponse {
  statusCode?: number;
  body?: unknown;
}

function makeHost(captured: CapturedResponse): ArgumentsHost {
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };
  const req = { path: '/api/v1/x', headers: {} };
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  it('serializes an ApiException into an ErrorEnvelope with details', () => {
    const captured: CapturedResponse = {};
    filter.catch(
      ApiException.validation('bad', [{ field: 'x', issue: 'nope' }]),
      makeHost(captured),
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as {
      success: boolean;
      error: { code: string; details?: unknown[] };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ApiErrorCode.ValidationFailed);
    expect(body.error.details).toHaveLength(1);
  });

  it('maps a Nest HttpException to the right code', () => {
    const captured: CapturedResponse = {};
    filter.catch(new ForbiddenException('no'), makeHost(captured));
    expect(captured.statusCode).toBe(403);
    expect((captured.body as { error: { code: string } }).error.code).toBe(
      ApiErrorCode.Forbidden,
    );
  });

  it('never leaks internals for an unexpected error', () => {
    const captured: CapturedResponse = {};
    filter.catch(new Error('DB exploded with secret'), makeHost(captured));
    expect(captured.statusCode).toBe(500);
    const body = captured.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ApiErrorCode.Internal);
    expect(body.error.message).not.toContain('secret');
  });

  it('includes a requestId in the error envelope', () => {
    const captured: CapturedResponse = {};
    filter.catch(new NotFoundException(), makeHost(captured));
    const body = captured.body as { error: { requestId: string } };
    expect(typeof body.error.requestId).toBe('string');
    expect(body.error.requestId.length).toBeGreaterThan(0);
  });

  it('surfaces a string HttpException response message', () => {
    const captured: CapturedResponse = {};
    filter.catch(
      new ForbiddenException('plain string reason'),
      makeHost(captured),
    );
    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toBe('plain string reason');
  });

  it('joins an array validation message', () => {
    const captured: CapturedResponse = {};
    const ex = new ForbiddenException({
      message: ['a too short', 'b invalid'],
    });
    filter.catch(ex, makeHost(captured));
    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toBe('a too short, b invalid');
  });
});
