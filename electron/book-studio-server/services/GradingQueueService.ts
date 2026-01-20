/**
 * GradingQueueService - Server-Side Queue Management
 *
 * Manages the grading queue in SQLite:
 * - Enqueue cards for grading
 * - Process queue items in background
 * - Track status and errors
 * - Retry failed items
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, type DbCard } from '../database';
import { getGradingService, type CardGrade } from './GradingService';
import { broadcastEvent } from '../server';

// ============================================================================
// Types
// ============================================================================

export interface QueueItem {
  id: string;
  bookId: string;
  cardId: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  recentErrors: Array<{ cardId: string; error: string; updatedAt: number }>;
}

export interface GradeResult {
  cardId: string;
  bookId: string;
  grade: CardGrade;
  success: boolean;
  error?: string;
}

// ============================================================================
// Service
// ============================================================================

export class GradingQueueService {
  private db: Database.Database;
  private processing = false;
  private processInterval: NodeJS.Timeout | null = null;
  private maxAttempts = 3;
  private processDelayMs = 500;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Add a card to the grading queue
   */
  enqueue(bookId: string, cardId: string, priority: number = 1): void {
    const now = Math.floor(Date.now() / 1000);

    // Use INSERT OR REPLACE to handle existing items
    this.db.prepare(`
      INSERT INTO grading_queue (id, book_id, card_id, priority, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET
        priority = MAX(priority, excluded.priority),
        status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
        updated_at = excluded.updated_at
    `).run(uuidv4(), bookId, cardId, priority, now, now);
  }

  /**
   * Add multiple cards to the queue (for batch operations)
   */
  enqueueBatch(items: Array<{ bookId: string; cardId: string; priority?: number }>): number {
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      INSERT INTO grading_queue (id, book_id, card_id, priority, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET
        priority = MAX(priority, excluded.priority),
        status = CASE WHEN status = 'failed' THEN 'pending' ELSE status END,
        updated_at = excluded.updated_at
    `);

    const insertMany = this.db.transaction((batch: typeof items) => {
      let count = 0;
      for (const item of batch) {
        try {
          stmt.run(uuidv4(), item.bookId, item.cardId, item.priority || 1, now, now);
          count++;
        } catch (error) {
          console.warn(`[GradingQueueService] Failed to enqueue ${item.cardId}:`, error);
        }
      }
      return count;
    });

    return insertMany(items);
  }

  /**
   * Process the next pending item in the queue
   */
  async processNext(): Promise<GradeResult | null> {
    // Get next pending item (highest priority, oldest first)
    const item = this.db.prepare(`
      SELECT gq.*, c.content, c.source_type, c.author_name
      FROM grading_queue gq
      JOIN cards c ON c.id = gq.card_id
      WHERE gq.status = 'pending'
      ORDER BY gq.priority DESC, gq.created_at ASC
      LIMIT 1
    `).get() as (QueueItem & { content: string; source_type: string; author_name: string | null }) | undefined;

    if (!item) return null;

    const now = Math.floor(Date.now() / 1000);

    // Mark as processing
    this.db.prepare(`
      UPDATE grading_queue
      SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `).run(now, item.id);

    try {
      // Grade the card
      const gradingService = getGradingService();
      const grade = await gradingService.fullGrade({
        id: item.cardId,
        content: item.content,
        sourceType: item.source_type,
        authorName: item.author_name || undefined,
      });

      // Update card with grade
      this.db.prepare(`
        UPDATE cards SET grade = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(grade), now, item.cardId);

      // Mark queue item as completed
      this.db.prepare(`
        UPDATE grading_queue SET status = 'completed', updated_at = ? WHERE id = ?
      `).run(now, item.id);

      // Broadcast event
      broadcastEvent({
        type: 'card:graded',
        bookId: item.bookId,
        entityType: 'card',
        entityId: item.cardId,
        payload: { grade },
        timestamp: Date.now(),
      });

      return {
        cardId: item.cardId,
        bookId: item.bookId,
        grade,
        success: true,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if max attempts reached
      const shouldRetry = item.attempts + 1 < this.maxAttempts;
      const newStatus = shouldRetry ? 'pending' : 'failed';

      this.db.prepare(`
        UPDATE grading_queue
        SET status = ?, error = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, errorMsg, now, item.id);

      console.error(
        `[GradingQueueService] Failed to grade ${item.cardId} (attempt ${item.attempts + 1}):`,
        error
      );

      return {
        cardId: item.cardId,
        bookId: item.bookId,
        grade: {} as CardGrade,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get queue status
   */
  getStatus(bookId?: string): QueueStatus {
    const whereClause = bookId ? 'WHERE book_id = ?' : '';
    const params = bookId ? [bookId] : [];

    const counts = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM grading_queue ${whereClause}
    `).get(...params) as {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      total: number;
    };

    const recentErrors = this.db.prepare(`
      SELECT card_id as cardId, error, updated_at as updatedAt
      FROM grading_queue
      ${whereClause ? whereClause + ' AND status = ?' : 'WHERE status = ?'}
      ORDER BY updated_at DESC
      LIMIT 5
    `).all(...params, 'failed') as Array<{ cardId: string; error: string; updatedAt: number }>;

    return {
      pending: counts.pending || 0,
      processing: counts.processing || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      total: counts.total || 0,
      recentErrors,
    };
  }

  /**
   * Clear the queue (optionally for a specific book)
   */
  clear(bookId?: string): number {
    if (bookId) {
      const result = this.db.prepare(
        "DELETE FROM grading_queue WHERE book_id = ? AND status IN ('pending', 'failed')"
      ).run(bookId);
      return result.changes;
    } else {
      const result = this.db.prepare(
        "DELETE FROM grading_queue WHERE status IN ('pending', 'failed')"
      ).run();
      return result.changes;
    }
  }

  /**
   * Retry all failed items
   */
  retryFailed(bookId?: string): number {
    const now = Math.floor(Date.now() / 1000);
    const whereClause = bookId ? 'AND book_id = ?' : '';
    const params = bookId ? [now, now, bookId] : [now, now];

    const result = this.db.prepare(`
      UPDATE grading_queue
      SET status = 'pending', attempts = 0, error = NULL, updated_at = ?
      WHERE status = 'failed' ${whereClause}
    `).run(...params);

    return result.changes;
  }

  /**
   * Remove item from queue
   */
  remove(cardId: string): void {
    this.db.prepare('DELETE FROM grading_queue WHERE card_id = ?').run(cardId);
  }

  /**
   * Start background processing
   */
  startWorker(): void {
    if (this.processInterval) return;

    console.log('[GradingQueueService] Starting background worker');

    this.processInterval = setInterval(async () => {
      if (this.processing) return;

      this.processing = true;
      try {
        const result = await this.processNext();
        if (result) {
          console.log(
            `[GradingQueueService] Processed ${result.cardId}: ${result.success ? 'success' : 'failed'}`
          );
        }
      } catch (error) {
        console.error('[GradingQueueService] Worker error:', error);
      } finally {
        this.processing = false;
      }
    }, this.processDelayMs);
  }

  /**
   * Stop background processing
   */
  stopWorker(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      console.log('[GradingQueueService] Stopped background worker');
    }
  }

  /**
   * Check if worker is running
   */
  isWorkerRunning(): boolean {
    return this.processInterval !== null;
  }

  /**
   * Get queue items for a book
   */
  getQueueItems(bookId: string, status?: QueueItem['status']): QueueItem[] {
    const whereClause = status
      ? 'WHERE book_id = ? AND status = ?'
      : 'WHERE book_id = ?';
    const params = status ? [bookId, status] : [bookId];

    return this.db.prepare(`
      SELECT id, book_id as bookId, card_id as cardId, priority, status, attempts, error, created_at as createdAt, updated_at as updatedAt
      FROM grading_queue
      ${whereClause}
      ORDER BY priority DESC, created_at ASC
    `).all(...params) as QueueItem[];
  }
}

// Singleton instance
let queueServiceInstance: GradingQueueService | null = null;

export function getGradingQueueService(): GradingQueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new GradingQueueService();
  }
  return queueServiceInstance;
}
