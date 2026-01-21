/**
 * Harvest API Routes
 *
 * Handles content harvest operations - searching archive, committing results,
 * tracking history, and managing harvest instructions.
 *
 * All routes require authentication and verify book ownership.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase, DbBook, DbCard } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';
import { validateQuery } from '../middleware/validation';
import {
  getHarvestService,
  type HarvestSearchResult,
} from '../services/HarvestService';

// ============================================================================
// Validation Schemas
// ============================================================================

const HarvestSearchSchema = z.object({
  bookId: z.string().min(1),
  query: z.string().min(1).max(1000),
  chapterId: z.string().optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  limit: z.number().min(1).max(100).optional(),
  sourceTypes: z.array(z.string()).optional(),
  dateRangeStart: z.number().optional(),
  dateRangeEnd: z.number().optional(),
});

const HarvestCommitSchema = z.object({
  harvestId: z.string().min(1),
  acceptedIds: z.array(z.string()),
  rejectedIds: z.array(z.string()).optional(),
  results: z
    .array(
      z.object({
        id: z.string(),
        source_id: z.string(),
        source_type: z.string(),
        source: z.string(),
        content: z.string(),
        title: z.string().optional(),
        author_name: z.string().optional(),
        similarity: z.number(),
        source_created_at: z.number().optional(),
        source_url: z.string().optional(),
        conversation_id: z.string().optional(),
        conversation_title: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .optional(),
});

const HarvestIterateSchema = z.object({
  adjustments: z.object({
    query: z.string().optional(),
    similarityThreshold: z.number().min(0).max(1).optional(),
    limit: z.number().min(1).max(100).optional(),
    sourceTypes: z.array(z.string()).optional(),
  }),
  notes: z.string().optional(),
});

const InstructionCreateSchema = z.object({
  bookId: z.string().min(1),
  chapterId: z.string().optional(),
  instructionType: z.enum(['include', 'exclude', 'prefer', 'avoid']),
  instructionText: z.string().min(1).max(500),
  appliesToSources: z.array(z.string()).optional(),
  priority: z.number().min(1).max(10).optional(),
});

// Pagination schema for history endpoint (using coerce for query strings)
const HistoryQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  chapterId: z.string().optional(),
});

// ============================================================================
// Router Factory
// ============================================================================

export function createHarvestRouter(): Router {
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
  // Search Routes
  // ============================================================================

  /**
   * POST /api/harvest/search
   *
   * Search archive for content matching the query.
   * Creates a harvest history entry for tracking.
   */
  router.post('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = HarvestSearchSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { bookId, query, chapterId, similarityThreshold, limit, sourceTypes, dateRangeStart, dateRangeEnd } =
        validation.data;

      // Verify book ownership
      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const userId = getUserId(req);
      const harvestService = getHarvestService();

      const response = await harvestService.search({
        bookId,
        query,
        chapterId,
        similarityThreshold,
        limit,
        sourceTypes,
        dateRangeStart,
        dateRangeEnd,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'harvest:search',
        bookId,
        entityType: 'harvest',
        entityId: response.harvestId,
        payload: { query, resultCount: response.results.length },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: {
          results: response.results,
          harvestId: response.harvestId,
          query: response.query,
          resultCount: response.results.length,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Commit Routes
  // ============================================================================

  /**
   * POST /api/harvest/commit
   *
   * Commit search results as cards.
   * Optionally includes full result data for proper card creation.
   */
  router.post('/commit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = HarvestCommitSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { harvestId, acceptedIds, rejectedIds, results } = validation.data;
      const userId = getUserId(req);
      const harvestService = getHarvestService();

      // Get harvest to verify ownership
      const harvest = harvestService.getHarvest(harvestId);
      if (!harvest) {
        return res.status(404).json({ error: 'Harvest not found' });
      }

      if (!verifyBookOwnership(harvest.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      let response;
      if (results && results.length > 0) {
        // Use full data commit
        response = harvestService.commitWithData(
          harvestId,
          results as HarvestSearchResult[],
          acceptedIds,
          rejectedIds,
          userId
        );
      } else {
        // Use minimal commit (cards will have empty content)
        response = harvestService.commit({
          harvestId,
          acceptedIds,
          rejectedIds,
          userId,
        });
      }

      // Broadcast event
      broadcastEvent({
        type: 'harvest:commit',
        bookId: harvest.bookId,
        entityType: 'harvest',
        entityId: harvestId,
        payload: { committed: response.committed },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: {
          cards: response.cards,
          committed: response.committed,
          harvestId: response.harvestId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // History Routes
  // ============================================================================

  /**
   * GET /api/harvest/history/:bookId
   *
   * Get harvest history for a book.
   */
  router.get('/history/:bookId', validateQuery(HistoryQuerySchema), (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bookId } = req.params;
      // Query params are validated and coerced by HistoryQuerySchema
      const { page, limit, chapterId } = req.query as unknown as { page: number; limit: number; chapterId?: string };

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const harvestService = getHarvestService();
      const result = harvestService.getHistory(bookId, {
        page,
        limit,
        chapterId,
      });

      res.json({
        success: true,
        data: result.harvests,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: result.page * result.pageSize < result.total,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/harvest/:harvestId
   *
   * Get a specific harvest entry.
   */
  router.get('/:harvestId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { harvestId } = req.params;

      const harvestService = getHarvestService();
      const harvest = harvestService.getHarvest(harvestId);

      if (!harvest) {
        return res.status(404).json({ error: 'Harvest not found' });
      }

      if (!verifyBookOwnership(harvest.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        success: true,
        data: harvest,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Iteration Routes
  // ============================================================================

  /**
   * POST /api/harvest/iterate/:harvestId
   *
   * Create an iterative harvest based on a previous one.
   */
  router.post('/iterate/:harvestId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { harvestId } = req.params;

      const validation = HarvestIterateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const harvestService = getHarvestService();
      const parentHarvest = harvestService.getHarvest(harvestId);

      if (!parentHarvest) {
        return res.status(404).json({ error: 'Parent harvest not found' });
      }

      if (!verifyBookOwnership(parentHarvest.bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const userId = getUserId(req);
      const { adjustments, notes } = validation.data;

      const response = await harvestService.iterate({
        harvestId,
        adjustments,
        notes,
        userId,
      });

      // Broadcast event
      broadcastEvent({
        type: 'harvest:iterate',
        bookId: parentHarvest.bookId,
        entityType: 'harvest',
        entityId: response.harvestId,
        payload: {
          parentHarvestId: harvestId,
          resultCount: response.results.length,
        },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        data: {
          results: response.results,
          harvestId: response.harvestId,
          query: response.query,
          resultCount: response.results.length,
          parentHarvestId: harvestId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Suggestion Routes
  // ============================================================================

  /**
   * GET /api/harvest/suggestions/:bookId
   *
   * Get query suggestions based on harvest history.
   */
  router.get('/suggestions/:bookId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bookId } = req.params;

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const harvestService = getHarvestService();
      const suggestions = harvestService.getSuggestions(bookId);

      res.json({
        success: true,
        data: suggestions,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // Instruction Routes
  // ============================================================================

  /**
   * GET /api/harvest/instructions/:bookId
   *
   * Get harvest instructions for a book.
   */
  router.get('/instructions/:bookId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bookId } = req.params;
      const { chapterId } = req.query;

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const harvestService = getHarvestService();
      const instructions = harvestService.getActiveInstructions(bookId, chapterId as string | undefined);

      res.json({
        success: true,
        data: instructions,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/harvest/instructions
   *
   * Create a new harvest instruction.
   */
  router.post('/instructions', (req: Request, res: Response, next: NextFunction) => {
    try {
      const validation = InstructionCreateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.errors,
        });
      }

      const { bookId, chapterId, instructionType, instructionText, appliesToSources, priority } = validation.data;

      if (!verifyBookOwnership(bookId, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const userId = getUserId(req);
      const harvestService = getHarvestService();

      const instruction = harvestService.createInstruction({
        bookId,
        chapterId,
        instructionType,
        instructionText,
        appliesToSources,
        priority,
        userId,
      });

      res.json({
        success: true,
        data: instruction,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/harvest/instructions/:instructionId
   *
   * Delete a harvest instruction.
   */
  router.delete('/instructions/:instructionId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instructionId } = req.params;

      const db = getDatabase();
      const instruction = db
        .prepare('SELECT book_id FROM harvest_instructions WHERE id = ?')
        .get(instructionId) as { book_id: string } | undefined;

      if (!instruction) {
        return res.status(404).json({ error: 'Instruction not found' });
      }

      if (!verifyBookOwnership(instruction.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const harvestService = getHarvestService();
      harvestService.deleteInstruction(instructionId);

      res.json({
        success: true,
        message: 'Instruction deleted',
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PATCH /api/harvest/instructions/:instructionId/toggle
   *
   * Toggle instruction active state.
   */
  router.patch('/instructions/:instructionId/toggle', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instructionId } = req.params;
      const { active } = req.body;

      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'active must be a boolean' });
      }

      const db = getDatabase();
      const instruction = db
        .prepare('SELECT book_id FROM harvest_instructions WHERE id = ?')
        .get(instructionId) as { book_id: string } | undefined;

      if (!instruction) {
        return res.status(404).json({ error: 'Instruction not found' });
      }

      if (!verifyBookOwnership(instruction.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const harvestService = getHarvestService();
      harvestService.toggleInstruction(instructionId, active);

      res.json({
        success: true,
        message: `Instruction ${active ? 'activated' : 'deactivated'}`,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
