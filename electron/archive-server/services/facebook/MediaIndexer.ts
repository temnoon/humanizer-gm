// MediaIndexer - Scans Facebook export and populates media_items table
// Indexes images and videos from posts, albums, messages, etc.
// Links media back to posts/comments via media_refs matching

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

interface MediaItem {
  id: string;
  source_type: string;
  media_type: string;
  file_path: string;
  filename: string;
  file_size: number;
  width?: number;
  height?: number;
  created_at: number;
  description?: string;
  context?: string;
  context_id?: string;
  related_post_id?: string;
  metadata?: string;
}

interface IndexResult {
  totalScanned: number;
  totalIndexed: number;
  linkedToContent: number;
  errors: string[];
  bySourceType: Record<string, number>;
}

export class MediaIndexer {
  private db: Database.Database;
  private exportPath: string;
  private archivePath: string;

  // Map of file path -> content_item ids that reference it
  private mediaRefsMap: Map<string, string[]> = new Map();

  constructor(exportPath: string, archivePath: string) {
    this.exportPath = exportPath;
    this.archivePath = archivePath;
    this.db = new Database(path.join(archivePath, '.embeddings.db'));
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        media_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at REAL NOT NULL,
        description TEXT,
        tags TEXT,
        context TEXT,
        context_id TEXT,
        related_post_id TEXT,
        exif_data TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_media_source_type ON media_items(source_type);
      CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(media_type);
      CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_media_file_path ON media_items(file_path);
    `);
  }

  /**
   * Build reverse index from content_items.media_refs
   */
  private buildMediaRefsMap(): void {
    const items = this.db.prepare(`
      SELECT id, media_refs
      FROM content_items
      WHERE media_refs IS NOT NULL AND media_refs != '' AND media_refs != '[]'
    `).all() as Array<{ id: string; media_refs: string }>;

    for (const item of items) {
      try {
        const refs = JSON.parse(item.media_refs) as string[];
        for (const ref of refs) {
          if (!this.mediaRefsMap.has(ref)) {
            this.mediaRefsMap.set(ref, []);
          }
          this.mediaRefsMap.get(ref)!.push(item.id);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    console.log(`📁 Built media refs map: ${this.mediaRefsMap.size} unique file paths`);
  }

  /**
   * Index all media from Facebook export
   */
  async indexAll(options: {
    onProgress?: (current: number, total: number, path: string) => void;
  } = {}): Promise<IndexResult> {
    const { onProgress } = options;

    const result: IndexResult = {
      totalScanned: 0,
      totalIndexed: 0,
      linkedToContent: 0,
      errors: [],
      bySourceType: {}
    };

    // Build reverse map from content_items
    this.buildMediaRefsMap();

    // Define media directories to scan
    const mediaDirs: Array<{ path: string; sourceType: string; contextExtractor?: (filePath: string) => string }> = [
      {
        path: path.join(this.exportPath, 'your_facebook_activity/posts/media'),
        sourceType: 'post',
      },
      {
        path: path.join(this.exportPath, 'your_facebook_activity/posts/album'),
        sourceType: 'album',
      },
      {
        path: path.join(this.exportPath, 'your_facebook_activity/messages/inbox'),
        sourceType: 'message',
        contextExtractor: (filePath: string) => {
          // Extract thread name from path
          const match = filePath.match(/inbox\/([^/]+)\//);
          return match ? match[1] : '';
        }
      },
      {
        path: path.join(this.exportPath, 'your_facebook_activity/events'),
        sourceType: 'event',
      },
      {
        path: path.join(this.exportPath, 'your_facebook_activity/groups'),
        sourceType: 'group',
      },
    ];

    // Collect all media files
    const allFiles: Array<{ filePath: string; sourceType: string; context?: string }> = [];

    for (const dir of mediaDirs) {
      if (!fs.existsSync(dir.path)) continue;

      const files = this.findMediaFiles(dir.path);
      for (const filePath of files) {
        const context = dir.contextExtractor ? dir.contextExtractor(filePath) : undefined;
        allFiles.push({ filePath, sourceType: dir.sourceType, context });
      }
    }

    console.log(`📷 Found ${allFiles.length} media files to index`);

    // Prepare insert statement
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO media_items (
        id, source_type, media_type, file_path, filename, file_size,
        width, height, created_at, description, context, context_id,
        related_post_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Process files in batches
    const batchSize = 100;
    const insertMany = this.db.transaction((items: MediaItem[]) => {
      for (const item of items) {
        insertStmt.run(
          item.id,
          item.source_type,
          item.media_type,
          item.file_path,
          item.filename,
          item.file_size,
          item.width || null,
          item.height || null,
          item.created_at,
          item.description || null,
          item.context || null,
          item.context_id || null,
          item.related_post_id || null,
          item.metadata || null
        );
      }
    });

    let batch: MediaItem[] = [];

    for (let i = 0; i < allFiles.length; i++) {
      const { filePath, sourceType, context } = allFiles[i];
      result.totalScanned++;

      if (onProgress && i % 100 === 0) {
        onProgress(i, allFiles.length, filePath);
      }

      try {
        const mediaItem = await this.processMediaFile(filePath, sourceType, context);
        if (mediaItem) {
          batch.push(mediaItem);
          result.totalIndexed++;
          result.bySourceType[sourceType] = (result.bySourceType[sourceType] || 0) + 1;

          if (mediaItem.related_post_id) {
            result.linkedToContent++;
          }

          if (batch.length >= batchSize) {
            insertMany(batch);
            batch = [];
          }
        }
      } catch (e) {
        result.errors.push(`Error processing ${filePath}: ${e}`);
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      insertMany(batch);
    }

    console.log(`✅ Indexed ${result.totalIndexed} media items, ${result.linkedToContent} linked to content`);
    return result;
  }

  /**
   * Find all media files in a directory recursively
   */
  private findMediaFiles(dir: string): string[] {
    const files: string[] = [];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const videoExts = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
    const allExts = [...imageExts, ...videoExts];

    const walk = (currentDir: string) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (allExts.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (e) {
        // Ignore permission errors
      }
    };

    walk(dir);
    return files;
  }

  /**
   * Process a single media file
   */
  private async processMediaFile(
    filePath: string,
    sourceType: string,
    context?: string
  ): Promise<MediaItem | null> {
    try {
      const stats = fs.statSync(filePath);
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase();

      const mediaType = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)
        ? 'image'
        : 'video';

      // Generate unique ID from path
      const id = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 16);

      // Try to get image dimensions
      let width: number | undefined;
      let height: number | undefined;

      if (mediaType === 'image') {
        const dimensions = this.getImageDimensions(filePath);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
        }
      }

      // Use file mtime as created_at (Facebook doesn't preserve original timestamps reliably)
      const created_at = Math.floor(stats.mtime.getTime() / 1000);

      // Check if any content_items reference this file
      const relatedIds = this.mediaRefsMap.get(filePath);
      const related_post_id = relatedIds && relatedIds.length > 0 ? relatedIds[0] : undefined;

      return {
        id: `fb_media_${id}`,
        source_type: sourceType,
        media_type: mediaType,
        file_path: filePath,
        filename,
        file_size: stats.size,
        width,
        height,
        created_at,
        context,
        related_post_id,
        metadata: relatedIds && relatedIds.length > 1
          ? JSON.stringify({ all_related_ids: relatedIds })
          : undefined
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get image dimensions using file header parsing (fast, no external deps)
   */
  private getImageDimensions(filePath: string): { width: number; height: number } | null {
    try {
      const buffer = Buffer.alloc(24);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 24, 0);
      fs.closeSync(fd);

      // PNG
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return {
          width: buffer.readUInt32BE(16),
          height: buffer.readUInt32BE(20)
        };
      }

      // JPEG
      if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        const fullBuffer = fs.readFileSync(filePath);
        let offset = 2;
        while (offset < fullBuffer.length) {
          if (fullBuffer[offset] !== 0xFF) break;
          const marker = fullBuffer[offset + 1];
          if (marker === 0xC0 || marker === 0xC2) {
            return {
              height: fullBuffer.readUInt16BE(offset + 5),
              width: fullBuffer.readUInt16BE(offset + 7)
            };
          }
          offset += 2 + fullBuffer.readUInt16BE(offset + 2);
        }
      }

      // GIF
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return {
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8)
        };
      }

      // WebP
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        // VP8 lossy
        if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
          const fullBuffer = fs.readFileSync(filePath);
          return {
            width: (fullBuffer.readUInt16LE(26) & 0x3FFF),
            height: (fullBuffer.readUInt16LE(28) & 0x3FFF)
          };
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get statistics about indexed media
   */
  getStats(): {
    total: number;
    bySourceType: Record<string, number>;
    byMediaType: Record<string, number>;
    linkedCount: number;
    totalSizeBytes: number;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM media_items').get() as { count: number }).count;

    const bySourceType: Record<string, number> = {};
    const sourceRows = this.db.prepare(`
      SELECT source_type, COUNT(*) as count FROM media_items GROUP BY source_type
    `).all() as Array<{ source_type: string; count: number }>;
    for (const row of sourceRows) {
      bySourceType[row.source_type] = row.count;
    }

    const byMediaType: Record<string, number> = {};
    const typeRows = this.db.prepare(`
      SELECT media_type, COUNT(*) as count FROM media_items GROUP BY media_type
    `).all() as Array<{ media_type: string; count: number }>;
    for (const row of typeRows) {
      byMediaType[row.media_type] = row.count;
    }

    const linkedCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items WHERE related_post_id IS NOT NULL
    `).get() as { count: number }).count;

    const totalSizeBytes = (this.db.prepare(`
      SELECT SUM(file_size) as total FROM media_items
    `).get() as { total: number }).total || 0;

    return { total, bySourceType, byMediaType, linkedCount, totalSizeBytes };
  }

  close(): void {
    this.db.close();
  }
}
