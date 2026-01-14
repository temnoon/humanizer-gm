/**
 * Chapter Operations
 *
 * CRUD operations for chapters and draft versioning.
 * Extracted from BookshelfContext for modularization.
 */

import type { EntityURI, BookProject, DraftChapter, DraftVersion } from '../types';
import { bookshelfService } from '../BookshelfService';
import { isXanaduAvailable, isDevFallbackEnabled, assertStorageAvailable } from './storage';

/**
 * Get a chapter by ID from a book
 */
export function getChapter(
  bookUri: EntityURI,
  chapterId: string,
  books: BookProject[]
): DraftChapter | undefined {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }
  return book?.chapters?.find(ch => ch.id === chapterId);
}

/**
 * Add a chapter to a book
 */
export async function addChapter(
  bookUri: EntityURI,
  chapter: DraftChapter,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === bookUri);
    if (!book) return undefined;

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

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);
    return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for addChapter');
    const updated = bookshelfService.addChapter(bookUri, chapter);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }

  return undefined;
}

/**
 * Update a chapter
 */
export async function updateChapter(
  bookUri: EntityURI,
  chapterId: string,
  updates: Partial<DraftChapter>,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === bookUri);
    if (!book) return undefined;

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
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for updateChapter');
    const updated = bookshelfService.updateChapter(bookUri, chapterId, updates);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }

  return undefined;
}

/**
 * Delete a chapter
 */
export async function deleteChapter(
  bookUri: EntityURI,
  chapterId: string,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === bookUri);
    if (!book) return undefined;

    await window.electronAPI!.xanadu.chapters.delete(chapterId);

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);
    return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for deleteChapter');
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

  return undefined;
}

/**
 * Save a new draft version of a chapter
 */
export async function saveDraftVersion(
  bookUri: EntityURI,
  chapterId: string,
  content: string,
  metadata: { changes: string; createdBy: 'user' | 'aui' },
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<DraftChapter | undefined> {
  assertStorageAvailable();

  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }

  if (!book) {
    console.error('[saveDraftVersion] Book not found:', bookUri);
    return undefined;
  }

  const chapter = book.chapters?.find((ch) => ch.id === chapterId);
  if (!chapter) {
    console.error('[saveDraftVersion] Chapter not found:', chapterId);
    return undefined;
  }

  const newVersionNum = (chapter.version ?? 0) + 1;
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  if (isXanaduAvailable()) {
    await window.electronAPI!.xanadu.versions.save(
      chapterId,
      newVersionNum,
      content,
      metadata.changes,
      metadata.createdBy
    );

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

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);

    console.log(`[saveDraftVersion] Saved v${newVersionNum} for chapter "${chapter.title}" via Xanadu`);

    const updatedBook = xBooks.find(b => b.uri === bookUri);
    return updatedBook?.chapters?.find((ch: unknown) => (ch as DraftChapter).id === chapterId) as DraftChapter | undefined;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for saveDraftVersion');

    const newVersion: DraftVersion = {
      version: newVersionNum,
      timestamp: Date.now(),
      content,
      wordCount,
      changes: metadata.changes,
      createdBy: metadata.createdBy,
    };

    const updatedVersions = [...(chapter.versions ?? []), newVersion];

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

  return undefined;
}

/**
 * Get all versions for a chapter
 */
export function getChapterVersions(
  bookUri: EntityURI,
  chapterId: string,
  books: BookProject[]
): DraftVersion[] {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }
  const chapter = book?.chapters?.find(ch => ch.id === chapterId);
  return chapter?.versions || [];
}

/**
 * Update writer notes for a chapter
 */
export async function updateWriterNotes(
  bookUri: EntityURI,
  chapterId: string,
  notes: string,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<DraftChapter | undefined> {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }

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

  const updated = await updateChapter(bookUri, chapterId, updates, books, setBooks);
  return updated?.chapters?.find(ch => ch.id === chapterId);
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
