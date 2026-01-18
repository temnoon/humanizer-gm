/**
 * IngestionService - Pipeline from Archive to UCG
 *
 * Reads from archive tables (conversations, messages, content_items),
 * chunks content, generates embeddings, and creates ContentNodes.
 *
 * Archive (immutable) → UCG (working layer)
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

import { ContentGraphDatabase } from './ContentGraphDatabase.js';
import { ChunkingService, type ContentChunk } from './ChunkingService.js';
import type { ContentNodeRow } from './schema.js';
import type { UCGSourceType as SourceType } from '@humanizer/core';
import {
  embed,
  embedBatch,
  getModelName,
  initializeEmbedding,
} from '../embeddings/EmbeddingGenerator.js';

/**
 * Archive row types for reading
 */
interface ConversationRow {
  id: string;
  folder: string;
  title: string | null;
  created_at: number | null;
  updated_at: number | null;
  message_count: number;
  total_tokens: number;
  is_interesting: number;
  summary: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: string;
  content: string | null;
  created_at: number | null;
  token_count: number;
}

interface ContentItemRow {
  id: string;
  type: string;
  source: string;
  text: string | null;
  title: string | null;
  created_at: number;
  author_name: string | null;
  is_own_content: number;
  parent_id: string | null;
  thread_id: string | null;
  context: string | null;
  metadata: string | null;
  tags: string | null;
}

/**
 * Ingestion source detection
 */
export interface IngestionSource {
  table: 'conversations' | 'content_items';
  id: string;
  contentHash: string;
  lastModified?: number;
}

/**
 * Ingestion progress tracking
 */
export interface IngestionProgress {
  phase: 'detecting' | 'chunking' | 'embedding' | 'linking' | 'complete';
  current: number;
  total: number;
  currentItem?: string;
  errors: string[];
}

/**
 * Ingestion statistics
 */
export interface IngestionStats {
  sourcesProcessed: number;
  chunksCreated: number;
  embeddingsGenerated: number;
  linksCreated: number;
  skipped: number;
  errors: number;
  duration: number;
}

/**
 * Options for ingestion
 */
export interface IngestionOptions {
  batchSize?: number;
  skipEmbedding?: boolean;
  onProgress?: (progress: IngestionProgress) => void;
}

/**
 * IngestionService - Main service class
 */
export class IngestionService {
  private archiveDb: Database.Database;
  private ucgDb: ContentGraphDatabase;
  private chunker: ChunkingService;
  private vecLoaded: boolean;

  constructor(
    archiveDb: Database.Database,
    ucgDb: ContentGraphDatabase,
    vecLoaded: boolean = false
  ) {
    this.archiveDb = archiveDb;
    this.ucgDb = ucgDb;
    this.chunker = new ChunkingService();
    this.vecLoaded = vecLoaded;
  }

