/**
 * Assignment Agent Service
 *
 * Frontend service for agent-assisted chapter assignment.
 * Uses the Curator agent to intelligently assign cards to chapters
 * based on semantic analysis of content and chapter titles.
 *
 * NOTE: As of Jan 2026, business logic has moved to server-side.
 * Use assignCardsViaApi when bookId is available.
 * Local assignCardsToChaptersLocal is kept as fallback.
 */

import type {
  HarvestCard,
  Chapter,
  CardAssignmentProposal,
  AssignmentProposalBatch,
} from './types'
import { getAgentBridge } from '../aui/agent-bridge'
import {
  assignCardsToChapters as apiAssignCards,
  applyAssignments as apiApplyAssignments,
  type AssignmentResult as ApiAssignmentResult,
} from './assignment-api'

// ============================================================================
// Types
// ============================================================================

export interface AssignmentRequest {
  cards: HarvestCard[]
  chapters: Chapter[]
  minConfidence?: number  // Minimum confidence to include in proposals
}

export interface AssignmentResult {
  batch: AssignmentProposalBatch
  error?: string
}

// ============================================================================
// Local Heuristic Assignment (Fallback)
// ============================================================================

/**
 * Extract keywords from text for matching
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'is', 'was', 'are', 'were', 'been', 'be', 'have',
    'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
    'we', 'they', 'what', 'which', 'who', 'if', 'because', 'as', 'so',
  ])

  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3 && !stopWords.has(word))
  )
}

/**
 * Calculate keyword overlap between two texts
 */
function calculateRelevance(cardContent: string, chapterTitle: string): number {
  const cardKeywords = extractKeywords(cardContent)
  const chapterKeywords = extractKeywords(chapterTitle)

  if (chapterKeywords.size === 0) return 0

  let matches = 0
  for (const keyword of chapterKeywords) {
    // Check for exact match or partial match
    for (const cardKeyword of cardKeywords) {
      if (cardKeyword.includes(keyword) || keyword.includes(cardKeyword)) {
        matches++
        break
      }
    }
  }

  return matches / chapterKeywords.size
}

/**
 * Local heuristic-based assignment (used as fallback when agent unavailable)
 */
export function assignCardsToChaptersLocal(
  cards: HarvestCard[],
  chapters: Chapter[],
  minConfidence: number = 0.3
): AssignmentProposalBatch {
  const proposals: CardAssignmentProposal[] = []

  for (const card of cards) {
    // Score each chapter for this card
    const scores: Array<{ chapter: Chapter; score: number }> = []

    for (const chapter of chapters) {
      const titleScore = calculateRelevance(card.content, chapter.title)

      // Boost if card title matches chapter
      const cardTitleScore = card.title
        ? calculateRelevance(card.title, chapter.title) * 0.5
        : 0

      const totalScore = Math.min(1, titleScore + cardTitleScore)
      scores.push({ chapter, score: totalScore })
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    // Get best match
    const best = scores[0]
    if (best && best.score >= minConfidence) {
      // Get alternatives (next best matches above threshold)
      const alternatives = scores
        .slice(1, 3)
        .filter(s => s.score >= minConfidence * 0.7)
        .map(s => ({ chapterId: s.chapter.id, confidence: s.score }))

      proposals.push({
        cardId: card.id,
        suggestedChapterId: best.chapter.id,
        confidence: best.score,
        reasoning: `Keyword match with "${best.chapter.title}"`,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
      })
    }
  }

  return {
    proposals,
    generatedAt: new Date().toISOString(),
    totalCards: cards.length,
    assignedCards: proposals.length,
    unassignedCards: cards.length - proposals.length,
  }
}

// ============================================================================
// Agent-Based Assignment
// ============================================================================

/**
 * Request card-to-chapter assignments from the Curator agent.
 * Falls back to local heuristics if agent is unavailable.
 */
export async function assignCardsToChapters(
  request: AssignmentRequest
): Promise<AssignmentResult> {
  const { cards, chapters, minConfidence = 0.3 } = request

  // Early return if no chapters
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
    }
  }

  // Try agent-based assignment first
  try {
    const bridge = getAgentBridge()

    if (bridge.isConnected()) {
      const result = await bridge.requestAgentWork(
        'curator',
        'assign-cards-to-chapters',
        {
          cards: cards.map(c => ({
            id: c.id,
            content: c.content,
            title: c.title,
          })),
          chapters: chapters.map(ch => ({
            id: ch.id,
            title: ch.title,
            description: ch.draftInstructions,
          })),
        }
      )

      if ('taskId' in result) {
        // Task submitted - in real implementation, we'd poll for results
        // For now, fall back to local assignment
        console.log('[assignment-agent] Agent task submitted:', result.taskId)
      }
    }
  } catch (error) {
    console.warn('[assignment-agent] Agent unavailable, using local heuristics:', error)
  }

  // Fall back to local heuristic assignment
  const batch = assignCardsToChaptersLocal(cards, chapters, minConfidence)

  return { batch }
}

