/**
 * Book Studio Vector Database - Data Access Layer (DAO)
 *
 * SQLite-vec companion database for semantic search within books.
 * Uses sqlite-vec extension for fast vector similarity search.
 *
 * ARCHITECTURE NOTE:
 * This is the Data Access Layer (DAO) for vector operations.
 * All functions here are low-level database operations.
 *
 * The EmbeddingService (services/EmbeddingService.ts) is the
 * Business Logic Layer that should be used by API routes.
 * Routes should NEVER import from this file directly.
 *
 * Call hierarchy:
 *   API Routes → EmbeddingService → vec-database.ts (this file)
 *
 * Separate from main books.db to:
 * 1. Keep relational data clean
 * 2. Allow different optimization strategies
 * 3. Enable easy vector index rebuilding
 */

import Database from 'better-sqlite3';
import path from 'path';
import { getDataPath } from '../config';

// ============================================================================
// Constants
// ============================================================================

// mxbai-embed-large produces 1024-dimensional vectors
export const EMBEDDING_DIMENSIONS = 1024;

// ============================================================================
// Database Instance
// ============================================================================

let vecDb: Database.Database | null = null;

/**
 * Get the vector database path
 */
export function getVecDbPath(): string {
  return path.join(getDataPath(), 'books-vec.db');
}

/**
 * Get the vector database instance (initializes if needed)
 */
export function getVecDatabase(): Database.Database {
  if (!vecDb) {
    const dbPath = getVecDbPath();
    vecDb = new Database(dbPath);
    vecDb.pragma('journal_mode = WAL');

    // Note: sqlite-vec extension must be loaded separately
    // For now, we use a regular table with BLOB storage for embeddings
    // When sqlite-vec is available, we can create virtual tables
    initVecSchema(vecDb);
  }
  return vecDb;
}

/**
 * Close the vector database connection
 */
export function closeVecDatabase(): void {
  if (vecDb) {
    vecDb.close();
    vecDb = null;
  }
}

/**
 * Initialize the vector database schema
 *
 * Note: This uses regular tables with BLOB storage for embeddings.
 * When sqlite-vec extension is loaded, the virtual tables will be used instead.
 */
function initVecSchema(db: Database.Database): void {
  db.exec(`
    -- Card embeddings
    CREATE TABLE IF NOT EXISTS card_embeddings (
      card_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_model TEXT DEFAULT 'mxbai-embed-large',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_card_embeddings_book ON card_embeddings(book_id);

    -- Chapter embeddings (full chapter content)
    CREATE TABLE IF NOT EXISTS chapter_embeddings (
      chapter_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_model TEXT DEFAULT 'mxbai-embed-large',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chapter_embeddings_book ON chapter_embeddings(book_id);

    -- Voice embeddings (for voice similarity matching)
    CREATE TABLE IF NOT EXISTS voice_embeddings (
      voice_id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_model TEXT DEFAULT 'mxbai-embed-large',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_voice_embeddings_book ON voice_embeddings(book_id);

    -- Outline section embeddings (for card-to-section matching)
    CREATE TABLE IF NOT EXISTS outline_embeddings (
      outline_id TEXT NOT NULL,
      section_index INTEGER NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT,
      embedding BLOB NOT NULL,
      embedding_model TEXT DEFAULT 'mxbai-embed-large',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (outline_id, section_index)
    );

    CREATE INDEX IF NOT EXISTS idx_outline_embeddings_book ON outline_embeddings(book_id);
    CREATE INDEX IF NOT EXISTS idx_outline_embeddings_outline ON outline_embeddings(outline_id);

    -- Schema version for vector db
    CREATE TABLE IF NOT EXISTS vec_schema_version (
      version INTEGER PRIMARY KEY
    );

    INSERT OR IGNORE INTO vec_schema_version (version) VALUES (1);
  `);

  console.log('[book-studio-vec] Vector database schema initialized');
}

// ============================================================================
// Embedding Operations
// ============================================================================

/**
 * Convert a Float32Array to a Buffer for storage
 */
export function embeddingToBuffer(embedding: number[]): Buffer {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
}

/**
 * Convert a Buffer back to a number array
 */
export function bufferToEmbedding(buffer: Buffer): number[] {
  const float32Array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT
  );
  return Array.from(float32Array);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ============================================================================
// Card Embedding Operations
// ============================================================================

export interface StoredEmbedding {
  id: string;
  book_id: string;
  embedding: number[];
  embedding_model: string;
  created_at: number;
  updated_at: number;
}

// Raw database row types
interface CardEmbeddingRow {
  card_id: string;
  book_id: string;
  embedding: Buffer;
  embedding_model: string;
  created_at: number;
  updated_at: number;
}

