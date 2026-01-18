/**
 * ContentGraphDatabase - Core database operations for the Universal Content Graph
 *
 * Provides CRUD operations for ContentNodes, ContentLinks, and related entities.
 * All content in the system flows through this service.
 */

import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import {
  ContentGraphSchema,
  type ContentNodeRow,
  type ContentLinkRow,
  type ContentBlobRow,
  type ContentVersionRow,
  type ImportBatchRow,
} from './schema.js';
import type {
  ContentNode,
  ContentLink,
  ContentBlob,
  ContentAnchor,
  LinkAnchor,
  ContentFormat,
  UCGSourceType as SourceType,
  LinkType,
  CreateContentNodeOptions,
  CreateContentLinkOptions,
  ContentNodeQuery,
  ContentLinkQuery,
  ContentVersion,
  ContentLineage,
} from '@humanizer/core';

/**
 * Generate a SHA-256 hash of content
 */
function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * ContentGraphDatabase - Main database service for UCG
 */
export class ContentGraphDatabase {
  private db: Database.Database;
  private schema: ContentGraphSchema;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
    this.schema = new ContentGraphSchema(db, vecLoaded);
  }

  /**
   * Initialize the database schema
   */
  initialize(): void {
    if (!this.schema.tablesExist()) {
      this.schema.initialize();
    } else {
      this.schema.migrate();
    }
  }

  // ===========================================================================
  // CONTENT NODE OPERATIONS
  // ===========================================================================

  /**
   * Create a new content node
   */
  createNode(options: CreateContentNodeOptions): ContentNode {
    const id = randomUUID();
    const now = Date.now();
    const contentHash = hashContent(options.text);
    const wordCount = countWords(options.text);

    const uri = `content://${options.sourceType}/${options.originalId || id}`;

    const node: ContentNode = {
      id,
      contentHash,
      uri,
      content: {
        text: options.text,
        format: options.format || 'text',
        rendered: options.rendered,
      },
      metadata: {
        title: options.title,
        author: options.author,
        createdAt: options.createdAt || now,
        importedAt: now,
        wordCount,
        tags: options.tags || [],
        sourceMetadata: options.sourceMetadata || {},
      },
      source: {
        type: options.sourceType,
        adapter: options.adapter || options.sourceType,
        originalId: options.originalId,
        originalPath: options.originalPath,
        importBatch: options.importBatch,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };

    this.insertNode(node);
    return node;
  }

  /**
   * Insert a ContentNode into the database
   */
  insertNode(node: ContentNode): void {
    const stmt = this.db.prepare(`
      INSERT INTO content_nodes (
        id, content_hash, uri, text, format, rendered, binary_hash,
        title, author, word_count, language, tags, source_metadata,
        source_type, source_adapter, source_original_id, source_original_path, import_batch,
        version_number, parent_id, root_id, operation, operator_id,
        anchors, created_at, imported_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      node.id,
      node.contentHash,
      node.uri,
      node.content.text,
      node.content.format,
      node.content.rendered || null,
      node.content.binary?.hash || null,
      node.metadata.title || null,
      node.metadata.author || null,
      node.metadata.wordCount,
      node.metadata.language || null,
      JSON.stringify(node.metadata.tags),
      JSON.stringify(node.metadata.sourceMetadata),
      node.source.type,
      node.source.adapter,
      node.source.originalId || null,
      node.source.originalPath || null,
      node.source.importBatch || null,
      node.version.number,
      node.version.parentId || null,
      node.version.rootId,
      node.version.operation || null,
      node.version.operatorId || null,
      node.anchors ? JSON.stringify(node.anchors) : null,
      node.metadata.createdAt,
      node.metadata.importedAt
    );
  }

  /**
   * Get a content node by ID
   */
  getNode(id: string): ContentNode | null {
    const row = this.db.prepare(
      'SELECT * FROM content_nodes WHERE id = ?'
    ).get(id) as ContentNodeRow | undefined;

    if (!row) return null;
    return this.rowToNode(row);
  }

  /**
   * Get a content node by URI
   */
  getNodeByUri(uri: string): ContentNode | null {
    const row = this.db.prepare(
      'SELECT * FROM content_nodes WHERE uri = ?'
    ).get(uri) as ContentNodeRow | undefined;

    if (!row) return null;
    return this.rowToNode(row);
  }

  /**
   * Get a content node by content hash (for deduplication)
   */
  getNodeByHash(contentHash: string): ContentNode | null {
    const row = this.db.prepare(
      'SELECT * FROM content_nodes WHERE content_hash = ? ORDER BY version_number DESC LIMIT 1'
    ).get(contentHash) as ContentNodeRow | undefined;

    if (!row) return null;
    return this.rowToNode(row);
  }

  /**
   * Get multiple nodes by IDs
   */
  getNodes(ids: string[]): ContentNode[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM content_nodes WHERE id IN (${placeholders})`
    ).all(...ids) as ContentNodeRow[];

    return rows.map(row => this.rowToNode(row));
  }

  /**
   * Query content nodes with filters
   */
  queryNodes(query: ContentNodeQuery): ContentNode[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Source type filter
    if (query.sourceType) {
      if (Array.isArray(query.sourceType)) {
        const placeholders = query.sourceType.map(() => '?').join(',');
        conditions.push(`source_type IN (${placeholders})`);
        params.push(...query.sourceType);
      } else {
        conditions.push('source_type = ?');
        params.push(query.sourceType);
      }
    }

    // Tags filter (AND)
    if (query.tags && query.tags.length > 0) {
      for (const tag of query.tags) {
        conditions.push(`tags LIKE ?`);
        params.push(`%"${tag}"%`);
      }
    }

    // Date range filter
    if (query.dateRange) {
      if (query.dateRange.start) {
        conditions.push('created_at >= ?');
        params.push(query.dateRange.start);
      }
      if (query.dateRange.end) {
        conditions.push('created_at <= ?');
        params.push(query.dateRange.end);
      }
    }

    // Build query
    let sql = 'SELECT * FROM content_nodes';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Order
    const orderField = query.orderBy || 'created_at';
    const orderDir = query.orderDirection || 'desc';
    sql += ` ORDER BY ${orderField} ${orderDir}`;

    // Limit/offset
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as ContentNodeRow[];
    return rows.map(row => this.rowToNode(row));
  }

  /**
   * Full-text search for content nodes
   */
  searchNodes(query: string, limit: number = 50): ContentNode[] {
    const rows = this.db.prepare(`
      SELECT cn.* FROM content_nodes cn
      JOIN content_nodes_fts fts ON cn.rowid = fts.rowid
      WHERE content_nodes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as ContentNodeRow[];

    return rows.map(row => this.rowToNode(row));
  }

  /**
   * Update a content node (creates a new version)
   */
  updateNode(
    id: string,
    updates: Partial<Pick<ContentNode, 'content' | 'metadata'>>,
    operation: string = 'edit',
    operatorId?: string
  ): ContentNode | null {
    const existing = this.getNode(id);
    if (!existing) return null;

    const newId = randomUUID();
    const now = Date.now();

    // Merge content
    const newText = updates.content?.text ?? existing.content.text;
    const contentHash = hashContent(newText);
    const wordCount = countWords(newText);

    const newNode: ContentNode = {
      id: newId,
      contentHash,
      uri: existing.uri,
      content: {
        text: newText,
        format: updates.content?.format ?? existing.content.format,
        rendered: updates.content?.rendered ?? existing.content.rendered,
        binary: updates.content?.binary ?? existing.content.binary,
      },
      metadata: {
        title: updates.metadata?.title ?? existing.metadata.title,
        author: updates.metadata?.author ?? existing.metadata.author,
        createdAt: existing.metadata.createdAt,
        importedAt: now,
        wordCount,
        language: updates.metadata?.language ?? existing.metadata.language,
        tags: updates.metadata?.tags ?? existing.metadata.tags,
        sourceMetadata: updates.metadata?.sourceMetadata ?? existing.metadata.sourceMetadata,
      },
      source: existing.source,
      version: {
        number: existing.version.number + 1,
        parentId: existing.id,
        rootId: existing.version.rootId,
        operation,
        operatorId,
      },
      anchors: existing.anchors,
    };

    this.insertNode(newNode);

    // Create version record
    this.createVersion(newNode, operation, operatorId);

    return newNode;
  }

  /**
   * Delete a content node
   */
  deleteNode(id: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM content_nodes WHERE id = ?'
    ).run(id);
    return result.changes > 0;
  }

  /**
   * Get total count of nodes
   */
  getNodeCount(sourceType?: SourceType): number {
    if (sourceType) {
      const result = this.db.prepare(
        'SELECT COUNT(*) as count FROM content_nodes WHERE source_type = ?'
      ).get(sourceType) as { count: number };
      return result.count;
    }
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM content_nodes'
    ).get() as { count: number };
    return result.count;
  }

  // ===========================================================================
  // CONTENT LINK OPERATIONS
  // ===========================================================================

  /**
   * Create a new content link
   */
  createLink(options: CreateContentLinkOptions): ContentLink {
    const id = randomUUID();
    const now = Date.now();

    const link: ContentLink = {
      id,
      sourceId: options.sourceId,
      targetId: options.targetId,
      type: options.type,
      strength: options.strength,
      sourceAnchor: options.sourceAnchor,
      targetAnchor: options.targetAnchor,
      createdAt: now,
      createdBy: options.createdBy,
      metadata: options.metadata,
    };

    this.insertLink(link);
    return link;
  }

  /**
   * Insert a ContentLink into the database
   */
  insertLink(link: ContentLink): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO content_links (
        id, source_id, target_id, link_type, strength,
        source_anchor_start, source_anchor_end, source_anchor_text,
        target_anchor_start, target_anchor_end, target_anchor_text,
        created_at, created_by, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      link.id,
      link.sourceId,
      link.targetId,
      link.type,
      link.strength ?? null,
      link.sourceAnchor?.start ?? null,
      link.sourceAnchor?.end ?? null,
      link.sourceAnchor?.text ?? null,
      link.targetAnchor?.start ?? null,
      link.targetAnchor?.end ?? null,
      link.targetAnchor?.text ?? null,
      link.createdAt,
      link.createdBy ?? null,
      link.metadata ? JSON.stringify(link.metadata) : null
    );
  }

  /**
   * Get a link by ID
   */
  getLink(id: string): ContentLink | null {
    const row = this.db.prepare(
      'SELECT * FROM content_links WHERE id = ?'
    ).get(id) as ContentLinkRow | undefined;

    if (!row) return null;
    return this.rowToLink(row);
  }

  /**
   * Get links from a node (outgoing)
   */
  getLinksFrom(nodeId: string, type?: LinkType | LinkType[]): ContentLink[] {
    let sql = 'SELECT * FROM content_links WHERE source_id = ?';
    const params: unknown[] = [nodeId];

    if (type) {
      if (Array.isArray(type)) {
        const placeholders = type.map(() => '?').join(',');
        sql += ` AND link_type IN (${placeholders})`;
        params.push(...type);
      } else {
        sql += ' AND link_type = ?';
        params.push(type);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as ContentLinkRow[];
    return rows.map(row => this.rowToLink(row));
  }

  /**
   * Get links to a node (incoming/backlinks)
   */
  getLinksTo(nodeId: string, type?: LinkType | LinkType[]): ContentLink[] {
    let sql = 'SELECT * FROM content_links WHERE target_id = ?';
    const params: unknown[] = [nodeId];

    if (type) {
      if (Array.isArray(type)) {
        const placeholders = type.map(() => '?').join(',');
        sql += ` AND link_type IN (${placeholders})`;
        params.push(...type);
      } else {
        sql += ' AND link_type = ?';
        params.push(type);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as ContentLinkRow[];
    return rows.map(row => this.rowToLink(row));
  }

  /**
   * Query content links with filters
   */
  queryLinks(query: ContentLinkQuery): ContentLink[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.nodeId) {
      if (query.direction === 'outgoing') {
        conditions.push('source_id = ?');
        params.push(query.nodeId);
      } else if (query.direction === 'incoming') {
        conditions.push('target_id = ?');
        params.push(query.nodeId);
      } else {
        conditions.push('(source_id = ? OR target_id = ?)');
        params.push(query.nodeId, query.nodeId);
      }
    }

    if (query.type) {
      if (Array.isArray(query.type)) {
        const placeholders = query.type.map(() => '?').join(',');
        conditions.push(`link_type IN (${placeholders})`);
        params.push(...query.type);
      } else {
        conditions.push('link_type = ?');
        params.push(query.type);
      }
    }

    if (query.minStrength !== undefined) {
      conditions.push('strength >= ?');
      params.push(query.minStrength);
    }

    let sql = 'SELECT * FROM content_links';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as ContentLinkRow[];
    return rows.map(row => this.rowToLink(row));
  }

  /**
   * Delete a link
   */
  deleteLink(id: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM content_links WHERE id = ?'
    ).run(id);
    return result.changes > 0;
  }

  /**
   * Delete all links for a node
   */
  deleteLinksForNode(nodeId: string): number {
    const result = this.db.prepare(
      'DELETE FROM content_links WHERE source_id = ? OR target_id = ?'
    ).run(nodeId, nodeId);
    return result.changes;
  }

  // ===========================================================================
  // BLOB OPERATIONS
  // ===========================================================================

  /**
   * Store a binary blob
   */
  storeBlob(data: Uint8Array, mimeType: string): ContentBlob {
    const hash = createHash('sha256').update(data).digest('hex');
    const now = Date.now();

    // Check if blob already exists
    const existing = this.db.prepare(
      'SELECT hash FROM content_blobs WHERE hash = ?'
    ).get(hash) as { hash: string } | undefined;

    if (!existing) {
      this.db.prepare(`
        INSERT INTO content_blobs (hash, data, mime_type, size, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(hash, Buffer.from(data), mimeType, data.length, now);
    }

    return {
      hash,
      data,
      mimeType,
      size: data.length,
      createdAt: now,
    };
  }

  /**
   * Get a blob by hash
   */
  getBlob(hash: string): ContentBlob | null {
    const row = this.db.prepare(
      'SELECT * FROM content_blobs WHERE hash = ?'
    ).get(hash) as ContentBlobRow | undefined;

    if (!row) return null;
    return {
      hash: row.hash,
      data: new Uint8Array(row.data),
      mimeType: row.mime_type,
      size: row.size,
      createdAt: row.created_at,
    };
  }

  // ===========================================================================
  // VERSION OPERATIONS
  // ===========================================================================

  /**
   * Create a version record
   */
  private createVersion(
    node: ContentNode,
    operation: string,
    operatorId?: string,
    changeSummary?: string
  ): void {
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO content_versions (
        id, node_id, version_number, parent_version_id,
        operation, operator_id, change_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      node.id,
      node.version.number,
      node.version.parentId ?? null,
      operation,
      operatorId ?? null,
      changeSummary ?? null,
      Date.now()
    );
  }

  /**
   * Get version history for a node (by root ID)
   */
  getVersionHistory(rootId: string): ContentVersion[] {
    const rows = this.db.prepare(`
      SELECT * FROM content_versions cv
      JOIN content_nodes cn ON cv.node_id = cn.id
      WHERE cn.root_id = ?
      ORDER BY cv.version_number DESC
    `).all(rootId) as (ContentVersionRow & ContentNodeRow)[];

    return rows.map(row => ({
      id: row.id,
      number: row.version_number,
      parentId: row.parent_version_id ?? undefined,
      operation: row.operation ?? undefined,
      operatorId: row.operator_id ?? undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get all versions of a content node
   */
  getAllVersions(rootId: string): ContentNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM content_nodes WHERE root_id = ?
      ORDER BY version_number DESC
    `).all(rootId) as ContentNodeRow[];

    return rows.map(row => this.rowToNode(row));
  }

  // ===========================================================================
  // LINEAGE OPERATIONS
  // ===========================================================================

  /**
   * Get the full lineage of a content node
   * (all ancestors and descendants through derivation links)
   */
  getLineage(nodeId: string): ContentLineage | null {
    const node = this.getNode(nodeId);
    if (!node) return null;

    // Get ancestors (derived-from chain)
    const ancestors = this.getAncestors(nodeId);

    // Get descendants (what was derived from this)
    const descendants = this.getDescendants(nodeId);

    // Get version history
    const versions = this.getVersionHistory(node.version.rootId);

    return {
      node,
      ancestors,
      descendants,
      versions,
    };
  }

  /**
   * Get all ancestors (sources this was derived from)
   */
  private getAncestors(nodeId: string, visited: Set<string> = new Set()): ContentNode[] {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const links = this.getLinksFrom(nodeId, 'derived-from');
    const ancestors: ContentNode[] = [];

    for (const link of links) {
      const target = this.getNode(link.targetId);
      if (target) {
        ancestors.push(target);
        ancestors.push(...this.getAncestors(link.targetId, visited));
      }
    }

    return ancestors;
  }

  /**
   * Get all descendants (what was derived from this)
   */
  private getDescendants(nodeId: string, visited: Set<string> = new Set()): ContentNode[] {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const links = this.getLinksTo(nodeId, 'derived-from');
    const descendants: ContentNode[] = [];

    for (const link of links) {
      const source = this.getNode(link.sourceId);
      if (source) {
        descendants.push(source);
        descendants.push(...this.getDescendants(link.sourceId, visited));
      }
    }

    return descendants;
  }

  // ===========================================================================
  // IMPORT BATCH OPERATIONS
  // ===========================================================================

  /**
   * Create a new import batch
   */
  createImportBatch(sourceType: SourceType, sourcePath?: string, sourceName?: string): string {
    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO import_batches (id, source_type, source_path, source_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sourceType, sourcePath ?? null, sourceName ?? null, now);

    return id;
  }

  /**
   * Update import batch status
   */
  updateImportBatch(
    id: string,
    updates: {
      status?: string;
      nodeCount?: number;
      errorCount?: number;
      errorLog?: string[];
      startedAt?: number;
      completedAt?: number;
    }
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.nodeCount !== undefined) {
      sets.push('node_count = ?');
      params.push(updates.nodeCount);
    }
    if (updates.errorCount !== undefined) {
      sets.push('error_count = ?');
      params.push(updates.errorCount);
    }
    if (updates.errorLog !== undefined) {
      sets.push('error_log = ?');
      params.push(JSON.stringify(updates.errorLog));
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(updates.completedAt);
    }

    if (sets.length > 0) {
      params.push(id);
      this.db.prepare(`
        UPDATE import_batches SET ${sets.join(', ')} WHERE id = ?
      `).run(...params);
    }
  }

  /**
   * Get import batch by ID
   */
  getImportBatch(id: string): ImportBatchRow | null {
    return this.db.prepare(
      'SELECT * FROM import_batches WHERE id = ?'
    ).get(id) as ImportBatchRow | undefined ?? null;
  }

  // ===========================================================================
  // CONVERSION HELPERS
  // ===========================================================================

  /**
   * Convert a database row to a ContentNode
   */
  private rowToNode(row: ContentNodeRow): ContentNode {
    return {
      id: row.id,
      contentHash: row.content_hash,
      uri: row.uri,
      content: {
        text: row.text,
        format: row.format as ContentFormat,
        rendered: row.rendered ?? undefined,
        binary: row.binary_hash ? { hash: row.binary_hash, mimeType: '' } : undefined,
      },
      metadata: {
        title: row.title ?? undefined,
        author: row.author ?? undefined,
        createdAt: row.created_at,
        importedAt: row.imported_at,
        wordCount: row.word_count,
        language: row.language ?? undefined,
        tags: row.tags ? JSON.parse(row.tags) : [],
        sourceMetadata: row.source_metadata ? JSON.parse(row.source_metadata) : {},
      },
      source: {
        type: row.source_type as SourceType,
        adapter: row.source_adapter,
        originalId: row.source_original_id ?? undefined,
        originalPath: row.source_original_path ?? undefined,
        importBatch: row.import_batch ?? undefined,
      },
      version: {
        number: row.version_number,
        parentId: row.parent_id ?? undefined,
        rootId: row.root_id,
        operation: row.operation ?? undefined,
        operatorId: row.operator_id ?? undefined,
      },
      anchors: row.anchors ? JSON.parse(row.anchors) : undefined,
    };
  }

  /**
   * Convert a database row to a ContentLink
   */
  private rowToLink(row: ContentLinkRow): ContentLink {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.link_type as LinkType,
      strength: row.strength ?? undefined,
      sourceAnchor: row.source_anchor_start !== null ? {
        start: row.source_anchor_start,
        end: row.source_anchor_end!,
        text: row.source_anchor_text ?? undefined,
      } : undefined,
      targetAnchor: row.target_anchor_start !== null ? {
        start: row.target_anchor_start,
        end: row.target_anchor_end!,
        text: row.target_anchor_text ?? undefined,
      } : undefined,
      createdAt: row.created_at,
      createdBy: row.created_by ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  // ===========================================================================
  // EMBEDDING OPERATIONS
  // ===========================================================================

  /**
   * Store an embedding for a node
   */
  storeEmbedding(nodeId: string, embedding: number[], model: string = 'nomic-embed-text'): void {
    if (!this.vecLoaded) {
      throw new Error('Vector extension not loaded');
    }

    const textHash = this.getNodeTextHash(nodeId);

    // Update node metadata
    this.db.prepare(`
      UPDATE content_nodes
      SET embedding_model = ?,
          embedding_at = ?,
          embedding_text_hash = ?
      WHERE id = ?
    `).run(model, Date.now(), textHash, nodeId);

    // Store in vector table
    const existing = this.db.prepare(
      'SELECT id FROM content_nodes_vec WHERE id = ?'
    ).get(nodeId);

    if (existing) {
      this.db.prepare(`
        UPDATE content_nodes_vec
        SET embedding = ?, content_hash = ?
        WHERE id = ?
      `).run(JSON.stringify(embedding), textHash, nodeId);
    } else {
      this.db.prepare(`
        INSERT INTO content_nodes_vec (id, content_hash, embedding)
        VALUES (?, ?, ?)
      `).run(nodeId, textHash, JSON.stringify(embedding));
    }
  }

  /**
   * Get the embedding for a node
   */
  getEmbedding(nodeId: string): number[] | null {
    if (!this.vecLoaded) {
      return null;
    }

    const row = this.db.prepare(`
      SELECT embedding FROM content_nodes_vec WHERE id = ?
    `).get(nodeId) as { embedding: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.embedding);
  }

  /**
   * Check if a node has an embedding
   */
  hasEmbedding(nodeId: string): boolean {
    if (!this.vecLoaded) {
      return false;
    }

    const row = this.db.prepare(`
      SELECT id FROM content_nodes_vec WHERE id = ?
    `).get(nodeId);

    return !!row;
  }

  /**
   * Search nodes by embedding similarity
   * Returns nodes with their similarity scores
   */
  searchByEmbedding(
    embedding: number[],
    limit: number = 20,
    threshold: number = 0.5
  ): Array<{ node: ContentNode; similarity: number }> {
    if (!this.vecLoaded) {
      throw new Error('Vector extension not loaded');
    }

    // Use vec0 distance function for similarity search
    const rows = this.db.prepare(`
      SELECT
        cn.*,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM content_nodes_vec v
      JOIN content_nodes cn ON cn.id = v.id
      WHERE vec_distance_cosine(v.embedding, ?) < ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(
      JSON.stringify(embedding),
      JSON.stringify(embedding),
      1 - threshold,  // Convert threshold to distance
      limit
    ) as Array<ContentNodeRow & { distance: number }>;

    return rows.map(row => ({
      node: this.rowToNode(row),
      similarity: 1 - row.distance,  // Convert distance back to similarity
    }));
  }

  /**
   * Get nodes that need embeddings (have text but no embedding)
   */
  getNodesNeedingEmbeddings(limit: number = 100): ContentNode[] {
    const rows = this.db.prepare(`
      SELECT cn.*
      FROM content_nodes cn
      WHERE cn.embedding_at IS NULL
        AND cn.text IS NOT NULL
        AND cn.text != ''
        AND cn.parent_node_id IS NOT NULL
      LIMIT ?
    `).all(limit) as ContentNodeRow[];

    return rows.map(row => this.rowToNode(row));
  }

  /**
   * Get the text hash for a node
   */
  private getNodeTextHash(nodeId: string): string | null {
    const row = this.db.prepare(`
      SELECT content_hash FROM content_nodes WHERE id = ?
    `).get(nodeId) as { content_hash: string } | undefined;

    return row?.content_hash ?? null;
  }

  /**
   * Check if embedding is stale (text has changed)
   */
  isEmbeddingStale(nodeId: string): boolean {
    const row = this.db.prepare(`
      SELECT content_hash, embedding_text_hash
      FROM content_nodes
      WHERE id = ?
    `).get(nodeId) as { content_hash: string; embedding_text_hash: string | null } | undefined;

    if (!row || !row.embedding_text_hash) {
      return true;  // No embedding or no hash to compare
    }

    return row.content_hash !== row.embedding_text_hash;
  }

  // ===========================================================================
  // STATISTICS
  // ===========================================================================

  /**
   * Get database statistics
   */
  getStats(): {
    nodeCount: number;
    linkCount: number;
    blobCount: number;
    embeddingCount: number;
    nodesNeedingEmbeddings: number;
    sourceTypeCounts: Record<string, number>;
    linkTypeCounts: Record<string, number>;
  } {
    const nodeCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM content_nodes'
    ).get() as { count: number };

    const linkCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM content_links'
    ).get() as { count: number };

    const blobCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM content_blobs'
    ).get() as { count: number };

    // Embedding stats (only if vec loaded)
    let embeddingCount = 0;
    let nodesNeedingEmbeddings = 0;

    if (this.vecLoaded) {
      try {
        const embResult = this.db.prepare(
          'SELECT COUNT(*) as count FROM content_nodes WHERE embedding_at IS NOT NULL'
        ).get() as { count: number };
        embeddingCount = embResult.count;

        const needsEmbResult = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM content_nodes
          WHERE embedding_at IS NULL
            AND text IS NOT NULL
            AND text != ''
            AND parent_node_id IS NOT NULL
        `).get() as { count: number };
        nodesNeedingEmbeddings = needsEmbResult.count;
      } catch {
        // Tables may not exist yet
      }
    }

    const sourceRows = this.db.prepare(
      'SELECT source_type, COUNT(*) as count FROM content_nodes GROUP BY source_type'
    ).all() as { source_type: string; count: number }[];

    const linkRows = this.db.prepare(
      'SELECT link_type, COUNT(*) as count FROM content_links GROUP BY link_type'
    ).all() as { link_type: string; count: number }[];

    return {
      nodeCount: nodeCount.count,
      linkCount: linkCount.count,
      blobCount: blobCount.count,
      embeddingCount,
      nodesNeedingEmbeddings,
      sourceTypeCounts: Object.fromEntries(sourceRows.map(r => [r.source_type, r.count])),
      linkTypeCounts: Object.fromEntries(linkRows.map(r => [r.link_type, r.count])),
    };
  }
}
