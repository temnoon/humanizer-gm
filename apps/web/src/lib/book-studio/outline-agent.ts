/**
 * Outline Agent
 *
 * Intelligent outline management:
 * 1. Research Phase - Analyze harvest cards to extract themes, arcs, and coverage
 * 2. Review Phase - Evaluate proposed outlines against research findings
 * 3. Generation Phase - Create or refine outlines from research + prompts
 * 4. Ordering Phase - Map cards to outline items for draft generation
 *
 * NOTE: As of Jan 2026, business logic has moved to server-side.
 * This file now delegates to outline-api.ts for API calls.
 * Local functions are kept as fallback and for type exports.
 */

import type {
  HarvestCard,
  ChekhovAnalysis,
  OutlineStructure,
  OutlineItem,
} from './types'
import type { ReactiveCluster } from './reactive-clustering'
import { analyzeNecessity } from './chekhov-local'

// Import API functions for server-side delegation
import {
  runResearch as apiRunResearch,
  generateOutline as apiGenerateOutline,
  orderCardsForDraft as apiOrderCardsForDraft,
  type OutlineResearch as ApiOutlineResearch,
  type GeneratedOutline as ApiGeneratedOutline,
  type OrderedSection as ApiOrderedSection,
} from './outline-api'

// Re-export types needed by review/generation phases
export type { OutlineStructure, OutlineItem }

// ============================================================================
// Research Phase Types
// ============================================================================

export interface ExtractedTheme {
  id: string
  name: string
  keywords: string[]
  cardIds: string[]
  strength: number // 0-1, based on card count and quality
  avgGrade: number // Average card grade
  narrativeFunction?: ChekhovAnalysis['function']
}

export interface NarrativeArc {
  id: string
  name: string
  phases: ArcPhase[]
  cardIds: string[]
  completeness: number // 0-1, how complete the arc is
}

export interface ArcPhase {
  type: 'setup' | 'development' | 'climax' | 'resolution'
  cardIds: string[]
  strength: number
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
  relevanceScores: Record<string, number> // themeId -> relevance
  narrativePosition?: 'early' | 'middle' | 'late'
  isKeyPassage: boolean
}

export interface OutlineResearch {
  // Extracted insights
  themes: ExtractedTheme[]
  arcs: NarrativeArc[]
  sourceMappings: SourceMapping[]

  // Coverage analysis
  coverageGaps: CoverageGap[]
  strongAreas: string[]

  // Suggested structure
  suggestedSections: SuggestedSection[]

  // Metadata
  totalCards: number
  analyzedAt: string
  confidence: number
}

export interface SuggestedSection {
  title: string
  description: string
  themeIds: string[]
  cardIds: string[]
  order: number
  estimatedWordCount: number
}

// ============================================================================
// Theme Extraction
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'going', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'if', 'because',
  'while', 'although', 'though', 'after', 'before', 'until', 'unless',
  'since', 'so', 'that', 'whether', 'once', 'even', 'still', 'already',
  'yet', 'ever', 'never', 'always', 'often', 'sometimes', 'usually',
  'really', 'actually', 'basically', 'generally', 'probably', 'perhaps',
  'maybe', 'certainly', 'definitely', 'simply', 'merely', 'rather',
  'quite', 'somewhat', 'enough', 'almost', 'nearly', 'hardly', 'barely',
  'something', 'anything', 'nothing', 'everything', 'someone', 'anyone',
  'thing', 'things', 'way', 'ways', 'time', 'times', 'year', 'years',
  'day', 'days', 'people', 'person', 'man', 'woman', 'child', 'being',
  'made', 'make', 'said', 'say', 'says', 'got', 'get', 'gets', 'going',
  'went', 'come', 'came', 'take', 'took', 'see', 'saw', 'know', 'knew',
  'think', 'thought', 'want', 'wanted', 'look', 'looked', 'use', 'used',
  'find', 'found', 'give', 'gave', 'tell', 'told', 'work', 'worked',
  'seem', 'seemed', 'feel', 'felt', 'try', 'tried', 'leave', 'left',
  'call', 'called', 'keep', 'kept', 'let', 'begin', 'began', 'seem',
  'help', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe',
])

/**
 * Extract significant words from text
 */
function extractKeywords(text: string, minLength = 4): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word =>
      word.length >= minLength &&
      !STOP_WORDS.has(word) &&
      !/^\d+$/.test(word)
    )
}

/**
 * Calculate word frequency across cards
 */
function calculateWordFrequency(cards: HarvestCard[]): Map<string, number> {
  const freq = new Map<string, number>()

  for (const card of cards) {
    const words = extractKeywords(card.content)
    const seen = new Set<string>() // Count each word once per card

    for (const word of words) {
      if (!seen.has(word)) {
        seen.add(word)
        freq.set(word, (freq.get(word) || 0) + 1)
      }
    }
  }

  return freq
}

/**
 * Find co-occurring word groups (potential themes)
 */
function findWordClusters(
  cards: HarvestCard[],
  minCooccurrence = 2
): Map<string, Set<string>> {
  const cooccurrence = new Map<string, Map<string, number>>()

  for (const card of cards) {
    const words = [...new Set(extractKeywords(card.content))]

    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const [w1, w2] = [words[i], words[j]].sort()

        if (!cooccurrence.has(w1)) {
          cooccurrence.set(w1, new Map())
        }
        const map = cooccurrence.get(w1)!
        map.set(w2, (map.get(w2) || 0) + 1)
      }
    }
  }

  // Build clusters from strong co-occurrences
  const clusters = new Map<string, Set<string>>()

  for (const [word1, cowords] of cooccurrence) {
    for (const [word2, count] of cowords) {
      if (count >= minCooccurrence) {
        // Add to existing cluster or create new one
        let foundCluster = false

        for (const [, cluster] of clusters) {
          if (cluster.has(word1) || cluster.has(word2)) {
            cluster.add(word1)
            cluster.add(word2)
            foundCluster = true
            break
          }
        }

        if (!foundCluster) {
          clusters.set(word1, new Set([word1, word2]))
        }
      }
    }
  }

  return clusters
}

