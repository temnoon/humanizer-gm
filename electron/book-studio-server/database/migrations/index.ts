/**
 * Book Studio Database Migrations Registry
 *
 * Each migration extends the base schema. Migrations 1-6 are inline in database.ts.
 * Migrations 7+ use this file-based system for better maintainability.
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

// Migration 7: Enhance harvest_history with full tracking
export const migration007_enhance_harvest_history: Migration = {
  version: 7,
  name: 'enhance_harvest_history',
  up: (db) => {
    // Check if migration already applied by checking for a new column
    const tableInfo = db.prepare('PRAGMA table_info(harvest_history)').all() as Array<{ name: string }>;
    const existingColumns = new Set(tableInfo.map((col) => col.name));

    // New columns to add
    const newColumns = [
      { name: 'similarity_threshold', sql: 'ALTER TABLE harvest_history ADD COLUMN similarity_threshold REAL NOT NULL DEFAULT 0.3' },
      { name: 'result_limit', sql: 'ALTER TABLE harvest_history ADD COLUMN result_limit INTEGER NOT NULL DEFAULT 20' },
      { name: 'date_range_start', sql: 'ALTER TABLE harvest_history ADD COLUMN date_range_start INTEGER' },
      { name: 'date_range_end', sql: 'ALTER TABLE harvest_history ADD COLUMN date_range_end INTEGER' },
      { name: 'result_ids', sql: "ALTER TABLE harvest_history ADD COLUMN result_ids TEXT NOT NULL DEFAULT '[]'" },
      { name: 'accepted_ids', sql: "ALTER TABLE harvest_history ADD COLUMN accepted_ids TEXT NOT NULL DEFAULT '[]'" },
      { name: 'rejected_ids', sql: "ALTER TABLE harvest_history ADD COLUMN rejected_ids TEXT NOT NULL DEFAULT '[]'" },
      { name: 'parent_harvest_id', sql: 'ALTER TABLE harvest_history ADD COLUMN parent_harvest_id TEXT' },
      { name: 'iteration_number', sql: 'ALTER TABLE harvest_history ADD COLUMN iteration_number INTEGER NOT NULL DEFAULT 1' },
      { name: 'adjustment_notes', sql: 'ALTER TABLE harvest_history ADD COLUMN adjustment_notes TEXT' },
    ];

    // Check if any new columns need to be added
    const columnsToAdd = newColumns.filter((col) => !existingColumns.has(col.name));

    if (columnsToAdd.length > 0) {
      // Wrap in transaction for atomicity
      db.exec('BEGIN TRANSACTION');
      try {
        for (const col of columnsToAdd) {
          db.exec(col.sql);
        }

        // Add indexes
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_harvest_history_parent ON harvest_history(parent_harvest_id);
          CREATE INDEX IF NOT EXISTS idx_harvest_history_iteration ON harvest_history(book_id, iteration_number);
        `);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    // Always mark version as complete
    db.exec('INSERT OR IGNORE INTO schema_version (version) VALUES (7)');
  },
};

// Migration 8: Create harvest_instructions table
export const migration008_harvest_instructions: Migration = {
  version: 8,
  name: 'harvest_instructions',
  up: (db) => {
    db.exec(`
      -- Agentic Harvest Instructions
      -- Stores rules for what to include/exclude during harvest
      CREATE TABLE IF NOT EXISTS harvest_instructions (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_id TEXT,

        instruction_type TEXT NOT NULL CHECK(instruction_type IN ('include', 'exclude', 'prefer', 'avoid')),
        instruction_text TEXT NOT NULL,

        -- Conditions
        applies_to_sources TEXT,  -- JSON array of source types
        applies_to_date_range TEXT,  -- JSON {start, end}

        priority INTEGER DEFAULT 1,
        active INTEGER DEFAULT 1,

        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        user_id TEXT,

        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_harvest_instructions_book ON harvest_instructions(book_id);
      CREATE INDEX IF NOT EXISTS idx_harvest_instructions_chapter ON harvest_instructions(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_harvest_instructions_active ON harvest_instructions(book_id, active);

      -- Prevent duplicate instructions
      CREATE UNIQUE INDEX IF NOT EXISTS idx_harvest_instructions_unique
        ON harvest_instructions(book_id, instruction_type, instruction_text);

      INSERT OR IGNORE INTO schema_version (version) VALUES (8);
    `);
  },
};

// Migration 9: Create author_voices table
export const migration009_author_voices: Migration = {
  version: 9,
  name: 'author_voices',
  up: (db) => {
    db.exec(`
      -- Author Voice Files
      -- Stores extracted or manual voice profiles for consistent tone
      CREATE TABLE IF NOT EXISTS author_voices (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,

        name TEXT NOT NULL,
        description TEXT,

        -- Voice characteristics
        sample_text TEXT NOT NULL,
        extracted_features TEXT,  -- JSON: tone, vocabulary, rhythm, sentence_length, etc.

        -- Source
        source_card_ids TEXT DEFAULT '[]',
        source_type TEXT CHECK(source_type IN ('extracted', 'manual', 'imported')),

        -- Usage
        is_primary INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,

        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        user_id TEXT,

        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_author_voices_book ON author_voices(book_id);
      CREATE INDEX IF NOT EXISTS idx_author_voices_primary ON author_voices(book_id, is_primary);

      INSERT OR IGNORE INTO schema_version (version) VALUES (9);
    `);
  },
};

// Migration 10: Create draft_versions table
export const migration010_draft_versions: Migration = {
  version: 10,
  name: 'draft_versions',
  up: (db) => {
    db.exec(`
      -- Draft Versions
      -- Stores every generated draft for version history and comparison
      CREATE TABLE IF NOT EXISTS draft_versions (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        book_id TEXT NOT NULL,

        version_number INTEGER NOT NULL,
        content TEXT NOT NULL,
        word_count INTEGER DEFAULT 0,

        -- Generation info
        generator_model TEXT,
        generator_params TEXT,  -- JSON: temperature, max_tokens, etc.
        card_ids_used TEXT DEFAULT '[]',
        voice_id TEXT,

        -- Quality
        quality_score REAL,
        review_status TEXT DEFAULT 'pending' CHECK(review_status IN ('pending', 'approved', 'rejected', 'needs_revision')),
        review_notes TEXT,

        created_at INTEGER NOT NULL,
        user_id TEXT,

        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (voice_id) REFERENCES author_voices(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_draft_versions_chapter ON draft_versions(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_draft_versions_book ON draft_versions(book_id);
      CREATE INDEX IF NOT EXISTS idx_draft_versions_version ON draft_versions(chapter_id, version_number);
      CREATE INDEX IF NOT EXISTS idx_draft_versions_status ON draft_versions(review_status);

      INSERT OR IGNORE INTO schema_version (version) VALUES (10);
    `);
  },
};

// Migration 11: Create book_media table
export const migration011_book_media: Migration = {
  version: 11,
  name: 'book_media',
  up: (db) => {
    db.exec(`
      -- Book Media
      -- Stores references to images, audio, documents associated with books
      CREATE TABLE IF NOT EXISTS book_media (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_id TEXT,

        media_type TEXT NOT NULL CHECK(media_type IN ('image', 'audio', 'document', 'video')),
        filename TEXT NOT NULL,
        mime_type TEXT,
        file_path TEXT NOT NULL,
        file_size INTEGER,

        -- Metadata
        title TEXT,
        description TEXT,
        alt_text TEXT,  -- For accessibility (REQUIRED for images)

        -- Usage
        usage_context TEXT CHECK(usage_context IN ('cover', 'chapter_image', 'reference', 'inline', 'attachment')),
        position INTEGER,

        created_at INTEGER NOT NULL,
        user_id TEXT,

        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_book_media_book ON book_media(book_id);
      CREATE INDEX IF NOT EXISTS idx_book_media_chapter ON book_media(chapter_id);
      CREATE INDEX IF NOT EXISTS idx_book_media_type ON book_media(book_id, media_type);

      INSERT OR IGNORE INTO schema_version (version) VALUES (11);
    `);
  },
};

// All file-based migrations in order
export const FILE_BASED_MIGRATIONS: Migration[] = [
  migration007_enhance_harvest_history,
  migration008_harvest_instructions,
  migration009_author_voices,
  migration010_draft_versions,
  migration011_book_media,
];

/**
 * Run all pending file-based migrations
 */
export function runFileBasedMigrations(db: Database.Database): void {
  // Get current version
  let currentVersion = 0;
  try {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
      | { version: number }
      | undefined;
    currentVersion = row?.version || 0;
  } catch {
    // Table doesn't exist yet
  }

  console.log(`[book-studio-db] Current schema version: ${currentVersion}`);

  // Run pending migrations
  for (const migration of FILE_BASED_MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`[book-studio-db] Running migration ${migration.version}: ${migration.name}...`);
      try {
        migration.up(db);
        console.log(`[book-studio-db] Migration ${migration.version} complete`);
      } catch (error) {
        console.error(`[book-studio-db] Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }
}
