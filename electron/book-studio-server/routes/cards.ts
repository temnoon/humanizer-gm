/**
 * Cards API Routes
 *
 * Handles harvest cards - the building blocks of books.
 * All routes require authentication and verify book ownership.
 */

import { Router, Request, Response } from 'express';
import { getDatabase, generateId, now, DbCard, DbBook } from '../database';
import { broadcastEvent } from '../server';
import { requireAuth, getUserId, isOwner } from '../middleware/auth';
import { getAssignmentService } from '../services/AssignmentService';

export function createCardsRouter(): Router {
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

  // GET /api/cards?bookId=xxx&status=staging - List cards
  router.get('/', (req: Request, res: Response) => {
    try {
      const { bookId, status, chapterId, limit = '100', offset = '0' } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(bookId as string, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const conditions = ['book_id = ?'];
      const values: (string | number)[] = [bookId as string];

      if (status) {
        conditions.push('status = ?');
        values.push(status as string);
      }

      if (chapterId) {
        if (chapterId === 'null') {
          conditions.push('chapter_id IS NULL');
        } else {
          conditions.push('chapter_id = ?');
          values.push(chapterId as string);
        }
      }

      values.push(parseInt(limit as string, 10));
      values.push(parseInt(offset as string, 10));

      const cards = db.prepare(`
        SELECT * FROM cards
        WHERE ${conditions.join(' AND ')}
        ORDER BY harvested_at DESC
        LIMIT ? OFFSET ?
      `).all(...values) as DbCard[];

      // Parse JSON fields
      const parsedCards = cards.map(parseCardJsonFields);

      res.json({ cards: parsedCards });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/cards/:id - Get a single card
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();
      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard | undefined;

      if (!card) {
        return res.status(404).json({ error: 'Card not found' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(card.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({ card: parseCardJsonFields(card) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards - Create a new card (harvest)
  router.post('/', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const {
        bookId,
        sourceId,
        sourceType,
        source,
        contentOrigin = 'original',
        content,
        title,
        authorName,
        similarity,
        sourceCreatedAt,
        sourceCreatedAtStatus = 'unknown',
        sourceUrl,
        conversationId,
        conversationTitle,
        userNotes = '',
        aiContext,
        aiSummary,
        tags = [],
        canvasPosition,
        metadata,
        grade,
        isOutline = false,
        outlineStructure,
      } = req.body;

      if (!bookId || !sourceId || !sourceType || !source || !content) {
        return res.status(400).json({ error: 'bookId, sourceId, sourceType, source, and content are required' });
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
        INSERT INTO cards (
          id, book_id, source_id, source_type, source, content_origin, content,
          title, author_name, similarity, source_created_at, source_created_at_status,
          harvested_at, source_url, conversation_id, conversation_title,
          user_notes, ai_context, ai_summary, tags, canvas_position, status,
          metadata, grade, is_outline, outline_structure, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, bookId, sourceId, sourceType, source, contentOrigin, content,
        title || null, authorName || null, similarity || null,
        sourceCreatedAt || null, sourceCreatedAtStatus, timestamp,
        sourceUrl || null, conversationId || null, conversationTitle || null,
        userNotes, aiContext || null, aiSummary || null,
        JSON.stringify(tags), canvasPosition ? JSON.stringify(canvasPosition) : null,
        'staging', metadata ? JSON.stringify(metadata) : null,
        grade ? JSON.stringify(grade) : null, isOutline ? 1 : 0,
        outlineStructure ? JSON.stringify(outlineStructure) : null,
        userId, timestamp, timestamp
      );

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as DbCard;

      // Broadcast event
      broadcastEvent({
        type: 'card-harvested',
        bookId,
        entityType: 'card',
        entityId: id,
        payload: parseCardJsonFields(card),
        timestamp: Date.now(),
      });

      res.status(201).json({ card: parseCardJsonFields(card) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards/batch - Harvest multiple cards
  router.post('/batch', (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { bookId, cards: cardsData } = req.body;

      if (!bookId || !Array.isArray(cardsData) || cardsData.length === 0) {
        return res.status(400).json({ error: 'bookId and cards array are required' });
      }

      // Verify book ownership
      const book = verifyBookOwnership(bookId, req);
      if (!book) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const db = getDatabase();
      const timestamp = now();
      const createdCards: DbCard[] = [];

      const insertStmt = db.prepare(`
        INSERT INTO cards (
          id, book_id, source_id, source_type, source, content_origin, content,
          title, author_name, similarity, source_created_at, source_created_at_status,
          harvested_at, source_url, conversation_id, conversation_title,
          user_notes, ai_context, ai_summary, tags, canvas_position, status,
          metadata, grade, is_outline, outline_structure, user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((items: typeof cardsData) => {
        for (const item of items) {
          const id = generateId();
          insertStmt.run(
            id, bookId, item.sourceId, item.sourceType, item.source,
            item.contentOrigin || 'original', item.content,
            item.title || null, item.authorName || null, item.similarity || null,
            item.sourceCreatedAt || null, item.sourceCreatedAtStatus || 'unknown',
            timestamp, item.sourceUrl || null, item.conversationId || null,
            item.conversationTitle || null, item.userNotes || '',
            item.aiContext || null, item.aiSummary || null,
            JSON.stringify(item.tags || []),
            item.canvasPosition ? JSON.stringify(item.canvasPosition) : null,
            'staging', item.metadata ? JSON.stringify(item.metadata) : null,
            item.grade ? JSON.stringify(item.grade) : null,
            item.isOutline ? 1 : 0,
            item.outlineStructure ? JSON.stringify(item.outlineStructure) : null,
            userId, timestamp, timestamp
          );
          const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as DbCard;
          createdCards.push(card);
        }
      });

      insertMany(cardsData);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      // Broadcast event
      broadcastEvent({
        type: 'cards-batch-harvested',
        bookId,
        entityType: 'card',
        payload: createdCards.map(parseCardJsonFields),
        timestamp: Date.now(),
      });

      res.status(201).json({ cards: createdCards.map(parseCardJsonFields) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards/batch-update - Batch update multiple cards
  router.post('/batch-update', (req: Request, res: Response) => {
    try {
      const { cardIds, updates } = req.body;

      if (!Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ error: 'cardIds array is required' });
      }

      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'updates object is required' });
      }

      const db = getDatabase();
      const timestamp = now();
      const updatedCards: DbCard[] = [];
      let bookId: string | null = null;

      // Build update statement dynamically based on provided updates
      const updateFields: string[] = ['updated_at = ?'];
      const baseValues: (string | number | null)[] = [timestamp];

      if (updates.suggestedChapterId !== undefined) {
        updateFields.push('chapter_id = ?');
        baseValues.push(updates.suggestedChapterId);
      }
      if (updates.status !== undefined) {
        updateFields.push('status = ?');
        baseValues.push(updates.status);
      }
      if (updates.grade !== undefined) {
        updateFields.push('grade = ?');
        baseValues.push(updates.grade ? JSON.stringify(updates.grade) : null);
      }
      if (updates.tags !== undefined) {
        updateFields.push('tags = ?');
        baseValues.push(JSON.stringify(updates.tags));
      }

      const updateMany = db.transaction((ids: string[]) => {
        for (const cardId of ids) {
          const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as DbCard | undefined;
          if (!existing) continue;

          // Verify book ownership (first card sets the bookId, subsequent must match)
          if (!bookId) {
            if (!verifyBookOwnership(existing.book_id, req)) {
              throw new Error('Access denied');
            }
            bookId = existing.book_id;
          } else if (existing.book_id !== bookId) {
            continue; // Skip cards from different books
          }

          const values = [...baseValues, cardId];
          db.prepare(`
            UPDATE cards SET ${updateFields.join(', ')} WHERE id = ?
          `).run(...values);

          const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as DbCard;
          updatedCards.push(updated);
        }
      });

      updateMany(cardIds);

      // Update book's updated_at if we have a bookId
      if (bookId) {
        db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

        // Broadcast event
        broadcastEvent({
          type: 'cards-batch-updated',
          bookId,
          entityType: 'card',
          payload: updatedCards.map(parseCardJsonFields),
          timestamp: Date.now(),
        });
      }

      res.json({
        updatedCount: updatedCards.length,
        cards: updatedCards.map(parseCardJsonFields),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards/assign-to-chapters - Auto-assign cards to chapters
  router.post('/assign-to-chapters', (req: Request, res: Response) => {
    try {
      const { bookId, options = {} } = req.body;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      // Verify book ownership
      const book = verifyBookOwnership(bookId, req);
      if (!book) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const assignmentService = getAssignmentService();
      const result = assignmentService.assignCardsToChapters(bookId, {
        minConfidence: options.minConfidence,
        maxAlternatives: options.maxAlternatives,
        autoApply: options.autoApply,
      });

      if (result.error && result.batch.proposals.length === 0) {
        return res.status(400).json({
          error: result.error,
          batch: result.batch,
        });
      }

      // Broadcast event if any cards were assigned
      if (result.appliedCount && result.appliedCount > 0) {
        const db = getDatabase();
        const timestamp = now();
        db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

        broadcastEvent({
          type: 'cards-assigned',
          bookId,
          entityType: 'card',
          payload: {
            assignedCount: result.appliedCount,
            totalProposals: result.batch.proposals.length,
          },
          timestamp: Date.now(),
        });
      }

      res.json({
        success: true,
        batch: result.batch,
        appliedCount: result.appliedCount,
        message: result.error || `Generated ${result.batch.proposals.length} assignment proposals`,
      });
    } catch (err) {
      console.error('[cards] Assignment failed:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards/apply-assignments - Apply selected assignment proposals
  router.post('/apply-assignments', (req: Request, res: Response) => {
    try {
      const { bookId, cardIds, chapterAssignments } = req.body;

      if (!bookId || !Array.isArray(cardIds) || !chapterAssignments) {
        return res.status(400).json({ error: 'bookId, cardIds, and chapterAssignments are required' });
      }

      // Verify book ownership
      const book = verifyBookOwnership(bookId, req);
      if (!book) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const assignmentService = getAssignmentService();
      const appliedCount = assignmentService.applySelectedProposals(bookId, cardIds, chapterAssignments);

      // Update book's updated_at
      const db = getDatabase();
      const timestamp = now();
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, bookId);

      // Broadcast event
      broadcastEvent({
        type: 'cards-assigned',
        bookId,
        entityType: 'card',
        payload: { assignedCount: appliedCount },
        timestamp: Date.now(),
      });

      res.json({
        success: true,
        appliedCount,
        message: `Applied ${appliedCount} assignments`,
      });
    } catch (err) {
      console.error('[cards] Apply assignments failed:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/cards/assignment-stats - Get assignment statistics for a book
  router.get('/assignment-stats', (req: Request, res: Response) => {
    try {
      const { bookId } = req.query;

      if (!bookId) {
        return res.status(400).json({ error: 'bookId is required' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(bookId as string, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const assignmentService = getAssignmentService();
      const stats = assignmentService.getAssignmentStats(bookId as string);

      res.json({ stats });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/cards/:id - Update a card
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Card not found' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(existing.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const {
        chapterId, userNotes, tags, canvasPosition, status,
        grade, isOutline, outlineStructure, aiContext, aiSummary,
      } = req.body;

      const updates: string[] = ['updated_at = ?'];
      const values: (string | number | null)[] = [now()];

      if (chapterId !== undefined) {
        updates.push('chapter_id = ?');
        values.push(chapterId);
        // If assigning to chapter, update status
        if (chapterId && status === undefined) {
          updates.push('status = ?');
          values.push('placed');
        }
      }
      if (userNotes !== undefined) {
        updates.push('user_notes = ?');
        values.push(userNotes);
      }
      if (tags !== undefined) {
        updates.push('tags = ?');
        values.push(JSON.stringify(tags));
      }
      if (canvasPosition !== undefined) {
        updates.push('canvas_position = ?');
        values.push(canvasPosition ? JSON.stringify(canvasPosition) : null);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        values.push(status);
      }
      if (grade !== undefined) {
        updates.push('grade = ?');
        values.push(grade ? JSON.stringify(grade) : null);
      }
      if (isOutline !== undefined) {
        updates.push('is_outline = ?');
        values.push(isOutline ? 1 : 0);
      }
      if (outlineStructure !== undefined) {
        updates.push('outline_structure = ?');
        values.push(outlineStructure ? JSON.stringify(outlineStructure) : null);
      }
      if (aiContext !== undefined) {
        updates.push('ai_context = ?');
        values.push(aiContext);
      }
      if (aiSummary !== undefined) {
        updates.push('ai_summary = ?');
        values.push(aiSummary);
      }

      values.push(req.params.id);

      db.prepare(`
        UPDATE cards SET ${updates.join(', ')} WHERE id = ?
      `).run(...values);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(now(), existing.book_id);

      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard;

      // Broadcast event
      broadcastEvent({
        type: 'card-updated',
        bookId: existing.book_id,
        entityType: 'card',
        entityId: req.params.id,
        payload: parseCardJsonFields(card),
        timestamp: Date.now(),
      });

      res.json({ card: parseCardJsonFields(card) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // DELETE /api/cards/:id - Delete a card
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Card not found' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(existing.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(now(), existing.book_id);

      // Broadcast event
      broadcastEvent({
        type: 'card-deleted',
        bookId: existing.book_id,
        entityType: 'card',
        entityId: req.params.id,
        timestamp: Date.now(),
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/cards/:id/move - Move card to chapter
  router.post('/:id/move', (req: Request, res: Response) => {
    try {
      const { chapterId } = req.body;
      const db = getDatabase();

      const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard | undefined;
      if (!existing) {
        return res.status(404).json({ error: 'Card not found' });
      }

      // Verify book ownership
      if (!verifyBookOwnership(existing.book_id, req)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const timestamp = now();

      db.prepare(`
        UPDATE cards SET chapter_id = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(chapterId || null, chapterId ? 'placed' : 'staging', timestamp, req.params.id);

      // Update book's updated_at
      db.prepare('UPDATE books SET updated_at = ? WHERE id = ?').run(timestamp, existing.book_id);

      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(req.params.id) as DbCard;

      // Broadcast event
      broadcastEvent({
        type: 'card-moved',
        bookId: existing.book_id,
        entityType: 'card',
        entityId: req.params.id,
        payload: { chapterId, card: parseCardJsonFields(card) },
        timestamp: Date.now(),
      });

      res.json({ card: parseCardJsonFields(card) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// Helper to parse JSON fields from database
function parseCardJsonFields(card: DbCard): Record<string, unknown> {
  return {
    ...card,
    tags: JSON.parse(card.tags || '[]'),
    canvasPosition: card.canvas_position ? JSON.parse(card.canvas_position) : null,
    metadata: card.metadata ? JSON.parse(card.metadata) : null,
    grade: card.grade ? JSON.parse(card.grade) : null,
    outlineStructure: card.outline_structure ? JSON.parse(card.outline_structure) : null,
    isOutline: Boolean(card.is_outline),
  };
}
