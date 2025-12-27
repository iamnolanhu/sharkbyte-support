/**
 * Demo Agent Auto-Creation
 *
 * Ensures the demo agent exists for the deployment domain.
 * Supports runtime domain detection with fallback chain.
 */

import {
  findAgentByDomain,
  createAgent,
  getOrCreateAccessKey,
  startIndexingJob,
  waitForDatabaseReady,
  getDefaultInstruction,
  generateCrawlKBName,
  deleteKnowledgeBase,
  getOrCreateKnowledgeBase,
  updateAgentVisibility,
  attachKnowledgeBaseToAgent,
  getAgent,
} from './digitalocean';
import { APP_DOMAIN } from './config';

// Cache for demo agent results per domain
const demoAgentCache = new Map<string, Promise<DemoAgentResult>>();

/**
 * Wait for agent endpoint to be provisioned by DigitalOcean.
 * Returns the endpoint URL when ready, or empty string on timeout.
 */
async function waitForEndpoint(agentId: string, timeoutMs = 180000): Promise<string> {
  const pollInterval = 10000; // 10 seconds
  const startTime = Date.now();
  let attempts = 0;

  console.log(`  Waiting for agent endpoint (up to ${timeoutMs / 60000} minutes)...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const agentInfo = await getAgent(agentId);
      const endpoint = agentInfo.agent.deployment?.url || agentInfo.agent.endpoint;

      if (endpoint) {
        console.log(`  ✓ Agent endpoint ready: ${endpoint}`);
        return endpoint;
      }

      attempts++;
      if (attempts % 3 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Still waiting for endpoint (${elapsed}s elapsed)...`);
      }
    } catch {
      // Ignore errors - will retry
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.log(`  ⚠ Endpoint not ready after ${timeoutMs / 60000} minutes (may still be deploying)`);
  return '';
}

/**
 * Set agent visibility to public. Waits for endpoint to be ready first.
 * Returns the endpoint URL.
 */
