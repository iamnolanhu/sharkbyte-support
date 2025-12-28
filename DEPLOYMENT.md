# Deployment Guide

This guide walks you through deploying SharkByte Support on your own DigitalOcean account.

## Quick Links

| Link | Purpose |
|------|---------|
| [Generate API Token](https://cloud.digitalocean.com/account/api) | Create your DO API token |
| [Create First Agent](https://cloud.digitalocean.com/gen-ai/agents/new) | **Required one-time setup** |
| [Agent Workspaces](https://cloud.digitalocean.com/gen-ai/agent-workspaces) | Move agents between workspaces (Control Panel only) |
| [Model Access Keys](https://cloud.digitalocean.com/gen-ai/model-access-keys) | Find your model access key ID |
| [Knowledge Bases](https://cloud.digitalocean.com/gen-ai/knowledge-bases) | Find database ID |
| [Billing Settings](https://cloud.digitalocean.com/account/billing) | Enable billing |
| [Get $200 Credit](https://www.digitalocean.com/?refcode=732d9583cca9) | Referral link for new accounts |
| [Gradient AI Docs](https://docs.digitalocean.com/products/gradient-ai-platform/) | Official documentation |

---

## Estimated Costs

| Resource | Cost | Notes |
|----------|------|-------|
| Vector Database | ~$19.60/month | 2GB RAM, 1 vCPU, 40 GiB disk (auto-provisioned) |
| Gradient AI Usage | Variable | Agents, knowledge bases, and query processing |

**New to DigitalOcean?** Use our [referral link](https://www.digitalocean.com/?refcode=732d9583cca9) to get $200 in free credits for 60 days.

---

## Prerequisites

Before deploying, you need:

1. **DigitalOcean Account** with [billing enabled](https://cloud.digitalocean.com/account/billing)
2. **API Token** with read/write scopes from [API settings](https://cloud.digitalocean.com/account/api)
3. **One-Time Agent Creation** (see below)

### Critical: One-Time Agent Creation

Fresh DigitalOcean accounts must create at least one AI agent manually through the console before API-based agent creation works. This is a platform initialization requirement.

**Steps:**
1. Go to [Create Agent](https://cloud.digitalocean.com/gen-ai/agents/new)
2. Create any simple test agent (you can delete it afterward)
3. This initializes the Gradient AI services on your account

Without this step, you'll see `PermissionDenied` errors during deployment.

---

## Deployment Steps

### Option 1: Deploy with Vercel (Recommended)

1. Click the deploy button:

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/iamnolanhu/sharkbyte-support)

2. In Vercel's environment variables, add:
   ```
   DO_API_TOKEN=your_digitalocean_api_token
   ```

3. Complete the deployment. The first build will:
   - Create a "SharkByte Support" project in DigitalOcean
   - Provision a vector database (~$19.60/month)
   - Create a workspace and model access key
   - Create a demo agent for your domain

4. Check the build logs for recommended environment variables (see Post-Deployment Setup below)

### Option 2: Manual Deployment

```bash
# Clone the repository
git clone https://github.com/iamnolanhu/sharkbyte-support.git
cd sharkbyte-support

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Edit .env.local and add your DO_API_TOKEN
# Then build and deploy
npm run build
vercel deploy --prod
```

---

## Post-Deployment Setup (Important!)

After your first successful deployment, add these environment variables to prevent duplicate resource creation:

| Variable | Why It's Important | Where to Find |
|----------|-------------------|---------------|
| `DO_DATABASE_ID` | **Prevents duplicate $20/mo databases** | Build logs, or [Knowledge Bases](https://cloud.digitalocean.com/gen-ai/knowledge-bases) → any KB |
| `DO_PROJECT_ID` | Skips project re-discovery | Build logs |
| `DO_MODEL_ACCESS_KEY_ID` | Prevents duplicate keys | Build logs, or [Model Access Keys](https://cloud.digitalocean.com/gen-ai/model-access-keys) |
| `NEXT_PUBLIC_DEMO_AGENT_ENDPOINT` | Faster demo widget loading | Build logs |
| `NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY` | Faster demo widget loading | Build logs |

> **Note:** `DO_WORKSPACE_ID` is NOT supported - see [Agents in Wrong Workspace](#agents-in-wrong-workspace) in troubleshooting.

### Finding Values in Build Logs

After deployment, look for lines like:
```
[init] Created project: SharkByte Support (abc123-uuid)
[init] Database ID: def456-uuid
[init] Model Access Key ID: ghi789-uuid
[init] Demo agent endpoint: https://your-agent.agents.do-ai.run
```

### Finding Values in DO Console

- **Database ID**: Go to [Knowledge Bases](https://cloud.digitalocean.com/gen-ai/knowledge-bases), click any KB, find the database ID in details
- **Model Access Key ID**: Go to [Model Access Keys](https://cloud.digitalocean.com/gen-ai/model-access-keys), copy the key ID

---

## Troubleshooting

### "PermissionDenied" Error

**Cause:** Fresh DO account hasn't initialized Gradient AI services.

**Solution:** Go to [Create Agent](https://cloud.digitalocean.com/gen-ai/agents/new) and create one agent manually first.

### Agents in Wrong Workspace

**Cause:** DigitalOcean REST API limitation - the public agent creation API does not support workspace assignment. All agents created via API are placed in the default "My Agent Workspace (Created by default)" workspace.

**Solution:** This is a known DO API limitation. You can manually move agents to the "SharkByte Support" workspace via the [Agent Workspaces](https://cloud.digitalocean.com/gen-ai/agent-workspaces) page in the Control Panel.

> **Future Fix:** The DO Control Panel uses an internal GraphQL API that does support `workspace_uuid`. See `.claude/docs/DO-WORKSPACE-API-NOTES.md` for details on potential future implementation.

### Multiple Databases Created

**Cause:** `DO_DATABASE_ID` wasn't set, so each deployment created a new database.

**Solution:**
1. Find your database ID from an existing Knowledge Base
2. Add `DO_DATABASE_ID` to your Vercel environment variables
3. Delete orphaned databases from DO console

### "Model Access Key Not Found"

**Cause:** Key was auto-created but the ID wasn't saved.

**Solution:**
1. Check [Model Access Keys](https://cloud.digitalocean.com/gen-ai/model-access-keys)
2. Add the key ID as `DO_MODEL_ACCESS_KEY_ID` in Vercel

### Orphaned Resources

If you have leftover agents or knowledge bases from failed deployments:

```bash
# Run the cleanup script (deletes ALL agents and KBs - use with caution!)
npm run cleanup
```

---

## Environment Variables Reference

### Required

```env
DO_API_TOKEN=          # Your DigitalOcean API token
```

### Auto-Discovered (Recommended to Set After First Deploy)

```env
DO_PROJECT_ID=         # Prevents re-discovery
DO_DATABASE_ID=        # Prevents duplicate databases ($20/mo each!)
DO_MODEL_ACCESS_KEY_ID=# Prevents duplicate keys
# NOTE: DO_WORKSPACE_ID is NOT supported - see troubleshooting section
```

### Optional Performance

```env
NEXT_PUBLIC_DEMO_AGENT_ENDPOINT=    # Skip runtime lazy init
NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY=  # Skip runtime lazy init
APP_DOMAIN=                         # Custom domain (auto-detected from Vercel)
```

### Optional Overrides

```env
DO_REGION=tor1                      # Only tor1 supports gen-ai
DO_EMBEDDING_MODEL_UUID=            # Default: Qwen3 Embedding 0.6B
DO_LLM_MODEL_UUID=                  # Default: GPT-oss-120b
FIRECRAWL_API_KEY=                  # Fallback for JS-rendered sites
```

---

## Support

- [GitHub Issues](https://github.com/iamnolanhu/sharkbyte-support/issues)
- [DigitalOcean Community](https://www.digitalocean.com/community)
- [Gradient AI Documentation](https://docs.digitalocean.com/products/gradient-ai-platform/)
