/**
 * BookshelfContext - React context for bookshelf state management
 *
 * Provides access to personas, styles, and book projects across the app.
 * Business logic delegated to operation modules in ./operations/.
 *
 * Storage strategy:
 * - In Electron: Uses Xanadu unified storage (SQLite) via IPC
 * - In browser: Falls back to localStorage via BookshelfService
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
  DraftVersion,
  SourcePassage,
  HarvestBucket,
  NarrativeArc,
  CurationStatus,
} from './types';
import { bookshelfService } from './BookshelfService';
import { harvestBucketService } from './HarvestBucketService';
import {
  migrateToUnifiedStorage,
  isMigrationComplete,
  hasDataToMigrate,
} from '../migration';

// Operation modules
import {
  isXanaduAvailable,
  isDevFallbackEnabled,
  getPersona as getPersonaOp,
  createPersona as createPersonaOp,
  getStyle as getStyleOp,
  createStyle as createStyleOp,
  getBook as getBookOp,
  getResolvedBook as getResolvedBookOp,
  createBook as createBookOp,
  updateBook as updateBookOp,
  deleteBook as deleteBookOp,
  renderBook as renderBookOp,
  getChapter as getChapterOp,
  addChapter as addChapterOp,
  updateChapter as updateChapterOp,
  deleteChapter as deleteChapterOp,
  saveDraftVersion as saveDraftVersionOp,
  getChapterVersions as getChapterVersionsOp,
  updateWriterNotes as updateWriterNotesOp,
  countWords,
  getPassages as getPassagesOp,
  addPassageToBook as addPassageToBookOp,
  updatePassageStatus as updatePassageStatusOp,
  deletePassage as deletePassageOp,
} from './operations';

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
  createPersona: (persona: Omit<Persona, 'uri' | 'type'>) => Promise<Persona>;

  // Styles
  styles: Style[];
  getStyle: (uri: EntityURI) => Style | undefined;
  createStyle: (style: Omit<Style, 'uri' | 'type'>) => Promise<Style>;

  // Books
  books: BookProject[];
  getBook: (uri: EntityURI) => BookProject | undefined;
  getResolvedBook: (uri: EntityURI) => ResolvedBookProject | undefined;
  createBook: (book: Omit<BookProject, 'uri' | 'type'>) => Promise<BookProject>;
  updateBook: (uri: EntityURI, updates: Partial<BookProject>) => Promise<BookProject | undefined>;
  deleteBook: (uri: EntityURI) => Promise<boolean>;

  // Chapter operations (URI-based)
  addChapter: (bookUri: EntityURI, chapter: DraftChapter) => Promise<BookProject | undefined>;
  updateChapter: (bookUri: EntityURI, chapterId: string, updates: Partial<DraftChapter>) => Promise<BookProject | undefined>;
  deleteChapter: (bookUri: EntityURI, chapterId: string) => Promise<BookProject | undefined>;
  getChapter: (bookUri: EntityURI, chapterId: string) => DraftChapter | undefined;

  // Draft versioning
  saveDraftVersion: (
    bookUri: EntityURI,
    chapterId: string,
    content: string,
    metadata: { changes: string; createdBy: 'user' | 'aui' }
  ) => Promise<DraftChapter | undefined>;
  revertToVersion: (bookUri: EntityURI, chapterId: string, version: number) => Promise<DraftChapter | undefined>;
  getChapterVersions: (bookUri: EntityURI, chapterId: string) => DraftVersion[];

  // Writer notes
  updateWriterNotes: (bookUri: EntityURI, chapterId: string, notes: string) => Promise<DraftChapter | undefined>;

  // Book rendering
  renderBook: (bookUri: EntityURI) => string;

  // Simple chapter operations (use activeBookUri)
  createChapterSimple: (title: string, content?: string) => Promise<DraftChapter | undefined>;
  updateChapterSimple: (chapterId: string, content: string, changes?: string) => Promise<void>;
  deleteChapterSimple: (chapterId: string) => Promise<void>;
  getChapterSimple: (chapterId: string) => DraftChapter | undefined;
  revertToVersionSimple: (chapterId: string, version: number) => Promise<void>;
  updateWriterNotesSimple: (chapterId: string, notes: string) => Promise<void>;
  renderActiveBook: () => string;

  // Active state
  activeBookUri: EntityURI | null;
  setActiveBookUri: (uri: EntityURI | null) => void;
  activeBook: BookProject | null;
  activeResolvedBook: ResolvedBookProject | null;

  // Active persona
  activePersonaUri: EntityURI | null;
  setActivePersonaUri: (uri: EntityURI | null) => void;
  activePersona: Persona | null;

  // Search
  findByTag: (tag: string) => (Persona | Style | BookProject)[];
  findByAuthor: (author: string) => (Persona | Style | BookProject)[];

  // Harvest operations
  createHarvestBucket: (bookUri: EntityURI, queries: string[]) => HarvestBucket;
  getActiveBuckets: (bookUri: EntityURI) => HarvestBucket[];
  getBucket: (bucketId: string) => HarvestBucket | undefined;
  approvePassage: (bucketId: string, passageId: string) => HarvestBucket | undefined;
  rejectPassage: (bucketId: string, passageId: string, reason?: string) => HarvestBucket | undefined;
  markAsGem: (bucketId: string, passageId: string) => HarvestBucket | undefined;
  moveToCandidates: (bucketId: string, passageId: string) => HarvestBucket | undefined;
  finishCollecting: (bucketId: string) => HarvestBucket | undefined;
  stageBucket: (bucketId: string) => HarvestBucket | undefined;
  commitBucket: (bucketId: string) => Promise<BookProject | undefined>;
  discardBucket: (bucketId: string) => boolean;
  bucketVersion: number;
  refreshBuckets: () => void;

  // Passage operations on books
  getPassages: (bookUri: EntityURI) => SourcePassage[];
  addPassageToBook: (bookUri: EntityURI, passage: SourcePassage) => Promise<BookProject | undefined>;
  updatePassageStatus: (bookUri: EntityURI, passageId: string, status: CurationStatus) => Promise<BookProject | undefined>;
  deletePassage: (bookUri: EntityURI, passageId: string) => Promise<BookProject | undefined>;

  // Simple passage operations (use activeBookUri)
  addPassageSimple: (passage: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => Promise<SourcePassage | undefined>;
  updatePassageSimple: (passageId: string, updates: Partial<SourcePassage>) => Promise<void>;
  getPassagesSimple: () => SourcePassage[];

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
  const [activePersonaUri, setActivePersonaUri] = useState<EntityURI | null>(null);
  const [bucketVersion, setBucketVersion] = useState(0);

  const refreshBuckets = useCallback(() => setBucketVersion(v => v + 1), []);

  // ─────────────────────────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (isXanaduAvailable()) {
        console.log('[Bookshelf] Using Xanadu unified storage');

        if (!isMigrationComplete() && hasDataToMigrate()) {
          console.log('[Bookshelf] Running localStorage → Xanadu migration...');
          const result = await migrateToUnifiedStorage();
          console.log('[Bookshelf] Migration result:', result);
        }

        await window.electronAPI!.xanadu.seedLibrary();

        const [xPersonas, xStyles, xBooks] = await Promise.all([
          window.electronAPI!.xanadu.personas.list(true),
          window.electronAPI!.xanadu.styles.list(true),
          window.electronAPI!.xanadu.books.list(true),
        ]);

        setPersonas(xPersonas as unknown as Persona[]);
        setStyles(xStyles as unknown as Style[]);
        setBooks(xBooks as unknown as BookProject[]);
      } else if (isDevFallbackEnabled()) {
        console.warn('[Bookshelf] [DEV] Using localStorage fallback');
        await bookshelfService.initialize();
        setPersonas(bookshelfService.getAllPersonas());
        setStyles(bookshelfService.getAllStyles());
        setBooks(bookshelfService.getAllBooks());
      } else {
        throw new Error('Xanadu storage unavailable. Run in Electron app.');
      }
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

  useEffect(() => {
    harvestBucketService.initialize();
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // DELEGATED OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getPersona = useCallback((uri: EntityURI) => getPersonaOp(uri, personas), [personas]);
  const createPersona = useCallback((p: Omit<Persona, 'uri' | 'type'>) => createPersonaOp(p, setPersonas), []);

  const getStyle = useCallback((uri: EntityURI) => getStyleOp(uri, styles), [styles]);
  const createStyle = useCallback((s: Omit<Style, 'uri' | 'type'>) => createStyleOp(s, setStyles), []);

  const getBook = useCallback((uri: EntityURI) => getBookOp(uri, books), [books]);
  const getResolvedBook = useCallback((uri: EntityURI) => getResolvedBookOp(uri, books, personas, styles), [books, personas, styles]);
  const createBook = useCallback((b: Omit<BookProject, 'uri' | 'type'>) => createBookOp(b, setBooks), []);
  const updateBook = useCallback((uri: EntityURI, updates: Partial<BookProject>) => updateBookOp(uri, updates, books, setBooks), [books]);
  const deleteBook = useCallback((uri: EntityURI) => deleteBookOp(uri, books, setBooks, activeBookUri, setActiveBookUri), [books, activeBookUri]);
  const renderBook = useCallback((uri: EntityURI) => renderBookOp(uri, books), [books]);

  const getChapter = useCallback((bookUri: EntityURI, chapterId: string) => getChapterOp(bookUri, chapterId, books), [books]);
  const addChapter = useCallback((bookUri: EntityURI, ch: DraftChapter) => addChapterOp(bookUri, ch, books, setBooks), [books]);
  const updateChapter = useCallback((bookUri: EntityURI, chapterId: string, updates: Partial<DraftChapter>) => updateChapterOp(bookUri, chapterId, updates, books, setBooks), [books]);
  const deleteChapter = useCallback((bookUri: EntityURI, chapterId: string) => deleteChapterOp(bookUri, chapterId, books, setBooks), [books]);

  const saveDraftVersion = useCallback(
    (bookUri: EntityURI, chapterId: string, content: string, metadata: { changes: string; createdBy: 'user' | 'aui' }) =>
      saveDraftVersionOp(bookUri, chapterId, content, metadata, books, setBooks),
    [books]
  );
  const getChapterVersions = useCallback((bookUri: EntityURI, chapterId: string) => getChapterVersionsOp(bookUri, chapterId, books), [books]);
  const updateWriterNotes = useCallback(
    (bookUri: EntityURI, chapterId: string, notes: string) => updateWriterNotesOp(bookUri, chapterId, notes, books, setBooks),
    [books]
  );

  const revertToVersion = useCallback(
    async (bookUri: EntityURI, chapterId: string, version: number) => {
      const versions = getChapterVersions(bookUri, chapterId);
      const targetVersion = versions.find(v => v.version === version);
      if (!targetVersion) return undefined;
      return saveDraftVersion(bookUri, chapterId, targetVersion.content, { changes: `Reverted to version ${version}`, createdBy: 'user' });
    },
    [getChapterVersions, saveDraftVersion]
  );

  const getPassages = useCallback((bookUri: EntityURI) => getPassagesOp(bookUri, books), [books]);
  const addPassageToBook = useCallback((bookUri: EntityURI, passage: SourcePassage) => addPassageToBookOp(bookUri, passage, books, setBooks), [books]);
  const updatePassageStatus = useCallback((bookUri: EntityURI, passageId: string, status: CurationStatus) => updatePassageStatusOp(bookUri, passageId, status, books, setBooks), [books]);
  const deletePassage = useCallback((bookUri: EntityURI, passageId: string) => deletePassageOp(bookUri, passageId, books, setBooks), [books]);

  // ─────────────────────────────────────────────────────────────────
  // SIMPLE OPERATIONS (use activeBookUri)
  // ─────────────────────────────────────────────────────────────────

  const createChapterSimple = useCallback(async (title: string, content?: string) => {
    if (!activeBookUri) return undefined;
    const book = getBook(activeBookUri);
    if (!book) return undefined;

    const existingChapters = book.chapters || [];
    const chapterNumber = existingChapters.length + 1;
    const initialContent = content || `# ${title}\n\nStart writing here...\n`;
    const now = Date.now();
    const chapterId = `ch-${now}-${Math.random().toString(36).substr(2, 9)}`;

    const chapter: DraftChapter = {
      id: chapterId,
      number: chapterNumber,
      title,
      content: initialContent,
      wordCount: countWords(initialContent),
      version: 1,
      versions: [{
        version: 1,
        timestamp: now,
        content: initialContent,
        wordCount: countWords(initialContent),
        changes: 'Initial draft',
        createdBy: 'user',
      }],
      sections: [],
      status: 'outline',
      marginalia: [],
      metadata: { notes: [], lastEditedBy: 'user', lastEditedAt: now, auiSuggestions: [] },
      passageRefs: [],
    };

    await addChapter(activeBookUri, chapter);
    return chapter;
  }, [activeBookUri, getBook, addChapter]);

  const updateChapterSimple = useCallback(async (chapterId: string, content: string, changes?: string) => {
    if (!activeBookUri) return;
    await saveDraftVersion(activeBookUri, chapterId, content, { changes: changes || 'Updated content', createdBy: 'user' });
  }, [activeBookUri, saveDraftVersion]);

  const deleteChapterSimple = useCallback(async (chapterId: string) => {
    if (!activeBookUri) return;
    await deleteChapter(activeBookUri, chapterId);
  }, [activeBookUri, deleteChapter]);

  const getChapterSimple = useCallback((chapterId: string) => {
    if (!activeBookUri) return undefined;
    return getChapter(activeBookUri, chapterId);
  }, [activeBookUri, getChapter]);

  const revertToVersionSimple = useCallback(async (chapterId: string, version: number) => {
    if (!activeBookUri) return;
    await revertToVersion(activeBookUri, chapterId, version);
  }, [activeBookUri, revertToVersion]);

  const updateWriterNotesSimple = useCallback(async (chapterId: string, notes: string) => {
    if (!activeBookUri) return;
    await updateWriterNotes(activeBookUri, chapterId, notes);
  }, [activeBookUri, updateWriterNotes]);

  const renderActiveBook = useCallback(() => {
    if (!activeBookUri) return '';
    return renderBook(activeBookUri);
  }, [activeBookUri, renderBook]);

  const addPassageSimple = useCallback(async (passageData: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => {
    if (!activeBookUri) return undefined;
    const now = Date.now();
    const passageId = `p-${now}-${Math.random().toString(36).substr(2, 9)}`;
    const conversationId = passageData.conversationId || `manual-${now}`;

    const passage: SourcePassage = {
      id: passageId,
      sourceRef: {
        uri: `source://chatgpt/${conversationId}`,
        sourceType: 'chatgpt',
        conversationId,
        conversationTitle: passageData.conversationTitle,
        label: passageData.conversationTitle,
      },
      text: passageData.content,
      wordCount: countWords(passageData.content),
      role: passageData.role || 'user',
      timestamp: now,
      harvestedBy: 'manual',
      curation: { status: 'candidate' },
      tags: passageData.tags || [],
      conversationId,
      conversationTitle: passageData.conversationTitle,
      content: passageData.content,
      status: 'unreviewed',
    };

    await addPassageToBook(activeBookUri, passage);
    return passage;
  }, [activeBookUri, addPassageToBook]);

  const updatePassageSimple = useCallback(async (passageId: string, updates: Partial<SourcePassage>) => {
    if (!activeBookUri) return;
    if (updates.curation?.status) {
      await updatePassageStatus(activeBookUri, passageId, updates.curation.status);
    }
  }, [activeBookUri, updatePassageStatus]);

  const getPassagesSimple = useCallback(() => {
    if (!activeBookUri) return [];
    return getPassages(activeBookUri);
  }, [activeBookUri, getPassages]);

  // ─────────────────────────────────────────────────────────────────
  // DERIVED STATE
  // ─────────────────────────────────────────────────────────────────

  const activeBook = activeBookUri ? getBook(activeBookUri) || null : null;
  const activeResolvedBook = activeBookUri ? getResolvedBook(activeBookUri) || null : null;
  const activePersona = activePersonaUri ? getPersona(activePersonaUri) || null : null;

  // ─────────────────────────────────────────────────────────────────
  // SEARCH
  // ─────────────────────────────────────────────────────────────────

  const findByTag = useCallback((tag: string) => {
    if (isXanaduAvailable()) {
      const results: (Persona | Style | BookProject)[] = [];
      for (const p of personas) if (p.tags?.includes(tag)) results.push(p);
      for (const s of styles) if (s.tags?.includes(tag)) results.push(s);
      for (const b of books) if (b.tags?.includes(tag)) results.push(b);
      return results;
    } else if (isDevFallbackEnabled()) {
      return bookshelfService.findByTag(tag);
    }
    return [];
  }, [personas, styles, books]);

  const findByAuthor = useCallback((author: string) => {
    if (isXanaduAvailable()) {
      const results: (Persona | Style | BookProject)[] = [];
      for (const p of personas) if (p.author === author) results.push(p);
      for (const s of styles) if (s.author === author) results.push(s);
      for (const b of books) if (b.author === author) results.push(b);
      return results;
    } else if (isDevFallbackEnabled()) {
      return bookshelfService.findByAuthor(author);
    }
    return [];
  }, [personas, styles, books]);

  // ─────────────────────────────────────────────────────────────────
  // HARVEST OPERATIONS (delegate to service)
  // ─────────────────────────────────────────────────────────────────

  const createHarvestBucket = useCallback((bookUri: EntityURI, queries: string[]) => harvestBucketService.createBucket(bookUri, queries), []);
  const getActiveBuckets = useCallback((bookUri: EntityURI) => harvestBucketService.getActiveBucketsForBook(bookUri), []);
  const getBucket = useCallback((bucketId: string) => harvestBucketService.getBucket(bucketId), []);
  const approvePassage = useCallback((bucketId: string, passageId: string) => harvestBucketService.approvePassage(bucketId, passageId), []);
  const rejectPassage = useCallback((bucketId: string, passageId: string, reason?: string) => harvestBucketService.rejectPassage(bucketId, passageId, reason), []);
  const markAsGem = useCallback((bucketId: string, passageId: string) => harvestBucketService.markAsGem(bucketId, passageId), []);
  const moveToCandidates = useCallback((bucketId: string, passageId: string) => harvestBucketService.moveToCandidates(bucketId, passageId), []);
  const finishCollecting = useCallback((bucketId: string) => harvestBucketService.finishCollecting(bucketId), []);
  const stageBucket = useCallback((bucketId: string) => harvestBucketService.stageBucket(bucketId), []);
  const discardBucket = useCallback((bucketId: string) => harvestBucketService.discardBucket(bucketId), []);

  const commitBucket = useCallback(async (bucketId: string) => {
    const result = await harvestBucketService.commitBucket(bucketId);
    if (result) {
      if (isXanaduAvailable()) {
        const xBooks = await window.electronAPI!.xanadu.books.list(true);
        setBooks(xBooks as unknown as BookProject[]);
      } else if (isDevFallbackEnabled()) {
        setBooks(bookshelfService.getAllBooks());
      }
    }
    return result;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // NARRATIVE ARC OPERATIONS (delegate to service)
  // ─────────────────────────────────────────────────────────────────

  const createArc = useCallback((bookUri: EntityURI, thesis: string) => harvestBucketService.createArc(bookUri, thesis), []);
  const getArcsForBook = useCallback((bookUri: EntityURI) => harvestBucketService.getArcsForBook(bookUri), []);
  const approveArc = useCallback((arcId: string, feedback?: string) => harvestBucketService.approveArc(arcId, feedback), []);

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
    deleteChapter,
    getChapter,
    saveDraftVersion,
    revertToVersion,
    getChapterVersions,
    updateWriterNotes,
    renderBook,
    createChapterSimple,
    updateChapterSimple,
    deleteChapterSimple,
    getChapterSimple,
    revertToVersionSimple,
    updateWriterNotesSimple,
    renderActiveBook,
    activeBookUri,
    setActiveBookUri,
    activeBook,
    activeResolvedBook,
    activePersonaUri,
    setActivePersonaUri,
    activePersona,
    findByTag,
    findByAuthor,
    createHarvestBucket,
    getActiveBuckets,
    getBucket,
    approvePassage,
    rejectPassage,
    markAsGem,
    moveToCandidates,
    finishCollecting,
    stageBucket,
    commitBucket,
    discardBucket,
    bucketVersion,
    refreshBuckets,
    getPassages,
    addPassageToBook,
    updatePassageStatus,
    deletePassage,
    addPassageSimple,
    updatePassageSimple,
    getPassagesSimple,
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
