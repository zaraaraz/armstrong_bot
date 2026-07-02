import { describe, expect, it } from 'vitest';
import { ipInCidr, ipInAnyCidr } from './cidr.util';

describe('ipInCidr (IPv4)', () => {
  it('matches a host inside the range', () => {
    expect(ipInCidr('127.0.0.1', '127.0.0.1/32')).toBe(true);
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('192.168.1.55', '192.168.1.0/24')).toBe(true);
  });

  it('rejects a host outside the range', () => {
    expect(ipInCidr('10.0.0.1', '127.0.0.1/32')).toBe(false);
    expect(ipInCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
  });

  it('treats a bare IP as a /32', () => {
    expect(ipInCidr('8.8.8.8', '8.8.8.8')).toBe(true);
    expect(ipInCidr('8.8.8.9', '8.8.8.8')).toBe(false);
  });
});

describe('ipInCidr (IPv6)', () => {
  it('matches loopback', () => {
    expect(ipInCidr('::1', '::1/128')).toBe(true);
  });

  it('matches an IPv4-mapped IPv6 against an IPv4 CIDR', () => {
    expect(ipInCidr('::ffff:127.0.0.1', '127.0.0.1/32')).toBe(true);
  });

  it('does not cross families', () => {
    expect(ipInCidr('::1', '127.0.0.1/32')).toBe(false);
  });
});

describe('ipInAnyCidr', () => {
  it('is true if any CIDR matches', () => {
    expect(ipInAnyCidr('10.0.0.5', ['127.0.0.1/32', '10.0.0.0/8'])).toBe(true);
  });
  it('is false if none match', () => {
    expect(ipInAnyCidr('8.8.8.8', ['127.0.0.1/32', '::1/128'])).toBe(false);
  });
  it('returns false on malformed input rather than throwing', () => {
    expect(ipInCidr('not-an-ip', '10.0.0.0/8')).toBe(false);
    expect(ipInCidr('10.0.0.1', 'garbage')).toBe(false);
  });
});
