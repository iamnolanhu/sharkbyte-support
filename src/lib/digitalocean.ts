/**
 * DigitalOcean Gradient AI API Client
 */

import type {
  Agent,
  CreateKBResponse,
  GetKBResponse,
  ListKBResponse,
  KnowledgeBase,
  CreateAgentResponse,
  GetAgentResponse,
  CreateAccessKeyResponse,
  ListAccessKeysResponse,
} from '@/types';
import { DO_CONFIG, CRAWLER_CONFIG, FIRECRAWL_CONFIG, CONTENT_QUALITY_CONFIG } from './config';
import { scrapeUrl } from './firecrawl';
import OpenAI from 'openai';

// Normalize KB IDs from various API response field names
export function getKnowledgeBaseIds(agent: Agent): string[] {
  // Try array of string IDs first
  if (agent.knowledge_base_ids?.length) return agent.knowledge_base_ids;
  if (agent.knowledge_base_uuids?.length) return agent.knowledge_base_uuids;
  if (agent.knowledge_base_uuid) return [agent.knowledge_base_uuid];

  // Try array of KB objects (the format returned by attach/get APIs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbs = (agent as any).knowledge_bases;
  if (Array.isArray(kbs) && kbs.length > 0) {
    return kbs.map((kb: { uuid: string }) => kb.uuid);
  }

  return [];
}

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${DO_CONFIG.API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// ============================================
// Retry Logic with Exponential Back-off
// ============================================

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    retryableStatuses = [429, 500, 502, 503, 504],
  } = retryOptions;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok || !retryableStatuses.includes(response.status)) {
        return response;
      }

      lastResponse = response;

      // Check for Retry-After header (429 responses)
      const retryAfter = response.headers.get('Retry-After');
      let delayMs = initialDelayMs * Math.pow(2, attempt);

      if (retryAfter) {
        const retryAfterSecs = parseInt(retryAfter, 10);
        if (!isNaN(retryAfterSecs)) {
          delayMs = retryAfterSecs * 1000;
        }
      }

      delayMs = Math.min(delayMs, maxDelayMs);

      if (attempt < maxRetries) {
        console.log(
          `[Retry] ${response.status} on ${url}, attempt ${attempt + 1}/${maxRetries}, waiting ${delayMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        console.log(
          `[Retry] Network error on ${url}, attempt ${attempt + 1}/${maxRetries}, waiting ${delayMs}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // Return the last response if we have one (for proper error handling downstream)
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error('Max retries exceeded');
}

// ============================================
// Project Functions (Auto-Initialize)
// ============================================

interface DOProject {
  id: string;
  owner_uuid: string;
  owner_id: number;
  name: string;
  description: string;
  purpose: string;
  environment: string;
  created_at: string;
  updated_at: string;
  is_default: boolean;
}

interface ListProjectsResponse {
  projects: DOProject[];
}

interface CreateProjectResponse {
  project: DOProject;
}

// Module-level cache for project ID (persists for request lifecycle)
let cachedProjectId: string | null = null;

/**
 * List all projects in the DigitalOcean account
 */
async function listProjects(): Promise<DOProject[]> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/projects`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list projects: ${JSON.stringify(error)}`);
  }

  const data: ListProjectsResponse = await response.json();
  return data.projects || [];
}

/**
 * Create a new DigitalOcean project
 */
async function createProject(name: string): Promise<DOProject> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/projects`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name,
      description: 'AI-powered customer support agents',
      purpose: 'Service or API',
      environment: 'Production',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create project: ${JSON.stringify(error)}`);
  }

  const data: CreateProjectResponse = await response.json();
  return data.project;
}

/**
 * Persist project ID to .env.local for local development
 */
function persistProjectIdToFile(projectId: string): boolean {
  // Only attempt file operations in Node.js environment (not Edge runtime)
  if (typeof window !== 'undefined') return false;

  try {
    // Dynamic import for Node.js fs module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const envPath = '.env.local';

    // Check if already in .env.local
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('DO_PROJECT_ID=')) {
        return false; // Already set
      }
    }

    // Append to .env.local
    fs.appendFileSync(envPath, `\n# Auto-discovered by SharkByte\nDO_PROJECT_ID=${projectId}\n`);
    console.log(`✅ Saved DO_PROJECT_ID to ${envPath}`);
    return true;
  } catch {
    // File system not available (Edge runtime, read-only, etc.)
    return false;
  }
}

/**
 * Show instructions for Vercel/production deployments
 */
function showVercelInstructions(projectId: string): void {
  console.log('\n' + '='.repeat(60));
  console.log('🔧 SETUP TIP: Add this to your Vercel environment variables:');
  console.log(`   DO_PROJECT_ID=${projectId}`);
  console.log('   This will prevent re-discovery on every cold start.');
  console.log('='.repeat(60) + '\n');
}

/**
 * Find or create a project by name
 */
async function getOrCreateProject(name: string): Promise<string> {
  // Check for existing project
  const projects = await listProjects();
  const existing = projects.find((p) => p.name === name);

  if (existing) {
    console.log(`Found existing project: "${name}" (${existing.id})`);
    return existing.id;
  }

  // Create new project
  console.log(`Creating new project: "${name}"...`);
  const newProject = await createProject(name);
  console.log(`✅ Created project: "${name}" (${newProject.id})`);
  return newProject.id;
}

/**
 * Get project ID - uses env var if set, otherwise auto-discovers/creates
 * Caches result for request lifecycle and persists to .env.local when possible
 */
export async function getProjectId(): Promise<string> {
  // 1. Return env var if set (fastest path)
  if (DO_CONFIG.PROJECT_ID) {
    return DO_CONFIG.PROJECT_ID;
  }

  // 2. Return in-memory cache if available (for same request)
  if (cachedProjectId) {
    return cachedProjectId;
  }

  // 3. Find or create project
  console.log(`DO_PROJECT_ID not set, auto-discovering "${DO_CONFIG.DEFAULT_PROJECT_NAME}" project...`);
  cachedProjectId = await getOrCreateProject(DO_CONFIG.DEFAULT_PROJECT_NAME);

  // 4. Try to persist locally
  const isVercel = process.env.VERCEL === '1';
  if (!isVercel) {
    const persisted = persistProjectIdToFile(cachedProjectId);
    if (!persisted) {
      // Couldn't persist to file, show instructions
      showVercelInstructions(cachedProjectId);
    }
  } else {
    // On Vercel, log instructions
    showVercelInstructions(cachedProjectId);
  }

  return cachedProjectId;
}

// ============================================
// Database Discovery Functions
// ============================================

// Cache for discovered database ID
let cachedDatabaseId: string | null = null;

/**
 * Get the current database ID from cache or env (sync - no API calls)
 * Returns undefined if not yet discovered
 */
export function getCachedDatabaseId(): string | undefined {
  return DO_CONFIG.DATABASE_ID || cachedDatabaseId || undefined;
}

/**
 * List all databases in the account via DO Databases API.
 * Used as fallback for discovering existing gen-ai databases.
 */
