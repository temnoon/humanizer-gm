/**
 * Draft Generator Service
 *
 * Generates a first draft from harvest cards using Ollama LLM.
 * Takes ordered cards and weaves them into coherent prose while
 * preserving the author's voice and key passages.
 */

import type { HarvestCard, Chapter } from './types'
import { getConfig } from './config'
import type { OrderedSection, OutlineResearch, GeneratedOutline, OutlineStructure } from './outline-agent'

// Get Ollama URL from config (with fallback for initial load)
function getOllamaUrl(): string {
  try {
    return getConfig().api.ollamaBase
  } catch {
    return 'http://localhost:11434'
  }
}

/**
 * Deduplication utilities for harvest cards
 */

// Normalize text for comparison (lowercase, remove extra whitespace, punctuation)
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Calculate Jaccard similarity between two texts
function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(normalizeText(text1).split(' '))
  const words2 = new Set(normalizeText(text2).split(' '))

  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])

  if (union.size === 0) return 0
  return intersection.size / union.size
}

// Check if text2 is largely contained within text1
function isSubstantialSubset(shorter: string, longer: string, threshold = 0.8): boolean {
  const shorterWords = new Set(normalizeText(shorter).split(' '))
  const longerWords = new Set(normalizeText(longer).split(' '))

  if (shorterWords.size === 0) return true

  const overlap = [...shorterWords].filter(w => longerWords.has(w)).length
  return overlap / shorterWords.size >= threshold
}

/**
 * Deduplicate harvest cards, keeping the most complete/unique versions
 *
 * Strategy:
 * 1. Group cards by high similarity (configured threshold, default 0.85 Jaccard)
 * 2. From each group, keep the longest/most complete version
 * 3. Also remove cards that are substantial subsets of others
 */
export function deduplicateCards(
  cards: HarvestCard[],
  similarityThreshold?: number
): { unique: HarvestCard[]; duplicates: HarvestCard[]; stats: DedupeStats } {
  // Use config value if no threshold provided
  const threshold = similarityThreshold ?? getConfig().search.similarityThreshold
  if (cards.length <= 1) {
    return { unique: cards, duplicates: [], stats: { original: cards.length, unique: cards.length, removed: 0 } }
  }

  const duplicates: HarvestCard[] = []
  const seen = new Set<string>()
  const unique: HarvestCard[] = []

  // Sort by content length descending - prefer longer, more complete versions
  const sorted = [...cards].sort((a, b) => b.content.length - a.content.length)

  for (const card of sorted) {
    let isDuplicate = false

    for (const kept of unique) {
      const similarity = jaccardSimilarity(card.content, kept.content)

      // High similarity = duplicate
      if (similarity >= threshold) {
        isDuplicate = true
        break
      }

      // Check if this card is a subset of an existing card
      if (card.content.length < kept.content.length * 0.9) {
        if (isSubstantialSubset(card.content, kept.content)) {
          isDuplicate = true
          break
        }
      }
    }

    if (!isDuplicate && !seen.has(normalizeText(card.content))) {
      unique.push(card)
      seen.add(normalizeText(card.content))
    } else {
      duplicates.push(card)
    }
  }

  return {
    unique,
    duplicates,
    stats: {
      original: cards.length,
      unique: unique.length,
      removed: duplicates.length,
    }
  }
}

export interface DedupeStats {
  original: number
  unique: number
  removed: number
}
// Default model - empty string means auto-detect
function getDefaultModel(): string {
  try {
    const model = getConfig().draft.defaultModel
    return model || 'llama3.2' // Fallback if not configured
  } catch {
    return 'llama3.2'
  }
}

export interface DraftGeneratorConfig {
  model?: string
  temperature?: number
  preserveVoice?: boolean // Try to maintain author's original voice
  includeTransitions?: boolean // Add transitions between passages
  targetWordCount?: number // Approximate target length
}

export interface GenerationProgress {
  phase: 'preparing' | 'deduplicating' | 'generating' | 'complete' | 'error'
  tokensGenerated?: number
  partialContent?: string
  error?: string
  dedupeStats?: DedupeStats
}

function getDefaultConfig(): DraftGeneratorConfig {
  try {
    const config = getConfig()
    return {
      model: config.draft.defaultModel || getDefaultModel(),
      temperature: config.draft.temperature,
      preserveVoice: config.draft.preserveVoice,
      includeTransitions: config.draft.includeTransitions,
      targetWordCount: config.draft.targetWordCount,
    }
  } catch {
    // Fallback defaults if config not loaded yet
    return {
      model: getDefaultModel(),
      temperature: 0.7,
      preserveVoice: true,
      includeTransitions: true,
      targetWordCount: 1500,
    }
  }
}

