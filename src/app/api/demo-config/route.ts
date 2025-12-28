/**
 * Demo Config API Endpoint
 *
 * Returns the demo agent configuration for the chat widget.
 * Uses a tiered fallback strategy:
 * 1. Fast: NEXT_PUBLIC env vars (baked into client bundle)
 * 2. Fast: .demo-config.json file (written during prebuild)
 * 3. Slow: Lazy initialization via ensureDemoAgent() (may timeout)
 *
 * GET /api/demo-config
 * Returns: { endpoint: string, accessKey: string, source: string }
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ensureDemoAgent, getDeploymentDomain } from '@/lib/demo-agent';

export async function GET() {
  // Fast path 1: env vars are set (baked into build)
  if (process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT && process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY) {
    return NextResponse.json({
      endpoint: process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT,
      accessKey: process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY,
      source: 'env',
    });
  }

  // Fast path 2: config file from prebuild (instant read, no API calls)
  const configPath = join(process.cwd(), '.demo-config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.endpoint && config.accessKey) {
        console.log(`[demo-config] Loaded from file for domain: ${config.domain}`);
        return NextResponse.json({
          endpoint: config.endpoint,
          accessKey: config.accessKey,
          source: 'file',
        });
      }
    } catch (err) {
      console.warn('[demo-config] Failed to read config file:', err);
    }
  }

  // Slow fallback: lazy initialization (may timeout on serverless)
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
