/**
 * Book Studio Database
 *
 * SQLite database for books, chapters, cards, clusters, and events.
 * Uses better-sqlite3 for synchronous access in Electron main process.
 */

import Database from 'better-sqlite3';
import { getDbPath } from './config';

// ============================================================================
// Database Instance
// ============================================================================

let db: Database.Database | null = null;

/**
 * Get the database instance (initializes if needed)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ============================================================================
// Migrations
// ============================================================================

const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  -- Books table
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    author_id TEXT,
    target_word_count INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Chapters table
  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    content TEXT,
    draft_instructions TEXT,
    word_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  -- Cards table (harvest cards)
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT,

    -- Source content
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source TEXT NOT NULL,
    content_origin TEXT NOT NULL DEFAULT 'original',
    content TEXT NOT NULL,
    title TEXT,
    author_name TEXT,
    similarity REAL,

    -- Temporal fields
    source_created_at INTEGER,
    source_created_at_status TEXT DEFAULT 'unknown',
    harvested_at INTEGER NOT NULL,

    -- Source linking
    source_url TEXT,
    conversation_id TEXT,
    conversation_title TEXT,

    -- User annotations
    user_notes TEXT DEFAULT '',
    ai_context TEXT,
    ai_summary TEXT,

    -- Organization
    tags TEXT DEFAULT '[]',
    canvas_position TEXT,
    status TEXT DEFAULT 'staging',

    -- Metadata
    metadata TEXT,

    -- Grading
    grade TEXT,
    is_outline INTEGER DEFAULT 0,
    outline_structure TEXT,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
  );

  -- Clusters table
  CREATE TABLE IF NOT EXISTS clusters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    name TEXT NOT NULL,
    card_ids TEXT DEFAULT '[]',
    locked INTEGER DEFAULT 0,
    seed_card_id TEXT,
    centroid TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  -- Outlines table
  CREATE TABLE IF NOT EXISTS outlines (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    structure_json TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    source TEXT,
    confidence REAL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  -- Events table (for event sourcing / audit log)
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    book_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    payload TEXT,
    created_at INTEGER NOT NULL
  );

  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
  CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(book_id, "order");
  CREATE INDEX IF NOT EXISTS idx_cards_book_id ON cards(book_id);
  CREATE INDEX IF NOT EXISTS idx_cards_chapter_id ON cards(chapter_id);
  CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
  CREATE INDEX IF NOT EXISTS idx_clusters_book_id ON clusters(book_id);
  CREATE INDEX IF NOT EXISTS idx_outlines_book_id ON outlines(book_id);
  CREATE INDEX IF NOT EXISTS idx_events_book_id ON events(book_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

  INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `,

  // Migration 2: Add user_id columns for multi-tenant support
  `
  -- Add user_id to books
  ALTER TABLE books ADD COLUMN user_id TEXT;

  -- Add user_id to chapters
  ALTER TABLE chapters ADD COLUMN user_id TEXT;

  -- Add user_id to cards
  ALTER TABLE cards ADD COLUMN user_id TEXT;

  -- Add user_id to clusters
  ALTER TABLE clusters ADD COLUMN user_id TEXT;

  -- Add user_id to outlines
  ALTER TABLE outlines ADD COLUMN user_id TEXT;

  -- Add user_id to events
  ALTER TABLE events ADD COLUMN user_id TEXT;

  -- Create indexes for user_id columns
  CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
  CREATE INDEX IF NOT EXISTS idx_chapters_user_id ON chapters(user_id);
  CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
  CREATE INDEX IF NOT EXISTS idx_clusters_user_id ON clusters(user_id);
  CREATE INDEX IF NOT EXISTS idx_outlines_user_id ON outlines(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);

  -- Update schema version
  INSERT OR IGNORE INTO schema_version (version) VALUES (2);
  `,

  // Migration 3: Grading queue table
  `
  -- Grading queue for background card grading
  CREATE TABLE IF NOT EXISTS grading_queue (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    priority INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_grading_queue_status ON grading_queue(status);
  CREATE INDEX IF NOT EXISTS idx_grading_queue_book_id ON grading_queue(book_id);
  CREATE INDEX IF NOT EXISTS idx_grading_queue_priority ON grading_queue(priority DESC, created_at ASC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_grading_queue_card_unique ON grading_queue(card_id);

  INSERT OR IGNORE INTO schema_version (version) VALUES (3);
  `,

  // Migration 4: Card orders table for draft generation
  `
  -- Card orders table for persisting card ordering within outline sections
  -- Used by draft generation to maintain consistent card order
  CREATE TABLE IF NOT EXISTS card_orders (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    outline_id TEXT,
    section_index INTEGER NOT NULL,
    card_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    user_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (outline_id) REFERENCES outlines(id) ON DELETE SET NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_card_orders_book ON card_orders(book_id);
  CREATE INDEX IF NOT EXISTS idx_card_orders_outline ON card_orders(outline_id);
  CREATE INDEX IF NOT EXISTS idx_card_orders_section ON card_orders(outline_id, section_index);
  CREATE INDEX IF NOT EXISTS idx_card_orders_position ON card_orders(outline_id, section_index, position);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_card_orders_unique ON card_orders(outline_id, section_index, card_id);

  INSERT OR IGNORE INTO schema_version (version) VALUES (4);
  `,

  // Migration 5: Book metrics table for tracking quality at each stage
  `
  -- Book metrics table for tracking quality metrics at each stage
  CREATE TABLE IF NOT EXISTS book_metrics (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    computed_at INTEGER NOT NULL,
    user_id TEXT,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_book_metrics_book ON book_metrics(book_id);
  CREATE INDEX IF NOT EXISTS idx_book_metrics_stage ON book_metrics(book_id, stage);
  CREATE INDEX IF NOT EXISTS idx_book_metrics_computed ON book_metrics(computed_at);

  -- Research cache table for persisting research results
  CREATE TABLE IF NOT EXISTS research_cache (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    research_json TEXT NOT NULL,
    card_count INTEGER NOT NULL,
    card_hash TEXT NOT NULL,
    confidence REAL,
    computed_at INTEGER NOT NULL,
    user_id TEXT,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_research_cache_book ON research_cache(book_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_research_cache_unique ON research_cache(book_id, card_hash);

  INSERT OR IGNORE INTO schema_version (version) VALUES (5);
  `,
];

/**
 * Run all pending migrations
 */