/**
 * Check if Ollama is available
 */
export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${getOllamaUrl()}/api/tags`, {
      method: 'GET',
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get available Ollama models
 */
export async function getAvailableModels(): Promise<string[]> {
  try {
    const response = await fetch(`${getOllamaUrl()}/api/tags`)
    if (!response.ok) return [getDefaultModel()]
    const data = await response.json()
    return data.models?.map((m: { name: string }) => m.name) || [getDefaultModel()]
  } catch {
    return [getDefaultModel()]
  }
}

/**
 * Order cards for narrative flow
 * Options: chronological, by similarity to chapter theme, or manual order
 */
export function orderCardsForDraft(
  cards: HarvestCard[],
  orderBy: 'chronological' | 'original' = 'chronological'
): HarvestCard[] {
  if (orderBy === 'original') {
    return [...cards]
  }

  // Chronological order
  return [...cards].sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0
    if (!a.createdAt) return 1
    if (!b.createdAt) return -1

    const dateA = typeof a.createdAt === 'number'
      ? a.createdAt
      : new Date(a.createdAt).getTime()
    const dateB = typeof b.createdAt === 'number'
      ? b.createdAt
      : new Date(b.createdAt).getTime()

    return dateA - dateB
  })
}

/**
 * Build the prompt for draft generation
 */
function buildPrompt(
  chapter: Chapter,
  cards: HarvestCard[],
  config: DraftGeneratorConfig
): string {
  // Separate original content from reference material
  const originalCards = cards.filter(c => c.contentOrigin !== 'reference')
  const referenceCards = cards.filter(c => c.contentOrigin === 'reference')

  const formatCard = (card: HarvestCard, idx: number) => {
    const date = card.createdAt
      ? new Date(typeof card.createdAt === 'number' ? card.createdAt * 1000 : card.createdAt)
          .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : 'undated'
    const notes = card.userNotes ? `\n   Author's note: "${card.userNotes}"` : ''
    const source = card.authorName ? `${card.source} - ${card.authorName}` : card.source
    return `[${idx + 1}] (${date}, ${source}):\n"${card.content}"${notes}`
  }

  const passages = originalCards.map((card, idx) => formatCard(card, idx + 1)).join('\n\n')

  // Format reference material separately
  let referenceSection = ''
  if (referenceCards.length > 0) {
    const refs = referenceCards.map((card, idx) => {
      const source = card.authorName || card.source
      const url = card.sourceUrl ? ` (${card.sourceUrl})` : ''
      return `[Ref ${idx + 1}] ${card.title || 'Untitled'} - ${source}${url}:\n"${card.content}"`
    }).join('\n\n')

    referenceSection = `
===== REFERENCE MATERIAL (External Sources) =====
The following is REFERENCE material from external sources. Use it to:
- Inform accuracy and context
- Cite when making claims
- Provide supporting evidence
DO NOT copy phrasing or treat as the author's voice.

${refs}

===== END REFERENCE MATERIAL =====
`
  }

  const voiceNote = config.preserveVoice
    ? `IMPORTANT: Preserve the author's original voice and writing style. The passages are written by the author - maintain their tone, vocabulary, and style.`
    : ''

  const transitionNote = config.includeTransitions
    ? `Add smooth transitions between passages to create narrative flow.`
    : `Keep passages mostly intact, with minimal additions.`

  const lengthNote = config.targetWordCount
    ? `Target approximately ${config.targetWordCount} words.`
    : ''

  const hasOriginal = originalCards.length > 0
  const hasReference = referenceCards.length > 0

  // Author's framing instructions
  const authorInstructions = chapter.draftInstructions
    ? `
===== AUTHOR'S INSTRUCTIONS =====
The author has provided specific instructions for this chapter:

"${chapter.draftInstructions}"

Follow these instructions carefully when writing the draft.
===== END AUTHOR'S INSTRUCTIONS =====

`
    : ''

  // Build appropriate prompt based on what content we have
  let prompt = `You are helping an author write a chapter for their book. The chapter is titled "${chapter.title}".

${authorInstructions}`

  if (hasOriginal) {
    prompt += `Below are passages the author has collected for this chapter. Your task is to weave these passages into a coherent first draft.

${voiceNote}

Guidelines:
- ${transitionNote}
- Maintain the chronological or thematic order of passages
- You may lightly edit for flow, but preserve key phrases and the author's voice
- Do not add significant new content not present in the passages
- If passages have author's notes, use them to understand the intended meaning
- ${lengthNote}

===== AUTHOR'S COLLECTED PASSAGES =====

${passages}

===== END AUTHOR'S PASSAGES =====
`
  }

  if (hasReference) {
    prompt += referenceSection
  }

  if (!hasOriginal && hasReference) {
    // Only reference material - write a summary/synthesis
    prompt += `
The author has collected reference material on this topic. Write an original draft that synthesizes these ideas in a fresh voice. Do not copy phrasing from the references.
`
  }

  prompt += `
Now write the first draft of "${chapter.title}". Begin directly with the content (no preamble):
`

  return prompt
}

