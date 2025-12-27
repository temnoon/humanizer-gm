/**
 * Pyramid Module
 *
 * Client-side pyramid building service for hierarchical summarization.
 * Builds pyramids from book content to enable "knowing" a book.
 */

export {
  buildPyramid,
  chunkText,
  getPyramidLevel,
  getPathToChunk,
  searchChunks,
} from './PyramidBuildingService';

export type {
  PyramidBuildOptions,
  PyramidBuildProgress,
  PyramidBuildResult,
  TextChunk,
  ChunkingConfig,
  SummarizeRequest,
  SummarizeResponse,
  ExtractApexRequest,
  ExtractApexResponse,
} from './types';

// Re-export core types for convenience
export type {
  PyramidChunk,
  PyramidSummary,
  PyramidApex,
  PyramidStructure,
  PyramidConfig,
} from '@humanizer/core';
