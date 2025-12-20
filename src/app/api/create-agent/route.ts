import { NextRequest, NextResponse } from 'next/server';
import {
  createAgent,
  createAccessKey,
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
  updateAgentVisibility,
} from '@/lib/digitalocean';
import type { CreateAgentRequest, CreateAgentApiResponse } from '@/types';

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

    // Step 1: Check if agent already exists for this domain
    console.log(`Checking for existing agent for domain: ${domain}...`);
    const existingAgent = await findAgentByDomain(domain);

    if (existingAgent) {
      // Return existing agent - create a new access key for this session
      console.log(`Found existing agent: ${existingAgent.name} (${existingAgent.uuid})`);

      // Get fresh agent details to ensure we have the endpoint
      const agentDetails = await getAgent(existingAgent.uuid);
      const agent = agentDetails.agent;

      // Create a new API key for this session
      const keyResponse = await createAccessKey(agent.uuid);
      const accessKey = keyResponse.api_key_info?.secret_key ||
                       keyResponse.access_key?.key ||
                       keyResponse.access_key?.api_key || '';

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

    const { kb: crawlKB, isExisting: kbExists } = await getOrCreateKnowledgeBase({
      name: crawlKBName,
      seedUrls: [normalizedUrl],
      url: normalizedUrl,
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

    // Step 3: Create agent with crawl KB
    const agentName = generateAgentName(normalizedUrl);
    console.log(`Creating new agent: ${agentName}...`);

    const agentResponse = await createAgent({
      name: agentName,
      knowledgeBaseIds: allKBIds,
      instruction: getDefaultInstruction(domain),
      description: `Customer support agent for ${domain}`,
    });
    const agent = agentResponse.agent;
    console.log(`Agent created: ${agent.uuid}`);

    // Step 3b: Set agent to public so widget works without authentication
    console.log(`Setting agent to public...`);
    try {
      await updateAgentVisibility(agent.uuid, 'VISIBILITY_PUBLIC');
      console.log(`Agent set to public`);
    } catch (visibilityError) {
      console.warn(`Failed to set agent to public (can be done manually):`,
        visibilityError instanceof Error ? visibilityError.message : visibilityError);
    }

    // Step 4: Create API key for the agent
    console.log(`Creating API key...`);
    const apiKeyResponse = await createAccessKey(agent.uuid);
    const apiKey = apiKeyResponse.api_key_info?.secret_key ||
                  apiKeyResponse.access_key?.key ||
                  apiKeyResponse.access_key?.api_key || '';
    console.log(`API key created`);

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
