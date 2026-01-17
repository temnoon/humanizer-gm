/**
 * EmbeddingMigrations - Schema migration logic extracted from EmbeddingDatabase
 *
 * This module contains all database schema migrations (v2-v16) and vector table
 * creation logic. Extracted to reduce EmbeddingDatabase.ts size and improve
 * maintainability.
 */

import type Database from 'better-sqlite3';

export const SCHEMA_VERSION = 17;  // Added content_blocks for granular content extraction
export const EMBEDDING_DIM = 768;  // nomic-embed-text via Ollama

export class EmbeddingMigrations {
  private db: Database.Database;
  private vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Run all migrations from the given version to SCHEMA_VERSION
   */
  run(fromVersion: number): void {
    this.migrateSchema(fromVersion);
  }

  /**
   * Create vector tables for vec0 extension (public for initial setup)
   */
  createVectorTables(): void {
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

    // Media embeddings for visual/audio similarity (v7)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_media_items USING vec0(
        id TEXT PRIMARY KEY,
        content_hash TEXT,
        mime_type TEXT,
        embedding float[512]
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

    // Migration from version 6 to 7: add Xanadu links and content-addressable media
    if (fromVersion < 7) {
      this.db.exec(`
        -- ========================================================================
        -- Xanadu-Style Links (Bidirectional)
        -- ========================================================================

        -- Universal bidirectional links between any content URIs
        CREATE TABLE IF NOT EXISTS links (
          id TEXT PRIMARY KEY,

          -- Endpoints (URIs like content://openai/conv/123, media://sha256hash)
          source_uri TEXT NOT NULL,
          target_uri TEXT NOT NULL,

          -- Link metadata
          link_type TEXT NOT NULL,          -- 'parent', 'child', 'reference', 'transclusion', 'similar', 'responds_to'
          link_strength REAL DEFAULT 1.0,   -- 0.0-1.0 for similarity/relevance

          -- Span information (for precise text-to-text links)
          source_start INTEGER,             -- Character offset in source
          source_end INTEGER,
          target_start INTEGER,             -- Character offset in target
          target_end INTEGER,

          -- Metadata
          label TEXT,                       -- Human-readable link description
          created_at REAL NOT NULL,
          created_by TEXT,                  -- 'import', 'user', 'semantic', 'aui'
          metadata TEXT                     -- JSON for additional data
        );

        -- ========================================================================
        -- Content-Addressable Media Storage
        -- ========================================================================

        -- Media items stored by content hash (SHA-256)
        CREATE TABLE IF NOT EXISTS media_items (
          id TEXT PRIMARY KEY,

          -- Content addressing - hash is canonical identifier
          content_hash TEXT UNIQUE NOT NULL,
          file_path TEXT NOT NULL,          -- Relative path: media/{hash[0:2]}/{hash[2:4]}/{hash}.ext
          original_filename TEXT,

          -- File metadata
          mime_type TEXT,
          file_size INTEGER,

          -- Media-specific dimensions
          width INTEGER,
          height INTEGER,
          duration REAL,                    -- For audio/video in seconds

          -- AI analysis results
          vision_description TEXT,          -- AI-generated description
          transcript TEXT,                  -- For audio/video

          -- Timestamps
          taken_at REAL,                    -- Original capture time (from EXIF, etc.)
          imported_at REAL NOT NULL,

          -- Embedding for visual/audio similarity
          embedding BLOB,
          embedding_model TEXT
        );

        -- ========================================================================
        -- Media References (Links content to media via hash)
        -- ========================================================================

        -- Links content_items to media_items, preserving original pointer info
        CREATE TABLE IF NOT EXISTS media_references (
          id TEXT PRIMARY KEY,
          content_id TEXT NOT NULL,         -- References content_items.id
          media_hash TEXT NOT NULL,         -- References media_items.content_hash

          -- Position in content
          position INTEGER,                 -- Order of media in content
          char_offset INTEGER,              -- Character position of reference

          -- Reference type and original pointer
          reference_type TEXT NOT NULL,     -- 'attachment', 'embed', 'generated', 'upload'
          original_pointer TEXT,            -- Original: sediment://, file-service://, etc.

          -- Caption/alt text
          caption TEXT,
          alt_text TEXT,

          created_at REAL NOT NULL,

          FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
        );

        -- ========================================================================
        -- Import Jobs (Enhanced tracking)
        -- ========================================================================

        -- Extended import job tracking with progress phases
        CREATE TABLE IF NOT EXISTS import_jobs (
          id TEXT PRIMARY KEY,

          status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'extracting', 'parsing', 'indexing', 'embedding', 'completed', 'failed'

          -- Source information
          source_type TEXT NOT NULL,        -- 'openai', 'claude', 'facebook', 'txt', 'md', 'docx', 'pdf', 'zip'
          source_path TEXT,
          source_name TEXT,

          -- Progress tracking
          progress REAL DEFAULT 0,          -- 0.0 - 1.0
          current_phase TEXT,
          current_item TEXT,

          -- Statistics
          units_total INTEGER DEFAULT 0,
          units_processed INTEGER DEFAULT 0,
          media_total INTEGER DEFAULT 0,
          media_processed INTEGER DEFAULT 0,
          links_created INTEGER DEFAULT 0,
          errors_count INTEGER DEFAULT 0,

          -- Timing
          created_at REAL NOT NULL,
          started_at REAL,
          completed_at REAL,

          -- Error tracking
          error_log TEXT                    -- JSON array of errors
        );

        -- Add URI column to content_items for Xanadu addressing
        -- Note: Column may already exist from earlier migrations

        -- ========================================================================
        -- Indexes for Xanadu Tables
        -- ========================================================================

        -- Link indexes for bidirectional traversal
        CREATE INDEX IF NOT EXISTS idx_links_source_uri ON links(source_uri);
        CREATE INDEX IF NOT EXISTS idx_links_target_uri ON links(target_uri);
        CREATE INDEX IF NOT EXISTS idx_links_type ON links(link_type);
        CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);

        -- Media item indexes (may not exist if migrating from older schema)

        -- Media reference indexes
        CREATE INDEX IF NOT EXISTS idx_media_refs_content ON media_references(content_id);
        CREATE INDEX IF NOT EXISTS idx_media_refs_hash ON media_references(media_hash);
        CREATE INDEX IF NOT EXISTS idx_media_refs_pointer ON media_references(original_pointer);

        -- Import job indexes
        CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_import_jobs_created ON import_jobs(created_at DESC);

        -- Content items URI index
        CREATE INDEX IF NOT EXISTS idx_content_items_uri ON content_items(uri);
      `);

      // Add vector table for media embeddings if vec extension is loaded
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_media_items USING vec0(
            id TEXT PRIMARY KEY,
            content_hash TEXT,
            mime_type TEXT,
            embedding float[512]
          );
        `);
      }
    }

    // Migration from version 7 to 8: Upgrade to 768-dim Ollama embeddings
    if (fromVersion < 8) {
      console.log('[migration] Upgrading to 768-dim nomic-embed-text embeddings...');

      // Drop all vec0 tables - they need to be recreated with new dimensions
      if (this.vecLoaded) {
        const vecTables = [
          'vec_summaries',
          'vec_messages',
          'vec_paragraphs',
          'vec_sentences',
          'vec_anchors',
          'vec_clusters',
          'vec_content_items',
          'vec_pyramid_chunks',
          'vec_pyramid_summaries',
          'vec_pyramid_apex',
          'vec_media_items',
          'vec_image_embeddings'
        ];

        for (const table of vecTables) {
          try {
            this.db.exec(`DROP TABLE IF EXISTS ${table}`);
            console.log(`[migration] Dropped ${table}`);
          } catch (err) {
            console.warn(`[migration] Could not drop ${table}:`, err);
          }
        }

        // Recreate vec0 tables with 768-dim
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            message_id TEXT,
            role TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_paragraphs USING vec0(
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            message_id TEXT,
            chunk_index INTEGER,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_sentences USING vec0(
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            message_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_anchors USING vec0(
            id TEXT PRIMARY KEY,
            anchor_type TEXT,
            name TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_clusters USING vec0(
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_content_items USING vec0(
            id TEXT PRIMARY KEY,
            content_item_id TEXT,
            type TEXT,
            source TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

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

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_media_items USING vec0(
            id TEXT PRIMARY KEY,
            content_hash TEXT,
            mime_type TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_image_embeddings USING vec0(
            id TEXT PRIMARY KEY,
            image_analysis_id TEXT,
            source TEXT,
            embedding float[512]
          );
        `);

        console.log('[migration] Created vec0 tables with 768-dim');
      }

