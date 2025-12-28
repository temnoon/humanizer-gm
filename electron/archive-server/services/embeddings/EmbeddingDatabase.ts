/**
 * EmbeddingDatabase - SQLite storage for text, references, and vectors
 *
 * Unified storage using SQLite + sqlite-vec for:
 * - Text content (conversations, messages, chunks)
 * - Vector embeddings (384-dim all-MiniLM-L6-v2)
 * - User curation and discovered structures
 *
 * One database per archive for portability.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { v4 as uuidv4 } from 'uuid';
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

const SCHEMA_VERSION = 6;  // Bumped for image vision/analysis tables
const EMBEDDING_DIM = 384;  // all-MiniLM-L6-v2

export class EmbeddingDatabase {
  private db: Database.Database;
  private archivePath: string;
  private vecLoaded: boolean = false;

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    const dbPath = `${archivePath}/.embeddings.db`;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Load sqlite-vec extension for vector operations
    try {
      sqliteVec.load(this.db);
      this.vecLoaded = true;
    } catch (err) {
      console.warn('sqlite-vec extension not loaded:', err);
      // Continue without vector support
    }

    this.initSchema();
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
        this.migrateSchema(currentVersion?.version || 0);
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
        type TEXT NOT NULL,              -- 'post', 'comment', 'photo', 'video', 'message', 'document'
        source TEXT NOT NULL,             -- 'facebook', 'openai', 'claude', 'instagram', 'local'

        -- Content
        text TEXT,                        -- Post text, comment text, message content
        title TEXT,                       -- Optional title

        -- Timestamps
        created_at REAL NOT NULL,         -- Unix timestamp
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
        embedding BLOB,                   -- vec0 embedding (384-dim for all-MiniLM-L6-v2)
        embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',

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
    `);

    // Create vec0 virtual tables for vector search (if extension loaded)
    if (this.vecLoaded) {
      this.createVectorTables();
    }
  }

  private createVectorTables(): void {
    // Summary embeddings (one per conversation)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Message embeddings (one per message)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        message_id TEXT,
        role TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Paragraph embeddings (for interesting conversations)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_paragraphs USING vec0(
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        message_id TEXT,
        chunk_index INTEGER,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Sentence embeddings (for user-selected messages)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_sentences USING vec0(
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        message_id TEXT,
        chunk_index INTEGER,
        sentence_index INTEGER,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Anchor embeddings (computed centroids/anti-centroids)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_anchors USING vec0(
        id TEXT PRIMARY KEY,
        anchor_type TEXT,
        name TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Cluster centroids
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_clusters USING vec0(
        id TEXT PRIMARY KEY,
        cluster_id TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Content item embeddings (Facebook posts, comments, etc.)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_content_items USING vec0(
        id TEXT PRIMARY KEY,
        content_item_id TEXT,
        type TEXT,
        source TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    // Pyramid embeddings (hierarchical summarization)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_chunks USING vec0(
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        chunk_index INTEGER,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_summaries USING vec0(
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        level INTEGER,
        embedding float[${EMBEDDING_DIM}]
      );
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_apex USING vec0(
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        embedding float[${EMBEDDING_DIM}]
      );
    `);
  }

  private migrateSchema(fromVersion: number): void {
    // Migration from version 1 to 2: add vector tables
    if (fromVersion < 2 && this.vecLoaded) {
      this.createVectorTables();
    }

    // Migration from version 2 to 3: add unified content tables
    if (fromVersion < 3) {
      this.db.exec(`
        -- Unified content tables for Facebook posts, comments, photos, etc.
        CREATE TABLE IF NOT EXISTS content_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          source TEXT NOT NULL,
          text TEXT,
          title TEXT,
          created_at REAL NOT NULL,
          updated_at REAL,
          author_name TEXT,
          author_id TEXT,
          is_own_content INTEGER,
          parent_id TEXT,
          thread_id TEXT,
          context TEXT,
          file_path TEXT,
          media_refs TEXT,
          media_count INTEGER DEFAULT 0,
          metadata TEXT,
          tags TEXT,
          embedding BLOB,
          embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
          search_text TEXT,
          FOREIGN KEY (parent_id) REFERENCES content_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS media_files (
          id TEXT PRIMARY KEY,
          content_item_id TEXT,
          file_path TEXT NOT NULL,
          file_name TEXT,
          file_size INTEGER,
          mime_type TEXT,
          type TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          duration INTEGER,
          taken_at REAL,
          uploaded_at REAL,
          caption TEXT,
          location TEXT,
          people_tagged TEXT,
          metadata TEXT,
          embedding BLOB,
          embedding_model TEXT,
          FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS reactions (
          id TEXT PRIMARY KEY,
          content_item_id TEXT NOT NULL,
          reaction_type TEXT NOT NULL,
          reactor_name TEXT,
          reactor_id TEXT,
          created_at REAL NOT NULL,
          FOREIGN KEY (content_item_id) REFERENCES content_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS archive_settings (
          archive_id TEXT PRIMARY KEY,
          settings TEXT NOT NULL,
          created_at REAL NOT NULL
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(type);
        CREATE INDEX IF NOT EXISTS idx_content_source ON content_items(source);
        CREATE INDEX IF NOT EXISTS idx_content_created ON content_items(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_content_author ON content_items(author_name);
        CREATE INDEX IF NOT EXISTS idx_content_thread ON content_items(thread_id);
        CREATE INDEX IF NOT EXISTS idx_content_own ON content_items(is_own_content);
        CREATE INDEX IF NOT EXISTS idx_content_file_path ON content_items(file_path);
        CREATE INDEX IF NOT EXISTS idx_media_content ON media_files(content_item_id);
        CREATE INDEX IF NOT EXISTS idx_media_type ON media_files(type);
        CREATE INDEX IF NOT EXISTS idx_media_taken ON media_files(taken_at DESC);
        CREATE INDEX IF NOT EXISTS idx_reactions_content ON reactions(content_item_id);
        CREATE INDEX IF NOT EXISTS idx_reactions_type ON reactions(reaction_type);
      `);

      // Add vector table for content items if vec extension is loaded
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_content_items USING vec0(
            id TEXT PRIMARY KEY,
            content_item_id TEXT,
            type TEXT,
            source TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
      }
    }

    // Migration from version 3 to 4: add pyramid tables and import tracking
    if (fromVersion < 4) {
      this.db.exec(`
        -- Import tracking
        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_path TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          thread_count INTEGER DEFAULT 0,
          message_count INTEGER DEFAULT 0,
          media_count INTEGER DEFAULT 0,
          total_words INTEGER DEFAULT 0,
          created_at REAL NOT NULL,
          started_at REAL,
          completed_at REAL,
          error_message TEXT,
          metadata TEXT
        );

        -- L0 base chunks
        CREATE TABLE IF NOT EXISTS pyramid_chunks (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          thread_type TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          content TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          start_offset INTEGER,
          end_offset INTEGER,
          boundary_type TEXT,
          embedding BLOB,
          embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
          created_at REAL NOT NULL,
          UNIQUE(thread_id, chunk_index)
        );

        -- L1+ summary nodes
        CREATE TABLE IF NOT EXISTS pyramid_summaries (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          level INTEGER NOT NULL,
          content TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          child_ids TEXT NOT NULL,
          child_type TEXT NOT NULL,
          source_word_count INTEGER,
          compression_ratio REAL,
          embedding BLOB,
          embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
          model_used TEXT,
          created_at REAL NOT NULL
        );

        -- Apex summary
        CREATE TABLE IF NOT EXISTS pyramid_apex (
          id TEXT PRIMARY KEY,
          thread_id TEXT UNIQUE NOT NULL,
          summary TEXT NOT NULL,
          themes TEXT,
          characters TEXT,
          arc TEXT,
          total_chunks INTEGER NOT NULL,
          pyramid_depth INTEGER NOT NULL,
          total_source_words INTEGER NOT NULL,
          embedding BLOB,
          embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2',
          model_used TEXT,
          created_at REAL NOT NULL,
          updated_at REAL
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_pyramid_chunks_thread ON pyramid_chunks(thread_id);
        CREATE INDEX IF NOT EXISTS idx_pyramid_summaries_thread ON pyramid_summaries(thread_id);
        CREATE INDEX IF NOT EXISTS idx_pyramid_summaries_level ON pyramid_summaries(level);
        CREATE INDEX IF NOT EXISTS idx_imports_status ON imports(status);
        CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source);
      `);

      // Add vector tables for pyramid content
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_chunks USING vec0(
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            chunk_index INTEGER,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_summaries USING vec0(
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            level INTEGER,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_pyramid_apex USING vec0(
            id TEXT PRIMARY KEY,
            thread_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
      }
    }

    // Migration from version 4 to 5: add Facebook entity/relationship graph tables
    if (fromVersion < 5) {
      this.db.exec(`
        -- ========================================================================
        -- Facebook Entity Tables (Relationship Graph)
        -- ========================================================================

        -- People (friends, followers, tagged, mentioned)
        CREATE TABLE IF NOT EXISTS fb_people (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          facebook_id TEXT,
          profile_url TEXT,

          -- Relationship to owner
          is_friend INTEGER DEFAULT 0,
          friend_since REAL,
          is_follower INTEGER DEFAULT 0,
          is_following INTEGER DEFAULT 0,

          -- Aggregated metrics (updated as we process content)
          interaction_count INTEGER DEFAULT 0,
          tag_count INTEGER DEFAULT 0,
          last_interaction REAL,
          first_interaction REAL,

          -- Analysis
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

        -- Indexes for relationship graph queries
        CREATE INDEX IF NOT EXISTS idx_fb_rel_source ON fb_relationships(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_fb_rel_target ON fb_relationships(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_fb_rel_type ON fb_relationships(relationship_type);
        CREATE INDEX IF NOT EXISTS idx_fb_rel_context ON fb_relationships(context_type, context_id);
        CREATE INDEX IF NOT EXISTS idx_fb_rel_time ON fb_relationships(timestamp DESC);
      `);
    }

    // Migration from version 5 to 6: add image vision/analysis tables
    if (fromVersion < 6) {
      this.db.exec(`
        -- ========================================================================
        -- Image Vision Analysis Tables
        -- ========================================================================

        -- AI-generated descriptions and classifications for images
        CREATE TABLE IF NOT EXISTS image_analysis (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL UNIQUE,
          file_hash TEXT,
          source TEXT NOT NULL,                -- 'facebook', 'chatgpt', 'gallery', 'imported'

          -- AI Analysis Results
          description TEXT,                    -- Natural language description
          categories TEXT,                     -- JSON array of category tags
          objects TEXT,                        -- JSON array of detected objects
          scene TEXT,                          -- Scene type (indoor, outdoor, etc.)
          mood TEXT,                           -- Emotional tone

          -- Processing metadata
          model_used TEXT,                     -- e.g., 'qwen3-vl:8b', 'llava:13b'
          confidence REAL,
          processing_time_ms INTEGER,

          -- Timestamps
          analyzed_at REAL NOT NULL,
          updated_at REAL,

          -- Link to media_files if available
          media_file_id TEXT,
          FOREIGN KEY (media_file_id) REFERENCES media_files(id) ON DELETE SET NULL
        );

        -- Visual embeddings for similarity search (CLIP vectors, 512-dim)
        CREATE TABLE IF NOT EXISTS image_embeddings (
          id TEXT PRIMARY KEY,
          image_analysis_id TEXT NOT NULL,
          embedding BLOB NOT NULL,             -- Float32 array (512 or 768 dims depending on model)
          model TEXT NOT NULL,                 -- e.g., 'clip-vit-base-patch32'
          dimensions INTEGER NOT NULL,         -- 512 or 768
          created_at REAL NOT NULL,
          FOREIGN KEY (image_analysis_id) REFERENCES image_analysis(id) ON DELETE CASCADE
        );

        -- Image clusters based on visual similarity
        CREATE TABLE IF NOT EXISTS image_clusters (
          id TEXT PRIMARY KEY,
          cluster_index INTEGER NOT NULL,      -- Cluster number from algorithm
          name TEXT,                           -- Optional user-provided name
          description TEXT,                    -- Auto-generated or user description
          representative_image_id TEXT,        -- Best example image
          image_count INTEGER DEFAULT 0,
          created_at REAL NOT NULL,
          updated_at REAL,
          FOREIGN KEY (representative_image_id) REFERENCES image_analysis(id) ON DELETE SET NULL
        );

        -- Image cluster membership
        CREATE TABLE IF NOT EXISTS image_cluster_members (
          cluster_id TEXT NOT NULL,
          image_analysis_id TEXT NOT NULL,
          distance_to_center REAL,             -- Distance to cluster centroid
          is_representative INTEGER DEFAULT 0, -- 1 if this is the representative image
          PRIMARY KEY (cluster_id, image_analysis_id),
          FOREIGN KEY (cluster_id) REFERENCES image_clusters(id) ON DELETE CASCADE,
          FOREIGN KEY (image_analysis_id) REFERENCES image_analysis(id) ON DELETE CASCADE
        );

        -- Full-text search index for image descriptions
        CREATE VIRTUAL TABLE IF NOT EXISTS image_fts USING fts5(
          description,
          categories,
          objects,
          scene,
          content='image_analysis',
          content_rowid='rowid'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS image_fts_insert AFTER INSERT ON image_analysis BEGIN
          INSERT INTO image_fts(rowid, description, categories, objects, scene)
          VALUES (NEW.rowid, NEW.description, NEW.categories, NEW.objects, NEW.scene);
        END;

        CREATE TRIGGER IF NOT EXISTS image_fts_update AFTER UPDATE ON image_analysis BEGIN
          INSERT INTO image_fts(image_fts, rowid, description, categories, objects, scene)
          VALUES ('delete', OLD.rowid, OLD.description, OLD.categories, OLD.objects, OLD.scene);
          INSERT INTO image_fts(rowid, description, categories, objects, scene)
          VALUES (NEW.rowid, NEW.description, NEW.categories, NEW.objects, NEW.scene);
        END;

        CREATE TRIGGER IF NOT EXISTS image_fts_delete AFTER DELETE ON image_analysis BEGIN
          INSERT INTO image_fts(image_fts, rowid, description, categories, objects, scene)
          VALUES ('delete', OLD.rowid, OLD.description, OLD.categories, OLD.objects, OLD.scene);
        END;

        -- Indexes for image tables
        CREATE INDEX IF NOT EXISTS idx_image_analysis_path ON image_analysis(file_path);
        CREATE INDEX IF NOT EXISTS idx_image_analysis_source ON image_analysis(source);
        CREATE INDEX IF NOT EXISTS idx_image_analysis_analyzed ON image_analysis(analyzed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_image_analysis_hash ON image_analysis(file_hash);
        CREATE INDEX IF NOT EXISTS idx_image_embeddings_analysis ON image_embeddings(image_analysis_id);
        CREATE INDEX IF NOT EXISTS idx_image_cluster_members_cluster ON image_cluster_members(cluster_id);
        CREATE INDEX IF NOT EXISTS idx_image_cluster_members_image ON image_cluster_members(image_analysis_id);
      `);

      // Add vector table for image embeddings if vec extension is loaded
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_image_embeddings USING vec0(
            id TEXT PRIMARY KEY,
            image_analysis_id TEXT,
            source TEXT,
            embedding float[512]
          );
        `);
      }
    }

    this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
  }

  // ===========================================================================
  // Conversation Operations
  // ===========================================================================

  insertConversation(conv: Omit<Conversation, 'isInteresting' | 'summary' | 'summaryEmbeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations
      (id, folder, title, created_at, updated_at, message_count, total_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      conv.id,
      conv.folder,
      conv.title,
      conv.createdAt,
      conv.updatedAt,
      conv.messageCount,
      conv.totalTokens
    );
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  getAllConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToConversation);
  }

  getInterestingConversations(): Conversation[] {
    const rows = this.db.prepare('SELECT * FROM conversations WHERE is_interesting = 1 ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToConversation);
  }

  markConversationInteresting(id: string, interesting: boolean): void {
    this.db.prepare('UPDATE conversations SET is_interesting = ? WHERE id = ?').run(interesting ? 1 : 0, id);
  }

  updateConversationSummary(id: string, summary: string, embeddingId: string): void {
    this.db.prepare('UPDATE conversations SET summary = ?, summary_embedding_id = ? WHERE id = ?').run(summary, embeddingId, id);
  }

  private rowToConversation(row: Record<string, unknown>): Conversation {
    return {
      id: row.id as string,
      folder: row.folder as string,
      title: row.title as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      messageCount: row.message_count as number,
      totalTokens: row.total_tokens as number,
      isInteresting: (row.is_interesting as number) === 1,
      summary: row.summary as string | null,
      summaryEmbeddingId: row.summary_embedding_id as string | null,
    };
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  insertMessage(msg: Omit<Message, 'embeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, conversation_id, parent_id, role, content, created_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.conversationId,
      msg.parentId,
      msg.role,
      msg.content,
      msg.createdAt,
      msg.tokenCount
    );
  }

  insertMessagesBatch(messages: Omit<Message, 'embeddingId'>[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, conversation_id, parent_id, role, content, created_at, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((msgs: Omit<Message, 'embeddingId'>[]) => {
      for (const msg of msgs) {
        insert.run(msg.id, msg.conversationId, msg.parentId, msg.role, msg.content, msg.createdAt, msg.tokenCount);
      }
    });

    insertMany(messages);
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToMessage(row);
  }

  getMessagesForConversation(conversationId: string): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as Record<string, unknown>[];
    return rows.map(this.rowToMessage);
  }

  getAllMessages(): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY created_at').all() as Record<string, unknown>[];
    return rows.map(this.rowToMessage);
  }

  getMessagesWithoutEmbeddings(): Message[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE embedding_id IS NULL').all() as Record<string, unknown>[];
    return rows.map(this.rowToMessage);
  }

  updateMessageEmbeddingId(id: string, embeddingId: string): void {
    this.db.prepare('UPDATE messages SET embedding_id = ? WHERE id = ?').run(embeddingId, id);
  }

  updateMessageEmbeddingIdsBatch(updates: { id: string; embeddingId: string }[]): void {
    const update = this.db.prepare('UPDATE messages SET embedding_id = ? WHERE id = ?');
    const updateMany = this.db.transaction((items: { id: string; embeddingId: string }[]) => {
      for (const item of items) {
        update.run(item.embeddingId, item.id);
      }
    });
    updateMany(updates);
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      parentId: row.parent_id as string | null,
      role: row.role as 'user' | 'assistant' | 'system' | 'tool',
      content: row.content as string,
      createdAt: row.created_at as number,
      tokenCount: row.token_count as number,
      embeddingId: row.embedding_id as string | null,
    };
  }

  // ===========================================================================
  // Chunk Operations
  // ===========================================================================

  insertChunk(chunk: Omit<Chunk, 'embeddingId'>): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO chunks
      (id, message_id, chunk_index, content, token_count, granularity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.messageId,
      chunk.chunkIndex,
      chunk.content,
      chunk.tokenCount,
      chunk.granularity
    );
  }

  insertChunksBatch(chunks: Omit<Chunk, 'embeddingId'>[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO chunks
      (id, message_id, chunk_index, content, token_count, granularity)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Omit<Chunk, 'embeddingId'>[]) => {
      for (const chunk of items) {
        insert.run(chunk.id, chunk.messageId, chunk.chunkIndex, chunk.content, chunk.tokenCount, chunk.granularity);
      }
    });

    insertMany(chunks);
  }

  getChunksForMessage(messageId: string): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE message_id = ? ORDER BY chunk_index').all(messageId) as Record<string, unknown>[];
    return rows.map(this.rowToChunk);
  }

  getChunksByGranularity(granularity: 'paragraph' | 'sentence'): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks WHERE granularity = ?').all(granularity) as Record<string, unknown>[];
    return rows.map(this.rowToChunk);
  }

  updateChunkEmbeddingId(id: string, embeddingId: string): void {
    this.db.prepare('UPDATE chunks SET embedding_id = ? WHERE id = ?').run(embeddingId, id);
  }

  private rowToChunk(row: Record<string, unknown>): Chunk {
    return {
      id: row.id as string,
      messageId: row.message_id as string,
      chunkIndex: row.chunk_index as number,
      content: row.content as string,
      tokenCount: row.token_count as number,
      embeddingId: row.embedding_id as string | null,
      granularity: row.granularity as 'paragraph' | 'sentence',
    };
  }

  // ===========================================================================
  // User Mark Operations
  // ===========================================================================

  addUserMark(targetType: TargetType, targetId: string, markType: MarkType, note?: string): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO user_marks (id, target_type, target_id, mark_type, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, targetType, targetId, markType, note || null, Date.now() / 1000);
    return id;
  }

  removeUserMark(id: string): void {
    this.db.prepare('DELETE FROM user_marks WHERE id = ?').run(id);
  }

  getUserMarksForTarget(targetType: TargetType, targetId: string): UserMark[] {
    const rows = this.db.prepare('SELECT * FROM user_marks WHERE target_type = ? AND target_id = ?').all(targetType, targetId) as Record<string, unknown>[];
    return rows.map(this.rowToUserMark);
  }

  getUserMarksByType(markType: MarkType): UserMark[] {
    const rows = this.db.prepare('SELECT * FROM user_marks WHERE mark_type = ?').all(markType) as Record<string, unknown>[];
    return rows.map(this.rowToUserMark);
  }

  private rowToUserMark(row: Record<string, unknown>): UserMark {
    return {
      id: row.id as string,
      targetType: row.target_type as TargetType,
      targetId: row.target_id as string,
      markType: row.mark_type as MarkType,
      note: row.note as string | null,
      createdAt: row.created_at as number,
    };
  }

  // ===========================================================================
  // Cluster Operations
  // ===========================================================================

  insertCluster(cluster: Omit<Cluster, 'id' | 'createdAt'>): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO clusters (id, name, description, centroid_embedding_id, member_count, coherence_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, cluster.name, cluster.description, cluster.centroidEmbeddingId, cluster.memberCount, cluster.coherenceScore, Date.now() / 1000);
    return id;
  }

  getCluster(id: string): Cluster | null {
    const row = this.db.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToCluster(row);
  }

  getAllClusters(): Cluster[] {
    const rows = this.db.prepare('SELECT * FROM clusters ORDER BY coherence_score DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToCluster);
  }

  updateClusterName(id: string, name: string, description?: string): void {
    this.db.prepare('UPDATE clusters SET name = ?, description = ? WHERE id = ?').run(name, description || null, id);
  }

  addClusterMember(clusterId: string, embeddingId: string, distanceToCentroid: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO cluster_members (cluster_id, embedding_id, distance_to_centroid)
      VALUES (?, ?, ?)
    `).run(clusterId, embeddingId, distanceToCentroid);
  }

  getClusterMembers(clusterId: string): ClusterMember[] {
    const rows = this.db.prepare('SELECT * FROM cluster_members WHERE cluster_id = ? ORDER BY distance_to_centroid').all(clusterId) as Record<string, unknown>[];
    return rows.map(row => ({
      clusterId: row.cluster_id as string,
      embeddingId: row.embedding_id as string,
      distanceToCentroid: row.distance_to_centroid as number,
    }));
  }

  clearClusters(): void {
    this.db.exec('DELETE FROM cluster_members; DELETE FROM clusters;');
  }

  private rowToCluster(row: Record<string, unknown>): Cluster {
    return {
      id: row.id as string,
      name: row.name as string | null,
      description: row.description as string | null,
      centroidEmbeddingId: row.centroid_embedding_id as string | null,
      memberCount: row.member_count as number,
      coherenceScore: row.coherence_score as number,
      createdAt: row.created_at as number,
    };
  }

  // ===========================================================================
  // Anchor Operations
  // ===========================================================================

  insertAnchor(anchor: Omit<Anchor, 'id' | 'createdAt'>): string {
    const id = uuidv4();
    const embeddingBlob = Buffer.from(new Float32Array(anchor.embedding).buffer);
    const sourceIdsJson = JSON.stringify(anchor.sourceEmbeddingIds);

    this.db.prepare(`
      INSERT INTO anchors (id, name, description, anchor_type, embedding, source_embedding_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, anchor.name, anchor.description, anchor.anchorType, embeddingBlob, sourceIdsJson, Date.now() / 1000);
    return id;
  }

  getAnchor(id: string): Anchor | null {
    const row = this.db.prepare('SELECT * FROM anchors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToAnchor(row);
  }

  getAllAnchors(): Anchor[] {
    const rows = this.db.prepare('SELECT * FROM anchors ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(this.rowToAnchor);
  }

  getAnchorsByType(anchorType: AnchorType): Anchor[] {
    const rows = this.db.prepare('SELECT * FROM anchors WHERE anchor_type = ?').all(anchorType) as Record<string, unknown>[];
    return rows.map(this.rowToAnchor);
  }

  deleteAnchor(id: string): void {
    this.db.prepare('DELETE FROM anchors WHERE id = ?').run(id);
  }

  private rowToAnchor(row: Record<string, unknown>): Anchor {
    const embeddingBlob = row.embedding as Buffer;
    const embedding = Array.from(new Float32Array(embeddingBlob.buffer, embeddingBlob.byteOffset, embeddingBlob.byteLength / 4));
    const sourceIds = JSON.parse(row.source_embedding_ids as string) as string[];

    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string | null,
      anchorType: row.anchor_type as AnchorType,
      embedding,
      sourceEmbeddingIds: sourceIds,
      createdAt: row.created_at as number,
    };
  }

  // ===========================================================================
  // Vector Operations (sqlite-vec)
  // ===========================================================================

  /**
   * Convert a number array to the JSON format expected by vec0
   */
  private embeddingToJson(embedding: number[]): string {
    return JSON.stringify(embedding);
  }

  /**
   * Convert binary buffer from sqlite-vec to number array
   * sqlite-vec stores vectors as Float32Array binary blobs
   */
  private embeddingFromBinary(data: Buffer | string): number[] {
    if (typeof data === 'string') {
      // If it's still JSON (shouldn't happen but handle gracefully)
      return JSON.parse(data);
    }
    // Convert binary buffer to Float32Array
    const floats = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
    return Array.from(floats);
  }

  /**
   * Insert a summary embedding
   */
  insertSummaryEmbedding(id: string, conversationId: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_summaries (id, conversation_id, embedding)
      VALUES (?, ?, ?)
    `).run(id, conversationId, this.embeddingToJson(embedding));
  }

  /**
   * Insert a message embedding
   */
  insertMessageEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    role: string,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_messages (id, conversation_id, message_id, role, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, role, this.embeddingToJson(embedding));
  }

  /**
   * Insert message embeddings in batch (more efficient)
   */
  insertMessageEmbeddingsBatch(
    items: Array<{
      id: string;
      conversationId: string;
      messageId: string;
      role: string;
      embedding: number[];
    }>
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const insert = this.db.prepare(`
      INSERT INTO vec_messages (id, conversation_id, message_id, role, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: Array<{
      id: string;
      conversationId: string;
      messageId: string;
      role: string;
      embedding: number[];
    }>) => {
      for (const item of items) {
        insert.run(
          item.id,
          item.conversationId,
          item.messageId,
          item.role,
          this.embeddingToJson(item.embedding)
        );
      }
    });

    insertMany(items);
  }

  /**
   * Insert a paragraph embedding
   */
  insertParagraphEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    chunkIndex: number,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_paragraphs (id, conversation_id, message_id, chunk_index, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, chunkIndex, this.embeddingToJson(embedding));
  }

  /**
   * Insert a sentence embedding
   */
  insertSentenceEmbedding(
    id: string,
    conversationId: string,
    messageId: string,
    chunkIndex: number,
    sentenceIndex: number,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_sentences (id, conversation_id, message_id, chunk_index, sentence_index, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, messageId, chunkIndex, sentenceIndex, this.embeddingToJson(embedding));
  }

  /**
   * Insert an anchor embedding
   */
  insertAnchorEmbedding(id: string, anchorType: AnchorType, name: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_anchors (id, anchor_type, name, embedding)
      VALUES (?, ?, ?, ?)
    `).run(id, anchorType, name, this.embeddingToJson(embedding));
  }

  /**
   * Insert a cluster centroid embedding
   */
  insertClusterEmbedding(id: string, clusterId: string, embedding: number[]): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT INTO vec_clusters (id, cluster_id, embedding)
      VALUES (?, ?, ?)
    `).run(id, clusterId, this.embeddingToJson(embedding));
  }

  /**
   * Search for similar messages by embedding
   */
  searchMessages(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const results = this.db.prepare(`
      SELECT
        vec_messages.id,
        vec_messages.conversation_id,
        vec_messages.message_id,
        vec_messages.role,
        vec_messages.distance,
        messages.content,
        conversations.title as conversation_title,
        conversations.folder as conversation_folder
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      JOIN conversations ON conversations.id = vec_messages.conversation_id
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(this.embeddingToJson(queryEmbedding), limit) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),  // Convert distance to similarity
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        role: row.role,
      },
      conversationId: row.conversation_id as string,
      conversationFolder: row.conversation_folder as string,  // Folder name for loading conversation
      conversationTitle: row.conversation_title as string,
      messageRole: row.role as string,
    }));
  }

  /**
   * Search for similar summaries by embedding
   */
  searchSummaries(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const results = this.db.prepare(`
      SELECT
        vec_summaries.id,
        vec_summaries.conversation_id,
        vec_summaries.distance,
        conversations.title,
        conversations.summary as content
      FROM vec_summaries
      JOIN conversations ON conversations.id = vec_summaries.conversation_id
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(this.embeddingToJson(queryEmbedding), limit) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string || row.title as string,
      similarity: 1 - (row.distance as number),
      metadata: { title: row.title },
      conversationId: row.conversation_id as string,
      conversationTitle: row.title as string,
    }));
  }

  /**
   * Search for similar paragraphs
   */
  searchParagraphs(queryEmbedding: number[], limit: number = 20): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const results = this.db.prepare(`
      SELECT
        vec_paragraphs.id,
        vec_paragraphs.conversation_id,
        vec_paragraphs.message_id,
        vec_paragraphs.chunk_index,
        vec_paragraphs.distance,
        chunks.content,
        conversations.title as conversation_title
      FROM vec_paragraphs
      JOIN chunks ON chunks.id = vec_paragraphs.id
      JOIN conversations ON conversations.id = vec_paragraphs.conversation_id
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(this.embeddingToJson(queryEmbedding), limit) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        chunkIndex: row.chunk_index,
      },
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
    }));
  }

  /**
   * Find messages similar to a given message embedding ID
   */
  findSimilarToMessage(embeddingId: string, limit: number = 20, excludeSameConversation: boolean = false): SearchResult[] {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    // Get the embedding for the source message
    const source = this.db.prepare(`
      SELECT embedding, conversation_id FROM vec_messages WHERE id = ?
    `).get(embeddingId) as { embedding: string; conversation_id: string } | undefined;

    if (!source) return [];

    let query = `
      SELECT
        vec_messages.id,
        vec_messages.conversation_id,
        vec_messages.message_id,
        vec_messages.role,
        vec_messages.distance,
        messages.content,
        conversations.title as conversation_title
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      JOIN conversations ON conversations.id = vec_messages.conversation_id
      WHERE embedding MATCH ? AND k = ?
        AND vec_messages.id != ?
    `;

    if (excludeSameConversation) {
      query += ` AND vec_messages.conversation_id != ?`;
    }

    query += ` ORDER BY distance`;

    const params = excludeSameConversation
      ? [source.embedding, limit + 1, embeddingId, source.conversation_id]  // +1 to account for filtering
      : [source.embedding, limit + 1, embeddingId];

    const results = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    return results.map(row => ({
      id: row.id as string,
      content: row.content as string,
      similarity: 1 - (row.distance as number),
      metadata: {
        conversationId: row.conversation_id,
        messageId: row.message_id,
        role: row.role,
      },
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
      messageRole: row.role as string,
    })).slice(0, limit);  // Limit after filtering
  }

  /**
   * Get an embedding vector by ID from any vec table
   */
  getEmbedding(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences' | 'anchors' | 'clusters', id: string): number[] | null {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const tableName = `vec_${table}`;
    const row = this.db.prepare(`SELECT embedding FROM ${tableName} WHERE id = ?`).get(id) as { embedding: Buffer | string } | undefined;
    if (!row) return null;

    return this.embeddingFromBinary(row.embedding);
  }

  /**
   * Get multiple embeddings by IDs
   */
  getEmbeddings(table: 'messages' | 'summaries' | 'paragraphs' | 'sentences', ids: string[]): Map<string, number[]> {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    const tableName = `vec_${table}`;
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT id, embedding FROM ${tableName} WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; embedding: Buffer | string }>;

    const result = new Map<string, number[]>();
    for (const row of rows) {
      result.set(row.id, this.embeddingFromBinary(row.embedding));
    }
    return result;
  }

  /**
   * Get messages by embedding IDs with optional filters
   * Used for cluster member retrieval with filtering
   */
  getMessagesByEmbeddingIds(
    embeddingIds: string[],
    options: {
      roles?: ('user' | 'assistant' | 'system' | 'tool')[];
      excludeImagePrompts?: boolean;
      excludeShortMessages?: number; // exclude messages shorter than N chars
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
    if (embeddingIds.length === 0) {
      return { messages: [], total: 0 };
    }

    // Build query with filters
    const placeholders = embeddingIds.map(() => '?').join(',');
    let whereClause = `vec_messages.id IN (${placeholders})`;
    const params: (string | number)[] = [...embeddingIds];

    // Role filter
    if (options.roles && options.roles.length > 0) {
      const rolePlaceholders = options.roles.map(() => '?').join(',');
      whereClause += ` AND vec_messages.role IN (${rolePlaceholders})`;
      params.push(...options.roles);
    }

    // First get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      WHERE ${whereClause}
    `;
    const countResult = this.db.prepare(countQuery).get(...params) as { total: number };
    let total = countResult.total;

    // Now get the actual data
    let query = `
      SELECT
        vec_messages.id as embedding_id,
        vec_messages.message_id,
        vec_messages.conversation_id,
        vec_messages.role,
        messages.content,
        messages.created_at,
        conversations.title as conversation_title
      FROM vec_messages
      JOIN messages ON messages.id = vec_messages.message_id
      JOIN conversations ON conversations.id = vec_messages.conversation_id
      WHERE ${whereClause}
      ORDER BY messages.created_at DESC
    `;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }
    if (options.offset) {
      query += ` OFFSET ?`;
      params.push(options.offset);
    }

    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    // Apply content-based filters in JS (more flexible)
    let messages = rows.map(row => ({
      embeddingId: row.embedding_id as string,
      messageId: row.message_id as string,
      conversationId: row.conversation_id as string,
      conversationTitle: row.conversation_title as string,
      role: row.role as string,
      content: row.content as string,
      createdAt: row.created_at as number,
    }));

    // Filter out image generation prompts (DALL-E style prompts)
    if (options.excludeImagePrompts) {
      const imagePromptPatterns = [
        /^(create|generate|draw|make|design|paint|illustrate)\s+(an?\s+)?(image|picture|photo|illustration|art|artwork|drawing)/i,
        /^(show me|can you (create|draw|make))/i,
        /\bDALL[-·]?E\b/i,
        /^(a |an )?[\w\s,]+\b(in the style of|digital art|oil painting|watercolor|photograph|3d render)/i,
      ];

      const beforeFilter = messages.length;
      messages = messages.filter(m => {
        const content = m.content.trim();
        return !imagePromptPatterns.some(pattern => pattern.test(content));
      });
      total -= (beforeFilter - messages.length);
    }

    // Filter short messages
    if (options.excludeShortMessages && options.excludeShortMessages > 0) {
      const beforeFilter = messages.length;
      messages = messages.filter(m => m.content.length >= options.excludeShortMessages!);
      total -= (beforeFilter - messages.length);
    }

    // Group by conversation if requested
    if (options.groupByConversation) {
      const byConversation = new Map<string, Array<{
        embeddingId: string;
        messageId: string;
        role: string;
        content: string;
        createdAt: number;
      }>>();

      for (const msg of messages) {
        const key = msg.conversationId;
        if (!byConversation.has(key)) {
          byConversation.set(key, []);
        }
        byConversation.get(key)!.push({
          embeddingId: msg.embeddingId,
          messageId: msg.messageId,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt,
        });
      }

      return { messages, total, byConversation };
    }

    return { messages, total };
  }

  /**
   * Get vector statistics
   */
  getVectorStats(): {
    summaryCount: number;
    messageCount: number;
    paragraphCount: number;
    sentenceCount: number;
    anchorCount: number;
    clusterCount: number;
  } {
    if (!this.vecLoaded) {
      return { summaryCount: 0, messageCount: 0, paragraphCount: 0, sentenceCount: 0, anchorCount: 0, clusterCount: 0 };
    }

    const summaryCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_summaries').get() as { count: number };
    const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_messages').get() as { count: number };
    const paragraphCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_paragraphs').get() as { count: number };
    const sentenceCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_sentences').get() as { count: number };
    const anchorCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_anchors').get() as { count: number };
    const clusterCount = this.db.prepare('SELECT COUNT(*) as count FROM vec_clusters').get() as { count: number };

    return {
      summaryCount: summaryCount.count,
      messageCount: messageCount.count,
      paragraphCount: paragraphCount.count,
      sentenceCount: sentenceCount.count,
      anchorCount: anchorCount.count,
      clusterCount: clusterCount.count,
    };
  }

  /**
   * Check if vector operations are available
   */
  hasVectorSupport(): boolean {
    return this.vecLoaded;
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  getStats(): {
    conversationCount: number;
    messageCount: number;
    chunkCount: number;
    interestingCount: number;
    clusterCount: number;
    anchorCount: number;
  } {
    const convCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number };
    const msgCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    const chunkCount = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
    const interestingCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations WHERE is_interesting = 1').get() as { count: number };
    const clusterCount = this.db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
    const anchorCount = this.db.prepare('SELECT COUNT(*) as count FROM anchors').get() as { count: number };

    return {
      conversationCount: convCount.count,
      messageCount: msgCount.count,
      chunkCount: chunkCount.count,
      interestingCount: interestingCount.count,
      clusterCount: clusterCount.count,
      anchorCount: anchorCount.count,
    };
  }

  // ===========================================================================
  // Content Items (Facebook posts, comments, etc.)
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
    this.db.prepare(`
      INSERT OR REPLACE INTO content_items (
        id, type, source, text, title, created_at, updated_at,
        author_name, author_id, is_own_content, parent_id, thread_id,
        context, file_path, media_refs, media_count, metadata, tags, search_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.type,
      item.source,
      item.text,
      item.title,
      item.created_at,
      item.updated_at,
      item.author_name,
      item.author_id,
      item.is_own_content ? 1 : 0,
      item.parent_id,
      item.thread_id,
      item.context,
      item.file_path,
      item.media_refs,
      item.media_count,
      item.metadata,
      item.tags,
      item.search_text
    );
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
    const insertMany = this.db.transaction((items: any[]) => {
      for (const item of items) {
        this.insertContentItem(item);
      }
    });

    insertMany(items);
  }

  getContentItem(id: string): any | null {
    const row = this.db.prepare('SELECT * FROM content_items WHERE id = ?').get(id);
    return row || null;
  }

  getContentItemsBySource(source: string): any[] {
    return this.db.prepare('SELECT * FROM content_items WHERE source = ? ORDER BY created_at DESC').all(source);
  }

  getContentItemsByType(type: string): any[] {
    return this.db.prepare('SELECT * FROM content_items WHERE type = ? ORDER BY created_at DESC').all(type);
  }

  /**
   * Insert content item embedding into vec_content_items
   */
  insertContentItemEmbedding(
    id: string,
    contentItemId: string,
    type: string,
    source: string,
    embedding: number[]
  ): void {
    if (!this.vecLoaded) throw new Error('Vector operations not available');
    this.db.prepare(`
      INSERT OR REPLACE INTO vec_content_items (id, content_item_id, type, source, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, contentItemId, type, source, this.embeddingToJson(embedding));
  }

  /**
   * Search content items by semantic similarity
   */
  searchContentItems(
    queryEmbedding: number[],
    limit: number = 20,
    type?: string,
    source?: string
  ): Array<{ id: string; content_item_id: string; type: string; source: string; distance: number }> {
    if (!this.vecLoaded) throw new Error('Vector operations not available');

    let sql = `
      SELECT id, content_item_id, type, source, distance
      FROM vec_content_items
      WHERE embedding MATCH ?
    `;

    const params: any[] = [this.embeddingToJson(queryEmbedding)];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    if (source) {
      sql += ` AND source = ?`;
      params.push(source);
    }

    sql += ` ORDER BY distance LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as any[];
  }

  // ===========================================================================
  // Reactions
  // ===========================================================================

  insertReaction(reaction: {
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO reactions (
        id, content_item_id, reaction_type, reactor_name, reactor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      reaction.id,
      reaction.content_item_id,
      reaction.reaction_type,
      reaction.reactor_name,
      reaction.reactor_id,
      reaction.created_at
    );
  }

  insertReactionsBatch(reactions: Array<{
    id: string;
    content_item_id: string;
    reaction_type: string;
    reactor_name?: string;
    reactor_id?: string;
    created_at: number;
  }>): void {
    const insertMany = this.db.transaction((reactions: any[]) => {
      for (const reaction of reactions) {
        this.insertReaction(reaction);
      }
    });

    insertMany(reactions);
  }

  getReactionsForContentItem(contentItemId: string): any[] {
    return this.db.prepare('SELECT * FROM reactions WHERE content_item_id = ? ORDER BY created_at DESC').all(contentItemId);
  }

  // ===========================================================================
  // Import Tracking
  // ===========================================================================

  createImport(params: {
    id: string;
    source: string;
    sourcePath?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO imports (id, source, source_path, status, created_at, metadata)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(
      params.id,
      params.source,
      params.sourcePath || null,
      Date.now(),
      params.metadata ? JSON.stringify(params.metadata) : null
    );
  }

  startImport(id: string): void {
    this.db.prepare(`
      UPDATE imports SET status = 'processing', started_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  completeImport(id: string, stats: {
    threadCount: number;
    messageCount: number;
    mediaCount: number;
    totalWords: number;
  }): void {
    this.db.prepare(`
      UPDATE imports SET
        status = 'completed',
        completed_at = ?,
        thread_count = ?,
        message_count = ?,
        media_count = ?,
        total_words = ?
      WHERE id = ?
    `).run(
      Date.now(),
      stats.threadCount,
      stats.messageCount,
      stats.mediaCount,
      stats.totalWords,
      id
    );
  }

  failImport(id: string, errorMessage: string): void {
    this.db.prepare(`
      UPDATE imports SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?
    `).run(Date.now(), errorMessage, id);
  }

  getImport(id: string): Record<string, unknown> | null {
    return this.db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as Record<string, unknown> | null;
  }

  getImportsByStatus(status: string): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM imports WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
  }

  getAllImports(): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all() as Record<string, unknown>[];
  }

  deleteImport(id: string): boolean {
    const result = this.db.prepare('DELETE FROM imports WHERE id = ?').run(id);
    return result.changes > 0;
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
  // Facebook Entity Graph
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_people
      (id, name, facebook_id, profile_url, is_friend, friend_since, is_follower, is_following,
       interaction_count, tag_count, last_interaction, first_interaction, relationship_strength, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      person.id, person.name, person.facebook_id || null, person.profile_url || null,
      person.is_friend, person.friend_since || null, person.is_follower, person.is_following,
      person.interaction_count, person.tag_count, person.last_interaction || null,
      person.first_interaction || null, person.relationship_strength || null,
      person.created_at, person.updated_at || null
    );
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
    const insertMany = this.db.transaction((items: typeof people) => {
      for (const p of items) {
        this.insertFbPerson({
          ...p,
          is_friend: p.is_friend ? 1 : 0,
          is_follower: p.is_follower ? 1 : 0,
          is_following: p.is_following ? 1 : 0,
        });
      }
    });
    insertMany(people);
    return people.length;
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_places
      (id, name, address, city, latitude, longitude, visit_count, first_visit, last_visit, place_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      place.id, place.name, place.address || null, place.city || null,
      place.latitude || null, place.longitude || null, place.visit_count,
      place.first_visit || null, place.last_visit || null,
      place.place_type || null, place.metadata || null, place.created_at
    );
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
    const insertMany = this.db.transaction((items: typeof places) => {
      for (const p of items) {
        this.insertFbPlace({
          ...p,
          metadata: p.metadata ? JSON.stringify(p.metadata) : undefined,
        });
      }
    });
    insertMany(places);
    return places.length;
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_events
      (id, name, start_timestamp, end_timestamp, place_id, response_type, response_timestamp, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.name, event.start_timestamp || null, event.end_timestamp || null,
      event.place_id || null, event.response_type || null, event.response_timestamp || null,
      event.metadata || null, event.created_at
    );
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
    const insertMany = this.db.transaction((items: typeof events) => {
      for (const e of items) {
        this.insertFbEvent({
          ...e,
          metadata: e.metadata ? JSON.stringify(e.metadata) : undefined,
        });
      }
    });
    insertMany(events);
    return events.length;
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_advertisers
      (id, name, targeting_type, interaction_count, first_seen, last_seen, is_data_broker, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      advertiser.id, advertiser.name, advertiser.targeting_type || null,
      advertiser.interaction_count, advertiser.first_seen || null, advertiser.last_seen || null,
      advertiser.is_data_broker, advertiser.metadata || null, advertiser.created_at
    );
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
    const insertMany = this.db.transaction((items: typeof advertisers) => {
      for (const a of items) {
        this.insertFbAdvertiser({
          ...a,
          is_data_broker: a.is_data_broker ? 1 : 0,
          metadata: a.metadata ? JSON.stringify(a.metadata) : undefined,
        });
      }
    });
    insertMany(advertisers);
    return advertisers.length;
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_off_facebook_activity
      (id, app_name, event_type, event_count, first_event, last_event, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      activity.id, activity.app_name, activity.event_type || null,
      activity.event_count, activity.first_event || null, activity.last_event || null,
      activity.metadata || null, activity.created_at
    );
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
    const insertMany = this.db.transaction((items: typeof activities) => {
      for (const a of items) {
        this.insertFbOffFacebookActivity({
          ...a,
          metadata: a.metadata ? JSON.stringify(a.metadata) : undefined,
        });
      }
    });
    insertMany(activities);
    return activities.length;
  }

  // Query methods for entities
  getFbPeople(options?: { isFriend?: boolean; limit?: number }): any[] {
    let sql = 'SELECT * FROM fb_people';
    const params: unknown[] = [];

    if (options?.isFriend !== undefined) {
      sql += ' WHERE is_friend = ?';
      params.push(options.isFriend ? 1 : 0);
    }

    sql += ' ORDER BY interaction_count DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  getFbPlaces(options?: { limit?: number }): any[] {
    let sql = 'SELECT * FROM fb_places ORDER BY visit_count DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      return this.db.prepare(sql).all(options.limit);
    }
    return this.db.prepare(sql).all();
  }

  getFbEvents(options?: { responseType?: string; limit?: number }): any[] {
    let sql = 'SELECT * FROM fb_events';
    const params: unknown[] = [];

    if (options?.responseType) {
      sql += ' WHERE response_type = ?';
      params.push(options.responseType);
    }

    sql += ' ORDER BY start_timestamp DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  getFbAdvertisers(options?: { isDataBroker?: boolean; limit?: number }): any[] {
    let sql = 'SELECT * FROM fb_advertisers';
    const params: unknown[] = [];

    if (options?.isDataBroker !== undefined) {
      sql += ' WHERE is_data_broker = ?';
      params.push(options.isDataBroker ? 1 : 0);
    }

    sql += ' ORDER BY interaction_count DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  getFbOffFacebookActivity(options?: { limit?: number }): any[] {
    let sql = 'SELECT * FROM fb_off_facebook_activity ORDER BY event_count DESC';
    if (options?.limit) {
      sql += ' LIMIT ?';
      return this.db.prepare(sql).all(options.limit);
    }
    return this.db.prepare(sql).all();
  }

  getEntityStats(): {
    people: number;
    places: number;
    events: number;
    advertisers: number;
    offFacebook: number;
    dataBrokers: number;
  } {
    return {
      people: (this.db.prepare('SELECT COUNT(*) as count FROM fb_people').get() as { count: number }).count,
      places: (this.db.prepare('SELECT COUNT(*) as count FROM fb_places').get() as { count: number }).count,
      events: (this.db.prepare('SELECT COUNT(*) as count FROM fb_events').get() as { count: number }).count,
      advertisers: (this.db.prepare('SELECT COUNT(*) as count FROM fb_advertisers').get() as { count: number }).count,
      offFacebook: (this.db.prepare('SELECT COUNT(*) as count FROM fb_off_facebook_activity').get() as { count: number }).count,
      dataBrokers: (this.db.prepare('SELECT COUNT(*) as count FROM fb_advertisers WHERE is_data_broker = 1').get() as { count: number }).count,
    };
  }

  // ===========================================================================
  // Relationship Operations
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
    this.db.prepare(`
      INSERT OR REPLACE INTO fb_relationships
      (id, source_type, source_id, target_type, target_id, relationship_type,
       context_type, context_id, timestamp, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rel.id, rel.source_type, rel.source_id, rel.target_type, rel.target_id,
      rel.relationship_type, rel.context_type || null, rel.context_id || null,
      rel.timestamp || null, rel.weight, rel.metadata || null, rel.created_at
    );
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
    const insertMany = this.db.transaction((items: typeof relationships) => {
      for (const r of items) {
        this.insertFbRelationship({
          ...r,
          metadata: r.metadata ? JSON.stringify(r.metadata) : undefined,
        });
      }
    });
    insertMany(relationships);
    return relationships.length;
  }

  /**
   * Get relationships with filtering options
   */
  getFbRelationships(options?: {
    sourceType?: string;
    sourceId?: string;
    targetType?: string;
    targetId?: string;
    relationshipType?: string;
    limit?: number;
  }): any[] {
    let sql = 'SELECT * FROM fb_relationships WHERE 1=1';
    const params: unknown[] = [];

    if (options?.sourceType) {
      sql += ' AND source_type = ?';
      params.push(options.sourceType);
    }
    if (options?.sourceId) {
      sql += ' AND source_id = ?';
      params.push(options.sourceId);
    }
    if (options?.targetType) {
      sql += ' AND target_type = ?';
      params.push(options.targetType);
    }
    if (options?.targetId) {
      sql += ' AND target_id = ?';
      params.push(options.targetId);
    }
    if (options?.relationshipType) {
      sql += ' AND relationship_type = ?';
      params.push(options.relationshipType);
    }

    sql += ' ORDER BY weight DESC, timestamp DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params);
  }

  /**
   * Get all people connected to a specific person with relationship details
   */
  getFbPersonConnections(personId: string, options?: { limit?: number }): Array<{
    person: any;
    relationship_type: string;
    weight: number;
    timestamp?: number;
    direction: 'outgoing' | 'incoming';
  }> {
    const limit = options?.limit || 100;

    // Outgoing relationships (this person → others)
    const outgoing = this.db.prepare(`
      SELECT r.*, p.name, p.is_friend, p.is_follower, p.interaction_count
      FROM fb_relationships r
      JOIN fb_people p ON r.target_id = p.id
      WHERE r.source_id = ? AND r.target_type = 'person'
      ORDER BY r.weight DESC
      LIMIT ?
    `).all(personId, limit);

    // Incoming relationships (others → this person)
    const incoming = this.db.prepare(`
      SELECT r.*, p.name, p.is_friend, p.is_follower, p.interaction_count
      FROM fb_relationships r
      JOIN fb_people p ON r.source_id = p.id
      WHERE r.target_id = ? AND r.source_type = 'person'
      ORDER BY r.weight DESC
      LIMIT ?
    `).all(personId, limit);

    const results: Array<{
      person: any;
      relationship_type: string;
      weight: number;
      timestamp?: number;
      direction: 'outgoing' | 'incoming';
    }> = [];

    for (const row of outgoing as any[]) {
      results.push({
        person: {
          id: row.target_id,
          name: row.name,
          is_friend: row.is_friend === 1,
          is_follower: row.is_follower === 1,
          interaction_count: row.interaction_count,
        },
        relationship_type: row.relationship_type,
        weight: row.weight,
        timestamp: row.timestamp,
        direction: 'outgoing',
      });
    }

    for (const row of incoming as any[]) {
      results.push({
        person: {
          id: row.source_id,
          name: row.name,
          is_friend: row.is_friend === 1,
          is_follower: row.is_follower === 1,
          interaction_count: row.interaction_count,
        },
        relationship_type: row.relationship_type,
        weight: row.weight,
        timestamp: row.timestamp,
        direction: 'incoming',
      });
    }

    // Sort by weight and dedupe
    results.sort((a, b) => b.weight - a.weight);
    return results.slice(0, limit);
  }

  /**
   * Get top connected people (highest relationship weights)
   */
  getTopConnectedPeople(options?: { limit?: number }): Array<{
    person: any;
    total_weight: number;
    relationship_count: number;
  }> {
    const limit = options?.limit || 50;

    const rows = this.db.prepare(`
      SELECT
        p.id, p.name, p.is_friend, p.is_follower, p.interaction_count,
        SUM(r.weight) as total_weight,
        COUNT(r.id) as relationship_count
      FROM fb_people p
      JOIN fb_relationships r ON (r.source_id = p.id OR r.target_id = p.id)
      WHERE p.id != ?
      GROUP BY p.id
      ORDER BY total_weight DESC
      LIMIT ?
    `).all('fb_person_self', limit);

    return (rows as any[]).map(row => ({
      person: {
        id: row.id,
        name: row.name,
        is_friend: row.is_friend === 1,
        is_follower: row.is_follower === 1,
        interaction_count: row.interaction_count,
      },
      total_weight: row.total_weight,
      relationship_count: row.relationship_count,
    }));
  }

  /**
   * Get relationship statistics
   */
  getRelationshipStats(): {
    totalRelationships: number;
    byType: Record<string, number>;
    avgWeight: number;
    topRelationshipTypes: Array<{ type: string; count: number; avg_weight: number }>;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM fb_relationships').get() as { count: number }).count;
    const avgWeight = (this.db.prepare('SELECT AVG(weight) as avg FROM fb_relationships').get() as { avg: number }).avg || 0;

    const byTypeRows = this.db.prepare(`
      SELECT relationship_type, COUNT(*) as count, AVG(weight) as avg_weight
      FROM fb_relationships
      GROUP BY relationship_type
      ORDER BY count DESC
    `).all() as Array<{ relationship_type: string; count: number; avg_weight: number }>;

    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.relationship_type] = row.count;
    }

    return {
      totalRelationships: total,
      byType,
      avgWeight,
      topRelationshipTypes: byTypeRows.slice(0, 10).map(r => ({
        type: r.relationship_type,
        count: r.count,
        avg_weight: r.avg_weight,
      })),
    };
  }

  /**
   * Update entity stats after relationship building
   * Updates interaction_count and relationship_strength on fb_people
   */
  updatePersonInteractionStats(): void {
    // Update interaction counts based on relationship weights
    this.db.exec(`
      UPDATE fb_people
      SET
        interaction_count = (
          SELECT COALESCE(SUM(weight), 0)
          FROM fb_relationships
          WHERE (source_id = fb_people.id AND source_type = 'person')
             OR (target_id = fb_people.id AND target_type = 'person')
        ),
        relationship_strength = (
          SELECT COALESCE(SUM(weight), 0)
          FROM fb_relationships
          WHERE (source_id = fb_people.id OR target_id = fb_people.id)
        )
    `);
  }

  // ===========================================================================
  // Image Analysis Operations
  // ===========================================================================

  /**
   * Insert or update image analysis
   */
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
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO image_analysis
      (id, file_path, file_hash, source, description, categories, objects, scene, mood,
       model_used, confidence, processing_time_ms, analyzed_at, updated_at, media_file_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        description = excluded.description,
        categories = excluded.categories,
        objects = excluded.objects,
        scene = excluded.scene,
        mood = excluded.mood,
        model_used = excluded.model_used,
        confidence = excluded.confidence,
        processing_time_ms = excluded.processing_time_ms,
        updated_at = excluded.updated_at
    `).run(
      analysis.id,
      analysis.file_path,
      analysis.file_hash || null,
      analysis.source,
      analysis.description || null,
      analysis.categories ? JSON.stringify(analysis.categories) : null,
      analysis.objects ? JSON.stringify(analysis.objects) : null,
      analysis.scene || null,
      analysis.mood || null,
      analysis.model_used || null,
      analysis.confidence || null,
      analysis.processing_time_ms || null,
      now,
      now,
      analysis.media_file_id || null
    );
  }

  /**
   * Get image analysis by file path
   */
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
    const row = this.db.prepare(`
      SELECT * FROM image_analysis WHERE file_path = ?
    `).get(filePath) as any;

    if (!row) return null;

    return {
      id: row.id,
      file_path: row.file_path,
      file_hash: row.file_hash,
      source: row.source,
      description: row.description,
      categories: row.categories ? JSON.parse(row.categories) : [],
      objects: row.objects ? JSON.parse(row.objects) : [],
      scene: row.scene,
      mood: row.mood,
      model_used: row.model_used,
      confidence: row.confidence,
      analyzed_at: row.analyzed_at,
    };
  }

  /**
   * Full-text search on image descriptions
   */
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
    const limit = options?.limit || 20;
    let sql = `
      SELECT ia.id, ia.file_path, ia.description, ia.categories, ia.source,
             bm25(image_fts) as rank
      FROM image_fts
      JOIN image_analysis ia ON ia.rowid = image_fts.rowid
      WHERE image_fts MATCH ?
    `;

    const params: (string | number)[] = [query];

    if (options?.source) {
      sql += ` AND ia.source = ?`;
      params.push(options.source);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      file_path: row.file_path,
      description: row.description,
      categories: row.categories ? JSON.parse(row.categories) : [],
      source: row.source,
      rank: row.rank,
    }));
  }

  /**
   * Insert image embedding
   */
  insertImageEmbedding(data: {
    id: string;
    image_analysis_id: string;
    embedding: Float32Array | number[];
    model: string;
    dimensions: number;
  }): void {
    const embeddingBuffer = Buffer.from(
      data.embedding instanceof Float32Array
        ? data.embedding.buffer
        : new Float32Array(data.embedding).buffer
    );

    this.db.prepare(`
      INSERT OR REPLACE INTO image_embeddings
      (id, image_analysis_id, embedding, model, dimensions, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.image_analysis_id,
      embeddingBuffer,
      data.model,
      data.dimensions,
      Date.now()
    );

    // Also insert into vec table if available
    if (this.vecLoaded) {
      const analysis = this.db.prepare('SELECT source FROM image_analysis WHERE id = ?')
        .get(data.image_analysis_id) as { source: string } | undefined;

      if (analysis) {
        this.db.prepare(`
          INSERT OR REPLACE INTO vec_image_embeddings (id, image_analysis_id, source, embedding)
          VALUES (?, ?, ?, ?)
        `).run(data.id, data.image_analysis_id, analysis.source, embeddingBuffer);
      }
    }
  }

  /**
   * Vector similarity search for images
   */
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
    if (!this.vecLoaded) {
      console.warn('Vector search not available - sqlite-vec not loaded');
      return [];
    }

    const limit = options?.limit || 20;
    const embeddingBuffer = Buffer.from(
      queryEmbedding instanceof Float32Array
        ? queryEmbedding.buffer
        : new Float32Array(queryEmbedding).buffer
    );

    let sql = `
      SELECT v.image_analysis_id, v.distance,
             ia.id, ia.file_path, ia.description, ia.categories, ia.source
      FROM vec_image_embeddings v
      JOIN image_analysis ia ON ia.id = v.image_analysis_id
      WHERE v.embedding MATCH ?
    `;

    const params: (Buffer | string | number)[] = [embeddingBuffer];

    if (options?.source) {
      sql += ` AND v.source = ?`;
      params.push(options.source);
    }

    sql += ` ORDER BY v.distance LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      file_path: row.file_path,
      description: row.description,
      categories: row.categories ? JSON.parse(row.categories) : [],
      source: row.source,
      similarity: 1 - row.distance, // Convert distance to similarity
    }));
  }

  /**
   * Get all unanalyzed images from media_files
   */
  getUnanalyzedImages(options?: { source?: string; limit?: number }): Array<{
    id: string;
    file_path: string;
    content_item_id: string | null;
  }> {
    const limit = options?.limit || 1000;
    let sql = `
      SELECT mf.id, mf.file_path, mf.content_item_id
      FROM media_files mf
      LEFT JOIN image_analysis ia ON ia.file_path = mf.file_path
      WHERE ia.id IS NULL
        AND mf.type IN ('photo', 'image')
    `;

    const params: (string | number)[] = [];

    if (options?.source) {
      sql += ` AND mf.file_path LIKE ?`;
      params.push(`%${options.source}%`);
    }

    sql += ` LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * Get image analysis stats
   */
  getImageAnalysisStats(): {
    total: number;
    analyzed: number;
    bySource: Record<string, number>;
    byScene: Record<string, number>;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM media_files WHERE type IN ("photo", "image")').get() as { count: number }).count;
    const analyzed = (this.db.prepare('SELECT COUNT(*) as count FROM image_analysis').get() as { count: number }).count;

    const bySourceRows = this.db.prepare(`
      SELECT source, COUNT(*) as count FROM image_analysis GROUP BY source
    `).all() as Array<{ source: string; count: number }>;

    const bySource: Record<string, number> = {};
    for (const row of bySourceRows) {
      bySource[row.source] = row.count;
    }

    const bySceneRows = this.db.prepare(`
      SELECT scene, COUNT(*) as count FROM image_analysis WHERE scene IS NOT NULL GROUP BY scene
    `).all() as Array<{ scene: string; count: number }>;

    const byScene: Record<string, number> = {};
    for (const row of bySceneRows) {
      byScene[row.scene] = row.count;
    }

    return { total, analyzed, bySource, byScene };
  }

  /**
   * Create or update image cluster
   */
  upsertImageCluster(cluster: {
    id: string;
    cluster_index: number;
    name?: string;
    description?: string;
    representative_image_id?: string;
    image_count: number;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO image_clusters
      (id, cluster_index, name, description, representative_image_id, image_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representative_image_id = excluded.representative_image_id,
        image_count = excluded.image_count,
        updated_at = excluded.updated_at
    `).run(
      cluster.id,
      cluster.cluster_index,
      cluster.name || null,
      cluster.description || null,
      cluster.representative_image_id || null,
      cluster.image_count,
      now,
      now
    );
  }

  /**
   * Add image to cluster
   */
  addImageToCluster(clusterId: string, imageAnalysisId: string, distance: number, isRepresentative = false): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO image_cluster_members
      (cluster_id, image_analysis_id, distance_to_center, is_representative)
      VALUES (?, ?, ?, ?)
    `).run(clusterId, imageAnalysisId, distance, isRepresentative ? 1 : 0);
  }

  /**
   * Get all image clusters
   */
  getImageClusters(): Array<{
    id: string;
    cluster_index: number;
    name: string | null;
    description: string | null;
    image_count: number;
    representative: { id: string; file_path: string; description: string | null } | null;
  }> {
    const rows = this.db.prepare(`
      SELECT c.*, ia.file_path as rep_path, ia.description as rep_desc
      FROM image_clusters c
      LEFT JOIN image_analysis ia ON ia.id = c.representative_image_id
      ORDER BY c.image_count DESC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      cluster_index: row.cluster_index,
      name: row.name,
      description: row.description,
      image_count: row.image_count,
      representative: row.representative_image_id ? {
        id: row.representative_image_id,
        file_path: row.rep_path,
        description: row.rep_desc,
      } : null,
    }));
  }

  /**
   * Get images in a cluster
   */
  getClusterImages(clusterId: string): Array<{
    id: string;
    file_path: string;
    description: string | null;
    categories: string[];
    distance: number;
    is_representative: boolean;
  }> {
    const rows = this.db.prepare(`
      SELECT ia.id, ia.file_path, ia.description, ia.categories,
             cm.distance_to_center as distance, cm.is_representative
      FROM image_cluster_members cm
      JOIN image_analysis ia ON ia.id = cm.image_analysis_id
      WHERE cm.cluster_id = ?
      ORDER BY cm.distance_to_center ASC
    `).all(clusterId) as any[];

    return rows.map(row => ({
      id: row.id,
      file_path: row.file_path,
      description: row.description,
      categories: row.categories ? JSON.parse(row.categories) : [],
      distance: row.distance,
      is_representative: row.is_representative === 1,
    }));
  }

  /**
   * Clear all image clusters (for re-clustering)
   */
  clearImageClusters(): void {
    this.db.exec(`
      DELETE FROM image_cluster_members;
      DELETE FROM image_clusters;
    `);
  }

  // ===========================================================================
  // Raw Access (for complex queries in routes)
  // ===========================================================================

  /**
   * Get raw database instance for complex queries
   * Use sparingly - prefer adding methods to this class
   */
  getRawDb(): Database.Database {
    return this.db;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  close(): void {
    this.db.close();
  }
}
