/**
 * MultiResolutionRetrieval - Staged retrieval at document/section/chunk levels
 *
 * Implements two-stage retrieval:
 * 1. Coarse: Find relevant sections/documents
 * 2. Fine: Search within those for specific chunks
 *
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import type Database from 'better-sqlite3';
import type { ContentNode } from '@humanizer/core';
import {
  EmbeddingResolution,
  type StagedRetrievalOptions,
} from './types.js';

/**
 * Default staged retrieval options
 */
const DEFAULT_STAGED_OPTIONS: StagedRetrievalOptions = {
  coarseLimit: 20,
  fineLimit: 100,
  coarseResolution: EmbeddingResolution.SECTION,
  fineResolution: EmbeddingResolution.CHUNK,
};

/**
 * Result from multi-resolution retrieval
 */
export interface MultiResolutionResult {
  /** The content node */
  node: ContentNode;

  /** Distance from query (lower = more similar) */
  distance: number;

  /** Which resolution level this came from */
  resolution: EmbeddingResolution;

  /** Parent node ID (for chunks) */
  parentId?: string;
}

/**
 * MultiResolutionEmbedder - Handles embedding at multiple resolution levels
 */
export class MultiResolutionEmbedder {
  private db: Database.Database;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Embed a node and its ancestors at appropriate resolutions
   */
  async embedHierarchy(
    nodeId: string,
    embedding: Float32Array,
    resolution: EmbeddingResolution = EmbeddingResolution.CHUNK
  ): Promise<void> {
    // Store embedding
    this.storeEmbedding(nodeId, embedding);

    // Update resolution in main table
    this.db.prepare(`
      UPDATE content_nodes SET embedding_resolution = ? WHERE id = ?
    `).run(resolution, nodeId);

    // If this is a chunk, check if parent needs embedding
    if (resolution === EmbeddingResolution.CHUNK) {
      const node = this.getNodeBasic(nodeId);
      if (node?.parent_node_id) {
        // Check if parent has an embedding
        const parentHasEmbed = this.hasEmbedding(node.parent_node_id);
        if (!parentHasEmbed) {
          // Parent needs embedding - mark for later batch processing
          this.db.prepare(`
            UPDATE content_nodes
            SET embedding_resolution = NULL
            WHERE id = ? AND embedding_resolution IS NULL
          `).run(node.parent_node_id);
        }
      }
    }
  }

  /**
   * Get nodes that need section-level embeddings
   * (Parents of chunks that don't have embeddings yet)
   */
  getNodesNeedingSectionEmbedding(limit: number = 100): Array<{ id: string; text: string }> {
    const rows = this.db.prepare(`
      SELECT DISTINCT p.id, p.text
      FROM content_nodes p
      JOIN content_nodes c ON c.parent_node_id = p.id
      LEFT JOIN content_nodes_vec v ON p.id = v.id
      WHERE c.embedding_resolution = 2
        AND v.id IS NULL
        AND p.word_count <= 5000
      LIMIT ?
    `).all(limit) as Array<{ id: string; text: string }>;

    return rows;
  }

  /**
   * Store an embedding
   */
  private storeEmbedding(nodeId: string, embedding: Float32Array): void {
    if (!this.vecLoaded) return;

    const contentHash = this.getContentHash(nodeId);

    this.db.prepare(`
      INSERT INTO content_nodes_vec (id, content_hash, embedding)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content_hash = excluded.content_hash,
        embedding = excluded.embedding
    `).run(nodeId, contentHash, Buffer.from(embedding.buffer));
  }

  /**
   * Check if a node has an embedding
   */
  private hasEmbedding(nodeId: string): boolean {
    if (!this.vecLoaded) return false;

    const row = this.db.prepare(`
      SELECT 1 FROM content_nodes_vec WHERE id = ?
    `).get(nodeId);

    return !!row;
  }

  /**
   * Get content hash for a node
   */
  private getContentHash(nodeId: string): string {
    const row = this.db.prepare(`
      SELECT content_hash FROM content_nodes WHERE id = ?
    `).get(nodeId) as { content_hash: string } | undefined;

    return row?.content_hash || '';
  }

  /**
   * Get basic node info
   */
  private getNodeBasic(nodeId: string): { id: string; parent_node_id: string | null } | null {
    return this.db.prepare(`
      SELECT id, parent_node_id FROM content_nodes WHERE id = ?
    `).get(nodeId) as { id: string; parent_node_id: string | null } | null;
  }
}

/**
 * StagedRetriever - Two-stage coarse-to-fine retrieval
 */
export class StagedRetriever {
  private db: Database.Database;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Two-stage retrieval: coarse (sections/documents) → fine (chunks)
   */
  async stagedSearch(
    queryEmbedding: Float32Array,
    options?: Partial<StagedRetrievalOptions>
  ): Promise<MultiResolutionResult[]> {
    const opts = { ...DEFAULT_STAGED_OPTIONS, ...options };

    if (!this.vecLoaded) {
      // Fall back to flat search
      return this.flatSearch(queryEmbedding, opts.fineLimit);
    }

    // Stage 1: Retrieve top sections/documents
    const coarseResults = await this.searchByResolution(
      queryEmbedding,
      opts.coarseResolution,
      opts.coarseLimit
    );

    if (coarseResults.length === 0) {
      // No section-level results, fall back to flat chunk search
      return this.flatSearch(queryEmbedding, opts.fineLimit);
    }

    // Extract parent IDs for filtering
    const parentIds = coarseResults.map((r) => r.node.id);

    // Stage 2: Retrieve chunks within those parents
    const fineResults = await this.searchWithParentFilter(
      queryEmbedding,
      parentIds,
      opts.fineResolution,
      opts.fineLimit
    );

    // If no fine results, return coarse results
    if (fineResults.length === 0) {
      return coarseResults;
    }

    return fineResults;
  }

