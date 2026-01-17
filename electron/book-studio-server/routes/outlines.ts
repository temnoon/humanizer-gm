/**
 * Outlines API Routes
 *
 * All routes require authentication and verify book ownership.
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbOutline, DbBook } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';

export function createOutlinesRouter(): Router {
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

  // GET /api/outlines?bookId=xxx - List outlines for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(bookId as string, req)) {
        return res.status(403).json({ error: 'Access denied' });
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

      // Verify book ownership
      if (!verifyBookOwnership(outline.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({ outline: parseOutlineJsonFields(outline) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/outlines - Create a new outline
  router.post('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { bookId, structure, source, confidence } = req.body;

      if (!bookId || !structure) {
        return res.status(400).json({ error: 'bookId and structure are required' });
      }

      // Verify book ownership
      const book = verifyBookOwnership(bookId, req);
      if (!book) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const id = generateId();
      const timestamp = now();

      db.prepare(`
        INSERT INTO outlines (id, book_id, structure_json, generated_at, source, confidence, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, bookId, JSON.stringify(structure), timestamp, source || null, confidence || null, userId, timestamp);

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

      // Verify book ownership
      if (!verifyBookOwnership(existing.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
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
