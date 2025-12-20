/**
 * Firecrawl API Client
 * Used as fallback when DO crawler can't index JS-rendered sites (SPAs)
 */

import { FIRECRAWL_CONFIG } from './config';

export interface ScrapeResult {
  success: boolean;
  markdown?: string;
  title?: string;
  description?: string;
  url?: string;
  error?: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
    };
  };
  error?: string;
}

/**
 * Scrape a URL using Firecrawl API
 * Returns rendered page content as markdown (handles SPAs/JS)
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  if (!FIRECRAWL_CONFIG.IS_ENABLED) {
    return {
      success: false,
      error: 'Firecrawl API key not configured',
    };
  }

  try {
    console.log(`[Firecrawl] Scraping URL: ${url}`);

    const response = await fetch(`${FIRECRAWL_CONFIG.API_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FIRECRAWL_CONFIG.API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000, // Wait for JS to render
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Firecrawl] API error: ${response.status} - ${errorText}`);
      return {
        success: false,
        error: `Firecrawl API error: ${response.status}`,
      };
    }

    const data: FirecrawlScrapeResponse = await response.json();

    if (!data.success || !data.data?.markdown) {
      console.error(`[Firecrawl] Scrape failed:`, data.error);
      return {
        success: false,
        error: data.error || 'No content returned',
      };
    }

    console.log(`[Firecrawl] Successfully scraped ${url} (${data.data.markdown.length} chars)`);

    return {
      success: true,
      markdown: data.data.markdown,
      title: data.data.metadata?.title,
      description: data.data.metadata?.description,
      url: data.data.metadata?.sourceURL || url,
    };
  } catch (error) {
    console.error(`[Firecrawl] Error scraping ${url}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Crawl multiple pages from a site using Firecrawl
 * Returns combined markdown from all pages
 */
export async function crawlSite(
  url: string,
  maxPages = 10
): Promise<ScrapeResult> {
  if (!FIRECRAWL_CONFIG.IS_ENABLED) {
    return {
      success: false,
      error: 'Firecrawl API key not configured',
    };
  }

  try {
    console.log(`[Firecrawl] Crawling site: ${url} (max ${maxPages} pages)`);

    // Start crawl job
    const crawlResponse = await fetch(`${FIRECRAWL_CONFIG.API_BASE}/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FIRECRAWL_CONFIG.API_KEY}`,
      },
      body: JSON.stringify({
        url,
        limit: maxPages,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      }),
    });

    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      console.error(`[Firecrawl] Crawl API error: ${crawlResponse.status} - ${errorText}`);
      return {
        success: false,
        error: `Firecrawl crawl error: ${crawlResponse.status}`,
      };
    }

    const crawlData = await crawlResponse.json();

    if (!crawlData.success) {
      return {
        success: false,
        error: crawlData.error || 'Crawl failed',
      };
    }

    // Poll for crawl completion
    const jobId = crawlData.id;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 2s = 60s max wait

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await fetch(
        `${FIRECRAWL_CONFIG.API_BASE}/crawl/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${FIRECRAWL_CONFIG.API_KEY}`,
          },
        }
      );

      const statusData = await statusResponse.json();

      if (statusData.status === 'completed') {
        // Combine all page markdown
        const pages = statusData.data || [];
        const combinedMarkdown = pages
          .map((page: { markdown?: string; metadata?: { sourceURL?: string } }) => {
            const pageUrl = page.metadata?.sourceURL || '';
            const content = page.markdown || '';
            return `# ${pageUrl}\n\n${content}`;
          })
          .join('\n\n---\n\n');

        console.log(`[Firecrawl] Crawl completed: ${pages.length} pages, ${combinedMarkdown.length} chars`);

        return {
          success: true,
          markdown: combinedMarkdown,
          title: `${new URL(url).hostname} - ${pages.length} pages`,
        };
      }

      if (statusData.status === 'failed') {
        return {
          success: false,
          error: statusData.error || 'Crawl job failed',
        };
      }

      attempts++;
    }

    return {
      success: false,
      error: 'Crawl timed out',
    };
  } catch (error) {
    console.error(`[Firecrawl] Error crawling ${url}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
