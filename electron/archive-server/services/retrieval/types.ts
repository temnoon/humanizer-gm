/**
 * Retrieval Types - Shared types for the Multi-Resolution Hybrid Hierarchical system
 *
 * Part of the UCG embedding optimization architecture.
 */

import type { ContentNode } from '@humanizer/core';

/**
 * Embedding resolution levels
 */
export enum EmbeddingResolution {
  /** Whole document/thread/conversation */
  DOCUMENT = 0,

  /** Section/topic-episode/message-group */
  SECTION = 1,

  /** Leaf chunk/individual turn */
  CHUNK = 2,
}

/**
 * A ranked result from a single retrieval source
 */
export interface RankedResult {
  /** Node ID */
  id: string;

  /** Score from this retrieval method */
  score: number;

  /** Which retrieval source produced this */
  source: 'dense' | 'sparse' | 'staged';
}

/**
 * Result after RRF fusion
 */
export interface FusedResult {
  /** Node ID */
  id: string;

  /** Dense (vector) score if present */
  denseScore: number | null;

  /** Dense rank if present */
  denseRank: number | null;

  /** Sparse (FTS) score if present */
  sparseScore: number | null;

  /** Sparse rank if present */
  sparseRank: number | null;

  /** Combined RRF score */
  fusedScore: number;
}

/**
 * Quality scores for a content node
 */
export interface ContentQuality {
  /** SIC authenticity score (0-1) */
  authenticity: number | null;

  /** Chekhov necessity score (0-1) */
  necessity: number | null;

  /** Quantum inflection score (0-1) */
  inflection: number | null;

  /** Style voice coherence (0-1) */
  voice: number | null;

  /** Weighted overall score (0-1) */
  overall: number | null;

  /** Stub classification */
  stubType: string | null;

  /** SIC category */
  sicCategory: string | null;
}

/**
 * Result with quality annotations
 */
export interface QualityGatedResult {
  /** The content node */
  node: ContentNode;

  /** Similarity score from retrieval */
  similarity: number;

  /** Quality scores (if available) */
  quality: ContentQuality | null;

  /** Expanded context (if requested and node is short) */
  context?: {
    parent: ContentNode | null;
    combinedText: string;
  };

  /** Rejection info (if filtered out) */
  rejected?: {
    reason: string;
  };
}

/**
 * Statistics from a retrieval pipeline run
 */
export interface PipelineStats {
  /** Total candidates searched */
  totalSearched: number;

  /** Results that passed quality gates */
  totalAccepted: number;

  /** Results filtered out */
  totalRejected: number;

  /** Breakdown of rejection reasons */
  rejectionReasons: Record<string, number>;

  /** Results that had context expanded */
  totalExpanded: number;

  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Options for hybrid search
 */
export interface HybridSearchOptions {
  /** Weight for dense (vector) results (default: 0.7) */
  denseWeight?: number;

  /** Weight for sparse (FTS) results (default: 0.3) */
  sparseWeight?: number;

  /** Maximum results to return */
  limit?: number;

  /** Maximum candidates from each source */
  searchLimit?: number;

  /** Minimum dense cosine similarity */
  minDenseScore?: number;

  /** RRF k parameter (default: 60) */
  fusionK?: number;
}

/**
 * Options for staged (multi-resolution) retrieval
 */
export interface StagedRetrievalOptions {
  /** How many sections/docs to retrieve first */
  coarseLimit: number;

  /** How many chunks to retrieve per section */
  fineLimit: number;

  /** Resolution for coarse retrieval */
  coarseResolution: EmbeddingResolution;

  /** Resolution for fine retrieval */
  fineResolution: EmbeddingResolution;
}

/**
 * Options for quality-gated pipeline
 */
export interface QualityGateOptions {
  // Retrieval options
  /** Desired result count */
  targetCount: number;

  /** Initial candidate pool size */
  searchLimit: number;

  /** Use multi-resolution retrieval */
  useStaged: boolean;

  /** Use hybrid dense+sparse search */
  useHybrid: boolean;

  // Quality thresholds
  /** Minimum overall quality (0-1) */
  minQuality: number;

  /** Minimum word count */
  minWordCount: number;

  /** Stub types to exclude */
  excludeStubTypes: string[];

  // Context expansion
  /** Fetch parent for short chunks */
  expandContext: boolean;

  /** Word count below which to expand */
  expandThreshold: number;

  // Optional reranking
  /** Enable reranking pass */
  rerank: boolean;

  /** Model for reranking */
  rerankModel?: string;
}

/**
 * Default options for quality-gated pipeline
 */
export const DEFAULT_QUALITY_GATE_OPTIONS: QualityGateOptions = {
  targetCount: 20,
  searchLimit: 100,
  useStaged: true,
  useHybrid: true,
  minQuality: 0.4,
  minWordCount: 30,
  excludeStubTypes: ['stub-breadcrumb', 'stub-sentence'],
  expandContext: true,
  expandThreshold: 50,
  rerank: false,
};

/**
 * Default options for hybrid search
 */
export const DEFAULT_HYBRID_OPTIONS: HybridSearchOptions = {
  denseWeight: 0.7,
  sparseWeight: 0.3,
  limit: 20,
  searchLimit: 100,
  minDenseScore: 0.3,
  fusionK: 60,
};
