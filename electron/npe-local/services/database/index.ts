/**
 * Local Database Service
 *
 * SQLite database for books, sessions, and quantum analysis.
 * Uses better-sqlite3 for synchronous operations.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let db: Database.Database | null = null;

/**
 * Get the database file path
 */
function getDatabasePath(): string {
  const userDataPath = app?.getPath('userData') || process.env.HOME || '.';
  const humanizerDir = path.join(userDataPath, '.humanizer');

  // Ensure directory exists
  if (!fs.existsSync(humanizerDir)) {
    fs.mkdirSync(humanizerDir, { recursive: true });
  }

  return path.join(humanizerDir, 'npe-local.db');
}

/**
 * Initialize the database with schema
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDatabasePath();
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Books table
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      title TEXT NOT NULL,
      subtitle TEXT,
      author TEXT,
      description TEXT,
      cover_image TEXT,
      visibility TEXT DEFAULT 'private',
      settings TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Book stats
    CREATE TABLE IF NOT EXISTS book_stats (
      book_id TEXT PRIMARY KEY,
      word_count INTEGER DEFAULT 0,
      page_count INTEGER DEFAULT 0,
      chapter_count INTEGER DEFAULT 0,
      section_count INTEGER DEFAULT 0,
      annotation_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- Chapters
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      settings TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- Sections
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      settings TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS studio_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      source_archive TEXT DEFAULT 'main',
      source_message_id TEXT,
      view_mode TEXT DEFAULT 'single-original',
      active_buffer_id TEXT,
      buffers TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Quantum analysis sessions
    CREATE TABLE IF NOT EXISTS quantum_analysis_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      text TEXT NOT NULL,
      total_sentences INTEGER NOT NULL,
      current_sentence INTEGER DEFAULT 0,
      initial_rho_json TEXT,
      current_rho_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- Quantum measurements
    CREATE TABLE IF NOT EXISTS quantum_measurements (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sentence_index INTEGER NOT NULL,
      sentence TEXT NOT NULL,
      prob_literal REAL,
      prob_metaphorical REAL,
      prob_both REAL,
      prob_neither REAL,
      evidence_literal TEXT,
      evidence_metaphorical TEXT,
      evidence_both TEXT,
      evidence_neither TEXT,
      rho_purity REAL,
      rho_entropy REAL,
      rho_top_eigenvalues TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      FOREIGN KEY (session_id) REFERENCES quantum_analysis_sessions(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_sections_chapter ON sections(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON studio_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_quantum_user ON quantum_analysis_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_measurements_session ON quantum_measurements(session_id);
  `);

  console.log('[NPE-Local DB] Initialized at', dbPath);
  return db;
}

/**
 * Get the database instance
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[NPE-Local DB] Closed');
  }
}

/**
 * Generate a UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}