/**
 * Apply assignment proposals to cards.
 * Returns the list of card IDs that were updated.
 */
export async function applyAssignmentProposals(
  proposals: CardAssignmentProposal[],
  updateCard: (cardId: string, updates: Partial<HarvestCard>) => Promise<void>
): Promise<string[]> {
  const updatedCardIds: string[] = []

  for (const proposal of proposals) {
    try {
      await updateCard(proposal.cardId, {
        suggestedChapterId: proposal.suggestedChapterId,
        status: 'placed',
      })
      updatedCardIds.push(proposal.cardId)
    } catch (error) {
      console.error(`[assignment-agent] Failed to apply proposal for card ${proposal.cardId}:`, error)
    }
  }

  return updatedCardIds
}

/**
 * Filter proposals by confidence threshold
 */
export function filterProposalsByConfidence(
  proposals: CardAssignmentProposal[],
  minConfidence: number
): CardAssignmentProposal[] {
  return proposals.filter(p => p.confidence >= minConfidence)
}

/**
 * Group proposals by chapter for easier review
 */
export function groupProposalsByChapter(
  proposals: CardAssignmentProposal[]
): Map<string, CardAssignmentProposal[]> {
  const groups = new Map<string, CardAssignmentProposal[]>()

  for (const proposal of proposals) {
    const existing = groups.get(proposal.suggestedChapterId) || []
    existing.push(proposal)
    groups.set(proposal.suggestedChapterId, existing)
  }

  return groups
}

// ============================================================================
// API-Aware Functions (Server-Side Delegation)
// ============================================================================

/**
 * Assign cards to chapters via server API.
 * This is the preferred method when bookId is available.
 *
 * @param bookId - The book ID to assign cards for
 * @param options - Assignment options
 * @returns Assignment result with proposals
 */
export async function assignCardsViaApi(
  bookId: string,
  options: {
    minConfidence?: number
    maxAlternatives?: number
    autoApply?: boolean
  } = {}
): Promise<AssignmentResult> {
  try {
    const result = await apiAssignCards(bookId, {
      minConfidence: options.minConfidence,
      maxAlternatives: options.maxAlternatives,
      autoApply: options.autoApply,
    })

    return {
      batch: result.batch,
      error: result.success ? undefined : result.message,
    }
  } catch (error) {
    console.error('[assignment-agent] API assignment failed:', error)
    throw error
  }
}

/**
 * Apply assignment proposals via server API.
 *
 * @param bookId - The book ID
 * @param proposals - Proposals to apply
 * @returns Number of cards updated
 */
export async function applyAssignmentsViaApi(
  bookId: string,
  proposals: CardAssignmentProposal[]
): Promise<number> {
  const cardIds = proposals.map(p => p.cardId)
  const chapterAssignments: Record<string, string> = {}
  for (const p of proposals) {
    chapterAssignments[p.cardId] = p.suggestedChapterId
  }

  try {
    const result = await apiApplyAssignments(bookId, cardIds, chapterAssignments)
    return result.appliedCount
  } catch (error) {
    console.error('[assignment-agent] API apply assignments failed:', error)
    throw error
  }
}
