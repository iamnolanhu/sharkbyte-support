import { describe, it, expect, afterEach, vi } from 'vitest';
import { getDb, setDbForTests, type Db } from '@/lib/db/client';

afterEach(() => {
  setDbForTests(null);
  vi.unstubAllEnvs();
});

describe('getDb', () => {
  it('throws a clear error when DATABASE_URL is unset', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => getDb()).toThrow(/DATABASE_URL is not set/);
  });

  it('returns the db set for tests', () => {
    const fake: Db = {
      query: async () => [],
      transaction: async () => [],
    };
    setDbForTests(fake);
    expect(getDb()).toBe(fake);
  });
});
