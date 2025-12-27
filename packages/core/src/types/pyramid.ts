/**
 * Pyramid Types - Hierarchical Summarization
 *
 * The pyramid structure enables "knowing" a book by building
 * hierarchical summaries from chunks up to an apex.
 *
 * Structure:
 * - L0: Raw chunks (~300 words each)
 * - L1: Summaries of ~5 chunks (~60 words each)
 * - L2: Summaries of ~5 L1 nodes
 * - ...continues until apex
 * - Apex: Single summary with themes, characters, arc
 */

// ═══════════════════════════════════════════════════════════════════
// PYRAMID CHUNK - Level 0 (Raw Content)
// ═══════════════════════════════════════════════════════════════════

/**
 * A chunk is a contiguous piece of text at the base of the pyramid.
 * Typically ~300 words, respecting sentence boundaries.
 */
export interface PyramidChunk {
  /** Unique identifier */
  id: string;

  /** Level in pyramid (0 for chunks) */
  level: 0;

  /** Sequential index at this level */
  index: number;

  /** The raw text content */
  content: string;

  /** Word count */
  wordCount: number;

  /** Character count */
  charCount: number;

  /** Sentence count */
  sentenceCount: number;

  /** Source location (chapter, section, offset) */
  source: {
    chapterId?: string;
    sectionId?: string;
    startOffset: number;
    endOffset: number;
  };

  /** Embedding vector (if computed) */
  embedding?: number[];
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID SUMMARY - Level 1+ (Summarized Content)
// ═══════════════════════════════════════════════════════════════════

/**
 * A summary node in the pyramid (L1 and above).
 * Each summary compresses ~5 child nodes.
 */
export interface PyramidSummary {
  /** Unique identifier */
  id: string;

  /** Level in pyramid (1, 2, 3, ...) */
  level: number;

  /** Sequential index at this level */
  index: number;

  /** The summarized content */
  content: string;

  /** Word count */
  wordCount: number;

  /** IDs of child nodes (chunks or summaries) */
  childIds: string[];

  /** Compression ratio (children words / this words) */
  compressionRatio: number;

  /** Key points extracted */
  keyPoints?: string[];

  /** Embedding vector (if computed) */
  embedding?: number[];

  /** Which LLM generated this summary */
  generatedBy?: {
    model: string;
    timestamp: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID APEX - The Crown
// ═══════════════════════════════════════════════════════════════════

/**
 * The apex of the pyramid - the highest-level synthesis.
 * This is the curator's "knowing" of the book content.
 */
export interface PyramidApex {
  /** Top-level summary (1-2 paragraphs) */
  summary: string;

  /** Core themes extracted from content */
  themes: string[];

  /** Key characters/entities mentioned */
  characters: string[];

  /** Narrative arc (if applicable) */
  arc?: string;

  /** Central argument or thesis */
  thesis?: string;

  /** Tone/mood of the work */
  mood?: string;

  /** When the apex was generated */
  generatedAt: number;

  /** Which model(s) generated the apex */
  generatedBy: {
    summarizer: string; // Model for summaries
    extractor: string; // Model for theme extraction
  };
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID STRUCTURE - Complete Hierarchy
// ═══════════════════════════════════════════════════════════════════

/**
 * The complete pyramid structure for a book/chapter.
 */
export interface PyramidStructure {
  /** All L0 chunks */
  chunks: PyramidChunk[];

  /** All L1+ summaries */
  summaries: PyramidSummary[];

  /** The apex (may not exist if not yet computed) */
  apex?: PyramidApex;

  /** Metadata about the pyramid */
  meta: {
    /** Total number of levels (including L0) */
    depth: number;

    /** Total chunks at L0 */
    chunkCount: number;

    /** Total word count of source */
    sourceWordCount: number;

    /** Overall compression ratio */
    compressionRatio: number;

    /** When pyramid was built */
    builtAt: number;

    /** Configuration used */
    config: PyramidConfig;
  };
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID CONFIG - Build Settings
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration for building a pyramid
 */
export interface PyramidConfig {
  /** Target chunk size in words */
  chunkSize: number;

  /** Target compression ratio per level (5 = 5:1) */
  compressionTarget: number;

  /** Model for chunk summarization (e.g., 'haiku') */
  summarizerModel: string;

  /** Model for apex extraction (e.g., 'sonnet') */
  extractorModel: string;

  /** Whether to compute embeddings */
  computeEmbeddings: boolean;
}

/**
 * Default pyramid configuration
 */
export const DEFAULT_PYRAMID_CONFIG: PyramidConfig = {
  chunkSize: 300,
  compressionTarget: 5,
  summarizerModel: 'haiku',
  extractorModel: 'sonnet',
  computeEmbeddings: true,
};

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Calculate expected pyramid depth from chunk count
 */
export function calculatePyramidDepth(
  chunkCount: number,
  compressionTarget: number = 5
): number {
  if (chunkCount <= 1) return 1;
  return Math.ceil(Math.log(chunkCount) / Math.log(compressionTarget)) + 1;
}

/**
 * Get nodes at a specific level
 */
export function getNodesAtLevel(
  pyramid: PyramidStructure,
  level: number
): (PyramidChunk | PyramidSummary)[] {
  if (level === 0) return pyramid.chunks;
  return pyramid.summaries.filter((s) => s.level === level);
}

/**
 * Check if pyramid is complete (has apex)
 */
export function isPyramidComplete(pyramid: PyramidStructure): boolean {
  return pyramid.apex !== undefined;
}
