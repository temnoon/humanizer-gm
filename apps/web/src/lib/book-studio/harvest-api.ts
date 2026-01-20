/**
 * Harvest API Client
 *
 * Thin client that calls the backend harvest API.
 * All business logic lives on the server.
 */

import type { HarvestCard, StubClassification, CardGrade } from './types'

// ============================================================================
// Types
// ============================================================================

export interface HarvestProgress {
  phase: 'searching' | 'grading' | 'expanding' | 'complete';
  searched: number;
  graded: number;
  accepted: number;
  rejected: number;
  expanded: number;
  target: number;
  message: string;
}

export interface HarvestConfig {
  target?: number;
  searchLimit?: number;
  minWordCount?: number;
  expandBreadcrumbs?: boolean;
  contextSize?: number;
  sources?: string[];
  types?: string[];
  prioritizeConversations?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  type: string;
  source: string;
  similarity: number;
  conversationId?: string;
  conversationTitle?: string;
  authorName?: string;
  createdAt?: number;
}

export interface QuickGrade {
  stubType: string;
  wordCount: number;
  overall: number;
  necessity: number;
}

export interface ExpandedResult {
  original: SearchResult;
  stubType: string;
  grade: QuickGrade;
  expanded?: {
    previousMessages: string[];
    nextMessages: string[];
    combinedContent: string;
  };
}

export interface HarvestResult {
  results: ExpandedResult[];
  stats: {
    totalSearched: number;
    totalRejected: number;
    totalExpanded: number;
    exhausted: boolean;
  };
}

// ============================================================================
// API Client
// ============================================================================

const ARCHIVE_SERVER_BASE = 'http://localhost:3002';

/**
 * Run smart harvest with progress updates via SSE
 */
export async function runHarvest(
  query: string,
  onProgress: (progress: HarvestProgress) => void,
  config: HarvestConfig = {}
): Promise<HarvestResult> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/harvest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      ...config,
      sse: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Harvest request failed: ${response.status}`);
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: HarvestResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === 'progress') {
            onProgress({
              phase: data.phase,
              searched: data.searched,
              graded: data.graded,
              accepted: data.accepted,
              rejected: data.rejected,
              expanded: data.expanded,
              target: data.target,
              message: data.message,
            });
          } else if (data.type === 'complete') {
            finalResult = data.result;
          } else if (data.type === 'error') {
            throw new Error(data.error);
          }
        } catch (parseError) {
          // Skip invalid JSON lines
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
      }
    }
  }

  if (!finalResult) {
    throw new Error('Harvest completed without result');
  }

  return finalResult;
}

/**
 * Preview harvest results (non-streaming)
 */
export async function previewHarvest(
  query: string,
  target: number = 10
): Promise<HarvestResult> {
  const response = await fetch(
    `${ARCHIVE_SERVER_BASE}/api/harvest/preview?query=${encodeURIComponent(query)}&target=${target}`
  );

  if (!response.ok) {
    throw new Error(`Preview request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get harvest configuration
 */
export async function getHarvestConfig(): Promise<{
  defaultTarget: number;
  searchLimit: number;
  minWordCount: number;
  expandBreadcrumbs: boolean;
  contextSize: number;
  prioritizeConversations: boolean;
}> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/harvest/config`);

  if (!response.ok) {
    throw new Error(`Config request failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert backend ExpandedResult to a HarvestCard for use in the UI
 */
export function convertToHarvestCard(result: ExpandedResult): HarvestCard {
  const { original, stubType, grade, expanded } = result;
  const now = Math.floor(Date.now() / 1000);

  // Use expanded content if available, otherwise original
  const content = expanded?.combinedContent || original.content;

  // Build partial grade from QuickGrade
  const cardGrade: CardGrade = {
    authenticity: 3, // Default, will be refined by full grading
    necessity: grade.necessity,
    inflection: 3, // Default
    voice: 3, // Default
    overall: grade.overall,
    stubType: stubType as StubClassification,
    gradedAt: new Date().toISOString(),
    gradedBy: 'auto',
    confidence: 0.6, // Quick grade has moderate confidence
  };

  return {
    id: crypto.randomUUID(),
    sourceId: original.id,
    sourceType: original.type as HarvestCard['sourceType'],
    source: original.source,
    contentOrigin: 'original',
    content,
    authorName: original.authorName,
    similarity: original.similarity,
    // Temporal fields
    sourceCreatedAt: original.createdAt || null,
    sourceCreatedAtStatus: original.createdAt ? 'exact' : 'unknown',
    harvestedAt: now,
    // Source linking
    conversationId: original.conversationId,
    conversationTitle: original.conversationTitle,
    // Annotations
    userNotes: '',
    tags: [],
    status: 'staging',
    // Grading
    grade: cardGrade,
  };
}
