/**
 * VectorOperations - Embedding storage and vector search operations
 *
 * Extracted from EmbeddingDatabase for maintainability.
 * Handles all sqlite-vec operations.
 */

import { DatabaseOperations } from './DatabaseOperations.js';
import type { SearchResult, AnchorType, FilterSpec, FilterValue } from './types.js';

export class VectorOperations extends DatabaseOperations {
  // ===========================================================================
  // Embedding Insert Operations
  // ===========================================================================

  insertSummaryEmbedding(id: string, conversationId: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_summaries (id, conversation_id, embedding)
      VALUES (?, ?, ?)
    `).run(id, conversationId, this.embeddingToJson(embedding));
  }

  insertMessageEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    role: string,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_messages (id, conversation_id, message_id, role, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, role, this.embeddingToJson(embedding));
  }

  insertMessageEmbeddingsBatch(
    items: Array<{
      id: string;
      conversationId: string;
      messageId: string;
      role: string;
      embedding: number[];
    }>
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const insert = this.db.prepare(`
      INSERT INTO vec_messages (id, conversation_id, message_id, role, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Array<{
      id: string;
      conversationId: string;
      messageId: string;
      role: string;
      embedding: number[];
    }>) => {
      for (const item of items) {
        insert.run(
          item.id,
          item.conversationId,
          item.messageId,
          item.role,
          this.embeddingToJson(item.embedding)
        );
      }
    });

