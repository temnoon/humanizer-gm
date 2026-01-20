/**
 * Semantic Chunking Module
 *
 * Provides embedding-aware text chunking for the UCG system.
 * Part of the Multi-Resolution Hybrid Hierarchical embedding architecture.
 */

// Strategy interface and types
export {
  type ChunkingStrategy,
  type ChunkingOptions,
  type ChunkingResult,
  type ChunkResult,
  type ChunkMetadata,
  DEFAULT_CHUNKING_OPTIONS,
  TokenUtils,
} from './ChunkingStrategy.js';

// Boundary detection
export {
  BoundaryDetector,
  type BoundaryScore,
  type BoundaryDetectionOptions,
} from './BoundaryDetector.js';

// Semantic chunker implementation
export {
  SemanticChunker,
  createSemanticChunker,
} from './SemanticChunker.js';
