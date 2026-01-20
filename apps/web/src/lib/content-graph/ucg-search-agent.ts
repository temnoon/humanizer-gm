/**
 * UCG Search Agent
 *
 * Smart harvest-style agentic search over UCG content nodes.
 *
 * Pipeline:
 * 1. Query - Semantic search across all content_nodes
 * 2. Grade - SIC/Chekhov quality scoring
 * 3. Expand - Fetch parent/child context for fragments
 * 4. Cluster - Group semantically related results
 * 5. Return - Quality-filtered, context-rich results
 */

import { getArchiveServerUrl } from '../platform';

// ============================================================================
// Types
// ============================================================================

export interface UCGSearchNode {
  id: string;
  uri: string;
  content: {
    text: string;
    format: string;
  };
  metadata: {
    title?: string;
    author?: string;
    createdAt: number;
    wordCount: number;
    tags: string[];
    sourceMetadata?: Record<string, unknown>;
  };
  source: {
    type: string;
    adapter: string;
  };
  similarity: number;
}

export interface UCGSearchResult {
  node: UCGSearchNode;
  quality: QualityScore;
  context?: ExpandedContext;
  cluster?: string;
}

export interface QualityScore {
  overall: number; // 1-5
  specificity: number; // SIC-style measure
  coherence: number;
  substance: number;
  reasoning?: string;
}

export interface ExpandedContext {
  parent?: UCGSearchNode;
  children?: UCGSearchNode[];
  siblings?: UCGSearchNode[];
  combinedText?: string;
}

export interface UCGSearchConfig {
  targetCount: number;       // Target number of quality results (default 20)
  searchLimit: number;       // Max raw results to fetch (default 100)
  minQuality: number;        // Minimum quality score (default 2.5)
  minWordCount: number;      // Minimum words for non-stubs (default 30)
  expandContext: boolean;    // Auto-expand fragments (default true)
  contextSize: number;       // Number of context nodes to fetch (default 2)
}

export interface UCGSearchProgress {
  phase: 'searching' | 'grading' | 'expanding' | 'clustering' | 'complete';
  searched: number;
  graded: number;
  accepted: number;
  rejected: number;
  target: number;
  message: string;
}

export interface UCGSearchStats {
  totalSearched: number;
  totalAccepted: number;
  totalRejected: number;
  totalExpanded: number;
  clusters: number;
  exhausted: boolean;
  duration: number;
}

const DEFAULT_CONFIG: UCGSearchConfig = {
  targetCount: 20,
  searchLimit: 100,
  minQuality: 2.5,
  minWordCount: 30,
  expandContext: true,
  contextSize: 2,
};

// ============================================================================
// Search Agent
// ============================================================================

/**
 * Run an agentic UCG search with quality filtering
 */
