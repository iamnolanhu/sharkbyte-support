import { NextRequest, NextResponse } from 'next/server';
import {
  createKnowledgeBase,
  createAgent,
  createAccessKey,
  generateResourceName,
  normalizeUrl,
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
    const resourceName = generateResourceName(normalizedUrl);

    // Step 1: Create Knowledge Base with web crawl
    console.log(`Creating Knowledge Base for ${normalizedUrl}...`);
    const kbResponse = await createKnowledgeBase({
      name: `${resourceName}-kb`,
      seedUrls: [normalizedUrl],
      maxPages: body.maxPages || 100,
    });

    const kbId = kbResponse.knowledge_base.id;
    console.log(`Knowledge Base created: ${kbId}`);

    // Step 2: Create Agent connected to KB
    console.log(`Creating Agent...`);
    const agentResponse = await createAgent({
      name: `${resourceName}-agent`,
      knowledgeBaseId: kbId,
    });

    const agentId = agentResponse.agent.id;
    const endpoint = agentResponse.agent.endpoint;
    console.log(`Agent created: ${agentId}`);

    // Step 3: Create Access Key for the agent
    console.log(`Creating Access Key...`);
    const keyResponse = await createAccessKey(agentId);
    const accessKey = keyResponse.access_key.key;
    console.log(`Access Key created`);

    const response: CreateAgentApiResponse = {
      success: true,
      agentId,
      kbId,
      status: 'indexing',
      message: 'Agent created successfully. Knowledge base is indexing.',
    };

    // Return all necessary info for the client to store
    return NextResponse.json({
      ...response,
      endpoint,
      accessKey,
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
