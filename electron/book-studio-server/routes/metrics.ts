/**
 * Metrics API Routes
 *
 * Endpoints for computing and retrieving book-making quality metrics.
 */

import { Router, Request, Response } from 'express';
import { getMetricsService } from '../services/MetricsService';
import { requireAuth } from '../middleware/auth';

export function createMetricsRouter(): Router {
  const router = Router();
  const metricsService = getMetricsService();

  /**
   * GET /api/metrics/:bookId
   * Get latest metrics for a book
   */
  router.get('/:bookId', requireAuth(), (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;

      const metrics = metricsService.get(bookId);

      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: 'No metrics found for this book',
          message: 'Run POST /api/metrics/:bookId/compute first',
        });
      }

      return res.json({
        success: true,
        metrics,
      });
    } catch (error) {
      console.error('[metrics] Get metrics failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get metrics',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/metrics/:bookId/compute
   * Compute and save fresh metrics for a book
   */
  router.post('/:bookId/compute', requireAuth(), (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const user = (req as Request & { user?: { id: string } }).user;

      const metrics = metricsService.compute(bookId, user?.id);

      return res.json({
        success: true,
        metrics,
      });
    } catch (error) {
      console.error('[metrics] Compute metrics failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to compute metrics',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/metrics/:bookId/summary
   * Get a compact summary suitable for UI display
   */
  router.get('/:bookId/summary', requireAuth(), (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;

      const metrics = metricsService.get(bookId);

      if (!metrics) {
        return res.json({
          success: true,
          summary: {
            overallScore: 0,
            readinessLevel: 'harvesting',
            cardCount: 0,
            chapterCount: 0,
            wordCount: 0,
          },
        });
      }

      return res.json({
        success: true,
        summary: {
          overallScore: metrics.overallScore,
          readinessLevel: metrics.readinessLevel,
          cardCount: metrics.harvest.cardCount,
          avgGrade: metrics.harvest.avgGrade,
          themeCount: metrics.research?.themeCount || 0,
          clusterCount: metrics.clustering?.clusterCount || 0,
          sectionCount: metrics.outline?.sectionCount || 0,
          assignedPercent: metrics.assignment.assignedPercent,
          chapterCount: metrics.draft.chapterCount,
          wordCount: metrics.draft.totalWordCount,
          chaptersComplete: metrics.draft.chaptersWithDraft,
        },
      });
    } catch (error) {
      console.error('[metrics] Get summary failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
