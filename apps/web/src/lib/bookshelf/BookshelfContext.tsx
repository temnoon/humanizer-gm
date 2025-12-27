/**
 * BookshelfContext - React context for bookshelf state management
 *
 * Provides access to personas, styles, and book projects across the app.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';

import type {
  EntityURI,
  Persona,
  Style,
  BookProject,
  ResolvedBookProject,
  DraftChapter,
} from './types';
import { bookshelfService } from './BookshelfService';

// ═══════════════════════════════════════════════════════════════════
// CONTEXT TYPE
// ═══════════════════════════════════════════════════════════════════

interface BookshelfContextType {
  // Loading state
  loading: boolean;
  error: string | null;

  // Personas
  personas: Persona[];
  getPersona: (uri: EntityURI) => Persona | undefined;
  createPersona: (persona: Omit<Persona, 'uri' | 'type'>) => Persona;

  // Styles
  styles: Style[];
  getStyle: (uri: EntityURI) => Style | undefined;
  createStyle: (style: Omit<Style, 'uri' | 'type'>) => Style;

  // Books
  books: BookProject[];
  getBook: (uri: EntityURI) => BookProject | undefined;
  getResolvedBook: (uri: EntityURI) => ResolvedBookProject | undefined;
  createBook: (book: Omit<BookProject, 'uri' | 'type'>) => BookProject;
  updateBook: (uri: EntityURI, updates: Partial<BookProject>) => BookProject | undefined;
  deleteBook: (uri: EntityURI) => boolean;

  // Chapter operations
  addChapter: (bookUri: EntityURI, chapter: DraftChapter) => BookProject | undefined;
  updateChapter: (bookUri: EntityURI, chapterId: string, updates: Partial<DraftChapter>) => BookProject | undefined;

  // Active state
  activeBookUri: EntityURI | null;
  setActiveBookUri: (uri: EntityURI | null) => void;
  activeBook: BookProject | null;
  activeResolvedBook: ResolvedBookProject | null;

  // Search
  findByTag: (tag: string) => (Persona | Style | BookProject)[];
  findByAuthor: (author: string) => (Persona | Style | BookProject)[];

  // Refresh
  refresh: () => Promise<void>;
}

const BookshelfContext = createContext<BookshelfContextType | null>(null);

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════

interface BookshelfProviderProps {
  children: ReactNode;
}

export function BookshelfProvider({ children }: BookshelfProviderProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [books, setBooks] = useState<BookProject[]>([]);
  const [activeBookUri, setActiveBookUri] = useState<EntityURI | null>(null);

  // ─────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await bookshelfService.initialize();
      setPersonas(bookshelfService.getAllPersonas());
      setStyles(bookshelfService.getAllStyles());
      setBooks(bookshelfService.getAllBooks());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bookshelf');
      console.error('Bookshelf load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─────────────────────────────────────────────────────────────────
  // PERSONA OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getPersona = useCallback((uri: EntityURI) => {
    return bookshelfService.getPersona(uri);
  }, []);

  const createPersona = useCallback((persona: Omit<Persona, 'uri' | 'type'>) => {
    const created = bookshelfService.createPersona(persona);
    setPersonas(bookshelfService.getAllPersonas());
    return created;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // STYLE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getStyle = useCallback((uri: EntityURI) => {
    return bookshelfService.getStyle(uri);
  }, []);

  const createStyle = useCallback((style: Omit<Style, 'uri' | 'type'>) => {
    const created = bookshelfService.createStyle(style);
    setStyles(bookshelfService.getAllStyles());
    return created;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // BOOK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getBook = useCallback((uri: EntityURI) => {
    return bookshelfService.getBook(uri);
  }, []);

  const getResolvedBook = useCallback((uri: EntityURI) => {
    return bookshelfService.getResolvedBook(uri);
  }, []);

  const createBook = useCallback((book: Omit<BookProject, 'uri' | 'type'>) => {
    const created = bookshelfService.createBook(book);
    setBooks(bookshelfService.getAllBooks());
    return created;
  }, []);

  const updateBook = useCallback((uri: EntityURI, updates: Partial<BookProject>) => {
    const updated = bookshelfService.updateBook(uri, updates);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }, []);

  const deleteBook = useCallback((uri: EntityURI) => {
    const deleted = bookshelfService.deleteBook(uri);
    if (deleted) {
      setBooks(bookshelfService.getAllBooks());
      if (activeBookUri === uri) {
        setActiveBookUri(null);
      }
    }
    return deleted;
  }, [activeBookUri]);

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const addChapter = useCallback((bookUri: EntityURI, chapter: DraftChapter) => {
    const updated = bookshelfService.addChapter(bookUri, chapter);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }, []);

  const updateChapter = useCallback((
    bookUri: EntityURI,
    chapterId: string,
    updates: Partial<DraftChapter>
  ) => {
    const updated = bookshelfService.updateChapter(bookUri, chapterId, updates);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // DERIVED STATE
  // ─────────────────────────────────────────────────────────────────

  const activeBook = activeBookUri ? bookshelfService.getBook(activeBookUri) || null : null;
  const activeResolvedBook = activeBookUri ? bookshelfService.getResolvedBook(activeBookUri) || null : null;

  // ─────────────────────────────────────────────────────────────────
  // SEARCH
  // ─────────────────────────────────────────────────────────────────

  const findByTag = useCallback((tag: string) => {
    return bookshelfService.findByTag(tag);
  }, []);

  const findByAuthor = useCallback((author: string) => {
    return bookshelfService.findByAuthor(author);
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // CONTEXT VALUE
  // ─────────────────────────────────────────────────────────────────

  const value: BookshelfContextType = {
    loading,
    error,

    personas,
    getPersona,
    createPersona,

    styles,
    getStyle,
    createStyle,

    books,
    getBook,
    getResolvedBook,
    createBook,
    updateBook,
    deleteBook,

    addChapter,
    updateChapter,

    activeBookUri,
    setActiveBookUri,
    activeBook,
    activeResolvedBook,

    findByTag,
    findByAuthor,

    refresh: loadAll,
  };

  return (
    <BookshelfContext.Provider value={value}>
      {children}
    </BookshelfContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useBookshelf(): BookshelfContextType {
  const context = useContext(BookshelfContext);
  if (!context) {
    throw new Error('useBookshelf must be used within a BookshelfProvider');
  }
  return context;
}
