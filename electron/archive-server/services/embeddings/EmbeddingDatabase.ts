/**
 * EmbeddingDatabase - SQLite storage for text, references, and vectors
 *
 * Unified storage using SQLite + sqlite-vec for:
 * - Text content (conversations, messages, chunks)
 * - Vector embeddings (768-dim nomic-embed-text via Ollama)
 * - User curation and discovered structures
 *
 * One database per archive for portability.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { v4 as uuidv4 } from 'uuid';
import { existsSync } from 'fs';
import { join } from 'path';
import type {
  Conversation,
  Message,
  Chunk,
  UserMark,
  Cluster,
  ClusterMember,
  Anchor,
  MarkType,
  TargetType,
  AnchorType,
  SearchResult,
} from './types.js';

import { EmbeddingMigrations, SCHEMA_VERSION, EMBEDDING_DIM } from './EmbeddingMigrations.js';
import { ConversationOperations } from './ConversationOperations.js';
import { VectorOperations } from './VectorOperations.js';
import { ContentOperations } from './ContentOperations.js';
import { FacebookOperations } from './FacebookOperations.js';
import { BookOperations } from './BookOperations.js';

/**
 * Find sqlite-vec extension path - handles both dev and packaged Electron environments
 */
function findSqliteVecPath(): string | null {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = platform === 'darwin' ? 'dylib' : platform === 'windows' ? 'dll' : 'so';
  const packageName = `sqlite-vec-${platform}-${arch}`;

  // Possible paths to check (in order of priority)
  const possiblePaths = [
    // Packaged Electron app (asar unpacked with nested node_modules)
    join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'sqlite-vec', 'node_modules', packageName, `vec0.${ext}`),
    // Packaged Electron app (asar unpacked, sibling)
    join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', packageName, `vec0.${ext}`),
    // Development - relative to __dirname
    join(__dirname, '..', '..', '..', '..', 'node_modules', packageName, `vec0.${ext}`),
    // Development - from cwd
    join(process.cwd(), 'node_modules', packageName, `vec0.${ext}`),
    // Development - nested in sqlite-vec
    join(process.cwd(), 'node_modules', 'sqlite-vec', 'node_modules', packageName, `vec0.${ext}`),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      console.log(`[EmbeddingDatabase] Found sqlite-vec at: ${p}`);
      return p;
    }
  }

  console.warn('[EmbeddingDatabase] sqlite-vec extension not found. Tried:', possiblePaths);
  return null;
}

export class EmbeddingDatabase {
  private db: Database.Database;
  private archivePath: string;
  private vecLoaded: boolean = false;
  private migrations!: EmbeddingMigrations;

  // Operation modules (delegation)
  private conversationOps!: ConversationOperations;
  private vectorOps!: VectorOperations;
  private contentOps!: ContentOperations;
  private facebookOps!: FacebookOperations;
  private bookOps!: BookOperations;

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    const dbPath = `${archivePath}/.embeddings.db`;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Load sqlite-vec extension for vector operations
    try {
      // First try the standard load
      sqliteVec.load(this.db);
      this.vecLoaded = true;
      console.log('[EmbeddingDatabase] sqlite-vec loaded via standard path');
    } catch (err) {
      // Fall back to custom path finding for packaged apps
      console.log('[EmbeddingDatabase] Standard load failed, trying custom paths...');
      const vecPath = findSqliteVecPath();
      if (vecPath) {
        try {
          this.db.loadExtension(vecPath);
          this.vecLoaded = true;
          console.log('[EmbeddingDatabase] sqlite-vec loaded via custom path');
        } catch (loadErr) {
          console.warn('[EmbeddingDatabase] Failed to load sqlite-vec from custom path:', loadErr);
        }
      } else {
        console.warn('[EmbeddingDatabase] sqlite-vec extension not available');
      }
    }

    // Initialize migrations module with db and vecLoaded state
    this.migrations = new EmbeddingMigrations(this.db, this.vecLoaded);

    this.initSchema();

