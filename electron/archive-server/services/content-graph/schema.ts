/**
 * Universal Content Graph - Database Schema
 *
 * SQL schema definitions for the UCG tables.
 * This module provides the schema creation SQL and migration logic.
 */

import type Database from 'better-sqlite3';

export const UCG_SCHEMA_VERSION = 2;
export const EMBEDDING_DIM = 768;  // nomic-embed-text via Ollama

/**
 * Schema creation SQL statements
 */
export const SCHEMA_SQL = {
  /**
   * The ONE content table (replaces all format-specific tables)
   */
  contentNodes: `
    CREATE TABLE IF NOT EXISTS content_nodes (
      -- Identity
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      uri TEXT UNIQUE NOT NULL,

      -- Content (text always extracted for search/tools)
      text TEXT NOT NULL,
      format TEXT NOT NULL,
      rendered TEXT,
      binary_hash TEXT,

      -- Metadata (flexible, source-specific)
      title TEXT,
      author TEXT,
      word_count INTEGER NOT NULL DEFAULT 0,
      language TEXT,
      tags TEXT,  -- JSON array
      source_metadata TEXT,  -- JSON object

      -- Source tracking
      source_type TEXT NOT NULL,
      source_adapter TEXT NOT NULL,
      source_original_id TEXT,
      source_original_path TEXT,
      import_batch TEXT,

      -- Version control
      version_number INTEGER NOT NULL DEFAULT 1,
      parent_id TEXT REFERENCES content_nodes(id),
      root_id TEXT NOT NULL,
      operation TEXT,
      operator_id TEXT,

      -- Chunking metadata (for content that was split into embeddable pieces)
      parent_node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
      chunk_index INTEGER,              -- Sequence within parent (0-based)
      chunk_start_offset INTEGER,       -- Character position in parent content
      chunk_end_offset INTEGER,         -- End position in parent content

      -- Embedding metadata
      embedding_model TEXT,             -- 'nomic-embed-text'
      embedding_at INTEGER,             -- Unix timestamp when embedded
      embedding_text_hash TEXT,         -- SHA256 of text that was embedded (for staleness)

      -- Hierarchy/pyramid
      hierarchy_level INTEGER DEFAULT 0, -- 0=source/chunk, 1+=summary levels
      thread_root_id TEXT,              -- Root document ID for grouping related content

      -- Ingestion tracking (from archive to UCG)
      ingested_from_table TEXT,         -- 'conversations', 'messages', 'content_items'
      ingested_from_id TEXT,            -- Original archive row ID
      ingested_at INTEGER,              -- When ingested to UCG

      -- Anchors (for fine-grained linking)
      anchors TEXT,  -- JSON array of ContentAnchor

      -- Timestamps
      created_at INTEGER NOT NULL,
      imported_at INTEGER NOT NULL
    );
  `,

  /**
   * Links table (bidirectional relationships)
   */
  contentLinks: `
    CREATE TABLE IF NOT EXISTS content_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL,
      strength REAL,

      -- Anchor positions
      source_anchor_start INTEGER,
      source_anchor_end INTEGER,
      source_anchor_text TEXT,
      target_anchor_start INTEGER,
      target_anchor_end INTEGER,
      target_anchor_text TEXT,

      -- Metadata
      created_at INTEGER NOT NULL,
      created_by TEXT,
      metadata TEXT,  -- JSON object

      UNIQUE(source_id, target_id, link_type)
    );
  `,

  /**
   * Blob storage for binary content
   */
  contentBlobs: `
    CREATE TABLE IF NOT EXISTS content_blobs (
      hash TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,

  /**
   * Version tracking table
   */
  contentVersions: `
    CREATE TABLE IF NOT EXISTS content_versions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      parent_version_id TEXT,
      operation TEXT,
      operator_id TEXT,
      change_summary TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(node_id, version_number)
    );
  `,

  /**
   * Import batch tracking
   */
  importBatches: `
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_path TEXT,
      source_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      node_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_log TEXT,  -- JSON array
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `,

  /**
   * UCG metadata table for schema version tracking
   */
  ucgMeta: `
    CREATE TABLE IF NOT EXISTS ucg_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,

  /**
   * Quality scoring table (SIC, Chekhov, Quantum analysis results)
   */
  contentQuality: `
    CREATE TABLE IF NOT EXISTS content_quality (
      node_id TEXT PRIMARY KEY REFERENCES content_nodes(id) ON DELETE CASCADE,

      -- Scores (0.0 to 1.0)
      authenticity REAL,            -- SIC analysis (human vs AI)
      necessity REAL,               -- Chekhov gun (does content earn its place)
      inflection REAL,              -- Quantum reading (meaning density)
      voice REAL,                   -- Style coherence (consistent author voice)
      overall REAL,                 -- Weighted composite score

      -- Classification
      stub_type TEXT,               -- 'stub-sentence', 'optimal', 'over-elaborated', etc.
      sic_category TEXT,            -- 'polished-human', 'neat-slop', 'raw-human', etc.

      -- Analysis tracking
      analyzed_at INTEGER NOT NULL,
      analyzer_version TEXT,

      -- Detailed breakdown (JSON for full analysis results)
      analysis_json TEXT
    );
  `,
};

