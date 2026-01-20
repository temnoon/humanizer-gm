/**
 * Harvest Routes - Smart Harvest API
 *
 * Endpoints:
 * POST /api/harvest           - Run smart harvest (SSE for progress)
 * GET  /api/harvest/preview   - Preview without committing
 * POST /api/harvest/expand/:id - Expand single breadcrumb
 */

import { Router, Request, Response } from 'express';
import { getHarvestService, type HarvestProgress, type HarvestOptions } from '../services/HarvestService';

export function createHarvestRouter(): Router {
  const router = Router();

  /**
   * POST /api/harvest
   * Run smart harvest with SSE progress
   */
  router.post('/', async (req: Request, res: Response) => {
    const {
      query,
      target,
      searchLimit,
      minWordCount,
      expandBreadcrumbs,
      contextSize,
      sources,
      types,
      prioritizeConversations,
      sse = true,
    } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Set up SSE if requested
    if (sse) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
    }

    try {
      const harvestService = getHarvestService();

      const sendProgress = (progress: HarvestProgress) => {
        if (sse) {
          res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
        }
      };

      const result = await harvestService.harvest(
        query,
        {
          target,
          searchLimit,
          minWordCount,
          expandBreadcrumbs,
          contextSize,
          sources,
          types,
          prioritizeConversations,
        },
        sendProgress
      );

      if (sse) {
        res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
        res.end();
      } else {
        res.json(result);
      }
    } catch (error) {
      console.error('[harvest] Harvest failed:', error);
      if (sse) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })}\n\n`);
        res.end();
      } else {
        res.status(500).json({
          error: 'Harvest failed',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  /**
   * GET /api/harvest/preview
   * Preview harvest results without committing
   */
  router.get('/preview', async (req: Request, res: Response) => {
    try {
      const query = req.query.query as string;
      const target = req.query.target ? parseInt(req.query.target as string, 10) : 10;

      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }

      const harvestService = getHarvestService();
      const result = await harvestService.harvest(query, {
        target,
        searchLimit: target * 3, // Search more to ensure quality
      });

      res.json({
        query,
        preview: true,
        results: result.results.slice(0, target),
        stats: result.stats,
      });
    } catch (error) {
      console.error('[harvest] Preview failed:', error);
      res.status(500).json({
        error: 'Preview failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/harvest/expand/:id
   * Expand a single breadcrumb by ID
   */
  router.post('/expand/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { contextSize = 2 } = req.body;

      // This would need to fetch the original result and expand it
      // For now, return a not implemented response
      res.status(501).json({
        error: 'Not implemented',
        message: 'Use the full harvest endpoint with expandBreadcrumbs: true',
      });
    } catch (error) {
      console.error('[harvest] Expand failed:', error);
      res.status(500).json({
        error: 'Expand failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/harvest/config
   * Get current harvest configuration
   */
  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const { configService } = await import('../services/ConfigService');
      await configService.init();
      const harvestConfig = configService.getSection('harvest');
      res.json(harvestConfig);
    } catch (error) {
      console.error('[harvest] Config failed:', error);
      res.status(500).json({
        error: 'Failed to get harvest config',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
