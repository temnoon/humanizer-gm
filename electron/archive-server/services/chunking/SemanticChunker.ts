/**
 * SemanticChunker - Embedding-aware text chunking
 *
 * Uses BoundaryDetector to identify topic shifts, then creates chunks
 * that respect both semantic boundaries and size constraints.
 *
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import { BoundaryDetector, type BoundaryScore } from './BoundaryDetector.js';
import {
  type ChunkingStrategy,
  type ChunkingOptions,
  type ChunkingResult,
  type ChunkResult,
  type ChunkMetadata,
  DEFAULT_CHUNKING_OPTIONS,
  TokenUtils,
} from './ChunkingStrategy.js';

/**
 * Stop words for topic signature extraction
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'our', 'their', 'what', 'which', 'who', 'whom', 'where', 'when', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
  'now', 'here', 'there', 'then', 'if', 'because', 'while', 'about', 'after',
  'before', 'between', 'into', 'through', 'during', 'any', 'being', 'get', 'got',
]);

/**
 * SemanticChunker - Main chunking implementation
 */
export class SemanticChunker implements ChunkingStrategy {
  readonly name = 'semantic';
  readonly supportedFormats = ['text', 'markdown', 'conversation', 'html', 'prose'];

  private detector: BoundaryDetector;
  private embeddingEnabled: boolean;

  constructor(embeddingEnabled: boolean = true, threshold?: number) {
    this.embeddingEnabled = embeddingEnabled;
    this.detector = new BoundaryDetector(
      { threshold: threshold ?? DEFAULT_CHUNKING_OPTIONS.semanticThreshold },
      embeddingEnabled
    );
  }

  /**
   * Check if this strategy supports a format
   */
  supports(format: string): boolean {
    return this.supportedFormats.includes(format.toLowerCase());
  }

  /**
   * Chunk text using semantic boundary detection
   */
  async chunk(
    text: string,
    format: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ChunkingResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_CHUNKING_OPTIONS, ...options };

    // Source statistics
    const sourceWordCount = TokenUtils.countWords(text);
    const sourceSentenceCount = TokenUtils.countSentences(text);
    const sourceCharCount = text.length;

    // Short content doesn't need chunking
    const estimatedTokens = TokenUtils.estimateTokens(text);
    if (estimatedTokens <= opts.maxTokens) {
      return {
        chunks: [
          {
            text,
            startOffset: 0,
            endOffset: text.length,
            chunkIndex: 0,
            boundaryType: 'structural',
            metadata: this.createMetadata(text, undefined),
          },
        ],
        totalChunks: 1,
        strategy: this.name,
        source: {
          wordCount: sourceWordCount,
          charCount: sourceCharCount,
          sentenceCount: sourceSentenceCount,
        },
        stats: {
          durationMs: Date.now() - startTime,
          boundariesDetected: 0,
          semanticBoundaries: 0,
          structuralBoundaries: 0,
        },
      };
    }

    // Split into atomic units based on format
    const units = this.splitToUnits(text, format);
    const unitLengths = units.map((u) => TokenUtils.estimateTokens(u));

    // Detect semantic boundaries (if enabled and we have embedding service)
    let boundaries: BoundaryScore[] = [];
    let semanticBoundaryCount = 0;

    if (opts.useSemanticBoundaries && this.embeddingEnabled) {
      try {
        boundaries = await this.detector.detectBoundaries(units);
        semanticBoundaryCount = boundaries.filter((b) => b.isSignificant).length;
      } catch (err) {
        console.warn('[SemanticChunker] Boundary detection failed, using structural:', err);
        // Fall back to structural-only chunking
        boundaries = this.createStructuralBoundaries(units, opts);
      }
    } else {
      // No embedding service - use structural boundaries
      boundaries = this.createStructuralBoundaries(units, opts);
    }

    // Find optimal split points
    const splitPoints = this.detector.findSplitPoints(boundaries, unitLengths, {
      minTokens: opts.minTokens,
      maxTokens: opts.maxTokens,
      targetTokens: opts.targetTokens,
    });

    // Create chunks from split points
    const chunks = this.createChunks(text, units, splitPoints, boundaries);

