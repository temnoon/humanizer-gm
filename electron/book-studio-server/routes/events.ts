/**
 * Events API Routes
 *
 * Event log for audit trail and history.
 * All routes require authentication and filter by user_id or book ownership.
 */

import { Router, Request, Response } from 'express';
import { getDatabase, now, DbEvent, DbBook } from '../database';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';

export function createEventsRouter(): Router {
  const router = Router();

  // Apply auth middleware to all routes
  router.use(requireAuth());

  // Helper to verify book ownership
  function verifyBookOwnership(bookId: string, req: Request): DbBook | null {
    const db = getDatabase();
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as DbBook | undefined;
    if (!book || !isOwner(req, book.user_id)) {
      return null;
    }
    return book;
  }

  // GET /api/events?bookId=xxx - List events for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { bookId, type, entityType, limit = '100', offset = '0', since } = req.query;

      // If bookId is provided, verify ownership
      if (bookId && !verifyBookOwnership(bookId as string, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const conditions: string[] = [];
      const values: (string | number)[] = [];

      if (bookId) {
        conditions.push('book_id = ?');
        values.push(bookId as string);
      } else {
        // If no bookId, filter by user_id
        conditions.push('(user_id = ? OR user_id IS NULL)');
        values.push(userId);
      }

      if (type) {
        conditions.push('type = ?');
        values.push(type as string);
      }

      if (entityType) {
        conditions.push('entity_type = ?');
        values.push(entityType as string);
      }

      if (since) {
        conditions.push('created_at > ?');
        values.push(parseInt(since as string, 10));
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      values.push(parseInt(limit as string, 10));
      values.push(parseInt(offset as string, 10));

      const events = db.prepare(`
        SELECT * FROM events
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...values) as DbEvent[];

      res.json({ events: events.map(parseEventJsonFields) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/events - Record an event (for external tools)
  router.post('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { type, bookId, entityType, entityId, payload } = req.body;

      if (!type) {
        return res.status(400).json({ error: 'type is required' });
      }

      // If bookId is provided, verify ownership
      if (bookId && !verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const timestamp = now();

      db.prepare(`
        INSERT INTO events (type, book_id, entity_type, entity_id, payload, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        type,
        bookId || null,
        entityType || null,
        entityId || null,
        payload ? JSON.stringify(payload) : null,
        userId,
        timestamp
      );

      res.status(201).json({ success: true, timestamp });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/events/stats - Get event statistics
  router.get('/stats', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { bookId, since } = req.query;

      // If bookId is provided, verify ownership
      if (bookId && !verifyBookOwnership(bookId as string, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const conditions: string[] = [];
      const values: (string | number)[] = [];

      if (bookId) {
        conditions.push('book_id = ?');
        values.push(bookId as string);
      } else {
        // If no bookId, filter by user_id
        conditions.push('(user_id = ? OR user_id IS NULL)');
        values.push(userId);
      }

      if (since) {
        conditions.push('created_at > ?');
        values.push(parseInt(since as string, 10));
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const stats = db.prepare(`
        SELECT type, COUNT(*) as count
        FROM events
        ${whereClause}
        GROUP BY type
        ORDER BY count DESC
      `).all(...values) as { type: string; count: number }[];

      const totalEvents = db.prepare(`
        SELECT COUNT(*) as total FROM events ${whereClause}
      `).get(...values) as { total: number };

      res.json({
        total: totalEvents.total,
        byType: stats.reduce((acc, { type, count }) => {
          acc[type] = count;
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// Helper to parse JSON fields
function parseEventJsonFields(event: DbEvent): Record<string, unknown> {
  return {
    ...event,
    payload: event.payload ? JSON.parse(event.payload) : null,
  };
}
