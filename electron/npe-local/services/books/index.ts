/**
 * Books Service
 *
 * Local CRUD operations for books, chapters, and sections.
 */

import { getDatabase, generateId } from '../database';
import type Database from 'better-sqlite3';

// ============================================================================
// Types
// ============================================================================

export interface Book {
  id: string;
  userId: string;
  title: string;
  subtitle?: string;
  author?: string;
  description?: string;
  coverImage?: string;
  visibility: 'private' | 'public' | 'unlisted';
  settings?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  stats?: BookStats;
}

export interface BookStats {
  wordCount: number;
  pageCount: number;
  chapterCount: number;
  sectionCount: number;
  annotationCount: number;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  subtitle?: string;
  sortOrder: number;
  settings?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  sections?: Section[];
}

export interface Section {
  id: string;
  chapterId: string;
  bookId: string;
  title: string;
  content?: string;
  sortOrder: number;
  settings?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateBookInput {
  title: string;
  subtitle?: string;
  author?: string;
  description?: string;
  visibility?: 'private' | 'public' | 'unlisted';
  settings?: Record<string, unknown>;
}

export interface CreateChapterInput {
  bookId: string;
  title: string;
  subtitle?: string;
  sortOrder?: number;
  settings?: Record<string, unknown>;
}

export interface CreateSectionInput {
  chapterId: string;
  bookId: string;
  title: string;
  content?: string;
  sortOrder?: number;
  settings?: Record<string, unknown>;
}

// ============================================================================
// Books
// ============================================================================

export function createBook(input: CreateBookInput, userId: string = 'local'): Book {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO books (id, user_id, title, subtitle, author, description, visibility, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    input.title.trim(),
    input.subtitle?.trim() || null,
    input.author?.trim() || userId,
    input.description?.trim() || null,
    input.visibility || 'private',
    input.settings ? JSON.stringify(input.settings) : null,
    now,
    now
  );

  // Initialize stats
  db.prepare(`
    INSERT INTO book_stats (book_id, word_count, page_count, chapter_count, section_count, annotation_count, updated_at)
    VALUES (?, 0, 0, 0, 0, 0, ?)
  `).run(id, now);

  return {
    id,
    userId,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim(),
    author: input.author?.trim() || userId,
    description: input.description?.trim(),
    visibility: input.visibility || 'private',
    settings: input.settings,
    createdAt: now,
    updatedAt: now,
    stats: {
      wordCount: 0,
      pageCount: 0,
      chapterCount: 0,
      sectionCount: 0,
      annotationCount: 0,
    },
  };
}

export function listBooks(userId: string = 'local'): Book[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT b.*, s.word_count, s.page_count, s.chapter_count, s.section_count, s.annotation_count
    FROM books b
    LEFT JOIN book_stats s ON b.id = s.book_id
    WHERE b.user_id = ?
    ORDER BY b.updated_at DESC
  `).all(userId) as any[];

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    description: row.description,
    coverImage: row.cover_image,
    visibility: row.visibility,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: {
      wordCount: row.word_count || 0,
      pageCount: row.page_count || 0,
      chapterCount: row.chapter_count || 0,
      sectionCount: row.section_count || 0,
      annotationCount: row.annotation_count || 0,
    },
  }));
}

export function getBook(bookId: string, userId: string = 'local'): Book | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT b.*, s.word_count, s.page_count, s.chapter_count, s.section_count, s.annotation_count
    FROM books b
    LEFT JOIN book_stats s ON b.id = s.book_id
    WHERE b.id = ? AND b.user_id = ?
  `).get(bookId, userId) as any;

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    subtitle: row.subtitle,
    author: row.author,
    description: row.description,
    coverImage: row.cover_image,
    visibility: row.visibility,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: {
      wordCount: row.word_count || 0,
      pageCount: row.page_count || 0,
      chapterCount: row.chapter_count || 0,
      sectionCount: row.section_count || 0,
      annotationCount: row.annotation_count || 0,
    },
  };
}

