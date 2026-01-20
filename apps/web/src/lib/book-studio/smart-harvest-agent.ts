/**
 * Smart Harvest Agent
 *
 * Agentic harvesting that filters for quality:
 * 1. Fetches large result set
 * 2. Grades each result immediately
 * 3. Filters out stubs (except breadcrumbs which get expanded)
 * 4. Returns only quality results up to target
 * 5. Emits progress events for live UI updates
 */

import {
  unifiedSearch,
  getMessageContext,
  type SearchResult,
  type ContentType,
} from '../archive-reader'
import { classifyStub, quickGradeCard } from './harvest-review-agent'
import { createCardFromSearchResult, type HarvestCard, type StubClassification } from './types'

// ============================================================================
// Types
// ============================================================================

export interface HarvestProgress {
  phase: 'searching' | 'grading' | 'expanding' | 'complete'
  searched: number
  graded: number
  accepted: number
  rejected: number
  expanded: number
  target: number
  message: string
}

export interface HarvestConfig {
  target: number // Target number of quality results (default 40)
  searchLimit: number // Max results to fetch (default 200)
  minWordCount: number // Minimum words to not be a stub (default 30)
  expandBreadcrumbs: boolean // Auto-expand breadcrumb stubs (default true)
  contextSize: number // Messages before/after for expansion (default 2)
  sources?: string[] // Filter by source types (e.g., ['openai', 'claude', 'facebook'])
  types?: ContentType[] // Filter by content types (e.g., ['message', 'post'])
  prioritizeConversations: boolean // Boost conversation messages over social media (default true)
}

export interface ExpandedResult {
  original: SearchResult
  card: HarvestCard
  stubType: StubClassification
  expanded?: {
    previousMessages: string[]
    nextMessages: string[]
    combinedContent: string
  }
}

export interface HarvestResult {
  results: ExpandedResult[]
  stats: {
    totalSearched: number
    totalRejected: number
    totalExpanded: number
    exhausted: boolean
  }
}

// Default harvest configuration - these can be overridden per-harvest
const DEFAULT_CONFIG: HarvestConfig = {
  target: 20, // Default to 20 cards per harvest (was 40, now more conservative)
  searchLimit: 100, // Search up to 100 results
  minWordCount: 20, // Minimum 20 words (was 30, now more inclusive)
  expandBreadcrumbs: true,
  contextSize: 2,
  prioritizeConversations: true, // Prioritize AI conversations over social media
}

// ============================================================================
// Smart Harvest Agent
// ============================================================================

/**
 * Run a smart harvest that filters for quality
 */
