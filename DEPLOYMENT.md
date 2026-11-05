# Deployment Guide

SharkByte Support runs on free tiers: Vercel (Hobby), Neon Postgres with pgvector, NVIDIA Build
embeddings, and a chain of free LLM providers. This guide covers setup, every environment
variable, the free-tier rails that keep a public demo inside those quotas, and troubleshooting.

---

## Deploy with Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/iamnolanhu/sharkbyte-support)

1. Click the button and create the project.
2. **Database:** in the project's Storage tab, add **Neon** from the Vercel Marketplace. It sets
   `DATABASE_URL` for every environment. Any Postgres with the `vector` extension works too.
3. **Keys:** add `NVIDIA_API_KEY` (required: embeddings, and the last LLM in the chain). For a
   faster chain add `CEREBRAS_API_KEY` and/or `OPENROUTER_API_KEY`.
4. **Optional:** `CRON_SECRET` (protects the daily sweep), `FIRECRAWL_API_KEY`, and the PostHog keys.
5. Redeploy. The schema (tables and the `vector` extension) creates itself on the first request.

### Run locally

```bash
bun install
cp .env.example .env.local   # fill in DATABASE_URL and NVIDIA_API_KEY at minimum
bun run dev
bun run test                 # unit tests (in-memory Postgres, no network database)
```

---

## Environment variables

No provider key may ever use a `NEXT_PUBLIC_` name: those values ship to every browser. The
PostHog project key is the only public one.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | | Postgres connection string (pgvector) |
| `NVIDIA_API_KEY` | yes | | Embeddings, and the NVIDIA step of the LLM chain |
| `CEREBRAS_API_KEY` | no | | Cerebras step of the LLM chain |
| `OPENROUTER_API_KEY` | no | | OpenRouter step of the LLM chain (free models) |
| `OPENROUTER_MODEL` | no | `google/gemma-4-31b-it:free` | OpenRouter model id |
| `LLM_PROVIDERS` | no | `cerebras,openrouter,nvidia` | Provider order; providers without a key are skipped |
| `LLM_FIRST_BYTE_TIMEOUT_MS` | no | `8000` | Wait for a provider's first token before falling back |
| `LLM_MODEL` | no | `gpt-oss-120b` | Cerebras model id |
| `NVIDIA_LLM_MODEL` | no | `openai/gpt-oss-120b` | NVIDIA chat model id |
| `EMBEDDING_MODEL` | no | `nvidia/nemotron-3.5-embed-1b` | NVIDIA embedding model (1024 dimensions); changing it means re-crawling every agent |
| `FIRECRAWL_API_KEY` | no | | Firecrawl for JavaScript-rendered pages |
| `APP_DOMAIN` | no | Vercel production URL | Public domain used in copy and the demo agent |
| `CRON_SECRET` | no | | Bearer secret for `/api/cron/sweep`; without it the sweep refuses every call |
| `MAX_PAGES_PER_AGENT` | no | `30` | Pages read per agent |
| `MAX_CHUNKS_PER_AGENT` | no | `300` | Chunks stored per agent |
| `MAX_TOTAL_CHUNKS` | no | `40000` | Chunks across all agents before the oldest are evicted |
| `MAX_CRAWLS_PER_DAY` | no | `50` | New crawls per UTC day, app-wide |
| `MAX_CHAT_TOKENS_PER_DAY` | no | `500000` | Chat tokens per UTC day, app-wide |
| `MAX_FIRECRAWL_PER_DAY` | no | `50` | Firecrawl scrapes per UTC day, app-wide |
| `POSTHOG_API_KEY` | no | | Server-side PostHog events |
| `POSTHOG_HOST` | no | posthog-node default | Server-side PostHog host |
| `NEXT_PUBLIC_POSTHOG_KEY` | no | | Browser PostHog (pageviews, autocapture, session replay) |
| `NEXT_PUBLIC_POSTHOG_HOST` | no | `https://us.i.posthog.com` | Browser PostHog host |

At least one LLM key must be set; `NVIDIA_API_KEY` counts, since it is required anyway.

