/**
 * Demo Agent Auto-Creation
 *
 * Ensures a demo agent exists for the requesting domain.
 * Uses request-based domain detection for automatic multi-domain support.
 */

import {
  findAgentByDomain,
  createKnowledgeBaseSmartCrawl,
  createAgent,
  createAccessKey,
  startIndexingJob,
  waitForDatabaseReady,
  getDefaultInstruction,
  generateCrawlKBName,
} from './digitalocean';

// Map of domain -> creation promise (prevents duplicate creation per domain)
const demoAgentPromises = new Map<string, Promise<DemoAgentResult>>();

interface DemoAgentResult {
  agentId: string;
  endpoint: string;
  accessKey: string;
  isNew: boolean;
}

/**
 * Get the URL for a domain (adds protocol)
 */
function getDomainUrl(domain: string): string {
  const protocol = domain.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${domain}`;
}

/**
 * Get the agent name for a domain
 */
function getAgentName(domain: string): string {
  return `Sammy - ${domain}`;
}

/**
 * Ensures the demo agent exists for the given domain. Creates it if it doesn't.
 * Uses a per-domain singleton pattern to prevent duplicate creation attempts.
 */
export async function ensureDemoAgent(domain: string): Promise<DemoAgentResult> {
  // Return existing promise if already in progress for this domain
  const existingPromise = demoAgentPromises.get(domain);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = createDemoAgentIfNeeded(domain);
  demoAgentPromises.set(domain, promise);

  // Clean up promise after completion (success or failure)
  promise.finally(() => {
    demoAgentPromises.delete(domain);
  });

  return promise;
}

async function createDemoAgentIfNeeded(domain: string): Promise<DemoAgentResult> {
  console.log(`Checking for demo agent: ${domain}...`);

  try {
    // Check if agent already exists
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent && existingAgent.endpoint) {
      console.log(`Demo agent exists: ${existingAgent.uuid}`);

      // Create a new API key for this session
      const keyResponse = await createAccessKey(existingAgent.uuid);
      const accessKey = keyResponse.api_key_info?.secret_key ||
                       keyResponse.access_key?.key ||
                       keyResponse.access_key?.api_key || '';

      return {
        agentId: existingAgent.uuid,
        endpoint: existingAgent.endpoint,
        accessKey,
        isNew: false,
      };
    }

    // Create new demo agent with crawl KB
    console.log(`Creating demo agent for ${domain}...`);

    const normalizedUrl = getDomainUrl(domain);

    // Create crawl KB
    const crawlKBName = generateCrawlKBName(normalizedUrl);
    console.log(`  Creating crawl KB: ${crawlKBName}...`);
    const crawlKBResponse = await createKnowledgeBaseSmartCrawl({
      name: crawlKBName,
      seedUrls: [normalizedUrl],
    });
    const crawlKBId = crawlKBResponse.knowledge_base.uuid;
    console.log(`  Crawl KB created: ${crawlKBId}`);

    // Wait for database to be provisioned
    console.log(`  Waiting for database to be ready...`);
    await waitForDatabaseReady(crawlKBId, 120000, 5000);

    // Note: uploads/structured KBs will be created later when users upload files
    const allKBIds = [crawlKBId];

    // Create agent
    const agentName = getAgentName(domain);
    console.log(`Creating agent: ${agentName}...`);

    const agentResponse = await createAgent({
      name: agentName,
      knowledgeBaseIds: allKBIds,
      instruction: getDefaultInstruction(domain),
      description: `Demo customer support agent for ${domain}`,
    });
    const agent = agentResponse.agent;
    console.log(`Agent created: ${agent.uuid}`);

    // Create API key
    console.log(`Creating API key...`);
    const apiKeyResponse = await createAccessKey(agent.uuid);
    const apiKey = apiKeyResponse.api_key_info?.secret_key ||
                  apiKeyResponse.access_key?.key ||
                  apiKeyResponse.access_key?.api_key || '';
    console.log(`API key created`);

    // Start indexing
    console.log(`Starting indexing job on crawl KB...`);
    await startIndexingJob(crawlKBId);
    console.log(`Demo agent created successfully`);

    return {
      agentId: agent.uuid,
      endpoint: agent.endpoint || '',
      accessKey: apiKey,
      isNew: true,
    };
  } catch (error) {
    console.error('Failed to create demo agent:', error);
    throw error;
  }
}

/**
 * Get demo agent info for the given domain without creating it
 */
export async function getDemoAgentInfo(domain: string): Promise<DemoAgentResult | null> {
  try {
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent && existingAgent.endpoint) {
      const keyResponse = await createAccessKey(existingAgent.uuid);
      const accessKey = keyResponse.api_key_info?.secret_key ||
                       keyResponse.access_key?.key ||
                       keyResponse.access_key?.api_key || '';

      return {
        agentId: existingAgent.uuid,
        endpoint: existingAgent.endpoint,
        accessKey,
        isNew: false,
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to get demo agent info:', error);
    return null;
  }
}
