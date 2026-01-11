/**
 * AUI Tools - Harvest Bucket Operations
 *
 * Handles harvest bucket management for book building:
 * - Harvest passages from archive into staging buckets
 * - Propose narrative arcs from approved passages
 * - Trace narrative arcs through archive
 * - Find resonant semantic mirrors
 * - Detect narrative gaps
 */

import type { AUIContext, AUIToolResult, SourcePassage, BookProject } from './types';
import { harvestBucketService } from '../../bookshelf/HarvestBucketService';
import type { NarrativeArc, ArcType } from '@humanizer/core';
import { getArchiveServerUrl } from '../../platform';
import { dispatchSearchResults, dispatchOpenPanel } from '../gui-bridge';

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: HARVEST BUCKET TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Harvest passages from archive into a HarvestBucket for review
 * Creates a staging area where users can approve/reject/gem passages
 */
export async function executeHarvestForThread(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, queries, config } = params as {
    book_uri?: string;
    queries?: string[];
    config?: {
      min_similarity?: number;
      max_results?: number;
      sources?: string[];
    };
  };

  // Get book URI from params or active project
  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project. Create or select a book first.',
    };
  }

  if (!queries || queries.length === 0) {
    return {
      success: false,
      error: 'Missing queries parameter. Provide at least one search query.',
    };
  }

  const minSimilarity = config?.min_similarity || 0.65;
  const maxResults = config?.max_results || 50;

  try {
    // Initialize harvest bucket service
    harvestBucketService.initialize();

    // Create a harvest bucket for this search
    const bucket = harvestBucketService.createBucket(bookUri, queries, {
      config: {
        minSimilarity,
        dedupeByContent: true,
        dedupeThreshold: 0.9,
      },
      initiatedBy: 'aui',
    });

    // Search archive for each query
    const archiveServer = await getArchiveServerUrl();
    let totalCandidates = 0;
    const resultsPerQuery = Math.ceil(maxResults / queries.length);

    for (const query of queries) {
      try {
        const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: resultsPerQuery * 2 }),
        });

        if (!response.ok) continue;

        const data = await response.json();

        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.results) {
          console.warn('[harvest_for_thread] API response missing results field');
        }
        const results = (data.results || [])
          .filter((r: { similarity: number }) => r.similarity >= minSimilarity)
          .slice(0, resultsPerQuery);

        // Convert to SourcePassage format and add as candidates
        for (const result of results as Array<{
          message_id: string;
          content: string;
          conversation_id: string;
          role: string;
          similarity: number;
          metadata?: { title?: string };
        }>) {
          const passage: SourcePassage = {
            id: result.message_id || crypto.randomUUID(),
            text: result.content,
            wordCount: result.content?.split(/\s+/).length || 0,
            sourceRef: {
              uri: `source://chatgpt/${result.conversation_id}` as `${string}://${string}`,
              sourceType: 'chatgpt',
              conversationId: result.conversation_id,
              conversationTitle: result.metadata?.title || `Harvested: ${query}`,
            },
            similarity: result.similarity,
            curation: {
              status: 'candidate',
            },
            tags: ['harvested', query.split(' ')[0]],
            harvestedBy: query,
          };

          harvestBucketService.addCandidate(bucket.id, passage);
          totalCandidates++;
        }
      } catch (e) {
        console.warn(`[harvest_for_thread] Query "${query}" failed:`, e);
      }
    }

    // Mark bucket as ready for review
    harvestBucketService.finishCollecting(bucket.id);

    // Get updated bucket with stats
    const updatedBucket = harvestBucketService.getBucket(bucket.id);

    // GUI Bridge: Open Tools panel → Harvest tab to show results
    dispatchOpenPanel('tools', 'harvest');

    return {
      success: true,
      message: `Harvested ${totalCandidates} passages from ${queries.length} queries`,
      data: {
        bucketId: bucket.id,
        candidateCount: totalCandidates,
        queries,
        status: 'reviewing',
        stats: updatedBucket?.stats,
      },
      teaching: {
        whatHappened: `Created a harvest bucket with ${totalCandidates} passages for review`,
        guiPath: [
          'Open the Tools panel (right side)',
          'Click the "Harvest" tab',
          'Review each passage - approve, reject, or mark as gem',
          'Stage when ready, then commit to book',
        ],
        why: 'The harvest bucket is a staging area. Review passages before they become part of your book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Harvest failed',
    };
  }
}

