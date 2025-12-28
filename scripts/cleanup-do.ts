/**
 * Enhanced Cleanup Script for DigitalOcean Resources
 *
 * Deletes ALL resources in a DO account:
 * - Agents and their access keys
 * - Knowledge Bases
 * - Model access keys
 * - Workspaces (after agents are deleted)
 * - Vector database
 *
 * Features:
 * - Interactive mode (default): Select what to keep
 * - Preservation flags: --keep-db, --keep-demo, --keep-workspaces, --keep-model-keys
 * - Control flags: --dry-run, --force, --orphans-only, --token
 *
 * Run with: npx tsx scripts/cleanup-do.ts [flags]
 *
 * Examples:
 *   npm run cleanup                           # Interactive mode
 *   npm run cleanup -- --keep-db --keep-demo  # Keep database and demo agent
 *   npm run cleanup -- --dry-run              # Preview without deleting
 *   npm run cleanup -- --force                # Delete everything, no prompts
 *   npm run cleanup -- --orphans-only         # Original conservative behavior
 *   npm run cleanup -- --token dop_v1_xxx     # Use different DO account
 */

import 'dotenv/config';
import * as readline from 'readline';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);

const hasFlag = (flag: string): boolean => args.includes(flag);

const getFlagValue = (flag: string): string | null => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
};

// ============================================================================
// Configuration
// ============================================================================

const DO_API_BASE = 'https://api.digitalocean.com/v2';
const DO_API_TOKEN = getFlagValue('--token') || process.env.DO_API_TOKEN;
const APP_DOMAIN = process.env.APP_DOMAIN || 'sharkbyte-support.vercel.app';

if (!DO_API_TOKEN) {
  console.error('Error: DO_API_TOKEN required. Set env var or use --token flag');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${DO_API_TOKEN}`,
  'Content-Type': 'application/json',
};

interface CleanupOptions {
  keepDb: boolean;
  keepDemo: boolean;
  keepWorkspaces: boolean;
  keepModelKeys: boolean;
  keepProject: boolean;
  keepAgentPattern: string | null;
  keepKbPattern: string | null;
  dryRun: boolean;
  force: boolean;
  orphansOnly: boolean;
}

// ============================================================================
// Types
// ============================================================================

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

interface AccessKey {
  id: string;
  name: string;
  created_at: string;
}

interface Database {
  id: string;
  name: string;
  engine: string;
  status: string;
  region: string;
}

interface Workspace {
  uuid: string;
  name: string;
  description?: string;
  created_at: string;
}

interface ModelAccessKey {
  uuid: string;
  name: string;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
}

// ============================================================================
// API Functions
// ============================================================================

async function listAgents(): Promise<Agent[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents`, { headers });
  if (!response.ok) throw new Error(`Failed to list agents: ${response.statusText}`);
  const data = await response.json();
  return data.agents || [];
}

async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/knowledge_bases`, { headers });
  if (!response.ok) throw new Error(`Failed to list KBs: ${response.statusText}`);
  const data = await response.json();
  return data.knowledge_bases || [];
}

async function listAccessKeys(agentId: string): Promise<AccessKey[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}/access_keys`, { headers });
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Failed to list access keys: ${response.statusText}`);
  }
  const data = await response.json();
  return data.access_keys || [];
}

async function listDatabases(): Promise<Database[]> {
  const response = await fetch(`${DO_API_BASE}/databases`, { headers });
  if (!response.ok) throw new Error(`Failed to list databases: ${response.statusText}`);
  const data = await response.json();
  return data.databases || [];
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

async function deleteAccessKey(agentId: string, keyId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/agents/${agentId}/access_keys/${keyId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete access key ${keyId}: ${response.statusText}`);
  }
}

async function deleteDatabase(dbId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/databases/${dbId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete database ${dbId}: ${response.statusText}`);
  }
}

async function listWorkspaces(): Promise<Workspace[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/workspaces`, { headers });
  if (!response.ok) throw new Error(`Failed to list workspaces: ${response.statusText}`);
  const data = await response.json();
  return data.workspaces || [];
}

async function deleteWorkspace(workspaceId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/workspaces/${workspaceId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete workspace ${workspaceId}: ${response.statusText}`);
  }
}

async function listModelAccessKeys(): Promise<ModelAccessKey[]> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/models/api_keys`, { headers });
  if (!response.ok) throw new Error(`Failed to list model access keys: ${response.statusText}`);
  const data = await response.json();
  return data.api_key_infos || [];
}

