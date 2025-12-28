import { NextRequest, NextResponse } from 'next/server';
import {
  createAgent,
  getOrCreateAccessKey,
  getAgent,
  startIndexingJob,
  waitForDatabaseReady,
  normalizeUrl,
  extractDomain,
  generateAgentName,
  generateCrawlKBName,
  findAgentByDomain,
  getDefaultInstruction,
  getKnowledgeBaseIds,
  getOrCreateKnowledgeBase,
  attachKnowledgeBaseToAgent,
  deleteKnowledgeBase,
  estimateSiteSize,
} from '@/lib/digitalocean';
import { CRAWLER_CONFIG } from '@/lib/config';
import type { CreateAgentRequest, CreateAgentApiResponse } from '@/types';

// In-memory lock to prevent duplicate concurrent agent creations for the same domain
// Key: domain, Value: Promise that resolves to the response
const creationLocks = new Map<string, Promise<NextResponse>>();

export async function POST(request: NextRequest) {
  try {
    const body: CreateAgentRequest = await request.json();

    // Validate URL
    if (!body.url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    const normalizedUrl = normalizeUrl(body.url);
    const domain = extractDomain(normalizedUrl);

    // Check for in-progress creation for this domain (prevents race condition duplicates)
    const existingLock = creationLocks.get(domain);
    if (existingLock) {
      console.log(`[Lock] Creation already in progress for ${domain}, waiting...`);
      return existingLock;
    }

    // Create a promise that will be resolved when creation completes
    let resolveLock!: (response: NextResponse) => void;
    let rejectLock!: (error: Error) => void;
    const lockPromise = new Promise<NextResponse>((resolve, reject) => {
      resolveLock = resolve;
      rejectLock = reject;
    });
    creationLocks.set(domain, lockPromise);
    console.log(`[Lock] Acquired lock for ${domain}`);

    try {
      const response = await createAgentInternal(normalizedUrl, domain);
      resolveLock(response);
      return response;
    } catch (error) {
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
      resolveLock(errorResponse);
      return errorResponse;
    } finally {
      creationLocks.delete(domain);
      console.log(`[Lock] Released lock for ${domain}`);
    }
  } catch (error) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Internal function that does the actual agent creation work
async function createAgentInternal(normalizedUrl: string, domain: string): Promise<NextResponse> {
    // Dynamically estimate site size before crawling (console-only warnings)
    const siteSize = await estimateSiteSize(normalizedUrl);
    console.log(`Site size estimate: ${siteSize.estimate} (${siteSize.reason})`);

    if (siteSize.estimate === 'mega' || siteSize.estimate === 'large') {
      const urlPath = new URL(normalizedUrl).pathname;
      const urlCount = siteSize.urlCount?.toLocaleString() || 'many';

      if (urlPath === '/' || urlPath === '') {
        console.warn(`⚠️  COST WARNING: Large site detected (${urlCount} URLs)`);
        console.warn(`   ${siteSize.reason}`);
        console.warn(`   Consider using a specific path like ${normalizedUrl}/docs/`);
      } else {
        console.warn(`ℹ️  Large site crawling specific path: ${urlPath}`);
      }
    }

    // Step 1: Check if agent already exists for this domain
    console.log(`Checking for existing agent for domain: ${domain}...`);
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent) {
      // Return existing agent - get or create access key (reuses existing)
      console.log(`Found existing agent: ${existingAgent.name} (${existingAgent.uuid})`);

      // Get fresh agent details to ensure we have the endpoint
      const agentDetails = await getAgent(existingAgent.uuid);
      const agent = agentDetails.agent;

      // Get or create API key (reuses existing if found)
      const { key: accessKey } = await getOrCreateAccessKey(agent.uuid);

      const kbIds = getKnowledgeBaseIds(agent);
      const response: CreateAgentApiResponse = {
        success: true,
        agentId: agent.uuid,
        agentName: agent.name,
        kbId: kbIds[0] || '',
        kbIds,
        endpoint: agent.endpoint || '',
        accessKey,
        isExisting: true,
        status: 'ready',
        message: `Found existing agent: ${agent.name}`,
      };

      return NextResponse.json({
        ...response,
        url: normalizedUrl,
      });
    }

    // Step 2: Get or create Knowledge Base (prevents duplicates)
    const crawlKBName = generateCrawlKBName(normalizedUrl);
    console.log(`Checking for existing KB: ${crawlKBName}...`);

    // Calculate max pages based on site size to control costs
    const sizeKey = siteSize.estimate as keyof typeof CRAWLER_CONFIG.MAX_PAGES_BY_SIZE;
    const maxPages = CRAWLER_CONFIG.MAX_PAGES_BY_SIZE[sizeKey] || CRAWLER_CONFIG.MAX_PAGES_BY_SIZE.medium;
    console.log(`Using max_pages: ${maxPages} for ${siteSize.estimate} site`);

    const { kb: crawlKB, isExisting: kbExists } = await getOrCreateKnowledgeBase({
      name: crawlKBName,
      seedUrls: [normalizedUrl],
      url: normalizedUrl,
      maxPages,
    });
    const crawlKBId = crawlKB.uuid;

    if (kbExists) {
      console.log(`Using existing KB: ${crawlKBId}`);
    } else {
      console.log(`Created new KB: ${crawlKBId}`);
      // Wait for database to be provisioned (only needed for new KBs)
      console.log(`Waiting for database to be ready...`);
      await waitForDatabaseReady(crawlKBId, 120000, 5000);
    }

    // Note: uploads/structured KBs will be created later when users upload files
    const allKBIds = [crawlKBId];

    // Step 2b: Double-check for existing agent (race condition protection)
    // Another request may have created the agent while we were waiting for KB/database
    console.log(`Re-checking for existing agent before creation...`);
    const raceCheckAgent = await findAgentByDomain(domain);
    if (raceCheckAgent) {
      console.log(`Agent was created by another request: ${raceCheckAgent.uuid}`);
      const agentDetails = await getAgent(raceCheckAgent.uuid);
      const agent = agentDetails.agent;
      const { key: accessKey } = await getOrCreateAccessKey(agent.uuid);

      const kbIds = getKnowledgeBaseIds(agent);
      return NextResponse.json({
        success: true,
        agentId: agent.uuid,
        agentName: agent.name,
        kbId: kbIds[0] || crawlKBId,
        kbIds: kbIds.length > 0 ? kbIds : [crawlKBId],
        endpoint: agent.endpoint || '',
        accessKey,
        isExisting: true,
        status: 'ready',
        message: `Found existing agent: ${agent.name}`,
        url: normalizedUrl,
      });
    }

    // Step 3: Create agent with crawl KB (with rollback on failure to prevent orphan KBs)
    const agentName = generateAgentName(normalizedUrl);
    console.log(`Creating new agent: ${agentName}...`);

    let agentResponse;
    try {
      agentResponse = await createAgent({
        name: agentName,
        knowledgeBaseIds: allKBIds,
        instruction: getDefaultInstruction(domain),
        description: `Customer support agent for ${domain}`,
      });
    } catch (error) {
      // Rollback: delete the KB to prevent orphans (only if we created it)
      if (!kbExists) {
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

    // Note: Agent visibility is set to public by agent-status polling
    // when the agent becomes ACTIVE (can't be set while still deploying)

    // Step 4: Create API key for the agent (this is a new agent, so key will be created)
    const { key: apiKey } = await getOrCreateAccessKey(agent.uuid);

    // Step 5: Start indexing job on crawl KB
    console.log(`Starting indexing job on crawl KB...`);
    await startIndexingJob(crawlKBId);
    console.log(`Indexing started`);

    // Step 6: Wait for agent to initialize before attempting KB attachment
    // DO API may need time before agent accepts KB attachments
    console.log(`Waiting 3 seconds for agent to initialize...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 7: Attempt to attach KB to agent (with built-in retries)
    // Note: This may still fail. Auto-repair will handle it later if needed.
    console.log(`Attempting to attach KB ${crawlKBId} to agent ${agent.uuid}...`);
    try {
      await attachKnowledgeBaseToAgent(agent.uuid, crawlKBId);
      console.log(`KB attached successfully`);
    } catch (attachError) {
      // Log but don't fail - auto-repair will handle it
      console.warn(`KB attachment failed after retries (auto-repair will handle):`,
        attachError instanceof Error ? attachError.message : attachError);
    }

    // Return with KB ID
    const response: CreateAgentApiResponse = {
      success: true,
      agentId: agent.uuid,
      agentName: agent.name,
      kbId: crawlKBId,
      kbIds: allKBIds,
      endpoint: agent.endpoint || '',
      accessKey: apiKey,
      isExisting: false,
      status: 'indexing',
      message: `Agent created, indexing website in progress`,
    };

    return NextResponse.json({
      ...response,
      url: normalizedUrl,
    });
}