async function setVisibilityAndGetEndpoint(agentId: string): Promise<string> {
  // Wait for endpoint
  const endpoint = await waitForEndpoint(agentId);

  if (endpoint) {
    try {
      await updateAgentVisibility(agentId, 'VISIBILITY_PUBLIC');
      console.log(`  ✓ Agent set to public`);
    } catch {
      console.log(`  Note: Could not set public (status polling will retry)`);
    }
  }

  return endpoint;
}

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
    // Check if agent already exists (no endpoint required - agent may still be deploying)
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent) {
      console.log(`Demo agent exists: ${existingAgent.uuid} (endpoint: ${existingAgent.endpoint || 'deploying...'})`);

      // Get or create API key (reuses existing if secret in env, regenerates if not)
      const { key: accessKey } = await getOrCreateAccessKey(existingAgent.uuid);

      // If endpoint is not ready yet, wait for it
      let endpoint = existingAgent.endpoint || '';
      if (!endpoint) {
        console.log(`  Waiting for existing agent endpoint...`);
        endpoint = await setVisibilityAndGetEndpoint(existingAgent.uuid);
      } else {
        // Try to set agent public if it has an endpoint
        try {
          await updateAgentVisibility(existingAgent.uuid, 'VISIBILITY_PUBLIC');
          console.log(`  ✓ Agent set to public`);
        } catch {
          console.log(`  Note: Could not set public (will retry during status polling)`);
        }
      }

      return {
        agentId: existingAgent.uuid,
        endpoint,
        accessKey,
        isNew: false,
      };
    }

    // Create new demo agent with crawl KB
    console.log(`Creating demo agent for ${domain}...`);

    const normalizedUrl = `https://${domain}`;

    // Get or create crawl KB (prevents duplicates)
    const crawlKBName = generateCrawlKBName(normalizedUrl);
    console.log(`  Checking/creating crawl KB: ${crawlKBName}...`);
    const { kb: crawlKB, isExisting: kbWasExisting } = await getOrCreateKnowledgeBase({
      name: crawlKBName,
      seedUrls: [normalizedUrl],
      url: normalizedUrl,
    });
    const crawlKBId = crawlKB.uuid;
    console.log(`  ${kbWasExisting ? 'Found existing' : 'Created new'} crawl KB: ${crawlKBId}`);

    // Note: We'll wait for DB after agent creation (allows visibility setting to start early)

    // RACE CONDITION CHECK: Re-check for existing agent before creation
    // Another request may have created the agent while we were waiting for KB/database
    console.log(`  Re-checking for existing agent before creation...`);
    const raceCheckAgent = await findAgentByDomain(domain);
    if (raceCheckAgent) {
      console.log(`  Agent was created by another request: ${raceCheckAgent.uuid}`);
      // Clean up the KB if we just created it and it's not needed
      if (!kbWasExisting) {
        console.log(`  Cleaning up unused KB: ${crawlKBId}...`);
        try {
          await deleteKnowledgeBase(crawlKBId);
          console.log(`  ✓ Unused KB cleaned up`);
        } catch (cleanupErr) {
          console.warn(`  Could not cleanup unused KB:`, cleanupErr);
        }
      }
      // Return the existing agent (endpoint may be empty if still deploying)
      const { key: accessKey } = await getOrCreateAccessKey(raceCheckAgent.uuid);
      return {
        agentId: raceCheckAgent.uuid,
        endpoint: raceCheckAgent.endpoint || '',
        accessKey,
        isNew: false,
      };
    }

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
      // Rollback: delete the KB to prevent orphans (only if we created it)
      if (!kbWasExisting) {
        console.log(`Agent creation failed, cleaning up KB: ${crawlKBId}...`);
        try {
          await deleteKnowledgeBase(crawlKBId);
          console.log(`  ✓ KB cleaned up`);
        } catch (cleanupError) {
          console.error(`  Failed to cleanup KB:`, cleanupError);
        }
      }
      throw error;
    }
    const agent = agentResponse.agent;
    console.log(`Agent created: ${agent.uuid}`);

    // STEP 1: Create API key immediately (doesn't need DB)
    console.log(`  Creating access key...`);
    const { key: apiKey } = await getOrCreateAccessKey(agent.uuid);
    console.log(`  ✓ Access key created`);

    // STEP 2: Wait for database to be ready (light ping - no scary errors)
    // This is the "proper" way to wait - checks KB's database_id field
    if (!kbWasExisting) {
      console.log(`  Waiting for database to provision (up to 10 minutes)...`);
      try {
        await waitForDatabaseReady(crawlKBId); // Uses new defaults: 10 min, 30s intervals
      } catch {
        console.log(`  Note: Database may still be provisioning (will continue anyway)`);
      }
    } else {
      console.log(`  Database already provisioned (existing KB)`);
    }

    // STEP 3: Attach KB (should succeed now that DB is ready)
    console.log(`  Attaching KB to agent...`);
    try {
      await attachKnowledgeBaseToAgent(agent.uuid, crawlKBId);
    } catch (attachError) {
      console.warn(`  KB attachment failed (auto-repair will handle):`,
        attachError instanceof Error ? attachError.message : attachError);
    }

    // STEP 4: Start indexing
    console.log(`  Starting indexing job...`);
    await startIndexingJob(crawlKBId);
    console.log(`  ✓ Indexing started`);

    // STEP 5: Wait for endpoint to be ready and set visibility to public
    // This ensures the env summary shows the actual endpoint URL
    const endpoint = await setVisibilityAndGetEndpoint(agent.uuid);

    console.log(`Demo agent created successfully`);

    return {
      agentId: agent.uuid,
      endpoint,
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

    if (existingAgent) {
      const { key: accessKey } = await getOrCreateAccessKey(existingAgent.uuid);

      return {
        agentId: existingAgent.uuid,
        endpoint: existingAgent.endpoint || '', // May be empty if still deploying
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
