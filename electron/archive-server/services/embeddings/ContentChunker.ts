/**
 * ContentChunker - Content-Type Aware Text Chunking
 *
 * Orchestrates content-type detection and type-appropriate chunking.
 * Preserves semantic boundaries: code blocks stay whole, math stays atomic.
 *
 * Part of Phase 5: Content-Type Aware Chunking (Xanadu unified storage project)
 */

import { ContentAnalyzer, ContentSegment, ContentType } from './ContentAnalyzer';

// =============================================================================
// Types
// =============================================================================

export interface ChunkResult {
  id: string;
  content: string;
  contentType: ContentType;
  language?: string;
  wordCount: number;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  contextBefore?: string;
  contextAfter?: string;
}

export interface ChunkerOptions {
  /** Target chunk size in words for prose (default: 150) */
  targetProseWords?: number;
  /** Maximum chunk size in words (default: 500) */
  maxChunkWords?: number;
  /** Context window size in characters (default: 100) */
  contextSize?: number;
  /** Generate unique IDs with this prefix */
  idPrefix?: string;
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  targetProseWords: 150,
  maxChunkWords: 500,
  contextSize: 100,
  idPrefix: 'chunk',
};

// =============================================================================
// ContentChunker Class
// =============================================================================

export class ContentChunker {
  private analyzer: ContentAnalyzer;
  private options: Required<ChunkerOptions>;

  constructor(options: ChunkerOptions = {}) {
    this.analyzer = new ContentAnalyzer();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Chunk text with content-type awareness
   */
  chunk(text: string): ChunkResult[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Step 1: Analyze and segment by content type
    const segments = this.analyzer.analyze(text);

    // Step 2: Chunk each segment according to its type
    const chunks: ChunkResult[] = [];
    let chunkIndex = 0;

    for (const segment of segments) {
      const segmentChunks = this.chunkSegment(segment, chunkIndex);

      // Add context from original text
      for (const chunk of segmentChunks) {
        chunk.contextBefore = this.getContextBefore(text, chunk.startOffset);
        chunk.contextAfter = this.getContextAfter(text, chunk.endOffset);
        chunks.push(chunk);
        chunkIndex++;
      }
    }

    return chunks;
  }

  /**
   * Chunk a single segment according to its type
   */
  private chunkSegment(segment: ContentSegment, startIndex: number): ChunkResult[] {
    switch (segment.type) {
      case 'code':
        return this.chunkCode(segment, startIndex);
      case 'math':
        return this.chunkMath(segment, startIndex);
      case 'table':
        return this.chunkTable(segment, startIndex);
      case 'heading':
        return this.chunkHeading(segment, startIndex);
      case 'list':
        return this.chunkList(segment, startIndex);
      case 'prose':
      default:
        return this.chunkProse(segment, startIndex);
    }
  }

  /**
   * Chunk prose by paragraphs, respecting sentence boundaries
   */
  private chunkProse(segment: ContentSegment, startIndex: number): ChunkResult[] {
    const chunks: ChunkResult[] = [];
    const paragraphs = segment.content
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    let currentChunk = '';
    let currentWordCount = 0;
    let chunkStartOffset = segment.startOffset;
    let idx = startIndex;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraWords = this.countWords(para);

      // If adding this paragraph exceeds target and we have content, finalize chunk
      if (currentWordCount > 0 && currentWordCount + paraWords > this.options.targetProseWords) {
        chunks.push(this.createChunk(
          idx++,
          currentChunk.trim(),
          'prose',
          chunkStartOffset,
          chunkStartOffset + currentChunk.length,
        ));

        currentChunk = para;
        currentWordCount = paraWords;
        chunkStartOffset = segment.startOffset + segment.content.indexOf(para, chunkStartOffset - segment.startOffset);
      } else {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? '\n\n' : '') + para;
        currentWordCount += paraWords;
      }

      // If single paragraph exceeds max, split by sentences
      if (paraWords > this.options.maxChunkWords) {
        const sentenceChunks = this.splitBySentences(para, segment.startOffset, idx);
        chunks.push(...sentenceChunks);
        idx += sentenceChunks.length;
        currentChunk = '';
        currentWordCount = 0;
      }
    }

