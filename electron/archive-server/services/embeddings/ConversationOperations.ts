/**
 * ConversationOperations - Conversation, Message, Chunk, UserMark, Cluster, Anchor operations
 *
 * Extracted from EmbeddingDatabase for maintainability.
 */

import { v4 as uuidv4 } from 'uuid';
import { DatabaseOperations } from './DatabaseOperations.js';
import type {
  Conversation,
  Message,
  Chunk,
  UserMark,
  Cluster,
  ClusterMember,
  Anchor,
  MarkType,
  TargetType,
  AnchorType,
} from './types.js';

export class ConversationOperations extends DatabaseOperations {
  // ===========================================================================
  // Conversation Operations
  // ===========================================================================

  insertConversation(conv: Omit<Conversation, 'isInteresting' | 'summary' | 'summaryEmbeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations
      (id, folder, title, created_at, updated_at, message_count, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      conv.id,
      conv.folder,
      conv.title,
      conv.createdAt,
      conv.updatedAt,
      conv.messageCount,
      conv.totalTokens
    );
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  getAllConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToConversation(r));
  }

  getInterestingConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations WHERE is_interesting = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToConversation(r));
  }

  markConversationInteresting(id: string, interesting: boolean): void {
    this.db.prepare('UPDATE conversations SET is_interesting = ? WHERE id = ?').run(interesting ? 1 : 0, id);
  }

  updateConversationSummary(id: string, summary: string, embeddingId: string): void {
    this.db.prepare('UPDATE conversations SET summary = ?, summary_embedding_id = ? WHERE id = ?').run(summary, embeddingId, id);
  }

  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      folder: row.folder as string,
      title: row.title as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
      isInteresting: (row.is_interesting as number) === 1,
      summary: row.summary as string | null,
      summaryEmbeddingId: row.summary_embedding_id as string | null,
    };
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  insertMessage(msg: Omit<Message, 'embeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, conversation_id, parent_id, role, content, created_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.conversationId,
      msg.parentId,
      msg.role,
      msg.content,
      msg.createdAt,
      msg.tokenCount
    );
  }

  insertMessagesBatch(messages: Omit<Message, 'embeddingId'>[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, conversation_id, parent_id, role, content, created_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((msgs: Omit<Message, 'embeddingId'>[]) => {
      for (const msg of msgs) {
        insert.run(msg.id, msg.conversationId, msg.parentId, msg.role, msg.content, msg.createdAt, msg.tokenCount);
      }
    });

    insertMany(messages);
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToMessage(row);
  }

  getMessagesForConversation(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as Record<string, unknown>[];
    return rows.map(r => this.rowToMessage(r));
  }

  getAllMessages(): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY created_at').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToMessage(r));
  }

  getMessagesWithoutEmbeddings(): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE embedding_id IS NULL').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToMessage(r));
  }

  updateMessageEmbeddingId(id: string, embeddingId: string): void {
    this.db.prepare('UPDATE messages SET embedding_id = ? WHERE id = ?').run(embeddingId, id);
  }

  updateMessageEmbeddingIdsBatch(updates: { id: string; embeddingId: string }[]): void {
    const update = this.db.prepare('UPDATE messages SET embedding_id = ? WHERE id = ?');
    const updateMany = this.db.transaction((items: { id: string; embeddingId: string }[]) => {
      for (const item of items) {
        update.run(item.embeddingId, item.id);
      }
    });
    updateMany(updates);
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      parentId: row.parent_id as string | null,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content as string,
      createdAt: row.created_at as number,
      tokenCount: row.token_count as number,
      embeddingId: row.embedding_id as string | null,
    };
  }

  // ===========================================================================
  // Chunk Operations
  // ===========================================================================

  insertChunk(chunk: Omit<Chunk, 'embeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO chunks
      (id, message_id, chunk_index, content, token_count, granularity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.messageId,
      chunk.chunkIndex,
      chunk.content,
      chunk.tokenCount,
      chunk.granularity
    );
  }

  insertChunksBatch(chunks: Omit<Chunk, 'embeddingId'>[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO chunks
      (id, message_id, chunk_index, content, token_count, granularity)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Omit<Chunk, 'embeddingId'>[]) => {
      for (const chunk of items) {
        insert.run(chunk.id, chunk.messageId, chunk.chunkIndex, chunk.content, chunk.tokenCount, chunk.granularity);
      }
    });

    insertMany(chunks);
  }

  getChunksForMessage(messageId: string): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE message_id = ? ORDER BY chunk_index').all(messageId) as Record<string, unknown>[];
    return rows.map(r => this.rowToChunk(r));
  }

  getChunksByGranularity(granularity: 'paragraph' | 'sentence'): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE granularity = ?').all(granularity) as Record<string, unknown>[];
    return rows.map(r => this.rowToChunk(r));
  }

  updateChunkEmbeddingId(id: string, embeddingId: string): void {
    this.db.prepare('UPDATE chunks SET embedding_id = ? WHERE id = ?').run(embeddingId, id);
  }

  private rowToChunk(row: Record<string, unknown>): Chunk {
    return {
      id: row.id as string,
      messageId: row.message_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      tokenCount: row.token_count as number,
      embeddingId: row.embedding_id as string | null,
      granularity: row.granularity as 'paragraph' | 'sentence',
    };
  }

  // ===========================================================================
  // Pyramid Chunk Operations (Content-Type Aware)
  // ===========================================================================

  insertPyramidChunk(chunk: {
    id: string;
    threadId: string;
    threadType: string;
    chunkIndex: number;
    content: string;
    wordCount: number;
    startOffset?: number;
    endOffset?: number;
    boundaryType?: string;
    contentType?: string;
    language?: string;
    contextBefore?: string;
    contextAfter?: string;
    linkedChunkIds?: string[];
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pyramid_chunks
      (id, thread_id, thread_type, chunk_index, content, word_count,
       start_offset, end_offset, boundary_type, created_at,
       content_type, language, context_before, context_after, linked_chunk_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.threadId,
      chunk.threadType,
      chunk.chunkIndex,
      chunk.content,
      chunk.wordCount,
      chunk.startOffset ?? null,
      chunk.endOffset ?? null,
      chunk.boundaryType ?? null,
      Date.now(),
      chunk.contentType ?? null,
      chunk.language ?? null,
      chunk.contextBefore ?? null,
      chunk.contextAfter ?? null,
      chunk.linkedChunkIds ? JSON.stringify(chunk.linkedChunkIds) : null
    );
  }

  insertPyramidChunksBatch(chunks: Array<{
    id: string;
    threadId: string;
    threadType: string;
    chunkIndex: number;
    content: string;
    wordCount: number;
    startOffset?: number;
    endOffset?: number;
    boundaryType?: string;
    contentType?: string;
    language?: string;
    contextBefore?: string;
    contextAfter?: string;
    linkedChunkIds?: string[];
  }>): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO pyramid_chunks
      (id, thread_id, thread_type, chunk_index, content, word_count,
       start_offset, end_offset, boundary_type, created_at,
       content_type, language, context_before, context_after, linked_chunk_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof chunks) => {
      const now = Date.now();
      for (const chunk of items) {
        insert.run(
          chunk.id,
          chunk.threadId,
          chunk.threadType,
          chunk.chunkIndex,
          chunk.content,
          chunk.wordCount,
          chunk.startOffset ?? null,
          chunk.endOffset ?? null,
          chunk.boundaryType ?? null,
          now,
          chunk.contentType ?? null,
          chunk.language ?? null,
          chunk.contextBefore ?? null,
          chunk.contextAfter ?? null,
          chunk.linkedChunkIds ? JSON.stringify(chunk.linkedChunkIds) : null
        );
      }
    });

    insertMany(chunks);
  }

  getPyramidChunksByContentType(contentType: string): Array<{
    id: string;
    threadId: string;
    content: string;
    contentType: string;
    language?: string;
  }> {
    const rows = this.db.prepare(`
      SELECT id, thread_id, content, content_type, language
      FROM pyramid_chunks
      WHERE content_type = ?
    `).all(contentType) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as string,
      threadId: row.thread_id as string,
      content: row.content as string,
      contentType: row.content_type as string,
      language: row.language as string | undefined,
    }));
  }

  // ===========================================================================
  // User Mark Operations
  // ===========================================================================

  addUserMark(targetType: TargetType, targetId: string, markType: MarkType, note?: string): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO user_marks (id, target_type, target_id, mark_type, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, targetType, targetId, markType, note || null, Date.now() / 1000);
    return id;
  }

  removeUserMark(id: string): void {
    this.db.prepare('DELETE FROM user_marks WHERE id = ?').run(id);
  }

  getUserMarksForTarget(targetType: TargetType, targetId: string): UserMark[] {
    const rows = this.db.prepare('SELECT * FROM user_marks WHERE target_type = ? AND target_id = ?').all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(r => this.rowToUserMark(r));
  }

  getUserMarksByType(markType: MarkType): UserMark[] {
    const rows = this.db.prepare('SELECT * FROM user_marks WHERE mark_type = ?').all(markType) as Record<string, unknown>[];
    return rows.map(r => this.rowToUserMark(r));
  }

  private rowToUserMark(row: Record<string, unknown>): UserMark {
    return {
      id: row.id as string,
      targetType: row.target_type as TargetType,
      targetId: row.target_id as string,
      markType: row.mark_type as MarkType,
      note: row.note as string | null,
      createdAt: row.created_at as number,
    };
  }

  // ===========================================================================
  // Cluster Operations
  // ===========================================================================

  insertCluster(cluster: Omit<Cluster, 'id' | 'createdAt'>): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO clusters (id, name, description, centroid_embedding_id, member_count, coherence_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cluster.name, cluster.description, cluster.centroidEmbeddingId, cluster.memberCount, cluster.coherenceScore, Date.now() / 1000);
    return id;
  }

  getCluster(id: string): Cluster | null {
    const row = this.db.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToCluster(row);
  }

  getAllClusters(): Cluster[] {
    const rows = this.db.prepare('SELECT * FROM clusters ORDER BY coherence_score DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToCluster(r));
  }

  updateClusterName(id: string, name: string, description?: string): void {
    this.db.prepare('UPDATE clusters SET name = ?, description = ? WHERE id = ?').run(name, description || null, id);
  }

  addClusterMember(clusterId: string, embeddingId: string, distanceToCentroid: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO cluster_members (cluster_id, embedding_id, distance_to_centroid)
      VALUES (?, ?, ?)
    `).run(clusterId, embeddingId, distanceToCentroid);
  }

  getClusterMembers(clusterId: string): ClusterMember[] {
    const rows = this.db.prepare('SELECT * FROM cluster_members WHERE cluster_id = ? ORDER BY distance_to_centroid').all(clusterId) as Record<string, unknown>[];
    return rows.map(row => ({
      clusterId: row.cluster_id as string,
      embeddingId: row.embedding_id as string,
      distanceToCentroid: row.distance_to_centroid as number,
    }));
  }

  clearClusters(): void {
    this.db.exec('DELETE FROM cluster_members; DELETE FROM clusters;');
  }

  private rowToCluster(row: Record<string, unknown>): Cluster {
    return {
      id: row.id as string,
      name: row.name as string | null,
      description: row.description as string | null,
      centroidEmbeddingId: row.centroid_embedding_id as string | null,
      memberCount: row.member_count as number,
      coherenceScore: row.coherence_score as number,
      createdAt: row.created_at as number,
    };
  }

  // ===========================================================================
  // Anchor Operations
  // ===========================================================================

  insertAnchor(anchor: Omit<Anchor, 'id' | 'createdAt'>): string {
    const id = uuidv4();
    const embeddingBlob = Buffer.from(new Float32Array(anchor.embedding).buffer);
    const sourceIdsJson = JSON.stringify(anchor.sourceEmbeddingIds);

    this.db.prepare(`
      INSERT INTO anchors (id, name, description, anchor_type, embedding, source_embedding_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, anchor.name, anchor.description, anchor.anchorType, embeddingBlob, sourceIdsJson, Date.now() / 1000);
    return id;
  }

  getAnchor(id: string): Anchor | null {
    const row = this.db.prepare('SELECT * FROM anchors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToAnchor(row);
  }

  getAllAnchors(): Anchor[] {
    const rows = this.db.prepare('SELECT * FROM anchors ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToAnchor(r));
  }

  getAnchorsByType(anchorType: AnchorType): Anchor[] {
    const rows = this.db.prepare('SELECT * FROM anchors WHERE anchor_type = ?').all(anchorType) as Record<string, unknown>[];
    return rows.map(r => this.rowToAnchor(r));
  }

  deleteAnchor(id: string): void {
    this.db.prepare('DELETE FROM anchors WHERE id = ?').run(id);
  }

  private rowToAnchor(row: Record<string, unknown>): Anchor {
    const embeddingBlob = row.embedding as Buffer;
    const embedding = Array.from(new Float32Array(embeddingBlob.buffer, embeddingBlob.byteOffset, embeddingBlob.byteLength / 4));
    const sourceIds = JSON.parse(row.source_embedding_ids as string) as string[];

    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      anchorType: row.anchor_type as AnchorType,
      embedding,
      sourceEmbeddingIds: sourceIds,
      createdAt: row.created_at as number,
    };
  }
}