/**
 * Extract themes from cards using word frequency and clustering
 */
export function extractThemes(
  cards: HarvestCard[],
  clusters?: ReactiveCluster[]
): ExtractedTheme[] {
  const themes: ExtractedTheme[] = []

  // If we have pre-computed clusters, use them as primary themes
  if (clusters && clusters.length > 0) {
    for (const cluster of clusters) {
      if (cluster.id === 'unclustered' || cluster.cards.length === 0) continue

      // Extract keywords from cluster cards
      const allKeywords = cluster.cards.flatMap(c => extractKeywords(c.content))
      const keywordFreq = new Map<string, number>()
      for (const kw of allKeywords) {
        keywordFreq.set(kw, (keywordFreq.get(kw) || 0) + 1)
      }

      const topKeywords = [...keywordFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word]) => word)

      // Calculate average grade
      const grades = cluster.cards
        .map(c => c.grade?.overall)
        .filter((g): g is number => g !== undefined)
      const avgGrade = grades.length > 0
        ? grades.reduce((a, b) => a + b, 0) / grades.length
        : 3

      // Determine narrative function from Chekhov analysis
      const functions = cluster.cards
        .map(c => c.grade?.chekhovAnalysis?.function)
        .filter((f): f is ChekhovAnalysis['function'] => f !== undefined)
      const dominantFunction = findMode(functions)

      themes.push({
        id: cluster.id,
        name: cluster.name || cluster.theme || topKeywords.slice(0, 2).join(' & '),
        keywords: topKeywords,
        cardIds: cluster.cards.map(c => c.id),
        strength: Math.min(cluster.cards.length / 5, 1), // Normalize to 5 cards = full strength
        avgGrade,
        narrativeFunction: dominantFunction,
      })
    }
  }

  // Also extract themes from word clustering if we don't have enough
  if (themes.length < 3) {
    const wordClusters = findWordClusters(cards)
    const wordFreq = calculateWordFrequency(cards)

    for (const [, wordSet] of wordClusters) {
      // Skip if this overlaps significantly with existing themes
      const overlaps = themes.some(t =>
        t.keywords.some(k => wordSet.has(k))
      )
      if (overlaps) continue

      const keywords = [...wordSet]
        .sort((a, b) => (wordFreq.get(b) || 0) - (wordFreq.get(a) || 0))
        .slice(0, 5)

      // Find cards that contain these keywords
      const relevantCards = cards.filter(card => {
        const cardWords = new Set(extractKeywords(card.content))
        const matches = keywords.filter(k => cardWords.has(k)).length
        return matches >= 2
      })

      if (relevantCards.length >= 2) {
        const grades = relevantCards
          .map(c => c.grade?.overall)
          .filter((g): g is number => g !== undefined)
        const avgGrade = grades.length > 0
          ? grades.reduce((a, b) => a + b, 0) / grades.length
          : 3

        themes.push({
          id: `theme-${themes.length}`,
          name: keywords.slice(0, 2).map(capitalize).join(' & '),
          keywords,
          cardIds: relevantCards.map(c => c.id),
          strength: Math.min(relevantCards.length / 5, 1),
          avgGrade,
        })
      }
    }
  }

  // Sort by strength
  return themes.sort((a, b) => b.strength - a.strength)
}

// ============================================================================
// Narrative Arc Detection
// ============================================================================

/**
 * Detect narrative arcs in the cards using Chekhov analysis
 */
