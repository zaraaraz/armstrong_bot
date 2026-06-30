import type { Request } from 'express';
import { parseCookies } from './cookies';

function req(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as Request;
}

describe('parseCookies', () => {
  it('returns an empty map with no header', () => {
    expect(parseCookies(req())).toEqual({});
  });

  it('parses multiple cookies and trims whitespace', () => {
    expect(parseCookies(req('a=1; b=2;c=3'))).toEqual({
      a: '1',
      b: '2',
      c: '3',
    });
  });

  it('url-decodes values', () => {
    expect(parseCookies(req('token=a%20b'))).toEqual({ token: 'a b' });
  });

  it('ignores malformed segments', () => {
    expect(parseCookies(req('valid=1; garbage; =noname'))).toEqual({
      valid: '1',
    });
  });
});
