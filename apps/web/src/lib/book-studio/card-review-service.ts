/**
 * Card Review Service
 *
 * Agent-assisted card review and grading.
 * Uses the Curator agent's assess-passage capability to evaluate cards
 * and provide improvement suggestions.
 */

import type {
  HarvestCard,
  CardGrade,
  CardReview,
  CardReviewBatch,
  ChekhovAnalysis,
} from './types'
import { analyzeNecessity } from './chekhov-local'
import { getAgentBridge } from '../aui/agent-bridge'

// ============================================================================
// Types
// ============================================================================

export interface ReviewRequest {
  cards: HarvestCard[]
  bookTitle?: string
  projectContext?: string
}

export interface ReviewProgress {
  current: number
  total: number
  currentCardId: string
}

// ============================================================================
// Local Review Functions
// ============================================================================

/**
 * Calculate SIC-based metrics for a card
 */
function calculateSICMetrics(content: string): {
  clarity: number
  depth: number
  coherence: number
} {
  const words = content.split(/\s+/).filter(w => w.length > 0)
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)

  // Clarity: based on sentence complexity (words per sentence)
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0
  const clarity = avgWordsPerSentence > 0
    ? Math.max(0, Math.min(1, 1 - Math.abs(avgWordsPerSentence - 15) / 30))
    : 0.5

  // Depth: based on unique vocabulary ratio and content length
  const uniqueWords = new Set(words.map(w => w.toLowerCase()))
  const vocabularyRichness = words.length > 0 ? uniqueWords.size / words.length : 0
  const lengthFactor = Math.min(1, words.length / 200) // 200 words = full depth
  const depth = (vocabularyRichness * 0.6 + lengthFactor * 0.4)

  // Coherence: based on pronoun usage and connecting words
  const connectingWords = ['however', 'therefore', 'thus', 'because', 'although',
    'furthermore', 'moreover', 'consequently', 'nevertheless', 'meanwhile']
  const pronouns = ['it', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'which']

  const lowerContent = content.toLowerCase()
  const connectingCount = connectingWords.filter(w => lowerContent.includes(w)).length
  const pronounCount = pronouns.filter(w => lowerContent.includes(` ${w} `)).length

  const coherence = Math.min(1, (connectingCount * 0.15) + (pronounCount * 0.05) + 0.4)

  return { clarity, depth, coherence }
}

/**
 * Calculate originality score based on common phrase detection
 */
function calculateOriginality(content: string): number {
  const clichePatterns = [
    /at the end of the day/i,
    /it goes without saying/i,
    /in today's world/i,
    /needless to say/i,
    /as a matter of fact/i,
    /first and foremost/i,
    /in conclusion/i,
    /it is worth noting/i,
    /the fact of the matter/i,
    /bottom line/i,
    /think outside the box/i,
    /moving forward/i,
    /on the same page/i,
    /paradigm shift/i,
  ]

  const clicheCount = clichePatterns.filter(p => p.test(content)).length
  return Math.max(0, 1 - (clicheCount * 0.15))
}

/**
 * Generate improvement suggestions based on analysis
 */
function generateSuggestions(
  content: string,
  metrics: { clarity: number; depth: number; coherence: number },
  chekhov: ChekhovAnalysis,
  originality: number
): string[] {
  const suggestions: string[] = []

  // Clarity suggestions
  if (metrics.clarity < 0.5) {
    suggestions.push('Consider breaking up long sentences for better readability')
  }
  if (metrics.clarity > 0.8 && metrics.depth < 0.5) {
    suggestions.push('Content is clear but could benefit from more detail and depth')
  }

  // Depth suggestions
  if (metrics.depth < 0.4) {
    suggestions.push('Expand on key ideas with examples or supporting details')
  }

  // Coherence suggestions
  if (metrics.coherence < 0.4) {
    suggestions.push('Add transitional phrases to improve flow between ideas')
  }

  // Originality suggestions
  if (originality < 0.7) {
    suggestions.push('Consider rephrasing common expressions with more specific language')
  }

  // Chekhov-based suggestions
  if (chekhov.necessity < 0.5 && chekhov.function !== 'worldbuilding') {
    suggestions.push('Strengthen the narrative purpose of this passage')
  }

  if (chekhov.function === 'setup' && chekhov.necessity < 0.7) {
    suggestions.push('Ensure setup elements have clear payoffs later in the work')
  }

  // Word count suggestions
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length
  if (wordCount < 50) {
    suggestions.push('This passage may be too brief - consider expanding')
  }

  return suggestions.slice(0, 5) // Limit to 5 suggestions
}

/**
 * Convert metrics to a CardGrade
 */
