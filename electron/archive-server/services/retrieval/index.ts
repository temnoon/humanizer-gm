/**
 * Retrieval Module - Multi-Resolution Hybrid Hierarchical Search
 *
 * Provides advanced retrieval capabilities for the UCG system:
 * - Reciprocal Rank Fusion for combining result sets
 * - Hybrid dense + sparse search
 * - Multi-resolution staged retrieval
 * - Quality-gated pipeline for agentic search
 */

// Types
export {
  EmbeddingResolution,
  type RankedResult,
  type FusedResult,
  type ContentQuality,
  type QualityGatedResult,
  type PipelineStats,
  type HybridSearchOptions,
  type StagedRetrievalOptions,
  type QualityGateOptions,
  DEFAULT_QUALITY_GATE_OPTIONS,
  DEFAULT_HYBRID_OPTIONS,
} from './types.js';

// Reciprocal Rank Fusion
export {
  reciprocalRankFusion,
  rrfScore,
  multiWayRRF,
  type RRFOptions,
} from './ReciprocalRankFusion.js';

// Hybrid Search
export {
  HybridSearchService,
  createHybridSearchService,
} from './HybridSearch.js';

// Multi-Resolution Retrieval
export {
  MultiResolutionEmbedder,
  StagedRetriever,
  createMultiResolutionEmbedder,
  createStagedRetriever,
  type MultiResolutionResult,
} from './MultiResolutionRetrieval.js';

// Quality-Gated Pipeline
export {
  QualityGatedPipeline,
  createQualityGatedPipeline,
} from './QualityGatedPipeline.js';