/**
 * Index creation SQL statements
 */
export const INDEXES_SQL = {
  // Content node indexes
  contentNodesByHash: `CREATE INDEX IF NOT EXISTS idx_content_nodes_hash ON content_nodes(content_hash);`,
  contentNodesBySource: `CREATE INDEX IF NOT EXISTS idx_content_nodes_source ON content_nodes(source_type, source_original_id);`,
  contentNodesByRoot: `CREATE INDEX IF NOT EXISTS idx_content_nodes_root ON content_nodes(root_id);`,
  contentNodesByParent: `CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_id);`,
  contentNodesByCreated: `CREATE INDEX IF NOT EXISTS idx_content_nodes_created ON content_nodes(created_at);`,
  contentNodesByImported: `CREATE INDEX IF NOT EXISTS idx_content_nodes_imported ON content_nodes(imported_at);`,
  contentNodesByBatch: `CREATE INDEX IF NOT EXISTS idx_content_nodes_batch ON content_nodes(import_batch);`,

  // Chunk indexes (for content hierarchy)
  contentNodesByParentNode: `CREATE INDEX IF NOT EXISTS idx_content_nodes_parent_node ON content_nodes(parent_node_id);`,
  contentNodesByChunkSeq: `CREATE INDEX IF NOT EXISTS idx_content_nodes_chunk_seq ON content_nodes(parent_node_id, chunk_index);`,
  contentNodesByThread: `CREATE INDEX IF NOT EXISTS idx_content_nodes_thread ON content_nodes(thread_root_id);`,
  contentNodesByHierarchy: `CREATE INDEX IF NOT EXISTS idx_content_nodes_hierarchy ON content_nodes(hierarchy_level);`,

  // Embedding indexes (for staleness detection)
  contentNodesByEmbedding: `CREATE INDEX IF NOT EXISTS idx_content_nodes_embedding ON content_nodes(embedding_at);`,
  contentNodesByEmbeddingHash: `CREATE INDEX IF NOT EXISTS idx_content_nodes_embedding_hash ON content_nodes(embedding_text_hash);`,

  // Ingestion indexes (for archive tracking)
  contentNodesByIngested: `CREATE INDEX IF NOT EXISTS idx_content_nodes_ingested ON content_nodes(ingested_from_table, ingested_from_id);`,
  contentNodesByIngestedAt: `CREATE INDEX IF NOT EXISTS idx_content_nodes_ingested_at ON content_nodes(ingested_at);`,

  // Link indexes
  linksBySource: `CREATE INDEX IF NOT EXISTS idx_content_links_source ON content_links(source_id);`,
  linksByTarget: `CREATE INDEX IF NOT EXISTS idx_content_links_target ON content_links(target_id);`,
  linksByType: `CREATE INDEX IF NOT EXISTS idx_content_links_type ON content_links(link_type);`,

  // Version indexes
  versionsByNode: `CREATE INDEX IF NOT EXISTS idx_content_versions_node ON content_versions(node_id);`,

  // Batch indexes
  batchesByStatus: `CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);`,

  // Quality indexes
  qualityByOverall: `CREATE INDEX IF NOT EXISTS idx_quality_overall ON content_quality(overall DESC);`,
  qualityByStub: `CREATE INDEX IF NOT EXISTS idx_quality_stub ON content_quality(stub_type);`,
  qualityBySic: `CREATE INDEX IF NOT EXISTS idx_quality_sic ON content_quality(sic_category);`,
};

