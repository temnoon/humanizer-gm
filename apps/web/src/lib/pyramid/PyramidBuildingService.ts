/**
 * Pyramid Building Service
 *
 * Builds hierarchical summarization pyramids from text content.
 * Integrates with NPE-API for LLM-based summarization.
 *
 * Pipeline:
 * 1. Chunk text into L0 nodes (~300 words each)
 * 2. Summarize groups of chunks into L1 summaries
 * 3. Continue summarizing until reaching apex
 * 4. Extract themes, characters, arc from apex
 */

import { getStoredToken } from '../auth';
import type {
  PyramidChunk,
  PyramidSummary,
  PyramidApex,
  PyramidStructure,
  PyramidConfig,
} from '@humanizer/core';
import type {
  PyramidBuildOptions,
  PyramidBuildResult,
  TextChunk,
  ChunkingConfig,
  SummarizeResponse,
  ExtractApexResponse,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';
const CHILDREN_PER_SUMMARY = 5; // Group 5 items per summary

// Default config (re-exported from core but with fallback)
const DEFAULT_CONFIG: PyramidConfig = {
  chunkSize: 300,
  compressionTarget: 5,
  summarizerModel: 'haiku',
  extractorModel: 'sonnet',
  computeEmbeddings: false, // Client doesn't compute embeddings
};

// ═══════════════════════════════════════════════════════════════════
// CHUNKING (Client-Side)
// ═══════════════════════════════════════════════════════════════════

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  // Match sentence boundaries
  const sentences = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g);
  return sentences ? sentences.map(s => s.trim()).filter(s => s.length > 0) : [text];
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Chunk text into groups of ~targetWords
 */