async function deleteModelAccessKey(keyId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/gen-ai/models/api_keys/${keyId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete model access key ${keyId}: ${response.statusText}`);
  }
}

async function listProjects(): Promise<Project[]> {
  const response = await fetch(`${DO_API_BASE}/projects`, { headers });
  if (!response.ok) throw new Error(`Failed to list projects: ${response.statusText}`);
  const data = await response.json();
  return data.projects || [];
}

async function deleteProject_fn(projectId: string): Promise<void> {
  const response = await fetch(`${DO_API_BASE}/projects/${projectId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete project ${projectId}: ${response.statusText}`);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function matchesPattern(name: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexPattern}$`, 'i').test(name);
}

function getDemoAgentName(): string {
  return `Sammy - ${APP_DOMAIN}`;
}

// ============================================================================
// Interactive Mode
// ============================================================================

async function interactiveMode(
  agents: Agent[],
  _kbs: KnowledgeBase[],
  databases: Database[],
  workspaces: Workspace[],
  modelAccessKeys: ModelAccessKey[],
  sharkbyteProject: Project | undefined
): Promise<CleanupOptions> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  const demoAgent = agents.find((a) => a.name === getDemoAgentName());
  const hasDatabase = databases.length > 0;
  const hasWorkspaces = workspaces.length > 0;
  const hasModelKeys = modelAccessKeys.length > 0;
  const hasProject = !!sharkbyteProject;

  console.log('\n\x1b[36m\x1b[1mWhat would you like to keep?\x1b[0m\n');

  const options: { key: string; label: string; default: boolean; applicable: boolean }[] = [
    {
      key: 'db',
      label: `Database${hasDatabase ? ` (${databases[0].name} - $20/mo to re-provision)` : ' (none found)'}`,
      default: false,
      applicable: hasDatabase,
    },
    {
      key: 'demo',
      label: `Demo agent${demoAgent ? ` (${demoAgent.name})` : ' (none found)'}`,
      default: false,
      applicable: !!demoAgent,
    },
    {
      key: 'workspaces',
      label: `Workspaces${hasWorkspaces ? ` (${workspaces.length} found)` : ' (none found)'}`,
      default: false,
      applicable: hasWorkspaces,
    },
    {
      key: 'modelkeys',
      label: `Model access keys${hasModelKeys ? ` (${modelAccessKeys.length} found)` : ' (none found)'}`,
      default: false,
      applicable: hasModelKeys,
    },
    {
      key: 'project',
      label: `Project${hasProject ? ` (${sharkbyteProject.name})` : ' (none found)'}`,
      default: false,
      applicable: hasProject,
    },
    { key: 'pattern', label: 'Custom agent pattern', default: false, applicable: true },
  ];

  const selected: Set<string> = new Set();
  let customPattern: string | null = null;

  // Display options
  options.forEach((opt, idx) => {
    const status = opt.applicable ? (selected.has(opt.key) ? '[x]' : '[ ]') : '[N/A]';
    console.log(`  ${idx + 1}. ${status} ${opt.label}`);
  });

  console.log('\n\x1b[33mEnter numbers to toggle (e.g., "1 2"), or press Enter to continue:\x1b[0m');

  const input = await question('> ');
  rl.close();

  // Parse selections
  const selections = input.trim().split(/\s+/).filter(Boolean);
  for (const sel of selections) {
    const idx = parseInt(sel, 10) - 1;
    if (idx >= 0 && idx < options.length && options[idx].applicable) {
      const key = options[idx].key;
      if (selected.has(key)) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
    }
  }

  // Handle custom pattern
  if (selected.has('pattern')) {
    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const patternQuestion = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl2.question(prompt, resolve));
    console.log('\n\x1b[33mEnter agent name pattern to keep (supports * and ? wildcards):\x1b[0m');
    customPattern = await patternQuestion('> ');
    rl2.close();
  }

  return {
    keepDb: selected.has('db'),
    keepDemo: selected.has('demo'),
    keepWorkspaces: selected.has('workspaces'),
    keepModelKeys: selected.has('modelkeys'),
    keepProject: selected.has('project'),
    keepAgentPattern: customPattern,
    keepKbPattern: null,
    dryRun: false,
    force: false,
    orphansOnly: false,
  };
}

