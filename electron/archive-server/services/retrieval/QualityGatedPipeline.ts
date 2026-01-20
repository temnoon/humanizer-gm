/**
 * QualityGatedPipeline - Full agentic retrieval with quality filtering
 *
 * Combines:
 * - Multi-resolution staged retrieval
 * - Hybrid dense + sparse search
 * - Quality score filtering
 * - Context expansion for short chunks
 *
 * Part of the Multi-Resolution Hybrid Hierarchical embedding system.
 */

import type Database from 'better-sqlite3';
import type { ContentNode } from '@humanizer/core';
import { HybridSearchService } from './HybridSearch.js';
import { StagedRetriever } from './MultiResolutionRetrieval.js';
import { EmbeddingResolution } from './types.js';
import {
  type QualityGateOptions,
  type QualityGatedResult,
  type ContentQuality,
  type PipelineStats,
  DEFAULT_QUALITY_GATE_OPTIONS,
} from './types.js';

/**
 * QualityGatedPipeline - Full retrieval pipeline with quality filtering
 */
export class QualityGatedPipeline {
  private db: Database.Database;
  private hybridSearch: HybridSearchService;
  private stagedRetriever: StagedRetriever;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
    this.hybridSearch = new HybridSearchService(db, vecLoaded);
    this.stagedRetriever = new StagedRetriever(db, vecLoaded);
  }

  /**
   * Full quality-gated retrieval pipeline
   *
   * @param query - Natural language query
   * @param queryEmbedding - Pre-computed query embedding
   * @param options - Pipeline configuration
   * @returns Quality-filtered results with statistics
   */
  async search(
    query: string,
    queryEmbedding: Float32Array,
    options?: Partial<QualityGateOptions>
  ): Promise<{ results: QualityGatedResult[]; stats: PipelineStats }> {
    const opts = { ...DEFAULT_QUALITY_GATE_OPTIONS, ...options };
    const startTime = Date.now();

    const stats: PipelineStats = {
      totalSearched: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rejectionReasons: {},
      totalExpanded: 0,
      durationMs: 0,
    };

    // Stage 1: Retrieve candidates
    let candidates: Array<{ id: string; similarity: number }>;

    if (opts.useStaged && this.vecLoaded) {
      // Use staged multi-resolution retrieval
      const stagedResults = await this.stagedRetriever.stagedSearch(queryEmbedding, {
        coarseLimit: Math.ceil(opts.searchLimit / 5),
        fineLimit: opts.searchLimit,
        coarseResolution: EmbeddingResolution.SECTION,
        fineResolution: EmbeddingResolution.CHUNK,
      });

      candidates = stagedResults.map((r) => ({
        id: r.node.id,
        // Convert distance to similarity (distance 0 = similarity 1)
        similarity: 1 - r.distance / 2,
      }));
    } else if (opts.useHybrid) {
      // Use hybrid dense + sparse search
      const hybridResults = await this.hybridSearch.search(query, queryEmbedding, {
        searchLimit: opts.searchLimit,
      });

      candidates = hybridResults.map((r) => ({
        id: r.id,
        similarity: r.denseScore || 0.5,
      }));
    } else if (this.vecLoaded) {
      // Dense only
      const denseResults = await this.hybridSearch.denseOnly(
        queryEmbedding,
        opts.searchLimit
      );

      candidates = denseResults.map((r) => ({
        id: r.id,
        similarity: r.similarity,
      }));
    } else {
      // FTS only (no vectors available)
      const sparseResults = await this.hybridSearch.sparseOnly(query, opts.searchLimit);

      candidates = sparseResults.map((r) => ({
        id: r.id,
        similarity: r.bm25Rank,
      }));
    }

    stats.totalSearched = candidates.length;

    // Stage 2: Quality filter
    const results: QualityGatedResult[] = [];

    for (const candidate of candidates) {
      if (results.length >= opts.targetCount) break;

      const node = this.getNode(candidate.id);
      if (!node) continue;

      const quality = this.getQuality(candidate.id);

      // Apply quality gates
      const rejection = this.checkQualityGates(node, quality, opts);

      if (rejection) {
        stats.totalRejected++;
        stats.rejectionReasons[rejection] = (stats.rejectionReasons[rejection] || 0) + 1;
        continue;
      }

      // Build result
      const result: QualityGatedResult = {
        node,
        similarity: candidate.similarity,
        quality,
      };

      // Stage 3: Context expansion for short chunks
      if (opts.expandContext && node.metadata.wordCount < opts.expandThreshold) {
        const expanded = this.expandContext(node);
        if (expanded) {
          result.context = expanded;
          stats.totalExpanded++;
        }
      }

      results.push(result);
      stats.totalAccepted++;
    }

    stats.durationMs = Date.now() - startTime;

    return { results, stats };
  }

  /**
   * Check if node passes quality gates
   *
   * @returns Rejection reason or null if passed
   */
  private checkQualityGates(
    node: ContentNode,
    quality: ContentQuality | null,
    opts: QualityGateOptions
  ): string | null {
    // Word count check
    if (node.metadata.wordCount < opts.minWordCount) {
      return 'word-count-too-low';
    }

    // Quality score check
    if (quality) {
      if (quality.overall !== null && quality.overall < opts.minQuality) {
        return 'quality-too-low';
      }

      if (quality.stubType && opts.excludeStubTypes.includes(quality.stubType)) {
        return `stub-type-${quality.stubType}`;
      }
    }

    return null;
  }

  /**
   * Expand context by fetching parent node
   */
  private expandContext(
    node: ContentNode
  ): { parent: ContentNode | null; combinedText: string } | null {
    // Get parent node ID from the database
    const parentRow = this.db.prepare(`
      SELECT parent_node_id FROM content_nodes WHERE id = ?
    `).get(node.id) as { parent_node_id: string | null } | undefined;

    if (!parentRow?.parent_node_id) return null;

    const parent = this.getNode(parentRow.parent_node_id);
    if (!parent) return null;

    // Combine parent context with chunk
    let combinedText: string;
    if (parent.metadata.title) {
      combinedText = `${parent.metadata.title}\n\n${node.content.text}`;
    } else if (parent.content.text.length > 500) {
      // For long parents, show beginning and the chunk
      const preview = parent.content.text.slice(0, 300);
      combinedText = `${preview}...\n\n[...]\n\n${node.content.text}`;
    } else {
      combinedText = `${parent.content.text}\n\n---\n\n${node.content.text}`;
    }

    return { parent, combinedText };
  }

  /**
   * Get a content node by ID
   */
  private getNode(id: string): ContentNode | null {
    const row = this.db.prepare(`
      SELECT
        id, content_hash, uri, text, format, title, author,
        word_count, tags, source_metadata, source_type, source_adapter,
        source_original_id, source_original_path, version_number,
        root_id, created_at, imported_at
      FROM content_nodes WHERE id = ?
    `).get(id) as any;

    if (!row) return null;

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
        sourceMetadata: row.source_metadata ? JSON.parse(row.source_metadata) : {},
      },
      source: {
        type: row.source_type,
        adapter: row.source_adapter,
        originalId: row.source_original_id,
        originalPath: row.source_original_path,
      },
      version: {
        number: row.version_number,
        rootId: row.root_id,
      },
    };
  }

  /**
   * Get quality scores for a node
   */
  private getQuality(nodeId: string): ContentQuality | null {
    const row = this.db.prepare(`
      SELECT
        authenticity, necessity, inflection, voice, overall,
        stub_type, sic_category
      FROM content_quality WHERE node_id = ?
    `).get(nodeId) as any;

    if (!row) return null;

    return {
      authenticity: row.authenticity,
      necessity: row.necessity,
      inflection: row.inflection,
      voice: row.voice,
      overall: row.overall,
      stubType: row.stub_type,
      sicCategory: row.sic_category,
    };
  }

  /**
   * Quick search without quality filtering (for comparison)
   */
  async quickSearch(
    query: string,
    queryEmbedding: Float32Array,
    limit: number = 20
  ): Promise<ContentNode[]> {
    const results = await this.hybridSearch.search(query, queryEmbedding, {
      limit,
    });

    return results
      .map((r) => this.getNode(r.id))
      .filter((n): n is ContentNode => n !== null);
  }
}

/**
 * Create a quality-gated pipeline
 */
export function createQualityGatedPipeline(
  db: Database.Database,
  vecLoaded: boolean = false
): QualityGatedPipeline {
  return new QualityGatedPipeline(db, vecLoaded);
}