export async function smartHarvest(
  query: string,
  onProgress: (progress: HarvestProgress) => void,
  config: Partial<HarvestConfig> = {}
): Promise<HarvestResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const acceptedResults: ExpandedResult[] = []
  let totalSearched = 0
  let totalRejected = 0
  let totalExpanded = 0
  let exhausted = false

  // Phase: Searching
  onProgress({
    phase: 'searching',
    searched: 0,
    graded: 0,
    accepted: 0,
    rejected: 0,
    expanded: 0,
    target: cfg.target,
    message: `Searching for "${query}"...`,
  })

  // Fetch a large batch of results
  console.log(`[SmartHarvest] Searching for "${query}" with limit ${cfg.searchLimit}`)
  const searchResponse = await unifiedSearch(query, {
    limit: cfg.searchLimit,
    sources: cfg.sources,
    types: cfg.types,
  })

  console.log(`[SmartHarvest] Search returned ${searchResponse.results.length} results`)
  let searchResults = searchResponse.results

  // Prioritize conversations (OpenAI/Claude messages) over social media
  if (cfg.prioritizeConversations && searchResults.length > 0) {
    // Sort to put messages first, then by similarity
    searchResults = [...searchResults].sort((a, b) => {
      const aIsConvo = a.type === 'message' || a.source === 'openai' || a.source === 'claude'
      const bIsConvo = b.type === 'message' || b.source === 'openai' || b.source === 'claude'

      // Conversations first
      if (aIsConvo && !bIsConvo) return -1
      if (!aIsConvo && bIsConvo) return 1

      // Then by similarity
      return b.similarity - a.similarity
    })
  }

  if (searchResults.length === 0) {
    exhausted = true
    onProgress({
      phase: 'complete',
      searched: 0,
      graded: 0,
      accepted: 0,
      rejected: 0,
      expanded: 0,
      target: cfg.target,
      message: 'No results found',
    })
    return {
      results: [],
      stats: { totalSearched: 0, totalRejected: 0, totalExpanded: 0, exhausted: true },
    }
  }

  totalSearched = searchResults.length

  // Phase: Grading
  onProgress({
    phase: 'grading',
    searched: totalSearched,
    graded: 0,
    accepted: 0,
    rejected: 0,
    expanded: 0,
    target: cfg.target,
    message: `Grading ${searchResults.length} results...`,
  })

  // Grade and filter each result
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i]

    // Skip if we already have enough
    if (acceptedResults.length >= cfg.target) break

    // Skip invalid results
    if (!result || !result.content || typeof result.content !== 'string') {
      console.warn('[SmartHarvest] Skipping invalid result:', result)
      totalRejected++
      continue
    }

    try {
      // Create temporary card for grading
      const tempCard = createCardFromSearchResult(result)
      const stubType = classifyStub(tempCard)
      const wordCount = result.content.split(/\s+/).filter(Boolean).length

    // Update progress
    onProgress({
      phase: 'grading',
      searched: totalSearched,
      graded: i + 1,
      accepted: acceptedResults.length,
      rejected: totalRejected,
      expanded: totalExpanded,
      target: cfg.target,
      message: `Grading ${i + 1}/${searchResults.length}...`,
    })

    // Check if this is a stub
    if (stubType !== 'optimal') {
      // Handle breadcrumbs specially - expand them
      if (stubType === 'stub-breadcrumb' && cfg.expandBreadcrumbs && result.conversationId) {
        onProgress({
          phase: 'expanding',
          searched: totalSearched,
          graded: i + 1,
          accepted: acceptedResults.length,
          rejected: totalRejected,
          expanded: totalExpanded,
          target: cfg.target,
          message: `Expanding breadcrumb context...`,
        })

        const expanded = await expandBreadcrumb(result, cfg.contextSize)
        if (expanded) {
          totalExpanded++
          // Check if expanded content is now substantial
          const expandedWordCount = expanded.combinedContent.split(/\s+/).filter(Boolean).length
          if (expandedWordCount >= cfg.minWordCount) {
            acceptedResults.push({
              original: result,
              card: {
                ...tempCard,
                content: expanded.combinedContent,
                aiContext: `Expanded from breadcrumb with ${expanded.previousMessages.length} previous and ${expanded.nextMessages.length} next messages.`,
              },
              stubType: 'optimal', // Upgraded after expansion
              expanded,
            })
            continue
          }
        }
      }

      // Skip other stubs and short content
      if (wordCount < cfg.minWordCount) {
        totalRejected++
        continue
      }
    }

    // Check word count even for "optimal" classified content
    if (wordCount < cfg.minWordCount) {
      totalRejected++
      continue
    }

    // Run quick grade for additional filtering
    const grade = quickGradeCard(tempCard)

    // Accept if grade is decent (overall >= 3)
    if (grade.overall && grade.overall >= 3) {
      acceptedResults.push({
        original: result,
        card: { ...tempCard, grade: grade as HarvestCard['grade'] },
        stubType,
      })
    } else {
      totalRejected++
    }
    } catch (error) {
      console.error('[SmartHarvest] Error processing result:', error, result)
      totalRejected++
    }
  }

  // Check if we found enough
  exhausted = acceptedResults.length < cfg.target

  // Final progress update
  onProgress({
    phase: 'complete',
    searched: totalSearched,
    graded: totalSearched,
    accepted: acceptedResults.length,
    rejected: totalRejected,
    expanded: totalExpanded,
    target: cfg.target,
    message: exhausted
      ? `Found ${acceptedResults.length} quality results (search exhausted)`
      : `Found ${acceptedResults.length} quality results`,
  })

  return {
    results: acceptedResults,
    stats: {
      totalSearched,
      totalRejected,
      totalExpanded,
      exhausted,
    },
  }
}

// ============================================================================
// Breadcrumb Expansion
// ============================================================================

/**
 * Expand a breadcrumb stub by fetching adjacent messages
 */
async function expandBreadcrumb(
  result: SearchResult,
  contextSize: number
): Promise<{
  previousMessages: string[]
  nextMessages: string[]
  combinedContent: string
} | null> {
  if (!result.conversationId) return null

  try {
    const context = await getMessageContext(
      result.conversationId,
      result.content,
      contextSize
    )

    if (!context) return null

    const previousMessages = context.previousMessages.map(m => m.content)
    const nextMessages = context.nextMessages.map(m => m.content)

    // Combine into a coherent passage
    const allContent = [
      ...previousMessages,
      result.content,
      ...nextMessages,
    ]

    // Add separator markers for context
    const combinedContent = allContent.join('\n\n---\n\n')

    return {
      previousMessages,
      nextMessages,
      combinedContent,
    }
  } catch (error) {
    console.error('[SmartHarvest] Failed to expand breadcrumb:', error)
    return null
  }
}

// ============================================================================
// Quick Filter (for pre-search filtering)
// ============================================================================

/**
 * Quick check if content is likely to be useful (before full grading)
 */
export function isLikelyUseful(content: string, minWords = 30): boolean {
  const words = content.split(/\s+/).filter(Boolean)
  if (words.length < minWords) return false

  // Check for common stub patterns
  const urlCount = (content.match(/https?:\/\/\S+/g) || []).length

  // URL-heavy content is usually not useful
  if (urlCount > 2 && words.length < 100) return false

  // Single sentence fragments
  const sentences = content.split(/[.!?]+/).filter(Boolean)
  if (sentences.length === 1 && words.length < 50) return false

  return true
}
