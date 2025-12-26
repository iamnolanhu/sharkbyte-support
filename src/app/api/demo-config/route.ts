/**
 * Demo Config API Endpoint
 *
 * Returns the demo agent configuration for the chat widget.
 * Uses lazy initialization as fallback if NEXT_PUBLIC env vars aren't set.
 *
 * GET /api/demo-config
 * Returns: { endpoint: string, accessKey: string }
 */

import { NextResponse } from 'next/server';
import { ensureDemoAgent, getDeploymentDomain } from '@/lib/demo-agent';

export async function GET() {
  // Fast path: env vars are set
  if (process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT && process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY) {
    return NextResponse.json({
      endpoint: process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT,
      accessKey: process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY,
      source: 'env',
    });
  }

  // Fallback: lazy initialization
  try {
    const domain = getDeploymentDomain();
    console.log(`[demo-config] Lazy init for domain: ${domain}`);

    const demoAgent = await ensureDemoAgent(domain);

    return NextResponse.json({
      endpoint: demoAgent.endpoint,
      accessKey: demoAgent.accessKey,
      source: 'lazy-init',
    });
  } catch (error) {
    console.error('[demo-config] Failed to initialize demo agent:', error);

    return NextResponse.json(
      {
        error: 'Demo agent initialization failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
