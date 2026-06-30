import { JwtService } from './jwt.service';
import { API_CONFIG, type ApiConfig } from '../config/api.config';

function makeService(): JwtService {
  const config = {
    jwt: { issuer: 'ghost-bot', accessTtlSeconds: 900, secret: 'x'.repeat(32) },
  } as ApiConfig;
  void API_CONFIG;
  return new JwtService(config);
}

describe('JwtService', () => {
  const base = {
    sub: 'user-1',
    type: 'service' as const,
    name: 'svc',
    scopes: ['tickets.read'],
    guilds: ['g1'],
  };

  it('signs and verifies a valid token round-trip', () => {
    const svc = makeService();
    const token = svc.sign(base, 1000);
    const claims = svc.verify(token, 1001);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-1');
    expect(claims?.scopes).toEqual(['tickets.read']);
    expect(claims?.iss).toBe('ghost-bot');
  });

  it('rejects an expired token', () => {
    const svc = makeService();
    const token = svc.sign(base, 1000); // exp = 1900
    expect(svc.verify(token, 2000)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const svc = makeService();
    const token = svc.sign(base, 1000);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(svc.verify(tampered, 1001)).toBeNull();
  });

  it('rejects a malformed token', () => {
    const svc = makeService();
    expect(svc.verify('not.a.jwt.token', 1001)).toBeNull();
    expect(svc.verify('only-one-part', 1001)).toBeNull();
  });

  it('rejects a token signed with a different issuer', () => {
    const svc = makeService();
    const other = new JwtService({
      jwt: { issuer: 'evil', accessTtlSeconds: 900, secret: 'x'.repeat(32) },
    } as ApiConfig);
    const token = other.sign(base, 1000);
    expect(svc.verify(token, 1001)).toBeNull();
  });
});
