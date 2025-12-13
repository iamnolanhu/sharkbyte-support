import { NextRequest, NextResponse } from 'next/server';
import {
  createKnowledgeBaseSmartCrawl,
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

      const response: CreateAgentApiResponse = {
        success: true,
        agentId: agent.uuid,
        agentName: agent.name,
        kbId: agent.knowledge_base_ids[0] || '',
        kbIds: agent.knowledge_base_ids || [],
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

    // Step 2: Create 3 Knowledge Bases
    console.log(`Creating Knowledge Bases for ${domain}...`);

    // 2a: Create crawl KB (with web crawler)
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
    console.log(`Indexing started - returning early for frontend polling`);

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
