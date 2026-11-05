import { promises as dns } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export type LookupFn = (host: string) => Promise<string[]>;

const defaultLookup: LookupFn = async (host) => {
  const records = await dns.lookup(host, { all: true });
  return records.map((r) => r.address);
};

/** Trim, add https:// when no scheme, drop the hash, and refuse anything that is not a public-looking web address. */
export function normalizeSubmittedUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new UnsafeUrlError('That does not look like a web address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https addresses are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Addresses with a login are not allowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError('Only ports 80 and 443 are allowed');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || isIP(host) !== 0) throw new UnsafeUrlError('IP addresses are not allowed, use a domain name');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new UnsafeUrlError('Local addresses are not allowed');
  if (!host.includes('.')) throw new UnsafeUrlError('That host name is not a public domain');

  url.hash = '';
  return url;
}

export function domainKey(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPrivateIPv4(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT range (RFC 6598)
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expand an IPv6 literal to eight 16-bit groups, or null when it is malformed. */
function parseIPv6(ip: string): number[] | null {
  let text = ip.split('%')[0];
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = parseIPv4(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return values.length === 8 && values.every((v) => !Number.isNaN(v)) ? values : null;
}

/** True for any address a public crawler must never reach. Unparseable input counts as private (fail closed). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isPrivateIPv4(v4);

  const g = parseIPv6(ip);
  if (!g) return true;
  const embeddedV4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
  if (firstFiveZero && g[5] === 0xffff) return isPrivateIPv4(embeddedV4); // IPv4-mapped
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and IPv4-compatible forms
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(embeddedV4); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** Early, cheap refusal: URL rules plus every resolved address public. The connect-time guard is the real one. */
export async function assertPublicUrl(url: URL, lookup: LookupFn = defaultLookup): Promise<void> {
  const checked = normalizeSubmittedUrl(url.href);
  let addresses: string[];
  try {
    addresses = await lookup(checked.hostname);
  } catch {
    throw new UnsafeUrlError('That domain could not be found');
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError('That domain points at a private network');
  }
}

/** Node lookup that refuses to hand a socket any private address. Runs on every connection, so rebinding cannot slip through. */
export function createGuardedLookup(resolve: LookupFn = defaultLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
          callback(new UnsafeUrlError('That domain points at a private network'), '', 4);
          return;
        }
        const records = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
        if (options.all) {
          (callback as unknown as (err: null, addresses: typeof records) => void)(null, records);
        } else {
          callback(null, records[0].address, records[0].family);
        }
      },
      (error: unknown) => callback(error instanceof Error ? (error as NodeJS.ErrnoException) : new UnsafeUrlError('Lookup failed'), '', 4),
    );
  };
}

export function createGuardedDispatcher(resolve?: LookupFn): Agent {
  return new Agent({ connect: { lookup: createGuardedLookup(resolve) } });
}

export const guardedDispatcher = createGuardedDispatcher();
