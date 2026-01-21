/**
 * Book Studio Provider
 *
 * Centralized React context for Book Studio with:
 * - State management from useBookStudioApi
 * - Agent operations (harvest, outline, draft)
 * - Real-time WebSocket updates
 *
 * Usage:
 *   <BookStudioProvider>
 *     <BooksView />
 *   </BookStudioProvider>
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

import { useBookStudioApi, type UseBookStudioApiResult } from './useBookStudioApi'
import {
  runHarvest as runHarvestApi,
  convertToHarvestCard,
  type HarvestProgress,
  type HarvestConfig,
  type HarvestResult,
  type ExpandedResult,
} from './harvest-api'
import {
  researchHarvest,
  reviewOutline,
  generateOutline,
  orderCardsForOutline,
  researchHarvestViaApi,
  generateOutlineViaApi,
  type OutlineResearch,
  type OutlineReview,
  type GeneratedOutline,
  type OutlineGenerationConfig,
  type OrderedSection,
} from './outline-agent'
import type { HarvestCard, OutlineStructure, Chapter } from './types'
import { findDuplicateCard } from './types'

// ============================================================================
// Types
// ============================================================================

export interface HarvestAgentState {
  isRunning: boolean
  progress: HarvestProgress | null
  results: ExpandedResult[]
  error: string | null
}

export interface OutlineAgentState {
  research: OutlineResearch | null
  review: OutlineReview | null
  generatedOutline: GeneratedOutline | null
  isResearching: boolean
  isGenerating: boolean
  error: string | null
}

export interface DraftAgentState {
  isGenerating: boolean
  progress: DraftProgress | null
  currentChapterId: string | null
  error: string | null
}

export interface DraftProgress {
  phase: 'preparing' | 'generating' | 'refining' | 'complete'
  chapterId: string
  chapterTitle: string
  sectionsTotal: number
  sectionsComplete: number
  wordsGenerated: number
  message: string
}

export interface DraftGenerationConfig {
  model?: string
  temperature?: number
  targetWordCount?: number
  preserveVoice?: boolean
  includeTransitions?: boolean
}

export interface BookStudioContextValue extends UseBookStudioApiResult {
  // Harvest agent
  harvest: {
    state: HarvestAgentState
    run: (query: string, config?: Partial<HarvestConfig>) => Promise<HarvestResult>
    clear: () => void
    commitResults: () => Promise<void>
  }

  // Outline agent
  outline: {
    state: OutlineAgentState
    research: () => Promise<OutlineResearch>
    review: (outline: OutlineStructure) => OutlineReview
    generate: (config?: OutlineGenerationConfig) => Promise<GeneratedOutline>
    orderCards: (outline: OutlineStructure | GeneratedOutline) => OrderedSection[]
    clear: () => void
  }

  // Draft agent
  draft: {
    state: DraftAgentState
    generate: (chapter: Chapter, config?: DraftGenerationConfig) => Promise<string>
    cancel: () => void
  }

  // Outline suggestion banner (shown after harvest when no chapters exist)
  outlineSuggestion: {
    show: boolean
    dismiss: () => void
    onGenerate: () => Promise<void>
  }
}

// ============================================================================
// Context
// ============================================================================

const BookStudioContext = createContext<BookStudioContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

interface BookStudioProviderProps {
  children: ReactNode
}

export function BookStudioProvider({ children }: BookStudioProviderProps) {
  // Core API state and actions
  const api = useBookStudioApi()

  // Harvest agent state
  const [harvestState, setHarvestState] = useState<HarvestAgentState>({
    isRunning: false,
    progress: null,
    results: [],
    error: null,
  })

  // Outline agent state
  const [outlineState, setOutlineState] = useState<OutlineAgentState>({
    research: null,
    review: null,
    generatedOutline: null,
    isResearching: false,
    isGenerating: false,
    error: null,
  })

  // Draft agent state
  const [draftState, setDraftState] = useState<DraftAgentState>({
    isGenerating: false,
    progress: null,
    currentChapterId: null,
    error: null,
  })

  // Abort controller for cancellable operations
  const [draftAbortController, setDraftAbortController] = useState<AbortController | null>(null)

  // Outline suggestion state (shown after harvest when no chapters exist)
  const [showOutlineSuggestion, setShowOutlineSuggestion] = useState(false)

  // --------------------------------------------------------------------------
  // Harvest Agent Operations
  // --------------------------------------------------------------------------

  const runHarvest = useCallback(
    async (query: string, config?: Partial<HarvestConfig>): Promise<HarvestResult> => {
      if (!api.activeBookId) {
        throw new Error('No active book selected')
      }

      setHarvestState(prev => ({
        ...prev,
        isRunning: true,
        error: null,
        results: [],
        progress: null,
      }))

      try {
        // Use backend harvest API instead of local smart-harvest-agent
        const result = await runHarvestApi(
          query,
          (progress) => {
            setHarvestState(prev => ({ ...prev, progress }))
          },
          config
        )

        // Auto-commit results immediately to staging
        if (result.results.length > 0) {
          const cards = result.results.map(convertToHarvestCard)
          await api.actions.harvestCardsBatch(cards)
          console.log(`[harvest] Auto-committed ${cards.length} cards to staging`)

          // Check if we should show outline suggestion
          // Show if: we have cards, no chapters exist, and enough cards harvested
          const hasChapters = (api.activeBook?.chapters.length ?? 0) > 0
          const totalCards = (api.activeBook?.stagingCards.length ?? 0) + cards.length
          const MIN_CARDS_FOR_SUGGESTION = 5

          if (!hasChapters && totalCards >= MIN_CARDS_FOR_SUGGESTION) {
            setShowOutlineSuggestion(true)
            console.log(`[harvest] Triggering outline suggestion (${totalCards} cards, no chapters)`)
          }
        }

        setHarvestState(prev => ({
          ...prev,
          isRunning: false,
          results: result.results,
          progress: prev.progress ? { ...prev.progress, phase: 'complete' as const } : null,
        }))

        return result
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Harvest failed'
        setHarvestState(prev => ({
          ...prev,
          isRunning: false,
          error,
        }))
        throw err
      }
    },
    [api.activeBookId]
  )

  const clearHarvest = useCallback(() => {
    setHarvestState({
      isRunning: false,
      progress: null,
      results: [],
      error: null,
    })
  }, [])

  const commitHarvestResults = useCallback(async () => {
    if (!api.activeBookId || harvestState.results.length === 0) {
      return
    }

    const cards = harvestState.results.map(convertToHarvestCard)

    // Cross-harvest deduplication: filter out cards that already exist in the book
    const existingCards = api.activeBook?.stagingCards || []
    const uniqueCards = cards.filter(card => {
      const duplicate = findDuplicateCard(card.content, existingCards, 0.85)
      if (duplicate) {
        console.log(`[harvest] Skipping duplicate card (matches existing card ${duplicate.id})`)
        return false
      }
      return true
    })

    if (uniqueCards.length === 0) {
      console.log('[harvest] All cards were duplicates, nothing to commit')
    } else if (uniqueCards.length < cards.length) {
      console.log(`[harvest] Filtered ${cards.length - uniqueCards.length} duplicates, committing ${uniqueCards.length} unique cards`)
    }

    if (uniqueCards.length > 0) {
      await api.actions.harvestCardsBatch(uniqueCards)
    }

    // Clear results after committing
    setHarvestState(prev => ({
      ...prev,
      results: [],
    }))
  }, [api.activeBookId, api.activeBook?.stagingCards, api.actions, harvestState.results])

  // --------------------------------------------------------------------------
  // Outline Agent Operations
  // --------------------------------------------------------------------------

  const runOutlineResearch = useCallback(async (): Promise<OutlineResearch> => {
    if (!api.activeBook || !api.activeBookId) {
      throw new Error('No active book')
    }

    setOutlineState(prev => ({
      ...prev,
      isResearching: true,
      error: null,
    }))

    try {
      // Use server-side API for research (preferred)
      let research: OutlineResearch
      try {
        research = await researchHarvestViaApi(api.activeBookId)
        console.log('[outline] Research completed via API')
      } catch (apiError) {
        // Fallback to local research if API fails
        console.warn('[outline] API research failed, falling back to local:', apiError)
        const cards = api.activeBook.stagingCards
        research = await researchHarvest(cards)
      }

      setOutlineState(prev => ({
        ...prev,
        isResearching: false,
        research,
      }))

      return research
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Research failed'
      setOutlineState(prev => ({
        ...prev,
        isResearching: false,
        error,
      }))
      throw err
    }
  }, [api.activeBook, api.activeBookId])

  const runOutlineReview = useCallback(
    (outline: OutlineStructure): OutlineReview => {
      if (!api.activeBook || !outlineState.research) {
        throw new Error('No active book or research data')
      }

      const review = reviewOutline(outline, api.activeBook.stagingCards, outlineState.research)

      setOutlineState(prev => ({
        ...prev,
        review,
      }))

      return review
    },
    [api.activeBook, outlineState.research]
  )

  const runOutlineGeneration = useCallback(
    async (config?: OutlineGenerationConfig): Promise<GeneratedOutline> => {
      if (!api.activeBook || !api.activeBookId) {
        throw new Error('No active book')
      }

      setOutlineState(prev => ({
        ...prev,
        isGenerating: true,
        error: null,
      }))

      try {
        // Use server-side API for generation (preferred)
        let generated: GeneratedOutline
        try {
          generated = await generateOutlineViaApi(api.activeBookId, config)
          console.log('[outline] Outline generated via API')
        } catch (apiError) {
          // Fallback to local generation if API fails
          console.warn('[outline] API generation failed, falling back to local:', apiError)

          // Ensure we have research for local fallback
          let research = outlineState.research
          if (!research) {
            research = await researchHarvest(api.activeBook.stagingCards)
            setOutlineState(prev => ({ ...prev, research }))
          }

          generated = generateOutline(
            api.activeBook.stagingCards,
            research,
            undefined, // No proposed outline
            config
          )
        }

        setOutlineState(prev => ({
          ...prev,
          isGenerating: false,
          generatedOutline: generated,
        }))

        return generated
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Generation failed'
        setOutlineState(prev => ({
          ...prev,
          isGenerating: false,
          error,
        }))
        throw err
      }
    },
    [api.activeBook, api.activeBookId, outlineState.research]
  )

  const orderOutlineCards = useCallback(
    (outline: OutlineStructure | GeneratedOutline): OrderedSection[] => {
      if (!api.activeBook || !outlineState.research) {
        throw new Error('No active book or research data')
      }

      return orderCardsForOutline(outline, api.activeBook.stagingCards, outlineState.research)
    },
    [api.activeBook, outlineState.research]
  )

  const clearOutline = useCallback(() => {
    setOutlineState({
      research: null,
      review: null,
      generatedOutline: null,
      isResearching: false,
      isGenerating: false,
      error: null,
    })
  }, [])

  // --------------------------------------------------------------------------
  // Draft Agent Operations
  // --------------------------------------------------------------------------

  const generateDraft = useCallback(
    async (chapter: Chapter, config?: DraftGenerationConfig): Promise<string> => {
      if (!api.activeBook) {
        throw new Error('No active book')
      }

      const controller = new AbortController()
      setDraftAbortController(controller)

      setDraftState({
        isGenerating: true,
        progress: {
          phase: 'preparing',
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          sectionsTotal: 0,
          sectionsComplete: 0,
          wordsGenerated: 0,
          message: 'Preparing draft generation...',
        },
        currentChapterId: chapter.id,
        error: null,
      })

      try {
        // Get cards for this chapter
        const chapterCards = api.activeBook.stagingCards.filter(
          card => card.suggestedChapterId === chapter.id || chapter.cards.includes(card.id)
        )

        if (chapterCards.length === 0) {
          throw new Error('No cards assigned to this chapter')
        }

        // Check for Electron API (ollama may not be in type definition yet)
        const electronAPI = window.electronAPI as { ollama?: { generate: (params: { model: string; prompt: string; options: { temperature: number } }) => Promise<{ response: string }> } } | undefined
        if (!electronAPI?.ollama?.generate) {
          throw new Error('Draft generation requires Ollama (Electron)')
        }

        setDraftState(prev => ({
          ...prev,
          progress: prev.progress
            ? {
                ...prev.progress,
                phase: 'generating',
                sectionsTotal: chapterCards.length,
                message: 'Generating draft content...',
              }
            : null,
        }))

        // Build prompt from cards
        const cardContents = chapterCards
          .map((card, i) => `[Source ${i + 1}]\n${card.content}`)
          .join('\n\n---\n\n')

        const prompt = `You are helping write a chapter titled "${chapter.title}".

Using the following source materials, write a cohesive draft for this chapter.
${chapter.draftInstructions ? `\nAdditional instructions: ${chapter.draftInstructions}` : ''}

Source materials:

${cardContents}

Write a draft chapter that:
1. Synthesizes the key ideas from the sources
2. Maintains a consistent voice
3. Creates smooth transitions between ideas
4. Targets approximately ${config?.targetWordCount || 1500} words

Begin the draft:`

        // Generate via Ollama
        const result = await electronAPI.ollama!.generate({
          model: config?.model || 'llama3.2',
          prompt,
          options: {
            temperature: config?.temperature || 0.7,
          },
        })

        if (controller.signal.aborted) {
          throw new Error('Generation cancelled')
        }

        const draftContent = result.response || ''
        const wordCount = draftContent.split(/\s+/).filter(Boolean).length

        setDraftState(prev => ({
          ...prev,
          isGenerating: false,
          progress: prev.progress
            ? {
                ...prev.progress,
                phase: 'complete',
                sectionsComplete: chapterCards.length,
                wordsGenerated: wordCount,
                message: `Draft complete: ${wordCount} words`,
              }
            : null,
        }))

        // Update chapter content
        await api.actions.updateChapter(chapter.id, {
          content: draftContent,
          wordCount,
        })

        return draftContent
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Draft generation failed'
        setDraftState(prev => ({
          ...prev,
          isGenerating: false,
          error,
        }))
        throw err
      } finally {
        setDraftAbortController(null)
      }
    },
    [api.activeBook, api.actions]
  )

  const cancelDraft = useCallback(() => {
    if (draftAbortController) {
      draftAbortController.abort()
      setDraftState(prev => ({
        ...prev,
        isGenerating: false,
        error: 'Cancelled',
      }))
    }
  }, [draftAbortController])

  // --------------------------------------------------------------------------
  // Outline Suggestion Handlers
  // --------------------------------------------------------------------------

  const dismissOutlineSuggestion = useCallback(() => {
    setShowOutlineSuggestion(false)
  }, [])

  const handleOutlineSuggestionGenerate = useCallback(async () => {
    setShowOutlineSuggestion(false)
    // Trigger outline generation through the outline agent
    if (api.activeBook?.stagingCards.length) {
      await runOutlineResearch()
      await runOutlineGeneration()
    }
  }, [api.activeBook?.stagingCards.length, runOutlineResearch, runOutlineGeneration])

  // --------------------------------------------------------------------------
  // Context Value
  // --------------------------------------------------------------------------

  const value: BookStudioContextValue = {
    // Spread all API state and actions
    ...api,

    // Harvest agent
    harvest: {
      state: harvestState,
      run: runHarvest,
      clear: clearHarvest,
      commitResults: commitHarvestResults,
    },

    // Outline agent
    outline: {
      state: outlineState,
      research: runOutlineResearch,
      review: runOutlineReview,
      generate: runOutlineGeneration,
      orderCards: orderOutlineCards,
      clear: clearOutline,
    },

    // Draft agent
    draft: {
      state: draftState,
      generate: generateDraft,
      cancel: cancelDraft,
    },

    // Outline suggestion banner
    outlineSuggestion: {
      show: showOutlineSuggestion,
      dismiss: dismissOutlineSuggestion,
      onGenerate: handleOutlineSuggestionGenerate,
    },
  }

  return (
    <BookStudioContext.Provider value={value}>
      {children}
    </BookStudioContext.Provider>
  )
}

// ============================================================================
// Hook
// ============================================================================

export function useBookStudio(): BookStudioContextValue {
  const context = useContext(BookStudioContext)
  if (!context) {
    throw new Error('useBookStudio must be used within a BookStudioProvider')
  }
  return context
}

// Optional hook that returns null if not in provider (for gradual migration)
export function useBookStudioOptional(): BookStudioContextValue | null {
  return useContext(BookStudioContext)
}