export function detectNarrativeArcs(cards: HarvestCard[]): NarrativeArc[] {
  const arcs: NarrativeArc[] = []

  // Analyze each card's narrative function
  const cardFunctions = cards.map(card => {
    // Use existing Chekhov analysis if available
    if (card.grade?.chekhovAnalysis) {
      return {
        card,
        function: card.grade.chekhovAnalysis.function,
        necessity: card.grade.chekhovAnalysis.necessity,
      }
    }

    // Run fresh analysis
    const analysis = analyzeNecessity(card.content)
    return {
      card,
      function: analysis.function,
      necessity: analysis.necessity,
    }
  })

  // Group by narrative function
  const setups = cardFunctions.filter(cf => cf.function === 'setup')
  const payoffs = cardFunctions.filter(cf => cf.function === 'payoff')
  const characterizations = cardFunctions.filter(cf => cf.function === 'characterization')
  const worldbuilding = cardFunctions.filter(cf => cf.function === 'worldbuilding')
  const transitions = cardFunctions.filter(cf => cf.function === 'transition')

  // Detect main narrative arc
  if (setups.length > 0 || payoffs.length > 0) {
    const mainArc: NarrativeArc = {
      id: 'main-arc',
      name: 'Main Narrative',
      phases: [],
      cardIds: [],
      completeness: 0,
    }

    // Setup phase
    if (setups.length > 0) {
      mainArc.phases.push({
        type: 'setup',
        cardIds: setups.map(cf => cf.card.id),
        strength: Math.min(setups.length / 3, 1),
      })
      mainArc.cardIds.push(...setups.map(cf => cf.card.id))
    }

    // Development phase (characterization + worldbuilding + transitions)
    const development = [...characterizations, ...worldbuilding, ...transitions]
    if (development.length > 0) {
      mainArc.phases.push({
        type: 'development',
        cardIds: development.map(cf => cf.card.id),
        strength: Math.min(development.length / 5, 1),
      })
      mainArc.cardIds.push(...development.map(cf => cf.card.id))
    }

    // Resolution phase (payoffs)
    if (payoffs.length > 0) {
      mainArc.phases.push({
        type: 'resolution',
        cardIds: payoffs.map(cf => cf.card.id),
        strength: Math.min(payoffs.length / 2, 1),
      })
      mainArc.cardIds.push(...payoffs.map(cf => cf.card.id))
    }

    // Calculate completeness
    const phaseCount = mainArc.phases.length
    const avgStrength = mainArc.phases.reduce((sum, p) => sum + p.strength, 0) / phaseCount
    mainArc.completeness = (phaseCount / 4) * avgStrength

    if (mainArc.cardIds.length >= 2) {
      arcs.push(mainArc)
    }
  }

  // Detect thematic arcs (cards that share themes and have progression)
  // This uses temporal ordering if available
  const cardsWithDates = cards
    .filter(c => c.createdAt)
    .sort((a, b) => {
      const dateA = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt!).getTime()
      const dateB = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt!).getTime()
      return dateA - dateB
    })

  if (cardsWithDates.length >= 4) {
    // Look for evolution of thought (similar topics discussed over time)
    const thirds = Math.ceil(cardsWithDates.length / 3)
    const early = cardsWithDates.slice(0, thirds)
    const middle = cardsWithDates.slice(thirds, thirds * 2)
    const late = cardsWithDates.slice(thirds * 2)

    // Check if there's thematic consistency across time
    const earlyKeywords = new Set(early.flatMap(c => extractKeywords(c.content).slice(0, 10)))
    const lateKeywords = new Set(late.flatMap(c => extractKeywords(c.content).slice(0, 10)))

    const overlap = [...earlyKeywords].filter(k => lateKeywords.has(k))

    if (overlap.length >= 3) {
      arcs.push({
        id: 'temporal-arc',
        name: 'Temporal Evolution',
        phases: [
          { type: 'setup', cardIds: early.map(c => c.id), strength: 0.8 },
          { type: 'development', cardIds: middle.map(c => c.id), strength: 0.8 },
          { type: 'resolution', cardIds: late.map(c => c.id), strength: 0.8 },
        ],
        cardIds: cardsWithDates.map(c => c.id),
        completeness: 0.7,
      })
    }
  }

  return arcs
}

// ============================================================================
// Source Mapping
// ============================================================================

/**
 * Map each card to relevant themes and calculate relevance scores
 */
export function mapSourcesToThemes(
  cards: HarvestCard[],
  themes: ExtractedTheme[]
): SourceMapping[] {
  const mappings: SourceMapping[] = []

  // Sort cards by date if available for position detection
  const sortedCards = [...cards].sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0
    if (!a.createdAt) return 1
    if (!b.createdAt) return -1
    const dateA = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt).getTime()
    const dateB = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime()
    return dateA - dateB
  })

  const totalCards = sortedCards.length

  for (let i = 0; i < sortedCards.length; i++) {
    const card = sortedCards[i]
    const cardKeywords = new Set(extractKeywords(card.content))
    const relevantThemes: string[] = []
    const relevanceScores: Record<string, number> = {}

    for (const theme of themes) {
      // Calculate relevance based on keyword overlap
      const matchingKeywords = theme.keywords.filter(k => cardKeywords.has(k))
      const relevance = matchingKeywords.length / theme.keywords.length

      if (relevance > 0.2) {
        relevantThemes.push(theme.id)
        relevanceScores[theme.id] = relevance
      }
    }

    // Determine narrative position
    let narrativePosition: SourceMapping['narrativePosition']
    if (card.createdAt) {
      const position = i / totalCards
      if (position < 0.33) narrativePosition = 'early'
      else if (position < 0.67) narrativePosition = 'middle'
      else narrativePosition = 'late'
    }

    // Determine if this is a key passage
    const isKeyPassage =
      (card.grade?.overall ?? 0) >= 4 ||
      (card.grade?.chekhovAnalysis?.necessity ?? 0) >= 0.7 ||
      (card.grade?.inflection ?? 0) >= 4

    mappings.push({
      cardId: card.id,
      themes: relevantThemes,
      relevanceScores,
      narrativePosition,
      isKeyPassage,
    })
  }

  return mappings
}

// ============================================================================
// Coverage Analysis
// ============================================================================

/**
 * Identify gaps and strengths in the harvest coverage
 */
export function analyzeCoverage(
  themes: ExtractedTheme[],
  arcs: NarrativeArc[],
  mappings: SourceMapping[]
): { gaps: CoverageGap[]; strengths: string[] } {
  const gaps: CoverageGap[] = []
  const strengths: string[] = []

  // Check theme coverage
  for (const theme of themes) {
    if (theme.cardIds.length < 2) {
      gaps.push({
        theme: theme.name,
        description: `Only ${theme.cardIds.length} card(s) support this theme`,
        severity: 'moderate',
        suggestedAction: `Find more content related to: ${theme.keywords.join(', ')}`,
      })
    } else if (theme.strength >= 0.8) {
      strengths.push(`Strong coverage of "${theme.name}" (${theme.cardIds.length} cards)`)
    }

    // Check for low-quality theme coverage
    if (theme.avgGrade < 3 && theme.cardIds.length >= 2) {
      gaps.push({
        theme: theme.name,
        description: `Theme "${theme.name}" has low average quality (${theme.avgGrade.toFixed(1)}/5)`,
        severity: 'minor',
        suggestedAction: 'Consider finding higher-quality sources or revising existing cards',
      })
    }
  }

  // Check narrative arc completeness
  for (const arc of arcs) {
    const missingPhases: string[] = []

    if (!arc.phases.some(p => p.type === 'setup')) {
      missingPhases.push('setup/introduction')
    }
    if (!arc.phases.some(p => p.type === 'development')) {
      missingPhases.push('development/middle')
    }
    if (!arc.phases.some(p => p.type === 'resolution')) {
      missingPhases.push('resolution/conclusion')
    }

    if (missingPhases.length > 0) {
      gaps.push({
        theme: arc.name,
        description: `Missing narrative phases: ${missingPhases.join(', ')}`,
        severity: missingPhases.length >= 2 ? 'major' : 'moderate',
        suggestedAction: `Add content that provides ${missingPhases.join(' and ')}`,
      })
    } else if (arc.completeness >= 0.7) {
      strengths.push(`Complete narrative arc: "${arc.name}"`)
    }
  }

  // Check for orphan cards (not mapped to any theme)
  const orphanCount = mappings.filter(m => m.themes.length === 0).length
  if (orphanCount > 0) {
    gaps.push({
      theme: 'General',
      description: `${orphanCount} card(s) don't fit any detected theme`,
      severity: orphanCount > 3 ? 'moderate' : 'minor',
      suggestedAction: 'Review orphan cards - they may need tagging or represent a new theme',
    })
  }

  // Check for key passages distribution
  const keyPassages = mappings.filter(m => m.isKeyPassage)
  if (keyPassages.length === 0) {
    gaps.push({
      theme: 'Quality',
      description: 'No high-quality key passages identified',
      severity: 'major',
      suggestedAction: 'Review card grades or harvest higher-quality content',
    })
  } else if (keyPassages.length >= 3) {
    strengths.push(`${keyPassages.length} key passages identified for emphasis`)
  }

  return { gaps, strengths }
}

