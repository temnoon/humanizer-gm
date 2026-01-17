/**
 * Harvest Review Agent
 *
 * Grades cards using SIC (authenticity), Chekhov (necessity), and Quantum (inflection)
 * analysis tools. Runs in hybrid mode: quick classification on harvest, deep grading
 * in background.
 */

import type {
  HarvestCard,
  CardGrade,
  StubClassification,
  SICAnalysis,
  QuantumHighlights,
} from './types'
import { normalizeDate } from './types'
import { getConfig } from './config'
import { analyzeNecessity } from './chekhov-local'
import { detectOutline } from './outline-detector'

// ============================================================================
// Stub Classification (Fast, Synchronous)
// ============================================================================

/**
 * Classify a card's stub type using heuristics (no LLM needed)
 * Runs synchronously on harvest for immediate feedback
 */
export function classifyStub(card: HarvestCard): StubClassification {
  const content = card.content.trim()
  const wordCount = content.split(/\s+/).filter(Boolean).length
  const sentenceCount = content.split(/[.!?]+/).filter(Boolean).length
  const hasUrl = /https?:\/\//.test(content)

  // Media: image/video/audio patterns
  if (/\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|pdf)$/i.test(content) ||
      /\[image\]|\[video\]|\[audio\]|\[attachment\]/i.test(content) ||
      /!\[.*\]\(.*\)/.test(content)) {
    return 'stub-media'
  }

  // Reference: URL-heavy content
  if (hasUrl && wordCount < 100) {
    const urls = content.match(/https?:\/\/\S+/g) || []
    const urlLength = urls.join('').length
    if (urlLength / content.length > 0.3) return 'stub-reference'
  }

  // Sentence: very short, single sentence
  if (wordCount <= 25 && sentenceCount <= 1) return 'stub-sentence'

  // Note: short with quick-capture markers
  if (wordCount < 50 && /^(TODO|NOTE|IDEA|REMEMBER|TBD|FIXME|WIP):/i.test(content)) {
    return 'stub-note'
  }

  // Breadcrumb: navigation phrases that point to adjacent content
  if (/^(in the context of|related to|see also|this leads to|following up on|as mentioned in|regarding|re:|cf\.|per|about the)/i.test(content) &&
      wordCount < 30) {
    return 'stub-breadcrumb'
  }

  // Check for list-like content that might be navigation
  const lines = content.split('\n').filter(Boolean)
  if (lines.length > 2 && lines.every(line => line.length < 50 && /^[-•*\d.]/.test(line.trim()))) {
    // Short bullet points might be breadcrumbs
    if (wordCount < 50) return 'stub-breadcrumb'
  }

  return 'optimal'
}

// ============================================================================
// Quick Grading (On Harvest)
// ============================================================================

/**
 * Quick grading that runs on harvest - just stub classification and Chekhov (local)
 */
export function quickGradeCard(card: HarvestCard): Partial<CardGrade> {
  const config = getConfig()
  const stubType = classifyStub(card)
  const wordCount = card.content.split(/\s+/).filter(Boolean).length

  // Skip deep analysis for very short content
  if (wordCount < config.reviewAgent.minWordsForAnalysis) {
    return {
      stubType,
      gradedBy: 'auto',
      gradedAt: new Date().toISOString(),
      confidence: 0.3,
      // Default grades for short content
      authenticity: 3,
      necessity: stubType === 'optimal' ? 3 : 2,
      inflection: 2,
      voice: 3,
      overall: 3,
    }
  }

  // Run local Chekhov analysis
  const chekhovResult = analyzeNecessity(card.content)

  // Map Chekhov necessity (0-1) to grade (1-5)
  const necessityGrade = Math.ceil(chekhovResult.necessity * 5) || 1

  return {
    stubType,
    necessity: necessityGrade,
    chekhovAnalysis: chekhovResult,
    gradedBy: 'auto',
    gradedAt: new Date().toISOString(),
    confidence: 0.5,
    // Placeholder grades until full analysis
    authenticity: 3,
    inflection: 2,
    voice: 3,
    overall: necessityGrade,
  }
}

// ============================================================================
// Full Grading (Background)
// ============================================================================

interface GradingQueueItem {
  card: HarvestCard
  priority: number // Higher = sooner
  addedAt: number
}

class GradingQueue {
  private queue: GradingQueueItem[] = []
  private processing = false
  private listeners: Set<(cardId: string, grade: CardGrade) => void> = new Set()

