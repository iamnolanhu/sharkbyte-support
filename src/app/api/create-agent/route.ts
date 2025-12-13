import { NextRequest, NextResponse } from 'next/server';
import {
  createKnowledgeBaseSmartCrawl,
  createAgent,
  createAccessKey,
  getAgent,
  startIndexingJob,
  waitForDatabaseReady,
  waitForIndexing,
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

      // Create a new access key for this session
      const accessKeyResponse = await createAccessKey(agent.uuid);

      const response: CreateAgentApiResponse = {
        success: true,
        agentId: agent.uuid,
        agentName: agent.name,
        kbId: agent.knowledge_base_ids[0] || '',
        endpoint: agent.endpoint || '',
        accessKey: accessKeyResponse.access_key.key,
        isExisting: true,
        status: 'ready',
        message: `Found existing agent: ${agent.name}`,
      };

      return NextResponse.json({
        ...response,
        url: normalizedUrl,
      });
    }

    // Step 2: Create new Knowledge Base for crawled data
    const kbName = generateCrawlKBName(normalizedUrl);
    console.log(`Creating new Knowledge Base: ${kbName}...`);

    const kbResponse = await createKnowledgeBaseSmartCrawl({
      name: kbName,
      seedUrls: [normalizedUrl],
    });
    const kbId = kbResponse.knowledge_base.uuid;
    console.log(`Knowledge Base created: ${kbId}`);

    // Step 3: Wait for database to be provisioned
    console.log(`Waiting for database to be ready...`);
    await waitForDatabaseReady(kbId, 120000, 5000);

    // Step 4: Start indexing job
    console.log(`Starting indexing job...`);
    await startIndexingJob(kbId);

    // Step 5: Wait for indexing to complete
    console.log(`Waiting for indexing to complete...`);
    await waitForIndexing(kbId, 180000, 3000); // 3 min timeout for indexing
    console.log(`Indexing completed`);

    // Step 6: Create new agent with the KB
    const agentName = generateAgentName(normalizedUrl);
    console.log(`Creating new agent: ${agentName}...`);

    const agentResponse = await createAgent({
      name: agentName,
      knowledgeBaseIds: [kbId],
      instruction: getDefaultInstruction(domain),
      description: `Customer support agent for ${domain}`,
    });
    const agent = agentResponse.agent;
    console.log(`Agent created: ${agent.uuid}`);

    // Step 7: Create access key for the new agent
    console.log(`Creating access key...`);
    const accessKeyResponse = await createAccessKey(agent.uuid);
    console.log(`Access key created`);

    const response: CreateAgentApiResponse = {
      success: true,
      agentId: agent.uuid,
      agentName: agent.name,
      kbId,
      endpoint: agent.endpoint || '',
      accessKey: accessKeyResponse.access_key.key,
      isExisting: false,
      status: 'ready',
      message: `Created new agent: ${agent.name}`,
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
