/**
 * Demo Agent Auto-Creation
 *
 * Ensures a demo agent exists for the production domain.
 * Uses VERCEL_PROJECT_PRODUCTION_URL to avoid creating duplicates for preview deployments.
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
import { DEMO_AGENT_CONFIG } from './config';

// Singleton promise to prevent duplicate creation attempts
let demoAgentPromise: Promise<DemoAgentResult> | null = null;

interface DemoAgentResult {
  agentId: string;
  endpoint: string;
  accessKey: string;
  isNew: boolean;
}

/**
 * Ensures the demo agent exists for the production domain.
 * Creates it if it doesn't exist.
 * Uses a singleton pattern to prevent duplicate creation attempts.
 */
export async function ensureDemoAgent(): Promise<DemoAgentResult> {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;
  const url = DEMO_AGENT_CONFIG.URL;
  const name = DEMO_AGENT_CONFIG.NAME;

  // No production domain configured (localhost/dev)
  if (!domain || !url || !name) {
    throw new Error('No production domain configured. Demo agent only available in production.');
  }

  // Return existing promise if already in progress
  if (demoAgentPromise) {
    return demoAgentPromise;
  }

  demoAgentPromise = createDemoAgentIfNeeded(domain, url, name);

  // Clean up promise after completion (success or failure)
  demoAgentPromise.finally(() => {
    demoAgentPromise = null;
  });

  return demoAgentPromise;
}

async function createDemoAgentIfNeeded(
  domain: string,
  url: string,
  name: string
): Promise<DemoAgentResult> {
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

    // Create crawl KB
    const crawlKBName = generateCrawlKBName(url);
    console.log(`  Creating crawl KB: ${crawlKBName}...`);
    const crawlKBResponse = await createKnowledgeBaseSmartCrawl({
      name: crawlKBName,
      seedUrls: [url],
    });
    const crawlKBId = crawlKBResponse.knowledge_base.uuid;
    console.log(`  Crawl KB created: ${crawlKBId}`);

    // Wait for database to be provisioned
    console.log(`  Waiting for database to be ready...`);
    await waitForDatabaseReady(crawlKBId, 120000, 5000);

    const allKBIds = [crawlKBId];

    // Create agent
    console.log(`Creating agent: ${name}...`);
    const agentResponse = await createAgent({
      name,
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
 * Get demo agent info for the production domain without creating it.
 * Returns null if no production domain is configured or no agent exists.
 */
export async function getDemoAgentInfo(): Promise<DemoAgentResult | null> {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;

  // No production domain configured (localhost/dev)
  if (!domain) {
    return null;
  }

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
