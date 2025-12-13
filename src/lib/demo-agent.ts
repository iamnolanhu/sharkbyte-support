/**
 * Demo Agent Auto-Creation
 *
 * Ensures the demo agent for sharkbyte-demo.vercel.app exists on startup.
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

let demoAgentPromise: Promise<DemoAgentResult> | null = null;

interface DemoAgentResult {
  agentId: string;
  endpoint: string;
  accessKey: string;
  isNew: boolean;
}

/**
 * Ensures the demo agent exists. Creates it if it doesn't.
 * Uses a singleton pattern to prevent duplicate creation attempts.
 */
export async function ensureDemoAgent(): Promise<DemoAgentResult> {
  // Return existing promise if already in progress
  if (demoAgentPromise) {
    return demoAgentPromise;
  }

  demoAgentPromise = createDemoAgentIfNeeded();
  return demoAgentPromise;
}

async function createDemoAgentIfNeeded(): Promise<DemoAgentResult> {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;

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

    const normalizedUrl = DEMO_AGENT_CONFIG.URL;

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
    const agentName = DEMO_AGENT_CONFIG.NAME;
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
    // Reset the promise so it can be retried
    demoAgentPromise = null;
    throw error;
  }
}

/**
 * Get demo agent info without creating it
 */
export async function getDemoAgentInfo(): Promise<DemoAgentResult | null> {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;

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
