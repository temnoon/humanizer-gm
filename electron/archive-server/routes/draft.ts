/**
 * Draft Routes - HTTP API for Draft Generation
 *
 * Exposes the DraftGeneratorService via HTTP for testing and direct API access.
 * All business logic lives in the service; these routes are thin wrappers.
 *
 * Routes:
 * - POST /api/draft/start - Start draft generation
 * - POST /api/draft/pause/:jobId - Pause a job
 * - POST /api/draft/resume/:jobId - Resume a job
 * - GET /api/draft/status/:jobId - Get job status
 * - GET /api/draft/jobs - List all jobs
 * - GET /api/draft/events/:jobId - SSE stream for job events
 */

import { Router, Request, Response } from 'express';
import { getDraftGenerator } from '../../services/draft-generator.js';
import { getArchiveRoot } from '../config.js';

export function createDraftRouter(): Router {
  const router = Router();

  // Lazy initialization of draft generator
  const getService = () => {
    const archivePath = getArchiveRoot();
    return getDraftGenerator(archivePath);
  };

  // ─────────────────────────────────────────────────────────────────
  // POST /start - Start draft generation
  // ─────────────────────────────────────────────────────────────────
  router.post('/start', async (req: Request, res: Response) => {
    try {
      const { bookUri, chapterId, arcId, style } = req.body;

      if (!bookUri) {
        return res.status(400).json({ success: false, error: 'bookUri required' });
      }
      if (!chapterId) {
        return res.status(400).json({ success: false, error: 'chapterId required' });
      }

      const service = getService();
      const result = await service.startGeneration({
        bookUri,
        chapterId,
        arcId,
        style: style || 'academic',
      });

      res.json(result);
    } catch (err) {
      console.error('[draft] Start error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /pause/:jobId - Pause a job
  // ─────────────────────────────────────────────────────────────────
  router.post('/pause/:jobId', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const service = getService();
      const result = await service.pause(jobId);
      res.json(result);
    } catch (err) {
      console.error('[draft] Pause error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /resume/:jobId - Resume a paused job
  // ─────────────────────────────────────────────────────────────────
  router.post('/resume/:jobId', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const service = getService();
      const result = await service.resume(jobId);
      res.json(result);
    } catch (err) {
      console.error('[draft] Resume error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /status/:jobId - Get job status and progress
  // ─────────────────────────────────────────────────────────────────
  router.get('/status/:jobId', (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const service = getService();
      const result = service.getStatus(jobId);
      res.json(result);
    } catch (err) {
      console.error('[draft] Status error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /jobs - List all jobs
  // ─────────────────────────────────────────────────────────────────
  router.get('/jobs', (req: Request, res: Response) => {
    try {
      const service = getService();
      const jobs = service.listJobs();
      res.json({
        success: true,
        jobs,
        count: jobs.length,
      });
    } catch (err) {
      console.error('[draft] List error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /events/:jobId - SSE stream for real-time events
  // ─────────────────────────────────────────────────────────────────
  router.get('/events/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const service = getService();

    // Check job exists
    const status = service.getStatus(jobId);
    if (!status.success) {
      res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
      res.end();
      return;
    }

    // Send initial status
    res.write(`data: ${JSON.stringify({ type: 'status', ...status })}\n\n`);

    // Listen for events
    const eventHandler = (event: unknown) => {
      const e = event as { jobId?: string };
      if (e.jobId === jobId) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    const progressHandler = (progress: unknown) => {
      const p = progress as Record<string, unknown>;
      if (p.jobId === jobId) {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...p })}\n\n`);
      }
    };

    service.on('event', eventHandler);
    service.on('progress', progressHandler);

    // Clean up on client disconnect
    req.on('close', () => {
      service.off('event', eventHandler);
      service.off('progress', progressHandler);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /config - Get draft configuration constants
  // ─────────────────────────────────────────────────────────────────
  router.get('/config', (_req: Request, res: Response) => {
    res.json({
      success: true,
      config: {
        passagesPerSection: 6,
        wordsPerSection: 1500,
        maxCharsPerPassage: 600,
        styles: ['academic', 'narrative', 'conversational'],
      },
    });
  });

  return router;
}
