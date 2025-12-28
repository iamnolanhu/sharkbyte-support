/**
 * Create First AI Agent Script
 * Creates the SharkByte Support agent with 3 knowledge bases
 *
 * Run with: npm run create-agent
 */

import 'dotenv/config';
import { getProjectId } from '../src/lib/digitalocean';

const DO_API_BASE = 'https://api.digitalocean.com/v2';
const DO_API_TOKEN = process.env.DO_API_TOKEN;
const DO_REGION = process.env.DO_REGION || 'tor1';
const DO_DATABASE_ID = process.env.DO_DATABASE_ID;
const DO_EMBEDDING_MODEL_UUID = process.env.DO_EMBEDDING_MODEL_UUID || 'bb3ab4ee-d9b5-11f0-b074-4e013e2ddde4'; // Qwen3 Embedding 0.6B
const DO_LLM_MODEL_UUID = process.env.DO_LLM_MODEL_UUID || '9a364867-f300-11ef-bf8f-4e013e2ddde4'; // GPT-4o

// Agent configuration
const AGENT_URL = 'https://sharkbyte-support.vercel.app';
const AGENT_DOMAIN = 'sharkbyte-support.vercel.app';
const AGENT_NAME = `Sammy - ${AGENT_DOMAIN}`;

// Crawler configuration
const EXCLUDE_TAGS = ['nav', 'footer', 'header', 'aside', 'script', 'style', 'form', 'iframe', 'noscript'];
const EMBED_MEDIA = false;

if (!DO_API_TOKEN) {
  console.error('Error: DO_API_TOKEN environment variable is required');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${DO_API_TOKEN}`,
  'Content-Type': 'application/json',
};

// Default instruction for Sammy
function getDefaultInstruction(domain: string): string {
  return `You are Sammy, a friendly and knowledgeable customer support agent for ${domain}.

Guidelines:
- Answer questions using ONLY the provided website content and knowledge base
- If you cannot find the answer, say "I couldn't find that information. Could you rephrase your question?"
- Be helpful, concise, and friendly in your responses
- Use a conversational tone while remaining professional
- If asked about topics outside the knowledge base, politely redirect to relevant topics you can help with`;
}

// Check if sitemap exists
async function checkSitemapExists(baseUrl: string): Promise<boolean> {
  try {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    const res = await fetch(sitemapUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'SharkByte-Crawler/1.0' },
    });
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('xml') || contentType.includes('text');
  } catch {
    return false;
  }
}

// Create crawl KB with web crawler
async function createCrawlKnowledgeBase(name: string, seedUrl: string): Promise<{ uuid: string }> {
  const hasSitemap = await checkSitemapExists(seedUrl);
  console.log(`  Sitemap check: ${hasSitemap ? 'found' : 'not found'}`);

  const crawlConfig = hasSitemap
    ? { base_url: `${seedUrl}/sitemap.xml`, crawling_option: 'SCOPED' }
    : { base_url: seedUrl, crawling_option: 'DOMAIN' };

  // Get project ID (auto-discovers/creates if not set)
  const projectId = await getProjectId();

  const requestBody: Record<string, unknown> = {
    name,
    embedding_model_uuid: DO_EMBEDDING_MODEL_UUID,
    project_id: projectId,
    region: DO_REGION,
    datasources: [
      {
        web_crawler_data_source: {
          base_url: crawlConfig.base_url,
          crawling_option: crawlConfig.crawling_option,
          embed_media: EMBED_MEDIA,
          exclude_tags: EXCLUDE_TAGS,
        },
      },
    ],
  };

  if (DO_DATABASE_ID) {
    requestBody.database_id = DO_DATABASE_ID;
  }

  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create crawl KB: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return { uuid: data.knowledge_base.uuid };
}

// Create empty KB (for uploads/structured)
async function createEmptyKnowledgeBase(name: string): Promise<{ uuid: string }> {
  // Get project ID (auto-discovers/creates if not set)
  const projectId = await getProjectId();

  const requestBody: Record<string, unknown> = {
    name,
    embedding_model_uuid: DO_EMBEDDING_MODEL_UUID,
    project_id: projectId,
    region: DO_REGION,
    datasources: [],
  };

  if (DO_DATABASE_ID) {
    requestBody.database_id = DO_DATABASE_ID;
  }

  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create empty KB: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return { uuid: data.knowledge_base.uuid };
}

// Get KB details
async function getKnowledgeBase(kbId: string): Promise<{ database_id?: string }> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to get KB: ${response.statusText}`);
  }
  const data = await response.json();
  return data.knowledge_base;
}

