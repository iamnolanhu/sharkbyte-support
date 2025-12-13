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

  // Default embedding model UUID (Alibaba-NLP/gte-large-en-v1.5)
  DEFAULT_EMBEDDING_MODEL_UUID:
    process.env.DO_EMBEDDING_MODEL_UUID || '22653204-79ed-11ef-bf8f-4e013e2ddde4',

  // Default LLM model UUID (GPT-4o)
  DEFAULT_LLM_MODEL_UUID:
    process.env.DO_LLM_MODEL_UUID || '9a364867-f300-11ef-bf8f-4e013e2ddde4',

  // Project ID (required)
  get PROJECT_ID() {
    const projectId = process.env.DO_PROJECT_ID;
    if (!projectId) {
      throw new Error('DO_PROJECT_ID environment variable is not set');
    }
    return projectId;
  },

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

// Demo Agent Configuration
export const DEMO_AGENT_CONFIG = {
  URL: 'https://sharkbyte-demo.vercel.app',
  NAME: 'Sammy - sharkbyte-demo.vercel.app',
  DOMAIN: 'sharkbyte-demo.vercel.app',
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
  // HTML tags to exclude from crawling
  EXCLUDE_TAGS: [
    'nav',
    'footer',
    'header',
    'aside',
    'script',
    'style',
    'form',
    'iframe',
    'noscript',
  ],
  // Whether to embed media files
  EMBED_MEDIA: false,
} as const;
