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
  DEFAULT_WORKSPACE_NAME: 'SharkByte Support',

  // Model Access Key ID (optional - prevents duplicate key creation)
  // Set this after first deployment to reuse existing key
  MODEL_ACCESS_KEY_ID: process.env.DO_MODEL_ACCESS_KEY_ID || null,

  // Default embedding model UUID (Alibaba-NLP/gte-large-en-v1.5)
  DEFAULT_EMBEDDING_MODEL_UUID:
    process.env.DO_EMBEDDING_MODEL_UUID || '22653204-79ed-11ef-bf8f-4e013e2ddde4',

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
// Defaults to production domain if not set
export const APP_DOMAIN = process.env.APP_DOMAIN || 'sharkbyte-support.vercel.app';

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