  /**
   * Add a card to the grading queue
   */
  add(card: HarvestCard, priority = 1): void {
    // Don't add if already in queue
    if (this.queue.some(item => item.card.id === card.id)) {
      return
    }

    this.queue.push({
      card,
      priority,
      addedAt: Date.now(),
    })

    // Sort by priority (descending) then by addedAt (ascending)
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.addedAt - b.addedAt
    })

    // Start processing if not already
    if (!this.processing) {
      this.processQueue()
    }
  }

  /**
   * Remove a card from the queue (e.g., if deleted)
   */
  remove(cardId: string): void {
    this.queue = this.queue.filter(item => item.card.id !== cardId)
  }

  /**
   * Subscribe to grade updates
   */
  subscribe(listener: (cardId: string, grade: CardGrade) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Process the queue in background
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return

    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()
      if (!item) break

      try {
        const grade = await gradeCardFull(item.card)
        this.notifyListeners(item.card.id, grade)
      } catch (error) {
        console.error('Grading failed for card:', item.card.id, error)
      }

      // Delay between cards to avoid overwhelming API
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.processing = false
  }

  private notifyListeners(cardId: string, grade: CardGrade): void {
    this.listeners.forEach(listener => listener(cardId, grade))
  }

  get length(): number {
    return this.queue.length
  }

  get isProcessing(): boolean {
    return this.processing
  }
}

// Singleton queue instance
export const gradingQueue = new GradingQueue()

/**
 * Full grading with SIC API call (and optionally Quantum)
 */
export async function gradeCardFull(card: HarvestCard): Promise<CardGrade> {
  const config = getConfig()
  const stubType = classifyStub(card)

  // Start with Chekhov (local, fast)
  const chekhovResult = analyzeNecessity(card.content)
  const necessityGrade = Math.ceil(chekhovResult.necessity * 5) || 1

  // Initialize grades
  let authenticityGrade = 3
  let inflectionGrade = 2
  let voiceGrade = 3
  let sicAnalysis: SICAnalysis | undefined
  let quantumHighlights: QuantumHighlights | undefined

  // SIC analysis (if enabled)
  if (config.reviewAgent.enableSIC) {
    try {
      sicAnalysis = await fetchSICAnalysis(card.content)
      // Map SIC score (0-100) to grade (1-5)
      authenticityGrade = Math.ceil((sicAnalysis.score / 100) * 5) || 1

      // Boost voice grade for raw-human content
      if (sicAnalysis.category === 'raw-human') {
        voiceGrade = 4
      } else if (sicAnalysis.category === 'polished-human') {
        voiceGrade = 5
      }
    } catch (error) {
      console.warn('SIC analysis failed:', error)
    }
  }

  // Quantum analysis (if enabled - expensive, opt-in)
  if (config.reviewAgent.enableQuantum) {
    try {
      quantumHighlights = await fetchQuantumAnalysis(card.content)
      inflectionGrade = quantumHighlights.isInflectionPoint ? 5 :
                        quantumHighlights.modalityShift && quantumHighlights.modalityShift > 0.5 ? 4 :
                        2
    } catch (error) {
      console.warn('Quantum analysis failed:', error)
    }
  }

  // Calculate weighted overall grade
  const weights = config.reviewAgent.gradeWeights
  const overallRaw =
    (authenticityGrade * weights.authenticity) +
    (necessityGrade * weights.necessity) +
    (inflectionGrade * weights.inflection) +
    (voiceGrade * weights.voice) +
    (3 * weights.clarity) // Default clarity since we don't have a clarity analyzer yet

  const overallGrade = Math.round(overallRaw)

  return {
    authenticity: authenticityGrade,
    necessity: necessityGrade,
    inflection: inflectionGrade,
    voice: voiceGrade,
    overall: Math.min(5, Math.max(1, overallGrade)),
    stubType,
    sicAnalysis,
    chekhovAnalysis: chekhovResult,
    quantumHighlights,
    gradedAt: new Date().toISOString(),
    gradedBy: 'auto',
    confidence: sicAnalysis ? 0.8 : 0.5,
  }
}

// ============================================================================
// API Calls
// ============================================================================

/**
 * Fetch SIC analysis from NPE-Local
 */
