import { NextResponse } from 'next/server';
import { ensureDemoAgent, getDemoAgentInfo } from '@/lib/demo-agent';
import { DEMO_AGENT_CONFIG } from '@/lib/config';

/**
 * GET /api/demo-agent
 * Returns the demo agent info (creates it if it doesn't exist)
 */
export async function GET() {
  try {
    // First try to get existing demo agent
    const existingAgent = await getDemoAgentInfo();

    if (existingAgent) {
      return NextResponse.json({
        success: true,
        agent: {
          id: existingAgent.agentId,
          name: DEMO_AGENT_CONFIG.NAME,
          domain: DEMO_AGENT_CONFIG.DOMAIN,
          endpoint: existingAgent.endpoint,
          accessKey: existingAgent.accessKey,
        },
        isNew: false,
      });
    }

    // Agent doesn't exist, return null (frontend can decide to create it)
    return NextResponse.json({
      success: true,
      agent: null,
      isNew: false,
    });
  } catch (error) {
    console.error('Error getting demo agent:', error);
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
 * POST /api/demo-agent
 * Creates the demo agent if it doesn't exist
 */
export async function POST() {
  try {
    const result = await ensureDemoAgent();

    return NextResponse.json({
      success: true,
      agent: {
        id: result.agentId,
        name: DEMO_AGENT_CONFIG.NAME,
        domain: DEMO_AGENT_CONFIG.DOMAIN,
        endpoint: result.endpoint,
        accessKey: result.accessKey,
      },
      isNew: result.isNew,
    });
  } catch (error) {
    console.error('Error creating demo agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
