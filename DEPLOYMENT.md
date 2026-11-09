# Deployment Guide

SharkByte Support runs on free tiers: Vercel (Hobby), Neon Postgres with pgvector, Google Gemini
embeddings, and a chain of free LLM providers. This guide covers setup, every environment
variable, the free-tier rails that keep a public demo inside those quotas, and troubleshooting.

---

## Deploy with Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/iamnolanhu/sharkbyte-support)

1. Click the button and create the project.
2. **Database:** in the project's Storage tab, add **Neon** from the Vercel Marketplace. It sets
   `DATABASE_URL` for every environment. Any Postgres with the `vector` extension works too.
3. **Keys:** add `GEMINI_API_KEY` (required: embeddings; a free key from Google AI Studio) and at
   optionally `NVIDIA_API_KEY` (first in the default chat chain; Gemini answers when it is unset or
   down). `CEREBRAS_API_KEY` and `OPENROUTER_API_KEY` only matter if `LLM_PROVIDERS` names them.
4. **Optional:** `CRON_SECRET` (protects the daily sweep), `FIRECRAWL_API_KEY`, and the PostHog keys.
5. Redeploy. The schema (tables and the `vector` extension) creates itself on the first request.

### Run locally

```bash
bun install
cp .env.example .env.local   # fill in DATABASE_URL and GEMINI_API_KEY at minimum
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
| `GEMINI_API_KEY` | yes | | Gemini API key for embeddings (free tier) |
| `NVIDIA_API_KEY` | no | | NVIDIA step of the LLM chain; embeddings when `EMBEDDING_PROVIDER=nvidia` |
| `GEMINI_LLM_MODEL` | no | `gemini-3.5-flash-lite` | Gemini chat model (OpenAI-compatible endpoint, same `GEMINI_API_KEY`) |
| `CEREBRAS_API_KEY` | no | | Cerebras step of the LLM chain (when `LLM_PROVIDERS` names it) |
| `OPENROUTER_API_KEY` | no | | OpenRouter step of the LLM chain, free models (when `LLM_PROVIDERS` names it) |
| `OPENROUTER_MODEL` | no | `google/gemma-4-31b-it:free` | OpenRouter model id |
| `LLM_PROVIDERS` | no | `nvidia,gemini` | Provider order from `nvidia`, `gemini`, `cerebras`, `openrouter`; providers without a key are skipped |
| `LLM_FIRST_BYTE_TIMEOUT_MS` | no | `8000` | Wait for a provider's first token before falling back |
| `LLM_MODEL` | no | `gpt-oss-120b` | Cerebras model id |
| `NVIDIA_LLM_MODEL` | no | `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA chat model id |
| `EMBEDDING_PROVIDER` | no | `gemini` | `gemini` or `nvidia` |
| `EMBEDDING_MODEL` | no | `gemini-embedding-001` (nvidia: `nvidia/nemotron-3.5-embed-1b`) | Embedding model; changing it means re-crawling every agent |
| `EMBEDDING_DIMS` | no | `768` (nvidia: `1024`) | Vector size stored in `chunks.embedding` (Gemini up to 3072, NVIDIA up to 4000); a change re-embeds everything, see below |
| `EMBEDDING_BATCH_SIZE` | no | `100` (nvidia: `1`) | Inputs per embeddings request (Gemini up to 100, NVIDIA up to 32) |
| `EMBEDDING_DIMS_MIGRATE` | no | unset | `1` for ONE deploy after changing the embedding size: empties stored vectors and resizes them (see below); remove it afterwards |
| `FIRECRAWL_API_KEY` | no | | Firecrawl for JavaScript-rendered pages |
| `APP_DOMAIN` | no | Vercel production URL | Public domain used in copy and the demo agent |
| `CRON_SECRET` | no | | Bearer secret for `/api/cron/sweep`; without it the sweep refuses every call |
| `MAX_PAGES_PER_AGENT` | no | `30` | Pages read per agent |
| `MAX_CHUNKS_PER_AGENT` | no | `300` | Chunks stored per agent |
| `MAX_TOTAL_CHUNKS` | no | `40000` | Chunks across all agents before the oldest are evicted |
| `MAX_CRAWLS_PER_DAY` | no | `20` | New crawls per UTC day, app-wide |
| `MAX_CHAT_TOKENS_PER_DAY` | no | `500000` | Chat tokens per UTC day, app-wide |
| `MAX_FIRECRAWL_PER_DAY` | no | `50` | Firecrawl scrapes per UTC day, app-wide |
| `MAX_EMBED_REQUESTS_PER_DAY` | no | `900` | Embedding provider requests per UTC day, app-wide (Gemini free tier: about 1,000); crawls may use 75 %, the rest is kept for chat questions |
| `POSTHOG_API_KEY` | no | | Server-side PostHog events |
| `POSTHOG_HOST` | no | posthog-node default | Server-side PostHog host |
| `NEXT_PUBLIC_POSTHOG_KEY` | no | | Browser PostHog: pageviews, autocapture and session replay on the site and inside the embed widget |
| `NEXT_PUBLIC_POSTHOG_HOST` | no | `https://us.i.posthog.com` | Browser PostHog host |

