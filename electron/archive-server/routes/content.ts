/**
 * Content Router - Unified content items (posts, comments, messages)
 *
 * Routes:
 * - GET /api/content/items - List content items with filters
 * - GET /api/content/item/:id - Get single content item
 * - GET /api/content/stats - Content statistics
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../services/registry';

export function createContentRouter(): Router {
  const router = Router();

  // List content items with filters
  router.get('/items', async (req: Request, res: Response) => {
    try {
      const {
        type,           // post, comment, message, photo, etc.
        source,         // facebook, openai, claude, etc.
        author,         // filter by author name
        own_only,       // '1' or 'true' for own content only
        period,         // Q1_2024 format
        search,         // text search
        limit = '50',
        offset = '0',
        sort = 'created_at',
        order = 'DESC'
      } = req.query;

      const db = getEmbeddingDatabase();

      let query = `SELECT * FROM content_items WHERE 1=1`;
      const params: any[] = [];

      if (type) {
        query += ` AND type = ?`;
        params.push(type);
      }

      if (source) {
        query += ` AND source = ?`;
        params.push(source);
      }

      if (author) {
        query += ` AND author_name LIKE ?`;
        params.push(`%${author}%`);
      }

      if (own_only === '1' || own_only === 'true') {
        query += ` AND is_own_content = 1`;
      }

      if (period) {
        // Parse Q1_2024 format
        const match = (period as string).match(/Q(\d)_(\d{4})/);
        if (match) {
          const quarter = parseInt(match[1]);
          const year = parseInt(match[2]);
          // Calculate quarter boundaries
          const startMonth = (quarter - 1) * 3;
          const startDate = new Date(year, startMonth, 1);
          const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59);
          query += ` AND created_at >= ? AND created_at <= ?`;
          params.push(startDate.getTime() / 1000, endDate.getTime() / 1000);
        }
      }

      if (search) {
        query += ` AND (text LIKE ? OR title LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      // Validate sort column to prevent SQL injection
      const allowedSorts = ['created_at', 'updated_at', 'author_name', 'type'];
      const sortCol = allowedSorts.includes(sort as string) ? sort : 'created_at';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      query += ` ORDER BY ${sortCol} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const items = db.getRawDb().prepare(query).all(...params);

      // Get total count (without limit/offset)
      let countQuery = `SELECT COUNT(*) as count FROM content_items WHERE 1=1`;
      const countParams: any[] = [];

      if (type) {
        countQuery += ` AND type = ?`;
        countParams.push(type);
      }
      if (source) {
        countQuery += ` AND source = ?`;
        countParams.push(source);
      }
      if (author) {
        countQuery += ` AND author_name LIKE ?`;
        countParams.push(`%${author}%`);
      }
      if (own_only === '1' || own_only === 'true') {
        countQuery += ` AND is_own_content = 1`;
      }
      if (search) {
        countQuery += ` AND (text LIKE ? OR title LIKE ?)`;
        countParams.push(`%${search}%`, `%${search}%`);
      }

      const countResult = db.getRawDb().prepare(countQuery).get(...countParams) as { count: number };

      res.json({
        items,
        total: countResult.count,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: parseInt(offset as string) + items.length < countResult.count,
      });
    } catch (err) {
      console.error('[content] Error listing items:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get single content item
  router.get('/item/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getEmbeddingDatabase();

      const item = db.getContentItem(id);

      if (!item) {
        res.status(404).json({ error: 'Content item not found' });
        return;
      }

      res.json(item);
    } catch (err) {
      console.error('[content] Error getting item:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Content statistics
  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const byType = db.getRawDb().prepare(`
        SELECT type, COUNT(*) as count
        FROM content_items
        GROUP BY type
      `).all();

      const bySource = db.getRawDb().prepare(`
        SELECT source, COUNT(*) as count
        FROM content_items
        GROUP BY source
      `).all();

      const total = db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM content_items
      `).get() as { count: number };

      const ownContent = db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM content_items WHERE is_own_content = 1
      `).get() as { count: number };

      res.json({
        total: total.count,
        ownContent: ownContent.count,
        byType,
        bySource,
      });
    } catch (err) {
      console.error('[content] Error getting stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
