/**
 * Demo Agent Auto-Creation
 *
 * Ensures the demo agent exists for the deployment domain.
 * Supports runtime domain detection with fallback chain.
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
  deleteKnowledgeBase,
} from './digitalocean';
import { APP_DOMAIN } from './config';

// Cache for demo agent results per domain
const demoAgentCache = new Map<string, Promise<DemoAgentResult>>();

export interface DemoAgentResult {
  agentId: string;
  endpoint: string;
  accessKey: string;
  isNew: boolean;
}

/**
 * Get the deployment domain with fallback chain:
 * 1. Explicit domain parameter
 * 2. APP_DOMAIN env var
 * 3. VERCEL_PROJECT_PRODUCTION_URL (Vercel auto-set)
 * 4. Default fallback
 */
export function getDeploymentDomain(explicitDomain?: string): string {
  return explicitDomain
    || APP_DOMAIN
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || 'sharkbyte-support.vercel.app';
}

/**
 * Ensures the demo agent exists for the given domain. Creates it if it doesn't.
 * Uses a singleton pattern per domain to prevent duplicate creation attempts.
 *
 * @param domain - Optional domain override. Uses getDeploymentDomain() fallback if not provided.
 */
export async function ensureDemoAgent(domain?: string): Promise<DemoAgentResult> {
  const resolvedDomain = getDeploymentDomain(domain);

  // Return existing promise if already in progress for this domain
  const existing = demoAgentCache.get(resolvedDomain);
  if (existing) {
    return existing;
  }

  const promise = createDemoAgentIfNeeded(resolvedDomain);
  demoAgentCache.set(resolvedDomain, promise);

  // On failure, clear cache so it can be retried
  promise.catch(() => {
    demoAgentCache.delete(resolvedDomain);
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

    const normalizedUrl = `https://${domain}`;

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

    // Create agent (with KB rollback on failure to prevent orphans)
    const agentName = `Sammy - ${domain}`;
    console.log(`Creating agent: ${agentName}...`);

    let agentResponse;
    try {
      agentResponse = await createAgent({
        name: agentName,
        knowledgeBaseIds: allKBIds,
        instruction: getDefaultInstruction(domain),
        description: `Demo customer support agent for ${domain}`,
      });
    } catch (error) {
      // Rollback: delete the KB to prevent orphans
      console.log(`Agent creation failed, cleaning up KB: ${crawlKBId}...`);
      try {
        await deleteKnowledgeBase(crawlKBId);
        console.log(`  ✓ KB cleaned up`);
      } catch (cleanupError) {
        console.error(`  Failed to cleanup KB:`, cleanupError);
      }
      throw error;
    }
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
 * Get demo agent info without creating it.
 * @param domain - Optional domain override. Uses getDeploymentDomain() fallback if not provided.
 */
export async function getDemoAgentInfo(domain?: string): Promise<DemoAgentResult | null> {
  const resolvedDomain = getDeploymentDomain(domain);

  try {
    const existingAgent = await findAgentByDomain(resolvedDomain);

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