async function listDatabases(): Promise<Array<{
  id: string;
  name: string;
  engine: string;
  created_at: string;
}>> {
  try {
    const response = await fetch(`${DO_CONFIG.API_BASE}/databases`, {
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.log(`  Could not list databases: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.databases || [];
  } catch (err) {
    console.log(`  Could not list databases: ${err}`);
    return [];
  }
}

/**
 * Discovers an existing database by looking at Knowledge Bases, Agents, and DO Databases API.
 * Uses verbose logging to explain why discovery succeeded or failed.
 *
 * Discovery priority:
 * 1. Check existing KBs for database_id field
 * 2. Check agents' attached KBs for database_id field
 * 3. Fallback: Check DO Databases API for gen-ai databases
 */
async function discoverExistingDatabase(): Promise<string | null> {
  console.log('Discovering existing database...');

  try {
    // Step 1: Check existing KBs for database_id
    const { knowledge_bases } = await listKnowledgeBases();
    console.log(`  Checking ${knowledge_bases.length} existing KB(s)...`);

    for (const kb of knowledge_bases) {
      if (kb.database_id) {
        console.log(`  ✓ Found database in KB "${kb.name}": ${kb.database_id}`);
        return kb.database_id;
      } else {
        console.log(`  KB "${kb.name}" has no database_id (may still be provisioning)`);
      }
    }

    // Step 2: Check agents' attached KBs
    console.log('  No database found in KBs, checking agents...');
    const agents = await listAgents();
    console.log(`  Checking ${agents.length} agent(s)...`);

    for (const agent of agents) {
      const kbIds = getKnowledgeBaseIds(agent);
      for (const kbId of kbIds) {
        try {
          const kbResponse = await getKnowledgeBase(kbId);
          if (kbResponse.knowledge_base.database_id) {
            console.log(`  ✓ Found database from agent "${agent.name}" KB: ${kbResponse.knowledge_base.database_id}`);
            return kbResponse.knowledge_base.database_id;
          }
        } catch {
          console.log(`  Agent "${agent.name}" KB ${kbId} not accessible`);
        }
      }
    }

    // Step 3: Fallback - check DO Databases API directly
    console.log('  No database found in KBs/agents, checking DO Databases API...');
    const databases = await listDatabases();
    const genaiDbs = databases.filter(
      (db) => db.name?.startsWith('genai-') && db.engine === 'opensearch'
    );

    if (genaiDbs.length > 0) {
      // Prefer newest database
      const newest = genaiDbs.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      console.log(`  ✓ Found ${genaiDbs.length} gen-ai database(s) via DO API`);
      console.log(`  ✓ Using newest: "${newest.name}" (${newest.id})`);
      return newest.id;
    }

    console.log('  No existing gen-ai database found');
    return null;
  } catch (error) {
    console.warn('  Failed to discover existing database:', error);
    return null;
  }
}

/**
 * Gets a database ID to use, with discovery fallback.
 * Priority:
 * 1. DO_DATABASE_ID env var (fastest)
 * 2. In-memory cache
 * 3. Discover from existing KBs
 * 4. Return null (let auto-provisioning create one)
 */
export async function getDatabaseId(): Promise<string | null> {
  // 1. Return env var if set
  if (DO_CONFIG.DATABASE_ID) {
    return DO_CONFIG.DATABASE_ID;
  }

  // 2. Return cached value
  if (cachedDatabaseId) {
    return cachedDatabaseId;
  }

  // 3. Try to discover from existing KBs
  console.log('DO_DATABASE_ID not set, discovering from existing Knowledge Bases...');
  const discovered = await discoverExistingDatabase();

  if (discovered) {
    cachedDatabaseId = discovered;
    console.log(`✅ Using discovered database: ${discovered}`);
    return discovered;
  }

  // 4. No existing database found - will auto-provision on first KB creation
  console.log('No existing database found - will auto-provision on first KB creation');
  return null;
}

/**
 * Updates the cached database ID after a KB is created.
 * This allows subsequent KB creations to reuse the same database.
 */
export function setCachedDatabaseId(databaseId: string): void {
  if (databaseId && !cachedDatabaseId) {
    cachedDatabaseId = databaseId;
    console.log(`Cached database ID: ${databaseId}`);
  }
}

// ============================================
// Model Access Key Functions (Auto-Initialize)
// ============================================

interface ModelAccessKey {
  uuid: string;
  name: string;
  created_at: string;
}

interface CreateModelAccessKeyResponse {
  model_access_key: ModelAccessKey & { secret_key: string };
}

// Module-level cache for model access key ID
let cachedModelAccessKeyId: string | null = null;

/**
 * Get the current model access key ID from cache or env (sync - no API calls)
 * Returns undefined if not yet discovered
 */
export function getCachedModelAccessKeyId(): string | undefined {
  return DO_CONFIG.MODEL_ACCESS_KEY_ID || cachedModelAccessKeyId || undefined;
}

/**
 * List all model access keys in the account
 */
async function listModelAccessKeys(): Promise<ModelAccessKey[]> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/models/api_keys`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list model access keys: ${JSON.stringify(error)}`);
  }

  const data = await response.json();

  // Handle DO API response structure:
  // - List returns { api_key_infos: [...] } (plural with 's')
  // - Create returns { api_key_info: {...} } (singular)
  const keys = data.api_key_infos || [];

  return keys;
}

/**
 * Create a new model access key
 * Note: Returns unknown because DO API response structure may vary
 */
async function createModelAccessKey(name: string): Promise<unknown> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/models/api_keys`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create model access key: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  console.log('Model access key creation response:', JSON.stringify(data, null, 2));
  return data;
}

// Note: Regeneration removed - users should set DO_MODEL_ACCESS_KEY_ID env var
// or use the DigitalOcean dashboard to regenerate keys if needed

/**
 * Get or create a model access key by name.
 * This ensures the account has a model access key, which is required
 * before agents can use LLM models on fresh accounts.
 *
 * DEDUPLICATION: Checks env var first, then existing keys by name,
 * only creates new key if none exists.
 */
export async function getOrCreateModelAccessKey(name: string = 'sharkbyte-support'): Promise<string> {
  // 1. Check env var first (prevents duplicate creation across deployments)
  if (DO_CONFIG.MODEL_ACCESS_KEY_ID) {
    console.log(`Using model access key from environment: ${DO_CONFIG.MODEL_ACCESS_KEY_ID}`);
    cachedModelAccessKeyId = DO_CONFIG.MODEL_ACCESS_KEY_ID;
    return DO_CONFIG.MODEL_ACCESS_KEY_ID;
  }

  // 2. Return cached value if available (for same request)
  if (cachedModelAccessKeyId) {
    return cachedModelAccessKeyId;
  }

  // 3. Check for existing key with this name
  const keys = await listModelAccessKeys();
  console.log(`[getOrCreateModelAccessKey] Found ${keys.length} existing keys:`, keys.map(k => `${k.name} (${k.uuid})`));
  const existing = keys.find(k => k.name === name);
  console.log(`[getOrCreateModelAccessKey] Looking for name "${name}", found: ${existing ? existing.uuid : 'none'}`);

  if (existing) {
    console.log(`Found existing model access key: "${name}" (${existing.uuid})`);
    console.log('\n' + '='.repeat(60));
    console.log('🔧 Add to Vercel env to skip this lookup:');
    console.log(`   DO_MODEL_ACCESS_KEY_ID=${existing.uuid}`);
    console.log('='.repeat(60) + '\n');
    cachedModelAccessKeyId = existing.uuid;
    return existing.uuid;
  }

  // 4. Create new key only if none exists
  console.log(`Creating model access key: "${name}"...`);
  const response = await createModelAccessKey(name);

  // Handle possible response structures:
  // - { api_key_info: { uuid, name, secret_key } } (actual DO API response)
  // - { model_access_key: { uuid, name, secret_key } } (docs suggested)
  // - { uuid, name, secret_key } (direct)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyData = (response as any).api_key_info || (response as any).model_access_key || response;

  if (!keyData?.uuid) {
    console.error('Unexpected model access key response:', JSON.stringify(response, null, 2));
    throw new Error('Model access key creation succeeded but response missing uuid');
  }

  console.log(`✅ Created model access key: "${name}" (${keyData.uuid})`);
  cachedModelAccessKeyId = keyData.uuid;

  // Log setup instructions
  console.log('\n' + '='.repeat(60));
  console.log('🔧 SETUP TIP: Add this to prevent duplicate key creation:');
  console.log(`   DO_MODEL_ACCESS_KEY_ID=${keyData.uuid}`);
  if (keyData.secret_key) {
    console.log('\n🔑 SECRET KEY (save this - shown only once!):');
    console.log(`   ${keyData.secret_key}`);
  }
  console.log('='.repeat(60) + '\n');

  return keyData.uuid;
}

// ============================================
// Workspace Functions (Auto-Initialize)
// ============================================

interface Workspace {
  uuid: string;
  name: string;
  description?: string;
  created_at: string;
}

// Module-level cache for workspace ID
let cachedWorkspaceId: string | null = null;

/**
 * List all workspaces in the account
 */
async function listWorkspaces(): Promise<Workspace[]> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/workspaces`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list workspaces: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.workspaces || [];
}

/**
 * Create a new workspace
 */
async function createWorkspace(name: string, description?: string): Promise<unknown> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/workspaces`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name, description }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create workspace: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  console.log('Workspace creation response:', JSON.stringify(data, null, 2));
  return data;
}

/**
 * Get or create a workspace by name.
 * This ensures the account has a workspace, which is required
 * before agents can be created on fresh accounts.
 *
 * DEDUPLICATION: Gets or creates the "SharkByte Support" workspace.
 * NOTE: DO API does not support assigning agents to workspaces - they go to default.
 * We still create our workspace for organization, but agents cannot be assigned to it via API.
 * Priority:
 * 1. In-memory cache
 * 2. Auto-discover existing "SharkByte Support" workspace
 * 3. Create new workspace (for organization - agents still go to default)
 */
export async function getOrCreateWorkspace(name: string = DO_CONFIG.DEFAULT_WORKSPACE_NAME): Promise<string> {
  // Return cached value if available
  if (cachedWorkspaceId) {
    return cachedWorkspaceId;
  }

  // Check for existing workspaces
  const workspaces = await listWorkspaces();

  // Look for exact name match (our "SharkByte Support" workspace)
  const exactMatch = workspaces.find(w => w.name === name);
  if (exactMatch) {
    console.log(`Found workspace: "${exactMatch.name}" (${exactMatch.uuid})`);
    cachedWorkspaceId = exactMatch.uuid;
    return exactMatch.uuid;
  }

  // Create new workspace with our name (for organization purposes)
  // NOTE: Agents cannot be assigned to this workspace via API - they go to default workspace
  console.log(`Creating workspace: "${name}"...`);
  const response = await createWorkspace(name, 'Auto-created for SharkByte Support agents');

  // Handle response structure (workspace may be wrapped)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsData = (response as any).workspace || response;

  if (!wsData?.uuid) {
    console.error('Unexpected workspace response:', JSON.stringify(response, null, 2));
    throw new Error('Workspace creation succeeded but response missing uuid');
  }

  console.log(`✅ Created workspace: "${name}" (${wsData.uuid})`);
  console.log(`   Note: Agents will be created in default workspace (DO API limitation)`);
  console.log(`   Move agents manually via Control Panel if needed`);
  cachedWorkspaceId = wsData.uuid;

  return wsData.uuid;
}

// ============================================
// Knowledge Base Functions
// ============================================

interface CreateKBOptions {
  name: string;
  seedUrls: string[];
  maxPages?: number;
  databaseId?: string;
}

export async function checkSitemapExists(baseUrl: string): Promise<boolean> {
  try {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    const res = await fetch(sitemapUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'SharkByte-Crawler/1.0' },
    });
    // Check if response is OK and content type suggests XML
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('xml') || contentType.includes('text');
  } catch {
    return false;
  }
}

