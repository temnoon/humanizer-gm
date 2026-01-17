/**
 * Chapters API Routes
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbChapter } from '../database';
import { broadcastEvent } from '../server';

export function createChaptersRouter(): Router {
  const router = Router();

  // GET /api/chapters?bookId=xxx - List chapters for a book
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      const db = getDatabase();
      const chapters = db.prepare(`
        SELECT * FROM chapters WHERE book_id = ? ORDER BY "order" ASC
      `).all(bookId) as DbChapter[];

      res.json({ chapters });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/chapters/:id - Get a single chapter with cards
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const chapter = db.prepare(`
        SELECT * FROM chapters WHERE id = ?
      `).get(req.params.id) as DbChapter | undefined;

      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      // Get cards assigned to this chapter
      const cards = db.prepare(`
        SELECT * FROM cards WHERE chapter_id = ? ORDER BY created_at ASC
      `).all(req.params.id);

      res.json({ chapter, cards });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/chapters - Create a new chapter
  router.post('/', (req: Request, res: Response) => {
    try {
      const { bookId, title, order, draftInstructions } = req.body;

      if (!bookId || !title) {
        return res.status(400).json({ error: 'bookId and title are required' });
      }

      const db = getDatabase();

      // Verify book exists
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Get max order if not specified
      let chapterOrder = order;
      if (chapterOrder === undefined) {
        const maxOrder = db.prepare(`
          SELECT MAX("order") as max_order FROM chapters WHERE book_id = ?
        `).get(bookId) as { max_order: number | null };
        chapterOrder = (maxOrder.max_order ?? -1) + 1;
      }

      const id = generateId();
      const timestamp = now();

      db.prepare(`
        INSERT INTO chapters (id, book_id, title, "order", draft_instructions, word_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(id, bookId, title, chapterOrder, draftInstructions || null, timestamp, timestamp);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as DbChapter;

      // Broadcast event
      broadcastEvent({
        type: 'chapter-created',
        bookId,
        entityType: 'chapter',
        entityId: id,
        payload: chapter,
        timestamp: Date.now(),
      });

      res.status(201).json({ chapter });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/chapters/batch - Create multiple chapters
  router.post('/batch', (req: Request, res: Response) => {
    try {
      const { bookId, chapters: chapterData } = req.body;

      if (!bookId || !Array.isArray(chapterData) || chapterData.length === 0) {
        return res.status(400).json({ error: 'bookId and chapters array are required' });
      }

      const db = getDatabase();

      // Verify book exists
      const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Get current max order
      const maxOrder = db.prepare(`
        SELECT MAX("order") as max_order FROM chapters WHERE book_id = ?
      `).get(bookId) as { max_order: number | null };
      let nextOrder = (maxOrder.max_order ?? -1) + 1;

      const timestamp = now();
      const createdChapters: DbChapter[] = [];

      const insertStmt = db.prepare(`
        INSERT INTO chapters (id, book_id, title, "order", word_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `);

      // Use a transaction for batch insert
      const insertMany = db.transaction((items: { title: string; order?: number }[]) => {
        for (const item of items) {
          const id = generateId();
          const order = item.order ?? nextOrder++;
          insertStmt.run(id, bookId, item.title, order, timestamp, timestamp);
          const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as DbChapter;
          createdChapters.push(chapter);
        }
      });

      insertMany(chapterData);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      // Broadcast event
      broadcastEvent({
        type: 'chapters-batch-created',
        bookId,
        entityType: 'chapter',
        payload: createdChapters,
        timestamp: Date.now(),
      });

      res.status(201).json({ chapters: createdChapters });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/chapters/:id - Update a chapter
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const { title, order, content, draftInstructions } = req.body;
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id) as DbChapter | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      const updates: string[] = ['updated_at = ?'];
      const values: (string | number | null)[] = [now()];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
      }
      if (order !== undefined) {
        updates.push('"order" = ?');
        values.push(order);
      }
      if (content !== undefined) {
        updates.push('content = ?');
        values.push(content);
        // Update word count
        const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
        updates.push('word_count = ?');
        values.push(wordCount);
      }
      if (draftInstructions !== undefined) {
        updates.push('draft_instructions = ?');
        values.push(draftInstructions);
      }

      values.push(req.params.id);

      db.prepare(`
        UPDATE chapters SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(now(), existing.book_id);

      const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id) as DbChapter;

      // Broadcast event
      broadcastEvent({
        type: 'chapter-updated',
        bookId: existing.book_id,
        entityType: 'chapter',
        entityId: req.params.id,
        payload: chapter,
        timestamp: Date.now(),
      });

      res.json({ chapter });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/chapters/:id - Delete a chapter
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id) as DbChapter | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      // Delete chapter (cards will have chapter_id set to NULL)
      db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.id);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(now(), existing.book_id);

      // Broadcast event
      broadcastEvent({
        type: 'chapter-deleted',
        bookId: existing.book_id,
        entityType: 'chapter',
        entityId: req.params.id,
        timestamp: Date.now(),
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/chapters/:id/reorder - Reorder chapters
  router.post('/reorder', (req: Request, res: Response) => {
    try {
      const { bookId, chapterIds } = req.body;

      if (!bookId || !Array.isArray(chapterIds)) {
        return res.status(400).json({ error: 'bookId and chapterIds array are required' });
      }

      const db = getDatabase();
      const timestamp = now();

      const updateStmt = db.prepare(`
        UPDATE chapters SET "order" = ?, updated_at = ? WHERE id = ? AND book_id = ?
      `);

      const reorder = db.transaction((ids: string[]) => {
        ids.forEach((id, index) => {
          updateStmt.run(index, timestamp, id, bookId);
        });
      });

      reorder(chapterIds);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      // Broadcast event
      broadcastEvent({
        type: 'chapters-reordered',
        bookId,
        entityType: 'chapter',
        payload: { chapterIds },
        timestamp: Date.now(),
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
