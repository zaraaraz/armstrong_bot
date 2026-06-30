import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ApiException } from '../errors/api-exception';
import { ApiErrorCode } from '../envelope/error-envelope';

const schema = z.object({
  label: z.string().min(3),
  count: z.coerce.number().int(),
});

describe('ZodValidationPipe', () => {
  it('returns a typed object for valid input', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ label: 'abc', count: '5' })).toEqual({
      label: 'abc',
      count: 5,
    });
  });

  it('throws VALIDATION_FAILED with field details for invalid input', () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ label: 'a', count: 'x' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      const ex = err as ApiException;
      expect(ex.code).toBe(ApiErrorCode.ValidationFailed);
      expect(ex.details?.map((d) => d.field).sort()).toEqual([
        'count',
        'label',
      ]);
    }
  });
});
