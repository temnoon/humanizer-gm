/**
 * Book Studio Persistence Adapter
 *
 * Abstracts storage backend - uses API server when available, falls back to localStorage.
 * This allows gradual migration without breaking existing functionality.
 */

import type { Book, Chapter, HarvestCard } from './types'
import { getConfig } from './config'
import {
  apiClient,
  wsManager,
  loadLibraryFromApi,
  loadBookWithDetails,
  type BookEvent,
} from './api-client'
import {
  loadLibrary as loadFromLocalStorage,
  saveLibrary as saveToLocalStorage,
  setActiveBookId as setActiveIdLocal,
  debouncedSave as debouncedSaveLocal,
} from './persistence'

// ============================================================================
// Backend Detection
// ============================================================================

let apiAvailable: boolean | null = null
let apiCheckPromise: Promise<boolean> | null = null

/**
 * Check if the Book Studio API server is available
 * Caches result for performance
 */
export async function isApiAvailable(): Promise<boolean> {
  // Return cached result if we have one
  if (apiAvailable !== null) {
    return apiAvailable
  }

  // Check if API backend is enabled in config
  if (!getConfig().api.useApiBackend) {
    apiAvailable = false
    return false
  }

  // If already checking, wait for that result
  if (apiCheckPromise) {
    return apiCheckPromise
  }

  // Check API health
  apiCheckPromise = (async () => {
    try {
      const healthy = await apiClient.checkHealth()
      apiAvailable = healthy
      if (healthy) {
        console.log('[persistence-adapter] API server available, using SQLite backend')
      } else {
        console.log('[persistence-adapter] API server not available, using localStorage')
      }
      return healthy
    } catch {
      apiAvailable = false
      console.log('[persistence-adapter] API server not reachable, using localStorage')
      return false
    } finally {
      apiCheckPromise = null
    }
  })()

  return apiCheckPromise
}

/**
 * Reset API availability check (useful when config changes)
 */
export function resetApiCheck(): void {
  apiAvailable = null
  apiCheckPromise = null
}

// ============================================================================
// Unified Interface
// ============================================================================

export interface BookLibrary {
  books: Book[]
  activeBookId: string | null
}

/**
 * Load book library from best available backend
 */
export async function loadLibrary(): Promise<BookLibrary> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return loadLibraryFromApi()
  } else {
    return loadFromLocalStorage()
  }
}

/**
 * Load a single book with full details (chapters, cards)
 */
export async function loadBook(bookId: string): Promise<Book | null> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return loadBookWithDetails(bookId)
  } else {
    const { books } = loadFromLocalStorage()
    return books.find(b => b.id === bookId) || null
  }
}

/**
 * Save entire library (localStorage only - API uses individual operations)
 */
export async function saveLibrary(books: Book[]): Promise<void> {
  const useApi = await isApiAvailable()

  if (!useApi) {
    saveToLocalStorage(books)
  }
  // API version saves on individual operations
}

/**
 * Set the active book ID
 */
export async function setActiveBookId(id: string | null): Promise<void> {
  // Always store in localStorage (for both backends)
  setActiveIdLocal(id)

  // If using API, subscribe to WebSocket events for this book
  const useApi = await isApiAvailable()
  if (useApi && id) {
    wsManager.connect()
    wsManager.subscribe(id)
  }
}

/**
 * Debounced save for a book
 */
export async function debouncedSave(book: Book, delay = 1000): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    // API saves are immediate via individual operations
    // But we can batch updates if needed
    // For now, no-op since updates happen via apiClient
  } else {
    debouncedSaveLocal(book, delay)
  }
}

// ============================================================================
// Book Operations
// ============================================================================

export async function createBook(title: string, description?: string): Promise<Book> {
  const useApi = await isApiAvailable()

  if (useApi) {
    const book = await apiClient.createBook(title, description)
    return book
  } else {
    const { createEmptyBook } = await import('./types')
    const book = createEmptyBook(title)
    const { books } = loadFromLocalStorage()
    saveToLocalStorage([...books, book])
    setActiveIdLocal(book.id)
    return book
  }
}

export async function updateBookTitle(bookId: string, title: string): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    await apiClient.updateBook(bookId, { title })
  } else {
    const { books } = loadFromLocalStorage()
    const updated = books.map(b =>
      b.id === bookId ? { ...b, title, updatedAt: new Date().toISOString() } : b
    )
    saveToLocalStorage(updated)
  }
}

export async function deleteBook(bookId: string): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    await apiClient.deleteBook(bookId)
  } else {
    const { books } = loadFromLocalStorage()
    saveToLocalStorage(books.filter(b => b.id !== bookId))
  }
}

// ============================================================================
// Chapter Operations
// ============================================================================

export async function createChapter(bookId: string, title: string): Promise<Chapter> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return apiClient.createChapter(bookId, title)
  } else {
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      title,
      order: 0, // Will be set by caller
      wordCount: 0,
      cards: [],
    }
    return chapter
  }
}

export async function createChaptersBatch(bookId: string, titles: string[]): Promise<Chapter[]> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return apiClient.createChaptersBatch(bookId, titles)
  } else {
    return titles.map((title, idx) => ({
      id: crypto.randomUUID(),
      title,
      order: idx + 1,
      wordCount: 0,
      cards: [],
    }))
  }
}

// ============================================================================
// Card Operations
// ============================================================================

export async function harvestCard(bookId: string, card: HarvestCard): Promise<HarvestCard> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return apiClient.harvestCard(bookId, card)
  } else {
    // localStorage version just returns the card as-is
    return card
  }
}

export async function harvestCardsBatch(bookId: string, cards: HarvestCard[]): Promise<HarvestCard[]> {
  const useApi = await isApiAvailable()

  if (useApi) {
    return apiClient.harvestCardsBatch(bookId, cards)
  } else {
    return cards
  }
}

export async function updateCard(cardId: string, updates: Partial<HarvestCard>): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    await apiClient.updateCard(cardId, updates)
  }
  // localStorage version is handled by the component directly
}

export async function moveCardToChapter(cardId: string, chapterId: string): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    await apiClient.moveCardToChapter(cardId, chapterId)
  }
}

export async function deleteCard(cardId: string): Promise<void> {
  const useApi = await isApiAvailable()

  if (useApi) {
    await apiClient.deleteCard(cardId)
  }
}

// ============================================================================
// WebSocket Events
// ============================================================================

/**
 * Subscribe to book events (only works with API backend)
 */
export function onBookEvent(handler: (event: BookEvent) => void): () => void {
  return wsManager.onEvent(handler)
}

/**
 * Connect to WebSocket (called automatically when API is available)
 */
export async function connectWebSocket(): Promise<void> {
  const useApi = await isApiAvailable()
  if (useApi) {
    wsManager.connect()
  }
}

/**
 * Disconnect WebSocket
 */
export function disconnectWebSocket(): void {
  wsManager.disconnect()
}

// Re-export the type
export type { BookEvent }
