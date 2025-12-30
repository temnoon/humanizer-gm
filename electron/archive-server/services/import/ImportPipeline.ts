/**
 * ImportPipeline - Universal Import Orchestrator
 *
 * Coordinates the import process through stages:
 * 1. Detection - Identify file type and format
 * 2. Extraction - Unzip if needed, extract text from documents
 * 3. Parsing - Convert to unified ContentUnit format
 * 4. Media Storage - Store media in content-addressable store
 * 5. Database Insert - Store content units and links
 * 6. Indexing - FTS5 and semantic embedding
 *
 * Implements Xanadu principles:
 * - Every content unit gets a stable URI
 * - Bidirectional links between units
 * - Content-addressable media
 */

import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import type { EmbeddingDatabase } from '../embeddings/EmbeddingDatabase.js';
import type { ImportJobStatus, ImportSourceType } from '../embeddings/types.js';
import { ContentAddressableStore } from './media/ContentAddressableStore.js';

/**
 * Content unit produced by parsers
 */
export interface ContentUnit {
  id: string;
  uri: string;  // content://source/type/id

  // Type information
  unitType: 'document' | 'conversation' | 'message' | 'passage' | 'post' | 'comment';
  contentType: 'text' | 'markdown' | 'html' | 'json';

  // Content
  content: string;
  contentHash?: string;

  // Metrics
  wordCount: number;
  charCount: number;

  // Structural position
  parentUri?: string;
  position?: number;
  depth?: number;

  // Authorship
  authorName?: string;
  authorRole?: 'user' | 'assistant' | 'system' | 'third_party';
  isOwnContent?: boolean;

  // Timestamps
  createdAt?: number;
  updatedAt?: number;

  // Source-specific metadata
  metadata?: Record<string, unknown>;
}

/**
 * Media reference from parsing
 */
export interface MediaRef {
  contentUnitId: string;
  sourcePath: string;  // Path to file in extracted archive
  originalPointer?: string;  // sediment://, file-service://, etc.
  position?: number;
  referenceType: 'attachment' | 'embed' | 'generated' | 'upload';
  caption?: string;
}

/**
 * Link between content units
 */
export interface ContentLink {
  sourceUri: string;
  targetUri: string;
  linkType: 'parent' | 'child' | 'reference' | 'follows' | 'responds_to';
  label?: string;
}

/**
 * Result from a parser
 */
export interface ParseResult {
  units: ContentUnit[];
  mediaRefs: MediaRef[];
  links: ContentLink[];
  errors: string[];
}

/**
 * Parser interface for different source types
 */
export interface ContentParser {
  canParse(sourcePath: string): Promise<boolean>;
  parse(sourcePath: string, sourceType: ImportSourceType): Promise<ParseResult>;
}

/**
 * Import pipeline options
 */
export interface ImportOptions {
  /** Source type (auto-detected if not provided) */
  sourceType?: ImportSourceType;

  /** Name for this import (for display) */
  sourceName?: string;

  /** Skip media extraction */
  skipMedia?: boolean;

  /** Skip embedding generation */
  skipEmbeddings?: boolean;

  /** Dry run - parse only, don't store */
  dryRun?: boolean;
}

/**
 * Import progress callback
 */
export type ProgressCallback = (progress: {
  phase: string;
  progress: number;
  currentItem?: string;
  unitsProcessed?: number;
  mediaProcessed?: number;
}) => void;

/**
 * Import result
 */
export interface ImportResult {
  jobId: string;
  status: 'completed' | 'failed';
  unitsCreated: number;
  mediaStored: number;
  linksCreated: number;
  errors: string[];
  duration: number;
}

export class ImportPipeline {
  private db: EmbeddingDatabase;
  private archivePath: string;
  private mediaStore: ContentAddressableStore;
  private parsers: ContentParser[] = [];

  constructor(archivePath: string, db: EmbeddingDatabase) {
    this.archivePath = archivePath;
    this.db = db;
    this.mediaStore = new ContentAddressableStore(archivePath, db);
  }

  /**
   * Register a parser for a content type
   */
  registerParser(parser: ContentParser): void {
    this.parsers.push(parser);
  }

