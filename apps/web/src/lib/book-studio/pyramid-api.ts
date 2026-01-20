/**
 * Pyramid API Client
 *
 * Thin client that calls the backend pyramid API.
 * All pyramid building logic lives on the server.
 */

// ============================================================================
// Types
// ============================================================================

export interface PyramidStats {
  totalThreads: number;
  totalChunks: number;
  totalSummaries: number;
  totalApexes: number;
  chunksWithEmbeddings: number;
  summariesWithEmbeddings: number;
  apexesWithEmbeddings: number;
}

export interface PyramidBuildResult {
  success: boolean;
  threadId: string;
  stats: {
    chunksCreated: number;
    summariesCreated: number;
    totalSourceWords: number;
    pyramidDepth: number;
    processingTimeMs: number;
  };
  chunksCreated: number;
  summariesCreated: number;
  hasApex: boolean;
}

export interface PyramidSearchResult {
  id: string;
  threadId: string;
  level: 'chunk' | 'summary' | 'apex';
  content: string;
  similarity: number;
}

export interface BatchBuildProgress {
  phase: 'starting' | 'processing' | 'complete' | 'error';
  completed?: number;
  total?: number;
  currentId?: string;
  progress?: number;
  result?: {
    processed: number;
    total: number;
    errors: number;
    threadsProcessed: number;
  };
  error?: string;
}

// ============================================================================
// API Client
// ============================================================================

const ARCHIVE_SERVER_BASE = 'http://localhost:3002';

/**
 * Build pyramid for a single thread
 */
export async function buildPyramid(
  threadId: string,
  options?: {
    threadType?: string;
    content?: string;
    skipSummaries?: boolean;
    skipApex?: boolean;
  }
): Promise<PyramidBuildResult> {
  const response = await fetch(
    `${ARCHIVE_SERVER_BASE}/api/pyramid/build/${threadId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    }
  );

  if (!response.ok) {
    throw new Error(`Build pyramid request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Build pyramids for all unembedded content (SSE for progress)
 */
export async function buildPyramidsBatch(
  onProgress: (progress: BatchBuildProgress) => void
): Promise<{ processed: number; total: number; errors: number }> {
  const response = await fetch(
    `${ARCHIVE_SERVER_BASE}/api/pyramid/build-batch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sse: true }),
    }
  );

  if (!response.ok) {
    throw new Error(`Batch build request failed: ${response.status}`);
  }

  // Parse SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: { processed: number; total: number; errors: number } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          onProgress(data);

          if (data.phase === 'complete' && data.result) {
            finalResult = data.result;
          } else if (data.phase === 'error') {
            throw new Error(data.error);
          }
        } catch (parseError) {
          if (!(parseError instanceof SyntaxError)) {
            throw parseError;
          }
        }
      }
    }
  }

  return finalResult || { processed: 0, total: 0, errors: 0 };
}

/**
 * Get pyramid statistics
 */
export async function getPyramidStats(): Promise<PyramidStats> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/pyramid/stats`);

  if (!response.ok) {
    throw new Error(`Stats request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Search across pyramid levels
 */
export async function searchPyramid(
  query: string,
  options?: {
    limit?: number;
    levels?: ('chunk' | 'summary' | 'apex')[];
    threadTypes?: string[];
  }
): Promise<{ query: string; results: PyramidSearchResult[]; total: number }> {
  const response = await fetch(`${ARCHIVE_SERVER_BASE}/api/pyramid/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, ...options }),
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete pyramid for a thread
 */
export async function deletePyramid(
  threadId: string
): Promise<{ success: boolean; threadId: string }> {
  const response = await fetch(
    `${ARCHIVE_SERVER_BASE}/api/pyramid/${threadId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Delete pyramid request failed: ${response.status}`);
  }

  return response.json();
}