// Wait for database to be provisioned
async function waitForDatabaseReady(kbId: string, maxWaitMs = 120000, pollIntervalMs = 5000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const kb = await getKnowledgeBase(kbId);
    if (kb.database_id) {
      console.log(`  Database ready: ${kb.database_id}`);
      return;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('Timed out waiting for database provisioning');
}

// Create agent using KB's project and region (to ensure consistency)
async function createAgent(
  name: string,
  kbId: string,
  instruction: string
): Promise<{ uuid: string; endpoint: string; accessKey: string }> {
  // Get KB details to use its project_id and region
  const kbRes = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`, { headers });
  const kbData = await kbRes.json();
  const kb = kbData.knowledge_base;

  console.log(`  Using KB project: ${kb.project_id}`);
  console.log(`  Using KB region: ${kb.region}`);

  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name,
      model_uuid: DO_LLM_MODEL_UUID,
      project_id: kb.project_id,
      region: kb.region,
      knowledge_base_ids: [kbId],
      instruction,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create agent: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return {
    uuid: data.agent.uuid,
    endpoint: data.agent.deployment?.url || data.agent.endpoint || '',
    accessKey: data.agent.api_keys?.[0]?.api_key || '',
  };
}

// Set agent visibility to public
async function setAgentPublic(agentId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}/deployment_visibility`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ visibility: 'VISIBILITY_PUBLIC' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to set agent visibility: ${JSON.stringify(error)}`);
  }
}

// Create API key for agent endpoint access
async function createApiKey(agentId: string): Promise<string> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}/api_keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `sharkbyte-key-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create API key: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  // Response format: { api_key_info: { secret_key: "...", name: "...", uuid: "..." } }
  return data.api_key_info?.secret_key || '';
}

// Start indexing job
async function startIndexingJob(kbId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/indexing_jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      knowledge_base_uuid: kbId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    if (!error.message?.includes('already has an indexing job running')) {
      throw new Error(`Failed to start indexing: ${JSON.stringify(error)}`);
    }
  }
}

// Check if agent already exists
async function findAgentByDomain(domain: string): Promise<{ uuid: string; endpoint: string } | null> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${response.statusText}`);
  }
  const data = await response.json();
  const agents = data.agents || [];

  const existing = agents.find((a: { name: string }) =>
    a.name.toLowerCase().includes(domain.toLowerCase())
  );

  if (existing) {
    return {
      uuid: existing.uuid,
      endpoint: existing.deployment?.url || existing.endpoint || ''
    };
  }
  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('SharkByte Support - First Agent Creator');
  console.log('='.repeat(60));
  console.log(`\nAgent: ${AGENT_NAME}`);
  console.log(`URL: ${AGENT_URL}`);
  console.log(`Region: ${DO_REGION}`);
  console.log(`Database: ${DO_DATABASE_ID || '(auto-provision)'}\n`);

  // Check if agent already exists
  console.log('Step 1: Checking for existing agent...');
  const existingAgent = await findAgentByDomain(AGENT_DOMAIN);
  if (existingAgent) {
    console.log(`\n Agent already exists!`);
    console.log(`  UUID: ${existingAgent.uuid}`);
    console.log(`  Endpoint: ${existingAgent.endpoint}`);

    // Ensure visibility is public
    console.log('\nEnsuring agent is public...');
    await setAgentPublic(existingAgent.uuid);
    console.log('  Visibility: VISIBILITY_PUBLIC');

    // Create new API key
    console.log('\nCreating new API key...');
    const accessKey = await createApiKey(existingAgent.uuid);

    console.log('\n' + '='.repeat(60));
    console.log('AGENT DETAILS');
    console.log('='.repeat(60));
    console.log(`Agent ID: ${existingAgent.uuid}`);
    console.log(`Endpoint: ${existingAgent.endpoint}`);
    console.log(`Access Key: ${accessKey}`);
    console.log('='.repeat(60));
    return;
  }
  console.log('  No existing agent found, creating new one...\n');

  // Create crawl KB
  console.log('Step 2: Creating crawl knowledge base...');
  const crawlKBName = `${AGENT_DOMAIN.replace(/\./g, '-')}-crawl`;
  console.log(`  Name: ${crawlKBName}`);
  const crawlKB = await createCrawlKnowledgeBase(crawlKBName, AGENT_URL);
  console.log(`  UUID: ${crawlKB.uuid}`);

  // Wait for database provisioning
  console.log('\nStep 3: Waiting for database provisioning...');
  await waitForDatabaseReady(crawlKB.uuid);

  // Note: Empty KBs (uploads, structured) require datasources in DO API
  // They will be created when file upload is implemented
  console.log('\nStep 4: Skipping uploads/structured KBs (require datasources)');

  // Create agent with crawl KB only
  console.log('\nStep 5: Creating agent...');
  const agent = await createAgent(AGENT_NAME, crawlKB.uuid, getDefaultInstruction(AGENT_DOMAIN));
  console.log(`  UUID: ${agent.uuid}`);
  console.log(`  Endpoint: ${agent.endpoint}`);
  console.log(`  Access Key: ${agent.accessKey}`);

  // Set visibility to public
  console.log('\nStep 6: Setting agent visibility to public...');
  await setAgentPublic(agent.uuid);
  console.log('  Visibility: VISIBILITY_PUBLIC');

  // Use the API key from agent creation (or create new one if needed)
  const accessKey = agent.accessKey || await createApiKey(agent.uuid);

  // Start indexing
  console.log('\nStep 7: Starting indexing job...');
  await startIndexingJob(crawlKB.uuid);
  console.log(`  Indexing started for crawl KB`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('AGENT CREATED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`\nAgent Details:`);
  console.log(`  Name: ${AGENT_NAME}`);
  console.log(`  UUID: ${agent.uuid}`);
  console.log(`  Endpoint: ${agent.endpoint}`);
  console.log(`  Access Key: ${accessKey}`);
  console.log(`\nKnowledge Bases:`);
  console.log(`  Crawl: ${crawlKB.uuid} (indexing...)`);
  console.log(`  Note: Uploads/Structured KBs require datasources, will be added later`);
  console.log(`\nNext Steps:`);
  console.log(`  1. Wait for indexing to complete (check DigitalOcean console)`);
  console.log(`  2. Test the agent at: ${AGENT_URL}`);
  console.log(`  3. View agent management at: ${AGENT_URL}/agents/${agent.uuid}`);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('\nError:', error.message);
  process.exit(1);
});
