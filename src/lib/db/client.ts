import { neon } from '@neondatabase/serverless';
import { SCHEMA_STATEMENTS } from './schema';

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

/** Applies the schema in order, inside one transaction holding an advisory lock. */
export async function applySchema(db: Db): Promise<void> {
  await db.transaction([
    { text: 'SELECT pg_advisory_xact_lock($1)', params: [SCHEMA_LOCK_ID] },
    ...SCHEMA_STATEMENTS.map((text) => ({ text })),
  ]);
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

/** Wraps a Db so the first query in the process waits for the schema. */
function withSchema(raw: Db): Db {
  let ready: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    ready ??= applySchema(raw).catch((err: unknown) => {
      ready = null; // let the next request retry
      throw err;
    });
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
