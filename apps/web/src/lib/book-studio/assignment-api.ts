/**
 * Assignment API Client
 *
 * Client-side wrapper for server-side card-to-chapter assignment.
 * Business logic now runs on the server.
 */

import { getConfig } from './config'

// ============================================================================
// Types
// ============================================================================

export interface CardAssignmentProposal {
  cardId: string
  suggestedChapterId: string
  confidence: number
  reasoning: string
  alternatives?: Array<{
    chapterId: string
    confidence: number
  }>
}

export interface AssignmentProposalBatch {
  proposals: CardAssignmentProposal[]
  generatedAt: string
  totalCards: number
  assignedCards: number
  unassignedCards: number
}

export interface AssignmentOptions {
  minConfidence?: number
  maxAlternatives?: number
  autoApply?: boolean
}

export interface AssignmentResult {
  success: boolean
  batch: AssignmentProposalBatch
  appliedCount?: number
  message: string
}

export interface AssignmentStats {
  totalCards: number
  stagingCards: number
  placedCards: number
  chaptersWithCards: number
  averageCardsPerChapter: number
}

// ============================================================================
// API Client
// ============================================================================

function getBaseUrl(): string {
  return getConfig().api.bookStudioBase
}

/**
 * Auto-assign staging cards to chapters
 * Returns assignment proposals (and optionally applies high-confidence ones)
 */
export async function assignCardsToChapters(
  bookId: string,
  options: AssignmentOptions = {}
): Promise<AssignmentResult> {
  const response = await fetch(`${getBaseUrl()}/cards/assign-to-chapters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookId, options }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Assignment failed' }))
    throw new Error(error.error || error.details || 'Assignment failed')
  }

  return response.json()
}

/**
 * Apply selected assignment proposals
 */
export async function applyAssignments(
  bookId: string,
  cardIds: string[],
  chapterAssignments: Record<string, string>
): Promise<{ success: boolean; appliedCount: number; message: string }> {
  const response = await fetch(`${getBaseUrl()}/cards/apply-assignments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookId, cardIds, chapterAssignments }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to apply assignments' }))
    throw new Error(error.error || error.details || 'Failed to apply assignments')
  }

  return response.json()
}

/**
 * Get assignment statistics for a book
 */
export async function getAssignmentStats(bookId: string): Promise<AssignmentStats> {
  const response = await fetch(
    `${getBaseUrl()}/cards/assignment-stats?bookId=${encodeURIComponent(bookId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get stats' }))
    throw new Error(error.error || error.details || 'Failed to get stats')
  }

  const data = await response.json()
  return data.stats
}

// ============================================================================
// Convenience Functions
// ============================================================================

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
): Record<string, CardAssignmentProposal[]> {
  const groups: Record<string, CardAssignmentProposal[]> = {}

  for (const proposal of proposals) {
    if (!groups[proposal.suggestedChapterId]) {
      groups[proposal.suggestedChapterId] = []
    }
    groups[proposal.suggestedChapterId].push(proposal)
  }

  return groups
}

/**
 * Convert proposals to chapter assignments map
 */
export function proposalsToAssignments(
  proposals: CardAssignmentProposal[]
): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const p of proposals) {
    assignments[p.cardId] = p.suggestedChapterId
  }
  return assignments
}

/**
 * Full pipeline: generate proposals and apply all
 */
export async function autoAssignAllCards(
  bookId: string,
  options: AssignmentOptions = {}
): Promise<{
  batch: AssignmentProposalBatch
  appliedCount: number
}> {
  // Get proposals
  const result = await assignCardsToChapters(bookId, { ...options, autoApply: false })

  if (result.batch.proposals.length === 0) {
    return {
      batch: result.batch,
      appliedCount: 0,
    }
  }

  // Apply all proposals
  const cardIds = result.batch.proposals.map(p => p.cardId)
  const assignments = proposalsToAssignments(result.batch.proposals)

  const applyResult = await applyAssignments(bookId, cardIds, assignments)

  return {
    batch: result.batch,
    appliedCount: applyResult.appliedCount,
  }
}
