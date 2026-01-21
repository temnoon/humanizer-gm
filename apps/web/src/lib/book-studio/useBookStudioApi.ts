/**
 * Book Studio API Hook
 *
 * React hook that provides API-backed state management for Book Studio.
 * Handles loading, saving, and real-time updates via WebSocket.
 *
 * Usage:
 *   const { books, activeBook, isLoading, error, actions } = useBookStudioApi()
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Book, Chapter, HarvestCard } from './types'
import {
  apiClient,
  wsManager,
  loadLibraryFromApi,
  loadBookWithDetails,
  type BookEvent,
} from './api-client'

// ============================================================================
// Types
// ============================================================================

export interface BookStudioApiState {
  books: Book[]
  activeBookId: string | null
  activeBook: Book | null
  isLoading: boolean
  isConnected: boolean
  error: string | null
}

export interface BookStudioApiActions {
  // Book operations
  selectBook: (bookId: string) => Promise<void>
  createBook: (title: string, description?: string) => Promise<Book>
  updateBook: (bookId: string, updates: Partial<Book>) => Promise<void>
  deleteBook: (bookId: string) => Promise<void>
  refreshBooks: () => Promise<void>

  // Chapter operations
  createChapter: (title: string) => Promise<Chapter | null>
  createChaptersBatch: (titles: string[]) => Promise<Chapter[]>
  updateChapter: (chapterId: string, updates: Partial<Chapter>) => Promise<void>
  deleteChapter: (chapterId: string) => Promise<void>
  reorderChapters: (chapterIds: string[]) => Promise<void>

  // Card operations
  harvestCard: (card: HarvestCard) => Promise<HarvestCard | null>
  harvestCardsBatch: (cards: HarvestCard[]) => Promise<HarvestCard[]>
  updateCard: (cardId: string, updates: Partial<HarvestCard>) => Promise<void>
  moveCardToChapter: (cardId: string, chapterId: string) => Promise<void>
  deleteCard: (cardId: string) => Promise<void>
  batchUpdateCards: (
    cardIds: string[],
    updates: Partial<Pick<HarvestCard, 'suggestedChapterId' | 'status' | 'grade' | 'tags'>>
  ) => Promise<{ updatedCount: number; cards: HarvestCard[] }>
}

export interface UseBookStudioApiResult extends BookStudioApiState {
  actions: BookStudioApiActions
}

// ============================================================================
// Hook
// ============================================================================

export function useBookStudioApi(): UseBookStudioApiResult {
  // State
  const [books, setBooks] = useState<Book[]>([])
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [activeBook, setActiveBook] = useState<Book | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ref to track current book ID for WebSocket events
  const activeBookIdRef = useRef(activeBookId)
  activeBookIdRef.current = activeBookId

  // --------------------------------------------------------------------------
  // Initial Load
  // --------------------------------------------------------------------------

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        // Check if API is available
        const healthy = await apiClient.checkHealth()
        if (!healthy) {
          throw new Error('Book Studio API not available')
        }

        // Load books list
        const { books: loadedBooks, activeBookId: savedActiveId } = await loadLibraryFromApi()

        if (!mounted) return

        setBooks(loadedBooks)
        setIsConnected(true)

        // Load active book details if we have one
        if (savedActiveId) {
          const book = await loadBookWithDetails(savedActiveId)
          if (mounted && book) {
            setActiveBookId(savedActiveId)
            setActiveBook(book)
          }
        }

        setIsLoading(false)
      } catch (err) {
        if (!mounted) return
        console.error('[useBookStudioApi] Init failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to connect to API')
        setIsLoading(false)
        setIsConnected(false)
      }
    }

    init()
    return () => { mounted = false }
  }, [])

  // --------------------------------------------------------------------------
  // WebSocket Connection
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!isConnected) return

    wsManager.connect()

    // Subscribe to active book events
    if (activeBookId) {
      wsManager.subscribe(activeBookId)
    }

    // Handle incoming events
    const unsubscribe = wsManager.onEvent((event: BookEvent) => {
      // Only process events for the active book
      if (event.bookId !== activeBookIdRef.current) return

      console.log('[useBookStudioApi] Event:', event.type, event.entityType, event.entityId)

      // Refresh book data on relevant events
      if (['card-harvested', 'card-updated', 'card-deleted', 'card-moved',
           'chapter-created', 'chapter-updated', 'chapter-deleted',
           'book-updated'].includes(event.type)) {
        // Reload the active book
        loadBookWithDetails(event.bookId).then(book => {
          if (book) {
            setActiveBook(book)
          }
        })
      }
    })

    return () => {
      unsubscribe()
      if (activeBookId) {
        wsManager.unsubscribe(activeBookId)
      }
    }
  }, [isConnected, activeBookId])

  // --------------------------------------------------------------------------
  // Book Actions
  // --------------------------------------------------------------------------

  const selectBook = useCallback(async (bookId: string) => {
    try {
      // Unsubscribe from old book
      if (activeBookId) {
        wsManager.unsubscribe(activeBookId)
      }

      // Load new book details
      const book = await loadBookWithDetails(bookId)
      if (book) {
        setActiveBookId(bookId)
        setActiveBook(book)
        localStorage.setItem('book-studio-active-book-id', bookId)

        // Subscribe to new book
        wsManager.subscribe(bookId)
      }
    } catch (err) {
      console.error('[useBookStudioApi] Select book failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load book')
    }
  }, [activeBookId])

  const createBook = useCallback(async (title: string, description?: string): Promise<Book> => {
    const book = await apiClient.createBook(title, description)
    setBooks(prev => [...prev, book])
    return book
  }, [])

  const updateBook = useCallback(async (bookId: string, updates: Partial<Book>) => {
    await apiClient.updateBook(bookId, updates)
    setBooks(prev => prev.map(b =>
      b.id === bookId ? { ...b, ...updates } : b
    ))
    if (activeBook?.id === bookId) {
      setActiveBook(prev => prev ? { ...prev, ...updates } : null)
    }
  }, [activeBook])

  const deleteBook = useCallback(async (bookId: string) => {
    await apiClient.deleteBook(bookId)
    setBooks(prev => prev.filter(b => b.id !== bookId))

    if (activeBookId === bookId) {
      setActiveBookId(null)
      setActiveBook(null)
      localStorage.removeItem('book-studio-active-book-id')
    }
  }, [activeBookId])

  const refreshBooks = useCallback(async () => {
    const { books: loadedBooks } = await loadLibraryFromApi()
    setBooks(loadedBooks)

    if (activeBookId) {
      const book = await loadBookWithDetails(activeBookId)
      if (book) {
        setActiveBook(book)
      }
    }
  }, [activeBookId])

  // --------------------------------------------------------------------------
  // Chapter Actions
  // --------------------------------------------------------------------------

  const createChapter = useCallback(async (title: string): Promise<Chapter | null> => {
    if (!activeBookId) return null

    const chapter = await apiClient.createChapter(activeBookId, title)

    // Update local state
    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        chapters: [...prev.chapters, chapter],
      }
    })

    return chapter
  }, [activeBookId])

  const createChaptersBatch = useCallback(async (titles: string[]): Promise<Chapter[]> => {
    if (!activeBookId) return []

    const chapters = await apiClient.createChaptersBatch(activeBookId, titles)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        chapters: [...prev.chapters, ...chapters],
      }
    })

    return chapters
  }, [activeBookId])

  const updateChapter = useCallback(async (chapterId: string, updates: Partial<Chapter>) => {
    await apiClient.updateChapter(chapterId, updates)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        chapters: prev.chapters.map(ch =>
          ch.id === chapterId ? { ...ch, ...updates } : ch
        ),
      }
    })
  }, [])

  const deleteChapter = useCallback(async (chapterId: string) => {
    await apiClient.deleteChapter(chapterId)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        chapters: prev.chapters.filter(ch => ch.id !== chapterId),
      }
    })
  }, [])

  const reorderChapters = useCallback(async (chapterIds: string[]) => {
    if (!activeBookId) return

    await apiClient.reorderChapters(activeBookId, chapterIds)

    setActiveBook(prev => {
      if (!prev) return null
      const reordered = chapterIds.map((id, idx) => {
        const ch = prev.chapters.find(c => c.id === id)
        return ch ? { ...ch, order: idx + 1 } : null
      }).filter(Boolean) as Chapter[]

      return {
        ...prev,
        chapters: reordered,
      }
    })
  }, [activeBookId])

  // --------------------------------------------------------------------------
  // Card Actions
  // --------------------------------------------------------------------------

  const harvestCard = useCallback(async (card: HarvestCard): Promise<HarvestCard | null> => {
    if (!activeBookId) return null

    const savedCard = await apiClient.harvestCard(activeBookId, card)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        stagingCards: [savedCard, ...prev.stagingCards],
      }
    })

    return savedCard
  }, [activeBookId])

  const harvestCardsBatch = useCallback(async (cards: HarvestCard[]): Promise<HarvestCard[]> => {
    if (!activeBookId) return []

    const savedCards = await apiClient.harvestCardsBatch(activeBookId, cards)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        stagingCards: [...savedCards, ...prev.stagingCards],
      }
    })

    return savedCards
  }, [activeBookId])

  const updateCard = useCallback(async (cardId: string, updates: Partial<HarvestCard>) => {
    await apiClient.updateCard(cardId, updates)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        stagingCards: prev.stagingCards.map(card =>
          card.id === cardId ? { ...card, ...updates } : card
        ),
      }
    })
  }, [])

  const moveCardToChapter = useCallback(async (cardId: string, chapterId: string) => {
    await apiClient.moveCardToChapter(cardId, chapterId)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        stagingCards: prev.stagingCards.map(card =>
          card.id === cardId
            ? { ...card, suggestedChapterId: chapterId, status: 'placed' as const }
            : card
        ),
        chapters: prev.chapters.map(ch =>
          ch.id === chapterId
            ? { ...ch, cards: [...ch.cards, cardId] }
            : ch
        ),
      }
    })
  }, [])

  const deleteCard = useCallback(async (cardId: string) => {
    await apiClient.deleteCard(cardId)

    setActiveBook(prev => {
      if (!prev) return null
      return {
        ...prev,
        stagingCards: prev.stagingCards.filter(card => card.id !== cardId),
        chapters: prev.chapters.map(ch => ({
          ...ch,
          cards: ch.cards.filter(id => id !== cardId),
        })),
      }
    })
  }, [])

  const batchUpdateCards = useCallback(async (
    cardIds: string[],
    updates: Partial<Pick<HarvestCard, 'suggestedChapterId' | 'status' | 'grade' | 'tags'>>
  ) => {
    const result = await apiClient.batchUpdateCards(cardIds, updates)

    // Update local state
    setActiveBook(prev => {
      if (!prev) return null
      const updatedCardMap = new Map(result.cards.map(c => [c.id, c]))

      return {
        ...prev,
        stagingCards: prev.stagingCards.map(card =>
          updatedCardMap.has(card.id) ? updatedCardMap.get(card.id)! : card
        ),
      }
    })

    return result
  }, [])

  // --------------------------------------------------------------------------
  // Return
  // --------------------------------------------------------------------------

  return {
    books,
    activeBookId,
    activeBook,
    isLoading,
    isConnected,
    error,
    actions: {
      selectBook,
      createBook,
      updateBook,
      deleteBook,
      refreshBooks,
      createChapter,
      createChaptersBatch,
      updateChapter,
      deleteChapter,
      reorderChapters,
      harvestCard,
      harvestCardsBatch,
      updateCard,
      moveCardToChapter,
      deleteCard,
      batchUpdateCards,
    },
  }
}