/**
 * Full-text search virtual table
 */
export const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS content_nodes_fts USING fts5(
    text,
    title,
    content='content_nodes',
    content_rowid='rowid'
  );
`;

/**
 * FTS triggers for keeping search index in sync
 */
export const FTS_TRIGGERS_SQL = {
  afterInsert: `
    CREATE TRIGGER IF NOT EXISTS content_nodes_ai AFTER INSERT ON content_nodes BEGIN
      INSERT INTO content_nodes_fts(rowid, text, title) VALUES (NEW.rowid, NEW.text, NEW.title);
    END;
  `,
  afterDelete: `
    CREATE TRIGGER IF NOT EXISTS content_nodes_ad AFTER DELETE ON content_nodes BEGIN
      INSERT INTO content_nodes_fts(content_nodes_fts, rowid, text, title) VALUES('delete', OLD.rowid, OLD.text, OLD.title);
    END;
  `,
  afterUpdate: `
    CREATE TRIGGER IF NOT EXISTS content_nodes_au AFTER UPDATE ON content_nodes BEGIN
      INSERT INTO content_nodes_fts(content_nodes_fts, rowid, text, title) VALUES('delete', OLD.rowid, OLD.text, OLD.title);
      INSERT INTO content_nodes_fts(rowid, text, title) VALUES (NEW.rowid, NEW.text, NEW.title);
    END;
  `,
};

/**
 * Vector table for embeddings (requires vec0 extension)
 */
export const VECTOR_TABLE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS content_nodes_vec USING vec0(
    id TEXT PRIMARY KEY,
    content_hash TEXT,
    embedding float[${EMBEDDING_DIM}]
  );
`;

/**
 * ContentGraphSchema - Manages schema creation and migration
 */
