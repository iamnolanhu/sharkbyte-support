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
    // Check if agent already exists (no endpoint required - agent may still be deploying)
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent) {
      console.log(`Demo agent exists: ${existingAgent.uuid} (endpoint: ${existingAgent.endpoint || 'deploying...'})`);

      // Try to set agent public if it has an endpoint
      if (existingAgent.endpoint) {
        try {
          await updateAgentVisibility(existingAgent.uuid, 'VISIBILITY_PUBLIC');
          console.log(`  ✓ Agent set to public`);
        } catch (err) {
          console.log(`  Note: Could not set public (will retry during status polling)`);
        }
      }

      // Get or create API key (reuses existing if found)
      const { key: accessKey } = await getOrCreateAccessKey(existingAgent.uuid);

      return {
        agentId: existingAgent.uuid,
        endpoint: existingAgent.endpoint || '', // May be empty if still deploying
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

    // Wait for database to be provisioned (only if we created a new KB)
    if (!kbWasExisting) {
      console.log(`  Waiting for database to be ready...`);
      await waitForDatabaseReady(crawlKBId, 120000, 5000);
    }

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

    // Wait for agent to initialize before KB attachment
    // (DO API may need time before agent accepts KB attachments)
    console.log(`  Waiting for agent to initialize...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Attach KB explicitly (DO API ignores knowledge_base_ids in create request)
    console.log(`  Attaching KB ${crawlKBId} to agent...`);
    try {
      await attachKnowledgeBaseToAgent(agent.uuid, crawlKBId);
      console.log(`  ✓ KB attached successfully`);
    } catch (attachError) {
      console.warn(`  KB attachment failed (auto-repair will handle):`,
        attachError instanceof Error ? attachError.message : attachError);
    }

    // Create API key (this is a new agent, so key will be created)
    const { key: apiKey } = await getOrCreateAccessKey(agent.uuid);

    // Start indexing
    console.log(`Starting indexing job on crawl KB...`);
    await startIndexingJob(crawlKBId);

    // Wait for agent deployment before setting visibility
    // (DO API requires endpoint to exist before visibility can be set)
    console.log(`  Waiting for agent deployment...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Attempt to set visibility (may fail if still deploying - status polling will retry)
    try {
      await updateAgentVisibility(agent.uuid, 'VISIBILITY_PUBLIC');
      console.log(`  ✓ Agent set to public`);
    } catch (err) {
      console.log(`  Note: Could not set public yet (status polling will retry)`);
    }

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