  /**
   * Detect the source type of a file
   */
  async detectSourceType(sourcePath: string): Promise<ImportSourceType | null> {
    const ext = path.extname(sourcePath).toLowerCase();

    // Simple extension-based detection
    switch (ext) {
      case '.txt':
        return 'txt';
      case '.md':
        return 'md';
      case '.docx':
        return 'docx';
      case '.pdf':
        return 'pdf';
      case '.odt':
        return 'odt';
      case '.zip':
        // Need to inspect contents for OpenAI/Claude/Facebook
        return await this.detectZipType(sourcePath);
      default:
        return null;
    }
  }

  /**
   * Detect the type of a ZIP archive
   */
  private async detectZipType(zipPath: string): Promise<ImportSourceType> {
    // TODO: Extract and inspect for conversations.json (Claude), mapping structure (OpenAI), etc.
    // For now, default to 'zip'
    return 'zip';
  }

  /**
   * Run the import pipeline
   */
  async import(
    sourcePath: string,
    options: ImportOptions = {},
    onProgress?: ProgressCallback
  ): Promise<ImportResult> {
    const jobId = uuidv4();
    const startTime = Date.now();
    const errors: string[] = [];

    // Create import job in database
    this.db.createImportJob({
      id: jobId,
      sourceType: options.sourceType ?? 'zip',
      sourcePath,
      sourceName: options.sourceName ?? path.basename(sourcePath),
    });

    try {
      // Phase 1: Detection
      onProgress?.({ phase: 'detection', progress: 0.05 });
      this.db.updateImportJob(jobId, {
        status: 'extracting',
        currentPhase: 'detection',
        startedAt: Date.now(),
      });

      const sourceType = options.sourceType ?? await this.detectSourceType(sourcePath);
      if (!sourceType) {
        throw new Error(`Unable to detect source type for: ${sourcePath}`);
      }

      // Phase 2: Parsing
      onProgress?.({ phase: 'parsing', progress: 0.1 });
      this.db.updateImportJob(jobId, {
        status: 'parsing',
        currentPhase: 'parsing',
        progress: 0.1,
      });

      const parseResult = await this.parseSource(sourcePath, sourceType);
      errors.push(...parseResult.errors);

      this.db.updateImportJob(jobId, {
        unitsTotal: parseResult.units.length,
        mediaTotal: parseResult.mediaRefs.length,
      });

      if (options.dryRun) {
        return {
          jobId,
          status: 'completed',
          unitsCreated: 0,
          mediaStored: 0,
          linksCreated: 0,
          errors,
          duration: Date.now() - startTime,
        };
      }

      // Phase 3: Store content units
      onProgress?.({ phase: 'storing', progress: 0.3 });
      this.db.updateImportJob(jobId, {
        status: 'indexing',
        currentPhase: 'storing',
        progress: 0.3,
      });

      let unitsCreated = 0;
      for (const unit of parseResult.units) {
        try {
          await this.storeContentUnit(unit);
          unitsCreated++;

          this.db.updateImportJob(jobId, {
            unitsProcessed: unitsCreated,
            progress: 0.3 + (0.3 * unitsCreated / parseResult.units.length),
            currentItem: unit.uri,
          });

          onProgress?.({
            phase: 'storing',
            progress: 0.3 + (0.3 * unitsCreated / parseResult.units.length),
            currentItem: unit.uri,
            unitsProcessed: unitsCreated,
          });
        } catch (err) {
          errors.push(`Failed to store unit ${unit.id}: ${err}`);
        }
      }

      // Phase 4: Store media
      onProgress?.({ phase: 'media', progress: 0.6 });
      this.db.updateImportJob(jobId, {
        currentPhase: 'media',
        progress: 0.6,
      });

      let mediaStored = 0;
      if (!options.skipMedia) {
        for (const mediaRef of parseResult.mediaRefs) {
          try {
            await this.storeMediaRef(mediaRef);
            mediaStored++;

            this.db.updateImportJob(jobId, {
              mediaProcessed: mediaStored,
              progress: 0.6 + (0.2 * mediaStored / parseResult.mediaRefs.length),
            });

            onProgress?.({
              phase: 'media',
              progress: 0.6 + (0.2 * mediaStored / parseResult.mediaRefs.length),
              mediaProcessed: mediaStored,
            });
          } catch (err) {
            errors.push(`Failed to store media: ${err}`);
          }
        }
      }

      // Phase 5: Create links
      onProgress?.({ phase: 'linking', progress: 0.8 });
      this.db.updateImportJob(jobId, {
        currentPhase: 'linking',
        progress: 0.8,
      });

      let linksCreated = 0;
      for (const link of parseResult.links) {
        try {
          this.db.insertLink({
            id: uuidv4(),
            sourceUri: link.sourceUri,
            targetUri: link.targetUri,
            linkType: link.linkType,
            label: link.label,
            createdBy: 'import',
          });
          linksCreated++;
        } catch (err) {
          errors.push(`Failed to create link: ${err}`);
        }
      }

      this.db.updateImportJob(jobId, { linksCreated });

      // Phase 6: Embeddings (optional)
      if (!options.skipEmbeddings) {
        onProgress?.({ phase: 'embedding', progress: 0.9 });
        this.db.updateImportJob(jobId, {
          status: 'embedding',
          currentPhase: 'embedding',
          progress: 0.9,
        });

        // TODO: Generate embeddings for content units
        // This will be implemented when we wire up the embedding service
      }

      // Complete
      onProgress?.({ phase: 'complete', progress: 1.0 });
      this.db.updateImportJob(jobId, {
        status: 'completed',
        progress: 1.0,
        completedAt: Date.now(),
        errorsCount: errors.length,
        errorLog: errors,
      });

      return {
        jobId,
        status: 'completed',
        unitsCreated,
        mediaStored,
        linksCreated,
        errors,
        duration: Date.now() - startTime,
      };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(errorMsg);

      this.db.updateImportJob(jobId, {
        status: 'failed',
        completedAt: Date.now(),
        errorsCount: errors.length,
        errorLog: errors,
      });

      return {
        jobId,
        status: 'failed',
        unitsCreated: 0,
        mediaStored: 0,
        linksCreated: 0,
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Parse source using registered parsers
   */
  private async parseSource(
    sourcePath: string,
    sourceType: ImportSourceType
  ): Promise<ParseResult> {
    // Find a parser that can handle this source
    for (const parser of this.parsers) {
      if (await parser.canParse(sourcePath)) {
        return parser.parse(sourcePath, sourceType);
      }
    }

    // Fallback: return empty result with error
    return {
      units: [],
      mediaRefs: [],
      links: [],
      errors: [`No parser found for source type: ${sourceType}`],
    };
  }

  /**
   * Store a content unit in the database
   */
  private async storeContentUnit(unit: ContentUnit): Promise<void> {
    // Insert into content_items table
    const db = this.db.getRawDb();

    db.prepare(`
      INSERT OR REPLACE INTO content_items
      (id, type, source, text, title, created_at, updated_at,
       author_name, is_own_content, parent_id, uri, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      unit.id,
      unit.unitType,
      'import',
      unit.content,
      unit.metadata?.title ?? null,
      unit.createdAt ?? Date.now(),
      unit.updatedAt ?? null,
      unit.authorName ?? null,
      unit.isOwnContent ? 1 : 0,
      unit.parentUri ?? null,
      unit.uri,
      unit.metadata ? JSON.stringify(unit.metadata) : null
    );
  }

  /**
   * Store a media reference
   */
  private async storeMediaRef(ref: MediaRef): Promise<void> {
    if (!existsSync(ref.sourcePath)) {
      throw new Error(`Media file not found: ${ref.sourcePath}`);
    }

    // Store in content-addressable store
    const result = await this.mediaStore.store(ref.sourcePath);

    // Create media reference linking content to media
    this.db.insertMediaReference({
      id: uuidv4(),
      contentId: ref.contentUnitId,
      mediaHash: result.contentHash,
      position: ref.position,
      referenceType: ref.referenceType,
      originalPointer: ref.originalPointer,
      caption: ref.caption,
    });
  }

  /**
   * Get import job status
   */
  getJobStatus(jobId: string) {
    return this.db.getImportJob(jobId);
  }

  /**
   * Get recent import jobs
   */
  getRecentJobs(limit = 10) {
    return this.db.getRecentImportJobs(limit);
  }
}

/**
 * Create an ImportPipeline instance
 */
export function createImportPipeline(
  archivePath: string,
  db: EmbeddingDatabase
): ImportPipeline {
  return new ImportPipeline(archivePath, db);
}
