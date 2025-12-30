/**
 * Embeddings Router - Semantic search and clustering
 *
 * Routes:
 * - POST /api/embeddings/build - Start indexing
 * - GET /api/embeddings/status - Get indexing status
 * - GET /api/embeddings/stats - Get embedding stats
 * - POST /api/embeddings/search/messages - Semantic search
 * - POST /api/embeddings/search/similar - Find similar messages
 * - POST /api/clustering/discover - Discover clusters
 * - GET /api/clustering/stats - Clustering statistics
 * - POST /api/anchors/create - Create semantic anchor
 * - GET /api/anchors - List anchors
 */

import { Router, Request, Response } from 'express';
import { getArchiveRoot } from '../config';
import { EmbeddingDatabase } from '../services/embeddings/EmbeddingDatabase';

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING MODULE (uses ESM loader workaround)
// ═══════════════════════════════════════════════════════════════════

import * as embeddingModule from '../services/embeddings/esm-loader';

// ═══════════════════════════════════════════════════════════════════
// SERVICE INSTANCES (lazy-loaded per archive)
// ═══════════════════════════════════════════════════════════════════

let embeddingDb: EmbeddingDatabase | null = null;
let currentArchivePath: string | null = null;

function getEmbeddingDb(): EmbeddingDatabase {
  const archivePath = getArchiveRoot();

  // Reinitialize if archive path changed
  if (currentArchivePath !== archivePath) {
    embeddingDb = null;
    currentArchivePath = archivePath;
  }

  if (!embeddingDb) {
    embeddingDb = new EmbeddingDatabase(archivePath);
  }

  return embeddingDb;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createEmbeddingsRouter(): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────
  // INDEX BUILDING
  // ─────────────────────────────────────────────────────────────────

  // Build embeddings index
  router.post('/build', async (_req: Request, res: Response) => {
    // TODO: Implement with ArchiveIndexer once ESM loading is fully resolved
    res.json({
      status: 'pending',
      message: 'Index building will be available in a future update. Existing embeddings can be searched.',
      archivePath: getArchiveRoot(),
    });
  });

  // Get indexing status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const modelLoaded = embeddingModule.isInitialized();

      res.json({
        isIndexing: false,
        status: 'idle',
        phase: '',
        progress: 0,
        current: 0,
        total: 0,
        modelLoaded,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get embedding stats
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDb();
      const stats = db.getStats();

      let modelLoaded = false;
      try {
        
        modelLoaded = embeddingModule.isInitialized();
      } catch {
        // Model not loaded yet
      }

      res.json({
        totalEmbeddings: stats.messageCount + stats.chunkCount,
        totalConversations: stats.conversationCount,
        totalMessages: stats.messageCount,
        totalChunks: stats.chunkCount,
        totalClusters: stats.clusterCount,
        totalAnchors: stats.anchorCount,
        modelLoaded,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SEMANTIC SEARCH
  // ─────────────────────────────────────────────────────────────────

  // Semantic search
  router.post('/search/messages', async (req: Request, res: Response) => {
    try {
      const { query, limit = 20, role } = req.body;

      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      

      // Initialize embedding model if needed
      if (!embeddingModule.isInitialized()) {
        await embeddingModule.initializeEmbedding();
      }

      // Generate query embedding
      const queryEmbedding = await embeddingModule.embed(query);

      // Search
      const db = getEmbeddingDb();
      let results = db.searchMessages(queryEmbedding, limit);

      // Filter by role if specified
      if (role) {
        results = results.filter(r => r.metadata?.role === role);
      }

      res.json({
        query,
        results,
        total: results.length,
      });
    } catch (err) {
      console.error('[embeddings] Search error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Find similar messages
  router.post('/search/similar', async (req: Request, res: Response) => {
    try {
      const { messageId, embeddingId, limit = 10, excludeSameConversation = false } = req.body;

      if (!messageId && !embeddingId) {
        res.status(400).json({ error: 'messageId or embeddingId required' });
        return;
      }

      const db = getEmbeddingDb();
      const results = db.findSimilarToMessage(
        embeddingId || messageId,
        limit,
        excludeSameConversation
      );

      res.json({
        messageId: messageId || embeddingId,
        results,
        total: results.length,
      });
    } catch (err) {
      console.error('[embeddings] Similar search error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // CLUSTERING
  // ─────────────────────────────────────────────────────────────────

  router.post('/clustering/discover', async (req: Request, res: Response) => {
    try {
      

      // Initialize embedding model if needed
      if (!embeddingModule.isInitialized()) {
        await embeddingModule.initializeEmbedding();
      }

      const db = getEmbeddingDb();
      const clusters = db.getAllClusters();

      res.json({
        clusters,
        message: clusters.length > 0
          ? `Found ${clusters.length} clusters`
          : 'No clusters found. Build embeddings first, then clusters will be discovered.',
      });
    } catch (err) {
      console.error('[embeddings] Clustering error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/clustering/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDb();
      const clusters = db.getAllClusters();

      const totalMembers = clusters.reduce((sum, c) => sum + (c.memberCount || 0), 0);

      res.json({
        totalClusters: clusters.length,
        totalMembers,
        avgClusterSize: clusters.length > 0 ? Math.round(totalMembers / clusters.length) : 0,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // ANCHORS
  // ─────────────────────────────────────────────────────────────────

  router.post('/anchors/create', async (req: Request, res: Response) => {
    try {
      const { name, description, messageIds, anchorType = 'anchor' } = req.body;

      if (!name || !messageIds?.length) {
        res.status(400).json({ error: 'name and messageIds required' });
        return;
      }

      // Validate anchor type
      const validTypes = ['anchor', 'anti_anchor'];
      if (!validTypes.includes(anchorType)) {
        res.status(400).json({ error: 'anchorType must be "anchor" or "anti_anchor"' });
        return;
      }

      
      const db = getEmbeddingDb();

      // Get embeddings for the messages
      const embeddingMap = db.getEmbeddings('messages', messageIds);

      if (embeddingMap.size === 0) {
        res.status(400).json({ error: 'No embeddings found for the provided messageIds' });
        return;
      }

      // Compute centroid embedding from all message embeddings
      const embeddingVectors = Array.from(embeddingMap.values());
      const centroid = embeddingModule.computeCentroid(embeddingVectors);

      // Create anchor with computed centroid
      const anchorId = db.insertAnchor({
        name,
        description,
        anchorType: anchorType as 'anchor' | 'anti_anchor',
        embedding: centroid,
        sourceEmbeddingIds: messageIds,
      });

      const anchor = db.getAnchor(anchorId);

      res.json({
        success: true,
        anchor,
      });
    } catch (err) {
      console.error('[embeddings] Anchor creation error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/anchors', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDb();
      const anchors = db.getAllAnchors();

      res.json({
        anchors,
        total: anchors.length,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
