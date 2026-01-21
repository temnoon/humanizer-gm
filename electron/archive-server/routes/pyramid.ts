/**
 * Pyramid Routes - Hierarchical Embedding Pyramid API
 *
 * Endpoints:
 * POST /api/pyramid/build/:threadId   - Build pyramid for single item
 * POST /api/pyramid/build-batch       - Build for all unembedded (SSE progress)
 * GET  /api/pyramid/stats             - Get pyramid statistics
 * POST /api/pyramid/search            - Search across pyramid levels
 * DELETE /api/pyramid/:threadId       - Delete pyramid for thread
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../services/registry';
import { getPyramidService } from '../services/embeddings/PyramidService';
import { configService } from '../services/ConfigService';

export function createPyramidRouter(): Router {
  const router = Router();

  /**
   * POST /api/pyramid/build/:threadId
   * Build pyramid for a single content item
   */
  router.post('/build/:threadId', async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const { threadType, content, skipSummaries, skipApex } = req.body;

      if (!threadId) {
        return res.status(400).json({ error: 'Thread ID is required' });
      }

      const embDb = getEmbeddingDatabase();
      const db = embDb.getDatabase();
      const pyramidService = getPyramidService(db);

      // If content not provided, try to fetch from database
      let contentToProcess = content;
      let typeToUse = threadType;

      if (!contentToProcess) {
        // Try content_items
        const item = embDb.getContentItem(threadId);
        if (item && typeof item.text === 'string') {
          contentToProcess = item.text;
          typeToUse = typeToUse || item.type;
        } else {
          // Try conversations/messages
          const conversation = embDb.getConversation(threadId);
          if (conversation) {
            const messages = embDb.getMessagesForConversation(threadId);
            contentToProcess = messages
              .map(m => `${m.role}: ${m.content}`)
              .join('\n\n');
            typeToUse = 'conversation';
          }
        }
      }

      if (!contentToProcess) {
        return res.status(404).json({
          error: 'Content not found for thread ID',
          threadId,
        });
      }

      const result = await pyramidService.buildPyramid(
        threadId,
        typeToUse || 'document',
        contentToProcess,
        {
          skipSummaries: skipSummaries === true,
          skipApex: skipApex === true,
        }
      );

      res.json({
        success: true,
        threadId,
        stats: result.stats,
        chunksCreated: result.chunks.length,
        summariesCreated: result.summaries.length,
        hasApex: result.apex !== null,
      });
    } catch (error) {
      console.error('[pyramid] Build failed:', error);
      res.status(500).json({
        error: 'Failed to build pyramid',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/pyramid/build-batch
   * Build pyramids for all unembedded content (SSE for progress)
   */
  router.post('/build-batch', async (req: Request, res: Response) => {
    const { sse = true } = req.body;

    // Set up SSE if requested
    if (sse) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }

    try {
      const embDb = getEmbeddingDatabase();
      const db = embDb.getDatabase();
      const pyramidService = getPyramidService(db);

      const sendProgress = (data: object) => {
        if (sse) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      sendProgress({ phase: 'starting', message: 'Finding unembedded content...' });

      const result = await pyramidService.buildPyramidsForUnembedded(
        (completed, total, currentId) => {
          sendProgress({
            phase: 'processing',
            completed,
            total,
            currentId,
            progress: total > 0 ? completed / total : 0,
          });
        }
      );

      sendProgress({
        phase: 'complete',
        result: {
          processed: result.processed,
          total: result.total,
          errors: result.errors,
          threadsProcessed: result.threads.length,
        },
      });

      if (sse) {
        res.end();
      } else {
        res.json(result);
      }
    } catch (error) {
      console.error('[pyramid] Batch build failed:', error);
      if (sse) {
        res.write(`data: ${JSON.stringify({
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          error: 'Batch build failed',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  /**
   * GET /api/pyramid/stats
   * Get pyramid statistics
   */
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const embDb = getEmbeddingDatabase();
      const db = embDb.getDatabase();
      const pyramidService = getPyramidService(db);

      const stats = pyramidService.getStats();
      res.json(stats);
    } catch (error) {
      console.error('[pyramid] Stats failed:', error);
      res.status(500).json({
        error: 'Failed to get pyramid stats',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/pyramid/search
   * Search across pyramid levels
   */
  router.post('/search', async (req: Request, res: Response) => {
    try {
      await configService.init();
      const harvestConfig = configService.getSection('harvest');
      const { query, levels, threadTypes } = req.body;
      const limit = req.body.limit ?? harvestConfig.defaultTarget;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query is required' });
      }

      const embDb = getEmbeddingDatabase();
      const db = embDb.getDatabase();
      const pyramidService = getPyramidService(db);

      const results = await pyramidService.searchPyramid(query, {
        limit,
        levels,
        threadTypes,
      });

      res.json({
        query,
        results,
        total: results.length,
      });
    } catch (error) {
      console.error('[pyramid] Search failed:', error);
      res.status(500).json({
        error: 'Pyramid search failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/pyramid/:threadId
   * Delete pyramid data for a thread
   */
  router.delete('/:threadId', (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;

      if (!threadId) {
        return res.status(400).json({ error: 'Thread ID is required' });
      }

      const embDb = getEmbeddingDatabase();
      const db = embDb.getDatabase();
      const pyramidService = getPyramidService(db);

      pyramidService.deletePyramid(threadId);

      res.json({
        success: true,
        threadId,
        message: 'Pyramid deleted',
      });
    } catch (error) {
      console.error('[pyramid] Delete failed:', error);
      res.status(500).json({
        error: 'Failed to delete pyramid',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
