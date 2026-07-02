import { isIPv4, isIPv6 } from 'net';

/**
 * Minimal CIDR membership test for the scrape allow-list. Supports IPv4 and
 * IPv6 (including IPv4-mapped IPv6 like `::ffff:127.0.0.1`). Kept dependency-free
 * and defensive: malformed input returns false rather than throwing.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bitsRaw] = cidr.split('/');
    const bits = bitsRaw === undefined ? undefined : Number(bitsRaw);
    const normIp = normalize(ip);
    const normRange = normalize(range);
    if (normIp === null || normRange === null) return false;

    // Both must be the same family after normalisation.
    if (normIp.length !== normRange.length) return false;

    const prefix = bits ?? normIp.length * 8;
    return sameNetwork(normIp, normRange, prefix);
  } catch {
    return false;
  }
}

export function ipInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

/** Return the address as a byte array (4 for v4, 16 for v6), or null. */
function normalize(addr: string): number[] | null {
  let a = addr.trim();
  // strip IPv4-mapped IPv6 prefix so ::ffff:1.2.3.4 compares as IPv4
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) a = mapped[1];

  if (isIPv4(a)) {
    return a.split('.').map((o) => Number(o) & 0xff);
  }
  if (isIPv6(a)) {
    return expandIPv6(a);
  }
  return null;
}

function expandIPv6(addr: string): number[] | null {
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = parseInt(group || '0', 16);
    if (Number.isNaN(value)) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

function sameNetwork(a: number[], b: number[], prefixBits: number): boolean {
  let bitsLeft = prefixBits;
  for (let i = 0; i < a.length && bitsLeft > 0; i += 1) {
    const take = Math.min(8, bitsLeft);
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}
