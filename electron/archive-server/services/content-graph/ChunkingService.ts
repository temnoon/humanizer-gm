/**
 * ChunkingService - Split content into embeddable chunks
 *
 * Different chunking strategies for different content types:
 * - Conversations: By message turns
 * - Prose/articles: By paragraphs, then sentences
 * - Code: By function/block (syntax-aware)
 * - Short content: Keep as single chunk
 */

import type { UCGSourceType as SourceType } from '@humanizer/core';

// Target chunk size (~400-500 words, ~4 chars per word on average)
export const TARGET_CHUNK_CHARS = 2000;
export const MAX_CHUNK_CHARS = 4000;  // Match EmbeddingGenerator limit
export const MIN_CHUNK_CHARS = 200;   // Avoid tiny chunks

/**
 * A single chunk of content
 */
export interface ContentChunk {
  text: string;              // The chunk content
  index: number;             // 0-based sequence within parent
  startOffset: number;       // Character position in source
  endOffset: number;         // End position in source
  boundaryType: ChunkBoundary;  // What caused this split
  wordCount: number;         // Word count for this chunk
}

/**
 * Result of chunking a piece of content
 */
export interface ChunkingResult {
  chunks: ContentChunk[];
  totalChunks: number;
  strategy: ChunkingStrategy;
  sourceWordCount: number;
}

/**
 * What boundary was used to split the chunk
 */
export type ChunkBoundary =
  | 'message'      // Chat message boundary
  | 'paragraph'    // Double newline
  | 'sentence'     // Sentence ending (. ! ?)
  | 'clause'       // Comma, semicolon
  | 'hard'         // Forced split (rare)
  | 'none';        // Single chunk (no splitting)

/**
 * Chunking strategy used
 */
export type ChunkingStrategy =
  | 'conversation'  // By message turns
  | 'paragraph'     // By paragraphs
  | 'sentence'      // By sentences
  | 'single';       // No chunking needed

/**
 * Configuration for chunking
 */
export interface ChunkingConfig {
  targetChars: number;
  maxChars: number;
  minChars: number;
  overlapChars: number;  // Overlap between chunks for context continuity
}

const DEFAULT_CONFIG: ChunkingConfig = {
  targetChars: TARGET_CHUNK_CHARS,
  maxChars: MAX_CHUNK_CHARS,
  minChars: MIN_CHUNK_CHARS,
  overlapChars: 0,  // Can be enabled if needed
};

/**
 * ChunkingService - Main service class
 */
export class ChunkingService {
  private config: ChunkingConfig;

  constructor(config: Partial<ChunkingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Chunk content based on its source type
   */
  chunkContent(
    text: string,
    sourceType: SourceType,
    metadata?: { messages?: Array<{ role: string; content: string }> }
  ): ChunkingResult {
    const sourceWordCount = this.countWords(text);

    // Short content doesn't need chunking
    if (text.length <= this.config.maxChars) {
      return {
        chunks: [{
          text,
          index: 0,
          startOffset: 0,
          endOffset: text.length,
          boundaryType: 'none',
          wordCount: sourceWordCount,
        }],
        totalChunks: 1,
        strategy: 'single',
        sourceWordCount,
      };
    }

    // Choose strategy based on source type
    switch (sourceType) {
      case 'chatgpt':
      case 'claude':
      case 'gemini':
        // For conversations, try to use message-based chunking if messages available
        if (metadata?.messages && metadata.messages.length > 0) {
          return this.chunkByMessages(text, metadata.messages, sourceWordCount);
        }
        // Fall through to paragraph chunking
        return this.chunkByParagraphs(text, sourceWordCount);

      case 'markdown':
      case 'text':
      case 'html':
        return this.chunkByParagraphs(text, sourceWordCount);

      case 'facebook-post':
      case 'facebook-comment':
      case 'twitter':
      case 'mastodon':
        // Social posts are usually short, but chunk if needed
        return this.chunkByParagraphs(text, sourceWordCount);

      default:
        // Default to paragraph-based chunking
        return this.chunkByParagraphs(text, sourceWordCount);
    }
  }

  /**
   * Chunk by conversation message turns
   */
  private chunkByMessages(
    _fullText: string,
    messages: Array<{ role: string; content: string }>,
    sourceWordCount: number
  ): ChunkingResult {
    const chunks: ContentChunk[] = [];
    let currentChunk = '';
    let currentOffset = 0;
    let chunkStartOffset = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgText = `${msg.role}: ${msg.content}\n\n`;

      // Check if adding this message would exceed limit
      if (currentChunk.length + msgText.length > this.config.maxChars && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
          boundaryType: 'message',
          wordCount: this.countWords(currentChunk),
        });
        currentChunk = '';
        chunkStartOffset = currentOffset;
      }

