/**
 * ChunkingStrategy - Interface for semantic-aware text chunking
 *
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 * Defines contracts for detecting semantic boundaries and splitting text.
 */

/**
 * Configuration for chunking operations
 */
export interface ChunkingOptions {
  /** Minimum chunk size in tokens (default: 100) */
  minTokens: number;

  /** Maximum chunk size in tokens (default: 768) */
  maxTokens: number;

  /** Target chunk size in tokens (default: 512) */
  targetTokens: number;

  /** Overlap between chunks in tokens (default: 50) */
  overlapTokens: number;

  /** Semantic distance threshold for boundary detection (default: 0.35) */
  semanticThreshold: number;

  /** Whether to use embedding-based boundary detection */
  useSemanticBoundaries: boolean;
}

/**
 * Default chunking options
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  minTokens: 100,
  maxTokens: 768,
  targetTokens: 512,
  overlapTokens: 50,
  semanticThreshold: 0.35,
  useSemanticBoundaries: true,
};

/**
 * Result of chunking a single piece of content
 */
export interface ChunkResult {
  /** The chunk text */
  text: string;

  /** Character offset in original text */
  startOffset: number;

  /** End character offset in original text */
  endOffset: number;

  /** 0-based index of this chunk */
  chunkIndex: number;

  /** What caused this boundary */
  boundaryType: 'semantic' | 'structural' | 'size-limit';

  /** Additional metadata about the chunk */
  metadata: ChunkMetadata;
}

/**
 * Metadata about a chunk
 */
export interface ChunkMetadata {
  /** Number of sentences in this chunk */
  sentenceCount: number;

  /** Estimated token count */
  tokenCount: number;

  /** Word count */
  wordCount: number;

  /** Optional topic signature (first few keywords) */
  topicSignature?: string;

  /** Semantic distance from previous chunk (if boundary was semantic) */
  semanticDistance?: number;
}

/**
 * Result of a full chunking operation
 */
export interface ChunkingResult {
  /** The generated chunks */
  chunks: ChunkResult[];

  /** Total number of chunks */
  totalChunks: number;

  /** Strategy used for chunking */
  strategy: string;

  /** Source content statistics */
  source: {
    wordCount: number;
    charCount: number;
    sentenceCount: number;
  };

  /** Timing and performance stats */
  stats: {
    durationMs: number;
    boundariesDetected: number;
    semanticBoundaries: number;
    structuralBoundaries: number;
  };
}

/**
 * Interface for chunking strategies
 */
export interface ChunkingStrategy {
  /** Strategy name */
  readonly name: string;

  /** Supported content formats */
  readonly supportedFormats: string[];

  /**
   * Chunk text into semantic units
   */
  chunk(
    text: string,
    format: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ChunkingResult>;

  /**
   * Check if this strategy supports a given format
   */
  supports(format: string): boolean;
}

/**
 * Token estimation utilities
 */
export const TokenUtils = {
  /**
   * Estimate token count from text
   * Rough estimate: ~4 chars per token for English
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  },

  /**
   * Estimate tokens from word count
   * Average: ~1.3 tokens per word
   */
  tokensFromWords(wordCount: number): number {
    return Math.ceil(wordCount * 1.3);
  },

  /**
   * Count words in text
   */
  countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  },

  /**
   * Count sentences in text
   */
  countSentences(text: string): number {
    const matches = text.match(/[.!?]+/g);
    return matches ? matches.length : 1;
  },
};
