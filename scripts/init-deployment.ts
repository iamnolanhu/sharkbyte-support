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
 * Print environment variable if it's missing from process.env
 * Returns the formatted line or empty string if already set
 */
function formatMissingVar(
  envName: string,
  value: string,
  comment?: string
): string {
  // Skip if already set in environment
  if (process.env[envName]) return '';

  const c = colors;
  const commentPart = comment ? `  ${c.dim}${comment}${c.reset}` : '';
  return `   ${c.yellow}${envName}${c.reset}=${c.green}${value}${c.reset}${commentPart}`;
}

/**
 * Print the environment variable summary block with SharkByte branding
 * Only shows vars that are MISSING from the environment
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

  const c = colors;

  // Build list of missing required vars
  const missingRequired = [
    formatMissingVar('DO_API_TOKEN', '<your-token>', '# <https://cloud.digitalocean.com/account/api>'),
  ].filter(Boolean);

  // Build list of missing optimization vars
  const missingOptimization = [
    formatMissingVar('DO_PROJECT_ID', projectId),
    formatMissingVar('DO_DATABASE_ID', databaseId || '<auto-provisioned>', '# <https://cloud.digitalocean.com/gen-ai/knowledge-bases>'),
    formatMissingVar('DO_MODEL_ACCESS_KEY_ID', modelAccessKeyId || '<auto-created>', '# <https://cloud.digitalocean.com/gen-ai/model-access-keys>'),
    formatMissingVar('NEXT_PUBLIC_DEMO_AGENT_ENDPOINT', demoEndpoint || '<pending>'),
    formatMissingVar('NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY', demoAccessKey || '<pending>'),
  ].filter(Boolean);

  // If nothing is missing, just show success
  if (missingRequired.length === 0 && missingOptimization.length === 0) {
    console.log('\n✅ All environment variables are configured. Build optimized!\n');
    return;
  }

  console.log(SHARKBYTE_BANNER);

  console.log(`
   ${c.blue}${c.bold}📋 MISSING ENVIRONMENT VARIABLES:${c.reset}
   ${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);

  // Print missing required vars
  if (missingRequired.length > 0) {
    console.log(`   ${c.dim}# Required${c.reset}`);
    missingRequired.forEach(line => console.log(line));
    console.log('');
  }

  // Print missing optimization vars
  if (missingOptimization.length > 0) {
    console.log(`   ${c.dim}# Speed Optimizations (Add to Vercel → Settings → Environment Variables)${c.reset}`);
    missingOptimization.forEach(line => console.log(line));
    console.log('');
  }

  console.log(`   ${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
   ${c.blue}🌊 Add these to Vercel and this block will disappear! 🦈${c.reset}
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
