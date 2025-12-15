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
} from '@/types';
import { DO_CONFIG, CRAWLER_CONFIG } from './config';

// Normalize KB IDs from various API response field names
export function getKnowledgeBaseIds(agent: Agent): string[] {
  if (agent.knowledge_base_ids?.length) return agent.knowledge_base_ids;
  if (agent.knowledge_base_uuids?.length) return agent.knowledge_base_uuids;
  if (agent.knowledge_base_uuid) return [agent.knowledge_base_uuid];
  return [];
}

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${DO_CONFIG.API_TOKEN}`,
    'Content-Type': 'application/json',
  };
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

  // Check if sitemap exists
  const hasSitemap = await checkSitemapExists(baseUrl);
  console.log(
    `Sitemap check for ${baseUrl}: ${hasSitemap ? 'found' : 'not found'}`
  );

  // Configure crawl based on sitemap availability
  const crawlConfig = hasSitemap
    ? {
        base_url: `${baseUrl}/sitemap.xml`,
        crawling_option: 'SCOPED' as const,
      }
    : {
        base_url: baseUrl,
        crawling_option: 'DOMAIN' as const,
      };

  // Build request body
  const requestBody: Record<string, unknown> = {
    name: options.name,
    embedding_model_uuid: DO_CONFIG.DEFAULT_EMBEDDING_MODEL_UUID,
    project_id: DO_CONFIG.PROJECT_ID,
    region: DO_CONFIG.DEFAULT_REGION,
    datasources: [
      {
        web_crawler_data_source: {
          base_url: crawlConfig.base_url,
          crawling_option: crawlConfig.crawling_option,
          embed_media: CRAWLER_CONFIG.EMBED_MEDIA,
          exclude_tags: CRAWLER_CONFIG.EXCLUDE_TAGS,
        },
      },
    ],
  };

  // Add database_id if provided (reuse existing database)
  // Note: Only include database_id if explicitly provided via options
  // If DO_CONFIG.DATABASE_ID is set but invalid, it will cause errors
  // So we only use it if explicitly passed in options
  const databaseId = options.databaseId;
  if (databaseId) {
    requestBody.database_id = databaseId;
    console.log(`Using provided database_id: ${databaseId}`);
  } else if (DO_CONFIG.DATABASE_ID) {
    // Only use env DATABASE_ID if no option is provided
    // This allows auto-provisioning if env var is not set
    requestBody.database_id = DO_CONFIG.DATABASE_ID;
    console.log(`Using DATABASE_ID from config: ${DO_CONFIG.DATABASE_ID}`);
  } else {
    console.log('No database_id provided - will auto-provision');
  }

  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

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
  // Build request body, optionally including database_id
  const requestBody: Record<string, unknown> = {
    name: options.name,
    embedding_model_uuid: DO_CONFIG.DEFAULT_EMBEDDING_MODEL_UUID,
    project_id: DO_CONFIG.PROJECT_ID,
    region: DO_CONFIG.DEFAULT_REGION,
    datasources: [
      {
        web_crawler_data_source: {
          base_url: options.seedUrls[0],
          crawling_option: 'DOMAIN',
          embed_media: CRAWLER_CONFIG.EMBED_MEDIA,
          exclude_tags: CRAWLER_CONFIG.EXCLUDE_TAGS,
        },
      },
    ],
  };

  // Add database_id if provided (reuse existing database)
  // Note: Only include database_id if explicitly provided via options
  // If DO_CONFIG.DATABASE_ID is set but invalid, it will cause errors
  // So we only use it if explicitly passed in options
  const databaseId = options.databaseId;
  if (databaseId) {
    requestBody.database_id = databaseId;
    console.log(`Using provided database_id: ${databaseId}`);
  } else if (DO_CONFIG.DATABASE_ID) {
    // Only use env DATABASE_ID if no option is provided
    // This allows auto-provisioning if env var is not set
    requestBody.database_id = DO_CONFIG.DATABASE_ID;
    console.log(`Using DATABASE_ID from config: ${DO_CONFIG.DATABASE_ID}`);
  } else {
    console.log('No database_id provided - will auto-provision');
  }

  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

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
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/knowledge_bases/${kbId}`,
    {
      headers: getHeaders(),
    }
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

  return response.json();
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

export async function startIndexingJob(kbId: string): Promise<void> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/indexing_jobs`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      knowledge_base_uuid: kbId,
    }),
  });

  // 200 OK or empty response means success
  if (!response.ok) {
    const error = await response.json();
    // Ignore "already running" error
    if (!error.message?.includes('already has an indexing job running')) {
      throw new Error(`Failed to start indexing: ${JSON.stringify(error)}`);
    }
  }
}

export async function waitForDatabaseReady(
  kbId: string,
  maxWaitMs = 120000,
  pollIntervalMs = 5000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const kb = await getKnowledgeBase(kbId);

    // Check if database_id is present (database provisioned/associated)
    if (kb.knowledge_base.database_id) {
      console.log(`Database ready: ${kb.knowledge_base.database_id}`);
      return;
    }

    console.log('Waiting for database provisioning...');
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

export async function attachKnowledgeBaseToAgent(
  agentId: string,
  kbId: string
): Promise<void> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/knowledge_bases`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        knowledge_base_uuids: [kbId],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to attach KB to agent: ${JSON.stringify(error)}`);
  }
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
    knowledge_base_ids: options.knowledgeBaseIds,
    instruction: options.instruction,
    ...(options.description && { description: options.description }),
  };

  // Log request details (without sensitive data) for debugging
  console.log('Creating agent with:', {
    name: requestBody.name,
    project_id: requestBody.project_id,
    region: requestBody.region,
    model_uuid: requestBody.model_uuid,
    knowledge_base_count: requestBody.knowledge_base_ids.length,
  });

  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

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

  return response.json();
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

// Find an existing agent by domain name pattern
export async function findAgentByDomain(
  domain: string
): Promise<GetAgentResponse['agent'] | null> {
  const agents = await listAgents();
  // Look for agent with name pattern "Sammy - {domain}"
  return (
    agents.find((agent) =>
      agent.name.toLowerCase().includes(domain.toLowerCase())
    ) || null
  );
}

export async function getAgent(agentId: string): Promise<GetAgentResponse> {
  const response = await fetch(`${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Agent: ${JSON.stringify(error)}`);
  }

  return response.json();
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
  agentId: string
): Promise<CreateAccessKeyResponse> {
  const response = await fetch(
    `${DO_CONFIG.API_BASE}/gen-ai/agents/${agentId}/api_keys`,
    {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name: `sharkbyte-key-${Date.now()}`,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create API Key: ${JSON.stringify(error)}`);
  }

  return response.json();
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

  console.log(`Repairing KBs for agent ${agent.name}, looking for: ${expectedKBNames.join(', ')}`);

  // Get existing attached KBs
  const existingKBIds = new Set(getKnowledgeBaseIds(agent));

  // Find matching KBs from all KBs
  const { knowledge_bases } = await listKnowledgeBases();
  const results: RepairResult = {
    attached: [],
    alreadyAttached: [],
    notFound: [],
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
    // Attach the KB to the agent
    console.log(`Attaching KB ${kb.name} (${kb.uuid}) to agent ${agentId}`);
    await attachKnowledgeBaseToAgent(agentId, kb.uuid);
    results.attached.push(kb.name);
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
