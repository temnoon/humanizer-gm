/**
 * Facebook Router - Facebook archive browsing
 *
 * Routes:
 * - GET /api/facebook/periods - Get time periods with activity
 * - GET /api/facebook/media - List media items
 * - GET /api/facebook/image - Serve image
 * - GET /api/facebook/media-gallery - Gallery view data
 * - GET /api/facebook/graph/stats - Social graph statistics
 * - GET /api/facebook/graph/people - List people
 * - POST /api/facebook/graph/import - Import graph data
 * - GET /api/messenger/threads - List messenger threads
 * - GET /api/messenger/thread/:id - Get thread messages
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';

// Default Facebook archive paths (can be configured)
const FACEBOOK_ARCHIVE_BASE = process.env.FACEBOOK_ARCHIVE_PATH || '/Users/tem/facebook-data';

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createFacebookRouter(): Router {
  const router = Router();

  // Get time periods with activity
  router.get('/periods', async (_req: Request, res: Response) => {
    try {
      // TODO: Implement with PeriodCalculator
      res.json({
        periods: [],
        message: 'Facebook periods not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List media items
  router.get('/media', async (req: Request, res: Response) => {
    try {
      const { type, limit = 50, offset = 0 } = req.query;

      // TODO: Implement with MediaIndexer
      res.json({
        total: 0,
        items: [],
        message: 'Facebook media not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve image
  router.get('/image', async (req: Request, res: Response) => {
    try {
      const { path: imagePath } = req.query;

      if (!imagePath || typeof imagePath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Security: Only allow paths within the Facebook archive
      const resolved = path.resolve(FACEBOOK_ARCHIVE_BASE, imagePath);
      if (!resolved.startsWith(FACEBOOK_ARCHIVE_BASE)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };

      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      createReadStream(resolved).pipe(res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Media gallery view
  router.get('/media-gallery', async (req: Request, res: Response) => {
    try {
      const { page = 1, pageSize = 50 } = req.query;

      res.json({
        page: Number(page),
        pageSize: Number(pageSize),
        total: 0,
        items: [],
        message: 'Facebook gallery not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Social graph stats
  router.get('/graph/stats', async (_req: Request, res: Response) => {
    try {
      res.json({
        totalPeople: 0,
        totalPlaces: 0,
        totalEvents: 0,
        totalRelationships: 0,
        message: 'Facebook graph not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List people
  router.get('/graph/people', async (req: Request, res: Response) => {
    try {
      const { search, limit = 50, offset = 0 } = req.query;

      res.json({
        total: 0,
        people: [],
        message: 'Facebook people not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import graph data
  router.post('/graph/import', async (req: Request, res: Response) => {
    try {
      const { archivePath } = req.body;

      if (!archivePath) {
        res.status(400).json({ error: 'archivePath required' });
        return;
      }

      res.json({
        success: false,
        message: 'Facebook import not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Messenger routes
  router.get('/messenger/threads', async (req: Request, res: Response) => {
    try {
      const { limit = 50, offset = 0 } = req.query;

      res.json({
        total: 0,
        threads: [],
        message: 'Messenger not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/messenger/thread/:threadId', async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;

      res.json({
        threadId,
        messages: [],
        message: 'Messenger thread not yet implemented in GM',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve media files
  router.get('/serve-media', async (req: Request, res: Response) => {
    try {
      const { path: mediaPath } = req.query;

      if (!mediaPath || typeof mediaPath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      const resolved = path.resolve(FACEBOOK_ARCHIVE_BASE, mediaPath);
      if (!resolved.startsWith(FACEBOOK_ARCHIVE_BASE)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      createReadStream(resolved).pipe(res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