/**
 * Propose a narrative arc based on approved passages
 * Clusters passages by theme and suggests chapter structure
 */
export async function executeProposeNarrativeArc(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, arc_type, thesis } = params as {
    book_uri?: string;
    arc_type?: ArcType;
    thesis?: string;
  };

  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project.',
    };
  }

  // Get passages from context
  const passages = context.getPassages?.() || [];
  const approvedPassages = passages.filter(
    (p: SourcePassage) => p.curation?.status === 'approved' || p.curation?.status === 'gem'
  );

  if (approvedPassages.length < 3) {
    return {
      success: false,
      error: `Need at least 3 approved passages to propose a narrative arc. Currently have ${approvedPassages.length}.`,
    };
  }

  try {
    harvestBucketService.initialize();

    // Simple theme extraction (keyword clustering)
    const themeMap = new Map<string, string[]>();
    const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'where', 'these', 'those', 'being', 'having', 'making', 'during', 'through', 'because', 'while', 'after', 'before', 'between', 'within', 'without', 'something', 'anything', 'everything', 'nothing']);

    for (const passage of approvedPassages) {
      const text = typeof passage.content === 'string' ? passage.content : '';
      const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 5 && !commonWords.has(w));

      // Count frequencies
      const wordFreq = new Map<string, number>();
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }

      // Top keywords
      const topKeywords = Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => w);

      for (const kw of topKeywords) {
        if (!themeMap.has(kw)) themeMap.set(kw, []);
        themeMap.get(kw)!.push(passage.id);
      }
    }

    // Find major themes (appearing in 2+ passages)
    const themes = Array.from(themeMap.entries())
      .filter(([, ids]) => ids.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    // Build ArcTheme structures
    const arcThemes = themes.map(([name, passageIds], index) => ({
      id: `theme-${index + 1}`,
      name,
      description: `Theme appearing in ${passageIds.length} passages`,
      passageIds,
      coherence: passageIds.length / approvedPassages.length,
      relationships: [] as Array<{ targetThemeId: string; type: 'depends-on' | 'contrasts-with' | 'leads-to' | 'part-of'; strength: number }>,
    }));

    // Build ChapterOutline structures
    const chapters = themes.map(([theme, passageIds], index) => ({
      number: index + 1,
      title: theme.charAt(0).toUpperCase() + theme.slice(1),
      purpose: `Explore the theme of ${theme}`,
      primaryThemeId: `theme-${index + 1}`,
      passageIds,
      estimatedWordCount: passageIds.reduce((sum, id) => {
        const p = approvedPassages.find((p: SourcePassage) => p.id === id);
        return sum + (p?.wordCount || 0);
      }, 0),
    }));

    // Create narrative arc
    const arc = harvestBucketService.createArc(
      bookUri,
      thesis || `A ${arc_type || 'linear'} narrative exploring ${themes.map(([t]) => t).join(', ')}`,
      {
        arcType: arc_type || 'linear',
        proposedBy: 'aui',
      }
    );

    // Update arc with themes and chapters
    harvestBucketService.updateArc(arc.id, {
      themes: arcThemes,
      chapters,
    });

    return {
      success: true,
      message: `Proposed ${chapters.length}-chapter arc with ${themes.length} themes`,
      data: {
        arcId: arc.id,
        arcType: arc_type || 'linear',
        thesis: arc.thesis,
        chapters: chapters.map(c => ({
          title: c.title,
          passageCount: c.passageIds.length,
          estimatedWords: c.estimatedWordCount,
        })),
        themes: themes.map(([name, ids]) => ({
          name,
          passageCount: ids.length,
        })),
      },
      teaching: {
        whatHappened: `Analyzed ${approvedPassages.length} passages and proposed a ${chapters.length}-chapter structure`,
        guiPath: [
          'Archive → Books → [project] → Thinking tab',
          'Review proposed arc',
          'Approve or provide feedback',
        ],
        why: 'Narrative arcs help organize passages into a coherent story. Review and adjust the proposed structure.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to propose narrative arc',
    };
  }
}