  /**
   * Ingest all pending archive items into UCG
   */
  async ingestAll(options: IngestionOptions = {}): Promise<IngestionStats> {
    const startTime = Date.now();
    const { batchSize = 50, skipEmbedding = false, onProgress } = options;

    const stats: IngestionStats = {
      sourcesProcessed: 0,
      chunksCreated: 0,
      embeddingsGenerated: 0,
      linksCreated: 0,
      skipped: 0,
      errors: 0,
      duration: 0,
    };

    const errors: string[] = [];

    // Phase 1: Detect pending items
    onProgress?.({
      phase: 'detecting',
      current: 0,
      total: 0,
      errors,
    });

    const pendingConversations = this.findPendingConversations();
    const pendingContentItems = this.findPendingContentItems();

    const totalItems = pendingConversations.length + pendingContentItems.length;
    console.log(`[ingestion] Found ${pendingConversations.length} conversations, ${pendingContentItems.length} content items to ingest`);

    if (totalItems === 0) {
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Initialize embedding if needed
    if (!skipEmbedding && this.vecLoaded) {
      try {
        await initializeEmbedding();
      } catch (err) {
        console.warn('[ingestion] Could not initialize embedding:', err);
      }
    }

    let processed = 0;

    // Phase 2: Ingest conversations
    for (let i = 0; i < pendingConversations.length; i += batchSize) {
      const batch = pendingConversations.slice(i, i + batchSize);

      for (const conv of batch) {
        try {
          onProgress?.({
            phase: 'chunking',
            current: processed,
            total: totalItems,
            currentItem: conv.title || conv.id,
            errors,
          });

          const result = await this.ingestConversation(conv.id, skipEmbedding);
          stats.sourcesProcessed++;
          stats.chunksCreated += result.chunksCreated;
          stats.embeddingsGenerated += result.embeddingsGenerated;
          stats.linksCreated += result.linksCreated;
        } catch (err) {
          stats.errors++;
          const errMsg = `Failed to ingest conversation ${conv.id}: ${err}`;
          errors.push(errMsg);
          console.error('[ingestion]', errMsg);
        }
        processed++;
      }
    }

    // Phase 3: Ingest content items
    for (let i = 0; i < pendingContentItems.length; i += batchSize) {
      const batch = pendingContentItems.slice(i, i + batchSize);

      for (const item of batch) {
        try {
          onProgress?.({
            phase: 'chunking',
            current: processed,
            total: totalItems,
            currentItem: item.title || item.id,
            errors,
          });

          const result = await this.ingestContentItem(item.id, skipEmbedding);
          stats.sourcesProcessed++;
          stats.chunksCreated += result.chunksCreated;
          stats.embeddingsGenerated += result.embeddingsGenerated;
          stats.linksCreated += result.linksCreated;
        } catch (err) {
          stats.errors++;
          const errMsg = `Failed to ingest content item ${item.id}: ${err}`;
          errors.push(errMsg);
          console.error('[ingestion]', errMsg);
        }
        processed++;
      }
    }

    onProgress?.({
      phase: 'complete',
      current: totalItems,
      total: totalItems,
      errors,
    });

    stats.duration = Date.now() - startTime;
    console.log(`[ingestion] Complete: ${stats.sourcesProcessed} sources, ${stats.chunksCreated} chunks, ${stats.embeddingsGenerated} embeddings in ${stats.duration}ms`);

    return stats;
  }

  /**
   * Ingest a single conversation
   */
  async ingestConversation(
    conversationId: string,
    skipEmbedding: boolean = false
  ): Promise<{ chunksCreated: number; embeddingsGenerated: number; linksCreated: number }> {
    // Get conversation from archive
    const conv = this.archiveDb.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `).get(conversationId) as ConversationRow | undefined;

    if (!conv) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    // Get messages
    const messages = this.archiveDb.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
    `).all(conversationId) as MessageRow[];

    if (messages.length === 0) {
      return { chunksCreated: 0, embeddingsGenerated: 0, linksCreated: 0 };
    }

    // Build full conversation text
    const fullText = messages
      .map(m => `${m.role}: ${m.content || ''}`)
      .join('\n\n');

    const contentHash = this.hashContent(fullText);

    // Check if already ingested
    const existing = this.findExistingNode('conversations', conversationId);
    if (existing && existing.content_hash === contentHash) {
      // Already up to date
      return { chunksCreated: 0, embeddingsGenerated: 0, linksCreated: 0 };
    }

    // Determine source type from folder
    const sourceType = this.detectSourceType(conv.folder);

    // Create source node (the full conversation)
    const now = Date.now();
    const sourceNodeId = uuidv4();
    const rootId = sourceNodeId;

    const sourceNode = this.ucgDb.createNode({
      text: fullText,
      format: 'conversation',
      title: conv.title || undefined,
      sourceType,
      sourceMetadata: {
        folder: conv.folder,
        messageCount: messages.length,
        isInteresting: conv.is_interesting === 1,
        summary: conv.summary,
      },
      tags: [],
    });

    // Mark as ingested
    this.markAsIngested(sourceNode.id, 'conversations', conversationId);

    let chunksCreated = 0;
    let embeddingsGenerated = 0;
    let linksCreated = 0;

    // Chunk the content
    const messagesForChunking = messages.map(m => ({
      role: m.role,
      content: m.content || '',
    }));

    const chunkResult = this.chunker.chunkContent(fullText, sourceType, {
      messages: messagesForChunking,
    });

    // Create chunk nodes
    const chunkNodes: Array<{ id: string; text: string }> = [];

    for (const chunk of chunkResult.chunks) {
      const chunkNodeId = uuidv4();
      const chunkHash = this.hashContent(chunk.text);

      // Create chunk node
      const chunkNode = this.ucgDb.createNode({
        text: chunk.text,
        format: 'text',
        sourceType,
        sourceMetadata: {
          parentNodeId: sourceNode.id,
          chunkIndex: chunk.index,
          chunkStartOffset: chunk.startOffset,
          chunkEndOffset: chunk.endOffset,
          boundaryType: chunk.boundaryType,
        },
      });

      // Update chunk metadata
      this.updateChunkMetadata(chunkNode.id, {
        parentNodeId: sourceNode.id,
        chunkIndex: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        threadRootId: rootId,
      });

      chunkNodes.push({ id: chunkNode.id, text: chunk.text });

      // Create derived-from link
      this.ucgDb.createLink({
        sourceId: chunkNode.id,
        targetId: sourceNode.id,
        type: 'derived-from',
        metadata: { chunkIndex: chunk.index },
      });
      linksCreated++;

      // Create parent link
      this.ucgDb.createLink({
        sourceId: sourceNode.id,
        targetId: chunkNode.id,
        type: 'parent',
        metadata: { chunkIndex: chunk.index },
      });
      linksCreated++;

      chunksCreated++;
    }

    // Create follows/precedes links between chunks
    for (let i = 1; i < chunkNodes.length; i++) {
      this.ucgDb.createLink({
        sourceId: chunkNodes[i].id,
        targetId: chunkNodes[i - 1].id,
        type: 'follows',
      });
      this.ucgDb.createLink({
        sourceId: chunkNodes[i - 1].id,
        targetId: chunkNodes[i].id,
        type: 'precedes',
      });
      linksCreated += 2;
    }

    // Generate embeddings for chunks
    if (!skipEmbedding && this.vecLoaded && chunkNodes.length > 0) {
      try {
        const embeddings = await embedBatch(chunkNodes.map(c => c.text));

        for (let i = 0; i < chunkNodes.length; i++) {
          if (embeddings[i] && !embeddings[i].every(v => v === 0)) {
            await this.storeEmbedding(chunkNodes[i].id, chunkNodes[i].text, embeddings[i]);
            embeddingsGenerated++;
          }
        }
      } catch (err) {
        console.warn(`[ingestion] Failed to generate embeddings for conversation ${conversationId}:`, err);
      }
    }

    return { chunksCreated, embeddingsGenerated, linksCreated };
  }

