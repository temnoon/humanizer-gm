/**
 * Books API Routes
 *
 * All routes require authentication and filter by user_id.
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbBook } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner, AuthenticatedRequest } from '../middleware/auth';

export function createBooksRouter(): Router {
  const router = Router();

  // Apply auth middleware to all routes
  router.use(requireAuth());

  // GET /api/books - List all books for current user with counts
  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const db = getDatabase();

      // Filter by user_id, also include legacy books without user_id
      // Include card and chapter counts via subqueries
      const books = db.prepare(`
        SELECT
          b.*,
          (SELECT COUNT(*) FROM cards WHERE book_id = b.id) as cardCount,
          (SELECT COUNT(*) FROM chapters WHERE book_id = b.id) as chapterCount
        FROM books b
        WHERE b.user_id = ? OR b.user_id IS NULL
        ORDER BY b.updated_at DESC
      `).all(userId) as (DbBook & { cardCount: number; chapterCount: number })[];

      res.json({ books });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/books/:id - Get a single book with chapters and card counts
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const db = getDatabase();

      const book = db.prepare(`
        SELECT * FROM books WHERE id = ?
      `).get(req.params.id) as DbBook | undefined;

      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Check ownership
      if (!isOwner(req, book.user_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get chapters
      const chapters = db.prepare(`
        SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC
      `).all(req.params.id);

      // Get card counts by status
      const cardCounts = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM cards WHERE book_id = ?
        GROUP BY status
      `).all(req.params.id) as { status: string; count: number }[];

      const counts = {
        staging: 0,
        placed: 0,
        archived: 0,
      };
      for (const { status, count } of cardCounts) {
        if (status in counts) {
          counts[status as keyof typeof counts] = count;
        }
      }

      res.json({ book, chapters, cardCounts: counts });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/books - Create a new book
  router.post('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { title, description, targetWordCount } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const db = getDatabase();
      const id = generateId();
      const timestamp = now();

      db.prepare(`
        INSERT INTO books (id, title, description, target_word_count, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, description || null, targetWordCount || null, userId, timestamp, timestamp);

      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as DbBook;

      // Broadcast event
      broadcastEvent({
        type: 'book-created',
        bookId: id,
        entityType: 'book',
        entityId: id,
        payload: book,
        timestamp: Date.now(),
      });

      res.status(201).json({ book });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/books/:id - Update a book
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { title, description, targetWordCount } = req.body;
      const db = getDatabase();

      // Check if book exists and verify ownership
      const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as DbBook | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Book not found' });
      }

      if (!isOwner(req, existing.user_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Build update query
      const updates: string[] = ['updated_at = ?'];
      const values: (string | number | null)[] = [now()];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }
      if (targetWordCount !== undefined) {
        updates.push('target_word_count = ?');
        values.push(targetWordCount);
      }

      // Claim ownership if book has no user_id (legacy data migration)
      if (!existing.user_id) {
        updates.push('user_id = ?');
        values.push(userId);
      }

      values.push(req.params.id);

      db.prepare(`
        UPDATE books SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);

      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as DbBook;

      // Broadcast event
      broadcastEvent({
        type: 'book-updated',
        bookId: req.params.id,
        entityType: 'book',
        entityId: req.params.id,
        payload: book,
        timestamp: Date.now(),
      });

      res.json({ book });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/books/:id - Delete a book
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      // Check if book exists and verify ownership
      const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as DbBook | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Book not found' });
      }

      if (!isOwner(req, existing.user_id)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Delete book (cascades to chapters, cards, clusters, outlines)
      db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);

      // Broadcast event
      broadcastEvent({
        type: 'book-deleted',
        bookId: req.params.id,
        entityType: 'book',
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