export function updateBook(bookId: string, updates: Partial<CreateBookInput>, userId: string = 'local'): Book | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = getBook(bookId, userId);
  if (!existing) return null;

  db.prepare(`
    UPDATE books SET
      title = COALESCE(?, title),
      subtitle = COALESCE(?, subtitle),
      author = COALESCE(?, author),
      description = COALESCE(?, description),
      visibility = COALESCE(?, visibility),
      settings = COALESCE(?, settings),
      updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updates.title?.trim() || null,
    updates.subtitle?.trim() || null,
    updates.author?.trim() || null,
    updates.description?.trim() || null,
    updates.visibility || null,
    updates.settings ? JSON.stringify(updates.settings) : null,
    now,
    bookId,
    userId
  );

  return getBook(bookId, userId);
}

export function deleteBook(bookId: string, userId: string = 'local'): boolean {
  const db = getDatabase();

  const result = db.prepare(`
    DELETE FROM books WHERE id = ? AND user_id = ?
  `).run(bookId, userId);

  return result.changes > 0;
}

// ============================================================================
// Chapters
// ============================================================================

export function createChapter(input: CreateChapterInput): Chapter {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  // Get max sort order
  const maxOrder = db.prepare(`
    SELECT MAX(sort_order) as max_order FROM chapters WHERE book_id = ?
  `).get(input.bookId) as { max_order: number | null };

  const sortOrder = input.sortOrder ?? (maxOrder?.max_order ?? -1) + 1;

  db.prepare(`
    INSERT INTO chapters (id, book_id, title, subtitle, sort_order, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.bookId,
    input.title.trim(),
    input.subtitle?.trim() || null,
    sortOrder,
    input.settings ? JSON.stringify(input.settings) : null,
    now,
    now
  );

  // Update book stats
  updateBookStats(input.bookId);

  return {
    id,
    bookId: input.bookId,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim(),
    sortOrder,
    settings: input.settings,
    createdAt: now,
    updatedAt: now,
  };
}

export function listChapters(bookId: string): Chapter[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order ASC
  `).all(bookId) as any[];

  return rows.map(row => ({
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    subtitle: row.subtitle,
    sortOrder: row.sort_order,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getChapter(chapterId: string): Chapter | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM chapters WHERE id = ?
  `).get(chapterId) as any;

  if (!row) return null;

  // Get sections
  const sections = listSections(chapterId);

  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    subtitle: row.subtitle,
    sortOrder: row.sort_order,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sections,
  };
}

export function updateChapter(chapterId: string, updates: Partial<Omit<CreateChapterInput, 'bookId'>>): Chapter | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = getChapter(chapterId);
  if (!existing) return null;

  db.prepare(`
    UPDATE chapters SET
      title = COALESCE(?, title),
      subtitle = COALESCE(?, subtitle),
      sort_order = COALESCE(?, sort_order),
      settings = COALESCE(?, settings),
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.title?.trim() || null,
    updates.subtitle?.trim() || null,
    updates.sortOrder ?? null,
    updates.settings ? JSON.stringify(updates.settings) : null,
    now,
    chapterId
  );

  return getChapter(chapterId);
}

export function deleteChapter(chapterId: string): boolean {
  const db = getDatabase();

  const chapter = getChapter(chapterId);
  if (!chapter) return false;

  const result = db.prepare(`
    DELETE FROM chapters WHERE id = ?
  `).run(chapterId);

  if (result.changes > 0) {
    updateBookStats(chapter.bookId);
  }

  return result.changes > 0;
}

// ============================================================================
// Sections
// ============================================================================

export function createSection(input: CreateSectionInput): Section {
  const db = getDatabase();
  const id = generateId();
  const now = Date.now();

  // Get max sort order
  const maxOrder = db.prepare(`
    SELECT MAX(sort_order) as max_order FROM sections WHERE chapter_id = ?
  `).get(input.chapterId) as { max_order: number | null };

  const sortOrder = input.sortOrder ?? (maxOrder?.max_order ?? -1) + 1;

  db.prepare(`
    INSERT INTO sections (id, chapter_id, book_id, title, content, sort_order, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.chapterId,
    input.bookId,
    input.title.trim(),
    input.content || null,
    sortOrder,
    input.settings ? JSON.stringify(input.settings) : null,
    now,
    now
  );

  // Update book stats
  updateBookStats(input.bookId);

  return {
    id,
    chapterId: input.chapterId,
    bookId: input.bookId,
    title: input.title.trim(),
    content: input.content,
    sortOrder,
    settings: input.settings,
    createdAt: now,
    updatedAt: now,
  };
}

