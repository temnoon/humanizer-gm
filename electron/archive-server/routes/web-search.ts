/**
 * Web Search Router - Brave Search API integration for reference material
 *
 * Routes:
 * - GET /api/web/status - Check if web search is configured
 * - POST /api/web/search - Search the web for reference material
 * - POST /api/web/fetch - Fetch and extract content from a URL
 *
 * IMPORTANT: Web search results are REFERENCE material.
 * They should inform writing but are NOT the author's original content.
 * The frontend marks these with sourceType: 'reference' to distinguish
 * them from archive content.
 */

import { Router, Request, Response } from 'express';

const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1/web/search';

// API key from environment
function getApiKey(): string | undefined {
  return process.env.BRAVE_SEARCH_API_KEY;
}

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  page_age?: string;
  page_fetched?: string;
  language?: string;
  family_friendly?: boolean;
  extra_snippets?: string[];
}

export interface BraveSearchResponse {
  query: {
    original: string;
    altered?: string;
  };
  web?: {
    results: BraveSearchResult[];
  };
}

export interface WebSearchOptions {
  limit?: number;
  freshness?: 'pd' | 'pw' | 'pm' | 'py'; // past day/week/month/year
  country?: string;
  search_lang?: string;
}

export function createWebSearchRouter(): Router {
  const router = Router();

  /**
   * GET /api/web/status
   * Check if web search is configured and available
   */
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const apiKey = getApiKey();
      const configured = !!apiKey;

      if (!configured) {
        return res.json({
          available: false,
          apiKeyConfigured: false,
          message: 'BRAVE_SEARCH_API_KEY environment variable not set',
          timestamp: Date.now(),
        });
      }

      // Test the API with a simple query
      try {
        const testResponse = await fetch(
          `${BRAVE_API_BASE}?q=test&count=1`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': apiKey,
            },
            signal: AbortSignal.timeout(5000),
          }
        );

        if (testResponse.ok) {
          res.json({
            available: true,
            apiKeyConfigured: true,
            apiReachable: true,
            timestamp: Date.now(),
          });
        } else {
          const errorText = await testResponse.text();
          console.error('[web-search] API test failed:', testResponse.status, errorText);
          res.json({
            available: false,
            apiKeyConfigured: true,
            apiReachable: false,
            error: `API returned ${testResponse.status}`,
            timestamp: Date.now(),
          });
        }
      } catch (fetchErr) {
        console.error('[web-search] API connectivity test failed:', fetchErr);
        res.json({
          available: false,
          apiKeyConfigured: true,
          apiReachable: false,
          error: fetchErr instanceof Error ? fetchErr.message : 'Network error',
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.error('[web-search] Status check error:', err);
      res.status(500).json({
        available: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/web/search
   * Search the web using Brave Search API
   *
   * Body:
   * - query: Search query (required)
   * - limit: Max results (default: 10, max: 20)
   * - freshness: 'day' | 'week' | 'month' | 'year' (optional)
   *
   * Returns results formatted for use as reference material
   */
  router.post('/search', async (req: Request, res: Response) => {
    try {
      const { query, limit = 10, freshness } = req.body;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'query parameter required' });
      }

      const apiKey = getApiKey();
      if (!apiKey) {
        return res.status(503).json({
          error: 'Web search not configured',
          message: 'BRAVE_SEARCH_API_KEY environment variable not set',
        });
      }

      // Build query params
      const params = new URLSearchParams({
        q: query,
        count: String(Math.min(limit, 20)), // Cap at 20
      });

      // Map freshness to Brave API format
      if (freshness) {
        const freshnessMap: Record<string, string> = {
          day: 'pd',
          week: 'pw',
          month: 'pm',
          year: 'py',
        };
        if (freshnessMap[freshness]) {
          params.set('freshness', freshnessMap[freshness]);
        }
      }

      console.log('[web-search] Searching:', query);

      const response = await fetch(`${BRAVE_API_BASE}?${params}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[web-search] API error:', response.status, errorText);
        return res.status(response.status).json({
          error: `Brave Search API error: ${response.status}`,
          details: errorText,
        });
      }

      const data = await response.json() as BraveSearchResponse;
      const webResults = data.web?.results || [];

      // Format results for the frontend
      const results = webResults.map((item) => ({
        title: item.title,
        url: item.url,
        description: item.description,
        publishedDate: item.page_age || item.page_fetched,
        siteName: extractSiteName(item.url),
        extraSnippets: item.extra_snippets,
      }));

      console.log('[web-search] Found', results.length, 'results for:', query);

      res.json({
        query: data.query.original,
        results,
        count: results.length,
        timestamp: Date.now(),
      });

    } catch (err) {
      console.error('[web-search] Search error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Search failed',
      });
    }
  });

  /**
   * POST /api/web/fetch
   * Fetch and extract content from a URL
   *
   * Body:
   * - url: URL to fetch (required)
   *
   * Returns extracted article content for use as reference material
   */
  router.post('/fetch', async (req: Request, res: Response) => {
    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url parameter required' });
      }

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return res.status(400).json({ error: 'Only HTTP(S) URLs supported' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      console.log('[web-fetch] Fetching:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.error('[web-fetch] HTTP error:', response.status);
        return res.status(response.status).json({
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        });
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return res.status(400).json({
          error: `Unsupported content type: ${contentType}`,
        });
      }

      const html = await response.text();
      const extracted = extractArticleContent(html, parsedUrl.hostname);

      console.log('[web-fetch] Extracted', extracted.wordCount, 'words from:', url);

      res.json({
        url,
        title: extracted.title,
        content: extracted.content,
        wordCount: extracted.wordCount,
        siteName: extractSiteName(url),
        timestamp: Date.now(),
      });

    } catch (err) {
      console.error('[web-fetch] Fetch error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Fetch failed',
      });
    }
  });

  return router;
}

/**
 * Extract site name from URL
 */
function extractSiteName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove www. prefix and get domain
    return hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Extract article content from HTML
 * Simple reader-mode extraction without external dependencies
 */
function extractArticleContent(html: string, hostname: string): {
  title: string;
  content: string;
  wordCount: number;
} {
  // Remove script, style, nav, header, footer, aside tags
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Extract title from <title> or <h1>
  const titleMatch = cleaned.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                     cleaned.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : 'Untitled';

  // Try to find article or main content
  let mainContent = '';

  // Look for article tag first
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    mainContent = articleMatch[1];
  } else {
    // Look for main tag
    const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      mainContent = mainMatch[1];
    } else {
      // Fall back to looking for common content divs
      const contentPatterns = [
        /<div[^>]*class="[^"]*(?:post-content|article-content|entry-content|content-body|blog-post)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id="[^"]*(?:content|article|post|main)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];

      for (const pattern of contentPatterns) {
        const match = cleaned.match(pattern);
        if (match) {
          mainContent = match[1];
          break;
        }
      }

      // If still nothing, use the body content
      if (!mainContent) {
        const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        mainContent = bodyMatch ? bodyMatch[1] : cleaned;
      }
    }
  }

  // Extract text from paragraphs, headings, and list items
  const textParts: Array<{ pos: number; text: string; type: string }> = [];

  // Extract headings
  const headingMatches = mainContent.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi);
  for (const match of headingMatches) {
    const level = parseInt(match[1]);
    const text = stripTags(match[2]).trim();
    if (text && text.length > 2) {
      const prefix = '#'.repeat(level) + ' ';
      textParts.push({ pos: match.index || 0, text: prefix + text, type: 'heading' });
    }
  }

  // Extract paragraphs
  const paragraphMatches = mainContent.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const match of paragraphMatches) {
    const text = stripTags(match[1]).trim();
    if (text && text.length > 20) { // Skip very short paragraphs (likely UI elements)
      textParts.push({ pos: match.index || 0, text, type: 'paragraph' });
    }
  }

  // Extract blockquotes
  const blockquoteMatches = mainContent.matchAll(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi);
  for (const match of blockquoteMatches) {
    const text = stripTags(match[1]).trim();
    if (text && text.length > 10) {
      textParts.push({ pos: match.index || 0, text: '> ' + text.replace(/\n/g, '\n> '), type: 'quote' });
    }
  }

  // Sort by position and join
  textParts.sort((a, b) => a.pos - b.pos);
  const content = textParts.map((p) => p.text).join('\n\n');

  // Decode HTML entities and clean up
  const finalContent = decodeHtmlEntities(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const wordCount = finalContent.split(/\s+/).filter(w => w.length > 0).length;

  return { title, content: finalContent, wordCount };
}

/**
 * Strip HTML tags from a string
 */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '...',
    '&rsquo;': "'",
    '&lsquo;': "'",
    '&rdquo;': '"',
    '&ldquo;': '"',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'g'), char);
  }

  // Handle numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}
