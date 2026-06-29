import { redact, REDACTED_KEYS } from './redaction.serializer';

describe('redact', () => {
  it('scrubs every known sensitive key (case-insensitive)', () => {
    const input = {
      password: 'p',
      Token: 't',
      rconPassword: 'r',
      authorization: 'Bearer x',
      apiKey: 'k',
      username: 'visible',
    };
    const out = redact(input);

    expect(out.password).toBe('[REDACTED]');
    expect(out.Token).toBe('[REDACTED]');
    expect(out.rconPassword).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.username).toBe('visible');
  });

  it('redacts nested objects and arrays', () => {
    const out = redact({
      user: { name: 'a', token: 'secret' },
      keys: [{ apiKey: 'x' }],
    });
    expect(out.user.token).toBe('[REDACTED]');
    expect(out.keys[0].apiKey).toBe('[REDACTED]');
    expect(out.user.name).toBe('a');
  });

  it('does not mutate the original object', () => {
    const input = { password: 'p' };
    redact(input);
    expect(input.password).toBe('p');
  });

  it('handles cyclic references without throwing', () => {
    const a: Record<string, unknown> = { token: 's' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });

  it('passes through primitives', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact('plain')).toBe('plain');
  });

  it('exposes the documented redaction list', () => {
    expect(REDACTED_KEYS).toEqual(
      expect.arrayContaining([
        'password',
        'token',
        'rconPassword',
        'authorization',
        'apiKey',
      ]),
    );
  });
});