/**
 * Trace a narrative arc through the archive
 * Uses semantic search to find chronological progression of a theme
 *
 * This tool helps find:
 * - How an idea evolved over time
 * - The progressive revelation of a theme
 * - Chronological story threads
 */
export async function executeTraceNarrativeArc(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const {
    theme,
    start_date,
    end_date,
    arc_type = 'progressive',
    limit = 20,
    save_to_harvest = false,
  } = params as {
    theme: string;
    start_date?: string;
    end_date?: string;
    arc_type?: 'progressive' | 'chronological' | 'thematic' | 'dialectic';
    limit?: number;
    save_to_harvest?: boolean;
  };

  if (!theme) {
    return {
      success: false,
      error: 'Provide a theme to trace through the archive.',
    };
  }

  try {
    const archiveServer = await getArchiveServerUrl();

    // Build search queries based on arc type
    const queries: string[] = [];
    switch (arc_type) {
      case 'progressive':
        // Find how understanding evolved
        queries.push(theme);
        queries.push(`early thoughts on ${theme}`);
        queries.push(`realization about ${theme}`);
        queries.push(`understanding ${theme}`);
        queries.push(`conclusion about ${theme}`);
        break;
      case 'chronological':
        // Just search the theme, will sort by date
        queries.push(theme);
        break;
      case 'thematic':
        // Find variations on the theme
        queries.push(theme);
        queries.push(`${theme} and its implications`);
        queries.push(`different aspects of ${theme}`);
        break;
      case 'dialectic':
        // Find thesis, antithesis, synthesis
        queries.push(`${theme} thesis argument for`);
        queries.push(`${theme} counterpoint against critique`);
        queries.push(`${theme} synthesis resolution integration`);
        break;
    }

    // Collect results from all queries
    const allResults: Array<{
      id: string;
      content: string;
      similarity: number;
      conversation_id: string;
      message_id?: string;
      created_at?: number;
      title?: string;
      query_phase: string;
    }> = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: Math.ceil(limit / queries.length) * 2,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.results) {
          console.warn('[trace_narrative_arc] API response missing results field');
        }
        const results = data.results || [];

        for (const r of results) {
          // Skip duplicates
          if (!allResults.some(ar => ar.message_id === r.message_id)) {
            allResults.push({
              id: r.id || r.message_id,
              content: r.content,
              similarity: r.similarity,
              conversation_id: r.conversation_id,
              message_id: r.message_id,
              created_at: r.created_at,
              title: r.metadata?.title || r.conversation_title,
              query_phase: arc_type === 'progressive' ?
                ['beginning', 'early', 'middle', 'development', 'conclusion'][i] || 'middle' :
                arc_type === 'dialectic' ?
                  ['thesis', 'antithesis', 'synthesis'][i] || 'thesis' :
                  'thematic',
            });
          }
        }
      }
    }

    // Sort by date for chronological arc, or by query phase for progressive
    if (arc_type === 'chronological') {
      allResults.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    }

    // Limit results
    const arcResults = allResults.slice(0, limit);

    // Group by phase for progressive/dialectic arcs
    const phases = new Map<string, typeof arcResults>();
    for (const r of arcResults) {
      const phase = r.query_phase;
      if (!phases.has(phase)) {
        phases.set(phase, []);
      }
      phases.get(phase)!.push(r);
    }

    // Optionally save to harvest bucket
    let bucketId: string | undefined;
    if (save_to_harvest && context.activeProject) {
      harvestBucketService.initialize();

      const bookUri = (context.activeProject as BookProject & { uri?: string })?.uri;
      if (bookUri) {
        const bucket = harvestBucketService.createBucket(bookUri, [theme], {
          initiatedBy: 'aui',
        });
        bucketId = bucket.id;

        // Add results as candidates
        for (const r of arcResults) {
          const passage: SourcePassage = {
            id: r.message_id || crypto.randomUUID(),
            text: r.content,
            wordCount: r.content?.split(/\s+/).length || 0,
            sourceRef: {
              uri: `source://chatgpt/${r.conversation_id}` as `${string}://${string}`,
              sourceType: 'chatgpt',
              conversationId: r.conversation_id,
              conversationTitle: r.title || 'Arc Trace',
            },
            similarity: r.similarity,
            curation: {
              status: 'candidate',
            },
            tags: ['arc-trace', r.query_phase, theme.split(' ')[0]],
          };
          harvestBucketService.addCandidate(bucket.id, passage);
        }

        harvestBucketService.finishCollecting(bucket.id);
        dispatchOpenPanel('tools', 'harvest');
      }
    }

    // Format arc structure for response
    const arcStructure = Array.from(phases.entries()).map(([phase, passages]) => ({
      phase,
      count: passages.length,
      samples: passages.slice(0, 2).map(p => ({
        preview: p.content.slice(0, 150) + '...',
        source: p.title,
        date: p.created_at ? new Date(p.created_at).toLocaleDateString() : undefined,
      })),
    }));

    // Dispatch to GUI
    dispatchSearchResults({
      results: arcResults.map(r => ({
        id: r.id,
        content: r.content,
        similarity: r.similarity,
        conversationId: r.conversation_id,
        title: r.title,
      })),
      query: theme,
      searchType: 'semantic',
      total: arcResults.length,
    }, theme);
    dispatchOpenPanel('archives', 'explore');

    return {
      success: true,
      message: `Traced "${theme}" arc: found ${arcResults.length} passages across ${phases.size} phases`,
      data: {
        theme,
        arcType: arc_type,
        totalPassages: arcResults.length,
        phases: arcStructure,
        bucketId,
        dateRange: arcResults.length > 0 ? {
          earliest: arcResults.find(r => r.created_at)?.created_at,
          latest: [...arcResults].reverse().find(r => r.created_at)?.created_at,
        } : undefined,
      },
      teaching: {
        whatHappened: `Found ${arcResults.length} passages tracing the "${arc_type}" arc of "${theme}"`,
        guiPath: [
          'Results shown in Archive → Explore tab',
          save_to_harvest ? 'Also saved to Tools → Harvest for curation' : 'Use save_to_harvest: true to save for curation',
          'Click any result to see full context',
        ],
        why: arc_type === 'progressive' ?
          'Progressive arcs show how understanding evolved over time - the journey of an idea.' :
          arc_type === 'dialectic' ?
            'Dialectic arcs show thesis/antithesis/synthesis - the resolution of tensions.' :
            'Chronological arcs reveal when ideas emerged and how they relate in time.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to trace narrative arc',
    };
  }
}