export async function createKnowledgeBaseSmartCrawl(
  options: CreateKBOptions
): Promise<CreateKBResponse> {
  const baseUrl = options.seedUrls[0];

  // Use DOMAIN crawl for broadest coverage and fastest initial results
  // Navigation links are included for better link discovery
  console.log(`Creating KB with DOMAIN crawl for ${baseUrl}`);

  // Get project ID (auto-discovers/creates if not set)
  const projectId = await getProjectId();

  // Build request body
  const requestBody: Record<string, unknown> = {
    name: options.name,
    embedding_model_uuid: DO_CONFIG.DEFAULT_EMBEDDING_MODEL_UUID,
    project_id: projectId,
    region: DO_CONFIG.DEFAULT_REGION,
    datasources: [
      {
        web_crawler_data_source: {
          base_url: baseUrl,
          crawling_option: 'DOMAIN',
          embed_media: CRAWLER_CONFIG.EMBED_MEDIA,
          exclude_tags: CRAWLER_CONFIG.EXCLUDE_TAGS,
          include_navigation_links: CRAWLER_CONFIG.INCLUDE_NAVIGATION_LINKS,
        },
      },
    ],
  };

  // Add database_id with auto-discovery
  // Priority: explicit option > env var > discovered from existing KBs > auto-provision
  const databaseId = options.databaseId || await getDatabaseId();
  if (databaseId) {
    requestBody.database_id = databaseId;
    console.log(`Using database_id: ${databaseId}`);
  } else {
    console.log('No database_id found - will auto-provision');
  }

  const response = await fetchWithRetry(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody),
    },
    { maxRetries: 3, initialDelayMs: 2000 } // Longer delay for creation operations
  );

  if (!response.ok) {
    const error = await response.json();
    const errorMessage = error.message || error.id || 'Unknown error';

    // Provide helpful error message for database not found
    if (error.id === 'not_found' && errorMessage.includes('vector database')) {
      const usedDatabaseId = databaseId || DO_CONFIG.DATABASE_ID;
      throw new Error(
        `Knowledge Base creation failed: The vector database (ID: ${usedDatabaseId}) does not exist.\n` +
        `This usually means:\n` +
        `1. The DO_DATABASE_ID environment variable is set to an invalid/non-existent database ID\n` +
        `2. The database was deleted or the ID is incorrect\n` +
        `\nSolution: Either remove DO_DATABASE_ID from your environment to allow auto-provisioning, ` +
        `or set it to a valid database ID.\n` +
        `\nError details: ${JSON.stringify(error)}`
      );
    }

    throw new Error(`Knowledge Base creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function createKnowledgeBase(
  options: CreateKBOptions
): Promise<CreateKBResponse> {
  // Get project ID (auto-discovers/creates if not set)
  const projectId = await getProjectId();

  // Build request body, optionally including database_id
  const requestBody: Record<string, unknown> = {
    name: options.name,
    embedding_model_uuid: DO_CONFIG.DEFAULT_EMBEDDING_MODEL_UUID,
    project_id: projectId,
    region: DO_CONFIG.DEFAULT_REGION,
    datasources: [
      {
        web_crawler_data_source: {
          base_url: options.seedUrls[0],
          crawling_option: 'DOMAIN',
          embed_media: CRAWLER_CONFIG.EMBED_MEDIA,
          exclude_tags: CRAWLER_CONFIG.EXCLUDE_TAGS,
          include_navigation_links: CRAWLER_CONFIG.INCLUDE_NAVIGATION_LINKS,
        },
      },
    ],
  };

  // Add database_id with auto-discovery
  // Priority: explicit option > env var > discovered from existing KBs > auto-provision
  const databaseId = options.databaseId || await getDatabaseId();
  if (databaseId) {
    requestBody.database_id = databaseId;
    console.log(`Using database_id: ${databaseId}`);
  } else {
    console.log('No database_id found - will auto-provision');
  }

  const response = await fetchWithRetry(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody),
    },
    { maxRetries: 3, initialDelayMs: 2000 } // Longer delay for creation operations
  );

  if (!response.ok) {
    const error = await response.json();
    const errorMessage = error.message || error.id || 'Unknown error';

    // Provide helpful error message for database not found
    if (error.id === 'not_found' && errorMessage.includes('vector database')) {
      const usedDatabaseId = databaseId || DO_CONFIG.DATABASE_ID;
      throw new Error(
        `Knowledge Base creation failed: The vector database (ID: ${usedDatabaseId}) does not exist.\n` +
        `This usually means:\n` +
        `1. The DO_DATABASE_ID environment variable is set to an invalid/non-existent database ID\n` +
        `2. The database was deleted or the ID is incorrect\n` +
        `\nSolution: Either remove DO_DATABASE_ID from your environment to allow auto-provisioning, ` +
        `or set it to a valid database ID.\n` +
        `\nError details: ${JSON.stringify(error)}`
      );
    }

    throw new Error(`Knowledge Base creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function getKnowledgeBase(kbId: string): Promise<GetKBResponse> {
  const response = await fetchWithRetry(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases/${kbId}`,
    {
      headers: getHeaders(),
    },
    { maxRetries: 2, initialDelayMs: 500 } // Shorter delay for polling operations
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Knowledge Base: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function listKnowledgeBases(): Promise<ListKBResponse> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list Knowledge Bases: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return {
    knowledge_bases: data.knowledge_bases || [],
  };
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases/${kbId}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`Failed to delete Knowledge Base: ${JSON.stringify(error)}`);
  }
}

// ============================================
// File Upload to KB Functions
// ============================================

interface PresignedUrlResponse {
  uploads: Array<{
    presigned_url: string;
    object_key: string;
    original_file_name: string;
    expires_at: string;
  }>;
}

/**
 * Get a presigned URL for uploading a file to a KB
 */
async function getPresignedUploadUrl(
  filename: string,
  sizeInBytes: number
): Promise<{ presignedUrl: string; objectKey: string }> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases/data_sources/file_upload_presigned_urls`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        files: [
          {
            file_name: filename,
            size_in_bytes: sizeInBytes,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get presigned URL: ${JSON.stringify(error)}`);
  }

  const data: PresignedUrlResponse = await response.json();
  const upload = data.uploads[0];

  return {
    presignedUrl: upload.presigned_url,
    objectKey: upload.object_key,
  };
}

/**
 * Add a file data source to an existing KB
 */
async function addFileDataSourceToKBInternal(
  kbId: string,
  objectKey: string,
  filename: string,
  sizeInBytes: number
): Promise<void> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases/${kbId}/data_sources`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        file_upload_data_source: {
          stored_object_key: objectKey,
          original_file_name: filename,
          size_in_bytes: sizeInBytes.toString(),
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to add data source to KB: ${JSON.stringify(error)}`);
  }
}

/**
 * Upload text/markdown content as a file to an existing KB
 * This is the main function to use for adding scraped content
 */
export async function uploadContentToKB(
  kbId: string,
  content: string,
  filename: string
): Promise<void> {
  const contentBuffer = Buffer.from(content, 'utf-8');
  const sizeInBytes = contentBuffer.length;

  console.log(`[DO] Uploading ${filename} (${sizeInBytes} bytes) to KB ${kbId}`);

  // Step 1: Get presigned URL
  const { presignedUrl, objectKey } = await getPresignedUploadUrl(filename, sizeInBytes);
  console.log(`[DO] Got presigned URL, object key: ${objectKey}`);

  // Step 2: Upload content to presigned URL
  const uploadResponse = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Length': sizeInBytes.toString(),
    },
    body: contentBuffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }
  console.log(`[DO] File uploaded to storage`);

  // Step 3: Add data source to KB
  await addFileDataSourceToKBInternal(kbId, objectKey, filename, sizeInBytes);
  console.log(`[DO] Data source added to KB`);
}

/**
 * Start an indexing job for a knowledge base.
 * Includes retry logic for "failed to get db creds" errors which occur when
 * the database is still initializing after provisioning.
 */
export async function startIndexingJob(kbId: string): Promise<void> {
  // Increased: DB provisioning can take 2-3 minutes for new databases
  const maxRetries = 12;
  const retryDelays = [5000, 10000, 15000, 20000, 25000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]; // ~4 min total

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetchWithRetry(
      `${DO_CONFIG.API_BASE}/gen-ai/indexing_jobs`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          knowledge_base_uuid: kbId,
        }),
      },
      { maxRetries: 2, initialDelayMs: 1000 }
    );

    // 200 OK or empty response means success
    if (response.ok) {
      if (attempt > 0) {
        console.log(`✅ Indexing job started successfully after ${attempt + 1} attempts`);
      }
      return;
    }

    const error = await response.json();

    // Ignore "already running" error - that's success
    if (error.message?.includes('already has an indexing job running')) {
      console.log('Indexing job already running (this is okay)');
      return;
    }

    // Retry on "failed to get db creds" - database not ready yet
    if (error.message?.includes('failed to get db creds')) {
      if (attempt < maxRetries - 1) {
        const delay = retryDelays[attempt];
        console.log(`⏳ Database not ready yet (attempt ${attempt + 1}/${maxRetries}), waiting ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }

    // For other errors or max retries exhausted, throw
    throw new Error(`Failed to start indexing: ${JSON.stringify(error)}`);
  }
}

/**
 * Wait for database to be provisioned by polling the KB's database_id field.
 * This is the "light ping" approach - no errors logged, just clean polling.
 *
 * @param kbId - Knowledge Base ID to check
 * @param maxWaitMs - Maximum wait time (default: 10 minutes)
 * @param pollIntervalMs - Interval between checks (default: 30 seconds)
 */
export async function waitForDatabaseReady(
  kbId: string,
  maxWaitMs = 600000,    // 10 minutes (was 2 minutes)
  pollIntervalMs = 30000 // 30 seconds (was 5 seconds)
): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const kb = await getKnowledgeBase(kbId);

    // Check if database_id is present (database provisioned/associated)
    if (kb.knowledge_base.database_id) {
      const dbId = kb.knowledge_base.database_id;
      console.log(`  ✓ Database ready: ${dbId}`);
      // Cache the database ID for future use
      setCachedDatabaseId(dbId);
      return dbId;
    }

    // Show progress with elapsed time
    const elapsed = Date.now() - startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    console.log(`  Checking database status (${minutes}m ${seconds}s elapsed)...`);

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Timed out waiting for database provisioning');
}

export async function waitForIndexing(
  kbId: string,
  maxWaitMs = 120000,
  pollIntervalMs = 3000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const kb = await getKnowledgeBase(kbId);
    const job = kb.knowledge_base.last_indexing_job;

    if (job?.status === 'INDEX_JOB_STATUS_COMPLETED') {
      return;
    }

    if (job?.status === 'INDEX_JOB_STATUS_FAILED') {
      throw new Error('Indexing job failed');
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error('Indexing timed out');
}

// Get content statistics for a KB
export async function getKBContentStats(kbId: string): Promise<{
  hasContent: boolean;
  indexedItems: number;
  reason?: string;
}> {
  const kb = await getKnowledgeBase(kbId);
  const indexJob = kb.knowledge_base.last_indexing_job;

  if (!indexJob) {
    return { hasContent: false, indexedItems: 0, reason: 'No indexing job' };
  }

  // Check data_source_jobs for actual indexed items
  const dsJobs = indexJob.data_source_jobs || [];
  const totalIndexed = dsJobs.reduce((sum, job) => {
    return sum + parseInt(job.indexed_item_count || '0', 10);
  }, 0);

  return {
    hasContent: totalIndexed >= CRAWLER_CONFIG.MIN_USEFUL_ITEMS,
    indexedItems: totalIndexed,
    reason: totalIndexed === 0 ? 'No content indexed' : undefined,
  };
}

// Check if KB is ready for attachment and has content
export async function isKBReady(kbId: string): Promise<{ ready: boolean; reason?: string; hasContent?: boolean }> {
  const kb = await getKnowledgeBase(kbId);
  const indexJob = kb.knowledge_base.last_indexing_job;
  const status = indexJob?.status;

  // Still running or pending
  if (status === 'INDEX_JOB_STATUS_RUNNING' || status === 'INDEX_JOB_STATUS_PENDING') {
    return { ready: false, reason: 'KB indexing still in progress', hasContent: false };
  }

  // Failed
  if (status === 'INDEX_JOB_STATUS_FAILED') {
    return { ready: false, reason: 'KB indexing failed', hasContent: false };
  }

  // No indexing job yet
  if (!status) {
    return { ready: false, reason: 'KB has never been indexed', hasContent: false };
  }

  // COMPLETED or NO_CHANGES - check actual content
  if (status === 'INDEX_JOB_STATUS_COMPLETED' || status === 'INDEX_JOB_STATUS_NO_CHANGES') {
    // Check if we actually got indexed content
    const dsJobs = indexJob?.data_source_jobs || [];
    const totalIndexed = dsJobs.reduce((sum, job) => {
      return sum + parseInt(job.indexed_item_count || '0', 10);
    }, 0);
    const hasContent = totalIndexed >= CRAWLER_CONFIG.MIN_USEFUL_ITEMS;

    return { ready: true, hasContent };
  }

  return { ready: false, reason: `Unknown indexing status: ${status}`, hasContent: false };
}

/**
 * Attach a Knowledge Base to an Agent.
 * Simplified logging - assumes DB is already ready (use waitForDatabaseReady first).
 *
 * @param agentId - Agent UUID
 * @param kbId - Knowledge Base UUID
 * @param maxRetries - Max retry attempts (default: 3 - reduced since DB should be ready)
 * @param initialDelayMs - Initial delay between retries (default: 5s)
 */
export async function attachKnowledgeBaseToAgent(
  agentId: string,
  kbId: string,
  maxRetries = 3,         // Reduced: DB should be ready before calling this
  initialDelayMs = 5000
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Add delay before retry attempts (not on first attempt)
    if (attempt > 0) {
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      console.log(`  KB attachment pending (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(
        `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/knowledge_bases/${kbId}`,
        {
          method: 'POST',
          headers: getHeaders(),
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        // Friendlier error - don't show raw JSON error to users
        const isDbNotReady = responseText.includes('failed to link');
        if (isDbNotReady) {
          console.log(`  KB attachment waiting (database may still be initializing)...`);
        } else {
          console.log(`  KB attachment failed: ${response.status}`);
        }
        lastError = new Error(`Failed to attach KB to agent: ${responseText}`);
        continue; // Retry
      }

      // Path-based endpoint returns knowledge_bases array in response - verify inline
      try {
        const responseData = JSON.parse(responseText);
        const attachedKBs = responseData.agent?.knowledge_bases || [];
        const kbAttached = attachedKBs.some((kb: { uuid: string }) => kb.uuid === kbId);

        if (kbAttached) {
          console.log(`  ✓ KB attached successfully`);
          return; // Success!
        }
      } catch {
        // If parsing fails, fall through to GET verification
      }

      // Fallback: Verify attachment by fetching the agent
      const agentResponse = await getAgent(agentId);
      const attachedKBIds = getKnowledgeBaseIds(agentResponse.agent);
      const kbAttached = attachedKBIds.includes(kbId);

      if (!kbAttached) {
        console.log(`  KB attachment not yet confirmed (attempt ${attempt + 1}/${maxRetries})`);
        lastError = new Error(`KB attachment failed - KB ${kbId} not attached after verification`);
        continue; // Retry
      }

      console.log(`  ✓ KB attached successfully`);
      return; // Success!
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.log(`  KB attachment response parsing issue (attempt ${attempt + 1})`);
        lastError = new Error('Failed to parse attach response');
        continue; // Retry
      }
      lastError = err as Error;
      continue; // Retry
    }
  }

  // All retries exhausted
  throw lastError || new Error('KB attachment failed after all retries');
}

// ============================================
// Agent Functions
// ============================================

interface CreateAgentOptions {
  name: string;
  knowledgeBaseIds: string[];
  instruction?: string;
  description?: string;
}

// Generate default instruction for Sammy agent
export function getDefaultInstruction(domain: string): string {
  return `You are Sammy, a friendly and knowledgeable customer support agent for ${domain}.

Guidelines:
- Answer questions using ONLY the provided website content and knowledge base
- If you cannot find the answer, say "I couldn't find that information. Could you rephrase your question?"
- Be helpful, concise, and friendly in your responses
- Use a conversational tone while remaining professional
- If asked about topics outside the knowledge base, politely redirect to relevant topics you can help with`;
}

export async function createAgent(
  options: CreateAgentOptions
): Promise<CreateAgentResponse> {
  // Ensure model access key exists (required for agent creation on fresh accounts)
  await getOrCreateModelAccessKey();

  // NOTE: DO API does not support workspace assignment during agent creation.
  // Agents are always created in the default "My Agent Workspace (Created by default)".
  // Workspace movement is Control Panel only - no API endpoint exists.
  // We still create our workspace for organization, but cannot assign agents to it programmatically.
  // See: DEPLOYMENT.md troubleshooting section for details.
  await getOrCreateWorkspace();
  console.log(`Note: Agent will be created in default workspace (DO API limitation)`);

  // Fetch KB details to use its project_id and region for consistency
  // This ensures the agent is created in the same project/region as its KBs
  const primaryKbId = options.knowledgeBaseIds[0];
  const kbResponse = await getKnowledgeBase(primaryKbId);
  const kb = kbResponse.knowledge_base;

  console.log(`Using KB project: ${kb.project_id}`);
  console.log(`Using KB region: ${kb.region}`);

  const requestBody = {
    name: options.name,
    model_uuid: DO_CONFIG.DEFAULT_LLM_MODEL_UUID,
    project_id: kb.project_id,
    region: kb.region,
    // NOTE: workspace_id is NOT supported by DO API - agents go to default workspace
    knowledge_base_ids: options.knowledgeBaseIds,
    instruction: options.instruction,
    visibility: 'VISIBILITY_PUBLIC', // Set public by default to avoid private endpoints
    ...(options.description && { description: options.description }),
  };

  // Log request details (without sensitive data) for debugging
  console.log('Creating agent with:', {
    name: requestBody.name,
    project_id: requestBody.project_id,
    region: requestBody.region,
    model_uuid: requestBody.model_uuid,
    visibility: requestBody.visibility,
    knowledge_base_count: requestBody.knowledge_base_ids.length,
  });

  const response = await fetchWithRetry(
    `${DO_CONFIG.API_BASE}/gen-ai/agents`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(requestBody),
    },
    { maxRetries: 3, initialDelayMs: 2000 } // Longer delay for creation operations
  );

  if (!response.ok) {
    const error = await response.json();
    const statusText = response.statusText;
    const status = response.status;

    // Provide more detailed error information
    const errorMessage = error.message || error.id || 'Unknown error';
    const errorDetails = {
      status,
      statusText,
      errorId: error.id,
      errorMessage,
      kbProjectId: kb.project_id,
      kbRegion: kb.region,
      hasApiToken: !!DO_CONFIG.API_TOKEN,
    };

    // If it's a permission error, provide helpful guidance
    if (status === 403 || error.id === 'forbidden' || errorMessage.includes('PermissionDenied')) {
      throw new Error(
        `Agent creation failed with PermissionDenied error. ` +
        `This usually means:\n` +
        `1. The API token (DO_API_TOKEN) doesn't have permission to create agents\n` +
        `2. The KB's project ID (${kb.project_id}) or region (${kb.region}) has access issues\n` +
        `3. The API token may need to be regenerated with proper permissions\n` +
        `\nError details: ${JSON.stringify(errorDetails)}`
      );
    }

    throw new Error(`Agent creation failed: ${JSON.stringify(errorDetails)}`);
  }

  const result: CreateAgentResponse = await response.json();

  // Note: visibility is set in request body above.
  // If agent doesn't deploy as public, agent-status polling will handle it
  // after the agent is deployed (can't update visibility while deploying).

  return result;
}

// List all agents in the project
export async function listAgents(): Promise<GetAgentResponse['agent'][]> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list agents: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.agents || [];
}

// Find an existing agent by domain (using .includes() for flexible matching)
export async function findAgentByDomain(
  domain: string
): Promise<GetAgentResponse['agent'] | null> {
  const agents = await listAgents();
  // Look for agent with name that includes the domain (case-insensitive)
  // This is more flexible than exact matching and handles edge cases
  const found = agents.find((agent) =>
    agent.name.toLowerCase().includes(domain.toLowerCase())
  ) || null;

  if (found) {
    console.log(`[findAgentByDomain] Found agent for "${domain}": ${found.uuid} (${found.name})`);
  } else {
    console.log(`[findAgentByDomain] No agent found for "${domain}"`);
  }

  return found;
}

export async function getAgent(agentId: string): Promise<GetAgentResponse> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Agent: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  // Debug: Log KB-related fields
  const kbIds = getKnowledgeBaseIds(data.agent);
  console.log(`getAgent ${agentId} - KB count: ${kbIds.length}, IDs: ${kbIds.join(', ') || 'none'}`);
  return data;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`Failed to delete Agent: ${JSON.stringify(error)}`);
  }
}

