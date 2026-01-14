/**
 * Passage Operations
 *
 * CRUD operations for passages in books.
 * Extracted from BookshelfContext for modularization.
 */

import type { EntityURI, BookProject, SourcePassage, CurationStatus } from '../types';
import { bookshelfService } from '../BookshelfService';
import { isXanaduAvailable, isDevFallbackEnabled, assertStorageAvailable } from './storage';

/**
 * Get all passages for a book
 */
export function getPassages(
  bookUri: EntityURI,
  books: BookProject[]
): SourcePassage[] {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }
  return book?.passages || [];
}

/**
 * Add a passage to a book
 */
export async function addPassageToBook(
  bookUri: EntityURI,
  passage: SourcePassage,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === bookUri);
    if (!book) return undefined;

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

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);
    return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for addPassageToBook');
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

  return undefined;
}

/**
 * Update a passage's curation status
 */
export async function updatePassageStatus(
  bookUri: EntityURI,
  passageId: string,
  status: CurationStatus,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    await window.electronAPI!.xanadu.passages.curate(passageId, status);

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);
    return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for updatePassageStatus');
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

  return undefined;
}

/**
 * Delete a passage from a book
 */
export async function deletePassage(
  bookUri: EntityURI,
  passageId: string,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === bookUri);
    if (!book) return undefined;

    await window.electronAPI!.xanadu.passages.delete(passageId);

    const xBooks = await window.electronAPI!.xanadu.books.list(true);
    setBooks(xBooks as unknown as BookProject[]);
    return xBooks.find(b => b.uri === bookUri) as unknown as BookProject;
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for deletePassage');
    const book = bookshelfService.getBook(bookUri);
    if (!book) return undefined;

    const passage = book.passages.find(p => p.id === passageId);
    if (!passage) return undefined;

    const status = passage.curation?.status || 'candidate';
    const statsUpdate = { ...book.stats };
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

  return undefined;
}