  /**
   * Search at a specific resolution level
   */
  private async searchByResolution(
    queryEmbedding: Float32Array,
    resolution: EmbeddingResolution,
    limit: number
  ): Promise<MultiResolutionResult[]> {
    // First check if we have embeddings at this resolution
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM content_nodes
      WHERE embedding_resolution = ?
    `).get(resolution) as { count: number };

    if (countRow.count === 0) {
      // No embeddings at this resolution, skip
      return [];
    }

    const rows = this.db.prepare(`
      SELECT
        cn.id,
        cn.content_hash,
        cn.uri,
        cn.text,
        cn.format,
        cn.title,
        cn.author,
        cn.word_count,
        cn.tags,
        cn.source_type,
        cn.source_adapter,
        cn.parent_node_id,
        cn.hierarchy_level,
        cn.created_at,
        cn.imported_at,
        cn.embedding_resolution,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM content_nodes cn
      JOIN content_nodes_vec v ON cn.id = v.id
      WHERE cn.embedding_resolution = ?
        AND cn.word_count >= 30
      ORDER BY distance ASC
      LIMIT ?
    `).all(Buffer.from(queryEmbedding.buffer), resolution, limit) as Array<any>;

    return rows.map((row) => ({
      node: this.rowToNode(row),
      distance: row.distance,
      resolution,
      parentId: row.parent_node_id,
    }));
  }

  /**
   * Search chunks within specific parent nodes
   */
  private async searchWithParentFilter(
    queryEmbedding: Float32Array,
    parentIds: string[],
    resolution: EmbeddingResolution,
    limit: number
  ): Promise<MultiResolutionResult[]> {
    if (parentIds.length === 0) return [];

    const placeholders = parentIds.map(() => '?').join(',');

    const rows = this.db.prepare(`
      SELECT
        cn.id,
        cn.content_hash,
        cn.uri,
        cn.text,
        cn.format,
        cn.title,
        cn.author,
        cn.word_count,
        cn.tags,
        cn.source_type,
        cn.source_adapter,
        cn.parent_node_id,
        cn.hierarchy_level,
        cn.created_at,
        cn.imported_at,
        cn.embedding_resolution,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM content_nodes cn
      JOIN content_nodes_vec v ON cn.id = v.id
      WHERE (cn.embedding_resolution = ? OR cn.embedding_resolution IS NULL)
        AND (cn.parent_node_id IN (${placeholders}) OR cn.id IN (${placeholders}))
        AND cn.word_count >= 30
      ORDER BY distance ASC
      LIMIT ?
    `).all(
      Buffer.from(queryEmbedding.buffer),
      resolution,
      ...parentIds,
      ...parentIds,
      limit
    ) as Array<any>;

    return rows.map((row) => ({
      node: this.rowToNode(row),
      distance: row.distance,
      resolution,
      parentId: row.parent_node_id,
    }));
  }

  /**
   * Flat search across all resolutions (fallback)
   */
  private async flatSearch(
    queryEmbedding: Float32Array,
    limit: number
  ): Promise<MultiResolutionResult[]> {
    const rows = this.db.prepare(`
      SELECT
        cn.id,
        cn.content_hash,
        cn.uri,
        cn.text,
        cn.format,
        cn.title,
        cn.author,
        cn.word_count,
        cn.tags,
        cn.source_type,
        cn.source_adapter,
        cn.parent_node_id,
        cn.hierarchy_level,
        cn.created_at,
        cn.imported_at,
        cn.embedding_resolution,
        vec_distance_cosine(v.embedding, ?) as distance
      FROM content_nodes cn
      JOIN content_nodes_vec v ON cn.id = v.id
      WHERE cn.word_count >= 30
      ORDER BY distance ASC
      LIMIT ?
    `).all(Buffer.from(queryEmbedding.buffer), limit) as Array<any>;

    return rows.map((row) => ({
      node: this.rowToNode(row),
      distance: row.distance,
      resolution: row.embedding_resolution ?? EmbeddingResolution.CHUNK,
      parentId: row.parent_node_id,
    }));
  }

  /**
   * Convert database row to ContentNode
   */
  private rowToNode(row: any): ContentNode {
    return {
      id: row.id,
      contentHash: row.content_hash,
      uri: row.uri,
      content: {
        text: row.text,
        format: row.format,
      },
      metadata: {
        title: row.title,
        author: row.author,
        createdAt: row.created_at,
        importedAt: row.imported_at,
        wordCount: row.word_count,
        tags: row.tags ? JSON.parse(row.tags) : [],
        sourceMetadata: {},
      },
      source: {
        type: row.source_type,
        adapter: row.source_adapter,
      },
      version: {
        number: 1,
        rootId: row.id,
      },
    };
  }
}

/**
 * Create a multi-resolution embedder
 */
export function createMultiResolutionEmbedder(
  db: Database.Database,
  vecLoaded: boolean = false
): MultiResolutionEmbedder {
  return new MultiResolutionEmbedder(db, vecLoaded);
}

/**
 * Create a staged retriever
 */
export function createStagedRetriever(
  db: Database.Database,
  vecLoaded: boolean = false
): StagedRetriever {
  return new StagedRetriever(db, vecLoaded);
}
