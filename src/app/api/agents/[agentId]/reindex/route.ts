/** POST /api/agents/[agentId]/reindex: same as repair (re-crawl from scratch). */
export { POST } from '../repair/route';

/** Must equal getLimits().crawlMaxDurationS; a literal here because Next reads it statically per route. */
export const maxDuration = 300;
