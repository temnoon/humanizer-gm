/**
 * Books Routes
 *
 * Local API endpoints for books, chapters, and sections.
 */

import { Router, Request, Response } from 'express';
import {
  createBook,
  listBooks,
  getBook,
  getBookWithStructure,
  updateBook,
  deleteBook,
  createChapter,
  listChapters,
  getChapter,
  updateChapter,
  deleteChapter,
  createSection,
  listSections,
  getSection,
  updateSection,
  deleteSection,
} from '../services/books';

export function createBooksRouter(): Router {
  const router = Router();

  // ============================================================================
  // Books CRUD
  // ============================================================================

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'books' });
  });

  // List books
  router.get('/', (req: Request, res: Response) => {
    try {
      const books = listBooks();
      res.json(books);
    } catch (error) {
      console.error('[Books] List error:', error);
      res.status(500).json({ error: 'Failed to list books' });
    }
  });

  // Create book
  router.post('/', (req: Request, res: Response) => {
    try {
      const { title, subtitle, author, description, visibility, settings } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const book = createBook({
        title,
        subtitle,
        author,
        description,
        visibility,
        settings,
      });

      res.status(201).json(book);
    } catch (error) {
      console.error('[Books] Create error:', error);
      res.status(500).json({ error: 'Failed to create book' });
    }
  });

  // Get book (with full structure)
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const book = getBookWithStructure(req.params.id);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      res.json(book);
    } catch (error) {
      console.error('[Books] Get error:', error);
      res.status(500).json({ error: 'Failed to get book' });
    }
  });

  // Update book
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const book = updateBook(req.params.id, req.body);
      if (!book) {
        return res.status(404).json({ error: 'Book not found' });
      }
      res.json(book);
    } catch (error) {
      console.error('[Books] Update error:', error);
      res.status(500).json({ error: 'Failed to update book' });
    }
  });

  // Delete book
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = deleteBook(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Book not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Books] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete book' });
    }
  });

  // ============================================================================
  // Chapters
  // ============================================================================

  // List chapters
  router.get('/:id/chapters', (req: Request, res: Response) => {
    try {
      const chapters = listChapters(req.params.id);
      res.json(chapters);
    } catch (error) {
      console.error('[Chapters] List error:', error);
      res.status(500).json({ error: 'Failed to list chapters' });
    }
  });

  // Create chapter
  router.post('/:id/chapters', (req: Request, res: Response) => {
    try {
      const { title, subtitle, sortOrder, settings } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const chapter = createChapter({
        bookId: req.params.id,
        title,
        subtitle,
        sortOrder,
        settings,
      });

      res.status(201).json(chapter);
    } catch (error) {
      console.error('[Chapters] Create error:', error);
      res.status(500).json({ error: 'Failed to create chapter' });
    }
  });

  // Get chapter
  router.get('/:id/chapters/:cid', (req: Request, res: Response) => {
    try {
      const chapter = getChapter(req.params.cid);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }
      res.json(chapter);
    } catch (error) {
      console.error('[Chapters] Get error:', error);
      res.status(500).json({ error: 'Failed to get chapter' });
    }
  });

  // Update chapter
  router.put('/:id/chapters/:cid', (req: Request, res: Response) => {
    try {
      const chapter = updateChapter(req.params.cid, req.body);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }
      res.json(chapter);
    } catch (error) {
      console.error('[Chapters] Update error:', error);
      res.status(500).json({ error: 'Failed to update chapter' });
    }
  });

  // Delete chapter
  router.delete('/:id/chapters/:cid', (req: Request, res: Response) => {
    try {
      const deleted = deleteChapter(req.params.cid);
      if (!deleted) {
        return res.status(404).json({ error: 'Chapter not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Chapters] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete chapter' });
    }
  });

  // ============================================================================
  // Sections
  // ============================================================================

  // List sections for a chapter
  router.get('/:id/chapters/:cid/sections', (req: Request, res: Response) => {
    try {
      const sections = listSections(req.params.cid);
      res.json(sections);
    } catch (error) {
      console.error('[Sections] List error:', error);
      res.status(500).json({ error: 'Failed to list sections' });
    }
  });

  // Create section
  router.post('/:id/chapters/:cid/sections', (req: Request, res: Response) => {
    try {
      const { title, content, sortOrder, settings } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const section = createSection({
        chapterId: req.params.cid,
        bookId: req.params.id,
        title,
        content,
        sortOrder,
        settings,
      });

      res.status(201).json(section);
    } catch (error) {
      console.error('[Sections] Create error:', error);
      res.status(500).json({ error: 'Failed to create section' });
    }
  });

  // Get section
  router.get('/:id/sections/:sid', (req: Request, res: Response) => {
    try {
      const section = getSection(req.params.sid);
      if (!section) {
        return res.status(404).json({ error: 'Section not found' });
      }
      res.json(section);
    } catch (error) {
      console.error('[Sections] Get error:', error);
      res.status(500).json({ error: 'Failed to get section' });
    }
  });

  // Update section
  router.put('/:id/sections/:sid', (req: Request, res: Response) => {
    try {
      const section = updateSection(req.params.sid, req.body);
      if (!section) {
        return res.status(404).json({ error: 'Section not found' });
      }
      res.json(section);
    } catch (error) {
      console.error('[Sections] Update error:', error);
      res.status(500).json({ error: 'Failed to update section' });
    }
  });

  // Delete section
  router.delete('/:id/sections/:sid', (req: Request, res: Response) => {
    try {
      const deleted = deleteSection(req.params.sid);
      if (!deleted) {
        return res.status(404).json({ error: 'Section not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[Sections] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete section' });
    }
  });

  return router;
}
