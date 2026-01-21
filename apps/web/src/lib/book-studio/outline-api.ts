/**
 * Outline API Client
 *
 * Client-side wrapper for server-side outline computation.
 * Business logic now runs on the server.
 *
 * This replaces direct calls to outline-agent.ts functions
 * with API calls to the Book Studio server.
 */

import { getConfig } from './config'

// ============================================================================
// Types (same as server-side)
// ============================================================================

export interface ExtractedTheme {
  id: string
  name: string
  keywords: string[]
  cardIds: string[]
  strength: number
  avgGrade: number
  narrativeFunction?: 'setup' | 'payoff' | 'characterization' | 'worldbuilding' | 'transition'
}

export interface ArcPhase {
  type: 'setup' | 'development' | 'climax' | 'resolution'
  cardIds: string[]
  strength: number
}

export interface NarrativeArc {
  id: string
  name: string
  phases: ArcPhase[]
  cardIds: string[]
  completeness: number
}

export interface CoverageGap {
  theme: string
  description: string
  severity: 'minor' | 'moderate' | 'major'
  suggestedAction: string
}

export interface SourceMapping {
  cardId: string
  themes: string[]
  relevanceScores: Record<string, number>
  narrativePosition?: 'early' | 'middle' | 'late'
  isKeyPassage: boolean
}

export interface SuggestedSection {
  title: string
  description: string
  themeIds: string[]
  cardIds: string[]
  order: number
  estimatedWordCount: number
}

export interface OutlineResearch {
  themes: ExtractedTheme[]
  arcs: NarrativeArc[]
  sourceMappings: SourceMapping[]
  coverageGaps: CoverageGap[]
  strongAreas: string[]
  suggestedSections: SuggestedSection[]
  totalCards: number
  analyzedAt: string
  confidence: number
}

export interface OutlineItem {
  level: number
  text: string
  children?: OutlineItem[]
}

export interface OutlineStructure {
  type: 'numbered' | 'bulleted' | 'hierarchical'
  items: OutlineItem[]
  depth: number
  confidence: number
}

export interface GeneratedOutline {
  structure: OutlineStructure
  itemCardAssignments: Record<string, string[]>
  confidence: number
  generatedAt: string
  basedOn: {
    research: boolean
    proposedOutline: boolean
    userPrompts: boolean
  }
}

export interface OutlineReview {
  bookId: string
  totalCards: number
  themes: number
  arcs: number
  coverageGaps: CoverageGap[]
  strongAreas: string[]
  sections: Array<{
    title: string
    cardCount: number
    keyPassageCount: number
  }>
  confidence: number
  recommendations: string[]
  reviewedAt: string
}

export interface OrderedSection {
  title: string
  outlineItemPath: string
  cards: Array<{
    id: string
    content: string
    title?: string
    createdAt?: number
  }>
  keyPassageIds: string[]
}

// ============================================================================
// API Client
// ============================================================================

function getBaseUrl(): string {
  return getConfig().api.bookStudioBase
}

/**
 * Run research phase on book's staging cards
 */
export async function runResearch(bookId: string): Promise<OutlineResearch> {
  const response = await fetch(`${getBaseUrl()}/outline-compute/${bookId}/research`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Research failed' }))
    throw new Error(error.error || error.details || 'Research failed')
  }

  const data = await response.json()
  return data.research
}

/**
 * Get cached research for a book
 */
export async function getCachedResearch(bookId: string): Promise<OutlineResearch | null> {
  const response = await fetch(`${getBaseUrl()}/outline-compute/${bookId}/research`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get research' }))
    throw new Error(error.error || error.details || 'Failed to get research')
  }

  const data = await response.json()
  return data.research
}

/**
 * Generate outline from research
 */
export async function generateOutline(
  bookId: string,
  options: {
    maxSections?: number
    preferArcStructure?: boolean
  } = {}
): Promise<GeneratedOutline> {
  const response = await fetch(`${getBaseUrl()}/outline-compute/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      bookId,
      ...options,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to generate outline' }))
    throw new Error(error.error || error.details || 'Failed to generate outline')
  }

  const data = await response.json()
  return data.outline
}

/**
 * Order cards for draft generation within each section
 */
export async function orderCardsForDraft(
  bookId: string,
  outlineId?: string
): Promise<OrderedSection[]> {
  const response = await fetch(`${getBaseUrl()}/outline-compute/${bookId}/order-cards`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ outlineId }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to order cards' }))
    throw new Error(error.error || error.details || 'Failed to order cards')
  }

  const data = await response.json()
  return data.sections
}

/**
 * Review outline coverage and quality
 */
export async function reviewOutline(
  bookId: string,
  outlineId?: string
): Promise<OutlineReview> {
  const response = await fetch(`${getBaseUrl()}/outline-compute/${bookId}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ outlineId }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to review outline' }))
    throw new Error(error.error || error.details || 'Failed to review outline')
  }

  const data = await response.json()
  return data.review
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get research (cached or fresh)
 * Convenience function that tries cache first
 */
export async function getOrRunResearch(bookId: string): Promise<OutlineResearch> {
  const cached = await getCachedResearch(bookId)
  if (cached) {
    return cached
  }
  return runResearch(bookId)
}

/**
 * Full pipeline: research -> generate outline
 */
export async function generateOutlineWithResearch(
  bookId: string,
  options: {
    maxSections?: number
    preferArcStructure?: boolean
    forceRefresh?: boolean
  } = {}
): Promise<{ research: OutlineResearch; outline: GeneratedOutline }> {
  // Run or get research
  let research: OutlineResearch
  if (options.forceRefresh) {
    research = await runResearch(bookId)
  } else {
    research = await getOrRunResearch(bookId)
  }

  // Generate outline
  const outline = await generateOutline(bookId, {
    maxSections: options.maxSections,
    preferArcStructure: options.preferArcStructure,
  })

  return { research, outline }
}
