/**
 * Application Configuration
 * All environment variables and constants are defined here
 */

// App Domain Configuration - set via environment variable for different deployments
// Falls back to Vercel's auto-detected production URL, then to default
export const APP_DOMAIN = process.env.APP_DOMAIN
  || process.env.VERCEL_PROJECT_PRODUCTION_URL
  || 'sharkbyte-support.vercel.app';

// Default system instruction for a new Sammy
export function DEFAULT_INSTRUCTION(domain: string): string {
  return `You are Sammy, a friendly and knowledgeable customer support agent for ${domain}.

Guidelines:
- Answer questions using ONLY the provided website content and knowledge base
- If you cannot find the answer, say "I couldn't find that information. Could you rephrase your question?"
- Be helpful, concise, and friendly in your responses
- Use a conversational tone while remaining professional
- If asked about topics outside the knowledge base, politely redirect to relevant topics you can help with`;
}

// Free-tier limits: quotas, crawl bounds, chat bounds and retention
export interface Limits {
  maxPagesPerAgent: number;
  maxChunksPerAgent: number;
  maxTotalChunks: number;
  maxCrawlsPerDay: number;
  maxChatTokensPerDay: number;
  maxFirecrawlPerDay: number;
  createsPerIpPerHour: number;
  chatMessagesPerIpPerMinute: number;
  maxUserMessageChars: number;
  historyMessages: number;
  maxOutputTokens: number;
  retrievalTopK: number;
  retentionDays: number;
  evictTargetRatio: number;
  crawlMaxDurationS: number;
  pageFetchTimeoutMs: number;
  pageFetchConcurrency: number;
  pageMaxBytes: number;
  minPageTextChars: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
  createLockTtlMs: number;
  failedRetentionHours: number;
  maxInstructionChars: number;
  maxChatBodyBytes: number;
}

/** Environment variables by name (`process.env` fits; tests pass plain objects). */
export interface EnvVars {
  readonly [name: string]: string | undefined;
}

/** Reads a positive integer from `env[name]`; anything else yields `fallback`. */
export function envInt(env: EnvVars, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function getLimits(env: EnvVars = process.env): Limits {
  return {
    maxPagesPerAgent: envInt(env, 'MAX_PAGES_PER_AGENT', 30),
    maxChunksPerAgent: envInt(env, 'MAX_CHUNKS_PER_AGENT', 300),
    maxTotalChunks: envInt(env, 'MAX_TOTAL_CHUNKS', 40000),
    maxCrawlsPerDay: envInt(env, 'MAX_CRAWLS_PER_DAY', 50),
    maxChatTokensPerDay: envInt(env, 'MAX_CHAT_TOKENS_PER_DAY', 500000),
    maxFirecrawlPerDay: envInt(env, 'MAX_FIRECRAWL_PER_DAY', 50),
    createsPerIpPerHour: 3,
    chatMessagesPerIpPerMinute: 20,
    maxUserMessageChars: 2000,
    historyMessages: 20,
    maxOutputTokens: 600,
    retrievalTopK: 6,
    retentionDays: 14,
    evictTargetRatio: 0.8,
    // Vercel Hobby maximum function duration with Fluid compute
    crawlMaxDurationS: 300,
    pageFetchTimeoutMs: 8000,
    pageFetchConcurrency: 6,
    pageMaxBytes: 1024 * 1024,
    minPageTextChars: 200,
    chunkTargetTokens: 800,
    chunkOverlapTokens: 100,
    createLockTtlMs: 2 * 60 * 1000,
    failedRetentionHours: 24,
    maxInstructionChars: 4000,
    maxChatBodyBytes: 65536,
  };
}

// LLM provider chain: free OpenAI-compatible providers, tried in order
export type ProviderName = 'cerebras' | 'openrouter' | 'nvidia';

export const DEFAULT_PROVIDERS: readonly ProviderName[] = ['cerebras', 'openrouter', 'nvidia'];

function isProviderName(value: string): value is ProviderName {
  return (DEFAULT_PROVIDERS as readonly string[]).includes(value);
}

/** Parses `LLM_PROVIDERS`: trims, lowercases, drops unknown names and repeats; nothing left → the default order. */
export function parseProviderList(csv: string | undefined): ProviderName[] {
  const names: ProviderName[] = [];
  for (const raw of (csv ?? '').split(',')) {
    const name = raw.trim().toLowerCase();
    if (isProviderName(name) && !names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : [...DEFAULT_PROVIDERS];
}

export interface LlmEnv {
  providers: ProviderName[];
  firstByteTimeoutMs: number;
  cerebrasKey?: string;
  openrouterKey?: string;
  nvidiaKey?: string;
  cerebrasModel: string;
  openrouterModel: string;
  nvidiaModel: string;
}

/** A free OpenRouter model that is instruction-tuned and over 20B parameters. */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-31b-it:free';

function envText(env: EnvVars, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getLlmEnv(env: EnvVars = process.env): LlmEnv {
  return {
    providers: parseProviderList(env.LLM_PROVIDERS),
    firstByteTimeoutMs: envInt(env, 'LLM_FIRST_BYTE_TIMEOUT_MS', 8000),
    cerebrasKey: envText(env, 'CEREBRAS_API_KEY'),
    openrouterKey: envText(env, 'OPENROUTER_API_KEY'),
    nvidiaKey: envText(env, 'NVIDIA_API_KEY'),
    cerebrasModel: envText(env, 'LLM_MODEL') ?? 'gpt-oss-120b',
    openrouterModel: envText(env, 'OPENROUTER_MODEL') ?? DEFAULT_OPENROUTER_MODEL,
    nvidiaModel: envText(env, 'NVIDIA_LLM_MODEL') ?? 'openai/gpt-oss-120b',
  };
}

// Frontend polling for agent status (in milliseconds)
export const TIMING = {
  STATUS_POLL_INTERVAL: 3000, // 3 seconds
  MAX_POLL_ATTEMPTS: 60, // 3 minutes total
} as const;

// Firecrawl Configuration (fallback for SPAs/JS sites)
export const FIRECRAWL_CONFIG = {
  API_BASE: 'https://api.firecrawl.dev/v1',
  // API Key (optional - Firecrawl fallback only used if key is set)
  get API_KEY() {
    return process.env.FIRECRAWL_API_KEY || '';
  },
  get IS_ENABLED() {
    return !!process.env.FIRECRAWL_API_KEY;
  },
} as const;

// Embeddings (NVIDIA Build, OpenAI-compatible). Changing the model or dimensions means re-crawling every agent.
export const EMBEDDING_CONFIG = {
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  get model() {
    return process.env.EMBEDDING_MODEL?.trim() || 'nvidia/nemotron-3.5-embed-1b';
  },
  // Must match the halfvec(1024) column in the chunks table
  dimensions: 1024,
  /**
   * Inputs per request. Default 1: NVIDIA's hosted embedder fails most multi-input requests
   * with HTTP 500 while single inputs succeed. Raise it (up to 32) once batches work again;
   * a batch that gets a 5xx is split down to single inputs either way.
   */
  get batchSize() {
    return Math.min(envInt(process.env, 'EMBEDDING_BATCH_SIZE', 1), 32);
  },
} as const;
