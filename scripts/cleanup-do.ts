/**
 * Cleanup script for DigitalOcean resources
 * Deletes orphan agents and knowledge bases
 *
 * Run with: npx tsx scripts/cleanup-do.ts
 */

import 'dotenv/config';

const DO_API_BASE = 'https://api.digitalocean.com/v2';
const DO_API_TOKEN = process.env.DO_API_TOKEN;

if (!DO_API_TOKEN) {
  console.error('Error: DO_API_TOKEN environment variable is required');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${DO_API_TOKEN}`,
  'Content-Type': 'application/json',
};

interface Agent {
  uuid: string;
  name: string;
  endpoint?: string;
  knowledge_base_ids: string[];
}

interface KnowledgeBase {
  uuid: string;
  name: string;
  status: string;
}

async function listAgents(): Promise<Agent[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list agents: ${response.statusText}`);
  }
  const data = await response.json();
  return data.agents || [];
}

async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list KBs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.knowledge_bases || [];
}

async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete agent ${agentId}: ${response.statusText}`);
  }
}

async function deleteKnowledgeBase(kbId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases/${kbId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete KB ${kbId}: ${response.statusText}`);
  }
}

async function main() {
  console.log('🔍 Fetching resources from DigitalOcean...\n');

  const [agents, kbs] = await Promise.all([listAgents(), listKnowledgeBases()]);

  console.log(`Found ${agents.length} agents:`);
  agents.forEach((a) => console.log(`  - ${a.name} (${a.uuid}) - ${a.endpoint ? 'has endpoint' : 'NO ENDPOINT'}`));

  console.log(`\nFound ${kbs.length} knowledge bases:`);
  kbs.forEach((kb) => console.log(`  - ${kb.name} (${kb.uuid}) - ${kb.status}`));

  // Build set of KB IDs that are attached to agents
  const attachedKBIds = new Set<string>();
  for (const agent of agents) {
    for (const kbId of agent.knowledge_base_ids || []) {
      attachedKBIds.add(kbId);
    }
  }

  // Find orphan KBs (not attached to any agent)
  const orphanKBs = kbs.filter((kb) => !attachedKBIds.has(kb.uuid));

  // Find agents without endpoints (broken/incomplete)
  const brokenAgents = agents.filter((a) => !a.endpoint);

  console.log('\n--- CLEANUP PLAN ---');
  console.log(`\nOrphan KBs to delete (${orphanKBs.length}):`);
  orphanKBs.forEach((kb) => console.log(`  - ${kb.name} (${kb.uuid})`));

  console.log(`\nBroken agents to delete (${brokenAgents.length}):`);
  brokenAgents.forEach((a) => console.log(`  - ${a.name} (${a.uuid})`));

  if (orphanKBs.length === 0 && brokenAgents.length === 0) {
    console.log('\n✅ Nothing to clean up!');
    return;
  }

  // Prompt for confirmation
  console.log('\n⚠️  This will permanently delete the resources listed above.');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('🗑️  Deleting orphan KBs...');
  for (const kb of orphanKBs) {
    try {
      await deleteKnowledgeBase(kb.uuid);
      console.log(`  ✓ Deleted KB: ${kb.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to delete KB ${kb.name}:`, error);
    }
  }

  console.log('\n🗑️  Deleting broken agents...');
  for (const agent of brokenAgents) {
    try {
      await deleteAgent(agent.uuid);
      console.log(`  ✓ Deleted agent: ${agent.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to delete agent ${agent.name}:`, error);
    }
  }

  console.log('\n✅ Cleanup complete!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
