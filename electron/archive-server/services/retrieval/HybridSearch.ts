/**
 * HybridSearch - Combines dense vector search with FTS5 sparse search
 *
 * Uses Reciprocal Rank Fusion to merge results from both retrieval methods.
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import type Database from 'better-sqlite3';
import {
  reciprocalRankFusion,
  type RRFOptions,
} from './ReciprocalRankFusion.js';
import {
  type HybridSearchOptions,
  type FusedResult,
  type RankedResult,
  DEFAULT_HYBRID_OPTIONS,
} from './types.js';

/**
 * HybridSearchService - Combines dense and sparse retrieval
 */
export class HybridSearchService {
  private db: Database.Database;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Hybrid search combining dense vectors and FTS5
   *
   * @param query - Natural language query text
   * @param queryEmbedding - Pre-computed query embedding
   * @param options - Search configuration
   * @returns Fused results sorted by combined score
   */
  async search(
    query: string,
    queryEmbedding: Float32Array,
    options?: Partial<HybridSearchOptions>
  ): Promise<FusedResult[]> {
    const opts = { ...DEFAULT_HYBRID_OPTIONS, ...options };

    // Run searches in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this.denseSearch(queryEmbedding, opts.searchLimit!, opts.minDenseScore!),
      this.sparseSearch(query, opts.searchLimit!),
    ]);

    // Fuse results using RRF
    const rrfOptions: Partial<RRFOptions> = {
      k: opts.fusionK,
      denseWeight: opts.denseWeight,
      sparseWeight: opts.sparseWeight,
    };

    const fused = reciprocalRankFusion(
      denseResults.map((r) => ({
        id: r.id,
        score: r.similarity,
        source: 'dense' as const,
      })),
      sparseResults.map((r) => ({
        id: r.id,
        score: r.bm25Rank,
        source: 'sparse' as const,
      })),
      rrfOptions
    );

    return fused.slice(0, opts.limit);
  }

  /**
   * Dense vector search using sqlite-vec
   */
  private async denseSearch(
    embedding: Float32Array,
    limit: number,
    minScore: number
  ): Promise<Array<{ id: string; similarity: number }>> {
    if (!this.vecLoaded) {
      return [];
    }

    try {
      // sqlite-vec cosine distance: 0 = identical, 2 = opposite
      // Convert to similarity: 1 - (distance / 2)
      const rows = this.db
        .prepare(
          `
          SELECT
            cn.id,
            1 - (vec_distance_cosine(v.embedding, ?) / 2) as similarity
          FROM content_nodes cn
          JOIN content_nodes_vec v ON cn.id = v.id
          WHERE cn.word_count >= 30
          ORDER BY similarity DESC
          LIMIT ?
        `
        )
        .all(Buffer.from(embedding.buffer), limit) as Array<{
        id: string;
        similarity: number;
      }>;

      // Filter by minimum score
      return rows.filter((r) => r.similarity >= minScore);
    } catch (error) {
      console.error('[HybridSearch] Dense search failed:', error);
      return [];
    }
  }

  /**
   * Sparse FTS5 search with BM25 ranking
   */
  private async sparseSearch(
    query: string,
    limit: number
  ): Promise<Array<{ id: string; bm25Rank: number }>> {
    try {
      // Escape and prepare FTS5 query
      const ftsQuery = this.prepareFTS5Query(query);

      if (!ftsQuery) {
        return [];
      }

      // FTS5 with bm25 ranking
      // Weight title matches higher than text matches
      const rows = this.db
        .prepare(
          `
          SELECT
            cn.id,
            bm25(content_nodes_fts, 1.0, 10.0) as bm25_rank
          FROM content_nodes cn
          JOIN content_nodes_fts fts ON cn.rowid = fts.rowid
          WHERE content_nodes_fts MATCH ?
            AND cn.word_count >= 30
          ORDER BY bm25_rank
          LIMIT ?
        `
        )
        .all(ftsQuery, limit) as Array<{ id: string; bm25_rank: number }>;

      // Normalize BM25 scores (they're negative, lower = better match)
      const minRank = Math.min(...rows.map((r) => r.bm25_rank), 0);
      const maxRank = Math.max(...rows.map((r) => r.bm25_rank), 0);
      const range = maxRank - minRank || 1;

      return rows.map((r) => ({
        id: r.id,
        // Convert to 0-1 scale where 1 is best
        bm25Rank: 1 - (r.bm25_rank - minRank) / range,
      }));
    } catch (error) {
      console.error('[HybridSearch] Sparse search failed:', error);
      return [];
    }
  }

  /**
   * Prepare a query string for FTS5
   * Escapes special characters and creates an OR query
   */
  private prepareFTS5Query(query: string): string | null {
    // Remove FTS5 special characters
    const cleaned = query
      .replace(/["\-*()^~:]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 1);

    if (cleaned.length === 0) {
      return null;
    }

    // Create OR query with each term quoted
    return cleaned.map((term) => `"${term}"`).join(' OR ');
  }

  /**
   * Search only using dense vectors (for comparison/fallback)
   */
  async denseOnly(
    queryEmbedding: Float32Array,
    limit: number = 20,
    minScore: number = 0.3
  ): Promise<Array<{ id: string; similarity: number }>> {
    return this.denseSearch(queryEmbedding, limit, minScore);
  }

  /**
   * Search only using FTS5 (for comparison/fallback)
   */
  async sparseOnly(
    query: string,
    limit: number = 20
  ): Promise<Array<{ id: string; bm25Rank: number }>> {
    return this.sparseSearch(query, limit);
  }
}

/**
 * Create a hybrid search service
 */
export function createHybridSearchService(
  db: Database.Database,
  vecLoaded: boolean = false
): HybridSearchService {
  return new HybridSearchService(db, vecLoaded);
}
