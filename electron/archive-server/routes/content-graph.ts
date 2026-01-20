/**
 * Content Graph API Routes
 *
 * REST API endpoints for Universal Content Graph operations.
 */

import { randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { ContentGraphDatabase } from '../services/content-graph/ContentGraphDatabase.js';
import { getArchiveRoot, getMediaStoragePath } from '../config.js';
import { LinkGraph } from '../services/content-graph/LinkGraph.js';
import {
  requireAuth,
  optionalAuth,
  getUserId,
  isOwner,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { VersionControl } from '../services/content-graph/VersionControl.js';
import { UCGMigration } from '../services/content-graph/migration.js';
import {
  getEmbeddingDatabase,
  getContentGraphDatabase,
  getIngestionService,
} from '../services/registry.js';
import {
  embed,
  initializeEmbedding,
} from '../services/embeddings/EmbeddingGenerator.js';
import {
  HybridSearchService,
  StagedRetriever,
  QualityGatedPipeline,
  EmbeddingResolution,
} from '../services/retrieval/index.js';
import type {
  ContentNodeQuery,
  ContentLink,
  LinkType,
  SourceType,
} from '@humanizer/core';

/**
 * Create content graph routes using service registry
 */
export function createContentGraphRouter(): Router {
  const router = Router();

  // Services are lazily initialized via registry
  const getGraphDb = () => getContentGraphDatabase();
  const getLinkGraph = () => {
    const graphDb = getContentGraphDatabase();
    const embDb = getEmbeddingDatabase();
    return new LinkGraph(embDb.getRawDb(), graphDb);
  };
  const getVersionCtrl = () => {
    const graphDb = getContentGraphDatabase();
    const embDb = getEmbeddingDatabase();
    return new VersionControl(embDb.getRawDb(), graphDb);
  };

  // ===========================================================================
  // NODE ROUTES
  // ===========================================================================

  /**
   * GET /nodes/:id - Get a node by ID
   * Security: Requires auth, checks ownership
   */
  router.get('/nodes/:id', requireAuth(), (req: Request, res: Response) => {
    try {
      const node = getGraphDb().getNode(req.params.id);
      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }
      // Check ownership (NULL user_id = legacy data, allowed)
      const nodeRow = getGraphDb().getNodeRow(req.params.id);
      if (!isOwner(req, nodeRow?.user_id)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }
      res.json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /nodes/by-uri - Get a node by URI
   * Security: Requires auth, checks ownership
   */
  router.get('/nodes/by-uri', requireAuth(), (req: Request, res: Response) => {
    try {
      const uri = req.query.uri as string;
      if (!uri) {
        res.status(400).json({ error: 'URI parameter required' });
        return;
      }
      const node = getGraphDb().getNodeByUri(uri);
      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }
      // Check ownership
      const nodeRow = getGraphDb().getNodeRow(node.id);
      if (!isOwner(req, nodeRow?.user_id)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }
      res.json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /nodes/query - Query nodes with filters
   * Security: Requires auth, filters by user
   */
  router.post('/nodes/query', requireAuth(), (req: Request, res: Response) => {
    try {
      const query: ContentNodeQuery = req.body;
      const userId = getUserId(req);
      // Add user filter to query
      const userFilteredQuery = {
        ...query,
        userId, // Pass to queryNodes for filtering
      };
      const nodes = getGraphDb().queryNodes(userFilteredQuery);
      res.json(nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /nodes/search - Full-text search for nodes
   * Security: Requires auth, filters by user
   */
  router.get('/nodes/search', requireAuth(), (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const userId = getUserId(req);

      if (!q) {
        res.status(400).json({ error: 'Query parameter required' });
        return;
      }

      const nodes = getGraphDb().searchNodes(q, limit, userId);
      res.json(nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /nodes/by-keyword - Find related passages by keyword centrality
   *
   * Returns passages where the keyword is most central, using TF-IDF scoring.
   * Title matches and early occurrences are boosted.
   */
  router.post('/nodes/by-keyword', (req: Request, res: Response) => {
    try {
      const { keyword, excludeNodeId, limit } = req.body as {
        keyword: string;
        excludeNodeId?: string;
        limit?: number;
      };

      if (!keyword || typeof keyword !== 'string') {
        res.status(400).json({ error: 'Keyword parameter required' });
        return;
      }

      const results = getGraphDb().findByKeyword(keyword, {
        excludeNodeId,
        limit: limit || 20,
      });

      // Return in a format that separates nodes and scores
      res.json({
        keyword: keyword.toLowerCase().trim(),
        totalResults: results.length,
        results: results.map(({ node, score }) => ({
          node,
          score,
        })),
      });
    } catch (error) {
      console.error('[UCG] by-keyword error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /nodes - Create a new node
   */
  router.post('/nodes', (req: Request, res: Response) => {
    try {
      const {
        text,
        format,
        title,
        author,
        tags,
        sourceType,
        sourceMetadata,
      } = req.body;

      if (!text || !sourceType) {
        res.status(400).json({ error: 'text and sourceType required' });
        return;
      }

      const node = getGraphDb().createNode({
        text,
        format,
        title,
        author,
        tags,
        sourceType: sourceType as SourceType,
        sourceMetadata,
      });

      res.status(201).json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * PATCH /nodes/:id - Update a node (creates new version)
   */
  router.patch('/nodes/:id', (req: Request, res: Response) => {
    try {
      const { content, metadata, operation, operatorId } = req.body;

      const updates: Partial<{
        content: { text: string; format?: string; rendered?: string };
        metadata: { title?: string; tags?: string[] };
      }> = {};

      if (content && content.text) {
        updates.content = content;
      }
      if (metadata) {
        updates.metadata = metadata;
      }

      const node = getGraphDb().updateNode(
        req.params.id,
        updates as Partial<Pick<import('@humanizer/core').ContentNode, 'content' | 'metadata'>>,
        operation || 'edit',
        operatorId
      );

      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }

      res.json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /nodes/:id - Delete a node
   */
  router.delete('/nodes/:id', (req: Request, res: Response) => {
    try {
      const success = getGraphDb().deleteNode(req.params.id);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /nodes/by-source/:sourceType - Delete all nodes of a source type
   */
  router.delete('/nodes/by-source/:sourceType', (req: Request, res: Response) => {
    try {
      const sourceType = req.params.sourceType;
      const result = getGraphDb().deleteBySourceType(sourceType);

      res.json({
        success: true,
        deletedNodes: result.deletedNodes,
        deletedLinks: result.deletedLinks,
        sourceType
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // LINK ROUTES
  // ===========================================================================

  /**
   * GET /links - Get links for a node
   */
  router.get('/links', (req: Request, res: Response) => {
    try {
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const type = req.query.type as LinkType | undefined;

      if (!from && !to) {
        res.status(400).json({ error: 'from or to parameter required' });
        return;
      }

      let links: ContentLink[] = [];
      if (from) {
        links = links.concat(getGraphDb().getLinksFrom(from, type ? [type] : undefined));
      }
      if (to) {
        links = links.concat(getGraphDb().getLinksTo(to, type ? [type] : undefined));
      }

      // Deduplicate
      const seen = new Set<string>();
      links = links.filter((link: ContentLink) => {
        if (seen.has(link.id)) return false;
        seen.add(link.id);
        return true;
      });

      res.json(links);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /links - Create a new link
   */
  router.post('/links', (req: Request, res: Response) => {
    try {
      const { sourceId, targetId, type, strength, metadata, createdBy } = req.body;

      if (!sourceId || !targetId || !type) {
        res.status(400).json({ error: 'sourceId, targetId, and type required' });
        return;
      }

      const link = getGraphDb().createLink({
        sourceId,
        targetId,
        type: type as LinkType,
        strength,
        metadata,
        createdBy,
      });

      res.status(201).json(link);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /links/:id - Delete a link
   */
  router.delete('/links/:id', (req: Request, res: Response) => {
    try {
      const success = getGraphDb().deleteLink(req.params.id);
      res.json({ success });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // GRAPH ROUTES
  // ===========================================================================

  /**
   * GET /graph/derivatives/:id - Get all derivatives of a node
   */
  router.get('/graph/derivatives/:id', (req: Request, res: Response) => {
    try {
      const result = getLinkGraph().getDerivatives(req.params.id);
      res.json(result.nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /graph/lineage/:id - Get lineage of a node
   */
  router.get('/graph/lineage/:id', (req: Request, res: Response) => {
    try {
      const result = getLinkGraph().getLineage(req.params.id);
      res.json(result.nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /graph/related/:id - Get related nodes
   */
  router.get('/graph/related/:id', (req: Request, res: Response) => {
    try {
      const depth = parseInt(req.query.depth as string) || 2;
      const result = getLinkGraph().getRelated(req.params.id, depth);
      res.json(result.nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /graph/path - Find path between two nodes
   */
  router.get('/graph/path', (req: Request, res: Response) => {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;
      const maxDepth = parseInt(req.query.maxDepth as string) || 10;

      if (!from || !to) {
        res.status(400).json({ error: 'from and to parameters required' });
        return;
      }

      const path = getLinkGraph().findPath(from, to, undefined, maxDepth);
      if (!path) {
        res.status(404).json({ error: 'No path found' });
        return;
      }

      res.json(path);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /graph/clusters - Find content clusters
   */
  router.get('/graph/clusters', (req: Request, res: Response) => {
    try {
      const minSize = parseInt(req.query.minSize as string) || 3;
      const maxClusters = parseInt(req.query.maxClusters as string) || 10;

      const clusters = getLinkGraph().findClusters(minSize, maxClusters);
      res.json(clusters);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // VERSION ROUTES
  // ===========================================================================

  /**
   * GET /versions/:id - Get version history
   */
  router.get('/versions/:id', (req: Request, res: Response) => {
    try {
      const versions = getVersionCtrl().getAllVersions(req.params.id);
      res.json(versions);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /versions/:id/tree - Get version tree
   */
  router.get('/versions/:id/tree', (req: Request, res: Response) => {
    try {
      const tree = getVersionCtrl().getVersionTree(req.params.id);
      if (!tree) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }
      res.json(tree);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /versions/:id/revert - Revert to a previous version
   */
  router.post('/versions/:id/revert', (req: Request, res: Response) => {
    try {
      const { versionNumber, operatorId } = req.body;

      if (versionNumber === undefined) {
        res.status(400).json({ error: 'versionNumber required' });
        return;
      }

      const node = getVersionCtrl().revert(req.params.id, versionNumber, operatorId);
      if (!node) {
        res.status(404).json({ error: 'Node or version not found' });
        return;
      }

      res.json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /versions/:id/fork - Fork a node
   */
  router.post('/versions/:id/fork', (req: Request, res: Response) => {
    try {
      const { operatorId } = req.body;
      const node = getVersionCtrl().fork(req.params.id, operatorId);

      if (!node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }

      res.status(201).json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /versions/:id/diff - Compare two versions
   */
  router.get('/versions/:id/diff', (req: Request, res: Response) => {
    try {
      const to = req.query.to as string;

      if (!to) {
        res.status(400).json({ error: 'to parameter required' });
        return;
      }

      const diff = getVersionCtrl().diff(req.params.id, to);
      if (!diff) {
        res.status(404).json({ error: 'One or both versions not found' });
        return;
      }

      res.json(diff);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // STATS AND MIGRATION ROUTES
  // ===========================================================================

  /**
   * GET /stats - Get database statistics
   */
  router.get('/stats', (req: Request, res: Response) => {
    try {
      const stats = getGraphDb().getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /migration/status - Get migration status
   */
  router.get('/migration/status', (req: Request, res: Response) => {
    try {
      const embDb = getEmbeddingDatabase();
      const graphDb = getContentGraphDatabase();
      const migration = new UCGMigration(embDb.getRawDb(), graphDb);
      const isMigrated = migration.isMigrated();
      const preMigrationStats = migration.getPreMigrationStats();

      res.json({
        isMigrated,
        ...preMigrationStats,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /migration/run - Run migration
   */
  router.post('/migration/run', async (req: Request, res: Response) => {
    try {
      const { dryRun } = req.body;
      const embDb = getEmbeddingDatabase();
      const graphDb = getContentGraphDatabase();
      const migration = new UCGMigration(embDb.getRawDb(), graphDb);

      const stats = await migration.migrate(undefined, { dryRun });
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // INGESTION ROUTES
  // ===========================================================================

  /**
   * GET /ingestion/stats - Get ingestion statistics
   */
  router.get('/ingestion/stats', (req: Request, res: Response) => {
    try {
      const ingestion = getIngestionService();
      const stats = ingestion.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /ingestion/run - Run ingestion pipeline
   */
  router.post('/ingestion/run', async (req: Request, res: Response) => {
    try {
      const { batchSize, skipEmbedding } = req.body;
      const ingestion = getIngestionService();

      const stats = await ingestion.ingestAll({
        batchSize,
        skipEmbedding,
      });
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /ingestion/conversation/:id - Ingest a specific conversation
   */
  router.post('/ingestion/conversation/:id', async (req: Request, res: Response) => {
    try {
      const { skipEmbedding } = req.body;
      const ingestion = getIngestionService();

      const stats = await ingestion.ingestConversation(req.params.id, skipEmbedding);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /ingestion/content-item/:id - Ingest a specific content item
   */
  router.post('/ingestion/content-item/:id', async (req: Request, res: Response) => {
    try {
      const { skipEmbedding } = req.body;
      const ingestion = getIngestionService();

      const stats = await ingestion.ingestContentItem(req.params.id, skipEmbedding);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /ingestion/embed-pending - Generate embeddings for pending nodes
   */
  router.post('/ingestion/embed-pending', async (req: Request, res: Response) => {
    try {
      const { limit } = req.body;
      const ingestion = getIngestionService();

      const generated = await ingestion.embedPending(limit || 100);
      res.json({ embeddingsGenerated: generated });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // SEMANTIC SEARCH ROUTES
  // ===========================================================================

  /**
   * POST /search/semantic - Semantic search across UCG content nodes
   * Security: Requires auth, filters results by user
   */
  router.post('/search/semantic', requireAuth(), async (req: Request, res: Response) => {
    try {
      const { query, limit = 20, threshold = 0.5, includeParent = true } = req.body;
      const userId = getUserId(req);

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      // Initialize embedding model
      await initializeEmbedding();

      // Generate query embedding
      const queryEmbedding = await embed(query);

      // Search UCG content nodes with user filtering
      const graphDb = getGraphDb();
      const results = graphDb.searchByEmbedding(queryEmbedding, limit, threshold, userId);

      // Optionally include parent node info for chunks
      const enrichedResults = results.map(result => {
        const enriched: {
          node: typeof result.node;
          similarity: number;
          parent?: typeof result.node | null;
        } = {
          node: result.node,
          similarity: result.similarity,
        };

        if (includeParent && result.node.metadata?.sourceMetadata) {
          const parentId = (result.node.metadata.sourceMetadata as Record<string, unknown>).parentNodeId as string | undefined;
          if (parentId) {
            enriched.parent = graphDb.getNode(parentId);
          }
        }

        return enriched;
      });

      res.json({
        query,
        results: enrichedResults,
        total: enrichedResults.length,
      });
    } catch (error) {
      console.error('[ucg] Semantic search error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /search/agent - Agentic search with quality filtering
   *
   * Pipeline:
   * 1. Semantic search
   * 2. Quality grading (SIC-style)
   * 3. Context expansion for fragments
   * 4. Clustering
   * 5. Return quality-filtered results
   */
  router.post('/search/agent', async (req: Request, res: Response) => {
    try {
      const {
        query,
        targetCount = 20,
        searchLimit = 100,
        minQuality = 2.5,
        minWordCount = 30,
        expandContext = true,
      } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      const startTime = Date.now();

      // Initialize embedding
      await initializeEmbedding();

      // Generate query embedding
      const queryEmbedding = await embed(query);

      // Search UCG content nodes
      const graphDb = getGraphDb();
      const rawResults = graphDb.searchByEmbedding(queryEmbedding, searchLimit, 0.3);

      if (rawResults.length === 0) {
        res.json({
          query,
          results: [],
          stats: {
            totalSearched: 0,
            totalAccepted: 0,
            totalRejected: 0,
            totalExpanded: 0,
            clusters: 0,
            exhausted: true,
            duration: Date.now() - startTime,
          },
        });
        return;
      }

      // Grade and filter results
      const acceptedResults: Array<{
        node: typeof rawResults[0]['node'];
        similarity: number;
        quality: {
          overall: number;
          specificity: number;
          coherence: number;
          substance: number;
        };
        context?: {
          parent?: typeof rawResults[0]['node'];
          combinedText?: string;
        };
        cluster?: string;
      }> = [];

      let totalRejected = 0;
      let totalExpanded = 0;
      const queryTerms = query.toLowerCase().split(/\s+/);

      for (const result of rawResults) {
        if (acceptedResults.length >= targetCount) break;

        const node = result.node;
        const text = node.content?.text || '';

        // Skip invalid nodes
        if (!text) {
          totalRejected++;
          continue;
        }

        const words = text.split(/\s+/).filter(Boolean);
        const wordCount = words.length;

        // Check word count
        if (wordCount < minWordCount) {
          // Try to expand with parent context
          if (expandContext && node.metadata?.sourceMetadata) {
            const parentId = (node.metadata.sourceMetadata as Record<string, unknown>).parentNodeId as string | undefined;
            if (parentId) {
              const parent = graphDb.getNode(parentId);
              if (parent?.content?.text) {
                const expandedText = [parent.content.text, text].join('\n\n---\n\n');
                const expandedWordCount = expandedText.split(/\s+/).filter(Boolean).length;

                if (expandedWordCount >= minWordCount) {
                  totalExpanded++;
                  const quality = gradeContent(expandedText, queryTerms);
                  if (quality.overall >= minQuality) {
                    acceptedResults.push({
                      node,
                      similarity: result.similarity,
                      quality,
                      context: {
                        parent,
                        combinedText: expandedText,
                      },
                    });
                    continue;
                  }
                }
              }
            }
          }
          totalRejected++;
          continue;
        }

        // Grade content
        const quality = gradeContent(text, queryTerms);

        if (quality.overall >= minQuality) {
          acceptedResults.push({
            node,
            similarity: result.similarity,
            quality,
          });
        } else {
          totalRejected++;
        }
      }

      // Simple clustering by source type
      const clusters = new Map<string, string>();
      const bySource = new Map<string, typeof acceptedResults>();

      for (const result of acceptedResults) {
        const sourceType = result.node.source?.type || 'unknown';
        if (!bySource.has(sourceType)) {
          bySource.set(sourceType, []);
        }
        bySource.get(sourceType)!.push(result);
      }

      let clusterIndex = 0;
      for (const [sourceType, sourceResults] of bySource) {
        for (const result of sourceResults) {
          const clusterName = `${sourceType}-${clusterIndex}`;
          clusters.set(result.node.id, clusterName);
          result.cluster = clusterName;
        }
        clusterIndex++;
      }

      res.json({
        query,
        results: acceptedResults,
        stats: {
          totalSearched: rawResults.length,
          totalAccepted: acceptedResults.length,
          totalRejected,
          totalExpanded,
          clusters: bySource.size,
          exhausted: acceptedResults.length < targetCount,
          duration: Date.now() - startTime,
        },
      });
    } catch (error) {
      console.error('[ucg] Agentic search error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /search/hybrid - Hybrid dense + sparse search with RRF fusion
   *
   * Combines vector similarity search with FTS5 keyword search using
   * Reciprocal Rank Fusion for optimal results.
   */
  router.post('/search/hybrid', async (req: Request, res: Response) => {
    try {
      const {
        query,
        limit = 20,
        searchLimit = 100,
        minDenseScore = 0.3,
        denseWeight = 0.7,
        sparseWeight = 0.3,
        fusionK = 60,
      } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      const startTime = Date.now();
      await initializeEmbedding();
      const queryEmbedding = await embed(query);

      const embDb = getEmbeddingDatabase();
      const db = embDb.getRawDb();
      const vecLoaded = embDb.isVecLoaded?.() ?? false;

      const hybridSearch = new HybridSearchService(db, vecLoaded);
      const embeddingArray = new Float32Array(queryEmbedding);
      const results = await hybridSearch.search(query, embeddingArray, {
        limit,
        searchLimit,
        minDenseScore,
        denseWeight,
        sparseWeight,
        fusionK,
      });

      // Fetch full nodes for results
      const graphDb = getGraphDb();
      const nodesWithScores = results.map((r) => ({
        node: graphDb.getNode(r.id),
        fusedScore: r.fusedScore,
        denseScore: r.denseScore,
        denseRank: r.denseRank,
        sparseScore: r.sparseScore,
        sparseRank: r.sparseRank,
      })).filter((r) => r.node !== null);

      res.json({
        query,
        results: nodesWithScores,
        stats: {
          total: nodesWithScores.length,
          durationMs: Date.now() - startTime,
        },
      });
    } catch (error) {
      console.error('[ucg] Hybrid search error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /search/staged - Multi-resolution staged retrieval
   *
   * Two-stage search: first finds relevant sections/documents,
   * then searches within those for specific chunks.
   */
  router.post('/search/staged', async (req: Request, res: Response) => {
    try {
      const {
        query,
        coarseLimit = 20,
        fineLimit = 100,
        coarseResolution = EmbeddingResolution.SECTION,
        fineResolution = EmbeddingResolution.CHUNK,
      } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      const startTime = Date.now();
      await initializeEmbedding();
      const queryEmbedding = await embed(query);

      const embDb = getEmbeddingDatabase();
      const db = embDb.getRawDb();
      const vecLoaded = embDb.isVecLoaded?.() ?? false;

      const stagedRetriever = new StagedRetriever(db, vecLoaded);
      const embeddingArray = new Float32Array(queryEmbedding);
      const results = await stagedRetriever.stagedSearch(embeddingArray, {
        coarseLimit,
        fineLimit,
        coarseResolution,
        fineResolution,
      });

      res.json({
        query,
        results: results.map((r) => ({
          node: r.node,
          distance: r.distance,
          similarity: 1 - r.distance / 2,
          resolution: r.resolution,
          parentId: r.parentId,
        })),
        stats: {
          total: results.length,
          durationMs: Date.now() - startTime,
        },
      });
    } catch (error) {
      console.error('[ucg] Staged search error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /search/quality-gated - Full quality-gated retrieval pipeline
   *
   * Combines multi-resolution retrieval, hybrid search, quality filtering,
   * and context expansion for optimal agentic search results.
   */
  router.post('/search/quality-gated', async (req: Request, res: Response) => {
    try {
      const {
        query,
        targetCount = 20,
        searchLimit = 100,
        useStaged = true,
        useHybrid = true,
        minQuality = 0.4,
        minWordCount = 30,
        excludeStubTypes = ['stub-breadcrumb', 'stub-sentence'],
        expandContext = true,
        expandThreshold = 50,
        rerank = false,
      } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      await initializeEmbedding();
      const queryEmbedding = await embed(query);

      const embDb = getEmbeddingDatabase();
      const db = embDb.getRawDb();
      const vecLoaded = embDb.isVecLoaded?.() ?? false;

      const pipeline = new QualityGatedPipeline(db, vecLoaded);
      const embeddingArray = new Float32Array(queryEmbedding);
      const { results, stats } = await pipeline.search(query, embeddingArray, {
        targetCount,
        searchLimit,
        useStaged,
        useHybrid,
        minQuality,
        minWordCount,
        excludeStubTypes,
        expandContext,
        expandThreshold,
        rerank,
      });

      res.json({
        query,
        results: results.map((r) => ({
          node: r.node,
          similarity: r.similarity,
          quality: r.quality,
          context: r.context,
        })),
        stats,
      });
    } catch (error) {
      console.error('[ucg] Quality-gated search error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // UCG IMPORT ROUTES
  // ===========================================================================

  // Import job tracking
  const importJobs = new Map<string, {
    id: string;
    status: 'pending' | 'parsing' | 'ingesting' | 'complete' | 'error';
    progress: number;
    nodeCount: number;
    error?: string;
    startedAt: number;
    completedAt?: number;
  }>();

  /**
   * Helper to iterate over adapter parse results
   * Handles both AsyncIterable<ContentNode> and Promise<ParseResult>
   */
  async function* iterateParseResult(
    parseResult: AsyncIterable<import('@humanizer/core').ContentNode> | Promise<import('@humanizer/core').ParseResult>
  ): AsyncIterable<import('@humanizer/core').ContentNode> {
    // Check if it's a Promise (ParseResult)
    if ('then' in parseResult && typeof parseResult.then === 'function') {
      const result = await parseResult;
      for (const node of result.nodes) {
        yield node;
      }
    } else {
      // It's an AsyncIterable
      for await (const node of parseResult as AsyncIterable<import('@humanizer/core').ContentNode>) {
        yield node;
      }
    }
  }

  /**
   * POST /import/facebook - Import Facebook export directly to UCG
   */
  router.post('/import/facebook', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'Facebook import started' });

      // Process in background
      (async () => {
        try {
          const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');
          const adapter = adapterRegistry.get('facebook');

          if (!adapter) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'Facebook adapter not found' });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          // Parse and insert nodes
          const parseResult = adapter.parse({ exportPath }, { batchId });
          for await (const node of iterateParseResult(parseResult)) {
            graphDb.insertNode(node);
            nodeCount++;

            // Update progress
            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          // Mark complete
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] Facebook import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] Facebook import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/folder - Import folder directly to UCG
   */
  router.post('/import/folder', async (req: Request, res: Response) => {
    try {
      const { folderPath, recursive = true, extensions } = req.body;

      if (!folderPath) {
        res.status(400).json({ error: 'folderPath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'Folder import started' });

      // Process in background
      (async () => {
        try {
          const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');
          const adapter = adapterRegistry.get('folder');

          if (!adapter) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'Folder adapter not found' });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          // Parse and insert nodes
          const parseResult = adapter.parse({ folderPath, recursive, extensions }, { batchId });
          for await (const node of iterateParseResult(parseResult)) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] Folder import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] Folder import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/chatgpt - Import ChatGPT export directly to UCG
   */
  router.post('/import/chatgpt', async (req: Request, res: Response) => {
    try {
      const { archivePath } = req.body;

      if (!archivePath) {
        res.status(400).json({ error: 'archivePath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'ChatGPT import started' });

      // Process in background
      (async () => {
        try {
          const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');
          const adapter = adapterRegistry.get('chatgpt');

          if (!adapter) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'ChatGPT adapter not found' });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          const parseResult = adapter.parse(archivePath, { batchId });
          for await (const node of iterateParseResult(parseResult)) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] ChatGPT import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] ChatGPT import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/claude - Import Claude export directly to UCG
   */
  router.post('/import/claude', async (req: Request, res: Response) => {
    try {
      const { archivePath } = req.body;

      if (!archivePath) {
        res.status(400).json({ error: 'archivePath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'Claude import started' });

      // Process in background
      (async () => {
        try {
          const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');
          const adapter = adapterRegistry.get('claude');

          if (!adapter) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'Claude adapter not found' });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          const parseResult = adapter.parse(archivePath, { batchId });
          for await (const node of iterateParseResult(parseResult)) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] Claude import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] Claude import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/reddit - Import Reddit export directly to UCG
   */
  router.post('/import/reddit', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'Reddit import started' });

      // Process in background
      (async () => {
        try {
          const { createRedditAdapter } = await import('../services/content-graph/adapters/reddit-adapter.js');
          const adapter = createRedditAdapter();

          // Detect first
          const detection = await adapter.detect(exportPath);
          if (!detection.canHandle) {
            importJobs.set(jobId, {
              ...importJobs.get(jobId)!,
              status: 'error',
              error: 'Not a valid Reddit export directory',
            });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          const parseResult = adapter.parse(exportPath, { batchId });
          for await (const node of parseResult) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] Reddit import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] Reddit import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/instagram - Import Instagram export directly to UCG
   */
  router.post('/import/instagram', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'Instagram import started' });

      // Process in background
      (async () => {
        try {
          const { createInstagramAdapter } = await import('../services/content-graph/adapters/instagram-adapter.js');
          const adapter = createInstagramAdapter();

          // Detect first
          const detection = await adapter.detect(exportPath);
          if (!detection.canHandle) {
            importJobs.set(jobId, {
              ...importJobs.get(jobId)!,
              status: 'error',
              error: 'Not a valid Instagram export directory',
            });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          const parseResult = adapter.parse(exportPath, { batchId });
          for await (const node of parseResult) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] Instagram import complete: ${nodeCount} nodes`);
        } catch (error) {
          console.error('[ucg] Instagram import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /import/file - Auto-detect and import a single file
   */
  router.post('/import/file', async (req: Request, res: Response) => {
    try {
      const { filePath, hint } = req.body;

      if (!filePath) {
        res.status(400).json({ error: 'filePath required' });
        return;
      }

      const jobId = randomUUID();
      importJobs.set(jobId, {
        id: jobId,
        status: 'parsing',
        progress: 0,
        nodeCount: 0,
        startedAt: Date.now(),
      });

      res.json({ success: true, importId: jobId, message: 'File import started' });

      // Process in background
      (async () => {
        try {
          const fs = await import('fs');
          const path = await import('path');

          if (!fs.existsSync(filePath)) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'File not found' });
            return;
          }

          const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');

          // Auto-detect adapter
          const extension = path.extname(filePath);
          const detection = await adapterRegistry.detect(filePath, { extension });

          if (!detection) {
            importJobs.set(jobId, { ...importJobs.get(jobId)!, status: 'error', error: 'No adapter found for file type' });
            return;
          }

          const graphDb = getGraphDb();
          let nodeCount = 0;
          const batchId = jobId;

          const parseResult = detection.adapter.parse(filePath, { batchId });
          for await (const node of iterateParseResult(parseResult)) {
            graphDb.insertNode(node);
            nodeCount++;

            const job = importJobs.get(jobId)!;
            job.nodeCount = nodeCount;
            job.progress = Math.min(99, nodeCount);
          }

          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'complete',
            progress: 100,
            nodeCount,
            completedAt: Date.now(),
          });

          console.log(`[ucg] File import complete: ${nodeCount} nodes via ${detection.adapter.id}`);
        } catch (error) {
          console.error('[ucg] File import error:', error);
          importJobs.set(jobId, {
            ...importJobs.get(jobId)!,
            status: 'error',
            error: String(error),
          });
        }
      })();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /import/status/:id - Get import job status
   */
  router.get('/import/status/:id', (req: Request, res: Response) => {
    try {
      const job = importJobs.get(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /import/adapters - List available import adapters
   */
  router.get('/import/adapters', async (req: Request, res: Response) => {
    try {
      const { adapterRegistry } = await import('../services/content-graph/AdapterRegistry.js');
      const adapters = adapterRegistry.list();
      res.json({ adapters });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ===========================================================================
  // MEDIA ROUTES
  // ===========================================================================

  /**
   * GET /nodes/:id/media - Get media items associated with a content node
   *
   * Returns a list of media items linked to this content node via media_references.
   * Falls back to folder-based lookup if no media_references exist.
   * Each item includes a URL that can be used to fetch the actual media.
   */
  router.get('/nodes/:id/media', async (req: Request, res: Response) => {
    try {
      const nodeId = req.params.id;

      // Get the embedding database to query media tables
      const embDb = getEmbeddingDatabase();
      const db = embDb.getRawDb();

      // Query media_references and media_items for this content node
      const mediaItems = db.prepare(`
        SELECT
          mi.content_hash,
          mi.file_path,
          mi.mime_type,
          mi.original_filename,
          mi.width,
          mi.height,
          mi.vision_description,
          mr.position,
          mr.reference_type,
          mr.original_pointer,
          mr.caption,
          mr.alt_text
        FROM media_references mr
        JOIN media_items mi ON mr.media_hash = mi.content_hash
        WHERE mr.content_id = ?
        ORDER BY mr.position ASC
      `).all(nodeId) as Array<{
        content_hash: string;
        file_path: string;
        mime_type: string | null;
        original_filename: string | null;
        width: number | null;
        height: number | null;
        vision_description: string | null;
        position: number | null;
        reference_type: string;
        original_pointer: string | null;
        caption: string | null;
        alt_text: string | null;
      }>;

      // If we found media_references, return them
      if (mediaItems.length > 0) {
        const result = mediaItems.map(item => ({
          hash: item.content_hash,
          url: `/api/ucg/media/by-hash/${item.content_hash}`,
          mimeType: item.mime_type,
          filename: item.original_filename,
          width: item.width,
          height: item.height,
          description: item.vision_description,
          position: item.position,
          referenceType: item.reference_type,
          caption: item.caption,
          altText: item.alt_text,
        }));
        res.json({ media: result, count: result.length });
        return;
      }

      // Fallback: Look up the node to get its folder from sourceMetadata
      const graphDb = getGraphDb();
      const node = graphDb.getNode(nodeId);

      if (node?.metadata.sourceMetadata?.folder) {
        const folderName = node.metadata.sourceMetadata.folder as string;
        const { getMediaForFolder } = await import('../services/MediaIndexer.js');
        const folderMedia = getMediaForFolder(folderName);

        // Deduplicate by hash (same content may have multiple filenames)
        const seenHashes = new Set<string>();
        const dedupedMedia = folderMedia.filter(item => {
          if (seenHashes.has(item.hash)) {
            return false;
          }
          seenHashes.add(item.hash);
          return true;
        });

        const result = dedupedMedia.map(item => ({
          hash: item.hash,
          url: item.url,
          mimeType: item.mimeType,
          filename: item.filename,
          width: null,
          height: null,
          description: null,
          position: null,
          referenceType: 'folder',
          caption: null,
          altText: null,
        }));

        res.json({ media: result, count: result.length });
        return;
      }

      // No media found
      res.json({ media: [], count: 0 });
    } catch (error) {
      console.error('[ucg] Get node media error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /media/by-hash/:hash - Serve media by content hash
   * Security: Requires auth, checks ownership via media_items table
   *
   * Serves media from either:
   * 1. Managed storage folder (~/.humanizer/media/) - for imported social media
   * 2. Archive folder (original location) - for ChatGPT media in conversation folders
   *
   * Files in managed storage are named {hash}{extension} (e.g., abc123.jpg).
   * Archive files are looked up via media_items table by content_hash.
   */
  router.get('/media/by-hash/:hash', requireAuth(), async (req: Request, res: Response) => {
    try {
      const hash = req.params.hash;
      const mediaStoragePath = getMediaStoragePath();
      const archiveRoot = getArchiveRoot();
      const userId = getUserId(req);

      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
        '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
        '.pdf': 'application/pdf', '.heic': 'image/heic', '.heif': 'image/heif',
        '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.webm': 'video/webm',
      };

      // Find file by hash (check common extensions)
      const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.mp3', '.m4a', '.pdf', '.heic', '.heif'];
      let filePath: string | null = null;
      let mimeType: string | null = null;

      // 1. First check managed storage (~/.humanizer/media/)
      for (const ext of extensions) {
        const candidatePath = path.join(mediaStoragePath, `${hash}${ext}`);
        if (existsSync(candidatePath)) {
          filePath = candidatePath;
          mimeType = mimeTypes[ext] || null;
          break;
        }
      }

      // 2. If not in managed storage, check media_items table for archive location
      if (!filePath) {
        try {
          const embDb = getEmbeddingDatabase();
          const db = embDb.getRawDb();
          const mediaItem = db.prepare(`
            SELECT file_path, mime_type, user_id FROM media_items WHERE content_hash = ?
          `).get(hash) as { file_path: string; mime_type: string | null; user_id: string | null } | undefined;

          if (mediaItem) {
            // Check ownership (NULL user_id = legacy data, allowed)
            if (!isOwner(req, mediaItem.user_id)) {
              res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
              return;
            }
            const archivePath = path.join(archiveRoot, mediaItem.file_path);
            if (existsSync(archivePath)) {
              filePath = archivePath;
              mimeType = mediaItem.mime_type;
            }
          }
        } catch (dbError) {
          console.warn('[ucg] Media by-hash DB lookup failed:', dbError);
        }
      }

      if (!filePath) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      // Security check - ensure path is within allowed directories
      const resolved = path.resolve(filePath);
      const isInManagedStorage = resolved.startsWith(path.resolve(mediaStoragePath));
      const isInArchive = resolved.startsWith(path.resolve(archiveRoot));

      if (!isInManagedStorage && !isInArchive) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (mimeType) {
        res.setHeader('Content-Type', mimeType);
      }

      // Set cache headers for media (1 year, immutable since hash-based)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      const stream = createReadStream(filePath);
      stream.pipe(res);
    } catch (error) {
      console.error('[ucg] Media by-hash error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /media/by-pointer - Resolve and serve media by original pointer (e.g., file-service://file-XXX)
   * Security: Requires auth, scopes search to user's content
   *
   * This endpoint resolves media references stored with their original file-service:// URLs
   * and serves the actual media file from the archive.
   */
  router.get('/media/by-pointer', requireAuth(), async (req: Request, res: Response) => {
    try {
      const pointer = req.query.pointer as string;
      if (!pointer) {
        res.status(400).json({ error: 'pointer query parameter required' });
        return;
      }

      const archiveRoot = getArchiveRoot();
      const userId = getUserId(req);
      let filePath: string | null = null;
      let mimeType: string | null = null;

      // Extract file ID from pointer (e.g., file-service://file-D2kZtW7yvKVROwd82pGsTZJU)
      const fileIdMatch = pointer.match(/file-service:\/\/file-([a-zA-Z0-9_-]+)/i);

      if (fileIdMatch) {
        const fileId = fileIdMatch[1];
        const filePrefix = `file-${fileId}`;

        // Search all conversation folders for a matching file
        const fs = await import('fs');
        const folders = fs.readdirSync(archiveRoot, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);

        for (const folder of folders) {
          const mediaDir = path.join(archiveRoot, folder, 'media');
          if (!existsSync(mediaDir)) continue;

          const files = fs.readdirSync(mediaDir);
          const matchingFile = files.find(f => f.startsWith(filePrefix));

          if (matchingFile) {
            filePath = path.join(mediaDir, matchingFile);
            // Determine MIME type from extension
            const ext = path.extname(matchingFile).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
              '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
              '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
              '.pdf': 'application/pdf', '.heic': 'image/heic', '.heif': 'image/heif',
            };
            mimeType = mimeTypes[ext] || null;
            break;
          }
        }
      }

      // Fallback: Try database lookup
      if (!filePath) {
        const embDb = getEmbeddingDatabase();
        const db = embDb.getRawDb();

        const mediaRef = db.prepare(`
          SELECT media_hash FROM media_references WHERE original_pointer = ?
        `).get(pointer) as { media_hash: string } | undefined;

        if (mediaRef) {
          const mediaItem = db.prepare(`
            SELECT file_path, mime_type FROM media_items WHERE content_hash = ?
          `).get(mediaRef.media_hash) as { file_path: string; mime_type: string | null } | undefined;

          if (mediaItem) {
            filePath = path.join(archiveRoot, mediaItem.file_path);
            mimeType = mediaItem.mime_type;
          }
        }
      }

      if (!filePath) {
        res.status(404).json({ error: 'Media file not found' });
        return;
      }

      // Security check - prevent path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(archiveRoot)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Check file exists
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'Media file not found on disk' });
        return;
      }

      // Set content type
      if (mimeType) {
        res.setHeader('Content-Type', mimeType);
      } else {
        // Fallback based on extension
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
          '.wav': 'audio/wav',
          '.mp3': 'audio/mpeg',
          '.m4a': 'audio/mp4',
          '.ogg': 'audio/ogg',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
        };
        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      }

      // Stream the file
      const stream = createReadStream(filePath);
      stream.pipe(res);
    } catch (error) {
      console.error('[ucg] Media by-pointer error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /media/find-folder - Find conversation folder by title search
   *
   * Searches for folders that match the given title query.
   * Returns the first matching folder name that has media.
   */
  router.get('/media/find-folder', async (req: Request, res: Response) => {
    try {
      const { title } = req.query;
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title query parameter required' });
        return;
      }

      const { getFoldersWithMedia } = await import('../services/MediaIndexer.js');
      const folders = getFoldersWithMedia();

      // Normalize search title
      const searchTitle = title.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special chars
        .replace(/\s+/g, '_'); // Replace spaces with underscores

      // Find matching folders
      const matches = folders.filter(folder => {
        const folderLower = folder.toLowerCase();
        // Check if folder contains the search title
        return folderLower.includes(searchTitle) ||
               searchTitle.includes(folderLower.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/_\d+$/, ''));
      });

      if (matches.length > 0) {
        res.json({ folder: matches[0], allMatches: matches.slice(0, 5) });
      } else {
        res.json({ folder: null, allMatches: [] });
      }
    } catch (error) {
      console.error('[ucg] Find folder error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /media/folder/:folderName - Get media for a conversation folder
   */
  router.get('/media/folder/:folderName', async (req: Request, res: Response) => {
    try {
      const { getMediaForFolder } = await import('../services/MediaIndexer.js');
      const folderName = decodeURIComponent(req.params.folderName);
      const media = getMediaForFolder(folderName);
      res.json({ media, count: media.length });
    } catch (error) {
      console.error('[ucg] Media for folder error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /media/stats - Get media indexing statistics
   */
  router.get('/media/stats', async (req: Request, res: Response) => {
    try {
      const { getMediaStats } = await import('../services/MediaIndexer.js');
      const stats = getMediaStats();
      res.json(stats);
    } catch (error) {
      console.error('[ucg] Media stats error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /media/index - Trigger media indexing job
   *
   * Scans all conversation folders and indexes media files into the database.
   * This creates media_items and media_references entries.
   */
  router.post('/media/index', async (req: Request, res: Response) => {
    try {
      const { indexAllMedia } = await import('../services/MediaIndexer.js');

      // Run indexing (this may take a while for large archives)
      console.log('[ucg] Starting media indexing...');
      const result = await indexAllMedia((progress) => {
        // Log progress
        console.log(`[ucg] Media indexing: ${progress.processedFolders}/${progress.totalFolders} folders`);
      });

      res.json({
        success: true,
        result: {
          totalFolders: result.totalFolders,
          processedFolders: result.processedFolders,
          totalMedia: result.totalMedia,
          indexedMedia: result.indexedMedia,
          errorCount: result.errors.length,
        },
      });
    } catch (error) {
      console.error('[ucg] Media indexing error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

/**
 * Create content graph routes (legacy function, uses db directly)
 * @deprecated Use createContentGraphRouter() instead
 */
export function createContentGraphRoutes(
  db: Database.Database,
  vecLoaded: boolean = false
): Router {
  // This is the legacy function that creates services directly
  // For new code, use createContentGraphRouter() which uses the service registry
  const router = Router();

  const graphDb = new ContentGraphDatabase(db, vecLoaded);
  graphDb.initialize();

  const linkGraph = new LinkGraph(db, graphDb);
  const versionControl = new VersionControl(db, graphDb);

  // Minimal implementation for backwards compatibility
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      res.json(graphDb.getStats());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Grade content quality (simplified SIC-style scoring)
 */
function gradeContent(text: string, queryTerms: string[]): {
  overall: number;
  specificity: number;
  coherence: number;
  substance: number;
} {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Specificity: How specific/detailed is the content?
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);
  const specificity = Math.min(5, 1 + avgSentenceLength / 10);

  // Coherence: Does it form complete thoughts?
  const hasProperSentences = sentences.length >= 2 && avgSentenceLength > 5;
  const coherence = hasProperSentences ? 4 : sentences.length >= 1 ? 3 : 2;

  // Substance: Is there real content?
  const urlCount = (text.match(/https?:\/\/\S+/g) || []).length;
  const urlRatio = urlCount / Math.max(words.length, 1);
  const hasSubstance = words.length >= 30 && urlRatio < 0.3;
  const substance = hasSubstance ? 4 : words.length >= 15 ? 3 : 2;

  // Query relevance bonus
  const lowerText = text.toLowerCase();
  const queryMatches = queryTerms.filter(term => lowerText.includes(term)).length;
  const relevanceBonus = (queryMatches / Math.max(queryTerms.length, 1)) * 0.5;

  // Overall score
  const overall = Math.min(5, (specificity + coherence + substance) / 3 + relevanceBonus);

  return {
    overall: Math.round(overall * 10) / 10,
    specificity: Math.round(specificity * 10) / 10,
    coherence: Math.round(coherence * 10) / 10,
    substance: Math.round(substance * 10) / 10,
  };
}

export default createContentGraphRouter;