// ============================================================================
// Section Suggestion
// ============================================================================

/**
 * Suggest outline sections based on themes and arcs
 */
export function suggestSections(
  themes: ExtractedTheme[],
  arcs: NarrativeArc[],
  mappings: SourceMapping[],
  cards: HarvestCard[]
): SuggestedSection[] {
  const sections: SuggestedSection[] = []

  // Build a lookup for key passages
  const keyPassageIds = new Set(
    mappings.filter(m => m.isKeyPassage).map(m => m.cardId)
  )

  // If we have a complete main arc, use it as the primary structure
  const mainArc = arcs.find(a => a.id === 'main-arc' && a.completeness >= 0.5)

  if (mainArc) {
    // Structure based on narrative arc
    let order = 1

    for (const phase of mainArc.phases) {
      const phaseCards = cards.filter(c => phase.cardIds.includes(c.id))
      const wordCount = phaseCards.reduce((sum, c) =>
        sum + c.content.split(/\s+/).length, 0
      )

      // Find themes that align with this phase
      const phaseThemes = themes.filter(t =>
        t.cardIds.some(id => phase.cardIds.includes(id))
      )

      // Count key passages in this phase
      const keyCount = phase.cardIds.filter(id => keyPassageIds.has(id)).length
      const keyNote = keyCount > 0 ? ` (${keyCount} key passage${keyCount > 1 ? 's' : ''})` : ''

      sections.push({
        title: getPhaseName(phase.type),
        description: `${phase.type} phase with ${phaseCards.length} cards${keyNote}`,
        themeIds: phaseThemes.map(t => t.id),
        cardIds: phase.cardIds,
        order: order++,
        estimatedWordCount: Math.round(wordCount * 1.5), // Estimate expansion
      })
    }
  } else {
    // Structure based on themes (fallback)
    let order = 1

    // Sort themes by strength and narrative function
    const sortedThemes = [...themes].sort((a, b) => {
      // Put setup-type themes first
      if (a.narrativeFunction === 'setup' && b.narrativeFunction !== 'setup') return -1
      if (b.narrativeFunction === 'setup' && a.narrativeFunction !== 'setup') return 1
      // Put payoff-type themes last
      if (a.narrativeFunction === 'payoff' && b.narrativeFunction !== 'payoff') return 1
      if (b.narrativeFunction === 'payoff' && a.narrativeFunction !== 'payoff') return -1
      // Otherwise sort by strength
      return b.strength - a.strength
    })

    for (const theme of sortedThemes.slice(0, 6)) {
      const themeCards = cards.filter(c => theme.cardIds.includes(c.id))
      const wordCount = themeCards.reduce((sum, c) =>
        sum + c.content.split(/\s+/).length, 0
      )

      // Count key passages in this theme
      const keyCount = theme.cardIds.filter(id => keyPassageIds.has(id)).length
      const keyNote = keyCount > 0 ? ` - ${keyCount} key passage${keyCount > 1 ? 's' : ''}` : ''

      sections.push({
        title: theme.name,
        description: `Based on theme: ${theme.keywords.slice(0, 3).join(', ')}${keyNote}`,
        themeIds: [theme.id],
        cardIds: theme.cardIds,
        order: order++,
        estimatedWordCount: Math.round(wordCount * 1.5),
      })
    }
  }

  return sections
}

function getPhaseName(type: ArcPhase['type']): string {
  switch (type) {
    case 'setup': return 'Introduction'
    case 'development': return 'Development'
    case 'climax': return 'Turning Point'
    case 'resolution': return 'Conclusion'
  }
}

// ============================================================================
// Main Research Function
// ============================================================================

/**
 * Conduct full research analysis on harvest cards
 */
