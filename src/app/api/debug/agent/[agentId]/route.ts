import { NextRequest, NextResponse } from 'next/server';
import { getAgent, getKnowledgeBaseIds } from '@/lib/digitalocean';

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Agent ID is required' },
        { status: 400 }
      );
    }

    // Fetch agent details
    const agentResponse = await getAgent(agentId);
    const agent = agentResponse.agent;

    // Extract KB IDs using helper
    const kbIds = getKnowledgeBaseIds(agent);

    // Extract relevant info
    const debugInfo = {
      agentId: agent.uuid,
      name: agent.name,
      region: agent.region,
      projectId: agent.project_id,
      endpoint: agent.endpoint,
      retrievalMethod: agent.retrieval_method,
      createdAt: agent.created_at,
      updatedAt: agent.updated_at,
      knowledgeBases: {
        count: kbIds.length,
        ids: kbIds,
        // Include raw KB data if present
        rawKnowledgeBases: (agent as unknown as Record<string, unknown>).knowledge_bases,
        rawKnowledgeBaseIds: (agent as unknown as Record<string, unknown>).knowledge_base_ids,
        rawKnowledgeBaseUuids: (agent as unknown as Record<string, unknown>).knowledge_base_uuids,
      },
      settings: {
        k: agent.k,
        temperature: agent.temperature,
        topP: agent.top_p,
        maxTokens: agent.max_tokens,
      },
      // Full raw response for debugging
      raw: agent,
    };

    return NextResponse.json(debugInfo);
  } catch (error) {
    console.error('Debug agent error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
