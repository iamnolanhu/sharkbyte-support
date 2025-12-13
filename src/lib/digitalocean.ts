/**
 * DigitalOcean Gradient AI API Client
 */

import type {
  CreateKBResponse,
  GetKBResponse,
  ListKBResponse,
  KnowledgeBase,
  CreateAgentResponse,
  GetAgentResponse,
  CreateAccessKeyResponse,
} from '@/types';

const DO_API_BASE = 'https://api.digitalocean.com/v2';

function getHeaders(): HeadersInit {
  const token = process.env.DO_API_TOKEN;
  if (!token) {
    throw new Error('DO_API_TOKEN environment variable is not set');
  }
  return {
    Authorization: `Bearer ${token}`,
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
    embedding_model_uuid:
      process.env.DO_EMBEDDING_MODEL_UUID ||
      '22653204-79ed-11ef-bf8f-4e013e2ddde4',
    project_id: process.env.DO_PROJECT_ID,
    region: process.env.DO_REGION || 'tor1',
    datasources: [
      {
        web_crawler_data_source: {
          base_url: crawlConfig.base_url,
          crawling_option: crawlConfig.crawling_option,
          embed_media: false,
          exclude_tags: [
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
        },
      },
    ],
  };

  // Add database_id if provided (reuse existing database)
  const databaseId = options.databaseId || process.env.DO_DATABASE_ID;
  if (databaseId) {
    requestBody.database_id = databaseId;
  }

  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
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
    embedding_model_uuid:
      process.env.DO_EMBEDDING_MODEL_UUID ||
      '22653204-79ed-11ef-bf8f-4e013e2ddde4',
    project_id: process.env.DO_PROJECT_ID,
    region: process.env.DO_REGION || 'tor1',
    datasources: [
      {
        web_crawler_data_source: {
          base_url: options.seedUrls[0],
          crawling_option: 'DOMAIN',
          embed_media: false,
          exclude_tags: [
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
        },
      },
    ],
  };

  // Add database_id if provided (reuse existing database)
  const databaseId = options.databaseId || process.env.DO_DATABASE_ID;
  if (databaseId) {
    requestBody.database_id = databaseId;
  }

  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Knowledge Base creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function getKnowledgeBase(kbId: string): Promise<GetKBResponse> {
  const response = await fetch(
    `${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`,
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
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
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
    `${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`,
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
  const response = await fetch(`${DO_API_BASE}/gen-ai/indexing_jobs`, {
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
    `${DO_API_BASE}/gen-ai/agents/${agentId}/knowledge_bases/${kbId}`,
    {
      method: 'POST',
      headers: getHeaders(),
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
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: options.name,
      model_uuid:
        process.env.DO_LLM_MODEL_UUID || '9a364867-f300-11ef-bf8f-4e013e2ddde4',
      project_id: process.env.DO_PROJECT_ID,
      region: process.env.DO_REGION || 'tor1',
      knowledge_base_ids: options.knowledgeBaseIds,
      instruction: options.instruction,
      ...(options.description && { description: options.description }),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Agent creation failed: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// List all agents in the project
export async function listAgents(): Promise<GetAgentResponse['agent'][]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, {
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
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to get Agent: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`Failed to delete Agent: ${JSON.stringify(error)}`);
  }
}

// ============================================
// Access Key Functions
// ============================================

export async function createAccessKey(
  agentId: string
): Promise<CreateAccessKeyResponse> {
  const response = await fetch(
    `${DO_API_BASE}/gen-ai/agents/${agentId}/access_keys`,
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
    throw new Error(`Failed to create Access Key: ${JSON.stringify(error)}`);
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
