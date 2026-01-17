/**
 * ArchiveIndexer - Build embedding index for an archive
 *
 * Orchestrates the indexing process:
 * 1. Walk archive to extract conversations
 * 2. Generate embeddings for messages
 * 3. Store in SQLite + sqlite-vec
 */

import { v4 as uuidv4 } from 'uuid';
import { EmbeddingDatabase } from './EmbeddingDatabase.js';
import {
  walkArchive,
  splitIntoParagraphs,
  splitIntoSentences,
  generateChunkId,
  type ExtractedConversation,
} from './ConversationWalker.js';
import {
  initializeEmbedding,
  embed,
  embedBatch,
  chunkForEmbedding,
  MAX_CHUNK_CHARS,
} from './EmbeddingGenerator.js';
import { ContentChunker, type ChunkResult } from './ContentChunker.js';
import {
  ContentBlockExtractor,
  type ExtractedBlock,
  type ExtractionContext,
} from './ContentBlockExtractor.js';
import type { IndexingProgress, Chunk, EnhancedChunk } from './types.js';

export interface IndexingOptions {
  /** Only embed messages from conversations marked as interesting */
  interestingOnly?: boolean;
  /** Include paragraph-level embeddings for all conversations */
  includeParagraphs?: boolean;
  /** Include sentence-level embeddings for selected messages */
  includeSentences?: boolean;
  /** Use content-aware chunking (detects code, math, tables) */
  useContentAwareChunking?: boolean;
  /** Extract and embed content blocks (code, prompts, artifacts) separately */
  extractContentBlocks?: boolean;
  /** Batch size for embedding generation */
  batchSize?: number;
  /** Progress callback */
  onProgress?: (progress: IndexingProgress) => void;
}

const DEFAULT_OPTIONS: IndexingOptions = {
  interestingOnly: false,
  includeParagraphs: false,
  includeSentences: false,
  useContentAwareChunking: false,
  extractContentBlocks: true, // Enable by default for granular search
  batchSize: 32,
};

// ============================================================================
// Junk Content Filter
// ============================================================================

/**
 * Check if a message contains junk content that shouldn't be embedded.
 * Filters out tool outputs, error tracebacks, command outputs, etc.
 */
