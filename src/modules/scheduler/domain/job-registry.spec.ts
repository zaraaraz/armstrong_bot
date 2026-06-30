import { InMemoryJobRegistry } from './job-registry';
import { JobKind } from './job-kind.enum';
import type { JobHandler } from './job-handler.interface';

function handler(kind: string): JobHandler {
  return {
    kind,
    parse: (raw) => raw,
    handle: () => Promise.resolve(),
  };
}

describe('InMemoryJobRegistry', () => {
  it('registers and resolves a handler by kind', () => {
    const reg = new InMemoryJobRegistry();
    const h = handler(JobKind.Reminder);
    reg.register(h);
    expect(reg.resolve(JobKind.Reminder)).toBe(h);
    expect(reg.resolve('reminder')).toBe(h);
  });

  it('returns undefined for an unknown kind', () => {
    const reg = new InMemoryJobRegistry();
    expect(reg.resolve('nope')).toBeUndefined();
  });

  it('rejects duplicate registration for the same kind', () => {
    const reg = new InMemoryJobRegistry();
    reg.register(handler(JobKind.Backup));
    expect(() => reg.register(handler(JobKind.Backup))).toThrow(
      /already registered/,
    );
  });

  it('lists all registered kinds', () => {
    const reg = new InMemoryJobRegistry();
    reg.register(handler('a'));
    reg.register(handler('b'));
    expect([...reg.list()].sort()).toEqual(['a', 'b']);
  });
});
