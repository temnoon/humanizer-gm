/**
 * Book Studio Types
 */

import type { ContentType, SearchResult, SourceType } from '../archive-reader'

// ============================================================================
// Stub Classification
// ============================================================================

export type StubClassification =
  | 'stub-sentence'    // Single sentence fragment
  | 'stub-reference'   // Points to article/resource
  | 'stub-media'       // Image/video/audio reference
  | 'stub-note'        // Quick capture
  | 'stub-breadcrumb'  // Navigation marker - adjacent content useful
  | 'optimal'          // Ready to use

// ============================================================================
// Card Grading
// ============================================================================

export interface SICAnalysis {
  score: number
  category: 'polished-human' | 'raw-human' | 'neat-slop' | 'messy-low-craft' | 'unknown'
  signals: string[]
}

export interface ChekhovAnalysis {
  necessity: number
  function: 'setup' | 'payoff' | 'characterization' | 'worldbuilding' | 'atmosphere' | 'transition' | 'dispensable'
  removalImpact: string
}

export interface QuantumHighlights {
  dominantModality: 'literal' | 'metaphorical' | 'mixed'
  isInflectionPoint: boolean
  modalityShift?: number // 0-1, how strongly meaning shifts
}

export interface CardGrade {
  // 1-5 grades
  authenticity: number      // SIC-derived
  necessity: number         // Chekhov-derived
  inflection: number        // Quantum-derived (narrative turning point)
  voice: number             // Style coherence with author
  overall: number           // Weighted composite

  stubType: StubClassification

  // Detailed results (optional, for drill-down)
  sicAnalysis?: SICAnalysis
  chekhovAnalysis?: ChekhovAnalysis
  quantumHighlights?: QuantumHighlights

  gradedAt: string
  gradedBy: 'auto' | 'manual' | 'hybrid'
  confidence: number // 0-1
}

// ============================================================================
// Outline Detection
// ============================================================================

export interface OutlineItem {
  level: number
  text: string
  children?: OutlineItem[]
}

export interface OutlineStructure {
  type: 'numbered' | 'bulleted' | 'chapter-list' | 'conversational'
  items: OutlineItem[]
  depth: number
  confidence: number // 0-1
}

// ============================================================================
// Harvest Cards
// ============================================================================

export interface CardPosition {
  x: number
  y: number
}

/**
 * Status of source creation timestamp
 */
export type TemporalStatus = 'exact' | 'inferred' | 'unknown'

export interface HarvestCard {
  id: string
  // Source content
  sourceId: string
  sourceType: ContentType
  source: string // 'facebook', 'conversation', 'web', etc.
  contentOrigin: SourceType // 'original' = author's content, 'reference' = external
  content: string
  title?: string
  authorName?: string
  similarity?: number // If from semantic search

  // Temporal fields (canonical)
  sourceCreatedAt: number | null        // Unix seconds, original platform timestamp
  sourceCreatedAtStatus: TemporalStatus // How reliable the timestamp is
  harvestedAt: number                   // Unix seconds, when pulled into book

  // DEPRECATED: use sourceCreatedAt instead
  createdAt?: string | number // Legacy field - being phased out

  // Source linking
  sourceUrl?: string // Link to original content (external_url from metadata)
  conversationId?: string // For messages - to link back to full conversation
  conversationTitle?: string // For messages

  // User annotations
  userNotes: string
  aiContext?: string // Optional AI-generated context
  aiSummary?: string // Auto-generated summary of the content

  // Organization
  suggestedChapterId?: string
  tags: string[]
  canvasPosition?: CardPosition // Position in canvas view

  // Metadata
  status: 'staging' | 'placed' | 'archived'
  metadata?: Record<string, unknown> // Full original metadata

  // Grading (populated by review agent)
  grade?: CardGrade
  isOutline?: boolean
  outlineStructure?: OutlineStructure
}

// ============================================================================
// Temporal Utilities
// ============================================================================

/**
 * Check if a date represents epoch zero or is invalid
 * Zero dates occur when platforms export without timestamps
 */
export function isZeroDate(date: number | string | null | undefined): boolean {
  if (date === null || date === undefined) return true

  const ts = typeof date === 'number'
    ? date * 1000 // Convert Unix seconds to ms if it looks like seconds
    : new Date(date).getTime()

  if (isNaN(ts)) return true

  // Epoch zero ± 1 day (86400000ms)
  return Math.abs(ts) < 86400000
}

