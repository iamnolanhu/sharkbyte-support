import { describe, it, expect, vi } from 'vitest';
import {
  UnsafeUrlError,
  assertPublicUrl,
  createGuardedLookup,
  domainKey,
  isPrivateAddress,
  normalizeSubmittedUrl,
} from './url-guard';

describe('normalizeSubmittedUrl', () => {
  it.each([
    'localhost:3000',
    'http://127.0.0.1',
    'https://[::1]/',
    'ftp://example.com',
    'https://user:pw@example.com',
    'https://intranet',
    'https://example.com:8443',
    'http://10.0.0.5',
    'https://app.localhost',
    'https://localhost./',
    'http://2130706433/',
  ])('refuses %s', (u) => {
    expect(() => normalizeSubmittedUrl(u)).toThrow(UnsafeUrlError);
  });

  it('adds https and drops the hash', () => {
    expect(normalizeSubmittedUrl('  Example.com/docs#x ').href).toBe('https://example.com/docs');
  });

  it('keeps explicit ports 80 and 443', () => {
    expect(normalizeSubmittedUrl('http://example.com:80/a').hostname).toBe('example.com');
    expect(normalizeSubmittedUrl('https://example.com:443/a').hostname).toBe('example.com');
  });
});

describe('domainKey', () => {
  it('strips one www and lowercases', () => {
    expect(domainKey(new URL('https://www.Example.com/x'))).toBe('example.com');
    expect(domainKey(new URL('https://www.www.example.com/x'))).toBe('www.example.com');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '0.1.2.3',
    '10.1.2.3',
    '172.16.0.1',
    '172.20.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.100.1.1',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.169.254',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'febf::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('isPrivateAddress(%s) is true', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['100.128.0.1', '100.63.255.255', '172.15.0.1', '172.32.0.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8', '198.20.0.1'])(
    'isPrivateAddress(%s) is false',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  it('refuses a host that resolves privately', async () => {
    const lookup = vi.fn().mockResolvedValue(['10.0.0.1']);
    await expect(assertPublicUrl(new URL('https://example.com/'), lookup)).rejects.toThrow(UnsafeUrlError);
  });

  it('refuses when any resolved address is private', async () => {
    const lookup = vi.fn().mockResolvedValue(['93.184.216.34', '127.0.0.1']);
    await expect(assertPublicUrl(new URL('https://example.com/'), lookup)).rejects.toThrow(UnsafeUrlError);
  });

  it('refuses a bare IP without resolving', async () => {
    const lookup = vi.fn();
    await expect(assertPublicUrl(new URL('http://169.254.169.254/'), lookup)).rejects.toThrow(UnsafeUrlError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('accepts a public host', async () => {
    const lookup = vi.fn().mockResolvedValue(['93.184.216.34']);
    await expect(assertPublicUrl(new URL('https://example.com/'), lookup)).resolves.toBeUndefined();
  });
});

describe('createGuardedLookup', () => {
  const run = (resolve: () => Promise<string[]>, all: boolean) =>
    new Promise<{ err: Error | null; result: unknown }>((done) => {
      const lookup = createGuardedLookup(resolve);
      lookup('example.com', { all }, (err, address, family) => done({ err, result: all ? address : { address, family } }));
    });

  it('returns all public addresses when options.all is set', async () => {
    const { err, result } = await run(async () => ['93.184.216.34', '2606:2800::1'], true);
    expect(err).toBeNull();
    expect(result).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800::1', family: 6 },
    ]);
  });

  it('returns a single address otherwise', async () => {
    const { err, result } = await run(async () => ['93.184.216.34'], false);
    expect(err).toBeNull();
    expect(result).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('refuses when any address is private', async () => {
    const { err } = await run(async () => ['93.184.216.34', '127.0.0.1'], true);
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses when nothing resolves', async () => {
    const { err } = await run(async () => [], true);
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });
});