export async function researchHarvest(
  cards: HarvestCard[],
  clusters?: ReactiveCluster[]
): Promise<OutlineResearch> {
  if (cards.length === 0) {
    return {
      themes: [],
      arcs: [],
      sourceMappings: [],
      coverageGaps: [{
        theme: 'General',
        description: 'No cards to analyze',
        severity: 'major',
        suggestedAction: 'Harvest content before creating an outline',
      }],
      strongAreas: [],
      suggestedSections: [],
      totalCards: 0,
      analyzedAt: new Date().toISOString(),
      confidence: 0,
    }
  }

  // Extract themes
  const themes = extractThemes(cards, clusters)

  // Detect narrative arcs
  const arcs = detectNarrativeArcs(cards)

  // Map sources to themes
  const sourceMappings = mapSourcesToThemes(cards, themes)

  // Analyze coverage
  const { gaps, strengths } = analyzeCoverage(themes, arcs, sourceMappings)

  // Suggest sections
  const suggestedSections = suggestSections(themes, arcs, sourceMappings, cards)

  // Calculate overall confidence
  const themeConfidence = Math.min(themes.length / 3, 1)
  const arcConfidence = arcs.length > 0 ? arcs[0].completeness : 0
  const coverageConfidence = 1 - (gaps.filter(g => g.severity === 'major').length * 0.2)
  const confidence = (themeConfidence + arcConfidence + coverageConfidence) / 3

  return {
    themes,
    arcs,
    sourceMappings,
    coverageGaps: gaps,
    strongAreas: strengths,
    suggestedSections,
    totalCards: cards.length,
    analyzedAt: new Date().toISOString(),
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}

// ============================================================================
// Utilities
// ============================================================================

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function findMode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined

  const counts = new Map<T, number>()
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1)
  }

  let maxCount = 0
  let mode: T | undefined

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      mode = item
    }
  }

  return mode
}

// ============================================================================
// Review Phase Types
// ============================================================================

export interface OutlineItemReview {
  itemText: string
  itemPath: string // e.g., "0", "0-1" for nested items
  coverage: 'strong' | 'partial' | 'weak' | 'none'
  matchingCardIds: string[]
  relevanceScore: number // 0-1
  matchingThemes: string[]
  suggestedCards: string[] // Cards that could be added
  notes: string[]
}

export interface OutlineReview {
  // Per-item analysis
  itemReviews: OutlineItemReview[]

  // Aggregate scores
  overallCoverage: number // 0-1, how well cards cover the outline
  feasibility: number // 0-1, can this outline be written from the harvest?

  // Gaps and suggestions
  uncoveredItems: string[] // Outline items with no matching cards
  partialItems: string[] // Outline items with weak coverage
  suggestedAdditions: SuggestedAddition[] // Themes/content not in outline

  // Card assignments
  cardAssignments: Map<string, string[]> // outlineItemPath -> cardIds

  // Summary
  summary: string
  reviewedAt: string
}

export interface SuggestedAddition {
  title: string
  reason: string
  themeId?: string
  cardIds: string[]
  insertAfter?: string // Outline item path to insert after
}

// ============================================================================
// Review Phase Implementation
// ============================================================================

/**
 * Calculate text similarity for matching outline items to cards
 */
function calculateTextRelevance(outlineText: string, cardContent: string): number {
  const outlineWords = new Set(extractKeywords(outlineText, 3))
  const cardWords = new Set(extractKeywords(cardContent, 3))

  if (outlineWords.size === 0) return 0

  // Calculate what fraction of outline words appear in card
  const matches = [...outlineWords].filter(w => cardWords.has(w)).length
  return matches / outlineWords.size
}

/**
 * Find cards that match an outline item
 */
function findMatchingCards(
  outlineText: string,
  cards: HarvestCard[],
  themes: ExtractedTheme[],
  minRelevance = 0.2
): { cardId: string; relevance: number; themes: string[] }[] {
  const matches: { cardId: string; relevance: number; themes: string[] }[] = []

  // Find themes that match this outline item
  const matchingThemes = themes.filter(theme => {
    const themeRelevance = calculateTextRelevance(outlineText, theme.keywords.join(' '))
    return themeRelevance > 0.3
  })

  const themeCardIds = new Set(matchingThemes.flatMap(t => t.cardIds))

  for (const card of cards) {
    // Direct text relevance
    const textRelevance = calculateTextRelevance(outlineText, card.content)

    // Theme-based relevance (boost if card is in matching themes)
    const themeBoost = themeCardIds.has(card.id) ? 0.2 : 0

    // Title match boost
    const titleRelevance = card.title
      ? calculateTextRelevance(outlineText, card.title) * 0.3
      : 0

    const totalRelevance = Math.min(1, textRelevance + themeBoost + titleRelevance)

    if (totalRelevance >= minRelevance) {
      matches.push({
        cardId: card.id,
        relevance: totalRelevance,
        themes: matchingThemes
          .filter(t => t.cardIds.includes(card.id))
          .map(t => t.id),
      })
    }
  }

  // Sort by relevance
  return matches.sort((a, b) => b.relevance - a.relevance)
}

/**
 * Review a single outline item
 */
function reviewOutlineItem(
  item: OutlineItem,
  path: string,
  cards: HarvestCard[],
  themes: ExtractedTheme[],
  research: OutlineResearch
): OutlineItemReview {
  const matches = findMatchingCards(item.text, cards, themes)
  const matchingCardIds = matches.map(m => m.cardId)
  const avgRelevance = matches.length > 0
    ? matches.reduce((sum, m) => sum + m.relevance, 0) / matches.length
    : 0

  // Determine coverage level
  let coverage: OutlineItemReview['coverage']
  if (matches.length === 0) {
    coverage = 'none'
  } else if (matches.length >= 3 && avgRelevance >= 0.5) {
    coverage = 'strong'
  } else if (matches.length >= 1 && avgRelevance >= 0.3) {
    coverage = 'partial'
  } else {
    coverage = 'weak'
  }

  // Find themes that match
  const matchingThemes = [...new Set(matches.flatMap(m => m.themes))]

  // Suggest additional cards from related themes
  const suggestedCards: string[] = []
  for (const themeId of matchingThemes) {
    const theme = themes.find(t => t.id === themeId)
    if (theme) {
      const unassigned = theme.cardIds.filter(id => !matchingCardIds.includes(id))
      suggestedCards.push(...unassigned.slice(0, 2))
    }
  }

  // Generate notes
  const notes: string[] = []
  if (coverage === 'none') {
    notes.push('No matching content found - consider harvesting more material')
  } else if (coverage === 'weak') {
    notes.push('Limited coverage - may need additional sources')
  } else if (coverage === 'strong') {
    notes.push(`Well covered with ${matches.length} sources`)
  }

  // Check for key passages
  const keyPassages = research.sourceMappings
    .filter(m => m.isKeyPassage && matchingCardIds.includes(m.cardId))
  if (keyPassages.length > 0) {
    notes.push(`Contains ${keyPassages.length} key passage(s)`)
  }

  return {
    itemText: item.text,
    itemPath: path,
    coverage,
    matchingCardIds,
    relevanceScore: avgRelevance,
    matchingThemes,
    suggestedCards: [...new Set(suggestedCards)],
    notes,
  }
}

