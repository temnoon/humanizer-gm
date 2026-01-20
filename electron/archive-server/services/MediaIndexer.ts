/**
 * MediaIndexer - Indexes media files from conversation archives
 *
 * Scans conversation folders for media files and creates entries in media_items table.
 * Also provides methods to query media by conversation folder.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getArchiveRoot } from '../config.js';
import { getEmbeddingDatabase } from './registry.js';

interface MediaManifest {
  [key: string]: string; // shortId -> actualFilename
}

interface IndexProgress {
  totalFolders: number;
  processedFolders: number;
  totalMedia: number;
  indexedMedia: number;
  errors: string[];
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
  };
  return mimeTypes[ext] || null;
}

/**
 * Compute SHA256 hash of file content
 */
function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Index media from a single conversation folder
 */
function indexConversationMedia(
  archiveRoot: string,
  folderName: string,
  progress: IndexProgress
): void {
  const folderPath = path.join(archiveRoot, folderName);
  const mediaPath = path.join(folderPath, 'media');

  // Check if media folder exists
  if (!fs.existsSync(mediaPath)) {
    return;
  }

  const embDb = getEmbeddingDatabase().getRawDb();

  // Get list of media files
  const mediaFiles = fs.readdirSync(mediaPath).filter(f => !f.startsWith('.'));
  progress.totalMedia += mediaFiles.length;

  // Prepare insert statement
  const insertMedia = embDb.prepare(`
    INSERT OR IGNORE INTO media_items (
      id, content_hash, file_path, original_filename, mime_type, file_size,
      width, height, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
  `);

  // Process each media file
  for (const filename of mediaFiles) {
    try {
      const filePath = path.join(mediaPath, filename);
      const relativePath = path.join(folderName, 'media', filename);
      const stat = fs.statSync(filePath);

      // Compute content hash
      const contentHash = computeFileHash(filePath);

      // Get mime type
      const mimeType = getMimeType(filename);

      // Insert into media_items
      const mediaId = crypto.randomUUID();
      insertMedia.run(
        mediaId,
        contentHash,
        relativePath,
        filename,
        mimeType,
        stat.size,
        Date.now()
      );

      progress.indexedMedia++;
    } catch (error) {
      progress.errors.push(`Failed to index ${filename} in ${folderName}: ${error}`);
    }
  }
}

/**
 * Index all media in the archive
 */
export async function indexAllMedia(
  onProgress?: (progress: IndexProgress) => void
): Promise<IndexProgress> {
  const archiveRoot = getArchiveRoot();

  const progress: IndexProgress = {
    totalFolders: 0,
    processedFolders: 0,
    totalMedia: 0,
    indexedMedia: 0,
    errors: [],
  };

  // Get list of conversation folders
  const entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  progress.totalFolders = folders.length;
  onProgress?.(progress);

  console.log(`[MediaIndexer] Starting indexing of ${folders.length} folders`);

  // Process each folder
  for (const folder of folders) {
    indexConversationMedia(archiveRoot, folder, progress);
    progress.processedFolders++;

    // Report progress every 50 folders
    if (progress.processedFolders % 50 === 0) {
      console.log(`[MediaIndexer] Progress: ${progress.processedFolders}/${progress.totalFolders} folders, ${progress.indexedMedia} media indexed`);
      onProgress?.(progress);
    }
  }

  console.log(`[MediaIndexer] Complete: ${progress.indexedMedia} media items indexed`);

  if (progress.errors.length > 0) {
    console.warn(`[MediaIndexer] ${progress.errors.length} errors occurred`);
  }

  return progress;
}

/**
 * Get media for a conversation folder
 *
 * First tries database lookup by path. If empty (due to hash deduplication),
 * falls back to scanning the folder directly.
 */
export function getMediaForFolder(folderName: string): Array<{
  hash: string;
  url: string;
  mimeType: string | null;
  filename: string;
  fileSize: number;
}> {
  const embDb = getEmbeddingDatabase().getRawDb();

  // Try database lookup first
  const results = embDb.prepare(`
    SELECT content_hash, file_path, mime_type, original_filename, file_size
    FROM media_items
    WHERE file_path LIKE ?
    ORDER BY original_filename
  `).all(`${folderName}/media/%`) as Array<{
    content_hash: string;
    file_path: string;
    mime_type: string | null;
    original_filename: string;
    file_size: number;
  }>;

  if (results.length > 0) {
    return results.map(row => ({
      hash: row.content_hash,
      url: `/api/ucg/media/by-hash/${row.content_hash}`,
      mimeType: row.mime_type,
      filename: row.original_filename,
      fileSize: row.file_size,
    }));
  }

  // Fallback: scan folder directly (handles duplicate files stored under different folders)
  const archiveRoot = getArchiveRoot();
  const mediaPath = path.join(archiveRoot, folderName, 'media');

  if (!fs.existsSync(mediaPath)) {
    return [];
  }

  const mediaFiles = fs.readdirSync(mediaPath).filter(f => !f.startsWith('.'));

  return mediaFiles.map(filename => {
    const filePath = path.join(mediaPath, filename);
    const stat = fs.statSync(filePath);
    const contentHash = computeFileHash(filePath);
    const mimeType = getMimeType(filename);

    return {
      hash: contentHash,
      url: `/api/ucg/media/by-hash/${contentHash}`,
      mimeType,
      filename,
      fileSize: stat.size,
    };
  });
}

/**
 * Get media indexing statistics
 */
export function getMediaStats(): {
  mediaItems: number;
  foldersWithMedia: number;
  totalSize: number;
} {
  const embDb = getEmbeddingDatabase().getRawDb();

  const mediaCount = embDb.prepare('SELECT COUNT(*) as count FROM media_items').get() as { count: number };
  const totalSize = embDb.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM media_items').get() as { total: number };

  // Count folders with media
  const archiveRoot = getArchiveRoot();
  let foldersWithMedia = 0;

  try {
    const entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const mediaPath = path.join(archiveRoot, entry.name, 'media');
        if (fs.existsSync(mediaPath)) {
          const files = fs.readdirSync(mediaPath).filter(f => !f.startsWith('.'));
          if (files.length > 0) {
            foldersWithMedia++;
          }
        }
      }
    }
  } catch (error) {
    console.error('[MediaIndexer] Error counting folders:', error);
  }

  return {
    mediaItems: mediaCount.count,
    foldersWithMedia,
    totalSize: totalSize.total,
  };
}

/**
 * Get all folders that have media
 */
export function getFoldersWithMedia(): string[] {
  const archiveRoot = getArchiveRoot();
  const foldersWithMedia: string[] = [];

  try {
    const entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const mediaPath = path.join(archiveRoot, entry.name, 'media');
        if (fs.existsSync(mediaPath)) {
          const files = fs.readdirSync(mediaPath).filter(f => !f.startsWith('.'));
          if (files.length > 0) {
            foldersWithMedia.push(entry.name);
          }
        }
      }
    }
  } catch (error) {
    console.error('[MediaIndexer] Error listing folders:', error);
  }

  return foldersWithMedia;
}
