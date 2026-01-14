/**
 * Book Operations
 *
 * CRUD operations for books with Xanadu/localStorage support.
 * Extracted from BookshelfContext for modularization.
 */

import type { EntityURI, BookProject, ResolvedBookProject, Persona, Style } from '../types';
import { generateURI } from '../types';
import { bookshelfService } from '../BookshelfService';
import { isXanaduAvailable, isDevFallbackEnabled, assertStorageAvailable } from './storage';

/**
 * Get a book by URI or ID
 */
export function getBook(
  uriOrId: EntityURI | string,
  books: BookProject[]
): BookProject | undefined {
  if (isXanaduAvailable()) {
    // Try finding by exact URI match first
    let book = books.find(b => b.uri === uriOrId);
    if (book) return book;

    // Try finding by ID if URI didn't match (handles format differences)
    const idFromUri = uriOrId.replace('book://', '').replace(/^user\//, '');
    book = books.find(b => b.id === idFromUri || b.id === uriOrId);
    if (book) return book;

    // Also check if the URI path matches (handles book://user/xyz vs book://xyz)
    book = books.find(b => {
      const bookPath = b.uri.replace('book://', '').replace(/^user\//, '');
      const searchPath = uriOrId.replace('book://', '').replace(/^user\//, '');
      return bookPath === searchPath;
    });
    return book;
  } else if (isDevFallbackEnabled()) {
    return bookshelfService.getBook(uriOrId as EntityURI);
  }
  return undefined;
}

/**
 * Get a resolved book with populated persona and style references
 */
export function getResolvedBook(
  uri: EntityURI,
  books: BookProject[],
  personas: Persona[],
  styles: Style[]
): ResolvedBookProject | undefined {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === uri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(uri);
  }

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
}

/**
 * Create a new book
 */
export async function createBook(
  book: Omit<BookProject, 'uri' | 'type'>,
  setBooks: (books: BookProject[]) => void
): Promise<BookProject> {
  assertStorageAvailable();

  console.log('[BookOps.createBook] Starting book creation:', book.name);

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

  console.log('[BookOps.createBook] Generated URI:', uri, 'ID:', id);

  if (isXanaduAvailable()) {
    console.log('[BookOps.createBook] Using Xanadu storage');
    try {
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
      console.log('[BookOps.createBook] Upsert complete');

      const xBooks = await window.electronAPI!.xanadu.books.list(true);
      console.log('[BookOps.createBook] Fetched books count:', xBooks?.length);
      setBooks(xBooks as unknown as BookProject[]);
    } catch (err) {
      console.error('[BookOps.createBook] Xanadu error:', err);
      throw err;
    }
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for createBook');
    bookshelfService.createBook(book);
    setBooks(bookshelfService.getAllBooks());
  }

  return full;
}

/**
 * Update an existing book
 */
export async function updateBook(
  uri: EntityURI,
  updates: Partial<BookProject>,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void
): Promise<BookProject | undefined> {
  assertStorageAvailable();

  if (isXanaduAvailable()) {
    const book = books.find(b => b.uri === uri);
    if (!book) return undefined;

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
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for updateBook');
    const updated = bookshelfService.updateBook(uri, updates);
    if (updated) {
      setBooks(bookshelfService.getAllBooks());
    }
    return updated;
  }

  return undefined;
}

/**
 * Delete a book
 */
export async function deleteBook(
  uri: EntityURI,
  books: BookProject[],
  setBooks: (books: BookProject[]) => void,
  activeBookUri: EntityURI | null,
  setActiveBookUri: (uri: EntityURI | null) => void
): Promise<boolean> {
  assertStorageAvailable();

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
  } else if (isDevFallbackEnabled()) {
    console.warn('[DEV] Using localStorage fallback for deleteBook');
    const deleted = bookshelfService.deleteBook(uri);
    if (deleted) {
      setBooks(bookshelfService.getAllBooks());
      if (activeBookUri === uri) {
        setActiveBookUri(null);
      }
    }
    return deleted;
  }

  return false;
}

/**
 * Render a book to markdown
 */
export function renderBook(
  bookUri: EntityURI,
  books: BookProject[]
): string {
  let book: BookProject | undefined;
  if (isXanaduAvailable()) {
    book = books.find(b => b.uri === bookUri);
  } else if (isDevFallbackEnabled()) {
    book = bookshelfService.getBook(bookUri);
  }

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
}
