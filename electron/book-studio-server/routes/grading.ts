/**
 * Grading Routes - Card Grading API
 *
 * Endpoints:
 * POST /api/grading/cards/:id/grade          - Trigger full grading for single card
 * POST /api/grading/cards/:id/grade/quick    - Quick grade only
 * POST /api/grading/books/:id/grade-all      - Queue all cards for grading
 * GET  /api/grading/queue                    - Get queue status
 * GET  /api/grading/queue/:bookId            - Get queue for specific book
 * DELETE /api/grading/queue                  - Clear queue
 * DELETE /api/grading/queue/:bookId          - Clear queue for book
 * POST /api/grading/queue/retry              - Retry failed items
 * POST /api/grading/queue/retry/:bookId      - Retry failed for book
 * POST /api/grading/worker/start             - Start background worker
 * POST /api/grading/worker/stop              - Stop background worker
 * GET  /api/grading/worker/status            - Get worker status
 */

import { Router, Request, Response } from 'express';
import { getDatabase, type DbCard } from '../database';
import { getGradingService } from '../services/GradingService';
import { getGradingQueueService } from '../services/GradingQueueService';
import { broadcastEvent } from '../server';

export function createGradingRouter(): Router {
  const router = Router();
  const db = getDatabase();

  /**
   * POST /api/grading/cards/:id/grade
   * Trigger full grading for a single card
   */
  router.post('/cards/:id/grade', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { immediate = false } = req.body;

      // Get card from database
      const card = db.prepare(`
        SELECT id, content, source_type, author_name, book_id
        FROM cards WHERE id = ?
      `).get(id) as { id: string; content: string; source_type: string; author_name: string | null; book_id: string } | undefined;

      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }

      if (immediate) {
        // Grade immediately (synchronous)
        const gradingService = getGradingService();
        const grade = await gradingService.fullGrade({
          id: card.id,
          content: card.content,
          sourceType: card.source_type,
          authorName: card.author_name || undefined,
        });

        // Update card with grade
        const now = Math.floor(Date.now() / 1000);
        db.prepare(`
          UPDATE cards SET grade = ?, updated_at = ? WHERE id = ?
        `).run(JSON.stringify(grade), now, id);

        // Broadcast event
        broadcastEvent({
          type: 'card:graded',
          bookId: card.book_id,
          entityType: 'card',
          entityId: id,
          payload: { grade },
          timestamp: Date.now(),
        });

        return res.json({
          cardId: id,
          grade,
          queued: false,
        });
      } else {
        // Add to queue
        const queueService = getGradingQueueService();
        queueService.enqueue(card.book_id, id, 5); // High priority for manual trigger

        return res.json({
          cardId: id,
          queued: true,
          message: 'Card added to grading queue',
        });
      }
    } catch (error) {
      console.error('[grading] Full grade failed:', error);
      res.status(500).json({
        error: 'Grading failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/cards/:id/grade/quick
   * Quick grade only (no API calls)
   */
  router.post('/cards/:id/grade/quick', (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Get card from database
      const card = db.prepare(`
        SELECT id, content, source_type, author_name, book_id
        FROM cards WHERE id = ?
      `).get(id) as { id: string; content: string; source_type: string; author_name: string | null; book_id: string } | undefined;

      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }

      const gradingService = getGradingService();
      const grade = gradingService.quickGrade({
        id: card.id,
        content: card.content,
        sourceType: card.source_type,
        authorName: card.author_name || undefined,
      });

      // Update card with quick grade
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        UPDATE cards SET grade = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(grade), now, id);

      // Broadcast event
      broadcastEvent({
        type: 'card:graded',
        bookId: card.book_id,
        entityType: 'card',
        entityId: id,
        payload: { grade, quick: true },
        timestamp: Date.now(),
      });

      res.json({
        cardId: id,
        grade,
        quick: true,
      });
    } catch (error) {
      console.error('[grading] Quick grade failed:', error);
      res.status(500).json({
        error: 'Quick grading failed',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/books/:id/grade-all
   * Queue all cards in a book for grading
   */
  router.post('/books/:id/grade-all', (req: Request, res: Response) => {
    try {
      const { id: bookId } = req.params;
      const { status, priority = 1 } = req.body;

      // Get cards to grade
      let query = 'SELECT id FROM cards WHERE book_id = ?';
      const params: (string | number)[] = [bookId];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      const cards = db.prepare(query).all(...params) as Array<{ id: string }>;

      if (cards.length === 0) {
        return res.json({
          bookId,
          queued: 0,
          message: 'No cards to grade',
        });
      }

      // Enqueue all cards
      const queueService = getGradingQueueService();
      const enqueued = queueService.enqueueBatch(
        cards.map(c => ({ bookId, cardId: c.id, priority }))
      );

      // Ensure worker is running
      if (!queueService.isWorkerRunning()) {
        queueService.startWorker();
      }

      res.json({
        bookId,
        queued: enqueued,
        total: cards.length,
        message: `${enqueued} cards added to grading queue`,
      });
    } catch (error) {
      console.error('[grading] Grade-all failed:', error);
      res.status(500).json({
        error: 'Failed to queue cards',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/grading/queue
   * Get overall queue status
   */
  router.get('/queue', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();
      const status = queueService.getStatus();
      const workerRunning = queueService.isWorkerRunning();

      res.json({
        ...status,
        workerRunning,
      });
    } catch (error) {
      console.error('[grading] Queue status failed:', error);
      res.status(500).json({
        error: 'Failed to get queue status',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/grading/queue/:bookId
   * Get queue status for specific book
   */
  router.get('/queue/:bookId', (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const queueService = getGradingQueueService();
      const status = queueService.getStatus(bookId);
      const items = queueService.getQueueItems(bookId);

      res.json({
        bookId,
        ...status,
        items,
      });
    } catch (error) {
      console.error('[grading] Book queue status failed:', error);
      res.status(500).json({
        error: 'Failed to get book queue status',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/grading/queue
   * Clear the entire queue
   */
  router.delete('/queue', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();
      const cleared = queueService.clear();

      res.json({
        cleared,
        message: `Cleared ${cleared} items from queue`,
      });
    } catch (error) {
      console.error('[grading] Queue clear failed:', error);
      res.status(500).json({
        error: 'Failed to clear queue',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * DELETE /api/grading/queue/:bookId
   * Clear queue for specific book
   */
  router.delete('/queue/:bookId', (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const queueService = getGradingQueueService();
      const cleared = queueService.clear(bookId);

      res.json({
        bookId,
        cleared,
        message: `Cleared ${cleared} items from queue`,
      });
    } catch (error) {
      console.error('[grading] Book queue clear failed:', error);
      res.status(500).json({
        error: 'Failed to clear book queue',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/queue/retry
   * Retry all failed items
   */
  router.post('/queue/retry', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();
      const retried = queueService.retryFailed();

      res.json({
        retried,
        message: `${retried} failed items moved back to pending`,
      });
    } catch (error) {
      console.error('[grading] Queue retry failed:', error);
      res.status(500).json({
        error: 'Failed to retry failed items',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/queue/retry/:bookId
   * Retry failed items for specific book
   */
  router.post('/queue/retry/:bookId', (req: Request, res: Response) => {
    try {
      const { bookId } = req.params;
      const queueService = getGradingQueueService();
      const retried = queueService.retryFailed(bookId);

      res.json({
        bookId,
        retried,
        message: `${retried} failed items moved back to pending`,
      });
    } catch (error) {
      console.error('[grading] Book queue retry failed:', error);
      res.status(500).json({
        error: 'Failed to retry failed items',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/worker/start
   * Start background worker
   */
  router.post('/worker/start', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();

      if (queueService.isWorkerRunning()) {
        return res.json({
          running: true,
          message: 'Worker already running',
        });
      }

      queueService.startWorker();

      res.json({
        running: true,
        message: 'Worker started',
      });
    } catch (error) {
      console.error('[grading] Worker start failed:', error);
      res.status(500).json({
        error: 'Failed to start worker',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /api/grading/worker/stop
   * Stop background worker
   */
  router.post('/worker/stop', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();
      queueService.stopWorker();

      res.json({
        running: false,
        message: 'Worker stopped',
      });
    } catch (error) {
      console.error('[grading] Worker stop failed:', error);
      res.status(500).json({
        error: 'Failed to stop worker',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * GET /api/grading/worker/status
   * Get worker status
   */
  router.get('/worker/status', (_req: Request, res: Response) => {
    try {
      const queueService = getGradingQueueService();
      const running = queueService.isWorkerRunning();
      const status = queueService.getStatus();

      res.json({
        running,
        queueStatus: status,
      });
    } catch (error) {
      console.error('[grading] Worker status failed:', error);
      res.status(500).json({
        error: 'Failed to get worker status',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