function metricsToGrade(
  metrics: { clarity: number; depth: number; coherence: number },
  chekhov: ChekhovAnalysis,
  originality: number
): CardGrade {
  // Calculate component scores (1-5)
  const authenticity = Math.max(1, Math.min(5, Math.round(originality * 5))) as 1 | 2 | 3 | 4 | 5
  const necessity = Math.max(1, Math.min(5, Math.round(chekhov.necessity * 5))) as 1 | 2 | 3 | 4 | 5
  const inflection = Math.max(1, Math.min(5, Math.round(chekhov.necessity * 5))) as 1 | 2 | 3 | 4 | 5
  const voice = Math.max(1, Math.min(5, Math.round(metrics.coherence * 5))) as 1 | 2 | 3 | 4 | 5

  // Calculate overall score (1-5)
  const rawScore = (
    metrics.clarity * 0.25 +
    metrics.depth * 0.25 +
    metrics.coherence * 0.2 +
    originality * 0.15 +
    chekhov.necessity * 0.15
  )
  const overall = Math.max(1, Math.min(5, Math.round(rawScore * 5))) as 1 | 2 | 3 | 4 | 5

  // Determine stub type
  const stubType = overall <= 2 ? 'idea' : 'none'

  return {
    authenticity,
    necessity,
    inflection,
    voice,
    overall,
    stubType: stubType as CardGrade['stubType'],
    chekhovAnalysis: chekhov,
    gradedAt: new Date().toISOString(),
    gradedBy: 'auto' as const,
    confidence: rawScore,
  }
}

// ============================================================================
// Main Review Functions
// ============================================================================

/**
 * Review a single card locally without LLM
 */
export function reviewCardLocal(card: HarvestCard): CardReview {
  const metrics = calculateSICMetrics(card.content)
  const chekhov = analyzeNecessity(card.content)
  const originality = calculateOriginality(card.content)

  const grade = metricsToGrade(metrics, chekhov, originality)
  const suggestions = generateSuggestions(card.content, metrics, chekhov, originality)

  const needsAttention = grade.overall <= 2 || suggestions.length >= 3

  return {
    cardId: card.id,
    grade,
    curatorAssessment: {
      clarity: metrics.clarity,
      depth: metrics.depth,
      originality,
      relevance: chekhov.necessity,
    },
    suggestions,
    needsAttention,
    reviewedAt: new Date().toISOString(),
  }
}

/**
 * Review multiple cards in a batch
 */
export async function reviewCards(
  request: ReviewRequest,
  onProgress?: (progress: ReviewProgress) => void
): Promise<CardReviewBatch> {
  const { cards } = request
  const reviews: CardReview[] = []

  // Try agent-based review first
  try {
    const bridge = getAgentBridge()
    if (bridge.isConnected()) {
      // For now, we use local review but in future can use agent
      console.log('[card-review] Agent connected, but using local review')
    }
  } catch (error) {
    console.warn('[card-review] Agent unavailable:', error)
  }

  // Process each card
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]

    if (onProgress) {
      onProgress({
        current: i + 1,
        total: cards.length,
        currentCardId: card.id,
      })
    }

    const review = reviewCardLocal(card)
    reviews.push(review)
  }

  // Calculate summary
  const totalReviewed = reviews.length
  const averageGrade = totalReviewed > 0
    ? reviews.reduce((sum, r) => sum + r.grade.overall, 0) / totalReviewed
    : 0
  const needsAttentionCount = reviews.filter(r => r.needsAttention).length

  // Aggregate top suggestions
  const suggestionCounts = new Map<string, number>()
  for (const review of reviews) {
    for (const suggestion of review.suggestions) {
      suggestionCounts.set(suggestion, (suggestionCounts.get(suggestion) || 0) + 1)
    }
  }
  const topSuggestions = [...suggestionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([suggestion]) => suggestion)

  return {
    reviews,
    summary: {
      totalReviewed,
      averageGrade,
      needsAttentionCount,
      topSuggestions,
    },
    reviewedAt: new Date().toISOString(),
  }
}

/**
 * Apply review grades to cards
 */
export async function applyReviewGrades(
  reviews: CardReview[],
  updateCard: (cardId: string, updates: Partial<HarvestCard>) => Promise<void>
): Promise<number> {
  let updatedCount = 0

  for (const review of reviews) {
    try {
      await updateCard(review.cardId, { grade: review.grade })
      updatedCount++
    } catch (error) {
      console.error(`[card-review] Failed to update card ${review.cardId}:`, error)
    }
  }

  return updatedCount
}

/**
 * Get cards that need attention based on their reviews
 */
export function getCardsNeedingAttention(reviews: CardReview[]): CardReview[] {
  return reviews.filter(r => r.needsAttention)
}

/**
 * Prioritize reviews by urgency
 */
export function prioritizeReviews(reviews: CardReview[]): CardReview[] {
  return [...reviews].sort((a, b) => {
    // Needs attention first
    if (a.needsAttention !== b.needsAttention) {
      return a.needsAttention ? -1 : 1
    }
    // Then by grade (lower first)
    if (a.grade.overall !== b.grade.overall) {
      return a.grade.overall - b.grade.overall
    }
    // Then by suggestion count (more suggestions = needs more attention)
    return b.suggestions.length - a.suggestions.length
  })
}