// Update agent properties (instruction, name, etc.)
// Note: visibility is updated via updateAgentVisibility() not this function
export async function updateAgent(
  agentId: string,
  updates: { instruction?: string; name?: string; description?: string }
): Promise<GetAgentResponse> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update Agent: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// Update agent deployment visibility (public/private)
// Uses the dedicated deployment_visibility endpoint
export async function updateAgentVisibility(
  agentId: string,
  visibility: 'VISIBILITY_PUBLIC' | 'VISIBILITY_PRIVATE'
): Promise<GetAgentResponse> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/deployment_visibility`,
    {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ visibility }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update Agent visibility: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// Delete agent and all its associated KBs
export async function deleteAgentWithKBs(agentId: string): Promise<void> {
  const agentResponse = await getAgent(agentId);
  const kbIds = getKnowledgeBaseIds(agentResponse.agent);

  // Delete agent first
  await deleteAgent(agentId);

  // Then delete all associated KBs
  for (const kbId of kbIds) {
    try {
      await deleteKnowledgeBase(kbId);
    } catch (error) {
      console.error(`Failed to delete KB ${kbId}:`, error);
    }
  }
}

// ============================================
// API Key Functions
// ============================================

// Create API key for agent endpoint authentication
// Note: Uses /api_keys endpoint, not /access_keys
export async function createAccessKey(
  agentId: string,
  name: string = 'sharkbyte-key'
): Promise<CreateAccessKeyResponse> {
  const response = await fetchWithRetry(
    `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/api_keys`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name,
      }),
    },
    { maxRetries: 2, initialDelayMs: 1000 }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create API Key: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// List existing API keys for an agent
export async function listAccessKeys(
  agentId: string
): Promise<ListAccessKeysResponse> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/api_keys`,
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to list API Keys: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// Get existing API key or create new one if none exist
// Note: When listing, we only get uuid/name - not the secret key
// The secret is only returned at creation time
// For existing keys, we return empty string (frontend uses localStorage or env var)
export async function getOrCreateAccessKey(
  agentId: string,
  name: string = 'sharkbyte-key'
): Promise<{ key: string; isNew: boolean }> {
  try {
    // Check for existing keys with matching name
    const existingKeys = await listAccessKeys(agentId);
    // Handle both possible field names from DO API (api_key_infos or api_keys)
    const keys = existingKeys.api_key_infos || existingKeys.api_keys || [];

    if (keys.length > 0) {
      console.log(`Agent ${agentId} has ${keys.length} existing API keys`);

      // Find key by exact name match
      const existing = keys.find(k => k.name === name);
      if (existing) {
        console.log(`Found existing access key: "${name}" (${existing.uuid})`);
        // Note: secret not retrievable - return empty string
        // Frontend should use localStorage or env var for the actual secret
        return { key: '', isNew: false };
      }

      // Also check if ANY key exists with our prefix (legacy keys with timestamp)
      const legacyKey = keys.find(k => k.name?.startsWith('sharkbyte-key'));
      if (legacyKey) {
        console.log(`Found legacy access key: "${legacyKey.name}" (${legacyKey.uuid})`);
        return { key: '', isNew: false };
      }
    }
  } catch (error) {
    console.log(`Could not list API keys for ${agentId}:`, error);
  }

  // Only create if no key exists
  console.log(`Creating access key: "${name}"...`);
  const keyResponse = await createAccessKey(agentId, name);
  const key = keyResponse.api_key_info?.secret_key ||
              keyResponse.access_key?.key ||
              keyResponse.access_key?.api_key || '';

  console.log(`✅ Created access key: "${name}"`);
  return { key, isNew: true };
}