/**
 * Recursively review all outline items
 */
function reviewOutlineItems(
  items: OutlineItem[],
  basePath: string,
  cards: HarvestCard[],
  themes: ExtractedTheme[],
  research: OutlineResearch
): OutlineItemReview[] {
  const reviews: OutlineItemReview[] = []

  items.forEach((item, index) => {
    const path = basePath ? `${basePath}-${index}` : `${index}`

    // Review this item
    reviews.push(reviewOutlineItem(item, path, cards, themes, research))

    // Recursively review children
    if (item.children && item.children.length > 0) {
      reviews.push(...reviewOutlineItems(item.children, path, cards, themes, research))
    }
  })

  return reviews
}

/**
 * Find themes from research that aren't represented in the outline
 */
function findUnrepresentedThemes(
  _outline: OutlineStructure, // Reserved for future: analyze outline structure
  themes: ExtractedTheme[],
  itemReviews: OutlineItemReview[]
): SuggestedAddition[] {
  const suggestions: SuggestedAddition[] = []

  // Get all themes that were matched to outline items
  const representedThemes = new Set(itemReviews.flatMap(r => r.matchingThemes))

  // Find strong themes not represented
  for (const theme of themes) {
    if (representedThemes.has(theme.id)) continue
    if (theme.strength < 0.4) continue // Only suggest strong themes
    if (theme.cardIds.length < 2) continue // Need multiple cards

    suggestions.push({
      title: theme.name,
      reason: `Strong theme (${theme.cardIds.length} cards, ${Math.round(theme.strength * 100)}% strength) not covered in outline`,
      themeId: theme.id,
      cardIds: theme.cardIds,
    })
  }

  return suggestions
}

/**
 * Generate review summary
 */
function generateReviewSummary(
  itemReviews: OutlineItemReview[],
  feasibility: number,
  uncoveredItems: string[],
  suggestedAdditions: SuggestedAddition[]
): string {
  const total = itemReviews.length
  const strong = itemReviews.filter(r => r.coverage === 'strong').length
  const partial = itemReviews.filter(r => r.coverage === 'partial').length
  const weak = itemReviews.filter(r => r.coverage === 'weak').length
  const none = itemReviews.filter(r => r.coverage === 'none').length

  let summary = `Outline Review: ${total} items analyzed\n`
  summary += `Coverage: ${strong} strong, ${partial} partial, ${weak} weak, ${none} uncovered\n`
  summary += `Feasibility: ${Math.round(feasibility * 100)}%\n`

  if (uncoveredItems.length > 0) {
    summary += `\nUncovered items need content:\n`
    summary += uncoveredItems.slice(0, 3).map(item => `  - ${item}`).join('\n')
    if (uncoveredItems.length > 3) {
      summary += `\n  ... and ${uncoveredItems.length - 3} more`
    }
  }

  if (suggestedAdditions.length > 0) {
    summary += `\n\nConsider adding sections for:\n`
    summary += suggestedAdditions.slice(0, 3).map(s => `  - ${s.title}: ${s.reason}`).join('\n')
  }

  return summary
}

/**
 * Review a proposed outline against research findings
 */
export function reviewOutline(
  outline: OutlineStructure,
  cards: HarvestCard[],
  research: OutlineResearch
): OutlineReview {
  const { themes } = research

  // Review each outline item
  const itemReviews = reviewOutlineItems(outline.items, '', cards, themes, research)

  // Calculate aggregate coverage
  const coverageScores: number[] = itemReviews.map(r => {
    switch (r.coverage) {
      case 'strong': return 1
      case 'partial': return 0.6
      case 'weak': return 0.3
      case 'none': return 0
    }
  })
  const overallCoverage = coverageScores.reduce((a, b) => a + b, 0) / coverageScores.length

  // Calculate feasibility (coverage + relevance)
  const avgRelevance = itemReviews.reduce((sum, r) => sum + r.relevanceScore, 0) / itemReviews.length
  const feasibility = (overallCoverage * 0.6) + (avgRelevance * 0.4)

  // Find uncovered and partial items
  const uncoveredItems = itemReviews
    .filter(r => r.coverage === 'none')
    .map(r => r.itemText)
  const partialItems = itemReviews
    .filter(r => r.coverage === 'weak' || r.coverage === 'partial')
    .map(r => r.itemText)

  // Find suggested additions
  const suggestedAdditions = findUnrepresentedThemes(outline, themes, itemReviews)

  // Build card assignments map
  const cardAssignments = new Map<string, string[]>()
  for (const review of itemReviews) {
    if (review.matchingCardIds.length > 0) {
      cardAssignments.set(review.itemPath, review.matchingCardIds)
    }
  }

  // Generate summary
  const summary = generateReviewSummary(itemReviews, feasibility, uncoveredItems, suggestedAdditions)

  return {
    itemReviews,
    overallCoverage,
    feasibility,
    uncoveredItems,
    partialItems,
    suggestedAdditions,
    cardAssignments,
    summary,
    reviewedAt: new Date().toISOString(),
  }
}

