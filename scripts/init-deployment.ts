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

import {
  getProjectId,
  getCachedDatabaseId,
  getCachedModelAccessKeyId,
  getOrCreateModelAccessKey,
  getDatabaseId,
} from '../src/lib/digitalocean';
import { ensureDemoAgent, getDeploymentDomain } from '../src/lib/demo-agent';

// ANSI color codes for ocean-themed console output
const colors = {
  cyan: '\x1b[36m',      // Headers, borders
  blue: '\x1b[34m',      // Section titles
  yellow: '\x1b[33m',    // Env var names
  green: '\x1b[32m',     // Values
  dim: '\x1b[2m',        // Comments
  bold: '\x1b[1m',       // Emphasis
  reset: '\x1b[0m',      // Reset
};

// SharkByte-themed ASCII banner for env setup
const SHARKBYTE_BANNER = `${colors.cyan}

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
${colors.reset}`;

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

  const c = colors; // shorthand

  // Format access key display - if empty (existing key, not retrievable), show helpful message
  const accessKeyDisplay = demoAccessKey || '<retrieve-from-local-storage-or-regenerate>';

  console.log(`
   ${c.blue}${c.bold}📋 SAVE THESE TO YOUR .env FILE AND VERCEL:${c.reset}
   ${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}

   ${c.dim}# Required${c.reset}
   ${c.yellow}DO_API_TOKEN${c.reset}=${c.dim}<your-token>${c.reset}  ${c.dim}# <https://cloud.digitalocean.com/account/api>${c.reset}

   ${c.dim}# Speed Optimizations (Add to Vercel → Settings → Environment Variables)${c.reset}
   ${c.yellow}DO_PROJECT_ID${c.reset}=${c.green}${projectId}${c.reset}
   ${c.yellow}DO_DATABASE_ID${c.reset}=${c.green}${databaseId || '<auto-provisioned>'}${c.reset}  ${c.dim}# <https://cloud.digitalocean.com/gen-ai/knowledge-bases>${c.reset}
   ${c.yellow}DO_MODEL_ACCESS_KEY_ID${c.reset}=${c.green}${modelAccessKeyId || '<auto-created>'}${c.reset}  ${c.dim}# <https://cloud.digitalocean.com/gen-ai/model-access-keys>${c.reset}
   ${c.yellow}NEXT_PUBLIC_DEMO_AGENT_ENDPOINT${c.reset}=${c.green}${demoEndpoint}${c.reset}
   ${c.yellow}NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY${c.reset}=${c.green}${accessKeyDisplay}${c.reset}

   ${c.dim}# Optional - Domain Config${c.reset}
   ${c.yellow}APP_DOMAIN${c.reset}=${c.green}${domain}${c.reset}

   ${c.dim}# Optional - Model Config (defaults shown)${c.reset}
   ${c.yellow}DO_REGION${c.reset}=${c.green}tor1${c.reset}
   ${c.yellow}DO_EMBEDDING_MODEL_UUID${c.reset}=${c.green}22653204-79ed-11ef-bf8f-4e013e2ddde4${c.reset}
   ${c.yellow}DO_LLM_MODEL_UUID${c.reset}=${c.green}18bc9b8f-73c5-11f0-b074-4e013e2ddde4${c.reset}

   ${c.dim}# Optional - Firecrawl (SPA fallback for JS-rendered sites)${c.reset}
   ${c.yellow}FIRECRAWL_API_KEY${c.reset}=${c.dim}<optional>${c.reset}  ${c.dim}# <https://firecrawl.dev>${c.reset}

   ${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
   ${c.blue}🌊 Once all required vars are set, this block will disappear! 🦈${c.reset}
   ${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);
}

async function initializeDeployment() {
  const c = colors;
  console.log(`\n${c.cyan}${c.bold}🦈 SharkByte Support - Deployment Initialization${c.reset}\n`);
  console.log(`${c.cyan}${'━'.repeat(50)}${c.reset}`);

  // Check if already fully configured
  if (process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT && process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY) {
    console.log(`${c.green}✓ Demo agent already configured via environment variables${c.reset}`);
    console.log(`  ${c.dim}Endpoint:${c.reset} ${c.green}${process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT}${c.reset}`);
    console.log(`  ${c.dim}Access Key:${c.reset} ${c.green}[set]${c.reset}`);
    console.log(`\n${c.green}🦈 Skipping initialization.${c.reset}\n`);
    return;
  }

  // Check for required DO_API_TOKEN
  if (!process.env.DO_API_TOKEN) {
    console.error(`${c.bold}\x1b[31m❌ DO_API_TOKEN environment variable is required${c.reset}`);
    console.log(`\n${c.yellow}Please set DO_API_TOKEN in your Vercel project settings.${c.reset}\n`);
    process.exit(1);
  }

  try {
    // Step 1: Discover/create project
    console.log(`\n${c.blue}[1/3]${c.reset} Discovering DigitalOcean project...`);
    const projectId = await getProjectId();
    console.log(`  ${c.green}✓ Project ID:${c.reset} ${projectId}`);

    // Step 2: Get domain
    console.log(`\n${c.blue}[2/3]${c.reset} Detecting deployment domain...`);
    const domain = getDeploymentDomain();
    console.log(`  ${c.green}✓ Domain:${c.reset} ${domain}`);

    // Step 3: Create demo agent
    console.log(`\n${c.blue}[3/3]${c.reset} Creating demo agent...`);
    console.log(`  ${c.dim}This may take 1-2 minutes for database provisioning...${c.reset}\n`);

    const demoAgent = await ensureDemoAgent(domain);

    if (demoAgent.isNew) {
      console.log(`  ${c.green}✓ Demo agent created:${c.reset} ${demoAgent.agentId}`);
    } else {
      console.log(`  ${c.green}✓ Demo agent found:${c.reset} ${demoAgent.agentId}`);
    }
    console.log(`  ${c.green}✓ Endpoint:${c.reset} ${demoAgent.endpoint || `${c.dim}(deploying...)${c.reset}`}`);

    // Discover resources for env summary (especially important on redeploy)
    // These functions check cache first, then discover from existing resources
    if (!demoAgent.isNew) {
      console.log(`  ${c.dim}Discovering existing resources for env summary...${c.reset}`);
      await getOrCreateModelAccessKey(); // Discovers model access key ID
      await getDatabaseId(); // Discovers database ID from KBs
    }

    // Get IDs for summary (now populated from discovery)
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

    console.log(`${c.green}${c.bold}🦈 Initialization complete!${c.reset}\n`);

  } catch (error) {
    console.error(`\n${c.bold}\x1b[31m❌ Initialization failed:${c.reset}`, error);
    console.log(`\n${c.yellow}The demo widget will attempt runtime initialization as fallback.${c.reset}`);
    console.log(`${c.dim}If issues persist, check your DO_API_TOKEN and try again.${c.reset}\n`);
    // Don't exit with error - let build continue, runtime fallback will handle it
  }
}

// Run initialization
initializeDeployment().catch((error) => {
  console.error('Unhandled error:', error);
  // Don't fail the build
});
