/**
 * AUI Tools - Archive Search Operations
 *
 * Handles archive searching and management:
 * - Semantic search (unified across AI conversations, Facebook, documents)
 * - Archive health checks
 * - Embedding building
 * - Facebook-specific search
 */

import type { AUIToolResult } from './types';
import { getArchiveServerUrl } from '../../platform';
import {
  dispatchSearchResults,
  dispatchOpenPanel,
  dispatchSetFacets,
  dispatchApplyFilter,
  dispatchClearFilters,
} from '../gui-bridge';

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE SEARCH TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Filter out JSON noise and system markers from search results
 * These get embedded but aren't useful search results
 */
function isValidSearchResult(content: string | undefined): boolean {
  if (!content || content.length < 20) return false;

  const trimmed = content.trim();

  // Skip JSON-like content
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (trimmed.startsWith('"') && trimmed.includes('":')) return false;

  // Skip content that's mostly JSON field patterns
  const jsonPatterns = [
    /^"?documents"?\s*:/i,
    /^"?queries"?\s*:/i,
    /^"?query"?\s*:/i,
    /^"?text"?\s*:/i,
    /^"?filter"?\s*:/i,
    /^"?source"?\s*:/i,
    /^"?metadata"?\s*:/i,
    /^"?content"?\s*:/i,
    /^"?messages"?\s*:/i,
  ];
  if (jsonPatterns.some(p => p.test(trimmed))) return false;

  // Skip system markers
  if (trimmed.includes('<ImageDisplayed>')) return false;
  if (trimmed.includes('ResponseTooLargeError')) return false;

  // Skip if it looks like mostly code/JSON (high bracket ratio)
  const bracketCount = (trimmed.match(/[{}\[\]]/g) || []).length;
  if (bracketCount > trimmed.length * 0.1) return false;

  // Skip if too many colons (likely key-value pairs)
  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount > 5 && colonCount > trimmed.split(/\s+/).length * 0.3) return false;

  return true;
}

/**
 * Search archive semantically (unified: AI conversations + Facebook + documents)
 */
