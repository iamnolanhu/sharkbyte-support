import { NextRequest, NextResponse } from 'next/server';
import { repairAgentKBs } from '@/lib/digitalocean';

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/**
 * POST /api/agents/[agentId]/repair
 * Repair KB attachments by finding orphaned KBs that match the agent's domain
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { agentId } = await context.params;

    const results = await repairAgentKBs(agentId);

    return NextResponse.json({
      success: true,
      message: results.attached.length > 0
        ? `Attached ${results.attached.length} KB(s): ${results.attached.join(', ')}`
        : 'No KBs needed to be attached',
      ...results,
    });
  } catch (error) {
    console.error('Error repairing agent KBs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
