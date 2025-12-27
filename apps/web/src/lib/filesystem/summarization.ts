/**
 * File Summarization Service
 *
 * Generates concise summaries for indexed files using LLM.
 * Integrates with NPE-API for summarization.
 */

import { getStoredToken } from '../auth';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SummarizationOptions {
  /** Target length: 'brief' (~50 words), 'medium' (~150 words), 'detailed' (~300 words) */
  length?: 'brief' | 'medium' | 'detailed';
  /** Focus area: 'content', 'structure', 'key-points' */
  focus?: 'content' | 'structure' | 'key-points';
  /** Include file metadata in context */
  includeMetadata?: boolean;
}

export interface SummarizationResult {
  summary: string;
  wordCount: number;
  processingTimeMs: number;
  cached?: boolean;
}

export interface FileSummary {
  fileId: string;
  fileName: string;
  summary: string;
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';

const TARGET_WORDS: Record<string, number> = {
  brief: 50,
  medium: 150,
  detailed: 300,
};

const SUMMARY_PROMPTS: Record<string, string> = {
  content: 'Summarize the main content and purpose of this text.',
  structure: 'Describe the structure and organization of this document.',
  'key-points': 'Extract the key points and takeaways from this text.',
};

// Simple in-memory cache for summaries
const summaryCache = new Map<string, SummarizationResult>();

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a concise summarization assistant. Your task is to create clear, informative summaries.

Guidelines:
- Be accurate and faithful to the source content
- Prioritize the most important information
- Use clear, accessible language
- Maintain the original tone where appropriate
- Do not add information not present in the source
- Keep the summary within the requested word limit`;

// ═══════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a summary for text content
 */
export async function summarizeText(
  content: string,
  options: SummarizationOptions = {},
  signal?: AbortSignal
): Promise<SummarizationResult> {
  const startTime = Date.now();
  const {
    length = 'brief',
    focus = 'content',
  } = options;

  const targetWords = TARGET_WORDS[length];
  const focusPrompt = SUMMARY_PROMPTS[focus];

  // Check cache
  const cacheKey = `${hashContent(content)}-${length}-${focus}`;
  const cached = summaryCache.get(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Truncate very long content to avoid token limits
  const maxChars = 10000;
  const truncatedContent = content.length > maxChars
    ? content.substring(0, maxChars) + '\n\n[Content truncated...]'
    : content;

  // Build the prompt
  const userPrompt = `${focusPrompt}

Target length: approximately ${targetWords} words.

---

${truncatedContent}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE}/chat/completion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
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
    const summary = (data.content || data.response || '').trim();
    const wordCount = summary.split(/\s+/).filter(w => w.length > 0).length;

    const result: SummarizationResult = {
      summary,
      wordCount,
      processingTimeMs: Date.now() - startTime,
    };

    // Cache the result
    summaryCache.set(cacheKey, result);

    return result;
  } catch (error) {
    // Fallback: extract first few sentences
    const sentences = content.match(/[^.!?]*[.!?]+/g) || [];
    const fallbackSummary = sentences.slice(0, 3).join(' ').trim() || content.substring(0, 200);

    return {
      summary: fallbackSummary,
      wordCount: fallbackSummary.split(/\s+/).length,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Generate summaries for multiple files in batch
 */
export async function summarizeFiles(
  files: Array<{ id: string; name: string; content: string }>,
  options: SummarizationOptions = {},
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal
): Promise<FileSummary[]> {
  const results: FileSummary[] = [];
  let completed = 0;

  for (const file of files) {
    if (signal?.aborted) break;

    try {
      const result = await summarizeText(file.content, options, signal);
      results.push({
        fileId: file.id,
        fileName: file.name,
        summary: result.summary,
        generatedAt: Date.now(),
      });
    } catch (error) {
      // Skip failed files but continue
      results.push({
        fileId: file.id,
        fileName: file.name,
        summary: `[Summary unavailable: ${file.name}]`,
        generatedAt: Date.now(),
      });
    }

    completed++;
    onProgress?.(completed, files.length);
  }

  return results;
}

/**
 * Clear the summary cache
 */
export function clearSummaryCache(): void {
  summaryCache.clear();
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a simple hash for cache key
 */
function hashContent(content: string): string {
  let hash = 0;
  const sample = content.substring(0, 1000); // Use first 1000 chars for hash
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check if content is worth summarizing (not too short)
 */
export function shouldSummarize(content: string): boolean {
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  return wordCount >= 50; // Only summarize if 50+ words
}

/**
 * Estimate time to summarize (for UI feedback)
 */
export function estimateSummarizationTime(fileCount: number): number {
  // Rough estimate: ~2 seconds per file
  return fileCount * 2000;
}