export async function executeSearchArchive(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const {
    query,
    limit = 10,
    sources,  // Optional: ['facebook', 'openai', 'claude', 'conversations']
  } = params as { query?: string; limit?: number; sources?: string[] };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    // Request more results than needed since we'll filter out JSON noise
    const fetchLimit = Math.min(limit * 3, 50);

    // Use unified search endpoint (searches both messages AND content items)
    const response = await fetch(`${archiveServer}/api/embeddings/search/unified`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: fetchLimit,
        sources,  // Pass through source filter if provided
      }),
    });

    if (!response.ok) {
      // NO SILENT FALLBACK - User must be informed when semantic search fails
      const statusCode = response.status;
      const statusText = response.statusText;

      return {
        success: false,
        error: `Semantic search failed (${statusCode}). Embeddings may not be built yet.`,
        teaching: {
          whatHappened: `The archive search API returned an error (HTTP ${statusCode}: ${statusText}). This usually means embeddings have not been built for your archive.`,
          guiPath: [
            'Open the Archive panel (left side)',
            'Click the "Explore" tab',
            'Look for the "Build Embeddings" button',
            'Click it and wait for the process to complete',
            'Then try your search again',
          ],
          why: 'Semantic search finds content by meaning, not just keywords. It requires embeddings (vector representations of your messages) to be built first. This is a one-time process that takes a few minutes.',
        },
      };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.results) {
      console.warn('[search_archive] API response missing results field');
    }

    // Filter out JSON noise and system markers, then limit to requested amount
    const filteredResults = (data.results || [])
      .filter((r: { content: string }) => isValidSearchResult(r.content))
      .slice(0, limit);

    const resultCount = filteredResults.length;

    // Map to SearchResultsPayload format - unified API returns both message and content item fields
    const mappedResults = filteredResults.map((r: {
      id: string;
      type: 'message' | 'post' | 'comment' | 'document';
      source: string;
      content: string;
      title?: string;
      similarity: number;
      // Message-specific
      conversationId?: string;
      conversationTitle?: string;
      messageRole?: string;
      // Content item-specific
      authorName?: string;
      createdAt?: number;
      isOwnContent?: boolean;
    }) => ({
      id: r.id,
      messageId: r.id,
      conversationId: r.conversationId,
      content: r.content,  // Full content - don't truncate for harvest
      similarity: r.similarity,
      role: r.messageRole || (r.isOwnContent ? 'user' : 'assistant'),
      title: r.conversationTitle || r.title,
      // Extended fields for unified results
      type: r.type,
      source: r.source,
      authorName: r.authorName,
      createdAt: r.createdAt,
    }));

    // GUI Bridge: Dispatch results to Archive pane (Show Don't Tell)
    dispatchSearchResults({
      results: mappedResults,
      query: query,
      searchType: 'semantic',
      total: resultCount,
    }, 'search_archive');

    // Also open the Archive panel to Explore tab
    dispatchOpenPanel('archives', 'explore');

    // Build summary message with source breakdown
    const stats = data.stats || {};
    const sourceParts: string[] = [];
    if (stats.messages) sourceParts.push(`${stats.messages} AI messages`);
    if (stats.posts) sourceParts.push(`${stats.posts} Facebook posts`);
    if (stats.comments) sourceParts.push(`${stats.comments} Facebook comments`);
    if (stats.notes) sourceParts.push(`${stats.notes} notes`);
    if (stats.documents) sourceParts.push(`${stats.documents} documents`);
    const sourceBreakdown = sourceParts.length > 0 ? ` (${sourceParts.join(', ')})` : '';

    return {
      success: true,
      message: `Found ${resultCount} results${sourceBreakdown}`,
      data: {
        results: mappedResults,
        searchType: 'semantic',
        stats,
      },
      teaching: {
        whatHappened: `Searched your archive for "${query}" - found ${resultCount} semantically similar passages across all content types`,
        guiPath: [
          'Open the Archive panel (left side)',
          'Click the "Explore" tab',
          'Enter your search in the semantic search box',
          'Results include AI conversations, Facebook posts/comments, and documents',
        ],
        why: 'Unified semantic search finds related ideas across ALL your archive content - AI conversations, Facebook, and imported documents.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Archive search failed',
    };
  }
}

/**
 * Check archive health and readiness
 */
