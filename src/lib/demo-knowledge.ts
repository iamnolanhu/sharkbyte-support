/**
 * Curated knowledge for the site's own demo Sammy. The site is rendered in the browser, so its
 * crawl reads almost nothing; `content/sharkbyte-knowledge.md` tells the demo Sammy what
 * SharkByte Support is, how to use it and who built it. Its chunks are stored next to the crawled
 * ones under KNOWLEDGE_URL, and re-seeding replaces only those.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_DOMAIN, type Limits } from '@/lib/config';
import { chunkText } from '@/lib/crawl/chunk';
import { domainKey } from '@/lib/crawl/url-guard';
import { replaceSourceChunks } from '@/lib/db/chunks';
import type { Db } from '@/lib/db/client';
import { embedTexts, type EmbedFn } from '@/lib/embeddings';
import { embedRequestGate } from '@/lib/rails';
import type { ChunkInput } from '@/types';

/** The `url` of every knowledge chunk: not a page, so the chat prompt shows no link for it. */
export const KNOWLEDGE_URL = 'knowledge://sharkbyte';

/** The tracked knowledge file (shipped with the functions through outputFileTracingIncludes). */
export const KNOWLEDGE_FILE = path.join('content', 'sharkbyte-knowledge.md');

/** The site's own address (APP_DOMAIN may be a bare host or a full URL). */
export function demoSiteUrl(): URL {
  return new URL(/^https?:\/\//i.test(APP_DOMAIN) ? APP_DOMAIN : `https://${APP_DOMAIN}`);
}

/** The demo agent's domain (by `domainKey`). */
export function demoDomain(): string {
  return domainKey(demoSiteUrl());
}

export function readKnowledgeFile(): string {
  return readFileSync(path.join(process.cwd(), KNOWLEDGE_FILE), 'utf8');
}

export interface KnowledgeChunk {
  title: string;
  content: string;
}

/**
 * The chunks of the knowledge markdown: one per `## ` section (longer sections are split like a
 * page), titled with the heading and starting with it. Text before the first section is a note
 * for maintainers and is left out.
 */
export function knowledgeChunks(markdown: string, limits: Limits): KnowledgeChunk[] {
  const opts = { targetTokens: limits.chunkTargetTokens, overlapTokens: limits.chunkOverlapTokens };
  const sections = markdown.split(/^## /m).slice(1);
  return sections.flatMap((section) => {
    const newline = section.indexOf('\n');
    const title = (newline === -1 ? section : section.slice(0, newline)).trim();
    const body = newline === -1 ? '' : section.slice(newline + 1).trim();
    if (!title || !body) return [];
    return chunkText(body, opts).map((part) => ({ title, content: `${title}\n\n${part}` }));
  });
}

export interface SeedOptions {
  limits: Limits;
  /** Defaults to the configured provider behind the crawls' share of the daily embedding rail. */
  embed?: EmbedFn;
  /** Defaults to the tracked knowledge file. */
  markdown?: string;
}

/**
 * Replaces the agent's knowledge chunks with fresh ones from the knowledge file (chunk → embed →
 * insert) and returns how many were stored. Crawled chunks stay; the knowledge chunks fit in
 * what the per-agent cap and the global ceiling leave. Run it when no crawl slice is running on
 * the agent (a slice keeps its own chunk count): before a crawl's first slice, or under the lock.
 */
export async function seedDemoKnowledge(db: Db, agentId: string, opts: SeedOptions): Promise<number> {
  const { limits } = opts;
  const chunks = knowledgeChunks(opts.markdown ?? readKnowledgeFile(), limits).slice(0, limits.maxChunksPerAgent);
  const embed: EmbedFn =
    opts.embed ??
    ((texts, inputType) => embedTexts(texts, inputType, { beforeRequest: embedRequestGate(db, limits, 'crawl') }));
  const vectors = chunks.length > 0 ? await embed(chunks.map((c) => c.content), 'passage') : [];
  if (vectors.length !== chunks.length) throw new Error('Embedding count mismatch');
  const rows: ChunkInput[] = chunks.map((c, i) => ({
    url: KNOWLEDGE_URL,
    title: c.title,
    pos: i,
    content: c.content,
    embedding: vectors[i],
  }));
  return replaceSourceChunks(db, agentId, KNOWLEDGE_URL, rows, limits);
}