export function chunkText(
  text: string,
  config: Partial<ChunkingConfig> = {}
): TextChunk[] {
  const cfg: ChunkingConfig = {
    targetWords: config.targetWords ?? 300,
    maxWords: config.maxWords ?? 500,
    minWords: config.minWords ?? 100,
  };

  const sentences = splitSentences(text);
  const chunks: TextChunk[] = [];

  let currentSentences: string[] = [];
  let currentWords = 0;
  let currentStart = 0;

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);

    // If adding this sentence exceeds target and we have enough content, finalize
    if (currentWords + sentenceWords > cfg.targetWords && currentWords >= cfg.minWords) {
      const content = currentSentences.join(' ');
      chunks.push({
        content,
        wordCount: currentWords,
        charCount: content.length,
        sentenceCount: currentSentences.length,
        startOffset: currentStart,
        endOffset: currentStart + content.length,
      });

      // Start new chunk
      currentStart = currentStart + content.length + 1;
      currentSentences = [sentence];
      currentWords = sentenceWords;
    } else {
      currentSentences.push(sentence);
      currentWords += sentenceWords;
    }

    // Safety: force chunk if way over max
    if (currentWords > cfg.maxWords) {
      const content = currentSentences.join(' ');
      chunks.push({
        content,
        wordCount: currentWords,
        charCount: content.length,
        sentenceCount: currentSentences.length,
        startOffset: currentStart,
        endOffset: currentStart + content.length,
      });
      currentStart = currentStart + content.length + 1;
      currentSentences = [];
      currentWords = 0;
    }
  }

  // Don't forget the last chunk
  if (currentSentences.length > 0) {
    const content = currentSentences.join(' ');
    if (currentWords >= cfg.minWords) {
      chunks.push({
        content,
        wordCount: currentWords,
        charCount: content.length,
        sentenceCount: currentSentences.length,
        startOffset: currentStart,
        endOffset: currentStart + content.length,
      });
    } else if (chunks.length > 0) {
      // Merge with previous chunk if too small
      const lastChunk = chunks[chunks.length - 1];
      lastChunk.content += ' ' + content;
      lastChunk.wordCount += currentWords;
      lastChunk.charCount = lastChunk.content.length;
      lastChunk.sentenceCount += currentSentences.length;
      lastChunk.endOffset = currentStart + content.length;
    } else {
      // Only chunk, even if small
      chunks.push({
        content,
        wordCount: currentWords,
        charCount: content.length,
        sentenceCount: currentSentences.length,
        startOffset: currentStart,
        endOffset: currentStart + content.length,
      });
    }
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════
// LLM API CALLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Call NPE-API for text summarization
 */
async function callSummarize(
  texts: string[],
  targetWords: number,
  context?: { bookTitle?: string; author?: string; level: number },
  signal?: AbortSignal
): Promise<SummarizeResponse> {
  const startTime = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Build prompt for summarization
  const prompt = buildSummaryPrompt(texts, targetWords, context);

  try {
    const response = await fetch(`${API_BASE}/chat/completion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        model: 'haiku',
        max_tokens: targetWords * 2,
        temperature: 0.3,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Summarization failed: ${response.statusText}`);
    }

    const data = await response.json() as { content?: string; response?: string };
    const summary = data.content || data.response || '';

    return {
      summary: summary.trim(),
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    // Fallback: concatenate first sentences
    const fallback = texts
      .map(t => t.split(/[.!?]/)[0] + '.')
      .join(' ')
      .substring(0, targetWords * 5);

    return {
      summary: fallback,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Call NPE-API for apex extraction
 */
async function callExtractApex(
  summaries: string[],
  context?: { bookTitle?: string; author?: string },
  signal?: AbortSignal
): Promise<ExtractApexResponse> {
  const startTime = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const prompt = buildApexPrompt(summaries, context);

  try {
    const response = await fetch(`${API_BASE}/chat/completion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: APEX_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        model: 'sonnet',
        max_tokens: 1500,
        temperature: 0.4,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Apex extraction failed: ${response.statusText}`);
    }

    const data = await response.json() as { content?: string; response?: string };
    const rawApex = data.content || data.response || '';

    // Parse structured response
    const parsed = parseApexResponse(rawApex);

    return {
      ...parsed,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    // Fallback apex
    return {
      summary: summaries.join(' ').substring(0, 500),
      themes: ['unknown'],
      characters: [],
      processingTimeMs: Date.now() - startTime,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════

const SUMMARY_SYSTEM_PROMPT = `You are a literary summarizer creating condensed versions of text passages while preserving their essential narrative content.

Your summaries must preserve:
- Key events and plot points
- Character actions and revelations
- Emotional tone and atmosphere
- Thematic elements
- Narrative voice

Be concise but comprehensive. Write in flowing prose, not bullet points.`;

const APEX_SYSTEM_PROMPT = `You are a literary analyst creating the essential understanding of a complete text. Your analysis will serve as a curator's "consciousness" - the working knowledge that enables authentic engagement with readers.

Your analysis must capture:
1. SUMMARY: A concise overview of the complete work
2. THEMES: 3-5 central themes
3. CHARACTERS: Key characters and their roles
4. ARC: The narrative trajectory
5. MOOD: The overall emotional tone

Respond in JSON format with these exact fields: summary, themes, characters, arc, mood`;

function buildSummaryPrompt(
  texts: string[],
  targetWords: number,
  context?: { bookTitle?: string; author?: string; level: number }
): string {
  const contextLine = context?.bookTitle
    ? `From "${context.bookTitle}"${context.author ? ` by ${context.author}` : ''} (Level ${context.level} summary):`
    : '';

  return `${contextLine}

Summarize the following passages into approximately ${targetWords} words. Preserve key events, characters, themes, and tone.

PASSAGES:
${texts.map((t, i) => `--- Passage ${i + 1} ---\n${t}`).join('\n\n')}

SUMMARY (approximately ${targetWords} words):`;
}

function buildApexPrompt(
  summaries: string[],
  context?: { bookTitle?: string; author?: string }
): string {
  const contextLine = context?.bookTitle
    ? `Analyze "${context.bookTitle}"${context.author ? ` by ${context.author}` : ''}:`
    : 'Analyze the following text:';

  return `${contextLine}

HIGH-LEVEL SUMMARIES:
${summaries.map((s, i) => `--- Section ${i + 1} ---\n${s}`).join('\n\n')}

Provide a comprehensive analysis in JSON format:
{
  "summary": "A 2-3 sentence overview of the complete work",
  "themes": ["theme1", "theme2", "theme3"],
  "characters": ["character1", "character2"],
  "arc": "Brief description of the narrative arc",
  "mood": "Overall emotional tone"
}`;
}

function parseApexResponse(response: string): Omit<ExtractApexResponse, 'processingTimeMs'> {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || response.substring(0, 300),
        themes: Array.isArray(parsed.themes) ? parsed.themes : ['unknown'],
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        arc: parsed.arc,
        mood: parsed.mood,
      };
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: extract what we can
  return {
    summary: response.substring(0, 500),
    themes: ['unknown'],
    characters: [],
  };
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID BUILDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a complete pyramid from text content
 */
export async function buildPyramid(
  text: string,
  options: PyramidBuildOptions = {}
): Promise<PyramidBuildResult> {
  const startTime = Date.now();
  const config: PyramidConfig = { ...DEFAULT_CONFIG, ...options };
  const { onProgress, signal, sourceInfo } = options;

  try {
    // Phase 1: Chunking
    onProgress?.({
      phase: 'chunking',
      currentLevel: 0,
      totalLevels: 1,
      itemsProcessed: 0,
      itemsTotal: 1,
      message: 'Splitting text into chunks...',
    });

    const textChunks = chunkText(text, { targetWords: config.chunkSize });

    // Estimate total levels
    const estimatedDepth = Math.ceil(
      Math.log(textChunks.length) / Math.log(config.compressionTarget)
    ) + 1;

    // Convert to PyramidChunks
    const chunks: PyramidChunk[] = textChunks.map((chunk, index) => ({
      id: `chunk-${index}`,
      level: 0 as const,
      index,
      content: chunk.content,
      wordCount: chunk.wordCount,
      charCount: chunk.charCount,
      sentenceCount: chunk.sentenceCount,
      source: {
        chapterId: sourceInfo?.chapterId,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      },
    }));

    onProgress?.({
      phase: 'chunking',
      currentLevel: 0,
      totalLevels: estimatedDepth,
      itemsProcessed: chunks.length,
      itemsTotal: chunks.length,
      message: `Created ${chunks.length} chunks`,
    });

    // Phase 2: Build summary levels
    const summaries: PyramidSummary[] = [];
    let currentLevel = 0;
    let currentItems: Array<{ id: string; content: string; wordCount: number }> = chunks.map(c => ({
      id: c.id,
      content: c.content,
      wordCount: c.wordCount,
    }));

    while (currentItems.length > CHILDREN_PER_SUMMARY) {
      currentLevel++;
      const groups = groupItems(currentItems, CHILDREN_PER_SUMMARY);
      const levelSummaries: PyramidSummary[] = [];

      onProgress?.({
        phase: 'summarizing',
        currentLevel,
        totalLevels: estimatedDepth,
        itemsProcessed: 0,
        itemsTotal: groups.length,
        message: `Building level ${currentLevel} summaries...`,
      });

      for (let i = 0; i < groups.length; i++) {
        if (signal?.aborted) {
          throw new Error('Build cancelled');
        }

        const group = groups[i];
        const texts = group.map(item => item.content);
        const targetWords = Math.ceil(
          group.reduce((sum, item) => sum + item.wordCount, 0) / config.compressionTarget
        );

        const response = await callSummarize(
          texts,
          targetWords,
          {
            bookTitle: sourceInfo?.bookTitle,
            author: sourceInfo?.author,
            level: currentLevel,
          },
          signal
        );

        const summary: PyramidSummary = {
          id: `summary-L${currentLevel}-${i}`,
          level: currentLevel,
          index: i,
          content: response.summary,
          wordCount: countWords(response.summary),
          childIds: group.map(item => item.id),
          compressionRatio: group.reduce((sum, item) => sum + item.wordCount, 0) / countWords(response.summary),
          keyPoints: response.keyPoints,
          generatedBy: {
            model: config.summarizerModel,
            timestamp: Date.now(),
          },
        };

        levelSummaries.push(summary);
        summaries.push(summary);

        onProgress?.({
          phase: 'summarizing',
          currentLevel,
          totalLevels: estimatedDepth,
          itemsProcessed: i + 1,
          itemsTotal: groups.length,
          message: `Level ${currentLevel}: ${i + 1}/${groups.length} summaries`,
        });
      }

      // Move to next level
      currentItems = levelSummaries.map(s => ({
        id: s.id,
        content: s.content,
        wordCount: s.wordCount,
      }));
    }

    // Phase 3: Build apex
    onProgress?.({
      phase: 'apex',
      currentLevel: currentLevel + 1,
      totalLevels: currentLevel + 1,
      itemsProcessed: 0,
      itemsTotal: 1,
      message: 'Extracting themes and building apex...',
    });

    const apexTexts = currentItems.map(item => item.content);
    const apexResponse = await callExtractApex(
      apexTexts,
      sourceInfo,
      signal
    );

    const apex: PyramidApex = {
      summary: apexResponse.summary,
      themes: apexResponse.themes,
      characters: apexResponse.characters,
      arc: apexResponse.arc,
      mood: apexResponse.mood,
      generatedAt: Date.now(),
      generatedBy: {
        summarizer: config.summarizerModel,
        extractor: config.extractorModel,
      },
    };

    // Build final structure
    const sourceWordCount = chunks.reduce((sum, c) => sum + c.wordCount, 0);
    const pyramid: PyramidStructure = {
      chunks,
      summaries,
      apex,
      meta: {
        depth: currentLevel + 1,
        chunkCount: chunks.length,
        sourceWordCount,
        compressionRatio: sourceWordCount / countWords(apex.summary),
        builtAt: Date.now(),
        config,
      },
    };

    onProgress?.({
      phase: 'complete',
      currentLevel: currentLevel + 1,
      totalLevels: currentLevel + 1,
      itemsProcessed: 1,
      itemsTotal: 1,
      message: 'Pyramid complete!',
    });

    return {
      success: true,
      pyramid,
      stats: {
        totalChunks: chunks.length,
        totalSummaries: summaries.length,
        pyramidDepth: currentLevel + 1,
        compressionRatio: pyramid.meta.compressionRatio,
        processingTimeMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats: {
        totalChunks: 0,
        totalSummaries: 0,
        pyramidDepth: 0,
        compressionRatio: 0,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Group items for summarization
 */
function groupItems<T>(items: T[], groupSize: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += groupSize) {
    groups.push(items.slice(i, i + groupSize));
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Navigate to a specific level of the pyramid
 */
export function getPyramidLevel(
  pyramid: PyramidStructure,
  level: number
): Array<PyramidChunk | PyramidSummary> {
  if (level === 0) return pyramid.chunks;
  return pyramid.summaries.filter(s => s.level === level);
}

/**
 * Get the path from apex to a specific chunk
 */
export function getPathToChunk(
  pyramid: PyramidStructure,
  chunkId: string
): Array<PyramidChunk | PyramidSummary> {
  const path: Array<PyramidChunk | PyramidSummary> = [];

  // Find the chunk
  const chunk = pyramid.chunks.find(c => c.id === chunkId);
  if (!chunk) return path;

  path.push(chunk);

  // Walk up the tree
  let currentId = chunkId;
  for (let level = 1; level <= pyramid.meta.depth; level++) {
    const parent = pyramid.summaries.find(
      s => s.level === level && s.childIds.includes(currentId)
    );
    if (parent) {
      path.unshift(parent);
      currentId = parent.id;
    }
  }

  return path;
}

/**
 * Search chunks by content
 */
export function searchChunks(
  pyramid: PyramidStructure,
  query: string,
  options: { caseSensitive?: boolean; limit?: number } = {}
): Array<{ chunk: PyramidChunk; score: number }> {
  const { caseSensitive = false, limit = 10 } = options;
  const searchTerm = caseSensitive ? query : query.toLowerCase();

  const results: Array<{ chunk: PyramidChunk; score: number }> = [];

  for (const chunk of pyramid.chunks) {
    const content = caseSensitive ? chunk.content : chunk.content.toLowerCase();
    const matches = content.split(searchTerm).length - 1;
    if (matches > 0) {
      results.push({
        chunk,
        score: matches / chunk.wordCount, // Normalize by chunk size
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}