export async function executeCheckArchiveHealth(): Promise<AUIToolResult> {
  try {
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/embeddings/health`);

    if (!response.ok) {
      return { success: false, error: 'Health check failed' };
    }

    const health = await response.json();

    // Format the health status for the user
    const statusParts: string[] = [];

    if (health.ready) {
      statusParts.push('Archive is ready for semantic search.');
    } else {
      statusParts.push('Archive needs setup.');
    }

    statusParts.push(`${health.stats.conversations} conversations, ${health.stats.messages} embeddings.`);

    if (health.issues.length > 0) {
      statusParts.push(`Issues: ${health.issues.join('; ')}`);
    }

    if (health.services.indexing) {
      const progress = health.indexingProgress;
      statusParts.push(`Currently indexing: ${progress.phase} (${progress.progress}%)`);
    }

    return {
      success: true,
      message: statusParts.join(' '),
      data: health,
      teaching: {
        whatHappened: 'Checked archive health status',
        guiPath: [
          'Open the Archive panel (left side)',
          'Click the "Explore" tab',
          'Setup status shown if embeddings are missing',
        ],
        why: 'The health check shows if embeddings need to be built for semantic search to work.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Health check failed',
    };
  }
}

/**
 * Build embeddings for the archive
 */
export async function executeBuildEmbeddings(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { includeParagraphs = false } = params as { includeParagraphs?: boolean };

  try {
    const archiveServer = await getArchiveServerUrl();

    // First check if Ollama is available
    const healthResponse = await fetch(`${archiveServer}/api/embeddings/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      if (!health.services.ollama) {
        return {
          success: false,
          error: 'Ollama is not running. Start it with: ollama serve',
          teaching: {
            whatHappened: 'Embedding build cannot start without Ollama',
            guiPath: [
              'Open Terminal',
              'Run: ollama serve',
              'Then try building embeddings again',
            ],
            why: 'Ollama provides the local embedding model (nomic-embed-text) required for semantic search.',
          },
        };
      }

      if (health.services.indexing) {
        return {
          success: false,
          error: 'Embedding build is already in progress',
          data: health.indexingProgress,
        };
      }
    }

    // Start the build
    const response = await fetch(`${archiveServer}/api/embeddings/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeParagraphs }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Build failed to start' };
    }

    // Open the Explore tab to show progress
    dispatchOpenPanel('archives', 'explore');

    return {
      success: true,
      message: 'Embedding build started. Progress is shown in the Explore tab.',
      teaching: {
        whatHappened: 'Started building embeddings for your archive',
        guiPath: [
          'Archive panel > Explore tab shows progress',
          'Build runs in background',
          'Search will work when complete',
        ],
        why: 'Embeddings convert your conversations into semantic vectors, enabling search by meaning rather than just keywords.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Build failed',
    };
  }
}

/**
 * Search Facebook archive
 */
export async function executeSearchFacebook(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { query, type, limit = 20 } = params as {
    query?: string;
    type?: 'post' | 'comment' | 'all';
    limit?: number;
  };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const searchParams = new URLSearchParams({
      source: 'facebook',
      limit: String(limit),
    });

    if (type && type !== 'all') {
      searchParams.append('type', type);
    }

    const response = await fetch(
      `${archiveServer}/api/content/items?${searchParams}`
    );

    if (!response.ok) {
      return { success: false, error: 'Facebook search failed' };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.items) {
      console.warn('[search_facebook] API response missing items field');
    }

    // Client-side filter by query (server may not support text search)
    const q = query.toLowerCase();
    const filtered = (data.items || []).filter((item: { text?: string; title?: string }) =>
      item.text?.toLowerCase().includes(q) || item.title?.toLowerCase().includes(q)
    );

    return {
      success: true,
      message: `Found ${filtered.length} Facebook items matching "${query}"`,
      data: {
        results: filtered.slice(0, limit).map((item: { id: string; type: string; text?: string; title?: string; created_at: number; is_own_content: boolean }) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          textPreview: item.text?.slice(0, 150),
          created: item.created_at,
          isOwnContent: item.is_own_content,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Facebook search failed',
    };
  }
}

/**
 * Search content items (unified: notes, posts, comments, documents across all sources)
 * This is the universal content search tool - works across all imported archives.
 */
export async function executeSearchContent(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const {
    query,
    contentType,  // Optional: 'note' | 'post' | 'comment' | 'essay' | 'document'
    source,       // Optional: 'facebook' | 'reddit' | 'substack' | etc.
    ownContentOnly = false,
    limit = 20,
  } = params as {
    query?: string;
    contentType?: string;
    source?: string;
    ownContentOnly?: boolean;
    limit?: number;
  };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  try {
    const archiveServer = await getArchiveServerUrl();

    // Build query params
    const searchParams = new URLSearchParams({
      limit: String(limit),
    });

    if (source) {
      searchParams.append('source', source);
    }
    if (contentType) {
      searchParams.append('type', contentType);
    }

    // Fetch content items
    const response = await fetch(
      `${archiveServer}/api/content/items?${searchParams}`
    );

    if (!response.ok) {
      return { success: false, error: `Content search failed (HTTP ${response.status})` };
    }

    const data = await response.json();

    // Validate API response
    if (!data.items) {
      console.warn('[search_content] API response missing items field');
    }

    // Client-side filter by query (text search)
    const q = query.toLowerCase();
    let filtered = (data.items || []).filter((item: { text?: string; title?: string }) =>
      item.text?.toLowerCase().includes(q) || item.title?.toLowerCase().includes(q)
    );

    // Apply own content filter if requested
    if (ownContentOnly) {
      filtered = filtered.filter((item: { is_own_content: boolean }) => item.is_own_content);
    }

    // Map results
    const mappedResults = filtered.slice(0, limit).map((item: {
      id: string;
      type: string;
      source: string;
      text?: string;
      title?: string;
      created_at: number;
      is_own_content: boolean;
      author_name?: string;
    }) => ({
      id: item.id,
      type: item.type,
      source: item.source,
      title: item.title,
      textPreview: item.text?.slice(0, 200),
      created: item.created_at,
      isOwnContent: item.is_own_content,
      authorName: item.author_name,
    }));

    // Group by type for stats
    const typeCounts: Record<string, number> = {};
    for (const item of mappedResults) {
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    }

    const statsParts = Object.entries(typeCounts).map(
      ([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`
    );

    // Dispatch results to GUI
    dispatchSearchResults({
      results: mappedResults.map((r: {
        id: string;
        type: string;
        source: string;
        title?: string;
        textPreview?: string;
        created: number;
        isOwnContent: boolean;
        authorName?: string;
      }) => ({
        id: r.id,
        messageId: r.id,
        content: r.textPreview || '',
        similarity: 1,
        role: r.isOwnContent ? 'user' : 'assistant',
        title: r.title,
        type: r.type,
        source: r.source,
        authorName: r.authorName,
        createdAt: r.created,
      })),
      query: query,
      searchType: 'text',
      total: mappedResults.length,
    }, 'search_content');

    // Open Archive panel
    dispatchOpenPanel('archives', 'explore');

    return {
      success: true,
      message: `Found ${mappedResults.length} items matching "${query}"${statsParts.length > 0 ? ` (${statsParts.join(', ')})` : ''}`,
      data: {
        results: mappedResults,
        total: mappedResults.length,
        typeCounts,
      },
      teaching: {
        whatHappened: `Searched content for "${query}" across ${source ? source : 'all sources'}`,
        guiPath: [
          'Open Archive panel (left side)',
          `Go to ${source === 'facebook' ? 'Facebook' : 'Explore'} tab`,
          'Use the search box to filter content',
          'Click an item to view full text',
        ],
        why: 'Content search finds matches by keyword across all your imported archives - posts, notes, comments, and documents.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Content search failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILTER DISCOVERY TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Facet definition type (matches backend)
 */
interface FacetDefinition {
  field: string;
  label: string;
  type: 'enum' | 'date_range' | 'numeric_range' | 'boolean';
  source: string;
  distinctCount: number;
  topValues?: Array<{ value: string; count: number }>;
  range?: { min: number; max: number };
  coverage: number;
}

interface DiscoveryResult {
  facets: FacetDefinition[];
  discoveredAt: number;
  totalRecords: {
    conversations: number;
    contentItems: number;
    contentBlocks: number;
    messages: number;
  };
}

/**
 * Discover available filters in the archive
 *
 * Introspects the database to find what fields are available for filtering.
 * Different archives will have different filters based on their actual data.
 */
export async function executeDiscoverFilters(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { refresh = false } = params as { refresh?: boolean };

  try {
    const archiveServer = await getArchiveServerUrl();
    const endpoint = refresh
      ? `${archiveServer}/api/embeddings/discovery/refresh`
      : `${archiveServer}/api/embeddings/discovery/facets`;

    const response = await fetch(endpoint, {
      method: refresh ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Failed to discover filters: ${response.statusText}`,
        teaching: {
          whatHappened: 'Filter discovery failed',
          guiPath: ['Check that the archive server is running', 'Try refreshing the page'],
          why: 'Filter discovery requires access to the archive database.',
        },
      };
    }

    const result: DiscoveryResult = await response.json();

    // Dispatch facets to FilterContext via GUI Bridge
    dispatchSetFacets({ facets: result.facets }, 'discover_filters');

    // Open Archive panel to Explore tab
    dispatchOpenPanel('archives', 'explore');

    // Build human-readable summary
    const facetSummary = result.facets.map(f => {
      switch (f.type) {
        case 'enum':
          return `**${f.label}**: ${f.distinctCount} options (${f.topValues?.slice(0, 3).map(v => v.value).join(', ')}${f.distinctCount > 3 ? '...' : ''})`;
        case 'date_range':
          if (f.range) {
            const min = new Date(f.range.min * 1000).toLocaleDateString();
            const max = new Date(f.range.max * 1000).toLocaleDateString();
            return `**${f.label}**: ${min} to ${max}`;
          }
          return `**${f.label}**: date range`;
        case 'numeric_range':
          if (f.range) {
            return `**${f.label}**: ${f.range.min} to ${f.range.max}`;
          }
          return `**${f.label}**: numeric range`;
        case 'boolean':
          return `**${f.label}**: yes/no filter`;
        default:
          return `**${f.label}**: ${f.type}`;
      }
    });

    // Group by source
    const bySource: Record<string, string[]> = {};
    for (const facet of result.facets) {
      const source = facet.source;
      if (!bySource[source]) bySource[source] = [];
      bySource[source].push(facet.label);
    }

    const sourceGroups = Object.entries(bySource)
      .map(([source, labels]) => `${source}: ${labels.join(', ')}`)
      .join('\n');

    return {
      success: true,
      message: `Discovered ${result.facets.length} filter${result.facets.length !== 1 ? 's' : ''} in your archive`,
      content: `## Available Filters\n\n${facetSummary.join('\n')}\n\n### Filters by Source\n${sourceGroups}`,
      data: {
        facets: result.facets,
        totalRecords: result.totalRecords,
        discoveredAt: result.discoveredAt,
      },
      teaching: {
        whatHappened: refresh
          ? 'Refreshed filter discovery based on current archive data'
          : 'Discovered available filters based on your archive contents',
        guiPath: [
          'Open Archive panel',
          'Go to Explore tab',
          'Filter options appear above search results',
          'Click a filter to narrow your search',
        ],
        why: 'Different archives have different data. Filter discovery finds what filters make sense for YOUR archive, not a one-size-fits-all list.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Filter discovery failed',
    };
  }
}

/**
 * Apply a filter to narrow search results
 */
export async function executeApplyFilter(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { field, value } = params as { field?: string; value?: unknown };

  if (!field) {
    return {
      success: false,
      error: 'Missing field parameter. Specify which filter to apply.',
      teaching: {
        whatHappened: 'No filter field specified',
        guiPath: ['Run discover_filters first to see available filters'],
        why: 'You need to specify which field to filter by (e.g., "gizmo_id", "source", "author_name").',
      },
    };
  }

  if (value === undefined || value === null) {
    return {
      success: false,
      error: 'Missing value parameter. Specify the filter value.',
    };
  }

  // Dispatch the filter
  dispatchApplyFilter({ field, value }, 'apply_filter');

  // Open Archive panel
  dispatchOpenPanel('archives', 'explore');

  return {
    success: true,
    message: `Applied filter: ${field} = ${JSON.stringify(value)}`,
    teaching: {
      whatHappened: `Set filter on ${field}`,
      guiPath: ['Archive panel', 'Explore tab', 'Click filter chips to toggle'],
      why: 'Filters narrow your search to specific subsets of your archive.',
    },
  };
}

/**
 * Clear all active filters
 */
export async function executeClearFilters(): Promise<AUIToolResult> {
  dispatchClearFilters('clear_filters');
  dispatchOpenPanel('archives', 'explore');

  return {
    success: true,
    message: 'Cleared all active filters',
    teaching: {
      whatHappened: 'Removed all filter constraints',
      guiPath: ['Archive panel', 'Explore tab', 'Click "Clear all" or individual filter X buttons'],
      why: 'Clearing filters shows all results again.',
    },
  };
}