**OpenRouter and Zero Data Retention:** OpenRouter's free models refuse accounts that enforce
Zero Data Retention. Either allow non-ZDR providers for the key you use here, or drop
`openrouter` from `LLM_PROVIDERS`.

PostHog is off when its keys are unset; nothing else depends on it.

---

## Free-tier rails

The rails keep a public demo inside the free quotas. When one trips, the visitor sees a short
ocean-themed message and nothing is spent.

| Rail | Limit | Knob | What the visitor sees |
| --- | --- | --- | --- |
| Creates per IP | 3 per hour | fixed | "Whoa, slow your swim! You can make 3 Sammys an hour — try again soon." |
| Crawls per day | 50 per UTC day | `MAX_CRAWLS_PER_DAY` | "Sammy has explored enough reefs for today — the free demo resets tomorrow." |
| Storage capacity | `MAX_TOTAL_CHUNKS` | `MAX_TOTAL_CHUNKS` | "The free demo is full right now — try again tomorrow" |
| Chat messages per IP | 20 per minute | fixed | "Easy there, fast fins! Give Sammy a minute to catch up." |
| Chat tokens per day | 500,000 per UTC day | `MAX_CHAT_TOKENS_PER_DAY` | "The free demo is resting until tomorrow" |
| Firecrawl per day | 50 per UTC day | `MAX_FIRECRAWL_PER_DAY` | nothing: pages are read without Firecrawl |

Fixed bounds: a user message is at most 2,000 characters, the model sees the last 10 turns and
answers in at most 600 tokens, and retrieval uses the top 6 chunks of that agent only.

Crawls fetch at most `MAX_PAGES_PER_AGENT` pages (8 s each, 6 in parallel, HTML only, up to
1 MB), every hop re-checked against private and internal addresses.

### Firecrawl

Firecrawl only runs for a page whose text comes back under 200 characters (usually a
JavaScript-rendered page), and only while the daily Firecrawl rail has room. Use a capped
free-tier key: the rail limits calls, but the key's own plan is the real spending cap.

---

## The daily sweep

`vercel.json` schedules `GET /api/cron/sweep` once a day. Vercel Cron sends
`Authorization: Bearer <CRON_SECRET>`; set `CRON_SECRET` in the project so the call is accepted.
The sweep:

- marks crawls that outlived the function time limit as failed (the owner can press Repair);
- clears the chunks of failed agents and removes failed agents after 24 hours;
- removes agents unused for 14 days;
- while storage is above 80 % of `MAX_TOTAL_CHUNKS`, evicts the least recently used agents;
- never touches an agent that is crawling or pinned (the site's own demo Sammy is pinned).

A create that would not fit runs the same sweep first. Without `CRON_SECRET` the cron endpoint
returns 401, so storage only shrinks when a create hits the ceiling.

---

## Troubleshooting

### A rail message shows up

Each message in the rails table names its cause. Per-IP limits clear within the hour or minute;
daily limits reset at midnight UTC. Raise a knob in the environment and redeploy if your
deployment can afford more.

### "The free demo is full right now — try again tomorrow"

A new agent would not fit under `MAX_TOTAL_CHUNKS` even after a sweep, because every agent
left is crawling or pinned. Space frees up as those crawls finish, or raise `MAX_TOTAL_CHUNKS`
if your database has room.

### An agent is stuck on "crawling"

A crawl stops at the function time limit. The daily sweep marks an abandoned crawl as failed;
the owner (the browser that created the agent) can then press **Repair** on the agent's page
to crawl the site again.

### Chat answers "Sammy's fins are tangled — every free model is busy"

Every LLM provider in the chain failed or timed out (or embeddings did). Check that at least one LLM key is valid,
that the OpenRouter key allows non-ZDR providers (see above), and the function logs for the
provider error.

### Old embed snippets

Snippets from the original version carried an endpoint and access key. They are ignored now;
an id that no longer matches an agent shows the "retired" message in the widget. Paste the
new snippet from the agent's page.

---

## Support

Open an issue on [GitHub](https://github.com/iamnolanhu/sharkbyte-support/issues).