export class ContentGraphSchema {
  private db: Database.Database;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean = false) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Initialize the UCG schema (creates tables if they don't exist)
   */
  initialize(): void {
    // Create core tables
    this.db.exec(SCHEMA_SQL.contentNodes);
    this.db.exec(SCHEMA_SQL.contentLinks);
    this.db.exec(SCHEMA_SQL.contentBlobs);
    this.db.exec(SCHEMA_SQL.contentVersions);
    this.db.exec(SCHEMA_SQL.importBatches);
    this.db.exec(SCHEMA_SQL.ucgMeta);
    this.db.exec(SCHEMA_SQL.contentQuality);

    // Create indexes
    for (const indexSql of Object.values(INDEXES_SQL)) {
      this.db.exec(indexSql);
    }

    // Create FTS table and triggers
    this.db.exec(FTS_SQL);
    for (const triggerSql of Object.values(FTS_TRIGGERS_SQL)) {
      this.db.exec(triggerSql);
    }

    // Create vector table if vec0 extension is loaded
    if (this.vecLoaded) {
      this.createVectorTable();
    }

    // Run migrations if needed
    this.migrate();
  }

  /**
   * Create the vector table for content embeddings
   */
  createVectorTable(): void {
    if (!this.vecLoaded) {
      console.warn('Vec0 extension not loaded, skipping vector table creation');
      return;
    }
    this.db.exec(VECTOR_TABLE_SQL);
  }

  /**
   * Get the current schema version
   */
  getSchemaVersion(): number {
    try {
      const row = this.db.prepare(
        'SELECT value FROM ucg_meta WHERE key = ?'
      ).get('ucg_schema_version') as { value: string } | undefined;
      return row ? parseInt(row.value, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set a metadata value
   */
  setMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO ucg_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  /**
   * Get a metadata value
   */
  getMeta(key: string): string | undefined {
    const row = this.db.prepare(
      'SELECT value FROM ucg_meta WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Run migrations from current version to latest
   */
  migrate(): void {
    const currentVersion = this.getSchemaVersion();

    if (currentVersion < UCG_SCHEMA_VERSION) {
      console.log(`[UCG] Migrating schema from v${currentVersion} to v${UCG_SCHEMA_VERSION}`);
      this.runMigrations(currentVersion);
    }
  }

  /**
   * Run all migrations from the given version
   */
  private runMigrations(fromVersion: number): void {
    // v1 → v2: Add chunking, embedding, hierarchy, ingestion columns + quality table
    if (fromVersion < 2) {
      console.log('[UCG] Running migration v1 → v2: adding chunking/embedding columns...');

      // Add chunking columns
      this.safeAddColumn('content_nodes', 'parent_node_id', 'TEXT');
      this.safeAddColumn('content_nodes', 'chunk_index', 'INTEGER');
      this.safeAddColumn('content_nodes', 'chunk_start_offset', 'INTEGER');
      this.safeAddColumn('content_nodes', 'chunk_end_offset', 'INTEGER');

      // Add embedding metadata columns
      this.safeAddColumn('content_nodes', 'embedding_model', 'TEXT');
      this.safeAddColumn('content_nodes', 'embedding_at', 'INTEGER');
      this.safeAddColumn('content_nodes', 'embedding_text_hash', 'TEXT');

      // Add hierarchy/pyramid columns
      this.safeAddColumn('content_nodes', 'hierarchy_level', 'INTEGER DEFAULT 0');
      this.safeAddColumn('content_nodes', 'thread_root_id', 'TEXT');

      // Add ingestion tracking columns
      this.safeAddColumn('content_nodes', 'ingested_from_table', 'TEXT');
      this.safeAddColumn('content_nodes', 'ingested_from_id', 'TEXT');
      this.safeAddColumn('content_nodes', 'ingested_at', 'INTEGER');

      // Create quality table
      this.db.exec(SCHEMA_SQL.contentQuality);

      // Create new indexes (IF NOT EXISTS handles duplicates)
      this.db.exec(INDEXES_SQL.contentNodesByParentNode);
      this.db.exec(INDEXES_SQL.contentNodesByChunkSeq);
      this.db.exec(INDEXES_SQL.contentNodesByThread);
      this.db.exec(INDEXES_SQL.contentNodesByHierarchy);
      this.db.exec(INDEXES_SQL.contentNodesByEmbedding);
      this.db.exec(INDEXES_SQL.contentNodesByEmbeddingHash);
      this.db.exec(INDEXES_SQL.contentNodesByIngested);
      this.db.exec(INDEXES_SQL.contentNodesByIngestedAt);
      this.db.exec(INDEXES_SQL.qualityByOverall);
      this.db.exec(INDEXES_SQL.qualityByStub);
      this.db.exec(INDEXES_SQL.qualityBySic);

      console.log('[UCG] Migration v1 → v2 complete');
    }

    // Update schema version
    this.setMeta('ucg_schema_version', String(UCG_SCHEMA_VERSION));
  }

  /**
   * Safely add a column if it doesn't exist (SQLite doesn't support IF NOT EXISTS for columns)
   */
  private safeAddColumn(table: string, column: string, type: string): void {
    try {
      // Check if column exists
      const pragma = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      const exists = pragma.some(col => col.name === column);

      if (!exists) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        console.log(`[UCG] Added column ${table}.${column}`);
      }
    } catch (error) {
      console.warn(`[UCG] Warning: could not add column ${table}.${column}:`, error);
    }
  }

  /**
   * Check if UCG tables exist
   */
  tablesExist(): boolean {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type='table' AND name='content_nodes'
    `).get() as { count: number };
    return result.count > 0;
  }

  /**
   * Drop all UCG tables (for testing/reset)
   */
  dropAll(): void {
    // Drop in reverse order due to foreign keys
    this.db.exec('DROP TABLE IF EXISTS content_nodes_fts;');
    this.db.exec('DROP TABLE IF EXISTS content_nodes_vec;');
    this.db.exec('DROP TABLE IF EXISTS content_versions;');
    this.db.exec('DROP TABLE IF EXISTS content_links;');
    this.db.exec('DROP TABLE IF EXISTS content_blobs;');
    this.db.exec('DROP TABLE IF EXISTS import_batches;');
    this.db.exec('DROP TABLE IF EXISTS content_nodes;');
    this.db.exec('DROP TABLE IF EXISTS ucg_meta;');
  }
}

/**
 * Row type for content_nodes table
 */
export interface ContentNodeRow {
  id: string;
  content_hash: string;
  uri: string;
  text: string;
  format: string;
  rendered: string | null;
  binary_hash: string | null;
  title: string | null;
  author: string | null;
  word_count: number;
  language: string | null;
  tags: string | null;  // JSON
  source_metadata: string | null;  // JSON
  source_type: string;
  source_adapter: string;
  source_original_id: string | null;
  source_original_path: string | null;
  import_batch: string | null;
  version_number: number;
  parent_id: string | null;
  root_id: string;
  operation: string | null;
  operator_id: string | null;

  // Chunking columns (v2)
  parent_node_id: string | null;       // Parent node for chunks
  chunk_index: number | null;          // Sequence within parent
  chunk_start_offset: number | null;   // Start position in parent content
  chunk_end_offset: number | null;     // End position in parent content

  // Embedding columns (v2)
  embedding_model: string | null;      // Model used for embedding
  embedding_at: number | null;         // When embedded
  embedding_text_hash: string | null;  // Hash of embedded text (for staleness)

  // Hierarchy columns (v2)
  hierarchy_level: number;             // 0=source/chunk, 1+=summary
  thread_root_id: string | null;       // Root document for grouping

  // Ingestion columns (v2)
  ingested_from_table: string | null;  // Source archive table
  ingested_from_id: string | null;     // Source archive row ID
  ingested_at: number | null;          // When ingested to UCG

  anchors: string | null;  // JSON
  created_at: number;
  imported_at: number;
}

/**
 * Row type for content_links table
 */
export interface ContentLinkRow {
  id: string;
  source_id: string;
  target_id: string;
  link_type: string;
  strength: number | null;
  source_anchor_start: number | null;
  source_anchor_end: number | null;
  source_anchor_text: string | null;
  target_anchor_start: number | null;
  target_anchor_end: number | null;
  target_anchor_text: string | null;
  created_at: number;
  created_by: string | null;
  metadata: string | null;  // JSON
}

/**
 * Row type for content_blobs table
 */
export interface ContentBlobRow {
  hash: string;
  data: Buffer;
  mime_type: string;
  size: number;
  created_at: number;
}

/**
 * Row type for content_versions table
 */
export interface ContentVersionRow {
  id: string;
  node_id: string;
  version_number: number;
  parent_version_id: string | null;
  operation: string | null;
  operator_id: string | null;
  change_summary: string | null;
  created_at: number;
}

/**
 * Row type for import_batches table
 */
export interface ImportBatchRow {
  id: string;
  source_type: string;
  source_path: string | null;
  source_name: string | null;
  status: string;
  node_count: number;
  error_count: number;
  error_log: string | null;  // JSON
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

/**
 * Row type for content_quality table
 */
export interface ContentQualityRow {
  node_id: string;

  // Scores (0.0 to 1.0)
  authenticity: number | null;   // SIC analysis
  necessity: number | null;      // Chekhov gun
  inflection: number | null;     // Quantum reading
  voice: number | null;          // Style coherence
  overall: number | null;        // Weighted composite

  // Classification
  stub_type: string | null;      // 'stub-sentence', 'optimal', etc.
  sic_category: string | null;   // 'polished-human', 'neat-slop', etc.

  // Tracking
  analyzed_at: number;
  analyzer_version: string | null;

  // Detailed breakdown (JSON)
  analysis_json: string | null;
}