function isJunkContent(message: { role: string; content: string }): boolean {
  const content = message.content;

  // Skip tool role messages entirely
  if (message.role === 'tool') return true;

  // Skip very short content
  if (content.length < 30) return true;

  // Skip image placeholders
  if (content.includes('<<ImageDisplay')) return true;

  // Skip error tracebacks
  if (content.includes('Traceback (most recent call last)')) return true;

  // Skip click/scroll/mclick commands (browser automation)
  if (/^(click|mclick|scroll)\s*\(/.test(content)) return true;

  // Skip search() tool calls
  if (content.startsWith('search("')) return true;

  // Skip JSON tool outputs
  if (content.startsWith('{"query":') || content.startsWith('{"type":')) return true;

  // Skip fetch/timeout errors
  if (content.includes('Failed to fetch') || content.includes('Timeout fetching')) return true;

  // Skip short error messages
  if (content.startsWith('Error ') && content.length < 200) return true;

  // Skip quote() failures
  if (content.startsWith('quote failed')) return true;

  return false;
}

// ============================================================================
// Smart Block Chunking (uses pyramid L0 spec from EmbeddingGenerator)
// ============================================================================

interface BlockChunk {
  content: string;
  chunkIndex: number;
  totalChunks: number;
}

/**
 * Split a large block into chunks for embedding.
 * Uses chunkForEmbedding from EmbeddingGenerator which follows pyramid L0 spec:
 * - Target ~1000 tokens (~4000 chars) per chunk
 * - Never split mid-sentence
 * - Prefer paragraph boundaries
 *
 * For code blocks, adds additional logic to split on function/class boundaries.
 */
function chunkBlock(content: string, blockType: string): BlockChunk[] {
  // If content fits in one chunk, return as-is
  if (content.length <= MAX_CHUNK_CHARS) {
    return [{ content, chunkIndex: 0, totalChunks: 1 }];
  }

  let chunks: string[];

  if (blockType === 'code') {
    // Split code on function/class definitions first, then use standard chunking
    chunks = chunkCode(content);
  } else if (blockType === 'json_data') {
    // For JSON arrays, try to split by elements
    chunks = chunkJson(content);
  } else {
    // Prose, transcription, artifact, etc: use standard pyramid chunking
    chunks = chunkForEmbedding(content);
  }

  return chunks.map((c, i) => ({
    content: c,
    chunkIndex: i,
    totalChunks: chunks.length,
  }));
}

/**
 * Chunk code on logical boundaries (functions, classes, blank line groups)
 * then apply standard chunking to any oversized pieces
 */
function chunkCode(content: string): string[] {
  // Try to split on function/class definitions
  const funcPattern = /\n(?=(?:async\s+)?(?:function|def|class|const\s+\w+\s*=\s*(?:async\s+)?(?:function|\())|(?:export\s+)?(?:async\s+)?function|(?:public|private|protected)?\s*(?:async\s+)?(?:static\s+)?\w+\s*\()/g;

  let parts = content.split(funcPattern);

  if (parts.length <= 1) {
    // Fall back to splitting on double blank lines
    parts = content.split(/\n\n\n+/);
  }

  if (parts.length <= 1) {
    // Last resort: split on single blank lines
    parts = content.split(/\n\n/);
  }

  // Combine small parts and chunk large ones
  const result: string[] = [];
  let currentChunk = '';

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 2 <= MAX_CHUNK_CHARS) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    } else {
      if (currentChunk.length > 0) {
        result.push(currentChunk);
      }
      // If part itself is too long, use standard chunking
      if (trimmed.length > MAX_CHUNK_CHARS) {
        result.push(...chunkForEmbedding(trimmed));
        currentChunk = '';
      } else {
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk);
  }

  return result.length > 0 ? result : chunkForEmbedding(content);
}

/**
 * Chunk JSON by trying to keep structure intact
 */
/**
 * Embed with automatic retry using smaller chunks if needed.
 * Returns embedding or null if all attempts fail.
 */
async function embedWithRetry(content: string, blockId: string): Promise<number[] | null> {
  // Try direct embed first
  try {
    return await embed(content);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // If context length error, try smaller chunks
    if (errMsg.includes('context length') || errMsg.includes('too long')) {
      console.warn(`[ContentBlocks] Chunk too large (${content.length} chars), splitting smaller for ${blockId}`);

      // Split into smaller pieces (half size)
      const halfSize = Math.floor(content.length / 2);
      const firstHalf = content.slice(0, halfSize);
      const secondHalf = content.slice(halfSize);

      try {
        // Just embed first half - better than nothing
        // The second half will be in the stored content
        return await embed(firstHalf);
      } catch (retryErr) {
        // Try even smaller
        const quarterSize = Math.floor(content.length / 4);
        try {
          return await embed(content.slice(0, quarterSize));
        } catch {
          console.error(`[ContentBlocks] Failed to embed even quarter chunk for ${blockId}, skipping embedding`);
          return null;
        }
      }
    }

    console.error(`[ContentBlocks] Embed error for ${blockId}: ${errMsg}`);
    return null;
  }
}

function chunkJson(content: string): string[] {
  const trimmed = content.trim();

  // If it's a JSON array, try to split by elements
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 1) {
        const chunks: string[] = [];
        let currentBatch: unknown[] = [];
        let currentSize = 2; // for []

        for (const item of parsed) {
          const itemStr = JSON.stringify(item);
          if (currentSize + itemStr.length + 1 <= MAX_CHUNK_CHARS) {
            currentBatch.push(item);
            currentSize += itemStr.length + 1;
          } else {
            if (currentBatch.length > 0) {
              chunks.push(JSON.stringify(currentBatch, null, 2));
            }
            currentBatch = [item];
            currentSize = 2 + itemStr.length;
          }
        }

        if (currentBatch.length > 0) {
          chunks.push(JSON.stringify(currentBatch, null, 2));
        }

        return chunks.length > 0 ? chunks : chunkForEmbedding(content);
      }
    } catch {
      // Not valid JSON array, fall through
    }
  }

  // Fall back to standard chunking for non-array JSON
  return chunkForEmbedding(content);
}

