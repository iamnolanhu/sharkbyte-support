#!/usr/bin/env npx tsx
/**
 * Deployment Initialization Script
 *
 * This script runs during the build phase (prebuild) to:
 * 1. Discover or create the DigitalOcean project
 * 2. Discover or create the demo agent
 * 3. Display environment variable summary for setup
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

// Load environment variables from .env files (for local development)
import 'dotenv/config';

import { getProjectId, getCachedDatabaseId, getCachedModelAccessKeyId } from '../src/lib/digitalocean';
import { ensureDemoAgent, getDeploymentDomain } from '../src/lib/demo-agent';

// SharkByte-themed ASCII banner for env setup
const SHARKBYTE_BANNER = `

   🦈 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🦈
   ┃                                                                              ┃
   ┃   ███████╗██╗  ██╗ █████╗ ██████╗ ██╗  ██╗██████╗ ██╗   ██╗████████╗███████╗ ┃
   ┃   ██╔════╝██║  ██║██╔══██╗██╔══██╗██║ ██╔╝██╔══██╗╚██╗ ██╔╝╚══██╔══╝██╔════╝ ┃
   ┃   ███████╗███████║███████║██████╔╝█████╔╝ ██████╔╝ ╚████╔╝    ██║   █████╗   ┃
   ┃   ╚════██║██╔══██║██╔══██║██╔══██╗██╔═██╗ ██╔══██╗  ╚██╔╝     ██║   ██╔══╝   ┃
   ┃   ███████║██║  ██║██║  ██║██║  ██║██║  ██╗██████╔╝   ██║      ██║   ███████╗ ┃
   ┃   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝    ╚═╝      ╚═╝   ╚══════╝ ┃
   ┃                                                                              ┃
   ┃                     🌊 ENVIRONMENT SETUP GUIDE 🌊                           ┃
   ┃                                                                              ┃
   🦈 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🦈
`;

/**
 * Check if all recommended environment variables are set
 */
function areAllEnvVarsSet(): boolean {
  const recommendedVars = [
    'DO_API_TOKEN',
    'DO_PROJECT_ID',
    'DO_DATABASE_ID',
    'NEXT_PUBLIC_DEMO_AGENT_ENDPOINT',
    'NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY',
  ];

  return recommendedVars.every(v => !!process.env[v]);
}

/**
 * Print the environment variable summary block with SharkByte branding
 */
function printEnvSummary(
  projectId: string,
  databaseId: string | undefined,
  modelAccessKeyId: string | undefined,
  demoEndpoint: string,
  demoAccessKey: string
) {
  // If all vars are already set, show success and skip the block
  if (areAllEnvVarsSet()) {
    console.log('\n✅ All environment variables are configured. Build optimized!\n');
    return;
  }

  console.log(SHARKBYTE_BANNER);

  const domain = process.env.APP_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || '<auto-detected>';

  console.log(`
   📋 SAVE THESE TO YOUR .env FILE AND VERCEL:
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   # Required (you should already have this)
   DO_API_TOKEN=<your-token>

   # Speed Optimizations (Add to Vercel → Settings → Environment Variables)
   DO_PROJECT_ID=${projectId}
   DO_DATABASE_ID=${databaseId || '<auto-created-on-first-kb>'}
   DO_MODEL_ACCESS_KEY_ID=${modelAccessKeyId || '<auto-created>'}
   NEXT_PUBLIC_DEMO_AGENT_ENDPOINT=${demoEndpoint}
   NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY=${demoAccessKey}

   # Optional - Domain Config
   APP_DOMAIN=${domain}

   # Optional - Model Config (defaults shown)
   DO_REGION=tor1
   DO_EMBEDDING_MODEL_UUID=22653204-79ed-11ef-bf8f-4e013e2ddde4
   DO_LLM_MODEL_UUID=18bc9b8f-73c5-11f0-b074-4e013e2ddde4

   # Optional - Firecrawl (SPA fallback for JS-rendered sites)
   FIRECRAWL_API_KEY=<optional>

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🌊 Once all required vars are set, this block will disappear! 🦈
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

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

    // Get additional IDs for summary
    const databaseId = getCachedDatabaseId();
    const modelAccessKeyId = getCachedModelAccessKeyId();

    // Print the environment variable summary block
    printEnvSummary(
      projectId,
      databaseId,
      modelAccessKeyId,
      demoAgent.endpoint,
      demoAgent.accessKey
    );

    console.log('✅ Initialization complete!\n');

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