// ============================================================================
// Generation Phase Types
// ============================================================================

export interface GeneratedOutlineItem extends OutlineItem {
  cardIds: string[] // Cards assigned to this section
  confidence: number // 0-1, how confident we are in this section
  source: 'research' | 'proposed' | 'merged' // Where this item came from
}

export interface GeneratedOutline {
  structure: OutlineStructure
  itemCardAssignments: Map<string, string[]> // itemPath -> cardIds
  confidence: number
  generatedAt: string
  basedOn: {
    research: boolean
    proposedOutline: boolean
    userPrompts: boolean
  }
}

export interface OutlineGenerationConfig {
  // Include proposed outline items even if coverage is weak
  keepProposedItems?: boolean
  // Minimum coverage to include a research-based section
  minSectionStrength?: number
  // Maximum sections to generate
  maxSections?: number
  // Narrative arc preference
  preferArcStructure?: boolean
  // User prompts/instructions for outline
  userPrompts?: string[]
}

// ============================================================================
// Generation Phase Implementation
// ============================================================================

/**
 * Merge a proposed outline with research suggestions
 */
function mergeOutlines(
  proposed: OutlineStructure | null,
  research: OutlineResearch,
  review: OutlineReview | null,
  config: OutlineGenerationConfig
): GeneratedOutlineItem[] {
  const items: GeneratedOutlineItem[] = []
  const usedCardIds = new Set<string>()

  // If we have a proposed outline with good coverage, use it as base
  if (proposed && review && review.feasibility >= 0.4) {
    for (const itemReview of review.itemReviews) {
      // Skip items with no coverage unless keepProposedItems is set
      if (itemReview.coverage === 'none' && !config.keepProposedItems) {
        continue
      }

      items.push({
        level: 0, // Will be adjusted based on path
        text: itemReview.itemText,
        cardIds: itemReview.matchingCardIds,
        confidence: itemReview.relevanceScore,
        source: 'proposed',
      })

      itemReview.matchingCardIds.forEach(id => usedCardIds.add(id))
    }
  }

  // Add suggested sections from research that aren't covered
  const minStrength = config.minSectionStrength ?? 0.3

  for (const section of research.suggestedSections) {
    // Skip if we already have similar content
    const hasOverlap = items.some(item => {
      const itemCardSet = new Set(item.cardIds)
      const overlap = section.cardIds.filter(id => itemCardSet.has(id)).length
      return overlap > section.cardIds.length * 0.5
    })

    if (hasOverlap) continue

    // Check minimum strength
    const sectionThemes = research.themes.filter(t => section.themeIds.includes(t.id))
    const avgStrength = sectionThemes.length > 0
      ? sectionThemes.reduce((sum, t) => sum + t.strength, 0) / sectionThemes.length
      : 0

    if (avgStrength < minStrength && items.length > 0) continue

    items.push({
      level: 0,
      text: section.title,
      cardIds: section.cardIds.filter(id => !usedCardIds.has(id)),
      confidence: avgStrength,
      source: 'research',
    })

    section.cardIds.forEach(id => usedCardIds.add(id))
  }

  // Add any suggested additions from review
  if (review) {
    for (const addition of review.suggestedAdditions) {
      const unusedCards = addition.cardIds.filter(id => !usedCardIds.has(id))
      if (unusedCards.length < 2) continue

      items.push({
        level: 0,
        text: addition.title,
        cardIds: unusedCards,
        confidence: 0.5,
        source: 'research',
      })

      unusedCards.forEach(id => usedCardIds.add(id))
    }
  }

  return items
}

/**
 * Order items for narrative flow
 */
function orderForNarrativeFlow(
  items: GeneratedOutlineItem[],
  research: OutlineResearch,
  cards: HarvestCard[]
): GeneratedOutlineItem[] {
  // Create a card lookup for temporal positioning
  const cardLookup = new Map(cards.map(c => [c.id, c]))

  // Score each item by narrative position
  const scoredItems = items.map(item => {
    // Check for narrative function from themes
    const itemThemes = research.themes.filter(t =>
      t.cardIds.some(id => item.cardIds.includes(id))
    )

    // Setup functions should come first
    const hasSetup = itemThemes.some(t => t.narrativeFunction === 'setup')
    const hasPayoff = itemThemes.some(t => t.narrativeFunction === 'payoff')

    // Check temporal position of cards
    const itemCards = item.cardIds
      .map(id => cardLookup.get(id))
      .filter((c): c is HarvestCard => c !== undefined)

    const avgTime = itemCards.reduce((sum, c) => {
      if (!c.createdAt) return sum
      const time = typeof c.createdAt === 'number' ? c.createdAt : new Date(c.createdAt).getTime()
      return sum + time
    }, 0) / (itemCards.length || 1)

    // Calculate order score (lower = earlier)
    let orderScore = avgTime || Date.now()

    // Boost setup-type items to come first
    if (hasSetup) orderScore -= 1e15
    // Push payoff-type items to come last
    if (hasPayoff) orderScore += 1e15

    return { item, orderScore }
  })

  // Sort by order score
  scoredItems.sort((a, b) => a.orderScore - b.orderScore)

  // Assign level based on position
  return scoredItems.map(({ item }) => ({
    ...item,
    level: 0, // All top-level for now
  }))
}

/**
 * Generate an outline from research (and optionally a proposed outline)
 */
