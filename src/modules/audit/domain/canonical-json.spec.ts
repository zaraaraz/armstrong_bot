import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts object keys recursively so key order never changes the output', () => {
    const a = canonicalJson({ b: 1, a: { z: true, y: [1, 2] } });
    const b = canonicalJson({ a: { y: [1, 2], z: true }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"y":[1,2],"z":true},"b":1}');
  });

  it('preserves array order (arrays are positional, not sets)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('normalises bigints, Dates, undefined and null deterministically', () => {
    const out = canonicalJson({
      seq: 42n,
      at: new Date('2026-07-02T10:00:00.000Z'),
      missing: undefined,
      nil: null,
    });
    expect(out).toBe(
      '{"at":"2026-07-02T10:00:00.000Z","missing":null,"nil":null,"seq":"42"}',
    );
  });

  it('handles unicode and nested structures stably', () => {
    const value = { título: 'ação', nested: { emoji: '👻' } };
    expect(canonicalJson(value)).toBe(canonicalJson({ ...value }));
  });
});