// ============================================
// Content Quality Testing
// ============================================

export interface ContentQualityResult {
  isLowQuality: boolean;
  reason?: string;
  foundKeywords?: string[];
}

/**
 * Test agent content quality by sending a test question
 * Returns true if content appears to be auth/login pages
 */
export async function testContentQuality(
  agentId: string,
  endpoint: string | undefined
): Promise<ContentQualityResult> {
  if (!endpoint) {
    return { isLowQuality: false, reason: 'No endpoint available' };
  }

  try {
    // Get or create access key for quality testing
    // Use dedicated name to avoid creating many keys
    const { key: accessKey, isNew } = await getOrCreateAccessKey(agentId, 'sharkbyte-quality-test');

    if (!accessKey) {
      // Existing key found but secret not available (only returned on creation)
      // Skip quality test - content will be trusted
      if (!isNew) {
        return { isLowQuality: false, reason: 'Using existing key, skipping quality check' };
      }
      return { isLowQuality: false, reason: 'Could not create access key' };
    }

    // Query agent with test question
    const client = new OpenAI({
      baseURL: `${endpoint}/api/v1`,
      apiKey: accessKey,
    });

    const response = await client.chat.completions.create({
      model: 'n/a',
      messages: [
        { role: 'user', content: CONTENT_QUALITY_CONFIG.TEST_QUESTION },
      ],
      stream: false,
    });

    const content =
      response.choices[0]?.message?.content?.toLowerCase() || '';

    // Check for auth keywords
    const foundKeywords = CONTENT_QUALITY_CONFIG.AUTH_KEYWORDS.filter((kw) =>
      content.includes(kw)
    );

    if (foundKeywords.length >= CONTENT_QUALITY_CONFIG.MIN_AUTH_KEYWORD_MATCHES) {
      return {
        isLowQuality: true,
        reason: `Response contains auth keywords: ${foundKeywords.join(', ')}`,
        foundKeywords,
      };
    }

    // Check for very short/generic responses
    if (content.length < CONTENT_QUALITY_CONFIG.MIN_RESPONSE_LENGTH) {
      return {
        isLowQuality: true,
        reason: 'Response too short - likely no useful content',
      };
    }

    return { isLowQuality: false };
  } catch (error) {
    console.error('[testContentQuality] Error:', error);
    // Don't fail the quality check on errors - assume content is OK
    return { isLowQuality: false, reason: 'Test failed - assuming OK' };
  }
}

