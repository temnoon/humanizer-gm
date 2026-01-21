/**
 * Voice API Routes
 *
 * Handles author voice extraction, management, and application.
 * All routes require authentication and verify book ownership.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase, DbBook } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';
import { getVoiceService } from '../services/VoiceService';

// ============================================================================
// Validation Schemas
// ============================================================================

const VoiceExtractSchema = z.object({
  bookId: z.string().min(1),
  cardIds: z.array(z.string()).min(1, 'At least one card is required'),
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

const VoiceCreateSchema = z.object({
  bookId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sampleText: z.string().min(50, 'Sample text must be at least 50 characters').max(5000),
});

const VoiceUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  sampleText: z.string().min(50).max(5000).optional(),
});

const VoiceApplySchema = z.object({
  voiceId: z.string().min(1),
  content: z.string().min(1).max(10000),
  strengthFactor: z.number().min(0).max(1).optional(),
});

// ============================================================================
// Router Factory
// ============================================================================

export function createVoiceRouter(): Router {
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

  // ============================================================================
  // Extraction Routes
  // ============================================================================

  /**
   * POST /api/voice/extract
   *
   * Extract a voice profile from cards.
   */
  router.post('/extract', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = VoiceExtractSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { bookId, cardIds, name, description } = validation.data;

      // Verify book ownership
      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Verify cards belong to the book
      const db = getDatabase();
      const cardCount = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM cards WHERE id IN (${cardIds.map(() => '?').join(',')}) AND book_id = ?`
          )
          .get(...cardIds, bookId) as { count: number }
      ).count;

      if (cardCount !== cardIds.length) {
        return res.status(400).json({ error: 'One or more cards do not belong to this book' });
      }

      const userId = getUserId(req);
      const voiceService = getVoiceService();

      const voice = await voiceService.extract({
        bookId,
        cardIds,
        name,
        description,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'voice:extracted',
        bookId,
        entityType: 'voice',
        entityId: voice.id,
        payload: {
          name: voice.name,
          cardCount: cardIds.length,
        },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: voice,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // CRUD Routes
  // ============================================================================

  /**
   * GET /api/voice/:bookId
   *
   * List all voices for a book.
   */
  router.get('/:bookId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bookId } = req.params;

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const voiceService = getVoiceService();
      const voices = voiceService.list(bookId);

      res.json({
        success: true,
        data: voices,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/voice/detail/:voiceId
   *
   * Get a specific voice profile.
   */
  router.get('/detail/:voiceId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { voiceId } = req.params;

      const voiceService = getVoiceService();
      const voice = voiceService.get(voiceId);

      if (!voice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(voice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        success: true,
        data: voice,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/voice/create
   *
   * Create a manual voice profile.
   */
  router.post('/create', (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = VoiceCreateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { bookId, name, description, sampleText } = validation.data;

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const userId = getUserId(req);
      const voiceService = getVoiceService();

      const voice = voiceService.create({
        bookId,
        name,
        description,
        sampleText,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'voice:created',
        bookId,
        entityType: 'voice',
        entityId: voice.id,
        payload: { name: voice.name },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: voice,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/voice/:voiceId
   *
   * Update a voice profile.
   */
  router.patch('/:voiceId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { voiceId } = req.params;

      const validation = VoiceUpdateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const voiceService = getVoiceService();
      const existingVoice = voiceService.get(voiceId);

      if (!existingVoice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(existingVoice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updatedVoice = voiceService.update(voiceId, validation.data);

      if (!updatedVoice) {
        return res.status(500).json({ error: 'Failed to update voice' });
      }

      // Broadcast event
      broadcastEvent({
        type: 'voice:updated',
        bookId: existingVoice.bookId,
        entityType: 'voice',
        entityId: voiceId,
        payload: { name: updatedVoice.name },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: updatedVoice,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/voice/:voiceId
   *
   * Delete a voice profile.
   */
  router.delete('/:voiceId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { voiceId } = req.params;

      const voiceService = getVoiceService();
      const voice = voiceService.get(voiceId);

      if (!voice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(voice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      voiceService.delete(voiceId);

      // Broadcast event
      broadcastEvent({
        type: 'voice:deleted',
        bookId: voice.bookId,
        entityType: 'voice',
        entityId: voiceId,
        payload: { name: voice.name },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        message: 'Voice deleted',
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Primary Voice Routes
  // ============================================================================

  /**
   * POST /api/voice/:voiceId/primary
   *
   * Set a voice as primary for its book.
   */
  router.post('/:voiceId/primary', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { voiceId } = req.params;

      const voiceService = getVoiceService();
      const voice = voiceService.get(voiceId);

      if (!voice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(voice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      voiceService.setPrimary(voiceId);

      // Broadcast event
      broadcastEvent({
        type: 'voice:primary',
        bookId: voice.bookId,
        entityType: 'voice',
        entityId: voiceId,
        payload: { name: voice.name },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        message: `${voice.name} set as primary voice`,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Application Routes
  // ============================================================================

  /**
   * POST /api/voice/apply
   *
   * Apply a voice to transform content.
   */
  router.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = VoiceApplySchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { voiceId, content, strengthFactor } = validation.data;

      const voiceService = getVoiceService();
      const voice = voiceService.get(voiceId);

      if (!voice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(voice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const result = await voiceService.apply({
        voiceId,
        content,
        strengthFactor,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Features Routes
  // ============================================================================

  /**
   * GET /api/voice/:voiceId/features
   *
   * Get extracted features for a voice.
   */
  router.get('/:voiceId/features', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { voiceId } = req.params;

      const voiceService = getVoiceService();
      const voice = voiceService.get(voiceId);

      if (!voice) {
        return res.status(404).json({ error: 'Voice not found' });
      }

      if (!verifyBookOwnership(voice.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        success: true,
        data: voice.extractedFeatures,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
