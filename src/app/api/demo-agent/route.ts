import { NextRequest, NextResponse } from 'next/server';
import { ensureDemoAgent, getDemoAgentInfo } from '@/lib/demo-agent';

/**
 * Extract domain from request Host header
 */
function getDomainFromRequest(request: NextRequest): string {
  const host = request.headers.get('host');
  if (!host) {
    return 'localhost:3000';
  }
  // Remove port for standard ports
  if (host.endsWith(':80') || host.endsWith(':443')) {
    return host.split(':')[0];
  }
  return host;
}

/**
 * GET /api/demo-agent
 * Returns the demo agent info for the current domain (creates it if it doesn't exist)
 */
export async function GET(request: NextRequest) {
  const domain = getDomainFromRequest(request);

  try {
    // First try to get existing demo agent for this domain
    const existingAgent = await getDemoAgentInfo(domain);

    if (existingAgent) {
      return NextResponse.json({
        success: true,
        agent: {
          id: existingAgent.agentId,
          name: `Sammy - ${domain}`,
          domain,
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
 * Creates the demo agent for the current domain if it doesn't exist
 */
export async function POST(request: NextRequest) {
  const domain = getDomainFromRequest(request);

  try {
    const result = await ensureDemoAgent(domain);

    return NextResponse.json({
      success: true,
      agent: {
        id: result.agentId,
        name: `Sammy - ${domain}`,
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