// ============================================================================
// Main Cleanup Logic
// ============================================================================

async function main() {
  console.log('\n\x1b[36m\x1b[1m' + '='.repeat(50) + '\x1b[0m');
  console.log('\x1b[36m\x1b[1m    SharkByte Support Cleanup\x1b[0m');
  console.log('\x1b[36m\x1b[1m' + '='.repeat(50) + '\x1b[0m\n');

  // Parse CLI options
  let options: CleanupOptions = {
    keepDb: hasFlag('--keep-db'),
    keepDemo: hasFlag('--keep-demo'),
    keepWorkspaces: hasFlag('--keep-workspaces'),
    keepModelKeys: hasFlag('--keep-model-keys'),
    keepProject: hasFlag('--keep-project'),
    keepAgentPattern: getFlagValue('--keep-agent'),
    keepKbPattern: getFlagValue('--keep-kb'),
    dryRun: hasFlag('--dry-run'),
    force: hasFlag('--force'),
    orphansOnly: hasFlag('--orphans-only'),
  };

  // Show help
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`Usage: npx tsx scripts/cleanup-do.ts [options]

Options:
  --token <token>        Use a different DO API token (overrides env var)
  --keep-db              Preserve the vector database
  --keep-demo            Keep the demo agent and its KBs
  --keep-workspaces      Preserve all workspaces
  --keep-model-keys      Preserve model access keys
  --keep-project         Preserve the SharkByte Support project
  --keep-agent <pattern> Keep agents matching pattern (supports * and ?)
  --keep-kb <pattern>    Keep KBs matching pattern (supports * and ?)
  --dry-run              Preview what would be deleted
  --force                Skip interactive mode and confirmation
  --orphans-only         Only delete orphan KBs and broken agents
  --help, -h             Show this help message

Examples:
  npm run cleanup                           # Interactive mode
  npm run cleanup -- --keep-db --keep-demo  # Keep database and demo
  npm run cleanup -- --dry-run              # Preview only
  npm run cleanup -- --token dop_v1_xxx     # Use different account
  npm run cleanup -- --force                # Delete everything
`);
    return;
  }

  // Fetch all resources
  console.log('\x1b[34mFetching resources from DigitalOcean...\x1b[0m\n');

  const [agents, kbs, databases, workspaces, modelAccessKeys, projects] = await Promise.all([
    listAgents(),
    listKnowledgeBases(),
    listDatabases(),
    listWorkspaces(),
    listModelAccessKeys(),
    listProjects(),
  ]);

  // Find project database (vector DB for KBs) - match genai-* pattern
  const projectDb = databases.find(
    (db) =>
      db.name.startsWith('genai-') ||
      db.name.includes('vector') ||
      db.name.includes('kb')
  );

  // Find the SharkByte Support project
  const sharkbyteProject = projects.find((p) => p.name === 'SharkByte Support');

  // Count access keys per agent
  let totalAccessKeys = 0;
  const accessKeysByAgent: Map<string, AccessKey[]> = new Map();
  for (const agent of agents) {
    const keys = await listAccessKeys(agent.uuid);
    accessKeysByAgent.set(agent.uuid, keys);
    totalAccessKeys += keys.length;
  }

  // Display found resources
  console.log('\x1b[32m\x1b[1mResources Found:\x1b[0m');
  console.log(`   ${agents.length} agent${agents.length !== 1 ? 's' : ''}`);
  agents.forEach((a) =>
    console.log(`      - ${a.name} ${a.endpoint ? '' : '\x1b[31m(no endpoint)\x1b[0m'}`)
  );
  console.log(`   ${kbs.length} knowledge base${kbs.length !== 1 ? 's' : ''}`);
  kbs.forEach((kb) => console.log(`      - ${kb.name} (${kb.status})`));
  console.log(`   ${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`);
  workspaces.forEach((ws) => console.log(`      - ${ws.name}`));
  console.log(`   ${modelAccessKeys.length} model access key${modelAccessKeys.length !== 1 ? 's' : ''}`);
  modelAccessKeys.forEach((key) => console.log(`      - ${key.name}`));
  console.log(`   ${projectDb ? `1 database (${projectDb.name})` : '0 databases'}`);
  console.log(`   ${sharkbyteProject ? `1 project (${sharkbyteProject.name})` : '0 SharkByte Support projects'}`);
  console.log(`   ${totalAccessKeys} agent access key${totalAccessKeys !== 1 ? 's' : ''}`);

  // Interactive mode if no flags provided
  const hasAnyFlag =
    options.keepDb ||
    options.keepDemo ||
    options.keepWorkspaces ||
    options.keepModelKeys ||
    options.keepProject ||
    options.keepAgentPattern ||
    options.keepKbPattern ||
    options.dryRun ||
    options.force ||
    options.orphansOnly;

  if (!hasAnyFlag) {
    options = await interactiveMode(agents, kbs, databases, workspaces, modelAccessKeys, sharkbyteProject);
  }

  // Build preservation sets
  const preservedAgentIds = new Set<string>();
  const preservedKBIds = new Set<string>();

  // Keep demo agent and its KBs
  if (options.keepDemo) {
    const demoAgent = agents.find((a) => a.name === getDemoAgentName());
    if (demoAgent) {
      preservedAgentIds.add(demoAgent.uuid);
      demoAgent.knowledge_base_ids?.forEach((id) => preservedKBIds.add(id));
      console.log(`\n\x1b[32m  Keeping demo agent: ${demoAgent.name}\x1b[0m`);
    }
  }

  // Keep agents matching pattern
  if (options.keepAgentPattern) {
    for (const agent of agents) {
      if (matchesPattern(agent.name, options.keepAgentPattern)) {
        preservedAgentIds.add(agent.uuid);
        agent.knowledge_base_ids?.forEach((id) => preservedKBIds.add(id));
        console.log(`\n\x1b[32m  Keeping agent (pattern match): ${agent.name}\x1b[0m`);
      }
    }
  }

  // Keep KBs matching pattern
  if (options.keepKbPattern) {
    for (const kb of kbs) {
      if (matchesPattern(kb.name, options.keepKbPattern)) {
        preservedKBIds.add(kb.uuid);
        console.log(`\n\x1b[32m  Keeping KB (pattern match): ${kb.name}\x1b[0m`);
      }
    }
  }

  // Original orphans-only behavior
  let agentsToDelete: Agent[];
  let kbsToDelete: KnowledgeBase[];

  if (options.orphansOnly) {
    // Build set of KB IDs attached to agents
    const attachedKBIds = new Set<string>();
    for (const agent of agents) {
      for (const kbId of agent.knowledge_base_ids || []) {
        attachedKBIds.add(kbId);
      }
    }
    // Only delete orphan KBs and broken agents
    kbsToDelete = kbs.filter((kb) => !attachedKBIds.has(kb.uuid) && !preservedKBIds.has(kb.uuid));
    agentsToDelete = agents.filter((a) => !a.endpoint && !preservedAgentIds.has(a.uuid));
  } else {
    // Full cleanup - delete everything except preserved
    agentsToDelete = agents.filter((a) => !preservedAgentIds.has(a.uuid));
    kbsToDelete = kbs.filter((kb) => !preservedKBIds.has(kb.uuid));
  }

  // Count access keys to delete
  let accessKeysToDelete = 0;
  for (const agent of agentsToDelete) {
    accessKeysToDelete += accessKeysByAgent.get(agent.uuid)?.length || 0;
  }

  // Determine what else to delete
  const deleteDb = !options.keepDb && projectDb;
  const workspacesToDelete = options.keepWorkspaces ? [] : workspaces;
  const modelKeysToDelete = options.keepModelKeys ? [] : modelAccessKeys;
  const deleteProject = !options.keepProject && sharkbyteProject;

  // Show cleanup plan
  console.log('\n\x1b[33m\x1b[1m--- CLEANUP PLAN ---\x1b[0m');

  if (agentsToDelete.length > 0) {
    console.log(`\n\x1b[31mAgents to delete (${agentsToDelete.length}):\x1b[0m`);
    agentsToDelete.forEach((a) => console.log(`   - ${a.name}`));
  } else {
    console.log('\n\x1b[32mNo agents to delete\x1b[0m');
  }

  if (kbsToDelete.length > 0) {
    console.log(`\n\x1b[31mKnowledge Bases to delete (${kbsToDelete.length}):\x1b[0m`);
    kbsToDelete.forEach((kb) => console.log(`   - ${kb.name}`));
  } else {
    console.log('\n\x1b[32mNo KBs to delete\x1b[0m');
  }

  if (accessKeysToDelete > 0) {
    console.log(`\n\x1b[31mAgent access keys to delete: ${accessKeysToDelete}\x1b[0m`);
  }

  if (modelKeysToDelete.length > 0) {
    console.log(`\n\x1b[31mModel access keys to delete (${modelKeysToDelete.length}):\x1b[0m`);
    modelKeysToDelete.forEach((key) => console.log(`   - ${key.name}`));
  } else if (options.keepModelKeys && modelAccessKeys.length > 0) {
    console.log(`\n\x1b[32mKeeping ${modelAccessKeys.length} model access key${modelAccessKeys.length !== 1 ? 's' : ''}\x1b[0m`);
  }

  if (workspacesToDelete.length > 0) {
    console.log(`\n\x1b[31mWorkspaces to delete (${workspacesToDelete.length}):\x1b[0m`);
    workspacesToDelete.forEach((ws) => console.log(`   - ${ws.name}`));
  } else if (options.keepWorkspaces && workspaces.length > 0) {
    console.log(`\n\x1b[32mKeeping ${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}\x1b[0m`);
  }

  if (deleteDb) {
    console.log(`\n\x1b[31mDatabase to delete: ${projectDb.name}\x1b[0m`);
  } else if (options.keepDb && projectDb) {
    console.log(`\n\x1b[32mKeeping database: ${projectDb.name}\x1b[0m`);
  }

  if (deleteProject) {
    console.log(`\n\x1b[31mProject to delete: ${sharkbyteProject.name}\x1b[0m`);
  } else if (options.keepProject && sharkbyteProject) {
    console.log(`\n\x1b[32mKeeping project: ${sharkbyteProject.name}\x1b[0m`);
  }

  // Check if nothing to do
  const nothingToDo =
    agentsToDelete.length === 0 &&
    kbsToDelete.length === 0 &&
    modelKeysToDelete.length === 0 &&
    workspacesToDelete.length === 0 &&
    !deleteDb &&
    !deleteProject;

  if (nothingToDo) {
    console.log('\n\x1b[32m\x1b[1mNothing to clean up!\x1b[0m\n');
    return;
  }

  // Dry run - exit before deletion
  if (options.dryRun) {
    console.log('\n\x1b[33m\x1b[1mDRY RUN - No resources were deleted\x1b[0m\n');
    return;
  }

  // Confirmation prompt
  if (!options.force) {
    console.log('\n\x1b[33m\x1b[1mThis will permanently delete the resources listed above.\x1b[0m');
    console.log('\x1b[33mPress Ctrl+C to cancel, or wait 5 seconds to proceed...\x1b[0m\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Execute deletion
  let deletedAccessKeys = 0;
  let deletedAgents = 0;
  let deletedKBs = 0;
  let deletedModelKeys = 0;
  let deletedWorkspaces = 0;

  // Delete agent access keys first
  if (accessKeysToDelete > 0) {
    console.log('\x1b[34mDeleting agent access keys...\x1b[0m');
    for (const agent of agentsToDelete) {
      const keys = accessKeysByAgent.get(agent.uuid) || [];
      for (const key of keys) {
        try {
          await deleteAccessKey(agent.uuid, key.id);
          deletedAccessKeys++;
          process.stdout.write(`\r   ${deletedAccessKeys}/${accessKeysToDelete}`);
        } catch (error) {
          console.error(`\n   \x1b[31mFailed to delete key ${key.name}: ${error}\x1b[0m`);
        }
      }
    }
    console.log('\n');
  }

  // Delete agents
  if (agentsToDelete.length > 0) {
    console.log('\x1b[34mDeleting agents...\x1b[0m');
    for (const agent of agentsToDelete) {
      try {
        await deleteAgent(agent.uuid);
        deletedAgents++;
        console.log(`   \x1b[32m\u2713\x1b[0m ${agent.name}`);
      } catch (error) {
        console.error(`   \x1b[31m\u2717 ${agent.name}: ${error}\x1b[0m`);
      }
    }
    console.log();
  }

  // Delete KBs
  if (kbsToDelete.length > 0) {
    console.log('\x1b[34mDeleting knowledge bases...\x1b[0m');
    for (const kb of kbsToDelete) {
      try {
        await deleteKnowledgeBase(kb.uuid);
        deletedKBs++;
        console.log(`   \x1b[32m\u2713\x1b[0m ${kb.name}`);
      } catch (error) {
        console.error(`   \x1b[31m\u2717 ${kb.name}: ${error}\x1b[0m`);
      }
    }
    console.log();
  }

  // Delete model access keys
  if (modelKeysToDelete.length > 0) {
    console.log('\x1b[34mDeleting model access keys...\x1b[0m');
    for (const key of modelKeysToDelete) {
      try {
        await deleteModelAccessKey(key.uuid);
        deletedModelKeys++;
        console.log(`   \x1b[32m\u2713\x1b[0m ${key.name}`);
      } catch (error) {
        console.error(`   \x1b[31m\u2717 ${key.name}: ${error}\x1b[0m`);
      }
    }
    console.log();
  }

  // Delete workspaces (must be empty - agents already deleted)
  if (workspacesToDelete.length > 0) {
    console.log('\x1b[34mDeleting workspaces...\x1b[0m');
    for (const workspace of workspacesToDelete) {
      try {
        await deleteWorkspace(workspace.uuid);
        deletedWorkspaces++;
        console.log(`   \x1b[32m\u2713\x1b[0m ${workspace.name}`);
      } catch (error) {
        console.error(`   \x1b[31m\u2717 ${workspace.name}: ${error}\x1b[0m`);
      }
    }
    console.log();
  }

  // Delete database
  if (deleteDb) {
    console.log('\x1b[34mDeleting database...\x1b[0m');
    try {
      await deleteDatabase(projectDb.id);
      console.log(`   \x1b[32m\u2713\x1b[0m ${projectDb.name}`);
    } catch (error) {
      console.error(`   \x1b[31m\u2717 ${projectDb.name}: ${error}\x1b[0m`);
    }
    console.log();
  }

  // Delete project (must be last - all resources must be deleted first)
  let deletedProjectFlag = false;
  if (deleteProject) {
    console.log('\x1b[34mDeleting project...\x1b[0m');
    try {
      await deleteProject_fn(sharkbyteProject.id);
      deletedProjectFlag = true;
      console.log(`   \x1b[32m\u2713\x1b[0m ${sharkbyteProject.name}`);
    } catch (error) {
      console.error(`   \x1b[31m\u2717 ${sharkbyteProject.name}: ${error}\x1b[0m`);
      console.error(`   \x1b[33mNote: Project deletion requires all resources to be removed first\x1b[0m`);
    }
    console.log();
  }

  // Summary
  console.log('\x1b[32m\x1b[1mCleanup complete!\x1b[0m');
  const deletedParts = [
    `${deletedAgents} agents`,
    `${deletedKBs} KBs`,
    `${deletedAccessKeys} agent keys`,
  ];
  if (deletedModelKeys > 0) deletedParts.push(`${deletedModelKeys} model keys`);
  if (deletedWorkspaces > 0) deletedParts.push(`${deletedWorkspaces} workspaces`);
  if (deleteDb) deletedParts.push('1 database');
  if (deletedProjectFlag) deletedParts.push('1 project');
  console.log(`   Deleted: ${deletedParts.join(', ')}`);

  const preservedParts: string[] = [];
  if (preservedAgentIds.size > 0) preservedParts.push(`${preservedAgentIds.size} agents`);
  if (preservedKBIds.size > 0) preservedParts.push(`${preservedKBIds.size} KBs`);
  if (options.keepModelKeys && modelAccessKeys.length > 0) preservedParts.push(`${modelAccessKeys.length} model keys`);
  if (options.keepWorkspaces && workspaces.length > 0) preservedParts.push(`${workspaces.length} workspaces`);
  if (options.keepDb && projectDb) preservedParts.push('1 database');
  if (options.keepProject && sharkbyteProject) preservedParts.push('1 project');
  if (preservedParts.length > 0) {
    console.log(`   Preserved: ${preservedParts.join(', ')}`);
  }
  console.log();
}

main().catch((error) => {
  console.error('\x1b[31mError:\x1b[0m', error);
  process.exit(1);
});