  /**
   * Ingest a single content item (Facebook post, etc.)
   */
  async ingestContentItem(
    itemId: string,
    skipEmbedding: boolean = false
  ): Promise<{ chunksCreated: number; embeddingsGenerated: number; linksCreated: number }> {
    // Get content item from archive
    const item = this.archiveDb.prepare(`
      SELECT * FROM content_items WHERE id = ?
    `).get(itemId) as ContentItemRow | undefined;

    if (!item || !item.text) {
      return { chunksCreated: 0, embeddingsGenerated: 0, linksCreated: 0 };
    }

    const contentHash = this.hashContent(item.text);

    // Check if already ingested
    const existing = this.findExistingNode('content_items', itemId);
    if (existing && existing.content_hash === contentHash) {
      return { chunksCreated: 0, embeddingsGenerated: 0, linksCreated: 0 };
    }

    // Determine source type
    const sourceType = this.mapContentItemType(item.type, item.source);

    // Create source node
    const sourceNode = this.ucgDb.createNode({
      text: item.text,
      format: 'text',
      title: item.title || undefined,
      author: item.author_name || undefined,
      sourceType,
      sourceMetadata: {
        type: item.type,
        source: item.source,
        isOwnContent: item.is_own_content === 1,
        parentId: item.parent_id,
        threadId: item.thread_id,
        context: item.context,
        metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      },
      tags: item.tags ? JSON.parse(item.tags) : [],
    });

    // Mark as ingested
    this.markAsIngested(sourceNode.id, 'content_items', itemId);

    let chunksCreated = 0;
    let embeddingsGenerated = 0;
    let linksCreated = 0;

    // Chunk if content is long
    const chunkResult = this.chunker.chunkContent(item.text, sourceType);

    // If only one chunk, use the source node directly
    if (chunkResult.chunks.length === 1) {
      // Generate embedding for source node directly
      if (!skipEmbedding && this.vecLoaded) {
        try {
          const embedding = await embed(item.text);
          if (!embedding.every(v => v === 0)) {
            await this.storeEmbedding(sourceNode.id, item.text, embedding);
            embeddingsGenerated++;
          }
        } catch (err) {
          console.warn(`[ingestion] Failed to generate embedding for content item ${itemId}:`, err);
        }
      }
      return { chunksCreated: 0, embeddingsGenerated, linksCreated: 0 };
    }

    // Create chunk nodes
    const chunkNodes: Array<{ id: string; text: string }> = [];

    for (const chunk of chunkResult.chunks) {
      const chunkNode = this.ucgDb.createNode({
        text: chunk.text,
        format: 'text',
        sourceType,
        sourceMetadata: {
          parentNodeId: sourceNode.id,
          chunkIndex: chunk.index,
          chunkStartOffset: chunk.startOffset,
          chunkEndOffset: chunk.endOffset,
          boundaryType: chunk.boundaryType,
        },
      });

      // Update chunk metadata
      this.updateChunkMetadata(chunkNode.id, {
        parentNodeId: sourceNode.id,
        chunkIndex: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        threadRootId: sourceNode.id,
      });

      chunkNodes.push({ id: chunkNode.id, text: chunk.text });

      // Create links
      this.ucgDb.createLink({
        sourceId: chunkNode.id,
        targetId: sourceNode.id,
        type: 'derived-from',
      });
      this.ucgDb.createLink({
        sourceId: sourceNode.id,
        targetId: chunkNode.id,
        type: 'parent',
      });
      linksCreated += 2;

      chunksCreated++;
    }

    // Create sequence links
    for (let i = 1; i < chunkNodes.length; i++) {
      this.ucgDb.createLink({
        sourceId: chunkNodes[i].id,
        targetId: chunkNodes[i - 1].id,
        type: 'follows',
      });
      this.ucgDb.createLink({
        sourceId: chunkNodes[i - 1].id,
        targetId: chunkNodes[i].id,
        type: 'precedes',
      });
      linksCreated += 2;
    }

    // Generate embeddings
    if (!skipEmbedding && this.vecLoaded && chunkNodes.length > 0) {
      try {
        const embeddings = await embedBatch(chunkNodes.map(c => c.text));

        for (let i = 0; i < chunkNodes.length; i++) {
          if (embeddings[i] && !embeddings[i].every(v => v === 0)) {
            await this.storeEmbedding(chunkNodes[i].id, chunkNodes[i].text, embeddings[i]);
            embeddingsGenerated++;
          }
        }
      } catch (err) {
        console.warn(`[ingestion] Failed to generate embeddings for content item ${itemId}:`, err);
      }
    }

    return { chunksCreated, embeddingsGenerated, linksCreated };
  }