      // Clear existing embeddings (they'll be regenerated with new model)
      this.db.exec(`
        UPDATE content_items SET embedding = NULL, embedding_model = 'nomic-embed-text';
        UPDATE messages SET embedding_id = NULL;
        UPDATE chunks SET embedding_id = NULL;
        UPDATE anchors SET embedding = NULL;
        UPDATE pyramid_chunks SET embedding = NULL, embedding_model = 'nomic-embed-text';
        UPDATE pyramid_summaries SET embedding = NULL, embedding_model = 'nomic-embed-text';
        UPDATE pyramid_apex SET embedding = NULL, embedding_model = 'nomic-embed-text';
        UPDATE media_items SET embedding = NULL, embedding_model = 'nomic-embed-text';
        UPDATE media_files SET embedding = NULL, embedding_model = 'nomic-embed-text';
      `);

      console.log('[migration] Cleared old embeddings - run rebuildAllEmbeddings() to regenerate');
    }

    // Migration from version 8 to 9: Add image description text embeddings for semantic search
    if (fromVersion < 9) {
      console.log('[migration] Adding image description embeddings for semantic image search...');

      // Create table for text embeddings of image descriptions
      // These use nomic-embed-text (768-dim) for semantic search on description text
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS image_description_embeddings (
          id TEXT PRIMARY KEY,
          image_analysis_id TEXT NOT NULL,
          text TEXT NOT NULL,                     -- The description text that was embedded
          embedding BLOB NOT NULL,                -- Float32 array (768-dim nomic-embed-text)
          model TEXT NOT NULL DEFAULT 'nomic-embed-text',
          dimensions INTEGER NOT NULL DEFAULT ${EMBEDDING_DIM},
          created_at REAL NOT NULL,
          FOREIGN KEY (image_analysis_id) REFERENCES image_analysis(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_image_desc_embeddings_analysis
          ON image_description_embeddings(image_analysis_id);
      `);

      // Create vec0 virtual table for semantic similarity search
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_image_descriptions USING vec0(
            id TEXT PRIMARY KEY,
            image_analysis_id TEXT,
            source TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
        console.log('[migration] Created vec_image_descriptions table for semantic search');
      }

      console.log('[migration] Added image_description_embeddings table');
    }

    // Migration from version 9 to 10: Xanadu unified book/persona/style storage
    if (fromVersion < 10) {
      console.log('[migration] Adding unified book/persona/style tables (Xanadu consolidation)...');

      this.db.exec(`
        -- ========================================================================
        -- XANADU UNIFIED BOOK STORAGE
        -- Consolidates BookProjectService + BookshelfService into single source
        -- ========================================================================

        -- Books table (replaces localStorage book-project-* and bookshelf-books)
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          uri TEXT UNIQUE NOT NULL,              -- 'book://user/slug' or 'book://library/name'
          name TEXT NOT NULL,
          subtitle TEXT,
          author TEXT,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'harvesting',  -- 'harvesting', 'drafting', 'revising', 'mastering'
          book_type TEXT DEFAULT 'book',              -- 'book' (multi-chapter) or 'paper' (single essay)

          -- References (JSON arrays of URIs)
          persona_refs TEXT,                     -- ['persona://author/name', ...]
          style_refs TEXT,                       -- ['style://author/name', ...]
          source_refs TEXT,                      -- Source references for harvesting

          -- Thread definitions for harvesting
          threads TEXT,                          -- JSON array of thread objects
          harvest_config TEXT,                   -- JSON harvest configuration

          -- Editorial/thinking context
          editorial TEXT,                        -- JSON editorial principles
          thinking TEXT,                         -- JSON thinking context (decisions, notes)

          -- Pyramid reference
          pyramid_id TEXT,                       -- Reference to pyramid_apex.id

          -- Statistics (JSON)
          stats TEXT,                            -- {totalSources, totalPassages, approvedPassages, gems, chapters, wordCount}

          -- Profile/analysis
          profile TEXT,                          -- JSON book profile (apex summary, tone, stats)

          -- Metadata
          tags TEXT,                             -- JSON array of tags
          is_library INTEGER DEFAULT 0,          -- 1 if built-in library book

          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        );

        -- Personas table (from BookshelfService)
        CREATE TABLE IF NOT EXISTS personas (
          id TEXT PRIMARY KEY,
          uri TEXT UNIQUE NOT NULL,              -- 'persona://author/name'
          name TEXT NOT NULL,
          description TEXT,
          author TEXT,

          -- Voice characteristics
          voice TEXT,                            -- JSON: selfDescription, styleNotes, register, emotionalRange, syntaxPatterns
          vocabulary TEXT,                       -- JSON: preferred, avoided, domainTerms

          -- Provenance
          derived_from TEXT,                     -- JSON array of source references
          influences TEXT,                       -- JSON array: [{name, weight, notes}]
          exemplars TEXT,                        -- JSON array: [{text, notes}]

          -- System prompt for LLM use
          system_prompt TEXT,

          -- Embedding for similarity search
          embedding BLOB,
          embedding_model TEXT DEFAULT 'nomic-embed-text',

          -- Metadata
          tags TEXT,                             -- JSON array
          is_library INTEGER DEFAULT 0,          -- 1 if built-in

          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        );

        -- Styles table (from BookshelfService)
        CREATE TABLE IF NOT EXISTS styles (
          id TEXT PRIMARY KEY,
          uri TEXT UNIQUE NOT NULL,              -- 'style://author/name'
          name TEXT NOT NULL,
          description TEXT,
          author TEXT,

          -- Style characteristics
          characteristics TEXT,                  -- JSON: formality, abstractionLevel, complexity, metaphorDensity
          structure TEXT,                        -- JSON: paragraphLength, usesLists, usesHeaders, usesEpigraphs

          -- Style prompt for LLM use
          style_prompt TEXT,

          -- Provenance
          derived_from TEXT,                     -- JSON array of source references

          -- Embedding for similarity search
          embedding BLOB,
          embedding_model TEXT DEFAULT 'nomic-embed-text',

          -- Metadata
          tags TEXT,                             -- JSON array
          is_library INTEGER DEFAULT 0,

          created_at REAL NOT NULL,
          updated_at REAL NOT NULL
        );

        -- Book passages (harvested content for books)
        CREATE TABLE IF NOT EXISTS book_passages (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,

          -- Source reference
          source_ref TEXT,                       -- JSON: uri, sourceType, conversationId, conversationTitle, label

          -- Content
          text TEXT NOT NULL,
          word_count INTEGER DEFAULT 0,
          role TEXT,                             -- 'user' or 'assistant'

          -- Harvest metadata
          harvested_by TEXT,                     -- 'manual', 'search', 'aui', 'thread'
          thread_id TEXT,                        -- Which thread this belongs to

          -- Curation
          curation_status TEXT DEFAULT 'candidate',  -- 'candidate', 'approved', 'gem', 'rejected'
          curation_note TEXT,

          -- Chapter assignment
          chapter_id TEXT,                       -- Assigned chapter (nullable)

          -- Metadata
          tags TEXT,                             -- JSON array

          -- Embedding for similarity
          embedding BLOB,
          embedding_model TEXT DEFAULT 'nomic-embed-text',

          created_at REAL NOT NULL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES book_chapters(id) ON DELETE SET NULL
        );

        -- Book chapters (with version history)
        CREATE TABLE IF NOT EXISTS book_chapters (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,

          -- Chapter identity
          number INTEGER NOT NULL,
          title TEXT NOT NULL,

          -- Current content
          content TEXT,
          word_count INTEGER DEFAULT 0,
          version INTEGER DEFAULT 1,

          -- Status
          status TEXT DEFAULT 'outline',         -- 'outline', 'drafting', 'revising', 'complete'

          -- Structure
          epigraph TEXT,                         -- JSON: {text, source}
          sections TEXT,                         -- JSON array of section objects
          marginalia TEXT,                       -- JSON array of margin notes

          -- Metadata
          metadata TEXT,                         -- JSON: notes, lastEditedBy, lastEditedAt, auiSuggestions
          passage_refs TEXT,                     -- JSON array of passage IDs used in chapter

          created_at REAL NOT NULL,
          updated_at REAL NOT NULL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        -- Chapter versions (for version control)
        CREATE TABLE IF NOT EXISTS chapter_versions (
          id TEXT PRIMARY KEY,
          chapter_id TEXT NOT NULL,
          version INTEGER NOT NULL,

          content TEXT NOT NULL,
          word_count INTEGER DEFAULT 0,
          changes TEXT,                          -- Description of what changed
          created_by TEXT,                       -- 'user' or 'aui'

          created_at REAL NOT NULL,

          FOREIGN KEY (chapter_id) REFERENCES book_chapters(id) ON DELETE CASCADE,
          UNIQUE(chapter_id, version)
        );

        -- ========================================================================
        -- HARVEST BUCKET TABLES (migrated from localStorage HarvestBucketService)
        -- ========================================================================

        -- Harvest buckets (temporary staging for book content)
        CREATE TABLE IF NOT EXISTS harvest_buckets (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,               -- References books.id via bookUri
          book_uri TEXT NOT NULL,              -- book://user/slug
          status TEXT NOT NULL DEFAULT 'collecting',  -- collecting, reviewing, staged, committed, discarded

          -- Queries used for this harvest
          queries TEXT,                        -- JSON array of search queries

          -- Passage arrays (JSON serialized SourcePassage[])
          candidates TEXT,                     -- Passages awaiting review
          approved TEXT,                       -- Approved passages
          gems TEXT,                           -- Gem passages (best of the best)
          rejected TEXT,                       -- Rejected passages
          duplicate_ids TEXT,                  -- IDs of detected duplicates

          -- Configuration
          config TEXT,                         -- JSON: HarvestConfig (dedupeByContent, dedupeThreshold, etc.)
          thread_uri TEXT,                     -- Optional thread context

          -- Statistics (JSON)
          stats TEXT,                          -- {totalCandidates, reviewed, approved, rejected, gems, duplicates, avgSimilarity, approvedWordCount}

          -- Metadata
          initiated_by TEXT,                   -- 'user' or 'aui'
          created_at REAL NOT NULL,
          updated_at REAL,
          completed_at REAL,
          finalized_at REAL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        -- Narrative arcs (thematic through-lines for books)
        CREATE TABLE IF NOT EXISTS narrative_arcs (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          book_uri TEXT NOT NULL,

          thesis TEXT NOT NULL,                -- Core argument/theme
          arc_type TEXT DEFAULT 'thematic',    -- 'thematic', 'chronological', 'argumentative', 'character'

          -- Evaluation
          evaluation_status TEXT,              -- 'pending', 'approved', 'rejected'
          evaluation_feedback TEXT,
          evaluated_at REAL,

          -- Metadata
          proposed_by TEXT,                    -- 'user' or 'aui'
          created_at REAL NOT NULL,
          updated_at REAL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        -- Passage links (connects passages to chapters at specific positions)
        CREATE TABLE IF NOT EXISTS passage_links (
          id TEXT PRIMARY KEY,
          passage_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          position INTEGER NOT NULL,           -- Order within chapter

          section_id TEXT,                     -- Optional section reference
          usage_type TEXT DEFAULT 'quote',     -- 'quote', 'reference', 'paraphrase', 'inspiration'
          created_by TEXT,                     -- 'user' or 'aui'

          created_at REAL NOT NULL,

          FOREIGN KEY (passage_id) REFERENCES book_passages(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES book_chapters(id) ON DELETE CASCADE
        );

        -- ========================================================================
        -- INDEXES FOR BOOK TABLES
        -- ========================================================================

        CREATE INDEX IF NOT EXISTS idx_books_uri ON books(uri);
        CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
        CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
        CREATE INDEX IF NOT EXISTS idx_books_library ON books(is_library);
        CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_personas_uri ON personas(uri);
        CREATE INDEX IF NOT EXISTS idx_personas_author ON personas(author);
        CREATE INDEX IF NOT EXISTS idx_personas_library ON personas(is_library);

        CREATE INDEX IF NOT EXISTS idx_styles_uri ON styles(uri);
        CREATE INDEX IF NOT EXISTS idx_styles_author ON styles(author);
        CREATE INDEX IF NOT EXISTS idx_styles_library ON styles(is_library);

        CREATE INDEX IF NOT EXISTS idx_book_passages_book ON book_passages(book_id);
        CREATE INDEX IF NOT EXISTS idx_book_passages_curation ON book_passages(curation_status);
        CREATE INDEX IF NOT EXISTS idx_book_passages_chapter ON book_passages(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_book_passages_thread ON book_passages(thread_id);

        CREATE INDEX IF NOT EXISTS idx_book_chapters_book ON book_chapters(book_id);
        CREATE INDEX IF NOT EXISTS idx_book_chapters_number ON book_chapters(book_id, number);

        CREATE INDEX IF NOT EXISTS idx_chapter_versions_chapter ON chapter_versions(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_chapter_versions_num ON chapter_versions(chapter_id, version);

        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_book ON harvest_buckets(book_id);
        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_book_uri ON harvest_buckets(book_uri);
        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_status ON harvest_buckets(status);

        CREATE INDEX IF NOT EXISTS idx_narrative_arcs_book ON narrative_arcs(book_id);
        CREATE INDEX IF NOT EXISTS idx_narrative_arcs_book_uri ON narrative_arcs(book_uri);

        CREATE INDEX IF NOT EXISTS idx_passage_links_passage ON passage_links(passage_id);
        CREATE INDEX IF NOT EXISTS idx_passage_links_chapter ON passage_links(chapter_id);
      `);

      // Add content_type columns to pyramid_chunks for content-aware chunking
      try {
        this.db.exec(`
          ALTER TABLE pyramid_chunks ADD COLUMN content_type TEXT;
          ALTER TABLE pyramid_chunks ADD COLUMN language TEXT;
          ALTER TABLE pyramid_chunks ADD COLUMN context_before TEXT;
          ALTER TABLE pyramid_chunks ADD COLUMN context_after TEXT;
          ALTER TABLE pyramid_chunks ADD COLUMN linked_chunk_ids TEXT;
        `);
        console.log('[migration] Added content_type columns to pyramid_chunks');
      } catch {
        // Columns may already exist
      }

      // Create vector tables for personas and styles
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_personas USING vec0(
            id TEXT PRIMARY KEY,
            persona_uri TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_styles USING vec0(
            id TEXT PRIMARY KEY,
            style_uri TEXT,
            embedding float[${EMBEDDING_DIM}]
          );

          CREATE VIRTUAL TABLE IF NOT EXISTS vec_book_passages USING vec0(
            id TEXT PRIMARY KEY,
            book_id TEXT,
            passage_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
        console.log('[migration] Created vec tables for personas, styles, passages');
      }

      console.log('[migration] Completed Xanadu unified book storage migration');
    }

    // Migration from version 10 to 11: add harvest bucket tables
    if (fromVersion < 11) {
      this.db.exec(`
        -- Harvest buckets (temporary staging for book content)
        CREATE TABLE IF NOT EXISTS harvest_buckets (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          book_uri TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'collecting',

          queries TEXT,
          candidates TEXT,
          approved TEXT,
          gems TEXT,
          rejected TEXT,
          duplicate_ids TEXT,

          config TEXT,
          thread_uri TEXT,
          stats TEXT,

          initiated_by TEXT,
          created_at REAL NOT NULL,
          updated_at REAL,
          completed_at REAL,
          finalized_at REAL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        -- Narrative arcs
        CREATE TABLE IF NOT EXISTS narrative_arcs (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          book_uri TEXT NOT NULL,

          thesis TEXT NOT NULL,
          arc_type TEXT DEFAULT 'thematic',

          evaluation_status TEXT,
          evaluation_feedback TEXT,
          evaluated_at REAL,

          proposed_by TEXT,
          created_at REAL NOT NULL,
          updated_at REAL,

          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        -- Passage links
        CREATE TABLE IF NOT EXISTS passage_links (
          id TEXT PRIMARY KEY,
          passage_id TEXT NOT NULL,
          chapter_id TEXT NOT NULL,
          position INTEGER NOT NULL,

          section_id TEXT,
          usage_type TEXT DEFAULT 'quote',
          created_by TEXT,

          created_at REAL NOT NULL,

          FOREIGN KEY (passage_id) REFERENCES book_passages(id) ON DELETE CASCADE,
          FOREIGN KEY (chapter_id) REFERENCES book_chapters(id) ON DELETE CASCADE
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_book ON harvest_buckets(book_id);
        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_book_uri ON harvest_buckets(book_uri);
        CREATE INDEX IF NOT EXISTS idx_harvest_buckets_status ON harvest_buckets(status);

        CREATE INDEX IF NOT EXISTS idx_narrative_arcs_book ON narrative_arcs(book_id);
        CREATE INDEX IF NOT EXISTS idx_narrative_arcs_book_uri ON narrative_arcs(book_uri);

        CREATE INDEX IF NOT EXISTS idx_passage_links_passage ON passage_links(passage_id);
        CREATE INDEX IF NOT EXISTS idx_passage_links_chapter ON passage_links(chapter_id);
      `);

      console.log('[migration] Completed harvest bucket tables migration');
    }

    // Migration from version 11 to 12: add book_type column to books table
    if (fromVersion < 12) {
      // Check if column already exists (in case of partial migration)
      const tableInfo = this.db.prepare("PRAGMA table_info(books)").all() as { name: string }[];
      const hasBookType = tableInfo.some(col => col.name === 'book_type');

      if (!hasBookType) {
        this.db.exec(`
          ALTER TABLE books ADD COLUMN book_type TEXT DEFAULT 'book';
        `);
        console.log('[migration] Added book_type column to books table');
      } else {
        console.log('[migration] book_type column already exists');
      }
    }

    // Migration from version 12 to 13: add fb_outbound_reactions table
    if (fromVersion < 13) {
      this.db.exec(`
        -- Outbound reactions: reactions BY the user TO others' content
        CREATE TABLE IF NOT EXISTS fb_outbound_reactions (
          id TEXT PRIMARY KEY,
          reaction_type TEXT NOT NULL,        -- like, love, haha, wow, sad, angry
          target_type TEXT,                   -- post, photo, comment, link, video
          target_author TEXT,                 -- Person whose content was reacted to
          timestamp REAL NOT NULL,
          title TEXT,                         -- Original reaction title for reference

          -- Link to fb_people if the target author is a known person
          target_person_id TEXT,

          created_at REAL NOT NULL,

          FOREIGN KEY (target_person_id) REFERENCES fb_people(id)
        );

        CREATE INDEX IF NOT EXISTS idx_fb_outbound_reactions_type ON fb_outbound_reactions(reaction_type);
        CREATE INDEX IF NOT EXISTS idx_fb_outbound_reactions_target_type ON fb_outbound_reactions(target_type);
        CREATE INDEX IF NOT EXISTS idx_fb_outbound_reactions_target_author ON fb_outbound_reactions(target_author);
        CREATE INDEX IF NOT EXISTS idx_fb_outbound_reactions_timestamp ON fb_outbound_reactions(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_fb_outbound_reactions_person ON fb_outbound_reactions(target_person_id);
      `);
      console.log('[migration] Created fb_outbound_reactions table');
    }

    // Migration from version 13 to 14: add fb_notes table
    if (fromVersion < 14) {
      this.db.exec(`
        -- Notes: Long-form writing from Facebook Notes feature
        CREATE TABLE IF NOT EXISTS fb_notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          text TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          char_count INTEGER NOT NULL,
          created_timestamp REAL NOT NULL,
          updated_timestamp REAL,
          has_media INTEGER DEFAULT 0,
          media_count INTEGER DEFAULT 0,
          media_paths TEXT,           -- JSON array of media file paths
          tags TEXT,                  -- JSON array of tagged people names
          content_item_id TEXT,       -- Link to content_items if embedded
          metadata TEXT,
          created_at REAL NOT NULL,

          FOREIGN KEY (content_item_id) REFERENCES content_items(id)
        );

        CREATE INDEX IF NOT EXISTS idx_fb_notes_title ON fb_notes(title);
        CREATE INDEX IF NOT EXISTS idx_fb_notes_created ON fb_notes(created_timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_fb_notes_word_count ON fb_notes(word_count DESC);
        CREATE INDEX IF NOT EXISTS idx_fb_notes_content_item ON fb_notes(content_item_id);
      `);
      console.log('[migration] Created fb_notes table');
    }

    // Migration from version 14 to 15: Add universal archive columns for multi-platform support
    if (fromVersion < 15) {
      // Check which columns already exist (for idempotent migration)
      const existingColumns = this.db.prepare(`PRAGMA table_info(content_items)`).all() as Array<{ name: string }>;
      const columnNames = new Set(existingColumns.map(c => c.name));

      // Add columns one at a time (SQLite requires separate statements)
      if (!columnNames.has('uri')) {
        this.db.exec(`ALTER TABLE content_items ADD COLUMN uri TEXT`);
        console.log('[migration] Added uri column');
      }
      if (!columnNames.has('content_hash')) {
        this.db.exec(`ALTER TABLE content_items ADD COLUMN content_hash TEXT`);
        console.log('[migration] Added content_hash column');
      }
      if (!columnNames.has('source_id')) {
        this.db.exec(`ALTER TABLE content_items ADD COLUMN source_id TEXT`);
        console.log('[migration] Added source_id column');
      }
      if (!columnNames.has('imported_at')) {
        this.db.exec(`ALTER TABLE content_items ADD COLUMN imported_at REAL`);
        console.log('[migration] Added imported_at column');
      }

      // Create indexes (IF NOT EXISTS handles idempotency)
      // Note: idx_content_uri is UNIQUE but uri starts as NULL - that's OK, SQLite allows multiple NULLs
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_content_uri ON content_items(uri)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_content_hash ON content_items(content_hash)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_content_imported ON content_items(imported_at DESC)`);
      // Note: NOT creating idx_content_source_unique yet - requires source_id to be populated first
      // This will be added in a future migration after backfill

      console.log('[migration] v15 complete: universal archive columns added');
    }

    // Migration from version 15 to 16: Add fb_groups tables for group data
    if (fromVersion < 16) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fb_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          joined_at REAL,
          post_count INTEGER DEFAULT 0,
          comment_count INTEGER DEFAULT 0,
          last_activity REAL,
          metadata TEXT,
          created_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS fb_group_content (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          type TEXT NOT NULL,
          text TEXT,
          timestamp REAL NOT NULL,
          original_author TEXT,
          external_urls TEXT,
          title TEXT,
          metadata TEXT,
          created_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (group_id) REFERENCES fb_groups(id)
        );

        CREATE INDEX IF NOT EXISTS idx_fb_groups_name ON fb_groups(name);
        CREATE INDEX IF NOT EXISTS idx_fb_groups_activity ON fb_groups(last_activity DESC);
        CREATE INDEX IF NOT EXISTS idx_fb_group_content_group ON fb_group_content(group_id);
        CREATE INDEX IF NOT EXISTS idx_fb_group_content_time ON fb_group_content(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_fb_group_content_type ON fb_group_content(type);
      `);
      console.log('[migration] v16 complete: fb_groups tables created');
    }

    // Migration from version 16 to 17: Add content_blocks for granular content extraction
    if (fromVersion < 17) {
      this.db.exec(`
        -- Content blocks extracted from messages (code, prompts, artifacts, etc.)
        CREATE TABLE IF NOT EXISTS content_blocks (
          id TEXT PRIMARY KEY,
          parent_message_id TEXT NOT NULL,
          parent_conversation_id TEXT NOT NULL,

          -- Block metadata
          block_type TEXT NOT NULL,  -- code, image_prompt, artifact, canvas, transcription, prose, json_data
          language TEXT,             -- For code blocks: python, typescript, etc.
          content TEXT NOT NULL,

          -- Position in source message
          start_offset INTEGER,
          end_offset INTEGER,

          -- Context from parent conversation
          conversation_title TEXT,
          gizmo_id TEXT,             -- Custom GPT identifier (e.g., Journal Recognizer)
          created_at REAL,           -- Unix timestamp from conversation/message

          -- Additional metadata (JSON)
          metadata TEXT,

          -- Embedding reference
          embedding_id TEXT,

          -- Timestamps
          extracted_at REAL NOT NULL DEFAULT (strftime('%s', 'now')),

          FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        -- Indexes for efficient queries
        CREATE INDEX IF NOT EXISTS idx_content_blocks_message ON content_blocks(parent_message_id);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_conversation ON content_blocks(parent_conversation_id);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_type ON content_blocks(block_type);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_gizmo ON content_blocks(gizmo_id);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_created ON content_blocks(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_content_blocks_language ON content_blocks(language);
      `);

      // Create vector table for content block embeddings
      if (this.vecLoaded) {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_content_blocks USING vec0(
            id TEXT PRIMARY KEY,
            block_id TEXT,
            block_type TEXT,
            gizmo_id TEXT,
            embedding float[${EMBEDDING_DIM}]
          );
        `);
        console.log('[migration] Created vec_content_blocks vector table');
      }

      console.log('[migration] v17 complete: content_blocks table created for granular extraction');
    }

    this.db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
  }
}
