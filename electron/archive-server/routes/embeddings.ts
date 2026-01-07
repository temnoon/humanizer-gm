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
import { ArchiveIndexer, type IndexingOptions } from '../services/embeddings/ArchiveIndexer';
import type { IndexingProgress } from '../services/embeddings/types';

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING MODULE (uses ESM loader workaround)
// ═══════════════════════════════════════════════════════════════════

import * as embeddingModule from '../services/embeddings/esm-loader';

// ═══════════════════════════════════════════════════════════════════
// SERVICE INSTANCES (lazy-loaded per archive)
// ═══════════════════════════════════════════════════════════════════

let embeddingDb: EmbeddingDatabase | null = null;
let currentArchivePath: string | null = null;
let activeIndexer: ArchiveIndexer | null = null;
let indexingProgress: IndexingProgress | null = null;

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

function getOrCreateIndexer(): ArchiveIndexer {
  const archivePath = getArchiveRoot();

  if (!activeIndexer || currentArchivePath !== archivePath) {
    activeIndexer = new ArchiveIndexer(archivePath);
    currentArchivePath = archivePath;
  }

  return activeIndexer;
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
  router.post('/build', async (req: Request, res: Response) => {
    try {
      // Check if already indexing
      if (indexingProgress?.status === 'indexing') {
        res.status(409).json({
          status: 'already_running',
          message: 'Indexing is already in progress',
          progress: indexingProgress,
        });
        return;
      }

      const { includeParagraphs = false, includeSentences = false, useContentAwareChunking = false, batchSize = 32 } = req.body || {};

      const archivePath = getArchiveRoot();
      const indexer = getOrCreateIndexer();

      // Set initial progress
      indexingProgress = {
        status: 'indexing',
        phase: 'starting',
        current: 0,
        total: 0,
        startedAt: Date.now(),
      };

      // Respond immediately, indexing happens in background
      res.json({
        status: 'started',
        message: 'Embedding index build started',
        archivePath,
      });

      // Run indexing in background
      const options: IndexingOptions = {
        includeParagraphs,
        includeSentences,
        useContentAwareChunking,
        batchSize,
        onProgress: (progress) => {
          indexingProgress = progress;
          console.log(`[embeddings] Progress: ${progress.phase} ${progress.current}/${progress.total}`);
        },
      };

      indexer.buildIndex(options)
        .then(() => {
          console.log('[embeddings] Index build complete');
        })
        .catch((err) => {
          console.error('[embeddings] Index build failed:', err);
          indexingProgress = {
            status: 'error',
            phase: 'failed',
            current: 0,
            total: 0,
            error: err instanceof Error ? err.message : String(err),
          };
        });

    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Archive health check - what's missing?
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDb();
      const stats = db.getStats();

      let modelLoaded = false;
      let ollamaAvailable = false;

      try {
        // Check if Ollama is running
        const ollamaCheck = await fetch('http://localhost:11434/api/tags');
        ollamaAvailable = ollamaCheck.ok;
        modelLoaded = embeddingModule.isInitialized();
      } catch {
        // Ollama not running
      }

      // Determine readiness
      const hasConversations = stats.conversationCount > 0;
      const hasEmbeddings = stats.messageCount > 0;
      const embeddingCoverage = hasConversations && hasEmbeddings
        ? Math.round((stats.messageCount / Math.max(1, stats.conversationCount * 10)) * 100)
        : 0;

      const issues: string[] = [];
      const actions: Array<{ action: string; endpoint: string; method: string }> = [];

      if (!ollamaAvailable) {
        issues.push('Ollama not running - start with: ollama serve');
      } else if (!modelLoaded) {
        issues.push('Embedding model not loaded - will auto-load on first search');
      }

      if (!hasConversations) {
        issues.push('No conversations imported - import an archive first');
      } else if (!hasEmbeddings) {
        issues.push('No embeddings generated - semantic search unavailable');
        actions.push({
          action: 'Build embeddings index',
          endpoint: '/api/embeddings/build',
          method: 'POST',
        });
      } else if (embeddingCoverage < 80) {
        issues.push(`Only ${embeddingCoverage}% of content has embeddings`);
        actions.push({
          action: 'Rebuild embeddings index',
          endpoint: '/api/embeddings/build',
          method: 'POST',
        });
      }

      const ready = issues.length === 0 || (ollamaAvailable && hasEmbeddings);

      res.json({
        ready,
        archivePath: getArchiveRoot(),
        stats: {
          conversations: stats.conversationCount,
          messages: stats.messageCount,
          chunks: stats.chunkCount,
          clusters: stats.clusterCount,
          anchors: stats.anchorCount,
        },
        services: {
          ollama: ollamaAvailable,
          modelLoaded,
          indexing: indexingProgress?.status === 'indexing',
        },
        issues,
        actions,
        indexingProgress: indexingProgress || null,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get indexing status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const modelLoaded = embeddingModule.isInitialized();
      const progress = indexingProgress || {
        status: 'idle',
        phase: '',
        current: 0,
        total: 0,
      };

      res.json({
        isIndexing: progress.status === 'indexing',
        status: progress.status,
        phase: progress.phase,
        progress: progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0,
        current: progress.current,
        total: progress.total,
        currentItem: progress.currentItem,
        error: progress.error,
        startedAt: progress.startedAt,
        completedAt: progress.completedAt,
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

      // Search (role filter is applied in the query for efficiency)
      const db = getEmbeddingDb();
      const results = db.searchMessages(queryEmbedding, limit, role);

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

  // Search pyramid chunks with content-type filtering (Phase 5)
  router.post('/search/chunks', async (req: Request, res: Response) => {
    try {
      const { query, limit = 20, contentTypes } = req.body;

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

      // Search pyramid chunks with optional content type filter
      const db = getEmbeddingDb();
      const results = db.searchPyramidChunks(
        queryEmbedding,
        limit,
        contentTypes // array like ['code', 'math'] or undefined for all
      );

      res.json({
        query,
        results,
        total: results.length,
        contentTypes: contentTypes || ['all'],
      });
    } catch (err) {
      console.error('[embeddings] Chunk search error:', err);
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

  // ─────────────────────────────────────────────────────────────────
  // IMAGE DESCRIPTION EMBEDDINGS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Embed an image description for semantic search.
   * Called by QueueManager after image analysis or for backfill.
   *
   * POST /api/embeddings/embed-image-description
   * Body: { filePath: string, description: string }
   */
  router.post('/embed-image-description', async (req: Request, res: Response) => {
    try {
      const { filePath, description } = req.body;

      if (!filePath || !description) {
        res.status(400).json({ error: 'filePath and description required' });
        return;
      }

      const db = getEmbeddingDb();

      // Find the image analysis record
      const analysis = db.getImageAnalysisByPath(filePath);
      if (!analysis) {
        res.status(404).json({ error: 'Image analysis not found for path' });
        return;
      }

      // Initialize embedding model if needed
      if (!embeddingModule.isInitialized()) {
        await embeddingModule.initializeEmbedding();
      }

      // Generate embedding for the description
      const descEmbedding = await embeddingModule.embed(description);

      // Store the embedding
      db.insertImageDescriptionEmbedding({
        id: crypto.randomUUID(),
        imageAnalysisId: analysis.id,
        text: description,
        embedding: descEmbedding,
      });

      res.json({
        success: true,
        imageAnalysisId: analysis.id,
        embeddingDimensions: descEmbedding.length,
      });
    } catch (err) {
      console.error('[embeddings] Image description embedding error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Get stats on image description embeddings
   */
  router.get('/image-description-stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDb();
      const embeddingCount = db.getImageDescriptionEmbeddingCount();
      const needsEmbedding = db.getImageAnalysesWithoutDescriptionEmbeddings(1000);

      res.json({
        totalEmbeddings: embeddingCount,
        needsEmbedding: needsEmbedding.length,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