  /**
   * Generate embeddings for nodes that don't have them
   */
  async embedPending(limit: number = 100): Promise<number> {
    if (!this.vecLoaded) {
      console.warn('[ingestion] Vector extension not loaded, cannot generate embeddings');
      return 0;
    }

    await initializeEmbedding();

    // Find nodes without embeddings (chunks only)
    const pendingNodes = this.archiveDb.prepare(`
      SELECT cn.id, cn.text
      FROM content_nodes cn
      WHERE cn.embedding_at IS NULL
        AND cn.text IS NOT NULL
        AND cn.text != ''
        AND cn.parent_node_id IS NOT NULL
      LIMIT ?
    `).all(limit) as Array<{ id: string; text: string }>;

    if (pendingNodes.length === 0) {
      return 0;
    }

    console.log(`[ingestion] Generating embeddings for ${pendingNodes.length} nodes`);

    let generated = 0;
    const batchSize = 32;

    for (let i = 0; i < pendingNodes.length; i += batchSize) {
      const batch = pendingNodes.slice(i, i + batchSize);
      const texts = batch.map(n => n.text);

      try {
        const embeddings = await embedBatch(texts);

        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j] && !embeddings[j].every(v => v === 0)) {
            await this.storeEmbedding(batch[j].id, batch[j].text, embeddings[j]);
            generated++;
          }
        }
      } catch (err) {
        console.warn(`[ingestion] Batch embedding failed:`, err);
      }
    }

    return generated;
  }

  /**
   * Find conversations that haven't been ingested yet
   */
  private findPendingConversations(): ConversationRow[] {
    // Find conversations not yet in UCG
    return this.archiveDb.prepare(`
      SELECT c.*
      FROM conversations c
      WHERE NOT EXISTS (
        SELECT 1 FROM content_nodes cn
        WHERE cn.ingested_from_table = 'conversations'
          AND cn.ingested_from_id = c.id
      )
      AND c.message_count > 0
      ORDER BY c.updated_at DESC
    `).all() as ConversationRow[];
  }

  /**
   * Find content items that haven't been ingested yet
   */
  private findPendingContentItems(): ContentItemRow[] {
    return this.archiveDb.prepare(`
      SELECT ci.*
      FROM content_items ci
      WHERE NOT EXISTS (
        SELECT 1 FROM content_nodes cn
        WHERE cn.ingested_from_table = 'content_items'
          AND cn.ingested_from_id = ci.id
      )
      AND ci.text IS NOT NULL
      AND ci.text != ''
      ORDER BY ci.created_at DESC
    `).all() as ContentItemRow[];
  }

  /**
   * Find existing node for archive item
   */
  private findExistingNode(table: string, id: string): ContentNodeRow | undefined {
    return this.archiveDb.prepare(`
      SELECT * FROM content_nodes
      WHERE ingested_from_table = ?
        AND ingested_from_id = ?
      LIMIT 1
    `).get(table, id) as ContentNodeRow | undefined;
  }

  /**
   * Mark a node as ingested from archive
   */
  private markAsIngested(nodeId: string, table: string, archiveId: string): void {
    this.archiveDb.prepare(`
      UPDATE content_nodes
      SET ingested_from_table = ?,
          ingested_from_id = ?,
          ingested_at = ?
      WHERE id = ?
    `).run(table, archiveId, Date.now(), nodeId);
  }

  /**
   * Update chunk metadata
   */
  private updateChunkMetadata(
    nodeId: string,
    metadata: {
      parentNodeId: string;
      chunkIndex: number;
      startOffset: number;
      endOffset: number;
      threadRootId: string;
    }
  ): void {
    this.archiveDb.prepare(`
      UPDATE content_nodes
      SET parent_node_id = ?,
          chunk_index = ?,
          chunk_start_offset = ?,
          chunk_end_offset = ?,
          thread_root_id = ?,
          hierarchy_level = 0
      WHERE id = ?
    `).run(
      metadata.parentNodeId,
      metadata.chunkIndex,
      metadata.startOffset,
      metadata.endOffset,
      metadata.threadRootId,
      nodeId
    );
  }

  /**
   * Store embedding for a node
   */
  private async storeEmbedding(nodeId: string, text: string, embedding: number[]): Promise<void> {
    const textHash = this.hashContent(text);
    const model = getModelName();

    // Update node metadata
    this.archiveDb.prepare(`
      UPDATE content_nodes
      SET embedding_model = ?,
          embedding_at = ?,
          embedding_text_hash = ?
      WHERE id = ?
    `).run(model, Date.now(), textHash, nodeId);

    // Store in vector table
    if (this.vecLoaded) {
      try {
        // Check if exists first
        const existing = this.archiveDb.prepare(`
          SELECT id FROM content_nodes_vec WHERE id = ?
        `).get(nodeId);

        if (existing) {
          // Update
          this.archiveDb.prepare(`
            UPDATE content_nodes_vec
            SET embedding = ?
            WHERE id = ?
          `).run(JSON.stringify(embedding), nodeId);
        } else {
          // Insert
          this.archiveDb.prepare(`
            INSERT INTO content_nodes_vec (id, content_hash, embedding)
            VALUES (?, ?, ?)
          `).run(nodeId, textHash, JSON.stringify(embedding));
        }
      } catch (err) {
        console.warn(`[ingestion] Failed to store embedding in vec table:`, err);
      }
    }
  }

  /**
   * Hash content for deduplication
   */
  private hashContent(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * Detect source type from conversation folder
   */
  private detectSourceType(folder: string): SourceType {
    const lower = folder.toLowerCase();
    if (lower.includes('openai') || lower.includes('chatgpt')) {
      return 'chatgpt';
    }
    if (lower.includes('claude') || lower.includes('anthropic')) {
      return 'claude';
    }
    if (lower.includes('gemini') || lower.includes('google')) {
      return 'gemini';
    }
    return 'chatgpt'; // Default
  }

  /**
   * Map content item type to source type
   */
  private mapContentItemType(type: string, source: string): SourceType {
    const lowerSource = source.toLowerCase();
    if (lowerSource.includes('facebook')) {
      if (type === 'post') return 'facebook-post';
      if (type === 'comment') return 'facebook-comment';
      if (type === 'message') return 'facebook-message';
      return 'facebook-post';
    }
    if (lowerSource.includes('twitter')) return 'twitter';
    if (lowerSource.includes('mastodon')) return 'mastodon';
    if (lowerSource.includes('discord')) return 'discord';
    if (lowerSource.includes('slack')) return 'slack';
    return 'import';
  }

  /**
   * Get ingestion statistics
   */
  getStats(): {
    totalNodes: number;
    totalChunks: number;
    nodesWithEmbeddings: number;
    pendingConversations: number;
    pendingContentItems: number;
  } {
    const totalNodes = (this.archiveDb.prepare(`
      SELECT COUNT(*) as count FROM content_nodes
    `).get() as { count: number }).count;

    const totalChunks = (this.archiveDb.prepare(`
      SELECT COUNT(*) as count FROM content_nodes WHERE parent_node_id IS NOT NULL
    `).get() as { count: number }).count;

    const nodesWithEmbeddings = (this.archiveDb.prepare(`
      SELECT COUNT(*) as count FROM content_nodes WHERE embedding_at IS NOT NULL
    `).get() as { count: number }).count;

    const pendingConversations = this.findPendingConversations().length;
    const pendingContentItems = this.findPendingContentItems().length;

    return {
      totalNodes,
      totalChunks,
      nodesWithEmbeddings,
      pendingConversations,
      pendingContentItems,
    };
  }
}