    // Add overlap if configured
    if (opts.overlapTokens > 0) {
      this.addOverlap(chunks, text, opts.overlapTokens);
    }

    return {
      chunks,
      totalChunks: chunks.length,
      strategy: this.name,
      source: {
        wordCount: sourceWordCount,
        charCount: sourceCharCount,
        sentenceCount: sourceSentenceCount,
      },
      stats: {
        durationMs: Date.now() - startTime,
        boundariesDetected: boundaries.length,
        semanticBoundaries: semanticBoundaryCount,
        structuralBoundaries: boundaries.length - semanticBoundaryCount,
      },
    };
  }

  /**
   * Split text into atomic units based on format
   */
  private splitToUnits(text: string, format: string): string[] {
    switch (format.toLowerCase()) {
      case 'conversation':
        // Split by message boundaries
        return this.splitConversation(text);

      case 'markdown':
        // Split by headers and paragraphs
        return this.splitMarkdown(text);

      case 'html':
        // Strip tags, split by block elements
        const stripped = text.replace(/<[^>]+>/g, '\n');
        return this.splitParagraphs(stripped);

      default:
        // Default: split by paragraphs, then sentences for long paragraphs
        return this.splitParagraphs(text);
    }
  }

  /**
   * Split conversation text by turns
   */
  private splitConversation(text: string): string[] {
    // Common turn markers
    const turnPattern = /\n(?=(?:User|Assistant|Human|Claude|System|AI|You|Me):)/gi;
    const turns = text.split(turnPattern).filter((t) => t.trim());

    // If no turn markers found, fall back to paragraphs
    if (turns.length <= 1) {
      return this.splitParagraphs(text);
    }

    return turns;
  }

  /**
   * Split markdown by headers and paragraphs
   */
  private splitMarkdown(text: string): string[] {
    const units: string[] = [];

    // Split on headers (keep header with following content)
    const sections = text.split(/(?=^#{1,6}\s)/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Check if section is short enough
      if (TokenUtils.estimateTokens(section) <= 150) {
        units.push(section.trim());
      } else {
        // Split section into paragraphs
        const paras = this.splitParagraphs(section);
        units.push(...paras);
      }
    }

    return units.filter((u) => u.trim());
  }

  /**
   * Split text by paragraphs
   */
  private splitParagraphs(text: string): string[] {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

    const units: string[] = [];

    for (const para of paragraphs) {
      // If paragraph is very long, split into sentences
      if (TokenUtils.estimateTokens(para) > 200) {
        const sentences = this.splitSentences(para);
        units.push(...sentences);
      } else {
        units.push(para.trim());
      }
    }

    return units.filter((u) => u.trim());
  }

  /**
   * Split text into sentences
   */
  private splitSentences(text: string): string[] {
    // Sentence boundary detection
    // Handle abbreviations, numbers, etc.
    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z"'\[])|(?<=[.!?])(?=\n)/)
      .filter((s) => s.trim());

    return sentences;
  }

  /**
   * Create structural-only boundaries (no embedding-based detection)
   */
  private createStructuralBoundaries(
    units: string[],
    opts: ChunkingOptions
  ): BoundaryScore[] {
    const boundaries: BoundaryScore[] = [];
    let cumulative = 0;

    for (let i = 0; i < units.length - 1; i++) {
      cumulative += TokenUtils.estimateTokens(units[i]);

      // Mark as significant if we're at target size
      const isSignificant = cumulative >= opts.targetTokens * 0.7;

      boundaries.push({
        index: i,
        distance: isSignificant ? opts.semanticThreshold + 0.1 : 0.1,
        isSignificant,
        confidence: 0.5, // Lower confidence for structural-only
      });

      if (isSignificant) {
        cumulative = 0;
      }
    }

    return boundaries;
  }

  /**
   * Create chunks from split points
   */
  private createChunks(
    originalText: string,
    units: string[],
    splitPoints: number[],
    boundaries: BoundaryScore[]
  ): ChunkResult[] {
    const chunks: ChunkResult[] = [];
    let startUnit = 0;
    let textOffset = 0;

    // Calculate unit offsets
    const unitOffsets = this.calculateUnitOffsets(originalText, units);

    const allSplits = [...splitPoints, units.length];

    for (let i = 0; i < allSplits.length; i++) {
      const endUnit = allSplits[i];
      const chunkUnits = units.slice(startUnit, endUnit);

      if (chunkUnits.length === 0) continue;

      const chunkText = chunkUnits.join('\n\n');
      const startOffset = unitOffsets[startUnit] ?? textOffset;
      const endOffset = unitOffsets[endUnit] ?? originalText.length;

      // Determine boundary type
      let boundaryType: 'semantic' | 'structural' | 'size-limit' = 'structural';
      if (i > 0 && splitPoints[i - 1] !== undefined) {
        const boundaryIdx = splitPoints[i - 1] - 1;
        if (boundaryIdx >= 0 && boundaryIdx < boundaries.length) {
          const boundary = boundaries[boundaryIdx];
          if (boundary.isSignificant && boundary.confidence > 0.7) {
            boundaryType = 'semantic';
          }
        }
      }

      // Get semantic distance for metadata
      const semanticDistance =
        startUnit > 0 && boundaries[startUnit - 1]
          ? boundaries[startUnit - 1].distance
          : undefined;

      chunks.push({
        text: chunkText,
        startOffset,
        endOffset,
        chunkIndex: chunks.length,
        boundaryType,
        metadata: this.createMetadata(chunkText, semanticDistance),
      });

      startUnit = endUnit;
      textOffset = endOffset;
    }

    return chunks;
  }

  /**
   * Calculate character offsets for each unit in original text
   */
  private calculateUnitOffsets(text: string, units: string[]): number[] {
    const offsets: number[] = [];
    let searchStart = 0;

    for (const unit of units) {
      const trimmed = unit.trim();
      const idx = text.indexOf(trimmed, searchStart);
      offsets.push(idx >= 0 ? idx : searchStart);
      searchStart = idx >= 0 ? idx + trimmed.length : searchStart + unit.length;
    }

    // Add final offset
    offsets.push(text.length);

    return offsets;
  }

  /**
   * Add overlap between chunks
   */
  private addOverlap(
    chunks: ChunkResult[],
    originalText: string,
    overlapTokens: number
  ): void {
    if (chunks.length < 2) return;

    const overlapChars = overlapTokens * 4; // ~4 chars per token

    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];

      // Get overlap text from end of previous chunk
      const overlapStart = Math.max(0, prevChunk.text.length - overlapChars);
      const overlapText = prevChunk.text.slice(overlapStart);

      // Find a sentence boundary to avoid mid-sentence overlap
      const sentenceEnd = overlapText.search(/[.!?]\s/);
      const cleanOverlap =
        sentenceEnd >= 0
          ? overlapText.slice(sentenceEnd + 2) // After the sentence
          : overlapText;

      if (cleanOverlap.length > 20) {
        // Prepend overlap to current chunk
        chunks[i].text = `${cleanOverlap}\n\n${chunks[i].text}`;
        chunks[i].startOffset = Math.max(
          0,
          chunks[i].startOffset - cleanOverlap.length
        );
        chunks[i].metadata.tokenCount += TokenUtils.estimateTokens(cleanOverlap);
      }
    }
  }

  /**
   * Create metadata for a chunk
   */
  private createMetadata(text: string, semanticDistance?: number): ChunkMetadata {
    const wordCount = TokenUtils.countWords(text);
    const sentenceCount = TokenUtils.countSentences(text);
    const tokenCount = TokenUtils.estimateTokens(text);

    return {
      sentenceCount,
      tokenCount,
      wordCount,
      topicSignature: this.extractTopicSignature(text),
      semanticDistance,
    };
  }

  /**
   * Extract topic signature (top keywords) from text
   */
  private extractTopicSignature(text: string, maxKeywords: number = 5): string {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

    // Count frequencies
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    // Sort by frequency and take top N
    const sorted = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);

    return sorted.join(', ');
  }

  /**
   * Clear the boundary detector's cache
   */
  clearCache(): void {
    this.detector.clearCache();
  }
}

/**
 * Create a semantic chunker
 */
export function createSemanticChunker(
  embeddingEnabled: boolean = true,
  threshold?: number
): SemanticChunker {
  return new SemanticChunker(embeddingEnabled, threshold);
}
