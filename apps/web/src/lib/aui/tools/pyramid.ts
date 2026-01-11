/**
 * AUI Tools - Pyramid Building Operations
 *
 * Handles pyramid construction and search:
 * - Build pyramids from book passages or text
 * - Get pyramid structure for active book
 * - Search within pyramid chunks
 */

import type { AUIContext, AUIToolResult } from './types';
import { buildPyramid, searchChunks } from '../../pyramid';

// ═══════════════════════════════════════════════════════════════════
// PYRAMID BUILDING TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a pyramid from book passages or text
 */
export async function executeBuildPyramid(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, usePassages } = params as {
    text?: string;
    usePassages?: boolean;
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  // Determine source content
  let sourceText = text;

  if (!sourceText && usePassages !== false && context.getPassages) {
    // Build from approved/gem passages
    const passages = context.getPassages();
    const usablePassages = passages.filter(
      p => (p.curation?.status || p.status) === 'gem' || (p.curation?.status || p.status) === 'approved'
    );

    if (usablePassages.length === 0) {
      return {
        success: false,
        error: 'No approved or gem passages to build pyramid from. Mark some passages as approved or gem first.',
      };
    }

    sourceText = usablePassages
      .map(p => p.text || p.content || '')
      .filter(t => t.length > 0)
      .join('\n\n---\n\n');
  }

  // Fall back to workspace content
  if (!sourceText && context.workspace) {
    if (context.workspace.bufferContent) {
      sourceText = context.workspace.bufferContent;
    }
  }

  if (!sourceText) {
    return {
      success: false,
      error: 'No text provided and no passages or workspace content available',
    };
  }

  if (sourceText.length < 500) {
    return {
      success: false,
      error: 'Text must be at least 500 characters for meaningful pyramid building',
    };
  }

  try {
    const result = await buildPyramid(sourceText, {
      sourceInfo: {
        bookTitle: context.activeProject.name,
        author: context.activeProject.author,
      },
      onProgress: (progress) => {
        // Progress could be sent to UI via callback
        console.log(`[Pyramid] ${progress.message}`);
      },
    });

    if (!result.success || !result.pyramid) {
      return {
        success: false,
        error: result.error || 'Pyramid building failed',
      };
    }

    const pyramid = result.pyramid;
    const wordCount = sourceText.split(/\s+/).length;

    return {
      success: true,
      message: `Built ${pyramid.meta.depth}-level pyramid from ${wordCount} words`,
      data: {
        depth: pyramid.meta.depth,
        totalChunks: pyramid.meta.chunkCount,
        totalSummaries: pyramid.summaries.length,
        compressionRatio: pyramid.meta.compressionRatio.toFixed(1),
        apex: pyramid.apex ? {
          summary: pyramid.apex.summary.substring(0, 200) + '...',
          themes: pyramid.apex.themes,
          characters: pyramid.apex.characters,
          arc: pyramid.apex.arc,
          mood: pyramid.apex.mood,
        } : null,
        processingTimeMs: result.stats.processingTimeMs,
      },
      teaching: {
        whatHappened: `Processed ${wordCount} words into ${pyramid.meta.chunkCount} chunks, built ${pyramid.meta.depth} levels of summaries, and extracted ${pyramid.apex?.themes?.length || 0} themes.`,
        guiPath: ['Book Panel', 'Profile Tab', 'Build Pyramid'],
        why: 'Pyramid summarization lets your book "know itself" - the apex contains themes, characters, and arc that can guide editing and help readers understand the work at any level of depth.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Pyramid building failed',
    };
  }
}

/**
 * Get the pyramid structure for the active book
 */
export function executeGetPyramid(context: AUIContext): AUIToolResult {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  const pyramid = context.activeProject.pyramid;

  if (!pyramid || !pyramid.chunks || pyramid.chunks.length === 0) {
    return {
      success: true,
      message: 'No pyramid built for this book yet',
      data: { hasPyramid: false },
      teaching: {
        whatHappened: 'This book does not have a pyramid structure yet.',
        guiPath: ['Book Panel', 'Profile Tab', 'Build Pyramid'],
        why: 'Use the build_pyramid tool to create one from your passages or provide text directly.',
      },
    };
  }

  const apex = pyramid.apex;

  return {
    success: true,
    message: `${pyramid.chunks.length} chunks, ${pyramid.summaries?.length || 0} summaries, ${apex ? 'apex complete' : 'no apex'}`,
    data: {
      hasPyramid: true,
      depth: (pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0) + 1,
      chunkCount: pyramid.chunks.length,
      summaryCount: pyramid.summaries?.length || 0,
      hasApex: !!apex,
      apex: apex ? {
        summary: apex.summary?.substring(0, 300),
        themes: apex.themes,
        characters: apex.characters,
        arc: apex.arc,
        mood: apex.mood,
        generatedAt: apex.generatedAt,
      } : null,
      levels: (() => {
        const levels: Array<{ level: number; count: number; avgWords: number }> = [];
        // L0 - chunks
        const chunkWords = pyramid.chunks.map(c => c.wordCount || 0);
        levels.push({
          level: 0,
          count: pyramid.chunks.length,
          avgWords: Math.round(chunkWords.reduce((a, b) => a + b, 0) / chunkWords.length || 0),
        });
        // L1+ - summaries
        const maxLevel = pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0;
        for (let l = 1; l <= maxLevel; l++) {
          const levelSummaries = pyramid.summaries?.filter(s => s.level === l) || [];
          const words = levelSummaries.map(s => s.wordCount || 0);
          levels.push({
            level: l,
            count: levelSummaries.length,
            avgWords: Math.round(words.reduce((a, b) => a + b, 0) / words.length || 0),
          });
        }
        return levels;
      })(),
    },
    teaching: {
      whatHappened: `This book has a ${pyramid.chunks.length}-chunk pyramid with ${apex ? 'a complete apex' : 'no apex yet'}.`,
      guiPath: ['Book Panel', 'Profile Tab'],
      why: 'The pyramid lets you understand the book at any level of detail - from individual passages up to the complete thematic summary.',
    },
  };
}

/**
 * Search within the pyramid's chunks
 */
export function executeSearchPyramid(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { query, limit = 5 } = params as { query?: string; limit?: number };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  const pyramid = context.activeProject.pyramid;

  if (!pyramid || !pyramid.chunks || pyramid.chunks.length === 0) {
    return {
      success: false,
      error: 'No pyramid built for this book. Use build_pyramid first.',
    };
  }

  try {
    // Create a temporary pyramid structure for the search function
    const pyramidStructure = {
      chunks: pyramid.chunks,
      summaries: pyramid.summaries || [],
      apex: pyramid.apex,
      meta: {
        depth: (pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0) + 1,
        chunkCount: pyramid.chunks.length,
        sourceWordCount: pyramid.chunks.reduce((sum, c) => sum + (c.wordCount || 0), 0),
        compressionRatio: 1,
        builtAt: pyramid.apex?.generatedAt || Date.now(),
        config: {
          chunkSize: 300,
          compressionTarget: 5,
          summarizerModel: 'haiku',
          extractorModel: 'sonnet',
          computeEmbeddings: false,
        },
      },
    };

    const results = searchChunks(pyramidStructure, query, { limit });

    return {
      success: true,
      message: `Found ${results.length} matching chunk(s) for "${query}"`,
      data: {
        query,
        results: results.map(r => ({
          chunkId: r.chunk.id,
          index: r.chunk.index,
          score: r.score.toFixed(3),
          preview: r.chunk.content.substring(0, 150) + '...',
          wordCount: r.chunk.wordCount,
        })),
      },
      teaching: {
        whatHappened: `Searched ${pyramid.chunks.length} chunks and found ${results.length} matches for "${query}".`,
        guiPath: ['Book Panel', 'Profile Tab', 'Search Pyramid'],
        why: 'Searching the pyramid helps you find specific passages within the hierarchical structure of your book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Pyramid search failed',
    };
  }
}