    insertMany(items);
  }

  insertParagraphEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    chunkIndex: number,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_paragraphs (id, conversation_id, message_id, chunk_index, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, chunkIndex, this.embeddingToJson(embedding));
  }

  insertSentenceEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    chunkIndex: number,
    sentenceIndex: number,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_sentences (id, conversation_id, message_id, chunk_index, sentence_index, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, chunkIndex, sentenceIndex, this.embeddingToJson(embedding));
  }

  insertAnchorEmbedding(id: string, anchorType: AnchorType, name: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_anchors (id, anchor_type, name, embedding)
      VALUES (?, ?, ?, ?)
    `).run(id, anchorType, name, this.embeddingToJson(embedding));
  }

  insertClusterEmbedding(id: string, clusterId: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_clusters (id, cluster_id, embedding)
      VALUES (?, ?, ?)
    `).run(id, clusterId, this.embeddingToJson(embedding));
  }

  insertContentBlockEmbedding(
    id: string,
    blockId: string,
    blockType: string,
    gizmoId: string | undefined,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_content_blocks (id, block_id, block_type, gizmo_id, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, blockId, blockType, gizmoId || '', this.embeddingToJson(embedding));  // vec0 doesn't accept NULL for TEXT
  }

  searchContentBlocks(
    queryEmbedding: number[],
    limit: number = 20,
    blockType?: string,
    gizmoId?: string
  ): Array<{
    id: string;
    blockId: string;
    blockType: string;
    content: string;
    language?: string;
    conversationTitle?: string;
    similarity: number;
  }> {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    let sql: string;
    let params: unknown[];

    if (blockType && gizmoId) {
      sql = `
        SELECT
          v.id,
          v.block_id,
          v.block_type,
          v.distance,
          cb.content,
          cb.language,
          cb.conversation_title
        FROM vec_content_blocks v
        JOIN content_blocks cb ON cb.id = v.block_id
        WHERE v.embedding MATCH ? AND k = ?
          AND v.block_type = ?
          AND v.gizmo_id = ?
        ORDER BY v.distance
      `;
      params = [this.embeddingToJson(queryEmbedding), limit, blockType, gizmoId];
    } else if (blockType) {
      sql = `
        SELECT
          v.id,
          v.block_id,
          v.block_type,
          v.distance,
          cb.content,
          cb.language,
          cb.conversation_title
        FROM vec_content_blocks v
        JOIN content_blocks cb ON cb.id = v.block_id
        WHERE v.embedding MATCH ? AND k = ?
          AND v.block_type = ?
        ORDER BY v.distance
      `;
      params = [this.embeddingToJson(queryEmbedding), limit, blockType];
    } else if (gizmoId) {
      sql = `
        SELECT
          v.id,
          v.block_id,
          v.block_type,
          v.distance,
          cb.content,
          cb.language,
          cb.conversation_title
        FROM vec_content_blocks v
        JOIN content_blocks cb ON cb.id = v.block_id
        WHERE v.embedding MATCH ? AND k = ?
          AND v.gizmo_id = ?
        ORDER BY v.distance
      `;
      params = [this.embeddingToJson(queryEmbedding), limit, gizmoId];
    } else {
      sql = `
        SELECT
          v.id,
          v.block_id,
          v.block_type,
          v.distance,
          cb.content,
          cb.language,
          cb.conversation_title
        FROM vec_content_blocks v
        JOIN content_blocks cb ON cb.id = v.block_id
        WHERE v.embedding MATCH ? AND k = ?
        ORDER BY v.distance
      `;
      params = [this.embeddingToJson(queryEmbedding), limit];
    }

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      blockId: row.block_id as string,
      blockType: row.block_type as string,
      content: row.content as string,
      language: row.language as string | undefined,
      conversationTitle: row.conversation_title as string | undefined,
      similarity: 1 - (row.distance as number),
    }));
  }

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  searchMessages(queryEmbedding: number[], limit: number = 20, role?: string): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    let sql: string;
    let params: unknown[];

    if (role) {
      sql = `
        SELECT * FROM (
          SELECT
            vec_messages.id,
            vec_messages.conversation_id,
            vec_messages.message_id,
            vec_messages.role,
            vec_messages.distance,
            messages.content,
            conversations.title as conversation_title,
            conversations.folder as conversation_folder
          FROM vec_messages
          JOIN messages ON messages.id = vec_messages.message_id
          JOIN conversations ON conversations.id = vec_messages.conversation_id
          WHERE embedding MATCH ? AND k = ?
          ORDER BY distance
        )
        WHERE role = ?
          AND LENGTH(content) > 200
          AND content NOT LIKE 'search("%'
          AND content NOT LIKE '{"query":%'
          AND content NOT LIKE '{"type":%'
        LIMIT ?
      `;
      params = [this.embeddingToJson(queryEmbedding), limit * 10, role, limit];
    } else {
      sql = `
        SELECT
          vec_messages.id,
          vec_messages.conversation_id,
          vec_messages.message_id,
          vec_messages.role,
          vec_messages.distance,
          messages.content,
          conversations.title as conversation_title,
          conversations.folder as conversation_folder
        FROM vec_messages
        JOIN messages ON messages.id = vec_messages.message_id
        JOIN conversations ON conversations.id = vec_messages.conversation_id
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      `;
      params = [this.embeddingToJson(queryEmbedding), limit];
    }

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        role: row.role,
      },
      conversationId: row.conversation_id as string,
      conversationFolder: row.conversation_folder as string,
      conversationTitle: row.conversation_title as string,
      messageRole: row.role as string,
    }));
  }

  /**
   * Search messages with dynamic filter specs from adaptive filters.
   * Filters can apply to conversations, messages, or content_blocks tables.
   */
  searchMessagesFiltered(
    queryEmbedding: number[],
    filters: FilterSpec[],
    limit: number = 20
  ): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    // Build dynamic WHERE clauses based on filters
    const whereClauses: string[] = [];
    const params: unknown[] = [this.embeddingToJson(queryEmbedding), limit * 3]; // Over-fetch to filter later

    // Map filters to SQL conditions
    for (const filter of filters) {
      const clause = this.buildFilterClause(filter);
      if (clause) {
        whereClauses.push(clause.sql);
        params.push(...clause.params);
      }
    }

    // Build the SQL query with optional filter clauses
    const filterSql = whereClauses.length > 0
      ? `AND ${whereClauses.join(' AND ')}`
      : '';

    const sql = `
      SELECT * FROM (
        SELECT
          vec_messages.id,
          vec_messages.conversation_id,
          vec_messages.message_id,
          vec_messages.role,
          vec_messages.distance,
          messages.content,
          messages.created_at as message_created_at,
          conversations.title as conversation_title,
          conversations.folder as conversation_folder,
          conversations.created_at as conversation_created_at,
          conversations.message_count as conversation_message_count
        FROM vec_messages
        JOIN messages ON messages.id = vec_messages.message_id
        JOIN conversations ON conversations.id = vec_messages.conversation_id
        WHERE embedding MATCH ? AND k = ?
        ORDER BY distance
      )
      WHERE LENGTH(content) > 50
        AND content NOT LIKE 'search("%'
        AND content NOT LIKE '{"query":%'
        ${filterSql}
      LIMIT ?
    `;

    params.push(limit);

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        role: row.role,
        createdAt: row.message_created_at,
      },
      conversationId: row.conversation_id as string,
      conversationFolder: row.conversation_folder as string,
      conversationTitle: row.conversation_title as string,
      messageRole: row.role as string,
    }));
  }

  /**
   * Build a SQL WHERE clause from a FilterSpec.
   * Returns null if the filter can't be applied to the current query context.
   */
  private buildFilterClause(filter: FilterSpec): { sql: string; params: unknown[] } | null {
    const { field, source, value } = filter;

    // Map field names to their actual table.column references
    const fieldMap: Record<string, Record<string, string>> = {
      conversations: {
        created_at: 'conversation_created_at',
        message_count: 'conversation_message_count',
        folder: 'conversation_folder',
      },
      messages: {
        role: 'role',
        created_at: 'message_created_at',
      },
    };

    // Get the mapped column name or use the field directly
    const column = fieldMap[source]?.[field] || field;

    switch (value.type) {
      case 'enum':
        if (value.values.length === 0) return null;
        const placeholders = value.values.map(() => '?').join(', ');
        return {
          sql: `${column} IN (${placeholders})`,
          params: value.values,
        };

      case 'date_range': {
        const parts: string[] = [];
        const params: unknown[] = [];
        if (value.min !== undefined) {
          parts.push(`${column} >= ?`);
          params.push(value.min);
        }
        if (value.max !== undefined) {
          parts.push(`${column} <= ?`);
          params.push(value.max);
        }
        if (parts.length === 0) return null;
        return { sql: `(${parts.join(' AND ')})`, params };
      }

      case 'numeric_range': {
        const parts: string[] = [];
        const params: unknown[] = [];
        if (value.min !== undefined) {
          parts.push(`${column} >= ?`);
          params.push(value.min);
        }
        if (value.max !== undefined) {
          parts.push(`${column} <= ?`);
          params.push(value.max);
        }
        if (parts.length === 0) return null;
        return { sql: `(${parts.join(' AND ')})`, params };
      }

      case 'boolean':
        return {
          sql: `${column} = ?`,
          params: [value.value ? 1 : 0],
        };

      default:
        return null;
    }
  }

  searchSummaries(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const results = this.db.prepare(`
      SELECT
        vec_summaries.id,
        vec_summaries.conversation_id,
        vec_summaries.distance,
        conversations.title,
        conversations.summary as content
      FROM vec_summaries
      JOIN conversations ON conversations.id = vec_summaries.conversation_id
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(this.embeddingToJson(queryEmbedding), limit) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string || row.title as string,
      similarity: 1 - (row.distance as number),
      metadata: { title: row.title },
      conversationId: row.conversation_id as string,
      conversationTitle: row.title as string,
    }));
  }

  searchParagraphs(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const results = this.db.prepare(`
      SELECT
        vec_paragraphs.id,
        vec_paragraphs.conversation_id,
        vec_paragraphs.message_id,
        vec_paragraphs.chunk_index,
        vec_paragraphs.distance,
        chunks.content,
        conversations.title as conversation_title
      FROM vec_paragraphs
      JOIN chunks ON chunks.id = vec_paragraphs.id
      JOIN conversations ON conversations.id = vec_paragraphs.conversation_id
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(this.embeddingToJson(queryEmbedding), limit) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        chunkIndex: row.chunk_index,
      },
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
    }));
  }

  searchPyramidChunks(
    queryEmbedding: number[],
    limit: number = 20,
    contentTypes?: string[]
  ): Array<{
    id: string;
    threadId: string;
    content: string;
    contentType: string;
    language?: string;
    similarity: number;
  }> {
    if (!this.vecLoaded) {
      console.warn('[VectorOperations] Vector search not available');
      return [];
    }

    let sql = `
      SELECT
        v.id,
        v.thread_id,
        p.content,
        p.content_type,
        p.language,
        1 - vec_distance_cosine(v.embedding, ?) as similarity
      FROM vec_pyramid_chunks v
      JOIN pyramid_chunks p ON v.id = p.id
    `;

    const params: unknown[] = [new Float32Array(queryEmbedding)];

    if (contentTypes && contentTypes.length > 0) {
      const placeholders = contentTypes.map(() => '?').join(', ');
      sql += ` WHERE p.content_type IN (${placeholders})`;
      params.push(...contentTypes);
    }

    sql += ` ORDER BY similarity DESC LIMIT ?`;
    params.push(limit);

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      return rows.map(row => ({
        id: row.id as string,
        threadId: row.thread_id as string,
        content: row.content as string,
        contentType: row.content_type as string,
        language: row.language as string | undefined,
        similarity: row.similarity as number,
      }));
    } catch (err) {
      console.error('[VectorOperations] Pyramid chunk search error:', err);
      return [];
    }
  }

  findSimilarToMessage(embeddingId: string, limit: number = 20, excludeSameConversation: boolean = false): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const source = this.db.prepare(`
      SELECT embedding, conversation_id FROM vec_messages WHERE id = ?
    `).get(embeddingId) as { embedding: string; conversation_id: string } | undefined;

    if (!source) return [];

    let query = `
      SELECT
        vec_messages.id,
        vec_messages.conversation_id,
        vec_messages.message_id,
        vec_messages.role,
        vec_messages.distance,
        messages.content,
        conversations.title as conversation_title
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      JOIN conversations ON conversations.id = vec_messages.conversation_id
      WHERE embedding MATCH ? AND k = ?
        AND vec_messages.id != ?
    `;

    if (excludeSameConversation) {
      query += ` AND vec_messages.conversation_id != ?`;
    }

    query += ` ORDER BY distance`;

    const params = excludeSameConversation
      ? [source.embedding, limit + 1, embeddingId, source.conversation_id]
      : [source.embedding, limit + 1, embeddingId];

    const results = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        role: row.role,
      },
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
      messageRole: row.role as string,
    })).slice(0, limit);
  }

  // ===========================================================================
  // Embedding Retrieval
  // ===========================================================================

  getEmbedding(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences' | 'anchors' | 'clusters', id: string): number[] | null {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const tableName = `vec_${table}`;
    const row = this.db.prepare(`SELECT embedding FROM ${tableName} WHERE id = ?`).get(id) as { embedding: Buffer | string } | undefined;
    if (!row) return null;

    return this.embeddingFromBinary(row.embedding);
  }

  getEmbeddings(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences', ids: string[]): Map<string, number[]> {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const tableName = `vec_${table}`;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id, embedding FROM ${tableName} WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; embedding: Buffer | string }>;

    const result = new Map<string, number[]>();
    for (const row of rows) {
      result.set(row.id, this.embeddingFromBinary(row.embedding));
    }
    return result;
  }

  getMessagesByEmbeddingIds(
    embeddingIds: string[],
    options: {
      roles?: ('user' | 'assistant' | 'system' | 'tool')[];
      excludeImagePrompts?: boolean;
      excludeShortMessages?: number;
      limit?: number;
      offset?: number;
      groupByConversation?: boolean;
    } = {}
  ): {
    messages: Array<{
      embeddingId: string;
      messageId: string;
      conversationId: string;
      conversationTitle: string;
      role: string;
      content: string;
      createdAt: number;
    }>;
    total: number;
    byConversation?: Map<string, Array<{
      embeddingId: string;
      messageId: string;
      role: string;
      content: string;
      createdAt: number;
    }>>;
  } {
    if (embeddingIds.length === 0) {
      return { messages: [], total: 0 };
    }

    const placeholders = embeddingIds.map(() => '?').join(',');
    let whereClause = `vec_messages.id IN (${placeholders})`;
    const params: (string | number)[] = [...embeddingIds];

    if (options.roles && options.roles.length > 0) {
      const rolePlaceholders = options.roles.map(() => '?').join(',');
      whereClause += ` AND vec_messages.role IN (${rolePlaceholders})`;
      params.push(...options.roles);
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      WHERE ${whereClause}
    `;
    const countResult = this.db.prepare(countQuery).get(...params) as { total: number };
    let total = countResult.total;

    let query = `
      SELECT
        vec_messages.id as embedding_id,
        vec_messages.message_id,
        vec_messages.conversation_id,
        vec_messages.role,
        messages.content,
        messages.created_at,
        conversations.title as conversation_title
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      JOIN conversations ON conversations.id = vec_messages.conversation_id
      WHERE ${whereClause}
      ORDER BY messages.created_at DESC
    `;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }
    if (options.offset) {
      query += ` OFFSET ?`;
      params.push(options.offset);
    }

    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    let messages = rows.map(row => ({
      embeddingId: row.embedding_id as string,
      messageId: row.message_id as string,
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
      role: row.role as string,
      content: row.content as string,
      createdAt: row.created_at as number,
    }));

    if (options.excludeImagePrompts) {
      const imagePromptPatterns = [
        /^(create|generate|draw|make|design|paint|illustrate)\s+(an?\s+)?(image|picture|photo|illustration|art|artwork|drawing)/i,
        /^(show me|can you (create|draw|make))/i,
        /\bDALL[-·]?E\b/i,
        /^(a |an )?[\w\s,]+\b(in the style of|digital art|oil painting|watercolor|photograph|3d render)/i,
      ];

      const beforeFilter = messages.length;
      messages = messages.filter(m => {
        const content = m.content.trim();
        return !imagePromptPatterns.some(pattern => pattern.test(content));
      });
      total -= (beforeFilter - messages.length);
    }

    if (options.excludeShortMessages && options.excludeShortMessages > 0) {
      const beforeFilter = messages.length;
      messages = messages.filter(m => m.content.length >= options.excludeShortMessages!);
      total -= (beforeFilter - messages.length);
    }

    if (options.groupByConversation) {
      const byConversation = new Map<string, Array<{
        embeddingId: string;
        messageId: string;
        role: string;
        content: string;
        createdAt: number;
      }>>();

      for (const msg of messages) {
        const key = msg.conversationId;
        if (!byConversation.has(key)) {
          byConversation.set(key, []);
        }
        byConversation.get(key)!.push({
          embeddingId: msg.embeddingId,
          messageId: msg.messageId,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        });
      }

      return { messages, total, byConversation };
    }

    return { messages, total };
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  getVectorStats(): {
    summaryCount: number;
    messageCount: number;
    paragraphCount: number;
    sentenceCount: number;
    anchorCount: number;
    clusterCount: number;
  } {
    if (!this.vecLoaded) {
      return { summaryCount: 0, messageCount: 0, paragraphCount: 0, sentenceCount: 0, anchorCount: 0, clusterCount: 0 };
    }

    const summaryCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_summaries').get() as { count: number };
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_messages').get() as { count: number };
    const paragraphCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_paragraphs').get() as { count: number };
    const sentenceCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_sentences').get() as { count: number };
    const anchorCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_anchors').get() as { count: number };
    const clusterCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_clusters').get() as { count: number };

    return {
      summaryCount: summaryCount.count,
      messageCount: messageCount.count,
      paragraphCount: paragraphCount.count,
      sentenceCount: sentenceCount.count,
      anchorCount: anchorCount.count,
      clusterCount: clusterCount.count,
    };
  }

  hasVectorSupport(): boolean {
    return this.vecLoaded;
  }

  getStats(): {
    conversationCount: number;
    messageCount: number;
    chunkCount: number;
    interestingCount: number;
    clusterCount: number;
    anchorCount: number;
  } {
    const convCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
    const msgCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const interestingCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations WHERE is_interesting = 1').get() as { count: number };
    const clusterCount = this.db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
    const anchorCount = this.db.prepare('SELECT COUNT(*) as count FROM anchors').get() as { count: number };

    return {
      conversationCount: convCount.count,
      messageCount: msgCount.count,
      chunkCount: chunkCount.count,
      interestingCount: interestingCount.count,
      clusterCount: clusterCount.count,
      anchorCount: anchorCount.count,
    };
  }
}
