#!/usr/bin/env npx tsx
/**
 * Deployment Initialization Script
 *
 * This script runs during the build phase (prebuild) to:
 * 1. Discover or create the DigitalOcean project
 * 2. Discover or create the demo agent
 * 3. Log environment variables for manual setup
 *
 * Usage:
 *   npx tsx scripts/init-deployment.ts
 *   npm run prebuild
 *
 * Required env:
 *   DO_API_TOKEN - DigitalOcean API token
 *
 * Optional env:
 *   NEXT_PUBLIC_DEMO_AGENT_ENDPOINT - Skip init if already set
 *   APP_DOMAIN - Custom domain (fallback: VERCEL_PROJECT_PRODUCTION_URL)
 */

import { getProjectId } from '../src/lib/digitalocean';
import { ensureDemoAgent, getDeploymentDomain } from '../src/lib/demo-agent';

async function initializeDeployment() {
  console.log('\n🦈 SharkByte Support - Deployment Initialization\n');
  console.log('='.repeat(50));

  // Check if already fully configured
  if (process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT && process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY) {
    console.log('✓ Demo agent already configured via environment variables');
    console.log(`  Endpoint: ${process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT}`);
    console.log('  Access Key: [set]');
    console.log('\nSkipping initialization.\n');
    return;
  }

  // Check for required DO_API_TOKEN
  if (!process.env.DO_API_TOKEN) {
    console.error('❌ DO_API_TOKEN environment variable is required');
    console.log('\nPlease set DO_API_TOKEN in your Vercel project settings.\n');
    process.exit(1);
  }

  try {
    // Step 1: Discover/create project
    console.log('\n[1/3] Discovering DigitalOcean project...');
    const projectId = await getProjectId();
    console.log(`  ✓ Project ID: ${projectId}`);

    // Step 2: Get domain
    console.log('\n[2/3] Detecting deployment domain...');
    const domain = getDeploymentDomain();
    console.log(`  ✓ Domain: ${domain}`);

    // Step 3: Create demo agent
    console.log('\n[3/3] Creating demo agent...');
    console.log('  This may take 1-2 minutes for database provisioning...\n');

    const demoAgent = await ensureDemoAgent(domain);

    if (demoAgent.isNew) {
      console.log(`  ✓ Demo agent created: ${demoAgent.agentId}`);
    } else {
      console.log(`  ✓ Demo agent found: ${demoAgent.agentId}`);
    }
    console.log(`  ✓ Endpoint: ${demoAgent.endpoint}`);

    // Log environment variables for manual setup
    console.log('\n' + '='.repeat(50));
    console.log('\n📋 Add these to your Vercel Environment Variables:\n');
    console.log('  (Settings → Environment Variables → Add)\n');
    console.log(`  DO_PROJECT_ID=${projectId}`);
    console.log(`  NEXT_PUBLIC_DEMO_AGENT_ENDPOINT=${demoAgent.endpoint}`);
    console.log(`  NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY=${demoAgent.accessKey}`);
    console.log('\n' + '='.repeat(50));
    console.log('\n✅ Initialization complete!');
    console.log('\nNote: The demo widget will work without these vars via runtime fallback,');
    console.log('but adding them will make the widget load faster.\n');

  } catch (error) {
    console.error('\n❌ Initialization failed:', error);
    console.log('\nThe demo widget will attempt runtime initialization as fallback.');
    console.log('If issues persist, check your DO_API_TOKEN and try again.\n');
    // Don't exit with error - let build continue, runtime fallback will handle it
  }
}

// Run initialization
initializeDeployment().catch((error) => {
  console.error('Unhandled error:', error);
  // Don't fail the build
});