    // Initialize operation modules (delegation pattern)
    this.conversationOps = new ConversationOperations(this.db, this.vecLoaded);
    this.vectorOps = new VectorOperations(this.db, this.vecLoaded);
    this.contentOps = new ContentOperations(this.db, this.vecLoaded);
    this.facebookOps = new FacebookOperations(this.db, this.vecLoaded);
    this.bookOps = new BookOperations(this.db, this.vecLoaded);
  }

  private initSchema(): void {
    // Check schema version
    const versionResult = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
    `).get();

    if (!versionResult) {
      this.createTables();
    } else {
      const currentVersion = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
      if (!currentVersion || currentVersion.version < SCHEMA_VERSION) {
        this.migrations.run(currentVersion?.version || 0);
      }
    }
  }

  private createTables(): void {
    this.db.exec(`
      -- Schema version tracking
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});

      -- Core entities
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        folder TEXT NOT NULL,
        title TEXT,
        created_at REAL,
        updated_at REAL,
        message_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        is_interesting INTEGER DEFAULT 0,
        summary TEXT,
        summary_embedding_id TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        parent_id TEXT,
        role TEXT NOT NULL,
        content TEXT,
        created_at REAL,
        token_count INTEGER DEFAULT 0,
        embedding_id TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        chunk_index INTEGER,
        content TEXT,
        token_count INTEGER DEFAULT 0,
        embedding_id TEXT,
        granularity TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      -- User curation
      CREATE TABLE IF NOT EXISTS user_marks (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        mark_type TEXT NOT NULL,
        note TEXT,
        created_at REAL
      );

      -- Discovered structures
      CREATE TABLE IF NOT EXISTS clusters (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        centroid_embedding_id TEXT,
        member_count INTEGER DEFAULT 0,
        coherence_score REAL,
        created_at REAL
      );

      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id TEXT,
        embedding_id TEXT,
        distance_to_centroid REAL,
        PRIMARY KEY (cluster_id, embedding_id)
      );

      CREATE TABLE IF NOT EXISTS anchors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        anchor_type TEXT NOT NULL,
        embedding BLOB,
        source_embedding_ids TEXT,
        created_at REAL
      );

      -- ========================================================================
      -- Unified Content Tables (Facebook posts, comments, photos, etc.)
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,              -- 'post', 'comment', 'photo', 'video', 'message', 'document', 'note'
        source TEXT NOT NULL,             -- 'facebook', 'openai', 'claude', 'instagram', 'reddit', 'local'

        -- Universal Archive Fields (v15)
        uri TEXT UNIQUE,                  -- content://{source}/{type}/{id}
        content_hash TEXT,                -- SHA-256 for deduplication
        source_id TEXT,                   -- Original platform-specific ID
        imported_at REAL,                 -- When content was imported

        -- Content
        text TEXT,                        -- Post text, comment text, message content
        title TEXT,                       -- Optional title

        -- Timestamps
        created_at REAL NOT NULL,         -- Unix timestamp (original creation)
        updated_at REAL,

        -- Author/Actor
        author_name TEXT,                 -- "Tem Noon" or "Friend Name"
        author_id TEXT,                   -- Facebook user ID
        is_own_content INTEGER,           -- 1 if created by user, 0 if by others

        -- Context/Relationships
        parent_id TEXT,                   -- For replies/comments
        thread_id TEXT,                   -- Top-level post ID
        context TEXT,                     -- JSON: "commented on David Morris's post"

        -- File System Reference
        file_path TEXT,                   -- Path to folder: "facebook_import/posts/Q1_2008/post_123/"

        -- Media
        media_refs TEXT,                  -- JSON array of file paths
        media_count INTEGER DEFAULT 0,

        -- Metadata
        metadata TEXT,                    -- JSON: source-specific fields
        tags TEXT,                        -- JSON array

        -- Embeddings
        embedding BLOB,                   -- vec0 embedding (768-dim nomic-embed-text)
        embedding_model TEXT DEFAULT 'nomic-embed-text',

        -- Search
        search_text TEXT,                 -- Preprocessed for FTS

        FOREIGN KEY (parent_id) REFERENCES content_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS media_files (
        id TEXT PRIMARY KEY,
        content_item_id TEXT,

        file_path TEXT NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,

        type TEXT NOT NULL,               -- 'photo', 'video', 'audio', 'document'
        width INTEGER,
        height INTEGER,
        duration INTEGER,

        taken_at REAL,
        uploaded_at REAL,

        caption TEXT,
        location TEXT,                    -- JSON
        people_tagged TEXT,               -- JSON array
        metadata TEXT,                    -- JSON

        embedding BLOB,                   -- CLIP for visual similarity (future)
        embedding_model TEXT,

        FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        content_item_id TEXT NOT NULL,

        reaction_type TEXT NOT NULL,      -- 'like', 'love', 'haha', 'wow', 'sad', 'angry'
        reactor_name TEXT,
        reactor_id TEXT,

        created_at REAL NOT NULL,

        FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS archive_settings (
        archive_id TEXT PRIMARY KEY,      -- 'facebook_import_2025-11-18'
        settings TEXT NOT NULL,           -- JSON of ArchiveOrganizationSettings
        created_at REAL NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_message ON chunks(message_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_granularity ON chunks(granularity);
      CREATE INDEX IF NOT EXISTS idx_user_marks_target ON user_marks(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_interesting ON conversations(is_interesting);

      -- Indexes for unified content tables
      CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(type);
      CREATE INDEX IF NOT EXISTS idx_content_source ON content_items(source);
      CREATE INDEX IF NOT EXISTS idx_content_created ON content_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_content_author ON content_items(author_name);
      CREATE INDEX IF NOT EXISTS idx_content_thread ON content_items(thread_id);
      CREATE INDEX IF NOT EXISTS idx_content_own ON content_items(is_own_content);
      CREATE INDEX IF NOT EXISTS idx_content_file_path ON content_items(file_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_uri ON content_items(uri);
      CREATE INDEX IF NOT EXISTS idx_content_hash ON content_items(content_hash);
      CREATE INDEX IF NOT EXISTS idx_content_imported ON content_items(imported_at DESC);
      -- Note: idx_content_source_unique deferred until source_id backfill

      CREATE INDEX IF NOT EXISTS idx_media_content ON media_files(content_item_id);
      CREATE INDEX IF NOT EXISTS idx_media_type ON media_files(type);
      CREATE INDEX IF NOT EXISTS idx_media_taken ON media_files(taken_at DESC);

      CREATE INDEX IF NOT EXISTS idx_reactions_content ON reactions(content_item_id);
      CREATE INDEX IF NOT EXISTS idx_reactions_type ON reactions(reaction_type);

      -- ========================================================================
      -- Import Tracking
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS imports (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,              -- 'openai', 'facebook', 'claude', 'paste', 'file'
        source_path TEXT,                  -- Original file/folder path
        status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'

        -- Stats
        thread_count INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        media_count INTEGER DEFAULT 0,
        total_words INTEGER DEFAULT 0,

        -- Timestamps
        created_at REAL NOT NULL,
        started_at REAL,
        completed_at REAL,

        -- Error tracking
        error_message TEXT,

        -- Metadata
        metadata TEXT                      -- JSON: source-specific details
      );

      -- ========================================================================
      -- Pyramid Tables (Hierarchical Summarization)
      -- ========================================================================

      -- L0 base chunks (leaf nodes of pyramid)
      CREATE TABLE IF NOT EXISTS pyramid_chunks (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,           -- References content_items.id or conversations.id
        thread_type TEXT NOT NULL,         -- 'conversation', 'post', 'document'

        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        word_count INTEGER NOT NULL,

        -- Structural metadata
        start_offset INTEGER,              -- Character offset in original
        end_offset INTEGER,
        boundary_type TEXT,                -- 'paragraph', 'section', 'semantic'

        -- Embeddings
        embedding BLOB,
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',

        created_at REAL NOT NULL,

        UNIQUE(thread_id, chunk_index)
      );

      -- L1+ summary nodes
      CREATE TABLE IF NOT EXISTS pyramid_summaries (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        level INTEGER NOT NULL,            -- 1 = summarizes chunks, 2 = summarizes L1, etc.

        content TEXT NOT NULL,             -- The summary text
        word_count INTEGER NOT NULL,

        -- Children (what this summary covers)
        child_ids TEXT NOT NULL,           -- JSON array of chunk/summary IDs
        child_type TEXT NOT NULL,          -- 'chunk' or 'summary'

        -- Compression info
        source_word_count INTEGER,         -- Total words of source content
        compression_ratio REAL,            -- source_word_count / word_count

        -- Embeddings
        embedding BLOB,
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',

        -- LLM tracking
        model_used TEXT,                   -- 'claude-3-haiku', etc.

        created_at REAL NOT NULL
      );

      -- Apex summary (one per thread)
      CREATE TABLE IF NOT EXISTS pyramid_apex (
        id TEXT PRIMARY KEY,
        thread_id TEXT UNIQUE NOT NULL,

        -- Core synthesis
        summary TEXT NOT NULL,             -- Full document summary
        themes TEXT,                       -- JSON array of extracted themes

        -- Narrative analysis (optional)
        characters TEXT,                   -- JSON array of key entities/people
        arc TEXT,                          -- Narrative arc description

        -- Stats
        total_chunks INTEGER NOT NULL,
        pyramid_depth INTEGER NOT NULL,    -- How many levels in pyramid
        total_source_words INTEGER NOT NULL,

        -- Embeddings
        embedding BLOB,
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',

        -- LLM tracking
        model_used TEXT,

        created_at REAL NOT NULL,
        updated_at REAL
      );

      -- Indexes for pyramid tables
      CREATE INDEX IF NOT EXISTS idx_pyramid_chunks_thread ON pyramid_chunks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_pyramid_summaries_thread ON pyramid_summaries(thread_id);
      CREATE INDEX IF NOT EXISTS idx_pyramid_summaries_level ON pyramid_summaries(level);
      CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
      CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source);

      -- ========================================================================
      -- Facebook Entity Tables (Relationship Graph)
      -- ========================================================================

      -- People (friends, followers, tagged, mentioned)
      CREATE TABLE IF NOT EXISTS fb_people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        facebook_id TEXT,
        profile_url TEXT,
        is_friend INTEGER DEFAULT 0,
        friend_since REAL,
        is_follower INTEGER DEFAULT 0,
        is_following INTEGER DEFAULT 0,
        interaction_count INTEGER DEFAULT 0,
        tag_count INTEGER DEFAULT 0,
        last_interaction REAL,
        first_interaction REAL,
        relationship_strength REAL,
        created_at REAL NOT NULL,
        updated_at REAL
      );

      -- Places (check-ins, event venues, tagged locations)
      CREATE TABLE IF NOT EXISTS fb_places (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        latitude REAL,
        longitude REAL,
        visit_count INTEGER DEFAULT 0,
        first_visit REAL,
        last_visit REAL,
        place_type TEXT,
        metadata TEXT,
        created_at REAL NOT NULL
      );

      -- Events (attended, hosted, invited)
      CREATE TABLE IF NOT EXISTS fb_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_timestamp REAL,
        end_timestamp REAL,
        place_id TEXT,
        response_type TEXT,
        response_timestamp REAL,
        metadata TEXT,
        created_at REAL NOT NULL,
        FOREIGN KEY (place_id) REFERENCES fb_places(id)
      );

      -- Advertisers and data brokers
      CREATE TABLE IF NOT EXISTS fb_advertisers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        targeting_type TEXT,
        interaction_count INTEGER DEFAULT 0,
        first_seen REAL,
        last_seen REAL,
        is_data_broker INTEGER DEFAULT 0,
        metadata TEXT,
        created_at REAL NOT NULL
      );

      -- Off-Facebook activity (third-party tracking)
      CREATE TABLE IF NOT EXISTS fb_off_facebook_activity (
        id TEXT PRIMARY KEY,
        app_name TEXT NOT NULL,
        event_type TEXT,
        event_count INTEGER DEFAULT 1,
        first_event REAL,
        last_event REAL,
        metadata TEXT,
        created_at REAL NOT NULL
      );

      -- Pages (liked, followed)
      CREATE TABLE IF NOT EXISTS fb_pages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        facebook_id TEXT,
        url TEXT,
        is_liked INTEGER DEFAULT 0,
        liked_at REAL,
        is_following INTEGER DEFAULT 0,
        followed_at REAL,
        page_type TEXT,
        metadata TEXT,
        created_at REAL NOT NULL
      );

      -- Entity relationships (edges in the graph)
      CREATE TABLE IF NOT EXISTS fb_relationships (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        context_type TEXT,
        context_id TEXT,
        timestamp REAL,
        weight REAL DEFAULT 1.0,
        metadata TEXT,
        created_at REAL NOT NULL
      );

      -- Indexes for entity tables
      CREATE INDEX IF NOT EXISTS idx_fb_people_name ON fb_people(name);
      CREATE INDEX IF NOT EXISTS idx_fb_people_friend ON fb_people(is_friend);
      CREATE INDEX IF NOT EXISTS idx_fb_places_name ON fb_places(name);
      CREATE INDEX IF NOT EXISTS idx_fb_places_coords ON fb_places(latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_fb_events_time ON fb_events(start_timestamp);
      CREATE INDEX IF NOT EXISTS idx_fb_advertisers_name ON fb_advertisers(name);
      CREATE INDEX IF NOT EXISTS idx_fb_off_fb_app ON fb_off_facebook_activity(app_name);
      CREATE INDEX IF NOT EXISTS idx_fb_pages_name ON fb_pages(name);
      CREATE INDEX IF NOT EXISTS idx_fb_rel_source ON fb_relationships(source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_fb_rel_target ON fb_relationships(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_fb_rel_type ON fb_relationships(relationship_type);
      CREATE INDEX IF NOT EXISTS idx_fb_rel_context ON fb_relationships(context_type, context_id);
      CREATE INDEX IF NOT EXISTS idx_fb_rel_time ON fb_relationships(timestamp DESC);

      -- ========================================================================
      -- Xanadu-Style Links (Bidirectional) - v7
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY,
        source_uri TEXT NOT NULL,
        target_uri TEXT NOT NULL,
        link_type TEXT NOT NULL,
        link_strength REAL DEFAULT 1.0,
        source_start INTEGER,
        source_end INTEGER,
        target_start INTEGER,
        target_end INTEGER,
        label TEXT,
        created_at REAL NOT NULL,
        created_by TEXT,
        metadata TEXT
      );

      -- ========================================================================
      -- Content-Addressable Media Storage - v7
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        file_path TEXT NOT NULL,
        original_filename TEXT,
        mime_type TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        duration REAL,
        vision_description TEXT,
        transcript TEXT,
        taken_at REAL,
        imported_at REAL NOT NULL,
        embedding BLOB,
        embedding_model TEXT
      );

      -- ========================================================================
      -- Media References - v7
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS media_references (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        media_hash TEXT NOT NULL,
        position INTEGER,
        char_offset INTEGER,
        reference_type TEXT NOT NULL,
        original_pointer TEXT,
        caption TEXT,
        alt_text TEXT,
        created_at REAL NOT NULL,
        FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
      );

      -- ========================================================================
      -- Import Jobs - v7
      -- ========================================================================
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        source_type TEXT NOT NULL,
        source_path TEXT,
        source_name TEXT,
        progress REAL DEFAULT 0,
        current_phase TEXT,
        current_item TEXT,
        units_total INTEGER DEFAULT 0,
        units_processed INTEGER DEFAULT 0,
        media_total INTEGER DEFAULT 0,
        media_processed INTEGER DEFAULT 0,
        links_created INTEGER DEFAULT 0,
        errors_count INTEGER DEFAULT 0,
        created_at REAL NOT NULL,
        started_at REAL,
        completed_at REAL,
        error_log TEXT
      );

      -- Xanadu/v7 Indexes
      CREATE INDEX IF NOT EXISTS idx_links_source_uri ON links(source_uri);
      CREATE INDEX IF NOT EXISTS idx_links_target_uri ON links(target_uri);
      CREATE INDEX IF NOT EXISTS idx_links_type ON links(link_type);
      CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_media_items_hash ON media_items(content_hash);
      CREATE INDEX IF NOT EXISTS idx_media_items_imported ON media_items(imported_at DESC);
      CREATE INDEX IF NOT EXISTS idx_media_items_mime ON media_items(mime_type);
      CREATE INDEX IF NOT EXISTS idx_media_refs_content ON media_references(content_id);
      CREATE INDEX IF NOT EXISTS idx_media_refs_hash ON media_references(media_hash);
      CREATE INDEX IF NOT EXISTS idx_media_refs_pointer ON media_references(original_pointer);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_created ON import_jobs(created_at DESC);
    `);

    // Add uri column to content_items if not exists (v7)
    try {
      this.db.exec('ALTER TABLE content_items ADD COLUMN uri TEXT');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_content_items_uri ON content_items(uri)');
    } catch {
      // Column already exists, ignore
    }

    // Create vec0 virtual tables for vector search (if extension loaded)
    if (this.vecLoaded) {
      this.migrations.createVectorTables();
    }
  }

  // NOTE: createVectorTables() and migrateSchema() methods have been moved to EmbeddingMigrations.ts

  // ===========================================================================
  // Conversation Operations
  // ===========================================================================

  insertConversation(conv: Omit<Conversation, 'isInteresting' | 'summary' | 'summaryEmbeddingId'>): void {
    return this.conversationOps.insertConversation(conv);
  }

  getConversation(id: string): Conversation | null {
    return this.conversationOps.getConversation(id);
  }

  getAllConversations(): Conversation[] {
    return this.conversationOps.getAllConversations();
  }

  getInterestingConversations(): Conversation[] {
    return this.conversationOps.getInterestingConversations();
  }

  markConversationInteresting(id: string, interesting: boolean): void {
    return this.conversationOps.markConversationInteresting(id, interesting);
  }

  updateConversationSummary(id: string, summary: string, embeddingId: string): void {
    return this.conversationOps.updateConversationSummary(id, summary, embeddingId);
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  insertMessage(msg: Omit<Message, 'embeddingId'>): void {
    return this.conversationOps.insertMessage(msg);
  }

  insertMessagesBatch(messages: Omit<Message, 'embeddingId'>[]): void {
    return this.conversationOps.insertMessagesBatch(messages);
  }

  getMessage(id: string): Message | null {
    return this.conversationOps.getMessage(id);
  }

  getMessagesForConversation(conversationId: string): Message[] {
    return this.conversationOps.getMessagesForConversation(conversationId);
  }

  getAllMessages(): Message[] {
    return this.conversationOps.getAllMessages();
  }

  getMessagesWithoutEmbeddings(): Message[] {
    return this.conversationOps.getMessagesWithoutEmbeddings();
  }

  updateMessageEmbeddingId(id: string, embeddingId: string): void {
    return this.conversationOps.updateMessageEmbeddingId(id, embeddingId);
  }

  updateMessageEmbeddingIdsBatch(updates: { id: string; embeddingId: string }[]): void {
    return this.conversationOps.updateMessageEmbeddingIdsBatch(updates);
  }

  // ===========================================================================
  // Chunk Operations
  // ===========================================================================

  insertChunk(chunk: Omit<Chunk, 'embeddingId'>): void {
    return this.conversationOps.insertChunk(chunk);
  }

  insertChunksBatch(chunks: Omit<Chunk, 'embeddingId'>[]): void {
    return this.conversationOps.insertChunksBatch(chunks);
  }

  getChunksForMessage(messageId: string): Chunk[] {
    return this.conversationOps.getChunksForMessage(messageId);
  }

  getChunksByGranularity(granularity: 'paragraph' | 'sentence'): Chunk[] {
    return this.conversationOps.getChunksByGranularity(granularity);
  }

  // ===========================================================================
  // Pyramid Chunk Operations (Content-Type Aware)
  // ===========================================================================

  insertPyramidChunk(chunk: {
    id: string;
    threadId: string;
    threadType: string;
    chunkIndex: number;
    content: string;
    wordCount: number;
    startOffset?: number;
    endOffset?: number;
    boundaryType?: string;
    contentType?: string;
    language?: string;
    contextBefore?: string;
    contextAfter?: string;
    linkedChunkIds?: string[];
  }): void {
    return this.conversationOps.insertPyramidChunk(chunk);
  }

  insertPyramidChunksBatch(chunks: Array<{
    id: string;
    threadId: string;
    threadType: string;
    chunkIndex: number;
    content: string;
    wordCount: number;
    startOffset?: number;
    endOffset?: number;
    boundaryType?: string;
    contentType?: string;
    language?: string;
    contextBefore?: string;
    contextAfter?: string;
    linkedChunkIds?: string[];
  }>): void {
    return this.conversationOps.insertPyramidChunksBatch(chunks);
  }

  getPyramidChunksByContentType(contentType: string): Array<{
    id: string;
    threadId: string;
    content: string;
    contentType: string;
    language?: string;
  }> {
    return this.conversationOps.getPyramidChunksByContentType(contentType);
  }

  searchPyramidChunks(
    queryEmbedding: number[],
    limit: number = 20,
    contentTypes?: string[]
  ): Array<{
    id: string;
    threadId: string;
    content: string;
    contentType: string;
    language?: string;
    similarity: number;
  }> {
    return this.vectorOps.searchPyramidChunks(queryEmbedding, limit, contentTypes);
  }

  updateChunkEmbeddingId(id: string, embeddingId: string): void {
    return this.conversationOps.updateChunkEmbeddingId(id, embeddingId);
  }

  // ===========================================================================
  // User Mark Operations
  // ===========================================================================

  addUserMark(targetType: TargetType, targetId: string, markType: MarkType, note?: string): string {
    return this.conversationOps.addUserMark(targetType, targetId, markType, note);
  }

  removeUserMark(id: string): void {
    return this.conversationOps.removeUserMark(id);
  }

  getUserMarksForTarget(targetType: TargetType, targetId: string): UserMark[] {
    return this.conversationOps.getUserMarksForTarget(targetType, targetId);
  }

  getUserMarksByType(markType: MarkType): UserMark[] {
    return this.conversationOps.getUserMarksByType(markType);
  }

  // ===========================================================================
  // Cluster Operations
  // ===========================================================================

  insertCluster(cluster: Omit<Cluster, 'id' | 'createdAt'>): string {
    return this.conversationOps.insertCluster(cluster);
  }

  getCluster(id: string): Cluster | null {
    return this.conversationOps.getCluster(id);
  }

  getAllClusters(): Cluster[] {
    return this.conversationOps.getAllClusters();
  }

  updateClusterName(id: string, name: string, description?: string): void {
    return this.conversationOps.updateClusterName(id, name, description);
  }

  addClusterMember(clusterId: string, embeddingId: string, distanceToCentroid: number): void {
    return this.conversationOps.addClusterMember(clusterId, embeddingId, distanceToCentroid);
  }

  getClusterMembers(clusterId: string): ClusterMember[] {
    return this.conversationOps.getClusterMembers(clusterId);
  }

  clearClusters(): void {
    return this.conversationOps.clearClusters();
  }

  // ===========================================================================
  // Anchor Operations
  // ===========================================================================

  insertAnchor(anchor: Omit<Anchor, 'id' | 'createdAt'>): string {
    return this.conversationOps.insertAnchor(anchor);
  }

  getAnchor(id: string): Anchor | null {
    return this.conversationOps.getAnchor(id);
  }

  getAllAnchors(): Anchor[] {
    return this.conversationOps.getAllAnchors();
  }

  getAnchorsByType(anchorType: AnchorType): Anchor[] {
    return this.conversationOps.getAnchorsByType(anchorType);
  }

  deleteAnchor(id: string): void {
    return this.conversationOps.deleteAnchor(id);
  }

  // ===========================================================================
  // Vector Operations (sqlite-vec) - Delegated to VectorOperations
  // ===========================================================================

  insertSummaryEmbedding(id: string, conversationId: string, embedding: number[]): void {
    return this.vectorOps.insertSummaryEmbedding(id, conversationId, embedding);
  }

  insertMessageEmbedding(id: string, conversationId: string, messageId: string, role: string, embedding: number[]): void {
    return this.vectorOps.insertMessageEmbedding(id, conversationId, messageId, role, embedding);
  }

  insertMessageEmbeddingsBatch(items: Array<{
    id: string;
    conversationId: string;
    messageId: string;
    role: string;
    embedding: number[];
  }>): void {
    return this.vectorOps.insertMessageEmbeddingsBatch(items);
  }

  insertParagraphEmbedding(id: string, conversationId: string, messageId: string, chunkIndex: number, embedding: number[]): void {
    return this.vectorOps.insertParagraphEmbedding(id, conversationId, messageId, chunkIndex, embedding);
  }

  insertSentenceEmbedding(id: string, conversationId: string, messageId: string, chunkIndex: number, sentenceIndex: number, embedding: number[]): void {
    return this.vectorOps.insertSentenceEmbedding(id, conversationId, messageId, chunkIndex, sentenceIndex, embedding);
  }

  insertAnchorEmbedding(id: string, anchorType: AnchorType, name: string, embedding: number[]): void {
    return this.vectorOps.insertAnchorEmbedding(id, anchorType, name, embedding);
  }

  insertClusterEmbedding(id: string, clusterId: string, embedding: number[]): void {
    return this.vectorOps.insertClusterEmbedding(id, clusterId, embedding);
  }

  searchMessages(queryEmbedding: number[], limit: number = 20, role?: string): SearchResult[] {
    return this.vectorOps.searchMessages(queryEmbedding, limit, role);
  }

  searchSummaries(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    return this.vectorOps.searchSummaries(queryEmbedding, limit);
  }

  searchParagraphs(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    return this.vectorOps.searchParagraphs(queryEmbedding, limit);
  }

  findSimilarToMessage(embeddingId: string, limit: number = 20, excludeSameConversation: boolean = false): SearchResult[] {
    return this.vectorOps.findSimilarToMessage(embeddingId, limit, excludeSameConversation);
  }

  getEmbedding(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences' | 'anchors' | 'clusters', id: string): number[] | null {
    return this.vectorOps.getEmbedding(table, id);
  }

  getEmbeddings(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences', ids: string[]): Map<string, number[]> {
    return this.vectorOps.getEmbeddings(table, ids);
  }

  getMessagesByEmbeddingIds(
    embeddingIds: string[],
    options: {
      roles?: ('user' | 'assistant' | 'system' | 'tool')[];
      excludeImagePrompts?: boolean;
      excludeShortMessages?: number;
      limit?: number;
      offset?: number;
      groupByConversation?: boolean;
    } = {}
  ): {
    messages: Array<{
      embeddingId: string;
      messageId: string;
      conversationId: string;
      conversationTitle: string;
      role: string;
      content: string;
      createdAt: number;
    }>;
    total: number;
    byConversation?: Map<string, Array<{
      embeddingId: string;
      messageId: string;
      role: string;
      content: string;
      createdAt: number;
    }>>;
  } {
    return this.vectorOps.getMessagesByEmbeddingIds(embeddingIds, options);
  }

  getVectorStats(): {
    summaryCount: number;
    messageCount: number;
    paragraphCount: number;
    sentenceCount: number;
    anchorCount: number;
    clusterCount: number;
  } {
    return this.vectorOps.getVectorStats();
  }

  hasVectorSupport(): boolean {
    return this.vectorOps.hasVectorSupport();
  }

  // ===========================================================================
  // Statistics - Delegated to VectorOperations
  // ===========================================================================

  getStats(): {
    conversationCount: number;
    messageCount: number;
    chunkCount: number;
    interestingCount: number;
    clusterCount: number;
    anchorCount: number;
  } {
    return this.vectorOps.getStats();
  }

  // ===========================================================================
  // Content Items - Delegated to ContentOperations
  // ===========================================================================

  insertContentItem(item: {
    id: string;
    type: string;
    source: string;
    text?: string;
    title?: string;
    created_at: number;
    updated_at?: number;
    author_name?: string;
    author_id?: string;
    is_own_content: boolean;
    parent_id?: string;
    thread_id?: string;
    context?: string;
    file_path?: string;
    media_refs?: string;
    media_count?: number;
    metadata?: string;
    tags?: string;
    search_text?: string;
  }): void {
    return this.contentOps.insertContentItem(item);
  }

  insertContentItemsBatch(items: Array<{
    id: string;
    type: string;
    source: string;
    text?: string;
    title?: string;
    created_at: number;
    updated_at?: number;
    author_name?: string;
    author_id?: string;
    is_own_content: boolean;
    parent_id?: string;
    thread_id?: string;
    context?: string;
    file_path?: string;
    media_refs?: string;
    media_count?: number;
    metadata?: string;
    tags?: string;
    search_text?: string;
  }>): void {
    return this.contentOps.insertContentItemsBatch(items);
  }

  getContentItem(id: string): Record<string, unknown> | null {
    return this.contentOps.getContentItem(id);
  }

  getContentItemsBySource(source: string): Record<string, unknown>[] {
    return this.contentOps.getContentItemsBySource(source);
  }

  getContentItemsByType(type: string): Record<string, unknown>[] {
    return this.contentOps.getContentItemsByType(type);
  }

  insertContentItemEmbedding(
    id: string,
    contentItemId: string,
    type: string,
    source: string,
    embedding: number[]
  ): void {
    return this.contentOps.insertContentItemEmbedding(id, contentItemId, type, source, embedding);
  }

  searchContentItems(
    queryEmbedding: number[],
    limit: number = 20,
    type?: string,
    source?: string
  ): Array<{ id: string; content_item_id: string; type: string; source: string; distance: number }> {
    return this.contentOps.searchContentItems(queryEmbedding, limit, type, source);
  }

  // ===========================================================================
  // Reactions - Delegated to ContentOperations
  // ===========================================================================

  insertReaction(reaction: {
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }): void {
    return this.contentOps.insertReaction(reaction);
  }

  insertReactionsBatch(reactions: Array<{
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }>): void {
    return this.contentOps.insertReactionsBatch(reactions);
  }

  getReactionsForContentItem(contentItemId: string): Record<string, unknown>[] {
    return this.contentOps.getReactionsForContentItem(contentItemId);
  }

  // ===========================================================================
  // Content Blocks - Delegated to ContentOperations and VectorOperations
  // ===========================================================================

  insertContentBlock(block: {
    id: string;
    parentMessageId: string;
    parentConversationId: string;
    blockType: string;
    language?: string;
    content: string;
    startOffset?: number;
    endOffset?: number;
    conversationTitle?: string;
    gizmoId?: string;
    createdAt?: number;
    metadata?: string;
    embeddingId?: string;
  }): void {
    return this.contentOps.insertContentBlock(block);
  }

  insertContentBlockEmbedding(
    id: string,
    blockId: string,
    blockType: string,
    gizmoId: string | undefined,
    embedding: number[]
  ): void {
    return this.vectorOps.insertContentBlockEmbedding(id, blockId, blockType, gizmoId, embedding);
  }

  searchContentBlocks(
    queryEmbedding: number[],
    limit: number = 20,
    blockType?: string,
    gizmoId?: string
  ): Array<{
    id: string;
    blockId: string;
    blockType: string;
    content: string;
    language?: string;
    conversationTitle?: string;
    similarity: number;
  }> {
    return this.vectorOps.searchContentBlocks(queryEmbedding, limit, blockType, gizmoId);
  }

  getContentBlocksByType(blockType: string, limit: number = 100): Array<{
    id: string;
    parentConversationId: string;
    content: string;
    language?: string;
    conversationTitle?: string;
    createdAt?: number;
  }> {
    return this.contentOps.getContentBlocksByType(blockType, limit);
  }

  getContentBlocksByGizmo(gizmoId: string, limit: number = 100): Array<{
    id: string;
    blockType: string;
    content: string;
    conversationTitle?: string;
    createdAt?: number;
  }> {
    return this.contentOps.getContentBlocksByGizmo(gizmoId, limit);
  }

  // ===========================================================================
  // Import Tracking - Delegated to ContentOperations
  // ===========================================================================

  createImport(params: {
    id: string;
    source: string;
    sourcePath?: string;
    metadata?: Record<string, unknown>;
  }): void {
    return this.contentOps.createImport(params);
  }

  startImport(id: string): void {
    return this.contentOps.startImport(id);
  }

  completeImport(id: string, stats: {
    threadCount: number;
    messageCount: number;
    mediaCount: number;
    totalWords: number;
  }): void {
    return this.contentOps.completeImport(id, stats);
  }

  failImport(id: string, errorMessage: string): void {
    return this.contentOps.failImport(id, errorMessage);
  }

  getImport(id: string): Record<string, unknown> | null {
    return this.contentOps.getImport(id);
  }

  getImportsByStatus(status: string): Record<string, unknown>[] {
    return this.contentOps.getImportsByStatus(status);
  }

  getAllImports(): Record<string, unknown>[] {
    return this.contentOps.getAllImports();
  }

  deleteImport(id: string): boolean {
    return this.contentOps.deleteImport(id);
  }

  // ===========================================================================
  // Database Access (for PyramidService)
  // ===========================================================================

  /**
   * Get the underlying database instance for use by other services
   * (e.g., PyramidService that needs to share the same database)
   */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ===========================================================================
  // Facebook Entity Graph - Delegated to FacebookOperations
  // ===========================================================================

  insertFbPerson(person: {
    id: string;
    name: string;
    facebook_id?: string;
    profile_url?: string;
    is_friend: number;
    friend_since?: number;
    is_follower: number;
    is_following: number;
    interaction_count: number;
    tag_count: number;
    last_interaction?: number;
    first_interaction?: number;
    relationship_strength?: number;
    created_at: number;
    updated_at?: number;
  }): void {
    return this.facebookOps.insertFbPerson(person);
  }

  insertFbPeopleBatch(people: Array<{
    id: string;
    name: string;
    facebook_id?: string;
    profile_url?: string;
    is_friend: boolean;
    friend_since?: number;
    is_follower: boolean;
    is_following: boolean;
    interaction_count: number;
    tag_count: number;
    last_interaction?: number;
    first_interaction?: number;
    relationship_strength?: number;
    created_at: number;
    updated_at?: number;
  }>): number {
    return this.facebookOps.insertFbPeopleBatch(people);
  }

  insertFbPlace(place: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    visit_count: number;
    first_visit?: number;
    last_visit?: number;
    place_type?: string;
    metadata?: string;
    created_at: number;
  }): void {
    return this.facebookOps.insertFbPlace(place);
  }

  insertFbPlacesBatch(places: Array<{
    id: string;
    name: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    visit_count: number;
    first_visit?: number;
    last_visit?: number;
    place_type?: string;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    return this.facebookOps.insertFbPlacesBatch(places);
  }

  insertFbEvent(event: {
    id: string;
    name: string;
    start_timestamp?: number;
    end_timestamp?: number;
    place_id?: string;
    response_type?: string;
    response_timestamp?: number;
    metadata?: string;
    created_at: number;
  }): void {
    return this.facebookOps.insertFbEvent(event);
  }

  insertFbEventsBatch(events: Array<{
    id: string;
    name: string;
    start_timestamp?: number;
    end_timestamp?: number;
    place_id?: string;
    response_type?: string;
    response_timestamp?: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    return this.facebookOps.insertFbEventsBatch(events);
  }

  insertFbAdvertiser(advertiser: {
    id: string;
    name: string;
    targeting_type?: string;
    interaction_count: number;
    first_seen?: number;
    last_seen?: number;
    is_data_broker: number;
    metadata?: string;
    created_at: number;
  }): void {
    return this.facebookOps.insertFbAdvertiser(advertiser);
  }

  insertFbAdvertisersBatch(advertisers: Array<{
    id: string;
    name: string;
    targeting_type?: string;
    interaction_count: number;
    first_seen?: number;
    last_seen?: number;
    is_data_broker: boolean;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    return this.facebookOps.insertFbAdvertisersBatch(advertisers);
  }

  insertFbOffFacebookActivity(activity: {
    id: string;
    app_name: string;
    event_type?: string;
    event_count: number;
    first_event?: number;
    last_event?: number;
    metadata?: string;
    created_at: number;
  }): void {
    return this.facebookOps.insertFbOffFacebookActivity(activity);
  }

  insertFbOffFacebookBatch(activities: Array<{
    id: string;
    app_name: string;
    event_type?: string;
    event_count: number;
    first_event?: number;
    last_event?: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    return this.facebookOps.insertFbOffFacebookBatch(activities);
  }

  // Query methods for entities - delegated
  getFbPeople(options?: { isFriend?: boolean; limit?: number }): Record<string, unknown>[] {
    return this.facebookOps.getFbPeople(options);
  }

  getFbPlaces(options?: { limit?: number }): Record<string, unknown>[] {
    return this.facebookOps.getFbPlaces(options);
  }

  getFbEvents(options?: { responseType?: string; limit?: number }): Record<string, unknown>[] {
    return this.facebookOps.getFbEvents(options);
  }

  getFbAdvertisers(options?: { isDataBroker?: boolean; limit?: number }): Record<string, unknown>[] {
    return this.facebookOps.getFbAdvertisers(options);
  }

  getFbOffFacebookActivity(options?: { limit?: number }): Record<string, unknown>[] {
    return this.facebookOps.getFbOffFacebookActivity(options);
  }

  getEntityStats(): {
    people: number;
    places: number;
    events: number;
    advertisers: number;
    offFacebook: number;
    dataBrokers: number;
  } {
    return this.facebookOps.getEntityStats();
  }

  // ===========================================================================
  // Relationship Operations - Delegated to FacebookOperations
  // ===========================================================================

  insertFbRelationship(rel: {
    id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relationship_type: string;
    context_type?: string;
    context_id?: string;
    timestamp?: number;
    weight: number;
    metadata?: string;
    created_at: number;
  }): void {
    return this.facebookOps.insertFbRelationship(rel);
  }

  insertFbRelationshipsBatch(relationships: Array<{
    id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relationship_type: string;
    context_type?: string;
    context_id?: string;
    timestamp?: number;
    weight: number;
    metadata?: Record<string, unknown>;
    created_at: number;
  }>): number {
    return this.facebookOps.insertFbRelationshipsBatch(relationships);
  }

  getFbRelationships(options?: {
    sourceType?: string;
    sourceId?: string;
    targetType?: string;
    targetId?: string;
    relationshipType?: string;
    limit?: number;
  }): Record<string, unknown>[] {
    return this.facebookOps.getFbRelationships(options);
  }

  getFbPersonConnections(personId: string, options?: { limit?: number }): Array<{
    person: Record<string, unknown>;
    relationship_type: string;
    weight: number;
    timestamp?: number;
    direction: 'outgoing' | 'incoming';
  }> {
    return this.facebookOps.getFbPersonConnections(personId, options);
  }

  getTopConnectedPeople(options?: { limit?: number }): Array<{
    person: Record<string, unknown>;
    total_weight: number;
    relationship_count: number;
  }> {
    return this.facebookOps.getTopConnectedPeople(options);
  }

  getRelationshipStats(): {
    totalRelationships: number;
    byType: Record<string, number>;
    avgWeight: number;
    topRelationshipTypes: Array<{ type: string; count: number; avg_weight: number }>;
  } {
    return this.facebookOps.getRelationshipStats();
  }

  updatePersonInteractionStats(): void {
    return this.facebookOps.updatePersonInteractionStats();
  }

  // ===========================================================================
  // Image Analysis Operations - Delegated to FacebookOperations
  // ===========================================================================

  upsertImageAnalysis(analysis: {
    id: string;
    file_path: string;
    file_hash?: string;
    source: string;
    description?: string;
    categories?: string[];
    objects?: string[];
    scene?: string;
    mood?: string;
    model_used?: string;
    confidence?: number;
    processing_time_ms?: number;
    media_file_id?: string;
  }): void {
    return this.facebookOps.upsertImageAnalysis(analysis);
  }

  getImageAnalysisByPath(filePath: string): {
    id: string;
    file_path: string;
    file_hash: string | null;
    source: string;
    description: string | null;
    categories: string[];
    objects: string[];
    scene: string | null;
    mood: string | null;
    model_used: string | null;
    confidence: number | null;
    analyzed_at: number;
  } | null {
    return this.facebookOps.getImageAnalysisByPath(filePath);
  }

  getImageAnalysisById(id: string): {
    id: string;
    file_path: string;
    file_hash: string | null;
    source: string;
    description: string | null;
    categories: string[];
    objects: string[];
    scene: string | null;
    mood: string | null;
    model_used: string | null;
    confidence: number | null;
    processing_time_ms: number | null;
    analyzed_at: number;
  } | null {
    return this.facebookOps.getImageAnalysisById(id);
  }

  searchImagesFTS(query: string, options?: {
    limit?: number;
    source?: string;
  }): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    source: string;
    rank: number;
  }> {
    return this.facebookOps.searchImagesFTS(query, options);
  }

  insertImageEmbedding(data: {
    id: string;
    image_analysis_id: string;
    embedding: Float32Array | number[];
    model: string;
    dimensions: number;
  }): void {
    return this.facebookOps.insertImageEmbedding(data);
  }

  searchImagesByVector(
    queryEmbedding: Float32Array | number[],
    options?: { limit?: number; source?: string }
  ): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    source: string;
    similarity: number;
  }> {
    return this.facebookOps.searchImagesByVector(queryEmbedding, options);
  }

  insertImageDescriptionEmbedding(data: {
    id: string;
    imageAnalysisId: string;
    text: string;
    embedding: Float32Array | number[];
  }): void {
    return this.facebookOps.insertImageDescriptionEmbedding(data);
  }

  searchImageDescriptionsByVector(
    queryEmbedding: Float32Array | number[],
    options?: { limit?: number; source?: string }
  ): Array<{
    id: string;
    imageAnalysisId: string;
    filePath: string;
    description: string;
    source: string;
    similarity: number;
  }> {
    return this.facebookOps.searchImageDescriptionsByVector(queryEmbedding, options);
  }

  getImageAnalysesWithoutDescriptionEmbeddings(limit: number = 100): Array<{
    id: string;
    description: string;
    source: string;
  }> {
    return this.facebookOps.getImageAnalysesWithoutDescriptionEmbeddings(limit);
  }

  getImageDescriptionEmbeddingCount(): number {
    return this.facebookOps.getImageDescriptionEmbeddingCount();
  }

  getUnanalyzedImages(options?: { source?: string; limit?: number }): Array<{
    id: string;
    file_path: string;
    content_item_id: string | null;
  }> {
    return this.facebookOps.getUnanalyzedImages(options);
  }

  getImageAnalysisStats(): {
    total: number;
    bySource: Record<string, number>;
    byScene: Record<string, number>;
    byMood: Record<string, number>;
  } {
    return this.facebookOps.getImageAnalysisStats();
  }

  // ===========================================================================
  // Image Clustering - Delegated to FacebookOperations
  // ===========================================================================

  upsertImageCluster(cluster: {
    id: string;
    cluster_index: number;
    name?: string;
    description?: string;
    representative_image_id?: string;
    image_count: number;
  }): void {
    return this.facebookOps.upsertImageCluster(cluster);
  }

  addImageToCluster(clusterId: string, imageAnalysisId: string, distance: number, isRepresentative = false): void {
    return this.facebookOps.addImageToCluster(clusterId, imageAnalysisId, distance, isRepresentative);
  }

  getImageClusters(): Array<{
    id: string;
    cluster_index: number;
    name: string | null;
    description: string | null;
    image_count: number;
    representative: { id: string; file_path: string; description: string | null } | null;
  }> {
    return this.facebookOps.getImageClusters();
  }

  getClusterImages(clusterId: string): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    distance: number;
    is_representative: boolean;
  }> {
    return this.facebookOps.getClusterImages(clusterId);
  }

  clearImageClusters(): void {
    return this.facebookOps.clearImageClusters();
  }

  // ===========================================================================
  // Xanadu Links (Bidirectional)
  // ===========================================================================
  // Xanadu Links - Delegated to BookOperations
  // ===========================================================================

  insertLink(link: {
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength?: number;
    sourceStart?: number;
    sourceEnd?: number;
    targetStart?: number;
    targetEnd?: number;
    label?: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): void {
    return this.bookOps.insertLink(link);
  }

  getLinksBySource(sourceUri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    label: string | null;
    createdBy: string;
  }> {
    return this.bookOps.getLinksBySource(sourceUri);
  }

  getLinksByTarget(targetUri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    label: string | null;
    createdBy: string;
  }> {
    return this.bookOps.getLinksByTarget(targetUri);
  }

  getLinksBidirectional(uri: string): Array<{
    id: string;
    sourceUri: string;
    targetUri: string;
    linkType: string;
    linkStrength: number;
    direction: 'outgoing' | 'incoming';
  }> {
    return this.bookOps.getLinksBidirectional(uri);
  }

  deleteLink(id: string): void {
    return this.bookOps.deleteLink(id);
  }

  // ===========================================================================
  // Content-Addressable Media Items - Delegated to BookOperations
  // ===========================================================================

  upsertMediaItem(item: {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename?: string;
    mimeType?: string;
    fileSize?: number;
    width?: number;
    height?: number;
    duration?: number;
    takenAt?: number;
  }): { id: string; contentHash: string; isNew: boolean } {
    return this.bookOps.upsertMediaItem(item);
  }

  getMediaByHash(contentHash: string): {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename: string | null;
    mimeType: string | null;
    fileSize: number | null;
  } | null {
    return this.bookOps.getMediaByHash(contentHash);
  }

  getMediaById(id: string): {
    id: string;
    contentHash: string;
    filePath: string;
    originalFilename: string | null;
    mimeType: string | null;
    fileSize: number | null;
    width: number | null;
    height: number | null;
  } | null {
    return this.bookOps.getMediaById(id);
  }

  updateMediaVision(contentHash: string, description: string): void {
    return this.bookOps.updateMediaVision(contentHash, description);
  }

  // ===========================================================================
  // Media References - Delegated to BookOperations
  // ===========================================================================

  insertMediaReference(ref: {
    id: string;
    contentId: string;
    mediaHash: string;
    position?: number;
    charOffset?: number;
    referenceType: string;
    originalPointer?: string;
    caption?: string;
    altText?: string;
  }): void {
    return this.bookOps.insertMediaReference(ref);
  }

  getMediaRefsForContent(contentId: string): Array<{
    id: string;
    mediaHash: string;
    filePath: string;
    position: number | null;
    referenceType: string;
    originalPointer: string | null;
  }> {
    return this.bookOps.getMediaRefsForContent(contentId);
  }

  resolveMediaPointer(originalPointer: string): string | null {
    return this.bookOps.resolveMediaPointer(originalPointer);
  }

  // ===========================================================================
  // Import Jobs - Delegated to BookOperations
  // ===========================================================================

  createImportJob(job: {
    id: string;
    sourceType: string;
    sourcePath?: string;
    sourceName?: string;
  }): void {
    return this.bookOps.createImportJob(job);
  }

  updateImportJob(id: string, updates: {
    status?: string;
    progress?: number;
    currentPhase?: string;
    currentItem?: string;
    unitsTotal?: number;
    unitsProcessed?: number;
    mediaTotal?: number;
    mediaProcessed?: number;
    linksCreated?: number;
    errorsCount?: number;
    startedAt?: number;
    completedAt?: number;
    errorLog?: string[];
  }): void {
    return this.bookOps.updateImportJob(id, updates);
  }

  getImportJob(id: string): {
    id: string;
    status: string;
    sourceType: string;
    sourcePath: string | null;
    sourceName: string | null;
    progress: number;
    currentPhase: string | null;
    currentItem: string | null;
    unitsTotal: number;
    unitsProcessed: number;
    mediaTotal: number;
    mediaProcessed: number;
    linksCreated: number;
    errorsCount: number;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    errorLog: string[];
  } | null {
    return this.bookOps.getImportJob(id);
  }

  getRecentImportJobs(limit = 10): Array<{
    id: string;
    status: string;
    sourceType: string;
    sourceName: string | null;
    progress: number;
    unitsProcessed: number;
    mediaProcessed: number;
    errorsCount: number;
    createdAt: number;
    completedAt: number | null;
  }> {
    return this.bookOps.getRecentImportJobs(limit);
  }

  // ===========================================================================
  // Book Operations - Delegated to BookOperations
  // ===========================================================================

  upsertBook(book: {
    id: string;
    uri: string;
    name: string;
    subtitle?: string;
    author?: string;
    description?: string;
    status?: string;
    bookType?: string;
    personaRefs?: string[];
    styleRefs?: string[];
    sourceRefs?: unknown[];
    threads?: unknown[];
    harvestConfig?: unknown;
    editorial?: unknown;
    thinking?: unknown;
    pyramidId?: string;
    stats?: unknown;
    profile?: unknown;
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    return this.bookOps.upsertBook(book);
  }

  getBook(idOrUri: string): Record<string, unknown> | null {
    return this.bookOps.getBook(idOrUri);
  }

  getAllBooks(includeLibrary = true): Record<string, unknown>[] {
    return this.bookOps.getAllBooks(includeLibrary);
  }

  deleteBook(id: string): void {
    return this.bookOps.deleteBook(id);
  }

  // ===========================================================================
  // Persona Operations - Delegated to BookOperations
  // ===========================================================================

  upsertPersona(persona: {
    id: string;
    uri: string;
    name: string;
    description?: string;
    author?: string;
    voice?: unknown;
    vocabulary?: unknown;
    derivedFrom?: unknown[];
    influences?: unknown[];
    exemplars?: unknown[];
    systemPrompt?: string;
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    return this.bookOps.upsertPersona(persona);
  }

  getPersona(idOrUri: string): Record<string, unknown> | null {
    return this.bookOps.getPersona(idOrUri);
  }

  getAllPersonas(includeLibrary = true): Record<string, unknown>[] {
    return this.bookOps.getAllPersonas(includeLibrary);
  }

  deletePersona(id: string): void {
    return this.bookOps.deletePersona(id);
  }

  // ===========================================================================
  // Style Operations - Delegated to BookOperations
  // ===========================================================================

  upsertStyle(style: {
    id: string;
    uri: string;
    name: string;
    description?: string;
    author?: string;
    characteristics?: unknown;
    structure?: unknown;
    stylePrompt?: string;
    derivedFrom?: unknown[];
    tags?: string[];
    isLibrary?: boolean;
  }): void {
    return this.bookOps.upsertStyle(style);
  }

  getStyle(idOrUri: string): Record<string, unknown> | null {
    return this.bookOps.getStyle(idOrUri);
  }

  getAllStyles(includeLibrary = true): Record<string, unknown>[] {
    return this.bookOps.getAllStyles(includeLibrary);
  }

  deleteStyle(id: string): void {
    return this.bookOps.deleteStyle(id);
  }

  // ===========================================================================
  // Book Passage Operations - Delegated to BookOperations
  // ===========================================================================

  upsertBookPassage(passage: {
    id: string;
    bookId: string;
    sourceRef?: unknown;
    text: string;
    wordCount?: number;
    role?: string;
    harvestedBy?: string;
    threadId?: string;
    curationStatus?: string;
    curationNote?: string;
    chapterId?: string;
    tags?: string[];
  }): void {
    return this.bookOps.upsertBookPassage(passage);
  }

  getBookPassages(bookId: string, curationStatus?: string): Record<string, unknown>[] {
    return this.bookOps.getBookPassages(bookId, curationStatus);
  }

  updatePassageCuration(id: string, status: string, note?: string): void {
    return this.bookOps.updatePassageCuration(id, status, note);
  }

  deleteBookPassage(id: string): void {
    return this.bookOps.deleteBookPassage(id);
  }

  // ===========================================================================
  // Book Chapter Operations - Delegated to BookOperations
  // ===========================================================================

  upsertBookChapter(chapter: {
    id: string;
    bookId: string;
    number: number;
    title: string;
    content?: string;
    wordCount?: number;
    version?: number;
    status?: string;
    epigraph?: unknown;
    sections?: unknown[];
    marginalia?: unknown[];
    metadata?: unknown;
    passageRefs?: string[];
  }): void {
    return this.bookOps.upsertBookChapter(chapter);
  }

  getBookChapters(bookId: string): Record<string, unknown>[] {
    return this.bookOps.getBookChapters(bookId);
  }

  getBookChapter(id: string): Record<string, unknown> | null {
    return this.bookOps.getBookChapter(id);
  }

  deleteBookChapter(id: string): void {
    return this.bookOps.deleteBookChapter(id);
  }

  saveChapterVersion(chapterId: string, version: number, content: string, changes?: string, createdBy?: string): void {
    return this.bookOps.saveChapterVersion(chapterId, version, content, changes, createdBy);
  }

  getChapterVersions(chapterId: string): Record<string, unknown>[] {
    return this.bookOps.getChapterVersions(chapterId);
  }

  // ===========================================================================
  // Harvest Bucket Operations - Delegated to BookOperations
  // ===========================================================================

  upsertHarvestBucket(bucket: {
    id: string;
    bookId: string;
    bookUri: string;
    status?: string;
    queries?: string[];
    candidates?: unknown[];
    approved?: unknown[];
    gems?: unknown[];
    rejected?: unknown[];
    duplicateIds?: string[];
    config?: unknown;
    threadUri?: string;
    stats?: unknown;
    initiatedBy?: string;
    completedAt?: number;
    finalizedAt?: number;
  }): void {
    return this.bookOps.upsertHarvestBucket(bucket);
  }

  getHarvestBucket(id: string): Record<string, unknown> | null {
    return this.bookOps.getHarvestBucket(id);
  }

  getHarvestBucketsForBook(bookUri: string): Record<string, unknown>[] {
    return this.bookOps.getHarvestBucketsForBook(bookUri);
  }

  getAllHarvestBuckets(): Record<string, unknown>[] {
    return this.bookOps.getAllHarvestBuckets();
  }

  deleteHarvestBucket(id: string): void {
    return this.bookOps.deleteHarvestBucket(id);
  }

  // ===========================================================================
  // Narrative Arc Operations - Delegated to BookOperations
  // ===========================================================================

  upsertNarrativeArc(arc: {
    id: string;
    bookId: string;
    bookUri: string;
    thesis: string;
    arcType?: string;
    evaluationStatus?: string;
    evaluationFeedback?: string;
    evaluatedAt?: number;
    proposedBy?: string;
  }): void {
    return this.bookOps.upsertNarrativeArc(arc);
  }

  getNarrativeArc(id: string): Record<string, unknown> | null {
    return this.bookOps.getNarrativeArc(id);
  }

  getNarrativeArcsForBook(bookUri: string): Record<string, unknown>[] {
    return this.bookOps.getNarrativeArcsForBook(bookUri);
  }

  deleteNarrativeArc(id: string): void {
    return this.bookOps.deleteNarrativeArc(id);
  }

  // ===========================================================================
  // Passage Link Operations - Delegated to BookOperations
  // ===========================================================================

  upsertPassageLink(link: {
    id: string;
    chapterId: string;
    passageId: string;
    position: number;
    transformations?: unknown;
    originalText?: string;
    transformedText?: string;
  }): void {
    return this.bookOps.upsertPassageLink(link);
  }

  getPassageLinksForChapter(chapterId: string): Record<string, unknown>[] {
    return this.bookOps.getPassageLinksForChapter(chapterId);
  }

  getPassageLinksForPassage(passageId: string): Record<string, unknown>[] {
    return this.bookOps.getPassageLinksForPassage(passageId);
  }

  deletePassageLink(id: string): void {
    return this.bookOps.deletePassageLink(id);
  }

  // ===========================================================================
  // Raw Database Access
  // ===========================================================================

  /**
   * Get the raw database instance for direct SQL queries
   * Used by routes that need custom queries
   */
  getRawDb(): Database.Database {
    return this.db;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Remove junk embeddings from vec_messages
   * Targets: tool outputs, short content, image placeholders, error tracebacks
   * Returns stats about what was removed
   */
  cleanupJunkEmbeddings(dryRun: boolean = false): {
    totalBefore: number;
    removed: number;
    patterns: Record<string, number>;
  } {
    if (!this.vecLoaded) {
      throw new Error('Vector operations not available');
    }

    // Get total before cleanup
    const totalBefore = (this.db.prepare('SELECT COUNT(*) as count FROM vec_messages').get() as { count: number }).count;

    // Define junk patterns and their SQL conditions
    const patterns: Array<{ name: string; condition: string }> = [
      { name: 'tool_role', condition: "role = 'tool'" },
      { name: 'very_short', condition: 'LENGTH(content) < 30' },
      { name: 'image_placeholder', condition: "content LIKE '%<<ImageDisplay%'" },
      { name: 'error_traceback', condition: "content LIKE '%Traceback%'" },
      { name: 'click_commands', condition: "content LIKE 'click(%' OR content LIKE 'mclick(%'" },
      { name: 'scroll_commands', condition: "content LIKE 'scroll(%'" },
      { name: 'search_calls', condition: "content LIKE 'search(\"%'" },
      { name: 'json_objects', condition: "content LIKE '{\"query\":%' OR content LIKE '{\"type\":%'" },
      { name: 'error_messages', condition: "content LIKE 'Error %' AND LENGTH(content) < 200" },
      { name: 'fetch_errors', condition: "content LIKE '%Failed to fetch%' OR content LIKE '%Timeout fetching%'" },
    ];

    const patternCounts: Record<string, number> = {};
    let totalRemoved = 0;

    for (const pattern of patterns) {
      // Count matches for this pattern
      const countSql = `
        SELECT COUNT(*) as count FROM vec_messages v
        JOIN messages m ON v.message_id = m.id
        WHERE ${pattern.condition}
      `;
      const countResult = this.db.prepare(countSql).get() as { count: number };
      patternCounts[pattern.name] = countResult.count;

      if (!dryRun && countResult.count > 0) {
        // Delete matching embeddings
        const deleteSql = `
          DELETE FROM vec_messages WHERE id IN (
            SELECT v.id FROM vec_messages v
            JOIN messages m ON v.message_id = m.id
            WHERE ${pattern.condition}
          )
        `;
        const result = this.db.prepare(deleteSql).run();
        totalRemoved += result.changes;
      } else if (dryRun) {
        totalRemoved += countResult.count;
      }
    }

    return {
      totalBefore,
      removed: totalRemoved,
      patterns: patternCounts,
    };
  }

  close(): void {
    this.db.close();
  }
}
