/**
 * Events API Routes
 *
 * Event log for audit trail and history.
 */

import { Router, Request, Response } from 'express';
import { getDatabase, now, DbEvent } from '../database';

export function createEventsRouter(): Router {
  const router = Router();

  // GET /api/events?bookId=xxx - List events for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId, type, entityType, limit = '100', offset = '0', since } = req.query;

      const db = getDatabase();
      const conditions: string[] = [];
      const values: (string | number)[] = [];

      if (bookId) {
        conditions.push('book_id = ?');
        values.push(bookId as string);
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
      const { type, bookId, entityType, entityId, payload } = req.body;

      if (!type) {
        return res.status(400).json({ error: 'type is required' });
      }

      const db = getDatabase();
      const timestamp = now();

      db.prepare(`
        INSERT INTO events (type, book_id, entity_type, entity_id, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        type,
        bookId || null,
        entityType || null,
        entityId || null,
        payload ? JSON.stringify(payload) : null,
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
      const { bookId, since } = req.query;
      const db = getDatabase();

      let whereClause = '';
      const values: (string | number)[] = [];

      if (bookId) {
        whereClause = 'WHERE book_id = ?';
        values.push(bookId as string);

        if (since) {
          whereClause += ' AND created_at > ?';
          values.push(parseInt(since as string, 10));
        }
      } else if (since) {
        whereClause = 'WHERE created_at > ?';
        values.push(parseInt(since as string, 10));
      }

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
