import { neon } from '@neondatabase/serverless';
import { captureServer } from '@/lib/analytics/server';
import { EMBEDDING_CONFIG, type EnvVars } from '@/lib/config';
import { upgradeLegacyInstructions } from './agents';
import { EMBEDDING_DIMS_PROBE, embeddingDimsMigration, schemaStatements } from './schema';

export interface SqlStatement {
  text: string;
  params?: readonly unknown[];
}

/** The database surface every repository uses: Neon in production, PGlite in tests. */
export interface Db {
  query<T extends object>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs every statement in one Postgres transaction and returns each statement's rows. */
  transaction(statements: readonly SqlStatement[]): Promise<object[][]>;
}

/** Advisory-lock key that serializes schema setup when several cold starts race. */
const SCHEMA_LOCK_ID = 74209;

/** What applySchema found when chunks.embedding did not match `dims`. */
export interface DimsChange {
  /** `migrated`: chunks emptied and the column resized. `mismatch`: left alone (no opt-in). */
  kind: 'migrated' | 'mismatch';
  fromDims: number;
  toDims: number;
  /** Agents marked `failed` for re-embedding (0 for a mismatch). */
  agentsMarked: number;
}

/** The opt-in for the destructive dimension migration: set it for one deploy, then remove it. */
export function dimsMigrationEnabled(env: EnvVars = process.env): boolean {
  return env.EMBEDDING_DIMS_MIGRATE?.trim() === '1';
}

/**
 * Applies the schema in order, inside one transaction holding an advisory lock. When
 * chunks.embedding does not match `dims`, it is migrated only with `migrate` (env
 * EMBEDDING_DIMS_MIGRATE=1); otherwise the mismatch is reported and embedding writes refuse to
 * run (see embeddingSizeMismatch). The size is read under the lock, so only the call that
 * actually migrated reports a migration.
 */
export async function applySchema(
  db: Db,
  dims: number = EMBEDDING_CONFIG.dimensions,
  migrate: boolean = dimsMigrationEnabled(),
): Promise<DimsChange | null> {
  const results = await db.transaction([
    { text: 'SELECT pg_advisory_xact_lock($1)', params: [SCHEMA_LOCK_ID] },
    ...schemaStatements(dims).map((text) => ({ text })),
    { text: EMBEDDING_DIMS_PROBE },
    ...(migrate ? [{ text: embeddingDimsMigration(dims) }] : []),
  ]);
  const probe = results[results.length - (migrate ? 2 : 1)]?.[0] as
    | { dims: number | string; agents: number | string | bigint }
    | undefined;
  const fromDims = Number(probe?.dims);
  if (!probe || fromDims === dims) return null;
  return migrate
    ? { kind: 'migrated', fromDims, toDims: dims, agentsMarked: Number(probe.agents) }
    : { kind: 'mismatch', fromDims, toDims: dims, agentsMarked: 0 };
}

/** Logs and reports a dimension change (`embedding_dims_migrated` or `embedding_dims_mismatch`). */
async function reportDimsChange(change: DimsChange | null): Promise<void> {
  if (!change) return;
  if (change.kind === 'mismatch') {
    console.error(`[db] ${mismatchMessage(change.fromDims, change.toDims)}`);
    await captureServer('embedding_dims_mismatch', { column_dims: change.fromDims, embedding_dims: change.toDims });
    return;
  }
  console.warn(
    `[db] chunks.embedding resized ${change.fromDims} -> ${change.toDims}; ` +
      `${change.agentsMarked} agents marked for re-embedding`,
  );
  await captureServer('embedding_dims_migrated', {
    from_dims: change.fromDims,
    to_dims: change.toDims,
    agents_marked: change.agentsMarked,
  });
}

function mismatchMessage(columnDims: number, embeddingDims: number): string {
  return (
    `chunks.embedding is halfvec(${columnDims}) but EMBEDDING_DIMS is ${embeddingDims}: ` +
    'deploy once with EMBEDDING_DIMS_MIGRATE=1 to re-embed, or set EMBEDDING_DIMS to match'
  );
}

const columnDimsCache = new WeakMap<Db, Promise<number>>();

/** The size of chunks.embedding (cached per database handle). */
export function embeddingColumnDims(db: Db): Promise<number> {
  let dims = columnDimsCache.get(db);
  if (!dims) {
    dims = db
      .query<{ dims: number | string }>(
        `SELECT atttypmod AS dims FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`,
      )
      .then((rows) => Number(rows[0]?.dims));
    dims.catch(() => columnDimsCache.delete(db));
    columnDimsCache.set(db, dims);
  }
  return dims;
}

/** Null when stored and new vectors have the same size; otherwise the error to fail with. */
export async function embeddingSizeMismatch(db: Db): Promise<string | null> {
  const columnDims = await embeddingColumnDims(db);
  const embeddingDims = EMBEDDING_CONFIG.dimensions;
  return columnDims === embeddingDims ? null : mismatchMessage(columnDims, embeddingDims);
}

function createNeonDb(connectionString: string): Db {
  const sql = neon(connectionString);
  return {
    async query<T extends object>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const rows = await sql.query(text, params ? [...params] : []);
      return rows as T[];
    },
    async transaction(statements: readonly SqlStatement[]): Promise<object[][]> {
      return sql.transaction(
        statements.map((s) => sql.query(s.text, s.params ? [...s.params] : [])),
      );
    },
  };
}

/** Moves agents off an earlier default instruction; a failure only logs (next cold start retries). */
async function upgradeInstructions(db: Db): Promise<void> {
  try {
    const changed = await upgradeLegacyInstructions(db);
    if (changed > 0) console.warn(`[db] ${changed} agents moved from the old default instruction to the new one`);
  } catch (error) {
    console.error('[db] Could not upgrade old default instructions', error);
  }
}

/** Wraps a Db so the first query in the process waits for the schema. */
function withSchema(raw: Db): Db {
  let ready: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    ready ??= applySchema(raw).then(
      async (change) => {
        await reportDimsChange(change);
        await upgradeInstructions(raw);
      },
      (err: unknown) => {
        ready = null; // let the next request retry
        throw err;
      },
    );
    return ready;
  };
  return {
    async query<T extends object>(text: string, params?: readonly unknown[]): Promise<T[]> {
      await ensureSchema();
      return raw.query<T>(text, params);
    },
    async transaction(statements: readonly SqlStatement[]): Promise<object[][]> {
      await ensureSchema();
      return raw.transaction(statements);
    },
  };
}

let testDb: Db | null = null;
let liveDb: Db | null = null;

export function getDb(): Db {
  if (testDb) return testDb;
  if (liveDb) return liveDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add a Postgres connection string (for example from Neon) to the environment.',
    );
  }
  liveDb = withSchema(createNeonDb(url));
  return liveDb;
}

/** Makes getDb() return `db` (pass null to restore the real database). */
export function setDbForTests(db: Db | null): void {
  testDb = db;
}
