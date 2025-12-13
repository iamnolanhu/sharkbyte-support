import { NextRequest, NextResponse } from 'next/server';
import {
  listAgents,
  listKnowledgeBases,
  getKBTypeFromName,
  extractDomain,
} from '@/lib/digitalocean';
import type { Agent, KnowledgeBase, KnowledgeBaseInfo, AgentWithKBs } from '@/types';

/**
 * GET /api/agents
 * Returns all agents with their associated knowledge bases
 */
export async function GET() {
  try {
    // Fetch agents and KBs in parallel
    const [agents, kbResponse] = await Promise.all([
      listAgents(),
      listKnowledgeBases(),
    ]);

    const kbMap = new Map<string, KnowledgeBase>();
    kbResponse.knowledge_bases.forEach((kb) => kbMap.set(kb.uuid, kb));

    // Map agents to include their KB details
    const agentsWithKBs: AgentWithKBs[] = agents
      .filter((agent) => agent.deployment?.url || agent.endpoint) // Only include agents with endpoints (valid agents)
      .map((agent: Agent) => {
        // Get KB details for this agent
        const knowledgeBases: KnowledgeBaseInfo[] = (agent.knowledge_base_ids || [])
          .map((kbId) => {
            const kb = kbMap.get(kbId);
            if (!kb) return null;

            const kbType = getKBTypeFromName(kb.name);
            return {
              uuid: kb.uuid,
              name: kb.name,
              type: kbType === 'unknown' ? 'custom' : kbType,
              status: kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_COMPLETED'
                ? 'indexed'
                : kb.last_indexing_job?.status === 'INDEX_JOB_STATUS_FAILED'
                ? 'error'
                : kb.last_indexing_job
                ? 'indexing'
                : 'creating',
              documentCount: kb.document_count,
              createdAt: kb.created_at,
            } as KnowledgeBaseInfo;
          })
          .filter((kb): kb is KnowledgeBaseInfo => kb !== null);

        // Extract domain from agent name (pattern: "Sammy - domain.com")
        const domainMatch = agent.name.match(/Sammy - (.+)/);
        const domain = domainMatch ? domainMatch[1] : extractDomain(agent.name);

        const agentEndpoint = agent.deployment?.url || agent.endpoint || '';

        return {
          uuid: agent.uuid,
          name: agent.name,
          domain,
          endpoint: agentEndpoint,
          status: !agentEndpoint
            ? 'creating'
            : knowledgeBases.some((kb) => kb.status === 'indexing')
            ? 'creating'
            : knowledgeBases.some((kb) => kb.status === 'error')
            ? 'error'
            : 'active',
          knowledgeBases,
          createdAt: agent.created_at,
        } as AgentWithKBs;
      });

    return NextResponse.json({
      success: true,
      agents: agentsWithKBs,
    });
  } catch (error) {
    console.error('Error listing agents:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
