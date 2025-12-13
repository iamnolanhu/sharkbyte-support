import { NextRequest, NextResponse } from 'next/server';
import {
  getAgent,
  getKnowledgeBase,
  updateAgent,
  deleteAgentWithKBs,
  createAccessKey,
  getKBTypeFromName,
  extractDomain,
} from '@/lib/digitalocean';
import type { KnowledgeBaseInfo, AgentWithKBs } from '@/types';

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/**
 * GET /api/agents/[agentId]
 * Returns agent details with all associated knowledge bases
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    const agentResponse = await getAgent(agentId);
    const agent = agentResponse.agent;

    // Fetch all KB details
    const knowledgeBases: KnowledgeBaseInfo[] = [];
    for (const kbId of agent.knowledge_base_ids || []) {
      try {
        const kbResponse = await getKnowledgeBase(kbId);
        const kb = kbResponse.knowledge_base;
        const kbType = getKBTypeFromName(kb.name);

        knowledgeBases.push({
          uuid: kb.uuid,
          name: kb.name,
          type: kbType === 'unknown' ? 'custom' : kbType,
          status:
            kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_COMPLETED'
              ? 'indexed'
              : kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_FAILED'
              ? 'error'
              : kb.last_indexing_job
              ? 'indexing'
              : 'creating',
          documentCount: kb.document_count,
          createdAt: kb.created_at,
        });
      } catch (error) {
        console.error(`Failed to fetch KB ${kbId}:`, error);
      }
    }

    // Extract domain from agent name
    const domainMatch = agent.name.match(/Sammy - (.+)/);
    const domain = domainMatch ? domainMatch[1] : extractDomain(agent.name);

    const agentWithKBs: AgentWithKBs = {
      uuid: agent.uuid,
      name: agent.name,
      domain,
      endpoint: agent.deployment?.url || agent.endpoint || '',
      status: !(agent.deployment?.url || agent.endpoint)
        ? 'creating'
        : knowledgeBases.some((kb) => kb.status === 'indexing')
        ? 'creating'
        : knowledgeBases.some((kb) => kb.status === 'error')
        ? 'error'
        : 'active',
      knowledgeBases,
      createdAt: agent.created_at,
    };

    return NextResponse.json({
      success: true,
      agent: agentWithKBs,
      instruction: agent.instruction,
    });
  } catch (error) {
    console.error('Error getting agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agents/[agentId]
 * Update agent properties (instruction, name)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;
    const body = await request.json();

    const updates: { instruction?: string; name?: string; description?: string } = {};

    if (body.instruction !== undefined) {
      updates.instruction = body.instruction;
    }
    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.description !== undefined) {
      updates.description = body.description;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No updates provided' },
        { status: 400 }
      );
    }

    const response = await updateAgent(agentId, updates);

    return NextResponse.json({
      success: true,
      agent: response.agent,
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[agentId]
 * Delete agent and all its associated knowledge bases
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    await deleteAgentWithKBs(agentId);

    return NextResponse.json({
      success: true,
      message: 'Agent and associated knowledge bases deleted',
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents/[agentId]
 * Create a new API key for the agent
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    const keyResponse = await createAccessKey(agentId);

    // Get the key from the new response format (api_key_info.secret_key)
    const accessKey = keyResponse.api_key_info?.secret_key ||
                     keyResponse.access_key?.key ||
                     keyResponse.access_key?.api_key || '';

    return NextResponse.json({
      success: true,
      accessKey,
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
