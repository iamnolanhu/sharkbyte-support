import { NextResponse } from 'next/server';
import { ensureDemoAgent, getDemoAgentInfo } from '@/lib/demo-agent';
import { DEMO_AGENT_CONFIG } from '@/lib/config';

/**
 * GET /api/demo-agent
 * Returns the demo agent info for the production domain.
 * Returns null if no production domain is configured or no agent exists.
 */
export async function GET() {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;

  // No production domain configured (localhost/dev)
  if (!domain) {
    return NextResponse.json({
      success: true,
      agent: null,
      message: 'No production domain configured',
    });
  }

  try {
    const existingAgent = await getDemoAgentInfo();

    if (existingAgent) {
      return NextResponse.json({
        success: true,
        agent: {
          id: existingAgent.agentId,
          name: DEMO_AGENT_CONFIG.NAME,
          domain,
          endpoint: existingAgent.endpoint,
          accessKey: existingAgent.accessKey,
        },
        isNew: false,
      });
    }

    // Agent doesn't exist yet
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
 * Creates the demo agent for the production domain if it doesn't exist.
 * Only works when a production domain is configured.
 */
export async function POST() {
  const domain = DEMO_AGENT_CONFIG.DOMAIN;

  // No production domain configured
  if (!domain) {
    return NextResponse.json(
      {
        success: false,
        error: 'No production domain configured. Demo agent creation only available in production.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await ensureDemoAgent();

    return NextResponse.json({
      success: true,
      agent: {
        id: result.agentId,
        name: DEMO_AGENT_CONFIG.NAME,
        domain,
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
