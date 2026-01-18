/**
 * Content Graph API Routes
 *
 * REST API endpoints for Universal Content Graph operations.
 */

import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { ContentGraphDatabase } from '../services/content-graph/ContentGraphDatabase.js';
import { LinkGraph } from '../services/content-graph/LinkGraph.js';
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
   */
  router.get('/nodes/:id', (req: Request, res: Response) => {
    try {
      const node = getGraphDb().getNode(req.params.id);
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
   * GET /nodes/by-uri - Get a node by URI
   */
  router.get('/nodes/by-uri', (req: Request, res: Response) => {
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
      res.json(node);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /nodes/query - Query nodes with filters
   */
  router.post('/nodes/query', (req: Request, res: Response) => {
    try {
      const query: ContentNodeQuery = req.body;
      const nodes = getGraphDb().queryNodes(query);
      res.json(nodes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /nodes/search - Full-text search for nodes
   */
  router.get('/nodes/search', (req: Request, res: Response) => {
    try {
      const q = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 50;

      if (!q) {
        res.status(400).json({ error: 'Query parameter required' });
        return;
      }

      const nodes = getGraphDb().searchNodes(q, limit);
      res.json(nodes);
    } catch (error) {
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
   */
  router.post('/search/semantic', async (req: Request, res: Response) => {
    try {
      const { query, limit = 20, threshold = 0.5, includeParent = true } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      // Initialize embedding model
      await initializeEmbedding();

      // Generate query embedding
      const queryEmbedding = await embed(query);

      // Search UCG content nodes
      const graphDb = getGraphDb();
      const results = graphDb.searchByEmbedding(queryEmbedding, limit, threshold);

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

export default createContentGraphRouter;
