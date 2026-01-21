/**
 * AssignmentService - Server-side Card-to-Chapter Assignment
 *
 * Moved from: apps/web/src/lib/book-studio/assignment-agent.ts
 *
 * Assigns harvest cards to chapters based on semantic analysis
 * of card content and chapter titles.
 */

import Database from 'better-sqlite3';
import { getDatabase, DbCard, DbChapter, now } from '../database';
import { getConfig } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface CardAssignmentProposal {
  cardId: string;
  suggestedChapterId: string;
  confidence: number;
  reasoning: string;
  alternatives?: Array<{
    chapterId: string;
    confidence: number;
  }>;
}

export interface AssignmentProposalBatch {
  proposals: CardAssignmentProposal[];
  generatedAt: string;
  totalCards: number;
  assignedCards: number;
  unassignedCards: number;
}

export interface AssignmentOptions {
  minConfidence?: number;
  maxAlternatives?: number;
  autoApply?: boolean;
}

export interface AssignmentResult {
  batch: AssignmentProposalBatch;
  appliedCount?: number;
  error?: string;
}

// Internal types
interface HarvestCard {
  id: string;
  content: string;
  title?: string;
}

interface Chapter {
  id: string;
  title: string;
  draftInstructions?: string;
}

// ============================================================================
// Stop Words
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'was', 'are', 'were', 'been', 'be', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'what', 'which', 'who', 'if', 'because', 'as', 'so',
]);

// ============================================================================
// AssignmentService
// ============================================================================

