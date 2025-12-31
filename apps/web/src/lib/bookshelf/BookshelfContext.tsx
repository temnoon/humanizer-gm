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
  SourcePassage,
  HarvestBucket,
  NarrativeArc,
  CurationStatus,
} from './types';
import { bookshelfService } from './BookshelfService';
import { harvestBucketService } from './HarvestBucketService';

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

  // ─────────────────────────────────────────────────────────────────
  // HARVEST OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  // Harvest bucket management
  createHarvestBucket: (bookUri: EntityURI, queries: string[]) => HarvestBucket;
  getActiveBuckets: (bookUri: EntityURI) => HarvestBucket[];
  getBucket: (bucketId: string) => HarvestBucket | undefined;

  // Passage curation
  approvePassage: (bucketId: string, passageId: string) => HarvestBucket | undefined;
  rejectPassage: (bucketId: string, passageId: string, reason?: string) => HarvestBucket | undefined;
  markAsGem: (bucketId: string, passageId: string) => HarvestBucket | undefined;
  moveToCandidates: (bucketId: string, passageId: string) => HarvestBucket | undefined;

  // Bucket lifecycle
  finishCollecting: (bucketId: string) => HarvestBucket | undefined;
  stageBucket: (bucketId: string) => HarvestBucket | undefined;
  commitBucket: (bucketId: string) => BookProject | undefined;
  discardBucket: (bucketId: string) => boolean;

  // Passage operations on books
  getPassages: (bookUri: EntityURI) => SourcePassage[];
  addPassageToBook: (bookUri: EntityURI, passage: SourcePassage) => BookProject | undefined;
  updatePassageStatus: (bookUri: EntityURI, passageId: string, status: CurationStatus) => BookProject | undefined;

  // Narrative arc operations
  createArc: (bookUri: EntityURI, thesis: string) => NarrativeArc;
  getArcsForBook: (bookUri: EntityURI) => NarrativeArc[];
  approveArc: (arcId: string, feedback?: string) => NarrativeArc | undefined;

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
  // HARVEST OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  // Initialize harvest service on mount
  useEffect(() => {
    harvestBucketService.initialize();
  }, []);

  const createHarvestBucket = useCallback((bookUri: EntityURI, queries: string[]) => {
    return harvestBucketService.createBucket(bookUri, queries);
  }, []);

  const getActiveBuckets = useCallback((bookUri: EntityURI) => {
    return harvestBucketService.getActiveBucketsForBook(bookUri);
  }, []);

  const getBucket = useCallback((bucketId: string) => {
    return harvestBucketService.getBucket(bucketId);
  }, []);

  const approvePassage = useCallback((bucketId: string, passageId: string) => {
    return harvestBucketService.approvePassage(bucketId, passageId);
  }, []);

  const rejectPassage = useCallback((bucketId: string, passageId: string, reason?: string) => {
    return harvestBucketService.rejectPassage(bucketId, passageId, reason);
  }, []);

  const markAsGem = useCallback((bucketId: string, passageId: string) => {
    return harvestBucketService.markAsGem(bucketId, passageId);
  }, []);

  const moveToCandidates = useCallback((bucketId: string, passageId: string) => {
    return harvestBucketService.moveToCandidates(bucketId, passageId);
  }, []);

  const finishCollecting = useCallback((bucketId: string) => {
    return harvestBucketService.finishCollecting(bucketId);
  }, []);

  const stageBucket = useCallback((bucketId: string) => {
    return harvestBucketService.stageBucket(bucketId);
  }, []);

  const commitBucket = useCallback((bucketId: string) => {
    const result = harvestBucketService.commitBucket(bucketId);
    if (result) {
      // Refresh books after commit
      setBooks(bookshelfService.getAllBooks());
    }
    return result;
  }, []);

  const discardBucket = useCallback((bucketId: string) => {
    return harvestBucketService.discardBucket(bucketId);
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE OPERATIONS ON BOOKS
  // ─────────────────────────────────────────────────────────────────

  const getPassages = useCallback((bookUri: EntityURI) => {
    const book = bookshelfService.getBook(bookUri);
    return book?.passages || [];
  }, []);

  const addPassageToBook = useCallback((bookUri: EntityURI, passage: SourcePassage) => {
    const book = bookshelfService.getBook(bookUri);
    if (!book) return undefined;

    const updatedPassages = [...book.passages, passage];
    const updated = bookshelfService.updateBook(bookUri, {
      passages: updatedPassages,
      stats: {
        ...book.stats,
        totalPassages: updatedPassages.length,
      },
    });

    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }, []);

  const updatePassageStatus = useCallback((
    bookUri: EntityURI,
    passageId: string,
    status: CurationStatus
  ) => {
    const book = bookshelfService.getBook(bookUri);
    if (!book) return undefined;

    const updatedPassages = book.passages.map((p) =>
      p.id === passageId
        ? { ...p, curation: { ...p.curation, status, curatedAt: Date.now() } }
        : p
    );

    const updated = bookshelfService.updateBook(bookUri, { passages: updatedPassages });
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // NARRATIVE ARC OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const createArc = useCallback((bookUri: EntityURI, thesis: string) => {
    return harvestBucketService.createArc(bookUri, thesis);
  }, []);

  const getArcsForBook = useCallback((bookUri: EntityURI) => {
    return harvestBucketService.getArcsForBook(bookUri);
  }, []);

  const approveArc = useCallback((arcId: string, feedback?: string) => {
    return harvestBucketService.approveArc(arcId, feedback);
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

    // Harvest operations
    createHarvestBucket,
    getActiveBuckets,
    getBucket,

    // Passage curation
    approvePassage,
    rejectPassage,
    markAsGem,
    moveToCandidates,

    // Bucket lifecycle
    finishCollecting,
    stageBucket,
    commitBucket,
    discardBucket,

    // Passage operations
    getPassages,
    addPassageToBook,
    updatePassageStatus,

    // Narrative arc
    createArc,
    getArcsForBook,
    approveArc,

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