export class ArchiveIndexer {
  private db: EmbeddingDatabase;
  private archivePath: string;
  private progress: IndexingProgress;

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    this.db = new EmbeddingDatabase(archivePath);
    this.progress = {
      status: 'idle',
      phase: '',
      current: 0,
      total: 0,
    };
  }

  /**
   * Get the database instance
   */
  getDatabase(): EmbeddingDatabase {
    return this.db;
  }

  /**
   * Get current indexing progress
   */
  getProgress(): IndexingProgress {
    return { ...this.progress };
  }

  /**
   * Build the full index for the archive
   */
  async buildIndex(options: IndexingOptions = {}): Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      this.progress = {
        status: 'indexing',
        phase: 'initializing',
        current: 0,
        total: 0,
        startedAt: Date.now(),
      };
      this.notifyProgress(opts.onProgress);

      // Initialize embedding model
      this.progress.phase = 'loading_model';
      this.notifyProgress(opts.onProgress);
      await initializeEmbedding();

      // Phase 1: Extract and store conversations + messages
      await this.extractConversations(opts);

      // Phase 2: Generate message embeddings
      await this.embedMessages(opts);

      // Phase 3: Generate paragraph embeddings (if enabled)
      if (opts.includeParagraphs) {
        await this.embedParagraphs(opts);
      }

      // Phase 4: Extract and embed content blocks (code, prompts, artifacts)
      if (opts.extractContentBlocks) {
        await this.extractAndEmbedContentBlocks(opts);
      }

      this.progress = {
        status: 'complete',
        phase: 'done',
        current: this.progress.total,
        total: this.progress.total,
        startedAt: this.progress.startedAt,
        completedAt: Date.now(),
      };
      this.notifyProgress(opts.onProgress);

    } catch (error) {
      this.progress = {
        status: 'error',
        phase: 'failed',
        current: this.progress.current,
        total: this.progress.total,
        error: error instanceof Error ? error.message : String(error),
      };
      this.notifyProgress(opts.onProgress);
      throw error;
    }
  }

  /**
   * Phase 1: Extract conversations and messages from archive
   */
  private async extractConversations(opts: IndexingOptions): Promise<void> {
    this.progress.phase = 'extracting';
    this.notifyProgress(opts.onProgress);

    let count = 0;
    for await (const extracted of walkArchive(this.archivePath)) {
      // Store conversation
      this.db.insertConversation(extracted.conversation);

      // Store messages
      this.db.insertMessagesBatch(extracted.messages);

      count++;
      this.progress.current = count;
      this.progress.currentItem = extracted.conversation.title;

      if (count % 100 === 0) {
        this.notifyProgress(opts.onProgress);
      }
    }

    const stats = this.db.getStats();
    console.log(`Extracted ${stats.conversationCount} conversations, ${stats.messageCount} messages`);
  }

  /**
   * Phase 2: Generate embeddings for all messages
   */
  private async embedMessages(opts: IndexingOptions): Promise<void> {
    this.progress.phase = 'embedding_messages';
    this.notifyProgress(opts.onProgress);

    // Get messages without embeddings
    const allMessages = this.db.getMessagesWithoutEmbeddings();

    // Filter out junk content before embedding
    const messages = allMessages.filter(m => !isJunkContent(m));
    const skipped = allMessages.length - messages.length;

    this.progress.total = messages.length;
    this.progress.current = 0;

    console.log(`Generating embeddings for ${messages.length} messages (skipped ${skipped} junk)...`);

    const batchSize = opts.batchSize || 32;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const texts = batch.map(m => m.content);

      // Generate embeddings
      const embeddings = await embedBatch(texts, { batchSize });

      // Prepare batch inserts
      const embeddingInserts: Array<{
        id: string;
        conversationId: string;
        messageId: string;
        role: string;
        embedding: number[];
      }> = [];

      const messageUpdates: Array<{ id: string; embeddingId: string }> = [];

      for (let j = 0; j < batch.length; j++) {
        const message = batch[j];
        const embeddingId = uuidv4();

        embeddingInserts.push({
          id: embeddingId,
          conversationId: message.conversationId,
          messageId: message.id,
          role: message.role,
          embedding: embeddings[j],
        });

        messageUpdates.push({
          id: message.id,
          embeddingId,
        });
      }

      // Insert embeddings into vector table
      this.db.insertMessageEmbeddingsBatch(embeddingInserts);

      // Update messages with embedding IDs
      this.db.updateMessageEmbeddingIdsBatch(messageUpdates);

      this.progress.current = Math.min(i + batchSize, messages.length);
      this.notifyProgress(opts.onProgress);
    }

    const vecStats = this.db.getVectorStats();
    console.log(`Generated ${vecStats.messageCount} message embeddings`);
  }

  /**
   * Phase 3: Generate paragraph embeddings for interesting conversations
   */
  private async embedParagraphs(opts: IndexingOptions): Promise<void> {
    this.progress.phase = 'embedding_paragraphs';
    this.notifyProgress(opts.onProgress);

    // Get conversations to process
    const conversations = opts.interestingOnly
      ? this.db.getInterestingConversations()
      : this.db.getAllConversations();

    let totalChunks = 0;

    // Use content-aware chunker if enabled
    const contentChunker = opts.useContentAwareChunking
      ? new ContentChunker({ idPrefix: 'chunk' })
      : null;

    for (const conv of conversations) {
      const messages = this.db.getMessagesForConversation(conv.id);

      for (const message of messages) {
        if (contentChunker) {
          // Content-aware chunking (Phase 5)
          totalChunks += await this.embedWithContentAwareness(
            message,
            conv.id,
            contentChunker,
            totalChunks,
            opts
          );
        } else {
          // Legacy paragraph chunking
          totalChunks += await this.embedLegacyParagraphs(
            message,
            conv.id,
            totalChunks,
            opts
          );
        }
      }
    }

    console.log(`Generated ${totalChunks} paragraph embeddings`);
  }

  /**
   * Content-aware chunking using ContentChunker (Phase 5)
   */
  private async embedWithContentAwareness(
    message: { id: string; content: string; conversationId: string },
    conversationId: string,
    chunker: ContentChunker,
    currentTotal: number,
    opts: IndexingOptions
  ): Promise<number> {
    const chunks = chunker.chunk(message.content);
    let count = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Skip very short chunks
      if (chunk.content.length < 20) continue;

      const chunkId = generateChunkId(message.id, chunk.contentType, i);

      // Store chunk in legacy chunks table (for backwards compatibility)
      const chunkData: Omit<Chunk, 'embeddingId'> = {
        id: chunkId,
        messageId: message.id,
        chunkIndex: i,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        granularity: 'paragraph', // Legacy field - use contentType for new code
      };
      this.db.insertChunk(chunkData);

      // Phase 5: Store enhanced chunk metadata in pyramid_chunks
      // Use currentTotal + i for conversation-wide unique chunk index
      // (avoids UNIQUE(thread_id, chunk_index) collision across messages)
      this.db.insertPyramidChunk({
        id: chunkId,
        threadId: conversationId,
        threadType: 'conversation',
        chunkIndex: currentTotal + i,
        content: chunk.content,
        wordCount: chunk.wordCount,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        boundaryType: chunk.contentType, // For legacy compatibility
        contentType: chunk.contentType,
        language: chunk.language,
        contextBefore: chunk.contextBefore,
        contextAfter: chunk.contextAfter,
      });

      // Generate and store embedding
      const embedding = await embed(chunk.content);
      this.db.insertParagraphEmbedding(
        chunkId,
        conversationId,
        message.id,
        i,
        embedding
      );

      count++;
      this.progress.current = currentTotal + count;

      if ((currentTotal + count) % 100 === 0) {
        this.notifyProgress(opts.onProgress);
      }
    }

    return count;
  }

  /**
   * Legacy paragraph chunking (pre-Phase 5)
   */
  private async embedLegacyParagraphs(
    message: { id: string; content: string; conversationId: string },
    conversationId: string,
    currentTotal: number,
    opts: IndexingOptions
  ): Promise<number> {
    const paragraphs = splitIntoParagraphs(message.content);
    let count = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const chunkId = generateChunkId(message.id, 'paragraph', i);
      const paragraph = paragraphs[i];

      // Skip very short paragraphs
      if (paragraph.length < 20) continue;

      // Store chunk in SQLite
      const chunk: Omit<Chunk, 'embeddingId'> = {
        id: chunkId,
        messageId: message.id,
        chunkIndex: i,
        content: paragraph,
        tokenCount: Math.ceil(paragraph.length / 4),
        granularity: 'paragraph',
      };
      this.db.insertChunk(chunk);

      // Generate and store embedding
      const embedding = await embed(paragraph);
      this.db.insertParagraphEmbedding(
        chunkId,
        conversationId,
        message.id,
        i,
        embedding
      );

      count++;
      this.progress.current = currentTotal + count;

      if ((currentTotal + count) % 100 === 0) {
        this.notifyProgress(opts.onProgress);
      }
    }

    return count;
  }

  /**
   * Phase 4: Extract and embed content blocks (code, prompts, artifacts, transcriptions)
   *
   * This creates granular, searchable units from messages:
   * - Code blocks with language detection
   * - Image generation prompts (DALL-E)
   * - Claude artifacts
   * - ChatGPT canvas
   * - Journal/notebook transcriptions (via gizmo_id detection)
   */
  async extractAndEmbedContentBlocks(opts: IndexingOptions): Promise<void> {
    this.progress.phase = 'extracting_content_blocks';
    this.notifyProgress(opts.onProgress);

    const extractor = new ContentBlockExtractor();
    const conversations = this.db.getAllConversations();

    let totalBlocks = 0;
    let totalSkipped = 0;

    const stats = {
      code: 0,
      image_prompt: 0,
      artifact: 0,
      canvas: 0,
      transcription: 0,
      json_data: 0,
      prose: 0,
    };

    console.log(`[ContentBlocks] Extracting from ${conversations.length} conversations...`);

    for (const conv of conversations) {
      const messages = this.db.getMessagesForConversation(conv.id);

      // Get gizmo_id from conversation metadata if available
      let gizmoId: string | undefined;
      if (conv.metadata) {
        try {
          const meta = typeof conv.metadata === 'string'
            ? JSON.parse(conv.metadata)
            : conv.metadata;
          gizmoId = meta.gizmo_id;
        } catch {
          // Ignore parse errors
        }
      }

      for (const message of messages) {
        // Skip junk content
        if (isJunkContent(message)) {
          totalSkipped++;
          continue;
        }

        // Build extraction context
        const context: ExtractionContext = {
          messageId: message.id,
          conversationId: conv.id,
          conversationTitle: conv.title,
          gizmoId,
          createdAt: message.createdAt || conv.createdAt,
          role: message.role,
        };

        // Extract blocks
        const result = extractor.extract(message.content, context);

        // Process each extracted block
        for (const block of result.blocks) {
          // Skip very short blocks
          if (block.content.length < 30) continue;

          // Chunk large blocks instead of truncating - preserves all content
          const chunks = chunkBlock(block.content, block.blockType);

          // Store the parent content block (full content, first chunk's embedding)
          const firstChunkEmbedding = await embedWithRetry(chunks[0].content, block.id);
          const parentEmbeddingId = firstChunkEmbedding ? uuidv4() : undefined;

          // Build metadata including chunk info if multi-chunk
          const blockMetadata = {
            ...block.metadata,
            ...(chunks.length > 1 ? { totalChunks: chunks.length } : {}),
            ...(firstChunkEmbedding === null ? { embeddingFailed: true } : {}),
          };

          this.db.insertContentBlock({
            id: block.id,
            parentMessageId: block.parentMessageId,
            parentConversationId: block.parentConversationId,
            blockType: block.blockType,
            language: block.language,
            content: block.content, // Store FULL content always
            startOffset: block.startOffset,
            endOffset: block.endOffset,
            conversationTitle: block.conversationTitle,
            gizmoId: block.gizmoId,
            createdAt: block.createdAt,
            metadata: Object.keys(blockMetadata).length > 0 ? JSON.stringify(blockMetadata) : undefined,
            embeddingId: parentEmbeddingId,
          });

          // Store embedding for first chunk (if successful)
          if (firstChunkEmbedding && parentEmbeddingId) {
            this.db.insertContentBlockEmbedding(
              parentEmbeddingId,
              block.id,
              block.blockType,
              block.gizmoId,
              firstChunkEmbedding
            );
          }

          totalBlocks++;
          stats[block.blockType as keyof typeof stats]++;

          // For multi-chunk blocks, embed remaining chunks with links to parent
          if (chunks.length > 1) {
            for (let i = 1; i < chunks.length; i++) {
              const chunk = chunks[i];
              const chunkBlockId = `${block.id}-chunk-${i}`;
              const chunkEmbedding = await embedWithRetry(chunk.content, chunkBlockId);
              const chunkEmbeddingId = chunkEmbedding ? uuidv4() : undefined;

              // Store chunk as separate content block with parent reference
              this.db.insertContentBlock({
                id: chunkBlockId,
                parentMessageId: block.parentMessageId,
                parentConversationId: block.parentConversationId,
                blockType: block.blockType,
                language: block.language,
                content: chunk.content, // Store chunk content always
                startOffset: block.startOffset,
                endOffset: block.endOffset,
                conversationTitle: block.conversationTitle,
                gizmoId: block.gizmoId,
                createdAt: block.createdAt,
                metadata: JSON.stringify({
                  parentBlockId: block.id,
                  chunkIndex: chunk.chunkIndex,
                  totalChunks: chunk.totalChunks,
                  ...(chunkEmbedding === null ? { embeddingFailed: true } : {}),
                }),
                embeddingId: chunkEmbeddingId,
              });

              // Store chunk embedding (if successful)
              if (chunkEmbedding && chunkEmbeddingId) {
                this.db.insertContentBlockEmbedding(
                  chunkEmbeddingId,
                  chunkBlockId,
                  block.blockType,
                  block.gizmoId,
                  chunkEmbedding
                );
              }

              totalBlocks++;
            }
          }

          // Update progress
          if (totalBlocks % 100 === 0) {
            this.progress.current = totalBlocks;
            this.progress.currentItem = `${block.blockType}: ${block.content.slice(0, 50)}...`;
            this.notifyProgress(opts.onProgress);
          }
        }
      }
    }

    console.log(`[ContentBlocks] Extracted ${totalBlocks} blocks (skipped ${totalSkipped} junk messages)`);
    console.log(`[ContentBlocks] Stats: code=${stats.code}, prompts=${stats.image_prompt}, artifacts=${stats.artifact}, transcriptions=${stats.transcription}, prose=${stats.prose}`);
  }

  /**
   * Add sentence-level embeddings for a specific message
   */
  async embedMessageSentences(messageId: string): Promise<number> {
    const message = this.db.getMessage(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    const sentences = splitIntoSentences(message.content);
    let count = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (sentence.length < 10) continue;

      const chunkId = generateChunkId(messageId, 'sentence', i);

      // Store chunk
      const chunk: Omit<Chunk, 'embeddingId'> = {
        id: chunkId,
        messageId,
        chunkIndex: i,
        content: sentence,
        tokenCount: Math.ceil(sentence.length / 4),
        granularity: 'sentence',
      };
      this.db.insertChunk(chunk);

      // Generate and store embedding
      const embedding = await embed(sentence);
      this.db.insertSentenceEmbedding(
        chunkId,
        message.conversationId,
        messageId,
        i,
        i,  // sentence_index same as chunk_index for now
        embedding
      );

      count++;
    }

    return count;
  }

  /**
   * Mark a conversation as interesting (triggers finer-grain indexing)
   */
  async markInteresting(conversationId: string, interesting: boolean = true): Promise<void> {
    this.db.markConversationInteresting(conversationId, interesting);

    // If marking as interesting and paragraphs not already indexed, index them
    if (interesting) {
      const messages = this.db.getMessagesForConversation(conversationId);
      for (const message of messages) {
        const existingChunks = this.db.getChunksForMessage(message.id);
        const hasParagraphs = existingChunks.some(c => c.granularity === 'paragraph');

        if (!hasParagraphs) {
          const paragraphs = splitIntoParagraphs(message.content);
          for (let i = 0; i < paragraphs.length; i++) {
            const paragraph = paragraphs[i];
            if (paragraph.length < 20) continue;

            const chunkId = generateChunkId(message.id, 'paragraph', i);
            const chunk: Omit<Chunk, 'embeddingId'> = {
              id: chunkId,
              messageId: message.id,
              chunkIndex: i,
              content: paragraph,
              tokenCount: Math.ceil(paragraph.length / 4),
              granularity: 'paragraph',
            };
            this.db.insertChunk(chunk);

            const embedding = await embed(paragraph);
            this.db.insertParagraphEmbedding(
              chunkId,
              conversationId,
              message.id,
              i,
              embedding
            );
          }
        }
      }
    }
  }

  /**
   * Generate summary embedding for a conversation
   */
  async generateSummaryEmbedding(conversationId: string, summary: string): Promise<string> {
    const embeddingId = uuidv4();
    const embedding = await embed(summary);

    this.db.insertSummaryEmbedding(embeddingId, conversationId, embedding);
    this.db.updateConversationSummary(conversationId, summary, embeddingId);

    return embeddingId;
  }

  /**
   * Search for similar messages
   */
  async searchMessages(query: string, limit: number = 20) {
    const queryEmbedding = await embed(query);
    return this.db.searchMessages(queryEmbedding, limit);
  }

  /**
   * Search for similar conversations (by summary)
   */
  async searchConversations(query: string, limit: number = 20) {
    const queryEmbedding = await embed(query);
    return this.db.searchSummaries(queryEmbedding, limit);
  }

  /**
   * Find messages similar to a given message
   */
  async findSimilarMessages(
    messageEmbeddingId: string,
    limit: number = 20,
    excludeSameConversation: boolean = false
  ) {
    return this.db.findSimilarToMessage(messageEmbeddingId, limit, excludeSameConversation);
  }

  /**
   * Get indexing statistics
   */
  getStats() {
    const dbStats = this.db.getStats();
    const vecStats = this.db.getVectorStats();

    return {
      ...dbStats,
      vectorStats: vecStats,
      hasVectorSupport: this.db.hasVectorSupport(),
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  private notifyProgress(callback?: (progress: IndexingProgress) => void): void {
    if (callback) {
      callback(this.getProgress());
    }
  }
}