function runMigrations(database: Database.Database): void {
  // Get current version
  let currentVersion = 0;
  try {
    const row = database.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number } | undefined;
    currentVersion = row?.version || 0;
  } catch {
    // Table doesn't exist yet, version is 0
  }

  console.log(`[book-studio-db] Current schema version: ${currentVersion}`);

  // Run pending migrations
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    console.log(`[book-studio-db] Running migration ${i + 1}...`);
    database.exec(MIGRATIONS[i]);
    console.log(`[book-studio-db] Migration ${i + 1} complete`);
  }
}

// ============================================================================
// Type Definitions (matching frontend types)
// ============================================================================

export interface DbBook {
  id: string;
  title: string;
  description: string | null;
  author_id: string | null;
  target_word_count: number | null;
  user_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbChapter {
  id: string;
  book_id: string;
  title: string;
  order: number;
  content: string | null;
  draft_instructions: string | null;
  word_count: number;
  user_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbCard {
  id: string;
  book_id: string;
  chapter_id: string | null;
  source_id: string;
  source_type: string;
  source: string;
  content_origin: string;
  content: string;
  title: string | null;
  author_name: string | null;
  similarity: number | null;
  source_created_at: number | null;
  source_created_at_status: string;
  harvested_at: number;
  source_url: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
  user_notes: string;
  ai_context: string | null;
  ai_summary: string | null;
  tags: string; // JSON array
  canvas_position: string | null; // JSON object
  status: string;
  metadata: string | null; // JSON object
  grade: string | null; // JSON object
  is_outline: number;
  outline_structure: string | null; // JSON object
  user_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbCluster {
  id: string;
  book_id: string;
  name: string;
  card_ids: string; // JSON array
  locked: number;
  seed_card_id: string | null;
  centroid: string | null; // JSON array
  user_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbOutline {
  id: string;
  book_id: string;
  structure_json: string;
  generated_at: number;
  source: string | null;
  confidence: number | null;
  user_id: string | null;
  created_at: number;
}

export interface DbEvent {
  id: number;
  type: string;
  book_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: string | null;
  user_id: string | null;
  created_at: number;
}

export interface DbCardOrder {
  id: string;
  book_id: string;
  outline_id: string | null;
  section_index: number;
  card_id: string;
  position: number;
  user_id: string | null;
  created_at: number;
}

export interface DbBookMetrics {
  id: string;
  book_id: string;
  stage: 'harvest' | 'research' | 'clustering' | 'outline' | 'assignment' | 'draft';
  metrics_json: string; // JSON object
  computed_at: number;
  user_id: string | null;
}

export interface DbResearchCache {
  id: string;
  book_id: string;
  research_json: string;
  card_count: number;
  card_hash: string;
  confidence: number | null;
  computed_at: number;
  user_id: string | null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current Unix timestamp (seconds)
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
