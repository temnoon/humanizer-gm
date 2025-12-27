/**
 * Pyramid Building Types
 *
 * Types for the client-side pyramid building service.
 * These complement the core types in @humanizer/core.
 */

import type { PyramidStructure, PyramidConfig } from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// BUILD CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Extended configuration for building pyramids
 */
export interface PyramidBuildOptions extends Partial<PyramidConfig> {
  /** Progress callback */
  onProgress?: (progress: PyramidBuildProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Source metadata */
  sourceInfo?: {
    bookTitle?: string;
    author?: string;
    chapterId?: string;
  };
}

/**
 * Progress updates during pyramid building
 */
export interface PyramidBuildProgress {
  phase: 'chunking' | 'summarizing' | 'apex' | 'complete';
  currentLevel: number;
  totalLevels: number;
  itemsProcessed: number;
  itemsTotal: number;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════
// BUILD RESULT
// ═══════════════════════════════════════════════════════════════════

/**
 * Result of building a pyramid
 */
export interface PyramidBuildResult {
  success: boolean;
  pyramid?: PyramidStructure;
  error?: string;
  stats: {
    totalChunks: number;
    totalSummaries: number;
    pyramidDepth: number;
    compressionRatio: number;
    processingTimeMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// CHUNKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Text chunk for pyramid building (internal)
 */
export interface TextChunk {
  content: string;
  wordCount: number;
  charCount: number;
  sentenceCount: number;
  startOffset: number;
  endOffset: number;
}

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  targetWords: number;  // Target words per chunk (default: 300)
  maxWords: number;     // Maximum words per chunk (default: 500)
  minWords: number;     // Minimum words per chunk (default: 100)
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetWords: 300,
  maxWords: 500,
  minWords: 100,
};

// ═══════════════════════════════════════════════════════════════════
// LLM REQUEST TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Request to summarize a group of texts
 */
export interface SummarizeRequest {
  texts: string[];
  targetWords: number;
  context?: {
    bookTitle?: string;
    author?: string;
    level: number;
  };
}

/**
 * Response from summarization
 */
export interface SummarizeResponse {
  summary: string;
  keyPoints?: string[];
  processingTimeMs: number;
}

/**
 * Request to extract apex information
 */
export interface ExtractApexRequest {
  summaries: string[];
  context?: {
    bookTitle?: string;
    author?: string;
  };
}

/**
 * Response from apex extraction
 */
export interface ExtractApexResponse {
  summary: string;
  themes: string[];
  characters: string[];
  arc?: string;
  thesis?: string;
  mood?: string;
  processingTimeMs: number;
}
