import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeBase, getAgent } from '@/lib/digitalocean';
import type { AgentStatusResponse } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const kbId = searchParams.get('kbId');

    if (!agentId || !kbId) {
      return NextResponse.json(
        { error: 'agentId and kbId are required' },
        { status: 400 }
      );
    }

    // Check Knowledge Base status
    const kbResponse = await getKnowledgeBase(kbId);
    const kbStatus = kbResponse.knowledge_base.status;

    // Check Agent status
    const agentResponse = await getAgent(agentId);
    const agentStatus = agentResponse.agent.status;

    // Determine overall status
    let status: AgentStatusResponse['status'];

    if (kbStatus === 'error' || agentStatus === 'error') {
      status = 'error';
    } else if (kbStatus === 'indexing') {
      status = 'indexing';
    } else if (kbStatus === 'indexed' && agentStatus === 'active') {
      status = 'ready';
    } else {
      status = 'creating';
    }

    const response: AgentStatusResponse = {
      status,
      kbStatus,
      agentStatus,
      endpoint: agentResponse.agent.endpoint,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking agent status:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