      // If single message is too long, chunk it by paragraphs
      if (msgText.length > this.config.maxChars) {
        const subResult = this.chunkByParagraphs(msgText, this.countWords(msgText));
        for (const subChunk of subResult.chunks) {
          chunks.push({
            text: subChunk.text,
            index: chunks.length,
            startOffset: chunkStartOffset + subChunk.startOffset,
            endOffset: chunkStartOffset + subChunk.endOffset,
            boundaryType: subChunk.boundaryType,
            wordCount: subChunk.wordCount,
          });
        }
        currentOffset += msgText.length;
        chunkStartOffset = currentOffset;
      } else {
        currentChunk += msgText;
        currentOffset += msgText.length;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startOffset: chunkStartOffset,
        endOffset: currentOffset,
        boundaryType: 'message',
        wordCount: this.countWords(currentChunk),
      });
    }

    return {
      chunks,
      totalChunks: chunks.length,
      strategy: 'conversation',
      sourceWordCount,
    };
  }

  /**
   * Chunk by paragraph boundaries (double newline)
   */
  private chunkByParagraphs(text: string, sourceWordCount: number): ChunkingResult {
    const chunks: ContentChunk[] = [];

    // Split on paragraph boundaries
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    if (paragraphs.length <= 1) {
      // No paragraph breaks, fall back to sentences
      return this.chunkBySentences(text, sourceWordCount);
    }

    let currentChunk = '';
    let chunkStartOffset = 0;
    let currentOffset = 0;

    for (const para of paragraphs) {
      const paraWithBreak = para + '\n\n';

      // Check if adding this paragraph would exceed limit
      if (currentChunk.length + paraWithBreak.length > this.config.maxChars && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
          boundaryType: 'paragraph',
          wordCount: this.countWords(currentChunk),
        });
        currentChunk = '';
        chunkStartOffset = currentOffset;
      }

      // If single paragraph is too long, chunk it by sentences
      if (paraWithBreak.length > this.config.maxChars) {
        if (currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            index: chunks.length,
            startOffset: chunkStartOffset,
            endOffset: currentOffset,
            boundaryType: 'paragraph',
            wordCount: this.countWords(currentChunk),
          });
          currentChunk = '';
          chunkStartOffset = currentOffset;
        }

        const subResult = this.chunkBySentences(para, this.countWords(para));
        for (const subChunk of subResult.chunks) {
          chunks.push({
            text: subChunk.text,
            index: chunks.length,
            startOffset: chunkStartOffset + subChunk.startOffset,
            endOffset: chunkStartOffset + subChunk.endOffset,
            boundaryType: subChunk.boundaryType,
            wordCount: subChunk.wordCount,
          });
        }
        currentOffset += paraWithBreak.length;
        chunkStartOffset = currentOffset;
      } else {
        currentChunk += paraWithBreak;
        currentOffset += paraWithBreak.length;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startOffset: chunkStartOffset,
        endOffset: currentOffset,
        boundaryType: 'paragraph',
        wordCount: this.countWords(currentChunk),
      });
    }

    return {
      chunks,
      totalChunks: chunks.length,
      strategy: 'paragraph',
      sourceWordCount,
    };
  }

  /**
   * Chunk by sentence boundaries
   */
  private chunkBySentences(text: string, sourceWordCount: number): ChunkingResult {
    const chunks: ContentChunk[] = [];

    // Split on sentence endings: . ! ? followed by space/newline
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

    let currentChunk = '';
    let chunkStartOffset = 0;
    let currentOffset = 0;

    for (const sentence of sentences) {
      const sentenceWithSpace = sentence + ' ';

      // Check if adding this sentence would exceed limit
      if (currentChunk.length + sentenceWithSpace.length > this.config.maxChars && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
          boundaryType: 'sentence',
          wordCount: this.countWords(currentChunk),
        });
        currentChunk = '';
        chunkStartOffset = currentOffset;
      }

      // If single sentence is too long, chunk by clauses
      if (sentenceWithSpace.length > this.config.maxChars) {
        if (currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            index: chunks.length,
            startOffset: chunkStartOffset,
            endOffset: currentOffset,
            boundaryType: 'sentence',
            wordCount: this.countWords(currentChunk),
          });
          currentChunk = '';
          chunkStartOffset = currentOffset;
        }

        const subChunks = this.chunkByClauses(sentence);
        for (const subChunk of subChunks) {
          chunks.push({
            text: subChunk.text,
            index: chunks.length,
            startOffset: chunkStartOffset + subChunk.startOffset,
            endOffset: chunkStartOffset + subChunk.endOffset,
            boundaryType: subChunk.boundaryType,
            wordCount: subChunk.wordCount,
          });
        }
        currentOffset += sentenceWithSpace.length;
        chunkStartOffset = currentOffset;
      } else {
        currentChunk += sentenceWithSpace;
        currentOffset += sentenceWithSpace.length;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startOffset: chunkStartOffset,
        endOffset: currentOffset,
        boundaryType: 'sentence',
        wordCount: this.countWords(currentChunk),
      });
    }

    return {
      chunks,
      totalChunks: chunks.length,
      strategy: 'sentence',
      sourceWordCount,
    };
  }

  /**
   * Chunk by clause boundaries (last resort)
   */
  private chunkByClauses(text: string): ContentChunk[] {
    const chunks: ContentChunk[] = [];

    // Split on clause boundaries: , ; :
    const clauses = text.split(/(?<=[,;:])\s+/).filter(c => c.trim().length > 0);

    let currentChunk = '';
    let chunkStartOffset = 0;
    let currentOffset = 0;

    for (const clause of clauses) {
      const clauseWithSpace = clause + ' ';

      if (currentChunk.length + clauseWithSpace.length > this.config.maxChars && currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index: chunks.length,
          startOffset: chunkStartOffset,
          endOffset: currentOffset,
          boundaryType: 'clause',
          wordCount: this.countWords(currentChunk),
        });
        currentChunk = '';
        chunkStartOffset = currentOffset;
      }

      // If even a clause is too long, hard split
      if (clauseWithSpace.length > this.config.maxChars) {
        if (currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            index: chunks.length,
            startOffset: chunkStartOffset,
            endOffset: currentOffset,
            boundaryType: 'clause',
            wordCount: this.countWords(currentChunk),
          });
          currentChunk = '';
          chunkStartOffset = currentOffset;
        }

        // Hard split
        for (let i = 0; i < clause.length; i += this.config.maxChars) {
          const hardChunk = clause.slice(i, i + this.config.maxChars);
          chunks.push({
            text: hardChunk,
            index: chunks.length,
            startOffset: chunkStartOffset + i,
            endOffset: chunkStartOffset + i + hardChunk.length,
            boundaryType: 'hard',
            wordCount: this.countWords(hardChunk),
          });
        }
        currentOffset += clauseWithSpace.length;
        chunkStartOffset = currentOffset;
      } else {
        currentChunk += clauseWithSpace;
        currentOffset += clauseWithSpace.length;
      }
    }

    // Add remaining
    if (currentChunk.trim().length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunks.length,
        startOffset: chunkStartOffset,
        endOffset: currentOffset,
        boundaryType: 'clause',
        wordCount: this.countWords(currentChunk),
      });
    }

    return chunks;
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Get configuration
   */
  getConfig(): ChunkingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ChunkingConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Default singleton instance
let defaultChunkingService: ChunkingService | null = null;

export function getChunkingService(): ChunkingService {
  if (!defaultChunkingService) {
    defaultChunkingService = new ChunkingService();
  }
  return defaultChunkingService;
}