export function generateOutline(
  cards: HarvestCard[],
  research: OutlineResearch,
  proposedOutline?: OutlineStructure,
  config: OutlineGenerationConfig = {}
): GeneratedOutline {
  // If proposed outline, review it first
  let review: OutlineReview | null = null
  if (proposedOutline) {
    review = reviewOutline(proposedOutline, cards, research)
  }

  // Merge outlines
  let items = mergeOutlines(proposedOutline ?? null, research, review, config)

  // Limit sections if needed
  const maxSections = config.maxSections ?? 10
  if (items.length > maxSections) {
    // Keep highest confidence items
    items.sort((a, b) => b.confidence - a.confidence)
    items = items.slice(0, maxSections)
  }

  // Order for narrative flow
  if (config.preferArcStructure !== false) {
    items = orderForNarrativeFlow(items, research, cards)
  }

  // Build card assignments map
  const itemCardAssignments = new Map<string, string[]>()
  items.forEach((item, index) => {
    itemCardAssignments.set(`${index}`, item.cardIds)
  })

  // Convert to OutlineStructure
  const structure: OutlineStructure = {
    type: proposedOutline?.type ?? 'numbered',
    items: items.map(item => ({
      level: item.level,
      text: item.text,
      children: undefined,
    })),
    depth: 1,
    confidence: items.length > 0
      ? items.reduce((sum, i) => sum + i.confidence, 0) / items.length
      : 0,
  }

  return {
    structure,
    itemCardAssignments,
    confidence: structure.confidence,
    generatedAt: new Date().toISOString(),
    basedOn: {
      research: true,
      proposedOutline: !!proposedOutline,
      userPrompts: (config.userPrompts?.length ?? 0) > 0,
    },
  }
}

// ============================================================================
// Card Ordering for Draft Generation
// ============================================================================

export interface OrderedSection {
  title: string
  outlineItemPath: string
  cards: HarvestCard[]
  keyPassageIds: string[]
}

/**
 * Order cards according to outline structure for draft generation
 */
export function orderCardsForOutline(
  outline: OutlineStructure | GeneratedOutline,
  cards: HarvestCard[],
  research: OutlineResearch
): OrderedSection[] {
  const sections: OrderedSection[] = []
  const cardLookup = new Map(cards.map(c => [c.id, c]))

  // Get card assignments
  let assignments: Map<string, string[]>
  let items: OutlineItem[]

  if ('structure' in outline) {
    // GeneratedOutline
    assignments = outline.itemCardAssignments
    items = outline.structure.items
  } else {
    // OutlineStructure - need to generate assignments
    const review = reviewOutline(outline, cards, research)
    assignments = review.cardAssignments
    items = outline.items
  }

  // Build sections with ordered cards
  items.forEach((item, index) => {
    const path = `${index}`
    const cardIds = assignments.get(path) || []

    // Get cards and sort by relevance/time
    const sectionCards = cardIds
      .map(id => cardLookup.get(id))
      .filter((c): c is HarvestCard => c !== undefined)
      .sort((a, b) => {
        // Sort by grade (higher first), then by time
        const gradeA = a.grade?.overall ?? 3
        const gradeB = b.grade?.overall ?? 3
        if (gradeA !== gradeB) return gradeB - gradeA

        // Then by time
        if (!a.createdAt && !b.createdAt) return 0
        if (!a.createdAt) return 1
        if (!b.createdAt) return -1
        const timeA = typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt).getTime()
        const timeB = typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime()
        return timeA - timeB
      })

    // Identify key passages
    const keyPassageIds = research.sourceMappings
      .filter(m => m.isKeyPassage && cardIds.includes(m.cardId))
      .map(m => m.cardId)

    if (sectionCards.length > 0) {
      sections.push({
        title: item.text,
        outlineItemPath: path,
        cards: sectionCards,
        keyPassageIds,
      })
    }
  })

  return sections
}

// ============================================================================
// API-Aware Functions (Server-Side Delegation)
// ============================================================================

/**
 * Research harvest cards via server API.
 * This is the preferred method when bookId is available.
 *
 * @deprecated for direct card-based calls - use researchHarvestViaApi when bookId available
 */
export async function researchHarvestViaApi(bookId: string): Promise<OutlineResearch> {
  try {
    const apiResearch = await apiRunResearch(bookId)
    // API returns compatible OutlineResearch type
    return apiResearch as unknown as OutlineResearch
  } catch (error) {
    console.error('[outline-agent] API research failed, cannot fallback without cards:', error)
    throw error
  }
}

/**
 * Generate outline via server API.
 * This is the preferred method when bookId is available.
 */
export async function generateOutlineViaApi(
  bookId: string,
  config: OutlineGenerationConfig = {}
): Promise<GeneratedOutline> {
  try {
    const apiOutline = await apiGenerateOutline(bookId, {
      maxSections: config.maxSections,
      preferArcStructure: config.preferArcStructure,
    })

    // Convert API response to local GeneratedOutline type
    // The API returns a slightly different structure, so we adapt it
    return {
      structure: apiOutline.structure as unknown as OutlineStructure,
      itemCardAssignments: new Map(Object.entries(apiOutline.itemCardAssignments || {})),
      confidence: apiOutline.confidence,
      generatedAt: apiOutline.generatedAt,
      basedOn: apiOutline.basedOn,
    }
  } catch (error) {
    console.error('[outline-agent] API outline generation failed:', error)
    throw error
  }
}

/**
 * Order cards for draft via server API.
 */
export async function orderCardsForDraftViaApi(
  bookId: string,
  outlineId?: string
): Promise<OrderedSection[]> {
  try {
    const apiSections = await apiOrderCardsForDraft(bookId, outlineId)
    // Convert API response to local OrderedSection type
    return apiSections.map(section => ({
      title: section.title,
      outlineItemPath: section.outlineItemPath,
      cards: section.cards as unknown as HarvestCard[],
      keyPassageIds: section.keyPassageIds,
    }))
  } catch (error) {
    console.error('[outline-agent] API order cards failed:', error)
    throw error
  }
}
