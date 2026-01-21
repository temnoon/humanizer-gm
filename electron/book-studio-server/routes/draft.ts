/**
 * Draft API Routes
 *
 * Handles draft generation, version management, and chapter content updates.
 * All routes require authentication and verify book ownership.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase, DbBook, DbChapter } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';
import { getDraftService } from '../services/DraftService';

// ============================================================================
// Validation Schemas
// ============================================================================

const DraftGenerateSchema = z.object({
  chapterId: z.string().min(1),
  bookId: z.string().min(1),
  cardIds: z.array(z.string()).optional(),
  voiceId: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(100).max(8192).optional(),
  prompt: z.string().max(2000).optional(),
});

const DraftSaveSchema = z.object({
  chapterId: z.string().min(1),
  bookId: z.string().min(1),
  content: z.string().min(1),
  voiceId: z.string().optional(),
});

const DraftReviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'needs_revision']),
  notes: z.string().max(1000).optional(),
});

// ============================================================================
// Router Factory
// ============================================================================

export function createDraftRouter(): Router {
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

  // Helper to verify chapter ownership via book
  function verifyChapterOwnership(chapterId: string, req: Request): DbChapter | null {
    const db = getDatabase();
    const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as
      | DbChapter
      | undefined;

    if (!chapter) {
      return null;
    }

    if (!verifyBookOwnership(chapter.book_id, req)) {
      return null;
    }

    return chapter;
  }

  // ============================================================================
  // Generation Routes
  // ============================================================================

  /**
   * POST /api/draft/generate
   *
   * Generate a new draft for a chapter via Ollama LLM.
   */
  router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = DraftGenerateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { chapterId, bookId, cardIds, voiceId, model, temperature, maxTokens, prompt } =
        validation.data;

      // Verify book ownership
      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify chapter belongs to book
      const chapter = verifyChapterOwnership(chapterId, req);
      if (!chapter || chapter.book_id !== bookId) {
        return res.status(404).json({ error: 'Chapter not found or does not belong to book' });
      }

      const userId = getUserId(req);
      const draftService = getDraftService();

      // Check Ollama availability
      const health = await draftService.checkOllamaHealth();
      if (!health.available) {
        return res.status(503).json({
          error: 'Draft generation unavailable',
          details: health.error,
        });
      }

      const result = await draftService.generate({
        chapterId,
        bookId,
        cardIds,
        voiceId,
        model,
        temperature,
        maxTokens,
        prompt,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'draft:generated',
        bookId,
        entityType: 'draft',
        entityId: result.draft.id,
        payload: {
          chapterId,
          versionNumber: result.draft.versionNumber,
          wordCount: result.draft.wordCount,
          generationTime: result.generationTime,
        },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: {
          draft: result.draft,
          generationTime: result.generationTime,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/draft/save
   *
   * Save a manually created draft version.
   */
  router.post('/save', (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = DraftSaveSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { chapterId, bookId, content, voiceId } = validation.data;

      // Verify book ownership
      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify chapter belongs to book
      const chapter = verifyChapterOwnership(chapterId, req);
      if (!chapter || chapter.book_id !== bookId) {
        return res.status(404).json({ error: 'Chapter not found or does not belong to book' });
      }

      const userId = getUserId(req);
      const draftService = getDraftService();

      const draft = draftService.saveVersion({
        chapterId,
        bookId,
        content,
        voiceId,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'draft:saved',
        bookId,
        entityType: 'draft',
        entityId: draft.id,
        payload: {
          chapterId,
          versionNumber: draft.versionNumber,
          wordCount: draft.wordCount,
        },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: draft,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Version Management Routes
  // ============================================================================

  /**
   * GET /api/draft/versions/:chapterId
   *
   * Get all draft versions for a chapter.
   */
  router.get('/versions/:chapterId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { chapterId } = req.params;

      const chapter = verifyChapterOwnership(chapterId, req);
      if (!chapter) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const draftService = getDraftService();
      const versions = draftService.getVersions(chapterId);

      res.json({
        success: true,
        data: versions,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/draft/:versionId
   *
   * Get a specific draft version.
   */
  router.get('/:versionId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { versionId } = req.params;

      const draftService = getDraftService();
      const version = draftService.getVersion(versionId);

      if (!version) {
        return res.status(404).json({ error: 'Draft version not found' });
      }

      if (!verifyBookOwnership(version.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        success: true,
        data: version,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/draft/latest/:chapterId
   *
   * Get the latest draft version for a chapter.
   */
  router.get('/latest/:chapterId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { chapterId } = req.params;

      const chapter = verifyChapterOwnership(chapterId, req);
      if (!chapter) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const draftService = getDraftService();
      const version = draftService.getLatestVersion(chapterId);

      if (!version) {
        return res.status(404).json({ error: 'No drafts found for chapter' });
      }

      res.json({
        success: true,
        data: version,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Comparison Routes
  // ============================================================================

  /**
   * GET /api/draft/compare
   *
   * Compare two draft versions.
   */
  router.get('/compare', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { v1, v2 } = req.query;

      if (!v1 || !v2) {
        return res.status(400).json({ error: 'v1 and v2 version IDs are required' });
      }

      const draftService = getDraftService();

      // Get both versions to verify access
      const version1 = draftService.getVersion(v1 as string);
      const version2 = draftService.getVersion(v2 as string);

      if (!version1 || !version2) {
        return res.status(404).json({ error: 'One or both versions not found' });
      }

      // Verify ownership of version1's book
      if (!verifyBookOwnership(version1.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // SECURITY: Verify version2 belongs to the same book as version1
      // This prevents cross-book data leakage
      if (version2.bookId !== version1.bookId) {
        return res.status(403).json({ error: 'Versions must be from the same book' });
      }

      // Ensure both versions are from the same chapter
      if (version1.chapterId !== version2.chapterId) {
        return res.status(400).json({ error: 'Versions must be from the same chapter' });
      }

      const comparison = draftService.compare(v1 as string, v2 as string);

      if (!comparison) {
        return res.status(500).json({ error: 'Failed to compare versions' });
      }

      res.json({
        success: true,
        data: comparison,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Review Routes
  // ============================================================================

  /**
   * PATCH /api/draft/:versionId/review
   *
   * Update review status of a draft version.
   */
  router.patch('/:versionId/review', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { versionId } = req.params;

      const validation = DraftReviewSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { status, notes } = validation.data;

      const draftService = getDraftService();
      const version = draftService.getVersion(versionId);

      if (!version) {
        return res.status(404).json({ error: 'Draft version not found' });
      }

      if (!verifyBookOwnership(version.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      draftService.updateReviewStatus(versionId, status, notes);

      // Broadcast event
      broadcastEvent({
        type: 'draft:reviewed',
        bookId: version.bookId,
        entityType: 'draft',
        entityId: versionId,
        payload: { status, chapterId: version.chapterId },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        message: `Draft review status updated to ${status}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/draft/:versionId/score
   *
   * Set quality score for a draft version.
   */
  router.patch('/:versionId/score', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { versionId } = req.params;
      const { score } = req.body;

      if (typeof score !== 'number' || score < 0 || score > 1) {
        return res.status(400).json({ error: 'score must be a number between 0 and 1' });
      }

      const draftService = getDraftService();
      const version = draftService.getVersion(versionId);

      if (!version) {
        return res.status(404).json({ error: 'Draft version not found' });
      }

      if (!verifyBookOwnership(version.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      draftService.setQualityScore(versionId, score);

      res.json({
        success: true,
        message: 'Quality score updated',
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Accept Routes
  // ============================================================================

  /**
   * POST /api/draft/accept/:versionId
   *
   * Accept a draft version and copy its content to the chapter.
   */
  router.post('/accept/:versionId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { versionId } = req.params;

      const draftService = getDraftService();
      const version = draftService.getVersion(versionId);

      if (!version) {
        return res.status(404).json({ error: 'Draft version not found' });
      }

      if (!verifyBookOwnership(version.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const chapter = draftService.accept(versionId);

      // Broadcast event
      broadcastEvent({
        type: 'draft:accepted',
        bookId: version.bookId,
        entityType: 'chapter',
        entityId: version.chapterId,
        payload: {
          draftId: versionId,
          versionNumber: version.versionNumber,
          wordCount: version.wordCount,
        },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: chapter,
        message: 'Draft accepted and chapter updated',
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Delete Routes
  // ============================================================================

  /**
   * DELETE /api/draft/:versionId
   *
   * Delete a draft version.
   */
  router.delete('/:versionId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { versionId } = req.params;

      const draftService = getDraftService();
      const version = draftService.getVersion(versionId);

      if (!version) {
        return res.status(404).json({ error: 'Draft version not found' });
      }

      if (!verifyBookOwnership(version.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      draftService.deleteVersion(versionId);

      res.json({
        success: true,
        message: 'Draft version deleted',
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * GET /api/draft/health
   *
   * Check if draft generation is available (Ollama health).
   */
  router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const draftService = getDraftService();
      const health = await draftService.checkOllamaHealth();

      res.json({
        success: true,
        data: health,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
