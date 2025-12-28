/**
 * Facebook Router - Facebook archive browsing
 *
 * Routes:
 * - GET /api/facebook/periods - Get time periods with activity
 * - GET /api/facebook/media - List media items
 * - GET /api/facebook/media-stats - Media statistics
 * - GET /api/facebook/media-gallery - Gallery view data
 * - GET /api/facebook/media/:id/context - Get media context
 * - GET /api/facebook/image - Serve image
 * - GET /api/facebook/serve-media - Serve media file
 * - GET /api/facebook/content/:id/media - Get content's media
 * - GET /api/facebook/graph/stats - Social graph statistics
 * - GET /api/facebook/graph/people - List people
 * - GET /api/facebook/graph/top-connections - Top connections
 * - GET /api/facebook/graph/relationships/stats - Relationship stats
 * - POST /api/facebook/graph/import - Import graph data
 * - GET /api/messenger/threads - List messenger threads
 * - GET /api/messenger/thread/:id - Get thread messages
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { getMediaItemsDatabase, getEmbeddingDatabase } from '../services/registry';
import { getArchiveRoot } from '../config';

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createFacebookRouter(): Router {
  const router = Router();

  // Get time periods with activity
  router.get('/periods', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      // Query distinct periods from content_items
      const periods = db.getRawDb().prepare(`
        SELECT
          strftime('%Y', datetime(created_at, 'unixepoch')) as year,
          ((strftime('%m', datetime(created_at, 'unixepoch')) - 1) / 3 + 1) as quarter,
          COUNT(*) as count,
          MIN(created_at) as start_date,
          MAX(created_at) as end_date
        FROM content_items
        WHERE source = 'facebook'
        GROUP BY year, quarter
        ORDER BY year DESC, quarter DESC
      `).all();

      res.json({
        periods: periods.map((p: any) => ({
          period: `Q${p.quarter}_${p.year}`,
          year: parseInt(p.year),
          quarter: p.quarter,
          count: p.count,
          start_date: p.start_date,
          end_date: p.end_date,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting periods:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Media statistics
  router.get('/media-stats', async (_req: Request, res: Response) => {
    try {
      const mediaDb = getMediaItemsDatabase();
      const bySource = mediaDb.getMediaCountBySource();
      const total = mediaDb.getTotalMediaCount();

      // Get total file size
      const db = getEmbeddingDatabase();
      const sizeResult = db.getRawDb().prepare(`
        SELECT SUM(file_size) as total_size FROM media_items
      `).get() as { total_size: number } | undefined;

      res.json({
        total,
        bySource,
        totalSize: sizeResult?.total_size || 0,
        totalSizeMB: ((sizeResult?.total_size || 0) / (1024 * 1024)).toFixed(2),
      });
    } catch (err) {
      console.error('[facebook] Error getting media stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List media items
  router.get('/media', async (req: Request, res: Response) => {
    try {
      const {
        type,
        source_type,
        limit = '50',
        offset = '0',
        page = '0'
      } = req.query;

      const mediaDb = getMediaItemsDatabase();
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string) || parseInt(page as string) * limitNum;

      const items = mediaDb.getMediaItems({
        mediaType: type as string,
        sourceType: source_type as string,
        limit: limitNum,
        offset: offsetNum,
      });

      const total = mediaDb.getTotalMediaCount();

      res.json({
        media: items,
        total,
        hasMore: offsetNum + items.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error listing media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Media gallery view with pagination
  router.get('/media-gallery', async (req: Request, res: Response) => {
    try {
      const {
        page = '0',
        pageSize = '50',
        limit = '50',
        offset = '0'
      } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string) || parseInt(limit as string);
      const offsetNum = parseInt(offset as string) || pageNum * pageSizeNum;

      const mediaDb = getMediaItemsDatabase();
      const items = mediaDb.getMediaItems({
        limit: pageSizeNum,
        offset: offsetNum,
      });

      const total = mediaDb.getTotalMediaCount();

      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        items: items.map(item => ({
          id: item.id,
          file_path: item.file_path,
          filename: item.filename,
          media_type: item.media_type,
          file_size: item.file_size,
          width: item.width,
          height: item.height,
          created_at: item.created_at,
          source_type: item.source_type,
          context: item.context,
          context_id: item.context_id,
          description: item.description,
        })),
        hasMore: offsetNum + items.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error getting media gallery:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get media context (related content)
  router.get('/media/:mediaId/context', async (req: Request, res: Response) => {
    try {
      const { mediaId } = req.params;
      const db = getEmbeddingDatabase();
      const mediaDb = getMediaItemsDatabase();

      // Get the media item
      const mediaItem = db.getRawDb().prepare(`
        SELECT * FROM media_items WHERE id = ?
      `).get(mediaId);

      if (!mediaItem) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      // Get related media (same album/post/event)
      let relatedMedia: any[] = [];
      if ((mediaItem as any).context_id) {
        relatedMedia = db.getRawDb().prepare(`
          SELECT id, file_path, media_type, created_at
          FROM media_items
          WHERE context_id = ? AND id != ?
          ORDER BY created_at ASC
        `).all((mediaItem as any).context_id, mediaId);
      }

      // Get linked content items that reference this media
      const contentItems = db.getRawDb().prepare(`
        SELECT id, type, title, text, created_at, author_name
        FROM content_items
        WHERE media_refs LIKE ?
        ORDER BY created_at DESC
      `).all(`%${mediaId}%`);

      res.json({
        media: mediaItem,
        relatedMedia,
        contentItems,
      });
    } catch (err) {
      console.error('[facebook] Error getting media context:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get content item's media
  router.get('/content/:contentId/media', async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const db = getEmbeddingDatabase();

      // Get the content item
      const content = db.getContentItem(contentId);
      if (!content) {
        res.status(404).json({ error: 'Content not found' });
        return;
      }

      // Parse media refs
      let mediaRefs: string[] = [];
      if (content.media_refs) {
        try {
          mediaRefs = JSON.parse(content.media_refs);
        } catch {
          // Try as comma-separated
          mediaRefs = content.media_refs.split(',').map((s: string) => s.trim());
        }
      }

      // Get media items
      const media = mediaRefs.length > 0 ? db.getRawDb().prepare(`
        SELECT * FROM media_items WHERE id IN (${mediaRefs.map(() => '?').join(',')})
      `).all(...mediaRefs) : [];

      res.json({
        contentId,
        media,
        count: media.length,
      });
    } catch (err) {
      console.error('[facebook] Error getting content media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve image (with path security)
  router.get('/image', async (req: Request, res: Response) => {
    try {
      const { path: imagePath } = req.query;

      if (!imagePath || typeof imagePath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Decode if base64
      let decodedPath = imagePath;
      try {
        // Check if it looks like base64
        if (/^[A-Za-z0-9+/=]+$/.test(imagePath) && imagePath.length > 50) {
          decodedPath = Buffer.from(imagePath, 'base64').toString('utf-8');
        }
      } catch {
        // Use as-is
      }

      // Resolve path
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(decodedPath)
        ? decodedPath
        : path.resolve(archiveRoot, decodedPath);

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
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
      };

      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      createReadStream(resolved).pipe(res);
    } catch (err) {
      console.error('[facebook] Error serving image:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve media files (URL-encoded path)
  router.get('/serve-media', async (req: Request, res: Response) => {
    try {
      const { path: mediaPath } = req.query;

      if (!mediaPath || typeof mediaPath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Resolve path - handle both absolute and relative
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(mediaPath)
        ? mediaPath
        : path.resolve(archiveRoot, mediaPath);

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'File not found', path: resolved });
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
      };

      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
      createReadStream(resolved).pipe(res);
    } catch (err) {
      console.error('[facebook] Error serving media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Social graph stats
  router.get('/graph/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      // Count distinct people from content
      const peopleCount = db.getRawDb().prepare(`
        SELECT COUNT(DISTINCT author_name) as count
        FROM content_items
        WHERE source = 'facebook' AND author_name IS NOT NULL
      `).get() as { count: number };

      // Count relationships (approximate from interactions)
      const interactionCount = db.getRawDb().prepare(`
        SELECT COUNT(*) as count
        FROM content_items
        WHERE source = 'facebook' AND is_own_content = 0
      `).get() as { count: number };

      res.json({
        totalPeople: peopleCount?.count || 0,
        totalPlaces: 0, // Would need location parsing
        totalEvents: 0, // Would need event parsing
        totalRelationships: interactionCount?.count || 0,
      });
    } catch (err) {
      console.error('[facebook] Error getting graph stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Top connections
  router.get('/graph/top-connections', async (req: Request, res: Response) => {
    try {
      const { limit = '20' } = req.query;
      const db = getEmbeddingDatabase();

      // Get most frequent interaction partners
      const connections = db.getRawDb().prepare(`
        SELECT
          author_name as name,
          COUNT(*) as interaction_count,
          MAX(created_at) as last_interaction
        FROM content_items
        WHERE source = 'facebook'
          AND author_name IS NOT NULL
          AND is_own_content = 0
        GROUP BY author_name
        ORDER BY interaction_count DESC
        LIMIT ?
      `).all(parseInt(limit as string));

      res.json({
        connections,
        total: connections.length,
      });
    } catch (err) {
      console.error('[facebook] Error getting top connections:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Relationship stats
  router.get('/graph/relationships/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      // Get interaction type breakdown
      const byType = db.getRawDb().prepare(`
        SELECT type, COUNT(*) as count
        FROM content_items
        WHERE source = 'facebook'
        GROUP BY type
      `).all();

      res.json({
        byType,
        total: (byType as any[]).reduce((sum, t) => sum + t.count, 0),
      });
    } catch (err) {
      console.error('[facebook] Error getting relationship stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List people
  router.get('/graph/people', async (req: Request, res: Response) => {
    try {
      const { search, limit = '50', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();

      let query = `
        SELECT
          author_name as name,
          author_id as id,
          COUNT(*) as interaction_count,
          MAX(created_at) as last_seen
        FROM content_items
        WHERE source = 'facebook'
          AND author_name IS NOT NULL
          AND is_own_content = 0
      `;

      const params: any[] = [];

      if (search) {
        query += ` AND author_name LIKE ?`;
        params.push(`%${search}%`);
      }

      query += `
        GROUP BY author_name, author_id
        ORDER BY interaction_count DESC
        LIMIT ? OFFSET ?
      `;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const people = db.getRawDb().prepare(query).all(...params);

      res.json({
        total: people.length,
        people,
      });
    } catch (err) {
      console.error('[facebook] Error listing people:', err);
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

      // TODO: Use FacebookFullParser for import
      res.json({
        success: false,
        message: 'Facebook import via API not yet fully implemented. Use the import tab.',
      });
    } catch (err) {
      console.error('[facebook] Error importing graph:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Messenger routes
  router.get('/messenger/threads', async (req: Request, res: Response) => {
    try {
      const { limit = '50', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();

      // Get distinct threads from messages
      const threads = db.getRawDb().prepare(`
        SELECT
          thread_id,
          MAX(title) as title,
          COUNT(*) as message_count,
          MAX(created_at) as last_message,
          MIN(created_at) as first_message
        FROM content_items
        WHERE source = 'facebook' AND type = 'message' AND thread_id IS NOT NULL
        GROUP BY thread_id
        ORDER BY last_message DESC
        LIMIT ? OFFSET ?
      `).all(parseInt(limit as string), parseInt(offset as string));

      res.json({
        total: threads.length,
        threads,
      });
    } catch (err) {
      console.error('[facebook] Error listing messenger threads:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/messenger/thread/:threadId', async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const { limit = '100', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();

      const messages = db.getRawDb().prepare(`
        SELECT *
        FROM content_items
        WHERE source = 'facebook' AND type = 'message' AND thread_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `).all(threadId, parseInt(limit as string), parseInt(offset as string));

      res.json({
        threadId,
        messages,
        count: messages.length,
      });
    } catch (err) {
      console.error('[facebook] Error getting messenger thread:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