export async function ucgAgentSearch(
  query: string,
  onProgress: (progress: UCGSearchProgress) => void,
  config: Partial<UCGSearchConfig> = {}
): Promise<{ results: UCGSearchResult[]; stats: UCGSearchStats }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();

  const acceptedResults: UCGSearchResult[] = [];
  let totalRejected = 0;
  let totalExpanded = 0;

  // Phase 1: Search
  onProgress({
    phase: 'searching',
    searched: 0,
    graded: 0,
    accepted: 0,
    rejected: 0,
    target: cfg.targetCount,
    message: `Searching for "${query}"...`,
  });

  const archiveServer = await getArchiveServerUrl();
  const searchResponse = await fetch(`${archiveServer}/api/ucg/search/semantic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit: cfg.searchLimit,
      threshold: 0.3,
      includeParent: cfg.expandContext,
    }),
  });

  if (!searchResponse.ok) {
    throw new Error('Search failed');
  }

  const searchData = await searchResponse.json();
  const rawResults: Array<{
    node: UCGSearchNode;
    similarity: number;
    parent?: UCGSearchNode;
  }> = searchData.results || [];

  if (rawResults.length === 0) {
    onProgress({
      phase: 'complete',
      searched: 0,
      graded: 0,
      accepted: 0,
      rejected: 0,
      target: cfg.targetCount,
      message: 'No results found',
    });
    return {
      results: [],
      stats: {
        totalSearched: 0,
        totalAccepted: 0,
        totalRejected: 0,
        totalExpanded: 0,
        clusters: 0,
        exhausted: true,
        duration: Date.now() - startTime,
      },
    };
  }

  // Phase 2: Grade and filter
  onProgress({
    phase: 'grading',
    searched: rawResults.length,
    graded: 0,
    accepted: 0,
    rejected: 0,
    target: cfg.targetCount,
    message: `Grading ${rawResults.length} results...`,
  });

  for (let i = 0; i < rawResults.length; i++) {
    // Stop if we have enough
    if (acceptedResults.length >= cfg.targetCount) break;

    const result = rawResults[i];
    const node = result.node;

    // Skip invalid results
    if (!node || !node.content?.text) {
      totalRejected++;
      continue;
    }

    // Quick quality check
    const wordCount = node.content.text.split(/\s+/).filter(Boolean).length;
    if (wordCount < cfg.minWordCount) {
      // Try to expand if context is available
      if (cfg.expandContext && result.parent) {
        const expandedText = [
          result.parent.content.text,
          node.content.text,
        ].join('\n\n---\n\n');

        const expandedWordCount = expandedText.split(/\s+/).filter(Boolean).length;
        if (expandedWordCount >= cfg.minWordCount) {
          totalExpanded++;
          // Grade expanded content
          const quality = gradeContent(expandedText, query);
          if (quality.overall >= cfg.minQuality) {
            acceptedResults.push({
              node: { ...node, similarity: result.similarity },
              quality,
              context: {
                parent: result.parent,
                combinedText: expandedText,
              },
            });
            continue;
          }
        }
      }
      totalRejected++;
      continue;
    }

    // Grade the content
    const quality = gradeContent(node.content.text, query);

    onProgress({
      phase: 'grading',
      searched: rawResults.length,
      graded: i + 1,
      accepted: acceptedResults.length,
      rejected: totalRejected,
      target: cfg.targetCount,
      message: `Grading ${i + 1}/${rawResults.length}...`,
    });

    if (quality.overall >= cfg.minQuality) {
      acceptedResults.push({
        node: { ...node, similarity: result.similarity },
        quality,
        context: result.parent ? { parent: result.parent } : undefined,
      });
    } else {
      totalRejected++;
    }
  }

  // Phase 3: Cluster results
  onProgress({
    phase: 'clustering',
    searched: rawResults.length,
    graded: rawResults.length,
    accepted: acceptedResults.length,
    rejected: totalRejected,
    target: cfg.targetCount,
    message: 'Clustering results...',
  });

  const clusters = clusterResults(acceptedResults);
  for (const result of acceptedResults) {
    result.cluster = clusters.get(result.node.id);
  }

  // Complete
  const exhausted = acceptedResults.length < cfg.targetCount;
  onProgress({
    phase: 'complete',
    searched: rawResults.length,
    graded: rawResults.length,
    accepted: acceptedResults.length,
    rejected: totalRejected,
    target: cfg.targetCount,
    message: exhausted
      ? `Found ${acceptedResults.length} quality results (search exhausted)`
      : `Found ${acceptedResults.length} quality results`,
  });

  return {
    results: acceptedResults,
    stats: {
      totalSearched: rawResults.length,
      totalAccepted: acceptedResults.length,
      totalRejected,
      totalExpanded,
      clusters: new Set(clusters.values()).size,
      exhausted,
      duration: Date.now() - startTime,
    },
  };
}

// ============================================================================
// Quality Grading
// ============================================================================

/**
 * Grade content quality (simplified SIC-style scoring)
 */
function gradeContent(text: string, query: string): QualityScore {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const queryTerms = query.toLowerCase().split(/\s+/);

  // Specificity: How specific/detailed is the content?
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);
  const specificity = Math.min(5, 1 + avgSentenceLength / 10);

  // Coherence: Does it form complete thoughts?
  const hasProperSentences = sentences.length >= 2 && avgSentenceLength > 5;
  const coherence = hasProperSentences ? 4 : sentences.length >= 1 ? 3 : 2;

  // Substance: Is there real content?
  const urlCount = (text.match(/https?:\/\/\S+/g) || []).length;
  const urlRatio = urlCount / Math.max(words.length, 1);
  const hasSubstance = words.length >= 30 && urlRatio < 0.3;
  const substance = hasSubstance ? 4 : words.length >= 15 ? 3 : 2;

  // Query relevance bonus
  const queryMatches = queryTerms.filter(term =>
    text.toLowerCase().includes(term)
  ).length;
  const relevanceBonus = (queryMatches / queryTerms.length) * 0.5;

  // Overall score
  const overall = Math.min(5, (specificity + coherence + substance) / 3 + relevanceBonus);

  return {
    overall: Math.round(overall * 10) / 10,
    specificity: Math.round(specificity * 10) / 10,
    coherence: Math.round(coherence * 10) / 10,
    substance: Math.round(substance * 10) / 10,
  };
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Simple clustering by source type and time proximity
 */
function clusterResults(
  results: UCGSearchResult[]
): Map<string, string> {
  const clusters = new Map<string, string>();

  // Group by source type first
  const bySource = new Map<string, UCGSearchResult[]>();
  for (const result of results) {
    const sourceType = result.node.source.type;
    if (!bySource.has(sourceType)) {
      bySource.set(sourceType, []);
    }
    bySource.get(sourceType)!.push(result);
  }

  // Assign cluster names
  let clusterIndex = 0;
  for (const [sourceType, sourceResults] of bySource) {
    // Sort by creation date
    sourceResults.sort((a, b) =>
      a.node.metadata.createdAt - b.node.metadata.createdAt
    );

    // Simple time-based subclustering
    let lastTime = 0;
    let subCluster = 0;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const result of sourceResults) {
      const time = result.node.metadata.createdAt;
      if (lastTime && time - lastTime > ONE_DAY * 7) {
        subCluster++;
      }
      lastTime = time;

      const clusterName = `${sourceType}-${clusterIndex}-${subCluster}`;
      clusters.set(result.node.id, clusterName);
    }

    clusterIndex++;
  }

  return clusters;
}

// ============================================================================
// Quick Search (non-agentic)
// ============================================================================

/**
 * Quick semantic search without quality filtering
 */
export async function ucgQuickSearch(
  query: string,
  limit: number = 20
): Promise<UCGSearchNode[]> {
  const archiveServer = await getArchiveServerUrl();
  const response = await fetch(`${archiveServer}/api/ucg/search/semantic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit,
      threshold: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error('Search failed');
  }

  const data = await response.json();
  return (data.results || []).map((r: { node: UCGSearchNode; similarity: number }) => ({
    ...r.node,
    similarity: r.similarity,
  }));
}
