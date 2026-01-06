/**
 * BookshelfContext - React context for bookshelf state management
 *
 * Provides access to personas, styles, and book projects across the app.
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
import { generateURI } from './types';
import { bookshelfService } from './BookshelfService';
import { harvestBucketService } from './HarvestBucketService';
import {
  migrateToUnifiedStorage,
  isMigrationComplete,
  hasDataToMigrate,
} from '../migration';

// ═══════════════════════════════════════════════════════════════════
// STORAGE MODE DETECTION
// ═══════════════════════════════════════════════════════════════════

function isXanaduAvailable(): boolean {
  return typeof window !== 'undefined' &&
    window.isElectron === true &&
    window.electronAPI?.xanadu !== undefined;
}

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

  // Draft versioning (save workspace content as new draft version)
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

  // Bucket refresh (call after external changes to buckets)
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

  // Bucket version - increment to force re-renders when buckets change
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
        // Xanadu mode - use IPC
        console.log('[Bookshelf] Using Xanadu unified storage');

        // Run migration if needed
        if (!isMigrationComplete() && hasDataToMigrate()) {
          console.log('[Bookshelf] Running localStorage → Xanadu migration...');
          const result = await migrateToUnifiedStorage();
          console.log('[Bookshelf] Migration result:', result);
        }

        // Seed library data
        await window.electronAPI!.xanadu.seedLibrary();

        // Load from Xanadu
        const [xPersonas, xStyles, xBooks] = await Promise.all([
          window.electronAPI!.xanadu.personas.list(true),
          window.electronAPI!.xanadu.styles.list(true),
          window.electronAPI!.xanadu.books.list(true),
        ]);

        // Convert to internal types (they're compatible but need type assertion)
        setPersonas(xPersonas as unknown as Persona[]);
        setStyles(xStyles as unknown as Style[]);
        setBooks(xBooks as unknown as BookProject[]);
      } else {
        // Fallback to localStorage
        console.log('[Bookshelf] Using localStorage (fallback mode)');
        await bookshelfService.initialize();
        setPersonas(bookshelfService.getAllPersonas());
        setStyles(bookshelfService.getAllStyles());
        setBooks(bookshelfService.getAllBooks());
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

  // ─────────────────────────────────────────────────────────────────
  // PERSONA OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getPersona = useCallback((uri: EntityURI) => {
    if (isXanaduAvailable()) {
      // Find in state (already loaded from Xanadu)
      return personas.find(p => p.uri === uri);
    }
    return bookshelfService.getPersona(uri);
  }, [personas]);

  const createPersona = useCallback(async (persona: Omit<Persona, 'uri' | 'type'>) => {
    const uri = generateURI('persona', persona.author || 'user', persona.name);
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const full: Persona = {
      ...persona,
      type: 'persona',
      uri,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (isXanaduAvailable()) {
      await window.electronAPI!.xanadu.personas.upsert({
        id,
        uri,
        name: persona.name,
        description: persona.description,
        author: persona.author,
        voice: persona.voice,
        vocabulary: persona.vocabulary,
        derivedFrom: persona.derivedFrom,
        influences: persona.influences,
        exemplars: persona.exemplars,
        systemPrompt: persona.systemPrompt,
        tags: persona.tags,
      });
      // Reload to get updated list
      const xPersonas = await window.electronAPI!.xanadu.personas.list(true);
      setPersonas(xPersonas as unknown as Persona[]);
    } else {
      bookshelfService.createPersona(persona);
      setPersonas(bookshelfService.getAllPersonas());
    }

    return full;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // STYLE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getStyle = useCallback((uri: EntityURI) => {
    if (isXanaduAvailable()) {
      return styles.find(s => s.uri === uri);
    }
    return bookshelfService.getStyle(uri);
  }, [styles]);

  const createStyle = useCallback(async (style: Omit<Style, 'uri' | 'type'>) => {
    const uri = generateURI('style', style.author || 'user', style.name);
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const full: Style = {
      ...style,
      type: 'style',
      uri,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (isXanaduAvailable()) {
      await window.electronAPI!.xanadu.styles.upsert({
        id,
        uri,
        name: style.name,
        description: style.description,
        author: style.author,
        characteristics: style.characteristics,
        structure: style.structure,
        stylePrompt: style.stylePrompt,
        derivedFrom: style.derivedFrom,
        tags: style.tags,
      });
      const xStyles = await window.electronAPI!.xanadu.styles.list(true);
      setStyles(xStyles as unknown as Style[]);
    } else {
      bookshelfService.createStyle(style);
      setStyles(bookshelfService.getAllStyles());
    }

    return full;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // BOOK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const getBook = useCallback((uri: EntityURI) => {
    if (isXanaduAvailable()) {
      return books.find(b => b.uri === uri);
    }
    return bookshelfService.getBook(uri);
  }, [books]);

  const getResolvedBook = useCallback((uri: EntityURI): ResolvedBookProject | undefined => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === uri)
      : bookshelfService.getBook(uri);

    if (!book) return undefined;

    // Resolve persona and style references
    const resolvedPersonas = (book.personaRefs || [])
      .map(ref => personas.find(p => p.uri === ref))
      .filter((p): p is Persona => p !== undefined);

    const resolvedStyles = (book.styleRefs || [])
      .map(ref => styles.find(s => s.uri === ref))
      .filter((s): s is Style => s !== undefined);

    return {
      ...book,
      _resolved: true,
      personas: resolvedPersonas,
      styles: resolvedStyles,
    };
  }, [books, personas, styles]);

  const createBook = useCallback(async (book: Omit<BookProject, 'uri' | 'type'>) => {
    const uri = generateURI('book', book.author || 'user', book.name);
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const full: BookProject = {
      ...book,
      type: 'book',
      uri,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (isXanaduAvailable()) {
      await window.electronAPI!.xanadu.books.upsert({
        id,
        uri,
        name: book.name,
        subtitle: book.subtitle,
        author: book.author,
        description: book.description,
        status: (book.status || 'harvesting') as 'harvesting' | 'drafting' | 'revising' | 'mastering' | 'complete',
        bookType: book.bookType as 'book' | 'paper' | undefined,
        personaRefs: book.personaRefs,
        styleRefs: book.styleRefs,
        sourceRefs: book.sourceRefs,
        threads: book.threads,
        harvestConfig: book.harvestConfig,
        editorial: book.editorial,
        thinking: book.thinking,
        stats: book.stats,
        profile: book.profile,
        tags: book.tags,
      });
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
    } else {
      bookshelfService.createBook(book);
      setBooks(bookshelfService.getAllBooks());
    }

    return full;
  }, []);

  const updateBook = useCallback(async (uri: EntityURI, updates: Partial<BookProject>) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === uri);
      if (!book) return undefined;

      // Build upsert payload explicitly to avoid type conflicts
      type XanaduBookStatus = 'harvesting' | 'drafting' | 'revising' | 'mastering' | 'complete';
      type XanaduBookType = 'book' | 'paper';
      await window.electronAPI!.xanadu.books.upsert({
        id: book.id,
        uri,
        name: updates.name || book.name,
        subtitle: updates.subtitle,
        author: updates.author,
        description: updates.description,
        status: updates.status as XanaduBookStatus | undefined,
        bookType: updates.bookType as XanaduBookType | undefined,
        personaRefs: updates.personaRefs,
        styleRefs: updates.styleRefs,
        sourceRefs: updates.sourceRefs,
        threads: updates.threads,
        harvestConfig: updates.harvestConfig,
        editorial: updates.editorial,
        thinking: updates.thinking,
        stats: updates.stats,
        profile: updates.profile,
        tags: updates.tags,
      });
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === uri) as unknown as BookProject;
    } else {
      const updated = bookshelfService.updateBook(uri, updates);
      if (updated) {
        setBooks(bookshelfService.getAllBooks());
      }
      return updated;
    }
  }, [books]);

  const deleteBook = useCallback(async (uri: EntityURI) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === uri);
      if (!book) return false;

      await window.electronAPI!.xanadu.books.delete(book.id);
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);

      if (activeBookUri === uri) {
        setActiveBookUri(null);
      }
      return true;
    } else {
      const deleted = bookshelfService.deleteBook(uri);
      if (deleted) {
        setBooks(bookshelfService.getAllBooks());
        if (activeBookUri === uri) {
          setActiveBookUri(null);
        }
      }
      return deleted;
    }
  }, [books, activeBookUri]);

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  const addChapter = useCallback(async (bookUri: EntityURI, chapter: DraftChapter) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === bookUri);
      if (!book) return undefined;

      // Add chapter via Xanadu
      await window.electronAPI!.xanadu.chapters.upsert({
        id: chapter.id,
        bookId: book.id,
        number: chapter.number,
        title: chapter.title,
        content: chapter.content,
        wordCount: chapter.wordCount,
        version: chapter.version,
        status: chapter.status || 'draft',
        epigraph: chapter.epigraph?.text,
        sections: chapter.sections,
        marginalia: chapter.marginalia,
        metadata: chapter.metadata,
        passageRefs: chapter.passageRefs,
      });

      // Save version history
      if (chapter.versions?.length) {
        for (const v of chapter.versions) {
          await window.electronAPI!.xanadu.versions.save(
            chapter.id,
            v.version,
            v.content,
            v.changes,
            v.createdBy
          );
        }
      }

      // Reload books
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
      const updated = bookshelfService.addChapter(bookUri, chapter);
      if (updated) {
        setBooks(bookshelfService.getAllBooks());
      }
      return updated;
    }
  }, [books]);

  const updateChapter = useCallback(async (
    bookUri: EntityURI,
    chapterId: string,
    updates: Partial<DraftChapter>
  ) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === bookUri);
      if (!book) return undefined;

      // Get existing chapter to merge
      const existingChapter = await window.electronAPI!.xanadu.chapters.get(chapterId);
      if (!existingChapter) return undefined;

      await window.electronAPI!.xanadu.chapters.upsert({
        id: chapterId,
        bookId: book.id,
        number: updates.number ?? existingChapter.number,
        title: updates.title ?? existingChapter.title,
        content: updates.content ?? existingChapter.content,
        wordCount: updates.wordCount ?? existingChapter.wordCount,
        version: updates.version ?? existingChapter.version,
        status: updates.status ?? existingChapter.status,
      });

      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
      const updated = bookshelfService.updateChapter(bookUri, chapterId, updates);
      if (updated) {
        setBooks(bookshelfService.getAllBooks());
      }
      return updated;
    }
  }, [books]);

  const deleteChapter = useCallback(async (bookUri: EntityURI, chapterId: string) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === bookUri);
      if (!book) return undefined;

      await window.electronAPI!.xanadu.chapters.delete(chapterId);

      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
      const book = bookshelfService.getBook(bookUri);
      if (!book) return undefined;

      const updatedChapters = (book.chapters || [])
        .filter(c => c.id !== chapterId)
        .map((c, i) => ({ ...c, number: i + 1 })); // Renumber

      const updated = bookshelfService.updateBook(bookUri, {
        chapters: updatedChapters,
        stats: {
          ...book.stats,
          chapters: updatedChapters.length,
        },
      });

      if (updated) {
        setBooks(bookshelfService.getAllBooks());
      }
      return updated;
    }
  }, [books]);

  const getChapter = useCallback((bookUri: EntityURI, chapterId: string): DraftChapter | undefined => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);
    return book?.chapters?.find(ch => ch.id === chapterId);
  }, [books]);

  // ─────────────────────────────────────────────────────────────────
  // DRAFT VERSIONING
  // ─────────────────────────────────────────────────────────────────

  /**
   * Save workspace content as a new draft version
   *
   * Creates a new version in the chapter's version history,
   * preserving the previous content for undo/comparison.
   */
  const saveDraftVersion = useCallback(async (
    bookUri: EntityURI,
    chapterId: string,
    content: string,
    metadata: { changes: string; createdBy: 'user' | 'aui' }
  ): Promise<DraftChapter | undefined> => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);

    if (!book) {
      console.error('[saveDraftVersion] Book not found:', bookUri);
      return undefined;
    }

    const chapter = book.chapters?.find((ch) => ch.id === chapterId);
    if (!chapter) {
      console.error('[saveDraftVersion] Chapter not found:', chapterId);
      return undefined;
    }

    // Calculate new version number
    const newVersionNum = (chapter.version ?? 0) + 1;
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

    if (isXanaduAvailable()) {
      // Save version via Xanadu
      await window.electronAPI!.xanadu.versions.save(
        chapterId,
        newVersionNum,
        content,
        metadata.changes,
        metadata.createdBy
      );

      // Update chapter
      await window.electronAPI!.xanadu.chapters.upsert({
        id: chapterId,
        bookId: book.id,
        number: chapter.number,
        title: chapter.title,
        content,
        wordCount,
        version: newVersionNum,
        status: chapter.status || 'draft',
      });

      // Reload books
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);

      console.log(`[saveDraftVersion] Saved v${newVersionNum} for chapter "${chapter.title}" via Xanadu`);

      // Return updated chapter from fresh state
      const updatedBook = xBooks.find(b => b.uri === bookUri);
      return updatedBook?.chapters?.find((ch: unknown) => (ch as DraftChapter).id === chapterId) as DraftChapter | undefined;
    } else {
      // Create new version entry
      const newVersion: DraftVersion = {
        version: newVersionNum,
        timestamp: Date.now(),
        content,
        wordCount,
        changes: metadata.changes,
        createdBy: metadata.createdBy,
      };

      // Append to versions array (preserve history)
      const updatedVersions = [...(chapter.versions ?? []), newVersion];

      // Update the chapter with new content and version
      const updates: Partial<DraftChapter> = {
        content,
        wordCount,
        version: newVersionNum,
        versions: updatedVersions,
      };

      const updated = bookshelfService.updateChapter(bookUri, chapterId, updates);
      if (updated) {
        setBooks(bookshelfService.getAllBooks());
        console.log(`[saveDraftVersion] Saved v${newVersionNum} for chapter "${chapter.title}"`);
        return updated.chapters.find((ch) => ch.id === chapterId);
      }

      return undefined;
    }
  }, [books]);

  /**
   * Revert chapter to a previous version
   */
  const revertToVersion = useCallback(async (
    bookUri: EntityURI,
    chapterId: string,
    version: number
  ): Promise<DraftChapter | undefined> => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);

    if (!book) return undefined;

    const chapter = book.chapters?.find(ch => ch.id === chapterId);
    if (!chapter) return undefined;

    const targetVersion = chapter.versions?.find(v => v.version === version);
    if (!targetVersion) return undefined;

    // Create a new version that reverts to the old content
    return saveDraftVersion(
      bookUri,
      chapterId,
      targetVersion.content,
      { changes: `Reverted to version ${version}`, createdBy: 'user' }
    );
  }, [books, saveDraftVersion]);

  /**
   * Get all versions for a chapter
   */
  const getChapterVersions = useCallback((bookUri: EntityURI, chapterId: string): DraftVersion[] => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);
    const chapter = book?.chapters?.find(ch => ch.id === chapterId);
    return chapter?.versions || [];
  }, [books]);

  /**
   * Update writer notes for a chapter
   */
  const updateWriterNotes = useCallback(async (
    bookUri: EntityURI,
    chapterId: string,
    notes: string
  ): Promise<DraftChapter | undefined> => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);

    if (!book) return undefined;

    const chapter = book.chapters?.find(ch => ch.id === chapterId);
    if (!chapter) return undefined;

    const updates: Partial<DraftChapter> = {
      writerNotes: notes,
      metadata: {
        ...chapter.metadata,
        lastEditedAt: Date.now(),
      },
    };

    const updated = await updateChapter(bookUri, chapterId, updates);
    return updated?.chapters?.find(ch => ch.id === chapterId);
  }, [books, updateChapter]);

  /**
   * Render book to markdown
   */
  const renderBook = useCallback((bookUri: EntityURI): string => {
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);

    if (!book) return '';

    const parts: string[] = [];
    const chapters = book.chapters || [];

    // Title page
    parts.push(`# ${book.name}`);
    if (book.subtitle) {
      parts.push(`\n*${book.subtitle}*`);
    }
    if (book.description) {
      parts.push(`\n${book.description}`);
    }
    parts.push('\n---\n');

    // Table of contents
    if (chapters.length > 0) {
      parts.push('## Contents\n');
      for (const chapter of chapters) {
        parts.push(`${chapter.number}. [${chapter.title}](#chapter-${chapter.number})`);
      }
      parts.push('\n---\n');
    }

    // Chapters
    for (const chapter of chapters) {
      parts.push(`<a id="chapter-${chapter.number}"></a>\n`);

      if (chapter.epigraph) {
        parts.push(`> ${chapter.epigraph.text}`);
        if (chapter.epigraph.source) {
          parts.push(`>\n> — *${chapter.epigraph.source}*`);
        }
        parts.push('');
      }

      parts.push(chapter.content || '');
      parts.push('\n---\n');
    }

    // Footer
    const wordCount = book.stats?.wordCount || 0;
    const chapterCount = book.stats?.chapters || chapters.length;
    parts.push(`\n*${wordCount.toLocaleString()} words · ${chapterCount} chapters*`);
    parts.push(`\n*Last updated: ${new Date(book.updatedAt || Date.now()).toLocaleDateString()}*`);

    return parts.join('\n');
  }, [books]);

  // ─────────────────────────────────────────────────────────────────
  // SIMPLE OPERATIONS (use activeBookUri)
  // ─────────────────────────────────────────────────────────────────

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  const createChapterSimple = useCallback(async (
    title: string,
    content?: string
  ): Promise<DraftChapter | undefined> => {
    if (!activeBookUri) return undefined;

    const book = isXanaduAvailable()
      ? books.find(b => b.uri === activeBookUri)
      : bookshelfService.getBook(activeBookUri);
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
      versions: [
        {
          version: 1,
          timestamp: now,
          content: initialContent,
          wordCount: countWords(initialContent),
          changes: 'Initial draft',
          createdBy: 'user',
        },
      ],
      sections: [],
      status: 'outline',
      marginalia: [],
      metadata: {
        notes: [],
        lastEditedBy: 'user',
        lastEditedAt: now,
        auiSuggestions: [],
      },
      passageRefs: [],
    };

    await addChapter(activeBookUri, chapter);
    return chapter;
  }, [activeBookUri, books, addChapter]);

  const updateChapterSimple = useCallback(async (
    chapterId: string,
    content: string,
    changes?: string
  ): Promise<void> => {
    if (!activeBookUri) return;

    await saveDraftVersion(activeBookUri, chapterId, content, {
      changes: changes || 'Updated content',
      createdBy: 'user',
    });
  }, [activeBookUri, saveDraftVersion]);

  const deleteChapterSimple = useCallback(async (chapterId: string): Promise<void> => {
    if (!activeBookUri) return;
    await deleteChapter(activeBookUri, chapterId);
  }, [activeBookUri, deleteChapter]);

  const getChapterSimple = useCallback((chapterId: string): DraftChapter | undefined => {
    if (!activeBookUri) return undefined;
    return getChapter(activeBookUri, chapterId);
  }, [activeBookUri, getChapter]);

  const revertToVersionSimple = useCallback(async (
    chapterId: string,
    version: number
  ): Promise<void> => {
    if (!activeBookUri) return;
    await revertToVersion(activeBookUri, chapterId, version);
  }, [activeBookUri, revertToVersion]);

  const updateWriterNotesSimple = useCallback(async (
    chapterId: string,
    notes: string
  ): Promise<void> => {
    if (!activeBookUri) return;
    await updateWriterNotes(activeBookUri, chapterId, notes);
  }, [activeBookUri, updateWriterNotes]);

  const renderActiveBook = useCallback((): string => {
    if (!activeBookUri) return '';
    return renderBook(activeBookUri);
  }, [activeBookUri, renderBook]);

  // ─────────────────────────────────────────────────────────────────
  // DERIVED STATE
  // ─────────────────────────────────────────────────────────────────

  const activeBook = activeBookUri
    ? (isXanaduAvailable() ? books.find(b => b.uri === activeBookUri) : bookshelfService.getBook(activeBookUri)) || null
    : null;
  const activeResolvedBook = activeBookUri ? getResolvedBook(activeBookUri) || null : null;
  const activePersona = activePersonaUri
    ? (isXanaduAvailable() ? personas.find(p => p.uri === activePersonaUri) : bookshelfService.getPersona(activePersonaUri)) || null
    : null;

  // ─────────────────────────────────────────────────────────────────
  // SEARCH
  // ─────────────────────────────────────────────────────────────────

  const findByTag = useCallback((tag: string) => {
    if (isXanaduAvailable()) {
      // Search in local state
      const results: (Persona | Style | BookProject)[] = [];
      for (const p of personas) {
        if (p.tags?.includes(tag)) results.push(p);
      }
      for (const s of styles) {
        if (s.tags?.includes(tag)) results.push(s);
      }
      for (const b of books) {
        if (b.tags?.includes(tag)) results.push(b);
      }
      return results;
    }
    return bookshelfService.findByTag(tag);
  }, [personas, styles, books]);

  const findByAuthor = useCallback((author: string) => {
    if (isXanaduAvailable()) {
      const results: (Persona | Style | BookProject)[] = [];
      for (const p of personas) {
        if (p.author === author) results.push(p);
      }
      for (const s of styles) {
        if (s.author === author) results.push(s);
      }
      for (const b of books) {
        if (b.author === author) results.push(b);
      }
      return results;
    }
    return bookshelfService.findByAuthor(author);
  }, [personas, styles, books]);

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
    const book = isXanaduAvailable()
      ? books.find(b => b.uri === bookUri)
      : bookshelfService.getBook(bookUri);
    return book?.passages || [];
  }, [books]);

  const addPassageToBook = useCallback(async (bookUri: EntityURI, passage: SourcePassage) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === bookUri);
      if (!book) return undefined;

      // Add passage via Xanadu
      await window.electronAPI!.xanadu.passages.upsert({
        id: passage.id,
        bookId: book.id,
        sourceRef: passage.sourceRef,
        text: passage.text || passage.content || '',
        wordCount: passage.wordCount,
        role: passage.role,
        harvestedBy: passage.harvestedBy,
        threadId: (passage as unknown as Record<string, unknown>).threadId as string | undefined,
        curationStatus: passage.curation?.status || 'candidate',
        curationNote: passage.curation?.notes,
        tags: passage.tags,
      });

      // Reload books
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
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
    }
  }, [books]);

  const updatePassageStatus = useCallback(async (
    bookUri: EntityURI,
    passageId: string,
    status: CurationStatus
  ) => {
    if (isXanaduAvailable()) {
      // Update via Xanadu
      await window.electronAPI!.xanadu.passages.curate(passageId, status);

      // Reload books
      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
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
    }
  }, [books]);

  const deletePassage = useCallback(async (bookUri: EntityURI, passageId: string) => {
    if (isXanaduAvailable()) {
      const book = books.find(b => b.uri === bookUri);
      if (!book) return undefined;

      await window.electronAPI!.xanadu.passages.delete(passageId);

      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      setBooks(xBooks as unknown as BookProject[]);
      return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
    } else {
      const book = bookshelfService.getBook(bookUri);
      if (!book) return undefined;

      const passage = book.passages.find(p => p.id === passageId);
      if (!passage) return undefined;

      const status = passage.curation?.status || 'candidate';
      let statsUpdate = { ...book.stats };
      statsUpdate.totalPassages = (statsUpdate.totalPassages || 0) - 1;
      if (status === 'gem') statsUpdate.gems = (statsUpdate.gems || 0) - 1;
      if (status === 'approved' || status === 'gem') {
        statsUpdate.approvedPassages = (statsUpdate.approvedPassages || 0) - 1;
      }

      const updatedPassages = book.passages.filter(p => p.id !== passageId);
      const updated = bookshelfService.updateBook(bookUri, {
        passages: updatedPassages,
        stats: statsUpdate,
      });

      if (updated) {
        setBooks(bookshelfService.getAllBooks());
      }
      return updated;
    }
  }, [books]);

  // ─────────────────────────────────────────────────────────────────
  // SIMPLE PASSAGE OPERATIONS (use activeBookUri)
  // ─────────────────────────────────────────────────────────────────

  const addPassageSimple = useCallback(async (passageData: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }): Promise<SourcePassage | undefined> => {
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
      curation: {
        status: 'candidate',
      },
      tags: passageData.tags || [],
      // Legacy aliases
      conversationId,
      conversationTitle: passageData.conversationTitle,
      content: passageData.content,
      status: 'unreviewed',
    };

    await addPassageToBook(activeBookUri, passage);
    return passage;
  }, [activeBookUri, addPassageToBook]);

  const updatePassageSimple = useCallback(async (
    passageId: string,
    updates: Partial<SourcePassage>
  ): Promise<void> => {
    if (!activeBookUri) return;

    // For now, only support status updates
    if (updates.curation?.status) {
      await updatePassageStatus(activeBookUri, passageId, updates.curation.status);
    }
  }, [activeBookUri, updatePassageStatus]);

  const getPassagesSimple = useCallback((): SourcePassage[] => {
    if (!activeBookUri) return [];
    return getPassages(activeBookUri);
  }, [activeBookUri, getPassages]);

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

    // Chapter operations (URI-based)
    addChapter,
    updateChapter,
    deleteChapter,
    getChapter,

    // Draft versioning
    saveDraftVersion,
    revertToVersion,
    getChapterVersions,

    // Writer notes
    updateWriterNotes,

    // Book rendering
    renderBook,

    // Simple chapter operations (use activeBookUri)
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

    // Bucket refresh
    bucketVersion,
    refreshBuckets,

    // Passage operations
    getPassages,
    addPassageToBook,
    updatePassageStatus,
    deletePassage,

    // Simple passage operations
    addPassageSimple,
    updatePassageSimple,
    getPassagesSimple,

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