/**
 * Normalize a date to Unix seconds with status indicator
 * Handles both string dates and numeric timestamps
 */
export function normalizeDate(date: string | number | null | undefined): {
  value: number | null
  status: TemporalStatus
} {
  if (isZeroDate(date)) {
    return { value: null, status: 'unknown' }
  }

  let ts: number
  if (typeof date === 'number') {
    // Determine if timestamp is seconds or milliseconds
    // Unix seconds timestamps from before year 2100 are < 4102444800
    ts = date < 4102444800 ? date : Math.floor(date / 1000)
  } else {
    ts = Math.floor(new Date(date!).getTime() / 1000)
  }

  return { value: ts, status: 'exact' }
}

// ============================================================================
// Card Creation
// ============================================================================

export function createCardFromSearchResult(result: SearchResult): HarvestCard {
  // Defensive: ensure result is valid
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid search result: result is null or not an object')
  }

  // Extract external_url from metadata if available
  const metadata = result.metadata as Record<string, unknown> | undefined
  const externalUrl = metadata?.external_url as string | undefined

  // Normalize the source creation date
  const { value: sourceCreatedAt, status: sourceCreatedAtStatus } = normalizeDate(result.createdAt)
  const harvestedAt = Math.floor(Date.now() / 1000)

  return {
    id: crypto.randomUUID(),
    sourceId: result.id || `unknown-${Date.now()}`,
    sourceType: result.type || 'document',
    source: result.source || 'unknown',
    contentOrigin: result.sourceType || 'original', // 'original' for archive, 'reference' for web
    content: result.content || '',
    title: result.title,
    authorName: result.authorName,
    similarity: result.similarity,
    // Temporal fields
    sourceCreatedAt,
    sourceCreatedAtStatus,
    harvestedAt,
    createdAt: result.createdAt, // Keep legacy field for backward compatibility
    // Source linking
    sourceUrl: result.sourceUrl || externalUrl,
    conversationId: result.conversationId,
    conversationTitle: result.conversationTitle,
    // Annotations
    userNotes: '',
    tags: [],
    status: 'staging',
    metadata: result.metadata,
  }
}

// ============================================================================
// Chapters
// ============================================================================

export interface Chapter {
  id: string
  title: string
  order: number
  wordCount: number
  cards: string[] // Card IDs placed in this chapter
  content?: string // Draft content
  draftInstructions?: string // Instructions for the AI draft generator
}

// ============================================================================
// Book
// ============================================================================

export interface Book {
  id: string
  title: string
  description?: string
  createdAt: string
  updatedAt: string
  chapters: Chapter[]
  stagingCards: HarvestCard[]
  targetWordCount?: number
  // Computed counts from API (available in list view before full load)
  cardCount?: number
  chapterCount?: number
}

export function createEmptyBook(title: string): Book {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chapters: [],
    stagingCards: [],
  }
}

// ============================================================================
// UI State
// ============================================================================

export type StagingView = 'grid' | 'timeline' | 'canvas' | 'clusters'

export interface BookStudioState {
  currentBook: Book | null
  currentChapterId: string | null
  stagingView: StagingView
  selectedCardIds: string[]
  showOutline: boolean
  showCommandPalette: boolean
}

// ============================================================================
// Deduplication Utilities
// ============================================================================

/**
 * Normalize text for comparison (lowercase, remove extra whitespace, punctuation)
 */
export function normalizeTextForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Generate a content hash for quick duplicate detection
 */
export function generateContentHash(content: string): string {
  const normalized = normalizeTextForComparison(content)
  // Simple hash using first 100 chars + length + word count
  const wordCount = normalized.split(' ').filter(Boolean).length
  const prefix = normalized.slice(0, 100)
  return `${wordCount}:${prefix.length}:${prefix.slice(0, 50)}`
}

/**
 * Calculate Jaccard similarity between two texts (0.0 to 1.0)
 */
export function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(normalizeTextForComparison(text1).split(' ').filter(Boolean))
  const words2 = new Set(normalizeTextForComparison(text2).split(' ').filter(Boolean))

  if (words1.size === 0 && words2.size === 0) return 1.0
  if (words1.size === 0 || words2.size === 0) return 0.0

  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])

  return intersection.size / union.size
}