interface ChapterEmbeddingRow {
  chapter_id: string;
  book_id: string;
  embedding: Buffer;
  embedding_model: string;
  created_at: number;
  updated_at: number;
}

interface VoiceEmbeddingRow {
  voice_id: string;
  book_id: string;
  embedding: Buffer;
  embedding_model: string;
  created_at: number;
  updated_at: number;
}

/**
 * Store a card embedding
 */
export function storeCardEmbedding(
  cardId: string,
  bookId: string,
  embedding: number[],
  model: string = 'mxbai-embed-large'
): void {
  const db = getVecDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO card_embeddings (card_id, book_id, embedding, embedding_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cardId, bookId, embeddingToBuffer(embedding), model, now, now);
}

/**
 * Get a card embedding
 */
export function getCardEmbedding(cardId: string): StoredEmbedding | null {
  const db = getVecDatabase();
  const row = db
    .prepare('SELECT * FROM card_embeddings WHERE card_id = ?')
    .get(cardId) as CardEmbeddingRow | undefined;

  if (!row) return null;

  return {
    id: row.card_id,
    book_id: row.book_id,
    embedding: bufferToEmbedding(row.embedding),
    embedding_model: row.embedding_model,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Delete a card embedding
 */
export function deleteCardEmbedding(cardId: string): void {
  const db = getVecDatabase();
  db.prepare('DELETE FROM card_embeddings WHERE card_id = ?').run(cardId);
}

/**
 * Delete all card embeddings for a book
 */
export function deleteBookCardEmbeddings(bookId: string): void {
  const db = getVecDatabase();
  db.prepare('DELETE FROM card_embeddings WHERE book_id = ?').run(bookId);
}

/**
 * Find similar cards by embedding
 */
export function findSimilarCards(
  queryEmbedding: number[],
  bookId: string,
  options: {
    limit?: number;
    threshold?: number;
    excludeCardIds?: string[];
  } = {}
): Array<{ cardId: string; similarity: number }> {
  const { limit = 10, threshold = 0.3, excludeCardIds = [] } = options;

  const db = getVecDatabase();
  const rows = db
    .prepare('SELECT card_id, embedding FROM card_embeddings WHERE book_id = ?')
    .all(bookId) as Array<{ card_id: string; embedding: Buffer }>;

  const results: Array<{ cardId: string; similarity: number }> = [];

  for (const row of rows) {
    if (excludeCardIds.includes(row.card_id)) continue;

    const embedding = bufferToEmbedding(row.embedding);
    const similarity = cosineSimilarity(queryEmbedding, embedding);

    if (similarity >= threshold) {
      results.push({ cardId: row.card_id, similarity });
    }
  }

  // Sort by similarity descending and limit
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// ============================================================================
// Chapter Embedding Operations
// ============================================================================

/**
 * Store a chapter embedding
 */
export function storeChapterEmbedding(
  chapterId: string,
  bookId: string,
  embedding: number[],
  model: string = 'mxbai-embed-large'
): void {
  const db = getVecDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO chapter_embeddings (chapter_id, book_id, embedding, embedding_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(chapterId, bookId, embeddingToBuffer(embedding), model, now, now);
}

/**
 * Get a chapter embedding
 */
export function getChapterEmbedding(chapterId: string): StoredEmbedding | null {
  const db = getVecDatabase();
  const row = db
    .prepare('SELECT * FROM chapter_embeddings WHERE chapter_id = ?')
    .get(chapterId) as ChapterEmbeddingRow | undefined;

  if (!row) return null;

  return {
    id: row.chapter_id,
    book_id: row.book_id,
    embedding: bufferToEmbedding(row.embedding),
    embedding_model: row.embedding_model,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Delete a chapter embedding
 */
export function deleteChapterEmbedding(chapterId: string): void {
  const db = getVecDatabase();
  db.prepare('DELETE FROM chapter_embeddings WHERE chapter_id = ?').run(chapterId);
}

// ============================================================================
// Voice Embedding Operations
// ============================================================================

/**
 * Store a voice embedding
 */
export function storeVoiceEmbedding(
  voiceId: string,
  bookId: string,
  embedding: number[],
  model: string = 'mxbai-embed-large'
): void {
  const db = getVecDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO voice_embeddings (voice_id, book_id, embedding, embedding_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(voiceId, bookId, embeddingToBuffer(embedding), model, now, now);
}

/**
 * Get a voice embedding
 */
export function getVoiceEmbedding(voiceId: string): StoredEmbedding | null {
  const db = getVecDatabase();
  const row = db.prepare('SELECT * FROM voice_embeddings WHERE voice_id = ?').get(voiceId) as
    | VoiceEmbeddingRow
    | undefined;

  if (!row) return null;

  return {
    id: row.voice_id,
    book_id: row.book_id,
    embedding: bufferToEmbedding(row.embedding),
    embedding_model: row.embedding_model,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Find similar voices
 */
export function findSimilarVoices(
  queryEmbedding: number[],
  bookId: string,
  options: { limit?: number; threshold?: number } = {}
): Array<{ voiceId: string; similarity: number }> {
  const { limit = 5, threshold = 0.5 } = options;

  const db = getVecDatabase();
  const rows = db
    .prepare('SELECT voice_id, embedding FROM voice_embeddings WHERE book_id = ?')
    .all(bookId) as Array<{ voice_id: string; embedding: Buffer }>;

  const results: Array<{ voiceId: string; similarity: number }> = [];

  for (const row of rows) {
    const embedding = bufferToEmbedding(row.embedding);
    const similarity = cosineSimilarity(queryEmbedding, embedding);

    if (similarity >= threshold) {
      results.push({ voiceId: row.voice_id, similarity });
    }
  }

  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

// ============================================================================
// Outline Embedding Operations
// ============================================================================

/**
 * Store an outline section embedding
 */
export function storeOutlineSectionEmbedding(
  outlineId: string,
  sectionIndex: number,
  bookId: string,
  title: string,
  embedding: number[],
  model: string = 'mxbai-embed-large'
): void {
  const db = getVecDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO outline_embeddings (outline_id, section_index, book_id, title, embedding, embedding_model, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(outlineId, sectionIndex, bookId, title, embeddingToBuffer(embedding), model, now);
}

/**
 * Get all outline section embeddings
 */
export function getOutlineSectionEmbeddings(
  outlineId: string
): Array<{ sectionIndex: number; title: string; embedding: number[] }> {
  const db = getVecDatabase();
  const rows = db
    .prepare('SELECT section_index, title, embedding FROM outline_embeddings WHERE outline_id = ? ORDER BY section_index')
    .all(outlineId) as Array<{ section_index: number; title: string; embedding: Buffer }>;

  return rows.map((row) => ({
    sectionIndex: row.section_index,
    title: row.title,
    embedding: bufferToEmbedding(row.embedding),
  }));
}

/**
 * Delete all outline embeddings
 */
export function deleteOutlineEmbeddings(outlineId: string): void {
  const db = getVecDatabase();
  db.prepare('DELETE FROM outline_embeddings WHERE outline_id = ?').run(outlineId);
}

/**
 * Find best matching section for a card embedding
 */
export function findBestSection(
  cardEmbedding: number[],
  outlineId: string
): { sectionIndex: number; title: string; similarity: number } | null {
  const sections = getOutlineSectionEmbeddings(outlineId);
  if (sections.length === 0) return null;

  let bestMatch: { sectionIndex: number; title: string; similarity: number } | null = null;

  for (const section of sections) {
    const similarity = cosineSimilarity(cardEmbedding, section.embedding);

    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        sectionIndex: section.sectionIndex,
        title: section.title,
        similarity,
      };
    }
  }

  return bestMatch;
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Delete all embeddings for a book
 */
export function deleteAllBookEmbeddings(bookId: string): void {
  const db = getVecDatabase();

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM card_embeddings WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM chapter_embeddings WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM voice_embeddings WHERE book_id = ?').run(bookId);
    db.prepare('DELETE FROM outline_embeddings WHERE book_id = ?').run(bookId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Get embedding statistics for a book
 */
export function getBookEmbeddingStats(bookId: string): {
  cardCount: number;
  chapterCount: number;
  voiceCount: number;
  outlineSectionCount: number;
} {
  const db = getVecDatabase();

  const cardCount =
    (
      db.prepare('SELECT COUNT(*) as count FROM card_embeddings WHERE book_id = ?').get(bookId) as {
        count: number;
      }
    )?.count || 0;

  const chapterCount =
    (
      db
        .prepare('SELECT COUNT(*) as count FROM chapter_embeddings WHERE book_id = ?')
        .get(bookId) as { count: number }
    )?.count || 0;

  const voiceCount =
    (
      db.prepare('SELECT COUNT(*) as count FROM voice_embeddings WHERE book_id = ?').get(bookId) as {
        count: number;
      }
    )?.count || 0;

  const outlineSectionCount =
    (
      db
        .prepare('SELECT COUNT(*) as count FROM outline_embeddings WHERE book_id = ?')
        .get(bookId) as { count: number }
    )?.count || 0;

  return { cardCount, chapterCount, voiceCount, outlineSectionCount };
}
