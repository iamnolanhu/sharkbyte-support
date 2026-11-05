/**
 * Firecrawl API Client
 * Renders a single JS-built page (SPA) when our own crawler's fetch yields too little text
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
