import { NextRequest, NextResponse } from 'next/server';
import {
  getKnowledgeBase,
  getAgent,
  isKBReady,
  uploadContentToKB,
  startIndexingJob,
  extractDomain,
  testContentQuality,
} from '@/lib/digitalocean';
import { scrapeUrl } from '@/lib/firecrawl';
import { FIRECRAWL_CONFIG } from '@/lib/config';
import type { AgentStatusResponse } from '@/types';

// Track ongoing Firecrawl operations to avoid duplicates
const firecrawlInProgress = new Set<string>();
// Track ongoing content quality checks to avoid duplicates
const qualityCheckInProgress = new Set<string>();
// Cache quality check results (KB ID -> isLowQuality)
const qualityCheckResults = new Map<string, boolean>();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');
    const kbId = searchParams.get('kbId');
    const url = searchParams.get('url'); // Original URL for Firecrawl fallback

    if (!agentId || !kbId) {
      return NextResponse.json(
        { error: 'agentId and kbId are required' },
        { status: 400 }
      );
    }

    // Check Knowledge Base status
    const kbResponse = await getKnowledgeBase(kbId);
    const kb = kbResponse.knowledge_base;
    const indexJob = kb.last_indexing_job;
    const indexStatus = indexJob?.status;

    // Check Agent status
    const agentResponse = await getAgent(agentId);
    const agentStatus = agentResponse.agent.status;

    // Use isKBReady to determine overall status
    const readiness = await isKBReady(kbId);
    let status: AgentStatusResponse['status'];
    let message: string | undefined;

    if (readiness.ready) {
      // KB indexing complete - check if we got content
      if (!readiness.hasContent && url && FIRECRAWL_CONFIG.IS_ENABLED && !firecrawlInProgress.has(kbId)) {
        // KB is empty - trigger Firecrawl fallback for SPAs/JS sites
        console.log(`[agent-status] KB ${kbId} indexed but empty, triggering Firecrawl for ${url}`);
        firecrawlInProgress.add(kbId);

        // Run Firecrawl in background (don't await)
        triggerFirecrawlFallback(kbId, url).finally(() => {
          firecrawlInProgress.delete(kbId);
        });

        status = 'indexing';
        message = 'Website appears to be JavaScript-rendered. Using enhanced scraping...';
      } else if (firecrawlInProgress.has(kbId)) {
        // Firecrawl is currently running
        status = 'indexing';
        message = 'Enhanced scraping in progress...';
      } else if (readiness.hasContent && url && FIRECRAWL_CONFIG.IS_ENABLED) {
        // KB has content - check quality (only if not already checked)
        const cachedResult = qualityCheckResults.get(kbId);

        if (cachedResult === true) {
          // Already determined to be low quality, Firecrawl should be running or done
          if (firecrawlInProgress.has(kbId)) {
            status = 'indexing';
            message = 'Detected login pages. Re-scraping with enhanced method...';
          } else {
            // Firecrawl already ran, content should be better now
            status = agentStatus === 'active' ? 'ready' : 'creating';
          }
        } else if (cachedResult === false) {
          // Already determined to be good quality
          status = agentStatus === 'active' ? 'ready' : 'creating';
        } else if (qualityCheckInProgress.has(kbId)) {
          // Quality check is running
          status = 'indexing';
          message = 'Verifying content quality...';
        } else {
          // Need to check quality - run in background
          qualityCheckInProgress.add(kbId);
          triggerQualityCheck(agentId, kbId, url, agentResponse.agent.endpoint).finally(() => {
            qualityCheckInProgress.delete(kbId);
          });
          status = 'indexing';
          message = 'Verifying content quality...';
        }
      } else {
        // KB is ready with content (or no Firecrawl available)
        status = agentStatus === 'active' ? 'ready' : 'creating';
      }
    } else if (indexStatus === 'INDEX_JOB_STATUS_RUNNING' || indexStatus === 'INDEX_JOB_STATUS_PENDING') {
      status = 'indexing';
      message = 'Indexing website content...';
    } else if (indexStatus === 'INDEX_JOB_STATUS_FAILED') {
      status = 'error';
      message = 'Indexing failed';
    } else {
      // Unknown/initial state or still waiting
      status = 'creating';
      message = readiness.reason;
    }

    const response: AgentStatusResponse = {
      status,
      kbStatus: kb.status,
      agentStatus,
      endpoint: agentResponse.agent.endpoint,
      message,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error checking agent status:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Trigger Firecrawl fallback to scrape JS-rendered site
 * Runs in background, uploads content to KB, and re-indexes
 */
async function triggerFirecrawlFallback(kbId: string, url: string): Promise<void> {
  try {
    console.log(`[Firecrawl Fallback] Starting for KB ${kbId}, URL: ${url}`);

    // Scrape the URL with Firecrawl
    const result = await scrapeUrl(url);

    if (!result.success || !result.markdown) {
      console.error(`[Firecrawl Fallback] Failed to scrape ${url}:`, result.error);
      return;
    }

    console.log(`[Firecrawl Fallback] Scraped ${result.markdown.length} chars from ${url}`);

    // Generate filename from domain
    const domain = extractDomain(url);
    const filename = `${domain.replace(/[^a-z0-9]/gi, '-')}-scraped.md`;

    // Upload content to KB
    await uploadContentToKB(kbId, result.markdown, filename);
    console.log(`[Firecrawl Fallback] Uploaded content to KB ${kbId}`);

    // Trigger re-indexing
    await startIndexingJob(kbId);
    console.log(`[Firecrawl Fallback] Re-indexing started for KB ${kbId}`);
  } catch (error) {
    console.error(`[Firecrawl Fallback] Error:`, error);
  }
}

/**
 * Check content quality and trigger Firecrawl if low quality detected
 * Runs in background, caches results
 */
async function triggerQualityCheck(
  agentId: string,
  kbId: string,
  url: string,
  endpoint: string | undefined
): Promise<void> {
  try {
    console.log(`[Quality Check] Starting for agent ${agentId}, KB ${kbId}`);

    const result = await testContentQuality(agentId, endpoint);
    console.log(`[Quality Check] Result:`, result);

    // Cache the result
    qualityCheckResults.set(kbId, result.isLowQuality);

    if (result.isLowQuality) {
      console.log(`[Quality Check] Low quality detected: ${result.reason}`);
      console.log(`[Quality Check] Triggering Firecrawl fallback for ${url}`);

      // Trigger Firecrawl fallback
      firecrawlInProgress.add(kbId);
      triggerFirecrawlFallback(kbId, url).finally(() => {
        firecrawlInProgress.delete(kbId);
        // Clear the low quality cache after Firecrawl runs so next check tests new content
        qualityCheckResults.delete(kbId);
      });
    } else {
      console.log(`[Quality Check] Content quality OK for KB ${kbId}`);
    }
  } catch (error) {
    console.error(`[Quality Check] Error:`, error);
    // On error, assume content is OK
    qualityCheckResults.set(kbId, false);
  }
}
