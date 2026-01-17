/**
 * Book Studio Persistence Layer
 *
 * Stores books in localStorage with automatic save/load.
 * Future: Could be extended to file-based or cloud storage.
 */

import type { Book } from './types'
import { createEmptyBook } from './types'

const STORAGE_KEY = 'book-studio-books'
const ACTIVE_BOOK_KEY = 'book-studio-active-book-id'

// ============================================================================
// Storage Operations
// ============================================================================

export interface BookLibrary {
  books: Book[]
  activeBookId: string | null
}

export function loadLibrary(): BookLibrary {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    const activeId = localStorage.getItem(ACTIVE_BOOK_KEY)

    if (!data) {
      return { books: [], activeBookId: null }
    }

    const books = JSON.parse(data) as Book[]
    return {
      books,
      activeBookId: activeId && books.some(b => b.id === activeId) ? activeId : null
    }
  } catch (e) {
    console.error('Failed to load book library:', e)
    return { books: [], activeBookId: null }
  }
}

export function saveLibrary(books: Book[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books))
  } catch (e) {
    console.error('Failed to save book library:', e)
  }
}

export function setActiveBookId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_BOOK_KEY, id)
    } else {
      localStorage.removeItem(ACTIVE_BOOK_KEY)
    }
  } catch (e) {
    console.error('Failed to save active book ID:', e)
  }
}

// ============================================================================
// Book Operations
// ============================================================================

export function createBook(title: string): Book {
  const book = createEmptyBook(title)
  const { books } = loadLibrary()
  books.push(book)
  saveLibrary(books)
  setActiveBookId(book.id)
  return book
}

export function updateBook(book: Book): void {
  const { books } = loadLibrary()
  const index = books.findIndex(b => b.id === book.id)
  if (index >= 0) {
    books[index] = { ...book, updatedAt: new Date().toISOString() }
    saveLibrary(books)
  }
}

export function deleteBook(bookId: string): void {
  const { books, activeBookId } = loadLibrary()
  const filtered = books.filter(b => b.id !== bookId)
  saveLibrary(filtered)

  if (activeBookId === bookId) {
    setActiveBookId(filtered.length > 0 ? filtered[0].id : null)
  }
}

export function getBook(bookId: string): Book | null {
  const { books } = loadLibrary()
  return books.find(b => b.id === bookId) || null
}

export function listBooks(): Book[] {
  const { books } = loadLibrary()
  return books.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

// ============================================================================
// Autosave Hook
// ============================================================================

let saveTimeout: ReturnType<typeof setTimeout> | null = null

export function debouncedSave(book: Book, delay = 1000): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  saveTimeout = setTimeout(() => {
    updateBook(book)
    saveTimeout = null
  }, delay)
}

export function flushSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
}