/**
 * Find passages that resonate semantically with a given passage
 * Uses embedding similarity to discover connections
 */
export async function executeFindResonantMirrors(
  params: Record<string, unknown>,
  _context: AUIContext
): Promise<AUIToolResult> {
  const { passage_id, passage_text, search_scope, limit = 10 } = params as {
    passage_id?: string;
    passage_text?: string;
    search_scope?: 'book' | 'archive' | 'all';
    limit?: number;
  };

  if (!passage_text && !passage_id) {
    return {
      success: false,
      error: 'Provide either passage_text or passage_id to find resonant mirrors.',
    };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const query = passage_text || '';

    // Search for similar messages
    const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: limit * 2 }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'Semantic search failed. Ensure embeddings are built.',
      };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.results) {
      console.warn('[find_resonant_mirrors] API response missing results field');
    }
    let results = data.results || [];

    // Filter by scope if book scope requested (would need book context)
    if (search_scope === 'book') {
      // For book scope, we'd need to filter by book passages
      // For now, just limit results
      results = results.slice(0, limit);
    } else {
      results = results.slice(0, limit);
    }

    const mirrors = results.map((r: {
      message_id: string;
      content: string;
      similarity: number;
      conversation_id: string;
      metadata?: { title?: string };
    }) => ({
      id: r.message_id,
      text: r.content?.slice(0, 200) + (r.content?.length > 200 ? '...' : ''),
      similarity: Math.round(r.similarity * 1000) / 1000,
      conversationId: r.conversation_id,
      conversationTitle: r.metadata?.title || 'Unknown',
    }));

    return {
      success: true,
      message: `Found ${mirrors.length} resonant passages`,
      data: {
        sourcePassageId: passage_id,
        sourceText: passage_text?.slice(0, 100) + '...',
        scope: search_scope || 'archive',
        mirrors,
      },
      teaching: {
        whatHappened: `Found ${mirrors.length} passages that resonate semantically with the source`,
        guiPath: [
          'Archive → Explore → Semantic Search',
          'Paste your passage text',
          'Results ranked by meaning similarity',
        ],
        why: 'Resonant mirrors reveal thematic connections across your archive. Use them to build richer narratives.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to find resonant mirrors',
    };
  }
}

