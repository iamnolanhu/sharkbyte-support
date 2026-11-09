import type { Db } from './client';

/** Adds `by` to a counter; a row past its expiry restarts at `by`. Returns the new count. */
export async function incrementQuota(
  db: Db,
  key: string,
  by: number,
  expiresAt: Date,
  now: Date,
): Promise<number> {
  const rows = await db.query<{ count: string }>(
    `INSERT INTO quota (key, count, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN quota.expires_at <= $4 THEN EXCLUDED.count ELSE quota.count + EXCLUDED.count END,
       expires_at = CASE WHEN quota.expires_at <= $4 THEN EXCLUDED.expires_at ELSE quota.expires_at END
     RETURNING count`,
    [key, by, expiresAt.toISOString(), now.toISOString()],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Current counter value, 0 when missing or expired. */
export async function readQuota(db: Db, key: string, now: Date): Promise<number> {
  const rows = await db.query<{ count: string }>(
    'SELECT count FROM quota WHERE key = $1 AND expires_at > $2',
    [key, now.toISOString()],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Takes the lock if it is free or expired. Returns true when this caller now holds it. */
export async function acquireLock(db: Db, key: string, now: Date, ttlMs: number): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const rows = await db.query<{ key: string }>(
    `INSERT INTO locks (key, expires_at) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at
       WHERE locks.expires_at <= $3
     RETURNING key`,
    [key, expiresAt.toISOString(), now.toISOString()],
  );
  return rows.length > 0;
}

/** Pushes a held lock's expiry out by `ttlMs` (a long holder working in steps). */
export async function renewLock(db: Db, key: string, now: Date, ttlMs: number): Promise<void> {
  await db.query('UPDATE locks SET expires_at = $2 WHERE key = $1', [key, new Date(now.getTime() + ttlMs).toISOString()]);
}

export async function releaseLock(db: Db, key: string): Promise<void> {
  await db.query('DELETE FROM locks WHERE key = $1', [key]);
}

export async function deleteExpiredQuota(db: Db, now: Date): Promise<number> {
  const rows = await db.query<{ key: string }>(
    'DELETE FROM quota WHERE expires_at <= $1 RETURNING key',
    [now.toISOString()],
  );
  return rows.length;
}

export async function deleteExpiredLocks(db: Db, now: Date): Promise<number> {
  const rows = await db.query<{ key: string }>(
    'DELETE FROM locks WHERE expires_at <= $1 RETURNING key',
    [now.toISOString()],
  );
  return rows.length;
}