`GEMINI_API_KEY` already serves chat (the `gemini` step), so no other LLM key is required.

**Model ids go stale.** NVIDIA and Cerebras retire hosted models. An HTTP 410 in the logs ("has
reached its end of life") means the id is gone, and a 404 "Function not found for account" means
it isn't served to your key. Pick a live id from the provider's `/v1/models` list and set
`NVIDIA_LLM_MODEL`, `GEMINI_LLM_MODEL` or `LLM_MODEL`; no code change is needed. Gemini answers
404 "no longer available to new users" for retired ids (gemini-2.5-flash, November 2026).

**Reasoning models.** Answers get 600 output tokens, and the first text must arrive within
`LLM_FIRST_BYTE_TIMEOUT_MS`. The chain therefore sends gpt-oss models `reasoning_effort: "low"`
and Nemotron models `chat_template_kwargs: { enable_thinking: false }`; with thinking on, a
Nemotron model can spend the whole budget thinking and send no answer. Gemini 2.5 Flash models get
`reasoning_effort: "none"`, and other Gemini models (2.5 Pro, 3.x, which cannot turn thinking
off) get `"low"`.

**Embeddings.** Gemini's free tier allows about 100 requests a minute, 30,000 tokens a minute
and 1,000 requests a day per Google Cloud project. Requests therefore carry at most 100 inputs
and about 8,000 estimated tokens; a 429 waits (Google's `retryDelay` when it sends one) and
tries again; a batch that gets a 5xx is retried one input at a time. A chat question gets 5 s per
request, one retry after a timeout or network error, and 12 s in all; when it fails the visitor
sees "Sammy couldn't read your question — try again in a moment". Vectors are
requested at `EMBEDDING_DIMS` and L2-normalised. On NVIDIA (`EMBEDDING_PROVIDER=nvidia`),
`EMBEDDING_BATCH_SIZE` defaults to 1 because its hosted embedder fails most multi-input
requests with HTTP 500; a batch that still fails is split in halves down to single inputs.

**Changing the embedding size.** On the first request after a deploy, the schema compares
`chunks.embedding` with `EMBEDDING_DIMS`. Without `EMBEDDING_DIMS_MIGRATE=1` a mismatch changes
nothing: it is logged with both sizes and sent as `embedding_dims_mismatch`; crawls fail, Repair
is refused before it deletes anything, and chat refuses to search, all showing visitors "Sammy is
being re-tuned — try again soon". With `EMBEDDING_DIMS_MIGRATE=1` it
empties `chunks`, resizes the column, marks every agent that is not crawling `failed` with
"re-embedding required" (crawling ones keep crawling from scratch), and sends
`embedding_dims_migrated`. Agents waiting for re-embedding are kept past the 24-hour
failed-agent rule (the 14-day idle rule still applies). Runbook:

1. Before the push: `select count(*) from agents where status = 'crawling'` returns 0.
2. Set `EMBEDDING_DIMS_MIGRATE=1` on the environment, push, wait for the deployment, and send
   one request (any page) so the migration runs.
3. Required: re-crawl the unowned imported agents with
   `bun --env-file=<file> scripts/import-legacy-agents.ts <export.json>`; it re-crawls exactly
   the rows marked "re-embedding required". When crawls spend their share of the day's
   embedding requests the run stops with "paused: daily embedding limit spent, re-run after
   00:00 UTC"; run it again after midnight UTC. A re-run resumes the rows left `crawling`, resumes
   the ones the daily sweep ended `ready` with pages still to read, and re-crawls the ones the
   sweep failed after they stalled ("ran out of air"). Owners re-crawl their own with **Repair**, and
   anyone can by submitting the URL again.
4. Remove `EMBEDDING_DIMS_MIGRATE` from the environment.

**Crawls run in slices.** At about 30,000 tokens a minute a large site needs longer than one
function invocation, so each invocation starts new pages for 240 s, saves the URLs still to read
on the agent row and leaves it `crawling`. The next status poll (the home page and dashboard
poll every few seconds) starts the next slice when none is running. A page that stays rate
limited after every retry (or meets the spent daily embedding rail) stays on the list and ends
the slice. A crawl ends `ready` with what it stored after 6 slices.

**OpenRouter and Zero Data Retention:** OpenRouter's free models refuse accounts that enforce
Zero Data Retention. Either allow non-ZDR providers for the key you use here, or drop
`openrouter` from `LLM_PROVIDERS`.

PostHog is off when its keys are unset; nothing else depends on it.

**Privacy:** when `POSTHOG_API_KEY` is set, every chat question and answer is logged to PostHog
server-side (the `chat_completed` event: question up to 2,000 characters, answer up to 4,000, the
provider and model that answered, token counts, latency and outcome). Visitors appear only as a hashed id of
their IP address and browser; the raw IP is never sent. Embedded chats also record
the hostname of the page hosting the widget. Each turn also sends PostHog LLM-analytics events:
`$ai_generation` carries the full model input (the system prompt with the retrieved page text,
and the conversation) and the answer, untruncated; `$ai_embedding` carries the question. When `NEXT_PUBLIC_POSTHOG_KEY` is set, the browser
also records session replays and autocaptured clicks on every surface, the embed widget inside
customer sites included, so chat content typed and shown in those sessions is recorded to PostHog
too. Tell your visitors accordingly, or leave both keys unset to log nothing.

---

## Free-tier rails

The rails keep a public demo inside the free quotas. When one trips, the visitor sees a short
ocean-themed message and nothing is spent.

| Rail | Limit | Knob | What the visitor sees |
| --- | --- | --- | --- |
| Creates per IP | 3 per hour | fixed | "Whoa, slow your swim! You can make 3 Sammys an hour — try again soon." |
| Crawls per day | 20 per UTC day | `MAX_CRAWLS_PER_DAY` | "Sammy has explored enough reefs for today — the free demo resets tomorrow." |
| Storage capacity | `MAX_TOTAL_CHUNKS` | `MAX_TOTAL_CHUNKS` | "The free demo is full right now — try again tomorrow" |
| Chat messages per IP | 20 per minute | fixed | "Easy there, fast fins! Give Sammy a minute to catch up." |
| Chat tokens per day | 500,000 per UTC day | `MAX_CHAT_TOKENS_PER_DAY` | "The free demo is resting until tomorrow" |
| Firecrawl per day | 50 per UTC day | `MAX_FIRECRAWL_PER_DAY` | nothing: pages are read without Firecrawl |
| Embedding requests per day | 900 per UTC day (crawls 75 %, chat the rest) | `MAX_EMBED_REQUESTS_PER_DAY` | "Sammy has read all it can for today — the free demo resets tomorrow." on chat, and on Create/Repair once the crawl share is spent; running crawls pause and keep their pages pending |

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

- finishes crawls with no progress for the function time limit plus 30 s (nobody polled to
  start the next slice): `ready` with what they stored, or `failed` when they stored nothing;
- clears the chunks of failed agents and removes failed agents after 24 hours (except agents
  waiting for re-embedding, which fall under the 14-day rule);
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

A crawl continues slice by slice while someone has the agent's page open. Left alone, the
daily sweep finishes it with what it stored, or marks it failed when it stored nothing; the
owner (the browser that created the agent) can then press **Repair** on the agent's page
to crawl the site again. Anyone can also retry a failed agent by submitting its URL again; that
crawl counts against the same hourly and daily caps.

### Chat answers "Sammy's fins are tangled — every free model is busy"

Every LLM provider in the chain failed or timed out (or embeddings did). Check that at least one LLM key is valid,
that the OpenRouter key allows non-ZDR providers (see above), and the function logs for the
provider error. An HTTP 410 or 404 means a retired or unavailable model id (see "Model ids go
stale"); a 402 means that provider account has no quota left.

### Old embed snippets

Snippets from the original version carried an endpoint and access key. They are ignored now;
an id that no longer matches an agent shows the "retired" message in the widget. Paste the
new snippet from the agent's page.

---

## Support

Open an issue on [GitHub](https://github.com/iamnolanhu/sharkbyte-support/issues).