/**
 * Check if content is a duplicate of any existing card
 * Returns the duplicate card if found, null otherwise
 */
export function findDuplicateCard(
  content: string,
  existingCards: HarvestCard[],
  similarityThreshold: number = 0.5 // Lowered from 0.85 - allows more similar cards
): HarvestCard | null {
  if (existingCards.length === 0) return null

  const newHash = generateContentHash(content)

  for (const card of existingCards) {
    // Quick check: exact hash match
    const existingHash = generateContentHash(card.content)
    if (newHash === existingHash) {
      return card
    }

    // Detailed check: Jaccard similarity
    const similarity = jaccardSimilarity(content, card.content)
    if (similarity >= similarityThreshold) {
      return card
    }
  }

  return null
}

/**
 * Filter out duplicates from a list of search results before creating cards
 * Returns unique results and the count of duplicates removed
 */
export function deduplicateSearchResults(
  results: import('../archive-reader').SearchResult[],
  existingCards: HarvestCard[],
  similarityThreshold: number = 0.5 // Lowered from 0.85 - allows more similar cards
): { unique: import('../archive-reader').SearchResult[]; duplicateCount: number } {
  const seen = new Set<string>()
  const unique: import('../archive-reader').SearchResult[] = []
  let duplicateCount = 0

  // First, add hashes of existing cards
  for (const card of existingCards) {
    seen.add(generateContentHash(card.content))
  }

  for (const result of results) {
    const hash = generateContentHash(result.content)

    // Check against seen hashes
    if (seen.has(hash)) {
      duplicateCount++
      continue
    }

    // Check Jaccard similarity against existing cards
    const isDuplicate = existingCards.some(
      card => jaccardSimilarity(result.content, card.content) >= similarityThreshold
    )

    if (isDuplicate) {
      duplicateCount++
      continue
    }

    // Check against other results in this batch
    const isDuplicateInBatch = unique.some(
      r => jaccardSimilarity(result.content, r.content) >= similarityThreshold
    )

    if (isDuplicateInBatch) {
      duplicateCount++
      continue
    }

    seen.add(hash)
    unique.push(result)
  }

  return { unique, duplicateCount }
}

// ============================================================================
// Card Assignment Proposals (Agent-Assisted)
// ============================================================================

/**
 * Proposal for assigning a card to a chapter, generated by the Curator agent
 */
export interface CardAssignmentProposal {
  cardId: string
  suggestedChapterId: string
  confidence: number  // 0-1
  reasoning: string
  alternatives?: { chapterId: string; confidence: number }[]
}

/**
 * Batch of assignment proposals for bulk operations
 */
export interface AssignmentProposalBatch {
  proposals: CardAssignmentProposal[]
  generatedAt: string
  totalCards: number
  assignedCards: number
  unassignedCards: number  // Cards with no good match
}

// ============================================================================
// Card Review (Agent-Assisted)
// ============================================================================

/**
 * Review assessment for a single card, combining multiple analysis methods
 */
export interface CardReview {
  cardId: string
  grade: CardGrade
  curatorAssessment?: {
    clarity: number     // 0-1
    depth: number       // 0-1
    originality: number // 0-1
    relevance: number   // 0-1
  }
  suggestions: string[]
  needsAttention: boolean
  reviewedAt: string
}

/**
 * Batch review results for multiple cards
 */
export interface CardReviewBatch {
  reviews: CardReview[]
  summary: {
    totalReviewed: number
    averageGrade: number
    needsAttentionCount: number
    topSuggestions: string[]
  }
  reviewedAt: string
}

// ============================================================================
// Book Studio Configuration
// ============================================================================

/**
 * Configuration for agent-assisted features
 */
export interface BookStudioAgentConfig {
  agentAssignment: {
    enabled: boolean
    minConfidenceThreshold: number  // 0-1, minimum confidence to show proposal
    autoAssignHighConfidence: boolean  // Auto-assign cards above threshold
    highConfidenceThreshold: number  // Threshold for auto-assignment
  }
  cardReview: {
    enabled: boolean
    autoReviewOnHarvest: boolean  // Automatically review cards when harvested
    batchSize: number  // Max cards to review in one batch
  }
  outlineSuggestion: {
    enabled: boolean
    minCardsForSuggestion: number  // Minimum cards before suggesting outline
    showAfterHarvest: boolean
  }
}
