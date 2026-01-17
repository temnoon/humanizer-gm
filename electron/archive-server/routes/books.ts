/**
 * Books Routes - READ-ONLY access to Xanadu book data
 *
 * NOTE: These routes provide read access to legacy Xanadu book data stored in EmbeddingDatabase.
 * For book project management (create, update, harvest), use Book Studio Server (port 3004).
 *
 * See: docs/ARCHITECTURE_BOOKMAKING_INTEGRATION.md for architecture details.
 *
 * Routes:
 * - GET /api/books - List all books from Xanadu library
 * - GET /api/books/:id - Get book details
 * - GET /api/books/:id/harvest-buckets - Get harvest buckets for a book
 * - GET /api/books/:id/arcs - Get narrative arcs for a book
 * - GET /api/books/:id/chapters - Get chapters for a book
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../services/registry';

export function createBooksRouter(): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────
  // GET / - List all books from Xanadu library
  // ─────────────────────────────────────────────────────────────────
  router.get('/', (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const books = db.getAllBooks();
      res.json({
        success: true,
        books,
        count: books.length,
      });
    } catch (err) {
      console.error('[books] List error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:id - Get book by ID
  // ─────────────────────────────────────────────────────────────────
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const book = db.getBook(req.params.id);
      if (!book) {
        return res.status(404).json({ success: false, error: 'Book not found' });
      }
      res.json({ success: true, book });
    } catch (err) {
      console.error('[books] Get error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:id/harvest-buckets - Get harvest buckets for a book (legacy Xanadu)
  // ─────────────────────────────────────────────────────────────────
  router.get('/:id/harvest-buckets', (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const bookUri = `book://tem-noon/${req.params.id}`;
      const buckets = db.getHarvestBucketsForBook(bookUri);
      res.json({
        success: true,
        buckets,
        count: buckets.length,
      });
    } catch (err) {
      console.error('[books] Harvest buckets error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:id/arcs - Get narrative arcs for a book (legacy Xanadu)
  // ─────────────────────────────────────────────────────────────────
  router.get('/:id/arcs', (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const bookUri = `book://tem-noon/${req.params.id}`;
      const arcs = db.getNarrativeArcsForBook(bookUri);
      res.json({
        success: true,
        arcs,
        count: arcs.length,
      });
    } catch (err) {
      console.error('[books] Get arcs error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:id/chapters - Get chapters for a book (legacy Xanadu)
  // ─────────────────────────────────────────────────────────────────
  router.get('/:id/chapters', (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const chapters = db.getBookChapters(req.params.id);
      res.json({
        success: true,
        chapters,
        count: chapters.length,
      });
    } catch (err) {
      console.error('[books] Get chapters error:', err);
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  return router;
}