/**
 * Generate a first draft from cards (streaming)
 */
export async function generateDraft(
  chapter: Chapter,
  cards: HarvestCard[],
  config: Partial<DraftGeneratorConfig> = {},
  onProgress?: (progress: GenerationProgress) => void
): Promise<string> {
  const cfg = { ...getDefaultConfig(), ...config }

  if (cards.length === 0) {
    throw new Error('No cards provided for draft generation')
  }

  onProgress?.({ phase: 'preparing' })

  // Deduplicate cards first
  onProgress?.({ phase: 'deduplicating' })
  const { unique: dedupedCards, stats: dedupeStats } = deduplicateCards(cards)

  if (dedupedCards.length === 0) {
    throw new Error('No unique cards after deduplication')
  }

  // Order cards chronologically
  const orderedCards = orderCardsForDraft(dedupedCards, 'chronological')

  // Build prompt
  const prompt = buildPrompt(chapter, orderedCards, cfg)

  // Report deduplication results
  if (dedupeStats.removed > 0) {
    console.log(`Deduplication: ${dedupeStats.original} → ${dedupeStats.unique} cards (removed ${dedupeStats.removed} duplicates)`)
  }

  onProgress?.({ phase: 'generating', tokensGenerated: 0, partialContent: '' })

  try {
    const response = await fetch(`${getOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        stream: true,
        options: {
          temperature: cfg.temperature,
          num_predict: 4096, // Max tokens to generate
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let fullContent = ''
    let tokensGenerated = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(Boolean)

      for (const line of lines) {
        try {
          const json = JSON.parse(line)
          if (json.response) {
            fullContent += json.response
            tokensGenerated++

            // Report progress every 10 tokens
            if (tokensGenerated % 10 === 0) {
              onProgress?.({
                phase: 'generating',
                tokensGenerated,
                partialContent: fullContent,
              })
            }
          }
          if (json.done) {
            break
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    onProgress?.({ phase: 'complete', tokensGenerated, partialContent: fullContent })
    return fullContent.trim()
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    onProgress?.({ phase: 'error', error: errorMsg })
    throw error
  }
}

/**
 * Generate draft without streaming (simpler, for testing)
 */
export async function generateDraftSimple(
  chapter: Chapter,
  cards: HarvestCard[],
  config: Partial<DraftGeneratorConfig> = {}
): Promise<string> {
  const cfg = { ...getDefaultConfig(), ...config }

  if (cards.length === 0) {
    throw new Error('No cards provided for draft generation')
  }

  const orderedCards = orderCardsForDraft(cards, 'chronological')
  const prompt = buildPrompt(chapter, orderedCards, cfg)

  const response = await fetch(`${getOllamaUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: false,
      options: {
        temperature: cfg.temperature,
        num_predict: 4096,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.response?.trim() || ''
}

/**
 * Expand a section of text using LLM
 */
export async function expandSection(
  text: string,
  context: string,
  config: Partial<DraftGeneratorConfig> = {}
): Promise<string> {
  const cfg = { ...getDefaultConfig(), ...config }

  const prompt = `You are helping an author expand a section of their writing. Here is the context:

${context}

The author wants to expand this passage:
"${text}"

Expand this passage while maintaining the author's voice and style. Add relevant details, descriptions, or reflections that fit the context. Keep the original meaning intact.

Expanded version:`

  const response = await fetch(`${getOllamaUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: false,
      options: {
        temperature: cfg.temperature,
        num_predict: 1024,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`)
  }

  const data = await response.json()
  return data.response?.trim() || text
}

// ============================================================================
// Outline-Based Draft Generation
// ============================================================================

/**
 * Build prompt for a single section from the outline
 */
function buildSectionPrompt(
  sectionTitle: string,
  cards: HarvestCard[],
  keyPassageIds: string[],
  sectionIndex: number,
  totalSections: number,
  config: DraftGeneratorConfig
): string {
  const keyPassageSet = new Set(keyPassageIds)

  // Format cards with key passage marking
  const formatCard = (card: HarvestCard, idx: number) => {
    const isKey = keyPassageSet.has(card.id)
    const keyMarker = isKey ? ' [KEY PASSAGE - preserve verbatim if possible]' : ''
    const date = card.createdAt
      ? new Date(typeof card.createdAt === 'number' ? card.createdAt * 1000 : card.createdAt)
          .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : 'undated'
    const notes = card.userNotes ? `\n   Author's note: "${card.userNotes}"` : ''
    return `[${idx}]${keyMarker} (${date}):\n"${card.content}"${notes}`
  }

  const passages = cards.map((card, idx) => formatCard(card, idx + 1)).join('\n\n')

  const voiceNote = config.preserveVoice
    ? `Preserve the author's original voice and writing style.`
    : ''

  const positionNote = sectionIndex === 0
    ? 'This is the opening section - establish the topic engagingly.'
    : sectionIndex === totalSections - 1
    ? 'This is the closing section - provide satisfying closure.'
    : 'This is a middle section - maintain momentum and connect to surrounding sections.'

  return `Write the "${sectionTitle}" section of a chapter.

${positionNote}
${voiceNote}

Guidelines:
- Weave the passages into coherent prose
- Preserve key passages as much as possible (marked [KEY PASSAGE])
- Add smooth transitions between ideas
- Do not add significant new content not in the passages

===== PASSAGES FOR THIS SECTION =====

${passages}

===== END PASSAGES =====

Write this section now. Start directly with the content:`
}

/**
 * Build a complete outline-structured prompt
 */
function buildOutlinePrompt(
  chapter: Chapter,
  sections: OrderedSection[],
  config: DraftGeneratorConfig
): string {
  const voiceNote = config.preserveVoice
    ? `IMPORTANT: Preserve the author's original voice and writing style throughout.`
    : ''

  const lengthNote = config.targetWordCount
    ? `Target approximately ${config.targetWordCount} words total.`
    : ''

  // Build outline overview
  const outlineOverview = sections.map((s, i) =>
    `${i + 1}. ${s.title} (${s.cards.length} sources${s.keyPassageIds.length > 0 ? `, ${s.keyPassageIds.length} key` : ''})`
  ).join('\n')

  // Format each section's content
  const keyPassageSets = sections.map(s => new Set(s.keyPassageIds))

  const sectionsContent = sections.map((section, sectionIdx) => {
    const keySet = keyPassageSets[sectionIdx]

    const passagesList = section.cards.map((card, cardIdx) => {
      const isKey = keySet.has(card.id)
      const keyMarker = isKey ? ' [KEY - preserve]' : ''
      const preview = card.content.length > 150
        ? card.content.slice(0, 150) + '...'
        : card.content
      return `  ${cardIdx + 1}.${keyMarker} "${preview}"`
    }).join('\n')

    return `
## Section ${sectionIdx + 1}: ${section.title}

${passagesList}
`
  }).join('\n')

  // Author's framing instructions
  const authorInstructions = chapter.draftInstructions
    ? `
===== AUTHOR'S INSTRUCTIONS =====
${chapter.draftInstructions}
===== END INSTRUCTIONS =====
`
    : ''

  return `You are helping an author write a chapter titled "${chapter.title}".

The chapter follows this outline:
${outlineOverview}

${voiceNote}
${lengthNote}
${authorInstructions}

For each section, weave the provided passages into coherent prose. Passages marked [KEY - preserve] should be kept as close to verbatim as possible.

===== CHAPTER CONTENT BY SECTION =====
${sectionsContent}
===== END CHAPTER CONTENT =====

Now write the complete chapter following the outline structure. Use "## Section Title" headings for each section. Begin:`
}

export interface OutlineDraftConfig extends DraftGeneratorConfig {
  generateBySection?: boolean // Generate each section separately
}

export interface OutlineDraftProgress extends GenerationProgress {
  currentSection?: number
  totalSections?: number
  sectionTitle?: string
}

/**
 * Generate a draft following an outline structure
 */
export async function generateOutlineDraft(
  chapter: Chapter,
  sections: OrderedSection[],
  config: Partial<OutlineDraftConfig> = {},
  onProgress?: (progress: OutlineDraftProgress) => void
): Promise<string> {
  const cfg = { ...getDefaultConfig(), ...config }

  if (sections.length === 0) {
    throw new Error('No sections provided for draft generation')
  }

  // Flatten all cards for deduplication
  const allCards = sections.flatMap(s => s.cards)

  onProgress?.({ phase: 'preparing' })

  // Deduplicate within sections
  onProgress?.({ phase: 'deduplicating' })
  const deduped = deduplicateCards(allCards)

  // Rebuild sections with deduplicated cards (preserving order)
  const dedupedCardIds = new Set(deduped.unique.map(c => c.id))
  const cleanSections = sections.map(section => ({
    ...section,
    cards: section.cards.filter(c => dedupedCardIds.has(c.id)),
  })).filter(s => s.cards.length > 0)

  if (cleanSections.length === 0) {
    throw new Error('No sections with content after deduplication')
  }

  if (deduped.stats.removed > 0) {
    console.log(`Deduplication: removed ${deduped.stats.removed} duplicate cards`)
  }

  // Generate section-by-section or all at once
  if (cfg.generateBySection) {
    return generateSectionBySection(chapter, cleanSections, cfg, onProgress)
  } else {
    return generateFullOutlineDraft(chapter, cleanSections, cfg, onProgress)
  }
}

/**
 * Generate draft all at once with outline structure
 */
async function generateFullOutlineDraft(
  chapter: Chapter,
  sections: OrderedSection[],
  cfg: OutlineDraftConfig,
  onProgress?: (progress: OutlineDraftProgress) => void
): Promise<string> {
  const prompt = buildOutlinePrompt(chapter, sections, cfg)

  onProgress?.({
    phase: 'generating',
    tokensGenerated: 0,
    totalSections: sections.length,
  })

  const response = await fetch(`${getOllamaUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: true,
      options: {
        temperature: cfg.temperature,
        num_predict: 8192, // Larger for full chapter
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let fullContent = ''
  let tokensGenerated = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(Boolean)

    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        if (json.response) {
          fullContent += json.response
          tokensGenerated++

          if (tokensGenerated % 20 === 0) {
            onProgress?.({
              phase: 'generating',
              tokensGenerated,
              partialContent: fullContent,
              totalSections: sections.length,
            })
          }
        }
        if (json.done) break
      } catch {
        // Skip malformed JSON
      }
    }
  }

  onProgress?.({ phase: 'complete', tokensGenerated, partialContent: fullContent })
  return fullContent.trim()
}

/**
 * Generate draft section by section
 */
async function generateSectionBySection(
  _chapter: Chapter, // Reserved for chapter-level context in future
  sections: OrderedSection[],
  cfg: OutlineDraftConfig,
  onProgress?: (progress: OutlineDraftProgress) => void
): Promise<string> {
  const sectionDrafts: string[] = []

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]

    onProgress?.({
      phase: 'generating',
      currentSection: i + 1,
      totalSections: sections.length,
      sectionTitle: section.title,
    })

    const prompt = buildSectionPrompt(
      section.title,
      section.cards,
      section.keyPassageIds,
      i,
      sections.length,
      cfg
    )

    const response = await fetch(`${getOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        prompt,
        stream: false,
        options: {
          temperature: cfg.temperature,
          num_predict: 2048,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama error for section ${i + 1}: ${response.status}`)
    }

    const data = await response.json()
    const sectionContent = data.response?.trim() || ''

    sectionDrafts.push(`## ${section.title}\n\n${sectionContent}`)

    // Small delay between sections
    if (i < sections.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  const fullDraft = sectionDrafts.join('\n\n')

  onProgress?.({ phase: 'complete', partialContent: fullDraft })
  return fullDraft
}

/**
 * High-level function: Research → Generate Outline → Generate Draft
 */
export async function generateDraftWithOutline(
  chapter: Chapter,
  cards: HarvestCard[],
  proposedOutline?: OutlineStructure,
  config: Partial<OutlineDraftConfig> = {},
  onProgress?: (progress: OutlineDraftProgress) => void
): Promise<{ draft: string; outline: GeneratedOutline; research: OutlineResearch }> {
  // Import dynamically to avoid circular dependency
  const { researchHarvest, generateOutline, orderCardsForOutline } = await import('./outline-agent')

  onProgress?.({ phase: 'preparing' })

  // Research the harvest
  const research = await researchHarvest(cards)

  // Generate outline (merging with proposed if provided)
  const outline = generateOutline(cards, research, proposedOutline, {
    keepProposedItems: true,
    preferArcStructure: true,
  })

  // Order cards by outline
  const sections = orderCardsForOutline(outline, cards, research)

  // Generate draft
  const draft = await generateOutlineDraft(chapter, sections, config, onProgress)

  return { draft, outline, research }
}
