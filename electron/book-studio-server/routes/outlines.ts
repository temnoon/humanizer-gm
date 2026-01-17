/**
 * Outlines API Routes
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbOutline } from '../database';
import { broadcastEvent } from '../server';

export function createOutlinesRouter(): Router {
  const router = Router();

  // GET /api/outlines?bookId=xxx - List outlines for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      const db = getDatabase();
      const outlines = db.prepare(`
        SELECT * FROM outlines WHERE book_id = ? ORDER BY created_at DESC
      `).all(bookId) as DbOutline[];

      res.json({ outlines: outlines.map(parseOutlineJsonFields) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/outlines/:id - Get a single outline
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const outline = db.prepare('SELECT * FROM outlines WHERE id = ?').get(req.params.id) as DbOutline | undefined;

      if (!outline) {
        return res.status(404).json({ error: 'Outline not found' });
      }

      res.json({ outline: parseOutlineJsonFields(outline) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/outlines - Create a new outline
  router.post('/', (req: Request, res: Response) => {
    try {
      const { bookId, structure, source, confidence } = req.body;

      if (!bookId || !structure) {
        return res.status(400).json({ error: 'bookId and structure are required' });
      }

      const db = getDatabase();

      // Verify book exists
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      const id = generateId();
      const timestamp = now();

      db.prepare(`
        INSERT INTO outlines (id, book_id, structure_json, generated_at, source, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, bookId, JSON.stringify(structure), timestamp, source || null, confidence || null, timestamp);

      const outline = db.prepare('SELECT * FROM outlines WHERE id = ?').get(id) as DbOutline;

      // Broadcast event
      broadcastEvent({
        type: 'outline-created',
        bookId,
        entityType: 'outline',
        entityId: id,
        payload: parseOutlineJsonFields(outline),
        timestamp: Date.now(),
      });

      res.status(201).json({ outline: parseOutlineJsonFields(outline) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/outlines/:id - Delete an outline
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM outlines WHERE id = ?').get(req.params.id) as DbOutline | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Outline not found' });
      }

      db.prepare('DELETE FROM outlines WHERE id = ?').run(req.params.id);

      // Broadcast event
      broadcastEvent({
        type: 'outline-deleted',
        bookId: existing.book_id,
        entityType: 'outline',
        entityId: req.params.id,
        timestamp: Date.now(),
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// Helper to parse JSON fields
function parseOutlineJsonFields(outline: DbOutline): Record<string, unknown> {
  return {
    ...outline,
    structure: JSON.parse(outline.structure_json),
  };
}