async function fetchSICAnalysis(content: string): Promise<SICAnalysis> {
  const config = getConfig()
  const response = await fetch(`${config.api.npeLocalBase}/transformations/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: content }),
  })

  if (!response.ok) {
    throw new Error(`SIC analysis failed: ${response.status}`)
  }

  const data = await response.json()

  // Map API response to our SICAnalysis type
  return {
    score: data.sicScore ?? data.score ?? 50,
    category: mapSICCategory(data.category ?? data.classification),
    signals: data.signals ?? data.markers ?? [],
  }
}

function mapSICCategory(raw: string | undefined): SICAnalysis['category'] {
  if (!raw) return 'unknown'
  const lower = raw.toLowerCase()
  if (lower.includes('polished') && lower.includes('human')) return 'polished-human'
  if (lower.includes('raw') && lower.includes('human')) return 'raw-human'
  if (lower.includes('neat') || lower.includes('slop')) return 'neat-slop'
  if (lower.includes('messy') || lower.includes('low')) return 'messy-low-craft'
  return 'unknown'
}

/**
 * Fetch Quantum analysis from NPE-Local
 */
async function fetchQuantumAnalysis(content: string): Promise<QuantumHighlights> {
  const config = getConfig()

  // Start quantum session
  const startResponse = await fetch(`${config.api.npeLocalBase}/quantum-analysis/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: content }),
  })

  if (!startResponse.ok) {
    throw new Error(`Quantum analysis start failed: ${startResponse.status}`)
  }

  const session = await startResponse.json()
  const sessionId = session.sessionId

  // Step through to get analysis (simplified - in production would step through sentences)
  let hasInflection = false
  let dominantModality: QuantumHighlights['dominantModality'] = 'literal'
  let maxModalityShift = 0

  // For simplicity, just check first and last sentences
  for (let i = 0; i < Math.min(session.totalSentences || 3, 5); i++) {
    try {
      const stepResponse = await fetch(`${config.api.npeLocalBase}/quantum-analysis/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      if (!stepResponse.ok) break

      const step = await stepResponse.json()
      if (step.isInflectionPoint) hasInflection = true
      if (step.modalityShift && step.modalityShift > maxModalityShift) {
        maxModalityShift = step.modalityShift
      }
      if (step.modality === 'metaphorical') {
        dominantModality = dominantModality === 'literal' ? 'mixed' : 'metaphorical'
      }
    } catch {
      break
    }
  }

  return {
    dominantModality,
    isInflectionPoint: hasInflection,
    modalityShift: maxModalityShift,
  }
}

// ============================================================================
// Card Processing
// ============================================================================

/**
 * Process a card on harvest: quick grade + outline detection + temporal normalization
 */
export function processCardOnHarvest(card: HarvestCard): HarvestCard {
  const config = getConfig()

  // Quick grade (synchronous)
  const quickGrade = quickGradeCard(card)

  // Outline detection
  let isOutline = false
  let outlineStructure = undefined

  if (config.outlineDetection.enabled) {
    const outline = detectOutline(card.content)
    if (outline && outline.items.length >= config.outlineDetection.minItemsForOutline) {
      isOutline = true
      outlineStructure = outline
    }
  }

  // Ensure temporal fields are set (normalize legacy createdAt if present)
  const now = Math.floor(Date.now() / 1000)
  let sourceCreatedAt = card.sourceCreatedAt
  let sourceCreatedAtStatus = card.sourceCreatedAtStatus
  const harvestedAt = card.harvestedAt || now

  // If temporal fields are missing but legacy createdAt exists, normalize it
  if (sourceCreatedAt === undefined && card.createdAt !== undefined) {
    const normalized = normalizeDate(card.createdAt)
    sourceCreatedAt = normalized.value
    sourceCreatedAtStatus = normalized.status
  }

  // Default status if still undefined
  if (sourceCreatedAtStatus === undefined) {
    sourceCreatedAtStatus = sourceCreatedAt === null ? 'unknown' : 'exact'
  }

  // Update card with quick grade and normalized temporal fields
  const updatedCard: HarvestCard = {
    ...card,
    grade: quickGrade as CardGrade,
    isOutline,
    outlineStructure,
    // Temporal fields
    sourceCreatedAt: sourceCreatedAt ?? null,
    sourceCreatedAtStatus: sourceCreatedAtStatus ?? 'unknown',
    harvestedAt,
  }

  // Queue for full grading in background (if hybrid mode)
  if (config.reviewAgent.runAt === 'hybrid' || config.reviewAgent.runAt === 'background') {
    gradingQueue.add(updatedCard)
  }

  return updatedCard
}

/**
 * Request full grading for a card (on-demand)
 */
export async function requestFullGrade(card: HarvestCard): Promise<CardGrade> {
  return gradeCardFull(card)
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Grade multiple cards in parallel (with rate limiting)
 */
export async function gradeCardsBatch(
  cards: HarvestCard[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, CardGrade>> {
  const results = new Map<string, CardGrade>()
  const batchSize = 3 // Process 3 at a time

  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize)
    const promises = batch.map(card =>
      gradeCardFull(card)
        .then(grade => ({ cardId: card.id, grade }))
        .catch(() => null)
    )

    const batchResults = await Promise.all(promises)

    for (const result of batchResults) {
      if (result) {
        results.set(result.cardId, result.grade)
      }
    }

    onProgress?.(Math.min(i + batchSize, cards.length), cards.length)

    // Rate limit between batches
    if (i + batchSize < cards.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  return results
}