    // Finalize remaining content
    if (currentChunk.trim().length > 0) {
      chunks.push(this.createChunk(
        idx,
        currentChunk.trim(),
        'prose',
        chunkStartOffset,
        segment.endOffset,
      ));
    }

    return chunks;
  }

  /**
   * Split text by sentences for very long paragraphs
   */
  private splitBySentences(text: string, baseOffset: number, startIdx: number): ChunkResult[] {
    const chunks: ChunkResult[] = [];

    // Split on sentence-ending punctuation
    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let currentChunk = '';
    let currentWordCount = 0;
    let idx = startIdx;

    for (const sentence of sentences) {
      const sentenceWords = this.countWords(sentence);

      if (currentWordCount + sentenceWords > this.options.targetProseWords && currentChunk) {
        chunks.push(this.createChunk(
          idx++,
          currentChunk.trim(),
          'prose',
          baseOffset,
          baseOffset + currentChunk.length,
        ));
        currentChunk = sentence;
        currentWordCount = sentenceWords;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
        currentWordCount += sentenceWords;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(this.createChunk(
        idx,
        currentChunk.trim(),
        'prose',
        baseOffset,
        baseOffset + text.length,
      ));
    }

    return chunks;
  }

  /**
   * Keep code blocks whole (don't split mid-function)
   */
  private chunkCode(segment: ContentSegment, startIndex: number): ChunkResult[] {
    // For now, keep entire code block as one chunk
    // Future: could split by function/class boundaries
    return [this.createChunk(
      startIndex,
      segment.content,
      'code',
      segment.startOffset,
      segment.endOffset,
      segment.language,
    )];
  }

  /**
   * Keep math blocks atomic
   */
  private chunkMath(segment: ContentSegment, startIndex: number): ChunkResult[] {
    // Math always stays as one chunk
    return [this.createChunk(
      startIndex,
      segment.content,
      'math',
      segment.startOffset,
      segment.endOffset,
    )];
  }

  /**
   * Keep tables whole
   */
  private chunkTable(segment: ContentSegment, startIndex: number): ChunkResult[] {
    return [this.createChunk(
      startIndex,
      segment.content,
      'table',
      segment.startOffset,
      segment.endOffset,
    )];
  }

  /**
   * Keep headings as single chunks
   */
  private chunkHeading(segment: ContentSegment, startIndex: number): ChunkResult[] {
    return [this.createChunk(
      startIndex,
      segment.content,
      'heading',
      segment.startOffset,
      segment.endOffset,
    )];
  }

  /**
   * Keep list as single chunk (for now)
   */
  private chunkList(segment: ContentSegment, startIndex: number): ChunkResult[] {
    // Could split very long lists, but keep together for now
    return [this.createChunk(
      startIndex,
      segment.content,
      'list',
      segment.startOffset,
      segment.endOffset,
    )];
  }

  /**
   * Create a ChunkResult
   */
  private createChunk(
    index: number,
    content: string,
    contentType: ContentType,
    startOffset: number,
    endOffset: number,
    language?: string,
  ): ChunkResult {
    const wordCount = this.countWords(content);
    return {
      id: `${this.options.idPrefix}_${index}`,
      content,
      contentType,
      language,
      wordCount,
      tokenCount: this.estimateTokens(content),
      startOffset,
      endOffset,
    };
  }

  /**
   * Get context before a position
   */
  private getContextBefore(text: string, offset: number): string {
    const start = Math.max(0, offset - this.options.contextSize);
    const context = text.slice(start, offset);
    return start > 0 ? '...' + context : context;
  }

  /**
   * Get context after a position
   */
  private getContextAfter(text: string, offset: number): string {
    const end = Math.min(text.length, offset + this.options.contextSize);
    const context = text.slice(offset, end);
    return end < text.length ? context + '...' : context;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Estimate token count (~4 chars per token)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Quick chunk function using default options
 */
export function chunkContent(text: string, options?: ChunkerOptions): ChunkResult[] {
  const chunker = new ContentChunker(options);
  return chunker.chunk(text);
}

// =============================================================================
// Exports
// =============================================================================

export { ContentType, ContentSegment } from './ContentAnalyzer';
export default ContentChunker;