// ============================================
// Utility Functions
// ============================================

export function generateResourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/[^a-z0-9]/gi, '-');
    const timestamp = Date.now().toString(36);
    return `sharkbyte-${hostname}-${timestamp}`;
  } catch {
    const timestamp = Date.now().toString(36);
    return `sharkbyte-custom-${timestamp}`;
  }
}

export function generateKBName(url: string): string {
  try {
    const hostname = new URL(url).hostname
      .replace(/^www\./, '') // Remove www.
      .replace(/\.[^.]+$/, '') // Remove TLD (.com, .io, etc.)
      .replace(/[^a-z0-9]/gi, '-'); // Replace special chars with hyphens
    return `kb-${hostname}`;
  } catch {
    return `kb-site-${Date.now().toString(36)}`;
  }
}

export function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add https:// if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }

  // Validate URL
  try {
    new URL(normalized);
    return normalized;
  } catch {
    throw new Error('Invalid URL format');
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Generate agent display name: "Sammy - domain.com"
export function generateAgentName(url: string): string {
  const domain = extractDomain(url);
  return `Sammy - ${domain}`;
}

// Generate backend-friendly agent slug: "sammy-domain-com"
export function generateAgentSlug(url: string): string {
  const domain = extractDomain(url)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  return `sammy-${domain}`;
}

// Generate KB name for crawled data: "domain-com-crawl"
export function generateCrawlKBName(url: string): string {
  const domain = extractDomain(url)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  return `${domain}-crawl`;
}

// Generate KB name for uploaded documents: "domain-com-uploads"
export function generateUploadsKBName(url: string): string {
  const domain = extractDomain(url)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  return `${domain}-uploads`;
}

// Generate KB name for structured data: "domain-com-structured"
export function generateStructuredKBName(url: string): string {
  const domain = extractDomain(url)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  return `${domain}-structured`;
}

// Get KB type from name
export function getKBTypeFromName(name: string): 'crawl' | 'uploads' | 'structured' | 'unknown' {
  if (name.endsWith('-crawl')) return 'crawl';
  if (name.endsWith('-uploads')) return 'uploads';
  if (name.endsWith('-structured')) return 'structured';
  return 'unknown';
}

export async function findKBByDomain(
  domain: string
): Promise<KnowledgeBase | null> {
  const { knowledge_bases } = await listKnowledgeBases();
  // Match by KB name containing the domain (case-insensitive)
  return (
    knowledge_bases.find((kb) =>
      kb.name.toLowerCase().includes(domain.toLowerCase())
    ) || null
  );
}

// Find KB with exact domain match using standardized naming convention
// This prevents duplicates by checking for exact name match
export async function findKBByDomainExact(
  domain: string
): Promise<KnowledgeBase | null> {
  const { knowledge_bases } = await listKnowledgeBases();
  const expectedName = generateCrawlKBName(`https://${domain}`);
  return knowledge_bases.find((kb) => kb.name === expectedName) || null;
}

// Get existing KB or create new one - prevents duplicates
// Always checks for existing KB before creating
export async function getOrCreateKnowledgeBase(
  options: CreateKBOptions & { url: string }
): Promise<{ kb: KnowledgeBase; isExisting: boolean }> {
  const domain = extractDomain(options.url);
  const existingKB = await findKBByDomainExact(domain);

  if (existingKB) {
    console.log(`Found existing KB: ${existingKB.name} (${existingKB.uuid})`);
    return { kb: existingKB, isExisting: true };
  }

  console.log(`No existing KB found for ${domain}, creating new one...`);
  const response = await createKnowledgeBaseSmartCrawl(options);
  return { kb: response.knowledge_base, isExisting: false };
}

// ============================================
// Repair Functions
// ============================================

export interface RepairResult {
  attached: string[];
  alreadyAttached: string[];
  notFound: string[];
  skipped: string[]; // KBs skipped due to region/project mismatch or other issues
  enhanced: string[]; // KBs enhanced via Firecrawl fallback
  created: string[]; // KBs created from scratch when none existed
}

/**
 * Repair agent KB attachments by finding orphaned KBs that match the agent's domain
 * and attaching them automatically.
 */
export async function repairAgentKBs(agentId: string): Promise<RepairResult> {
  const agentResponse = await getAgent(agentId);
  const agent = agentResponse.agent;

  // Extract domain from agent name "Sammy - domain.com"
  const domainMatch = agent.name.match(/Sammy - (.+)/);
  if (!domainMatch) {
    throw new Error('Cannot extract domain from agent name');
  }
  const domain = domainMatch[1];

  // Generate expected KB names based on domain
  const domainSlug = domain.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const expectedKBNames = [
    `${domainSlug}-crawl`,
    `${domainSlug}-uploads`,
    `${domainSlug}-structured`,
  ];

  console.log(`Repairing KBs for agent ${agent.name} (region: ${agent.region}, project: ${agent.project_id})`);
  console.log(`Looking for: ${expectedKBNames.join(', ')}`);

  // Get existing attached KBs
  const existingKBIds = new Set(getKnowledgeBaseIds(agent));

  // Find matching KBs from all KBs
  const { knowledge_bases } = await listKnowledgeBases();
  const results: RepairResult = {
    attached: [],
    alreadyAttached: [],
    notFound: [],
    skipped: [],
    enhanced: [], // KBs that were enhanced via Firecrawl
    created: [], // KBs created from scratch
  };

  for (const expectedName of expectedKBNames) {
    const kb = knowledge_bases.find((k) => k.name === expectedName);
    if (!kb) {
      results.notFound.push(expectedName);
      continue;
    }
    if (existingKBIds.has(kb.uuid)) {
      results.alreadyAttached.push(kb.name);
      continue;
    }

    // Validate region match
    if (kb.region !== agent.region) {
      console.warn(`KB ${kb.name} region (${kb.region}) doesn't match agent region (${agent.region}), skipping`);
      results.skipped.push(`${kb.name} (region mismatch)`);
      continue;
    }

    // Validate project match
    if (kb.project_id !== agent.project_id) {
      console.warn(`KB ${kb.name} project (${kb.project_id}) doesn't match agent project (${agent.project_id}), skipping`);
      results.skipped.push(`${kb.name} (project mismatch)`);
      continue;
    }

    // Log KB details for debugging
    console.log(`KB ${kb.name} - region: ${kb.region}, project: ${kb.project_id}, indexed: ${kb.last_indexing_job?.status}`);

    // Check if KB has content - if not, try Firecrawl fallback
    const readiness = await isKBReady(kb.uuid);
    let needsFirecrawl = false;
    let firecrawlReason = '';

    if (!readiness.hasContent) {
      needsFirecrawl = true;
      firecrawlReason = 'no content indexed';
    } else if (FIRECRAWL_CONFIG.IS_ENABLED) {
      // KB has content - check quality
      console.log(`[Repair] Checking content quality for KB ${kb.name}...`);
      const qualityCheck = await testContentQuality(agentId, agent.endpoint);

      if (qualityCheck.isLowQuality) {
        needsFirecrawl = true;
        firecrawlReason = qualityCheck.reason || 'low quality content detected';
        console.log(`[Repair] Low quality detected: ${firecrawlReason}`);
      } else {
        console.log(`[Repair] Content quality OK for KB ${kb.name}`);
      }
    }

    if (needsFirecrawl && FIRECRAWL_CONFIG.IS_ENABLED) {
      // Check if Firecrawl already ran (file datasource exists)
      const hasFileDataSource = kb.datasources?.some(
        (ds) => ds.file_upload_data_source
      );

      if (!hasFileDataSource) {
        console.log(`[Repair] KB ${kb.name} needs enhancement (${firecrawlReason}), triggering Firecrawl...`);
        try {
          const url = `https://${domain}`;
          const scrapeResult = await scrapeUrl(url);

          if (scrapeResult.success && scrapeResult.markdown) {
            console.log(`[Repair] Firecrawl scraped ${scrapeResult.markdown.length} chars from ${url}`);

            // Upload scraped content to KB
            const filename = `${domainSlug}-scraped.md`;
            await uploadContentToKB(kb.uuid, scrapeResult.markdown, filename);
            console.log(`[Repair] Uploaded Firecrawl content to KB ${kb.uuid}`);

            // Re-index the KB
            await startIndexingJob(kb.uuid);
            console.log(`[Repair] Re-indexing KB ${kb.uuid}...`);

            // Wait a bit for indexing to start processing
            await new Promise(resolve => setTimeout(resolve, 3000));

            results.enhanced.push(kb.name);
          } else {
            console.warn(`[Repair] Firecrawl failed for ${url}: ${scrapeResult.error}`);
          }
        } catch (err) {
          console.error(`[Repair] Firecrawl error:`, err);
        }
      } else {
        console.log(`[Repair] KB ${kb.name} already has file datasource, skipping Firecrawl`);
      }
    }

    // Attach the KB to the agent
    console.log(`Attaching KB ${kb.name} (${kb.uuid}) to agent ${agentId}`);
    try {
      await attachKnowledgeBaseToAgent(agentId, kb.uuid);
      results.attached.push(kb.name);
    } catch (attachErr) {
      console.warn(`[Repair] KB attachment failed for ${kb.name}:`, attachErr);
      results.skipped.push(`${kb.name} (attachment failed)`);
    }
  }

  // If no KBs were attached and crawl KB is missing, create it from scratch
  const crawlKBName = `${domainSlug}-crawl`;
  if (
    results.attached.length === 0 &&
    results.alreadyAttached.length === 0 &&
    results.notFound.includes(crawlKBName)
  ) {
    console.log(`[Repair] No existing KBs found, creating new crawl KB for ${domain}...`);

    try {
      // Create KB with web crawler
      const newKB = await createKnowledgeBaseSmartCrawl({
        name: crawlKBName,
        seedUrls: [`https://${domain}`],
      });
      console.log(`[Repair] Created KB ${crawlKBName} (${newKB.knowledge_base.uuid})`);

      // Wait for database provisioning
      await waitForDatabaseReady(newKB.knowledge_base.uuid);
      console.log(`[Repair] Database ready for ${crawlKBName}`);

      // Start indexing
      await startIndexingJob(newKB.knowledge_base.uuid);
      console.log(`[Repair] Started indexing for ${crawlKBName}`);

      // Attach to agent
      await attachKnowledgeBaseToAgent(agentId, newKB.knowledge_base.uuid);
      console.log(`[Repair] Attached ${crawlKBName} to agent`);

      // Update results
      results.created!.push(crawlKBName);
      results.notFound = results.notFound.filter((n) => n !== crawlKBName);
    } catch (err) {
      console.error(`[Repair] Failed to create KB for ${domain}:`, err);
      results.skipped.push(`${crawlKBName} (creation failed: ${err instanceof Error ? err.message : 'unknown'})`);
    }
  }

  console.log('Repair results:', results);
  return results;
}

// ============================================
// Retry Helper
// ============================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, i))
        );
      }
    }
  }

  throw lastError;
}
