/**
 * ContentOperations - Content items, reactions, and import tracking
 *
 * Extracted from EmbeddingDatabase for maintainability.
 */

import { DatabaseOperations } from './DatabaseOperations.js';

export class ContentOperations extends DatabaseOperations {
  // ===========================================================================
  // Content Items (Facebook posts, comments, etc.)
  // ===========================================================================

  insertContentItem(item: {
    id: string;
    type: string;
    source: string;
    text?: string;
    title?: string;
    created_at: number;
    updated_at?: number;
    author_name?: string;
    author_id?: string;
    is_own_content: boolean;
    parent_id?: string;
    thread_id?: string;
    context?: string;
    file_path?: string;
    media_refs?: string;
    media_count?: number;
    metadata?: string;
    tags?: string;
    search_text?: string;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO content_items (
        id, type, source, text, title, created_at, updated_at,
        author_name, author_id, is_own_content, parent_id, thread_id,
        context, file_path, media_refs, media_count, metadata, tags, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.type,
      item.source,
      item.text,
      item.title,
      item.created_at,
      item.updated_at,
      item.author_name,
      item.author_id,
      item.is_own_content ? 1 : 0,
      item.parent_id,
      item.thread_id,
      item.context,
      item.file_path,
      item.media_refs,
      item.media_count,
      item.metadata,
      item.tags,
      item.search_text
    );
  }

  insertContentItemsBatch(items: Array<{
    id: string;
    type: string;
    source: string;
    text?: string;
    title?: string;
    created_at: number;
    updated_at?: number;
    author_name?: string;
    author_id?: string;
    is_own_content: boolean;
    parent_id?: string;
    thread_id?: string;
    context?: string;
    file_path?: string;
    media_refs?: string;
    media_count?: number;
    metadata?: string;
    tags?: string;
    search_text?: string;
  }>): void {
    const insertMany = this.db.transaction((items: typeof items) => {
      for (const item of items) {
        this.insertContentItem(item);
      }
    });

    insertMany(items);
  }

  getContentItem(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
    return row as Record<string, unknown> || null;
  }

  getContentItemsBySource(source: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM content_items WHERE source = ? ORDER BY created_at DESC').all(source) as Record<string, unknown>[];
  }

  getContentItemsByType(type: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM content_items WHERE type = ? ORDER BY created_at DESC').all(type) as Record<string, unknown>[];
  }

  insertContentItemEmbedding(
    id: string,
    contentItemId: string,
    type: string,
    source: string,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT OR REPLACE INTO vec_content_items (id, content_item_id, type, source, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, contentItemId, type, source, this.embeddingToJson(embedding));
  }

  searchContentItems(
    queryEmbedding: number[],
    limit: number = 20,
    type?: string,
    source?: string
  ): Array<{ id: string; content_item_id: string; type: string; source: string; distance: number }> {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    let sql = `
      SELECT id, content_item_id, type, source, distance
      FROM vec_content_items
      WHERE embedding MATCH ?
    `;

    const params: unknown[] = [this.embeddingToJson(queryEmbedding)];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    if (source) {
      sql += ` AND source = ?`;
      params.push(source);
    }

    sql += ` ORDER BY distance LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Array<{ id: string; content_item_id: string; type: string; source: string; distance: number }>;
  }

  // ===========================================================================
  // Reactions
  // ===========================================================================

  insertReaction(reaction: {
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO reactions (
        id, content_item_id, reaction_type, reactor_name, reactor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      reaction.id,
      reaction.content_item_id,
      reaction.reaction_type,
      reaction.reactor_name,
      reaction.reactor_id,
      reaction.created_at
    );
  }

  insertReactionsBatch(reactions: Array<{
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }>): void {
    const insertMany = this.db.transaction((reactions: typeof reactions) => {
      for (const reaction of reactions) {
        this.insertReaction(reaction);
      }
    });

    insertMany(reactions);
  }

  getReactionsForContentItem(contentItemId: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM reactions WHERE content_item_id = ? ORDER BY created_at DESC').all(contentItemId) as Record<string, unknown>[];
  }

  // ===========================================================================
  // Import Tracking
  // ===========================================================================

  createImport(params: {
    id: string;
    source: string;
    sourcePath?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO imports (id, source, source_path, status, created_at, metadata)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(
      params.id,
      params.source,
      params.sourcePath || null,
      Date.now(),
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  }

  startImport(id: string): void {
    this.db.prepare(`
      UPDATE imports SET status = 'processing', started_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  completeImport(id: string, stats: {
    threadCount: number;
    messageCount: number;
    mediaCount: number;
    totalWords: number;
  }): void {
    this.db.prepare(`
      UPDATE imports SET
        status = 'completed',
        completed_at = ?,
        thread_count = ?,
        message_count = ?,
        media_count = ?,
        total_words = ?
      WHERE id = ?
    `).run(
      Date.now(),
      stats.threadCount,
      stats.messageCount,
      stats.mediaCount,
      stats.totalWords,
      id
    );
  }

  failImport(id: string, errorMessage: string): void {
    this.db.prepare(`
      UPDATE imports SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?
    `).run(Date.now(), errorMessage, id);
  }

  getImport(id: string): Record<string, unknown> | null {
    return this.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as Record<string, unknown> | null;
  }

  getImportsByStatus(status: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM imports WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
  }

  getAllImports(): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all() as Record<string, unknown>[];
  }

  deleteImport(id: string): boolean {
    const result = this.db.prepare('DELETE FROM imports WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
