import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { EMBEDDING_CONFIG } from '@/lib/config';
import { applySchema, type Db, type SqlStatement } from '@/lib/db/client';

export function wrap(pg: PGliteInterface): Db {
  return {
    async query<T extends object>(text: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await pg.query<T>(text, params ? [...params] : undefined);
      return result.rows;
    },
    async transaction(statements: readonly SqlStatement[]): Promise<object[][]> {
      return pg.transaction(async (tx) => {
        const out: object[][] = [];
        for (const s of statements) {
          const result = await tx.query<object>(s.text, s.params ? [...s.params] : undefined);
          out.push(result.rows);
        }
        return out;
      });
    },
  };
}

// Booting PGlite with pgvector takes seconds; cloning a booted one takes under one.
// Each test file builds one template with the schema and hands every caller a clone.
let template: Promise<PGlite> | null = null;

async function bootTemplate(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { vector } });
  await applySchema(wrap(pg));
  return pg;
}

/** A fresh, isolated in-memory Postgres (PGlite + pgvector) with the schema applied. */
export async function createTestDb(): Promise<Db> {
  template ??= bootTemplate();
  return wrap(await (await template).clone());
}

/** Timeout for a hook that calls createTestDb (the first call boots PGlite); TEST_DB_TIMEOUT_MS raises it on a loaded machine. */
export const TEST_DB_TIMEOUT_MS = Number(process.env.TEST_DB_TIMEOUT_MS) || 30_000;

/** The configured embedding size (768 for the default Gemini provider). */
export const EMBEDDING_DIMS = EMBEDDING_CONFIG.dimensions;

/** A fresh PGlite with pgvector and no schema (for schema and migration tests). */
export async function createEmptyTestDb(): Promise<Db> {
  return wrap(new PGlite({ extensions: { vector } }));
}

/** Deterministic unit vector of `dims` floats from a seeded LCG. */
export function fakeEmbedding(seed: number, dims: number = EMBEDDING_DIMS): number[] {
  let state = (seed * 2654435761 + 1) >>> 0;
  const v: number[] = [];
  for (let i = 0; i < dims; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    v.push(state / 0x100000000 - 0.5);
  }
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return v.map((x) => x / norm);
}