export class AssignmentService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Get staging cards for a book
   */
  private getBookCards(bookId: string): HarvestCard[] {
    const rows = this.db.prepare(
      'SELECT id, content, title FROM cards WHERE book_id = ? AND status = ?'
    ).all(bookId, 'staging') as Array<{ id: string; content: string; title: string | null }>;

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      title: row.title || undefined,
    }));
  }

  /**
   * Get chapters for a book
   */
  private getBookChapters(bookId: string): Chapter[] {
    const rows = this.db.prepare(
      'SELECT id, title, draft_instructions FROM chapters WHERE book_id = ? ORDER BY "order"'
    ).all(bookId) as Array<{ id: string; title: string; draft_instructions: string | null }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      draftInstructions: row.draft_instructions || undefined,
    }));
  }

  /**
   * Assign cards to chapters for a book
   */
  assignCardsToChapters(
    bookId: string,
    options: AssignmentOptions = {}
  ): AssignmentResult {
    const config = getConfig();
    const opts = {
      minConfidence: options.minConfidence ?? config.assignment.minConfidence,
      maxAlternatives: options.maxAlternatives ?? config.assignment.maxAlternatives,
      autoApply: options.autoApply ?? config.assignment.autoAssignHighConfidence,
    };

    const cards = this.getBookCards(bookId);
    const chapters = this.getBookChapters(bookId);

    if (chapters.length === 0) {
      return {
        batch: {
          proposals: [],
          generatedAt: new Date().toISOString(),
          totalCards: cards.length,
          assignedCards: 0,
          unassignedCards: cards.length,
        },
        error: 'No chapters available for assignment',
      };
    }

    if (cards.length === 0) {
      return {
        batch: {
          proposals: [],
          generatedAt: new Date().toISOString(),
          totalCards: 0,
          assignedCards: 0,
          unassignedCards: 0,
        },
      };
    }

    // Generate proposals
    const batch = this.generateProposals(cards, chapters, opts);

    // Auto-apply high-confidence assignments if enabled
    let appliedCount = 0;
    if (opts.autoApply) {
      const highConfidenceThreshold = config.assignment.highConfidenceThreshold;
      const toApply = batch.proposals.filter(p => p.confidence >= highConfidenceThreshold);
      appliedCount = this.applyProposals(toApply);
    }

    return {
      batch,
      appliedCount: opts.autoApply ? appliedCount : undefined,
    };
  }

  /**
   * Generate assignment proposals using keyword matching
   */
  private generateProposals(
    cards: HarvestCard[],
    chapters: Chapter[],
    opts: { minConfidence: number; maxAlternatives: number }
  ): AssignmentProposalBatch {
    const proposals: CardAssignmentProposal[] = [];

    for (const card of cards) {
      const scores: Array<{ chapter: Chapter; score: number }> = [];

      for (const chapter of chapters) {
        // Score based on title match
        const titleScore = this.calculateRelevance(card.content, chapter.title);

        // Boost if card title matches chapter
        const cardTitleScore = card.title
          ? this.calculateRelevance(card.title, chapter.title) * 0.5
          : 0;

        // Boost if draft instructions match
        const instructionScore = chapter.draftInstructions
          ? this.calculateRelevance(card.content, chapter.draftInstructions) * 0.3
          : 0;

        const totalScore = Math.min(1, titleScore + cardTitleScore + instructionScore);
        scores.push({ chapter, score: totalScore });
      }

      // Sort by score descending
      scores.sort((a, b) => b.score - a.score);

      // Get best match
      const best = scores[0];
      if (best && best.score >= opts.minConfidence) {
        // Get alternatives (next best matches above threshold)
        const alternatives = scores
          .slice(1, opts.maxAlternatives + 1)
          .filter(s => s.score >= opts.minConfidence * 0.7)
          .map(s => ({ chapterId: s.chapter.id, confidence: s.score }));

        proposals.push({
          cardId: card.id,
          suggestedChapterId: best.chapter.id,
          confidence: best.score,
          reasoning: `Keyword match with "${best.chapter.title}"`,
          alternatives: alternatives.length > 0 ? alternatives : undefined,
        });
      }
    }

    return {
      proposals,
      generatedAt: new Date().toISOString(),
      totalCards: cards.length,
      assignedCards: proposals.length,
      unassignedCards: cards.length - proposals.length,
    };
  }

  /**
   * Apply assignment proposals to cards
   */
  applyProposals(proposals: CardAssignmentProposal[]): number {
    if (proposals.length === 0) return 0;

    const stmt = this.db.prepare(`
      UPDATE cards
      SET chapter_id = ?, status = 'placed', updated_at = ?
      WHERE id = ?
    `);

    const timestamp = now();
    let applied = 0;

    for (const proposal of proposals) {
      try {
        stmt.run(proposal.suggestedChapterId, timestamp, proposal.cardId);
        applied++;
      } catch (error) {
        console.error(`[AssignmentService] Failed to apply proposal for card ${proposal.cardId}:`, error);
      }
    }

    return applied;
  }

  /**
   * Apply proposals with confirmation
   */
  applySelectedProposals(
    bookId: string,
    cardIds: string[],
    chapterAssignments: Record<string, string>
  ): number {
    const stmt = this.db.prepare(`
      UPDATE cards
      SET chapter_id = ?, status = 'placed', updated_at = ?
      WHERE id = ? AND book_id = ?
    `);

    const timestamp = now();
    let applied = 0;

    for (const cardId of cardIds) {
      const chapterId = chapterAssignments[cardId];
      if (!chapterId) continue;

      try {
        const result = stmt.run(chapterId, timestamp, cardId, bookId);
        if (result.changes > 0) applied++;
      } catch (error) {
        console.error(`[AssignmentService] Failed to assign card ${cardId}:`, error);
      }
    }

    return applied;
  }

  // ============================================================================
  // Relevance Calculation
  // ============================================================================

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
    );
  }

  /**
   * Calculate keyword overlap between two texts
   */
  private calculateRelevance(cardContent: string, targetText: string): number {
    const cardKeywords = this.extractKeywords(cardContent);
    const targetKeywords = this.extractKeywords(targetText);

    if (targetKeywords.size === 0) return 0;

    let matches = 0;
    for (const keyword of targetKeywords) {
      // Check for exact match or partial match
      for (const cardKeyword of cardKeywords) {
        if (cardKeyword.includes(keyword) || keyword.includes(cardKeyword)) {
          matches++;
          break;
        }
      }
    }

    return matches / targetKeywords.size;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Filter proposals by confidence threshold
   */
  filterProposalsByConfidence(
    proposals: CardAssignmentProposal[],
    minConfidence: number
  ): CardAssignmentProposal[] {
    return proposals.filter(p => p.confidence >= minConfidence);
  }

  /**
   * Group proposals by chapter
   */
  groupProposalsByChapter(
    proposals: CardAssignmentProposal[]
  ): Record<string, CardAssignmentProposal[]> {
    const groups: Record<string, CardAssignmentProposal[]> = {};

    for (const proposal of proposals) {
      if (!groups[proposal.suggestedChapterId]) {
        groups[proposal.suggestedChapterId] = [];
      }
      groups[proposal.suggestedChapterId].push(proposal);
    }

    return groups;
  }

  /**
   * Get assignment statistics for a book
   */
  getAssignmentStats(bookId: string): {
    totalCards: number;
    stagingCards: number;
    placedCards: number;
    chaptersWithCards: number;
    averageCardsPerChapter: number;
  } {
    const totalCards = this.db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE book_id = ?'
    ).get(bookId) as { count: number };

    const stagingCards = this.db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE book_id = ? AND status = ?'
    ).get(bookId, 'staging') as { count: number };

    const placedCards = this.db.prepare(
      'SELECT COUNT(*) as count FROM cards WHERE book_id = ? AND status = ?'
    ).get(bookId, 'placed') as { count: number };

    const chaptersWithCards = this.db.prepare(`
      SELECT COUNT(DISTINCT chapter_id) as count
      FROM cards
      WHERE book_id = ? AND chapter_id IS NOT NULL
    `).get(bookId) as { count: number };

    const totalChapters = this.db.prepare(
      'SELECT COUNT(*) as count FROM chapters WHERE book_id = ?'
    ).get(bookId) as { count: number };

    return {
      totalCards: totalCards.count,
      stagingCards: stagingCards.count,
      placedCards: placedCards.count,
      chaptersWithCards: chaptersWithCards.count,
      averageCardsPerChapter: totalChapters.count > 0
        ? placedCards.count / totalChapters.count
        : 0,
    };
  }
}

// Singleton instance
let assignmentServiceInstance: AssignmentService | null = null;

export function getAssignmentService(): AssignmentService {
  if (!assignmentServiceInstance) {
    assignmentServiceInstance = new AssignmentService();
  }
  return assignmentServiceInstance;
}