/**
 * Detect narrative gaps in a book's chapter structure
 * Analyzes transitions and identifies missing content
 */
export async function executeDetectNarrativeGaps(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, arc_id } = params as {
    book_uri?: string;
    arc_id?: string;
  };

  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project.',
    };
  }

  try {
    harvestBucketService.initialize();

    // Get arcs for this book
    const arcs = harvestBucketService.getArcsForBook(bookUri);
    const arc = arc_id ? arcs.find(a => a.id === arc_id) : arcs[0];

    if (!arc) {
      return {
        success: false,
        error: 'No narrative arc found. Use propose_narrative_arc first.',
      };
    }

    // Analyze chapters for gaps
    const chapters = (arc as NarrativeArc & { chapters?: Array<{ id: string; title: string; passageCount?: number; estimatedWordCount?: number }> }).chapters || [];
    const gaps: Array<{
      type: 'conceptual' | 'transitional' | 'emotional' | 'structural';
      location: string;
      description: string;
      suggestion: string;
    }> = [];

    // Check for structural gaps
    if (chapters.length < 3) {
      gaps.push({
        type: 'structural',
        location: 'book',
        description: 'Book has fewer than 3 chapters',
        suggestion: 'Consider breaking content into more chapters for better pacing.',
      });
    }

    // Check for thin chapters
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if ((chapter.passageCount || 0) < 2) {
        gaps.push({
          type: 'conceptual',
          location: `Chapter ${i + 1}: ${chapter.title}`,
          description: `Only ${chapter.passageCount || 0} passages`,
          suggestion: `Search archive for more content about "${chapter.title}".`,
        });
      }
      if ((chapter.estimatedWordCount || 0) < 500) {
        gaps.push({
          type: 'structural',
          location: `Chapter ${i + 1}: ${chapter.title}`,
          description: `Very short (~${chapter.estimatedWordCount || 0} words)`,
          suggestion: 'Consider merging with adjacent chapter or adding content.',
        });
      }
    }

    // Check for transitional gaps (no content between distinct themes)
    for (let i = 0; i < chapters.length - 1; i++) {
      const current = chapters[i];
      const next = chapters[i + 1];
      // Simple heuristic: if titles share no keywords, might need transition
      const currentWords = new Set(current.title.toLowerCase().split(/\s+/));
      const nextWords = new Set(next.title.toLowerCase().split(/\s+/));
      const overlap = [...currentWords].filter(w => nextWords.has(w)).length;

      if (overlap === 0 && currentWords.size > 0 && nextWords.size > 0) {
        gaps.push({
          type: 'transitional',
          location: `Between "${current.title}" and "${next.title}"`,
          description: 'Distinct themes with no obvious bridge',
          suggestion: `Look for passages that connect ${current.title} to ${next.title}.`,
        });
      }
    }

    return {
      success: true,
      message: `Found ${gaps.length} potential gaps in narrative`,
      data: {
        arcId: arc.id,
        chapterCount: chapters.length,
        gaps,
        summary: {
          conceptual: gaps.filter(g => g.type === 'conceptual').length,
          transitional: gaps.filter(g => g.type === 'transitional').length,
          structural: gaps.filter(g => g.type === 'structural').length,
        },
      },
      teaching: {
        whatHappened: `Analyzed ${chapters.length} chapters and found ${gaps.length} areas for improvement`,
        guiPath: [
          'Archive → Books → [project] → Thinking tab → Gaps',
          'Review each gap',
          'Use harvest_for_thread to fill conceptual gaps',
        ],
        why: 'Narrative gaps break reader flow. Filling them creates a more cohesive book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to detect narrative gaps',
    };
  }
}