export function listSections(chapterId: string): Section[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM sections WHERE chapter_id = ? ORDER BY sort_order ASC
  `).all(chapterId) as any[];

  return rows.map(row => ({
    id: row.id,
    chapterId: row.chapter_id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getSection(sectionId: string): Section | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM sections WHERE id = ?
  `).get(sectionId) as any;

  if (!row) return null;

  return {
    id: row.id,
    chapterId: row.chapter_id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateSection(sectionId: string, updates: Partial<Omit<CreateSectionInput, 'chapterId' | 'bookId'>>): Section | null {
  const db = getDatabase();
  const now = Date.now();

  const existing = getSection(sectionId);
  if (!existing) return null;

  db.prepare(`
    UPDATE sections SET
      title = COALESCE(?, title),
      content = COALESCE(?, content),
      sort_order = COALESCE(?, sort_order),
      settings = COALESCE(?, settings),
      updated_at = ?
    WHERE id = ?
  `).run(
    updates.title?.trim() || null,
    updates.content ?? null,
    updates.sortOrder ?? null,
    updates.settings ? JSON.stringify(updates.settings) : null,
    now,
    sectionId
  );

  // Update book stats
  updateBookStats(existing.bookId);

  return getSection(sectionId);
}

export function deleteSection(sectionId: string): boolean {
  const db = getDatabase();

  const section = getSection(sectionId);
  if (!section) return false;

  const result = db.prepare(`
    DELETE FROM sections WHERE id = ?
  `).run(sectionId);

  if (result.changes > 0) {
    updateBookStats(section.bookId);
  }

  return result.changes > 0;
}

// ============================================================================
// Stats
// ============================================================================

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function updateBookStats(bookId: string): void {
  const db = getDatabase();
  const now = Date.now();

  // Count chapters
  const chapterCount = (db.prepare(`
    SELECT COUNT(*) as count FROM chapters WHERE book_id = ?
  `).get(bookId) as { count: number }).count;

  // Count sections
  const sectionCount = (db.prepare(`
    SELECT COUNT(*) as count FROM sections WHERE book_id = ?
  `).get(bookId) as { count: number }).count;

  // Calculate word count from all sections
  const sections = db.prepare(`
    SELECT content FROM sections WHERE book_id = ?
  `).all(bookId) as { content: string | null }[];

  const wordCount = sections.reduce((sum, s) => sum + (s.content ? countWords(s.content) : 0), 0);

  // Update stats
  db.prepare(`
    INSERT OR REPLACE INTO book_stats (book_id, word_count, page_count, chapter_count, section_count, annotation_count, updated_at)
    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT annotation_count FROM book_stats WHERE book_id = ?), 0), ?)
  `).run(bookId, wordCount, sectionCount, chapterCount, sectionCount, bookId, now);
}

// ============================================================================
// Full Book with Structure
// ============================================================================

export function getBookWithStructure(bookId: string, userId: string = 'local'): Book & { chapters: Chapter[] } | null {
  const book = getBook(bookId, userId);
  if (!book) return null;

  const chapters = listChapters(bookId).map(chapter => ({
    ...chapter,
    sections: listSections(chapter.id),
  }));

  return {
    ...book,
    chapters,
  };
}
