/**
 * Application Configuration
 * All environment variables and constants are defined here
 */

// DigitalOcean API Configuration
export const DO_CONFIG = {
  // API Base URL
  API_BASE: 'https://api.digitalocean.com/v2',

  // Default region for resources
  DEFAULT_REGION: process.env.DO_REGION || 'tor1',

  // Default workspace name for auto-creation
  // NOTE: DO API does not support workspace assignment - agents go to default workspace
  DEFAULT_WORKSPACE_NAME: 'SharkByte Support',

  // Model Access Key ID (optional - prevents duplicate key creation)
  // Set this after first deployment to reuse existing key
  MODEL_ACCESS_KEY_ID: process.env.DO_MODEL_ACCESS_KEY_ID || null,

  // Default embedding model UUID (Qwen3 Embedding 0.6B - $0.04/1M tokens)
  // Alternative: gte-large-en-v1.5 ($0.09/1M), All MiniLM L6 v2 ($0.01/1M)
  DEFAULT_EMBEDDING_MODEL_UUID:
    process.env.DO_EMBEDDING_MODEL_UUID || 'bb3ab4ee-d9b5-11f0-b074-4e013e2ddde4',

  // Default LLM model UUID (OpenAI GPT-oss-120b - works via API)
  // Note: gpt-4o (9a364867-f300-11ef-bf8f-4e013e2ddde4) does NOT work via API
  DEFAULT_LLM_MODEL_UUID:
    process.env.DO_LLM_MODEL_UUID || '18bc9b8f-73c5-11f0-b074-4e013e2ddde4',

  // Project ID (optional - will auto-discover/create "SharkByte Support" project if not set)
  PROJECT_ID: process.env.DO_PROJECT_ID,

  // Default project name for auto-creation
  DEFAULT_PROJECT_NAME: 'SharkByte Support',

  // Database ID for knowledge bases (optional - will auto-provision if not set)
  DATABASE_ID: process.env.DO_DATABASE_ID,

  // API Token (required)
  get API_TOKEN() {
    const token = process.env.DO_API_TOKEN;
    if (!token) {
      throw new Error('DO_API_TOKEN environment variable is not set');
    }
    return token;
  },
} as const;

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

// Demo Agent Configuration (uses APP_DOMAIN)
export const DEMO_AGENT_CONFIG = {
  get URL() { return `https://${APP_DOMAIN}`; },
  get NAME() { return `Sammy - ${APP_DOMAIN}`; },
  get DOMAIN() { return APP_DOMAIN; },
} as const;

// Knowledge Base Types
export const KB_TYPES = {
  CRAWL: 'crawl',
  UPLOADS: 'uploads',
  STRUCTURED: 'structured',
} as const;

// Timeouts and Polling Intervals (in milliseconds)
export const TIMING = {
  // How long to wait for database provisioning
  DATABASE_READY_TIMEOUT: 120000, // 2 minutes
  DATABASE_READY_POLL_INTERVAL: 5000, // 5 seconds

  // How long to wait for indexing
  INDEXING_TIMEOUT: 180000, // 3 minutes
  INDEXING_POLL_INTERVAL: 3000, // 3 seconds

  // Frontend polling for agent status
  STATUS_POLL_INTERVAL: 3000, // 3 seconds
  MAX_POLL_ATTEMPTS: 60, // 3 minutes total
} as const;

// Web Crawler Configuration
export const CRAWLER_CONFIG = {
  // HTML tags to exclude from crawling (keeping nav/header/footer for better link coverage)
  EXCLUDE_TAGS: [
    'aside',
    'script',
    'style',
    'form',
    'iframe',
    'noscript',
  ],
  // Whether to embed media files
  EMBED_MEDIA: false,
  // Include links from header/footer/navigation elements
  INCLUDE_NAVIGATION_LINKS: true,
  // Minimum indexed items to consider KB has useful content
  MIN_USEFUL_ITEMS: 1,
  // Maximum pages to crawl based on site size estimate
  // Prevents runaway costs on large sites (supabase.com was $1.21 with 13M tokens)
  MAX_PAGES_BY_SIZE: {
    small: 500,   // Small sites - crawl everything
    medium: 200,  // Medium sites - good coverage
    large: 100,   // Large sites - focus on main content
    mega: 50,     // Mega sites - minimal to prevent cost blowout
  },
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
  batchSize: 32,
} as const;

// Content Quality Detection Configuration
// Used to detect when indexed content is login/auth pages instead of useful content
export const CONTENT_QUALITY_CONFIG = {
  // Keywords that indicate low-quality auth/login page content
  AUTH_KEYWORDS: [
    'sign in',
    'log in',
    'login',
    'password',
    'authenticate',
    'create account',
    'register',
    'forgot password',
    'reset password',
    'access denied',
    'unauthorized',
    'permission denied',
    'session expired',
    'please authenticate',
  ],
  // Minimum response length to consider content valid
  MIN_RESPONSE_LENGTH: 50,
  // Minimum auth keyword matches to consider content low quality
  MIN_AUTH_KEYWORD_MATCHES: 2,
  // Test question to ask the agent
  TEST_QUESTION: 'What is this website about?',
} as const;
