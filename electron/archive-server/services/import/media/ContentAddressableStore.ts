/**
 * ContentAddressableStore - Hash-based media storage
 *
 * Stores media files by their SHA-256 content hash for:
 * - Automatic deduplication (same file = same hash)
 * - Stable addressing (content never changes for a hash)
 * - Simplified matching (no more 7-strategy lookup)
 *
 * Storage structure:
 *   media/{hash[0:2]}/{hash[2:4]}/{hash}.{ext}
 *
 * Example:
 *   File: photo.jpg (SHA-256: a1b2c3d4e5f6...)
 *   Path: media/a1/b2/a1b2c3d4e5f6...jpg
 */

import * as fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { EmbeddingDatabase } from '../../embeddings/EmbeddingDatabase.js';

/**
 * Result of storing a media file
 */
export interface StoreResult {
  id: string;
  contentHash: string;
  filePath: string;  // Relative path from archive root
  isNew: boolean;    // true if newly stored, false if already existed
  fileSize: number;
  mimeType: string | null;
}

/**
 * Manifest mapping various pointer types to content hashes
 */
export interface PointerManifest {
  // sediment://file_{hash} → content hash
  sedimentToHash: Map<string, string>;

  // file-service://file-{ID} → content hash
  fileIdToHash: Map<string, string>;

  // file size → [content hashes with that size]
  sizeToHashes: Map<number, string[]>;

  // original filename → content hash (least reliable)
  filenameToHash: Map<string, string>;
}

/**
 * MIME type detection based on file extension
 */
const MIME_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',

  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',

  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
};

/**
 * Media file extensions for filtering
 */
const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.pdf',
]);

export class ContentAddressableStore {
  private archivePath: string;
  private mediaDir: string;
  private db: EmbeddingDatabase;

  constructor(archivePath: string, db: EmbeddingDatabase) {
    this.archivePath = archivePath;
    this.mediaDir = path.join(archivePath, 'media');
    this.db = db;
  }

  /**
   * Ensure media directory exists
   */
  async ensureMediaDir(): Promise<void> {
    await fs.mkdir(this.mediaDir, { recursive: true });
  }

  /**
   * Compute SHA-256 hash of file content
   */
  async hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Get MIME type from file extension
   */
  getMimeType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] ?? null;
  }

  /**
   * Check if a file is a media file
   */
  isMediaFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return MEDIA_EXTENSIONS.has(ext);
  }

  /**
   * Generate the storage path for a content hash
   * Uses sharded directory structure: {hash[0:2]}/{hash[2:4]}/{hash}.{ext}
   */
  getStoragePath(contentHash: string, ext: string): string {
    const shard1 = contentHash.slice(0, 2);
    const shard2 = contentHash.slice(2, 4);
    return path.join('media', shard1, shard2, `${contentHash}${ext}`);
  }

  /**
   * Store a media file by content hash
   *
   * @param sourcePath - Path to the source file
   * @param originalFilename - Original filename (for metadata)
   * @returns StoreResult with hash and path info
   */
  async store(sourcePath: string, originalFilename?: string): Promise<StoreResult> {
    await this.ensureMediaDir();

    // Compute hash
    const contentHash = await this.hashFile(sourcePath);

    // Check if already in database
    const existing = this.db.getMediaByHash(contentHash);
    if (existing) {
      const stats = await fs.stat(sourcePath);
      return {
        id: existing.id,
        contentHash,
        filePath: existing.filePath,
        isNew: false,
        fileSize: stats.size,
        mimeType: existing.mimeType,
      };
    }

    // Get file metadata
    const stats = await fs.stat(sourcePath);
    const ext = path.extname(sourcePath).toLowerCase();
    const mimeType = this.getMimeType(sourcePath);

    // Generate storage path
    const relativePath = this.getStoragePath(contentHash, ext);
    const absolutePath = path.join(this.archivePath, relativePath);

    // Create sharded directory
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Copy file to content-addressed location
    await fs.copyFile(sourcePath, absolutePath);

    // Generate ID and store in database
    const id = uuidv4();
    this.db.upsertMediaItem({
      id,
      contentHash,
      filePath: relativePath,
      originalFilename: originalFilename ?? path.basename(sourcePath),
      mimeType: mimeType ?? undefined,
      fileSize: stats.size,
    });

    return {
      id,
      contentHash,
      filePath: relativePath,
      isNew: true,
      fileSize: stats.size,
      mimeType,
    };
  }

  /**
   * Get media item by content hash
   */
  getByHash(contentHash: string): {
    id: string;
    filePath: string;
    absolutePath: string;
  } | null {
    const item = this.db.getMediaByHash(contentHash);
    if (!item) return null;

    return {
      id: item.id,
      filePath: item.filePath,
      absolutePath: path.join(this.archivePath, item.filePath),
    };
  }

  /**
   * Check if a hash exists in the store
   */
  hasHash(contentHash: string): boolean {
    return this.db.getMediaByHash(contentHash) !== null;
  }

  /**
   * Build a pointer manifest from extracted archive files
   * This maps various OpenAI pointer formats to content hashes
   */
  async buildPointerManifest(extractedDir: string): Promise<PointerManifest> {
    const manifest: PointerManifest = {
      sedimentToHash: new Map(),
      fileIdToHash: new Map(),
      sizeToHashes: new Map(),
      filenameToHash: new Map(),
    };

    // Walk all files in extracted directory
    const files = await this.walkDirectory(extractedDir);

    for (const filePath of files) {
      if (!this.isMediaFile(filePath)) continue;

      try {
        const contentHash = await this.hashFile(filePath);
        const stats = await fs.stat(filePath);
        const basename = path.basename(filePath);

        // Extract sediment:// pattern: file_{32-hex}-{uuid}.ext
        const sedimentMatch = basename.match(/^(file_[a-f0-9]{32})-[a-f0-9-]{36}\./i);
        if (sedimentMatch) {
          manifest.sedimentToHash.set(`sediment://${sedimentMatch[1]}`, contentHash);
        }

        // Extract file-service:// pattern: file-{ID}_name.ext or file-{ID}-{uuid}.ext
        const fileIdMatch = basename.match(/^(file-[A-Za-z0-9]+)[_-]/);
        if (fileIdMatch) {
          manifest.fileIdToHash.set(`file-service://${fileIdMatch[1]}`, contentHash);
        }

        // Size-based lookup
        const size = stats.size;
        if (!manifest.sizeToHashes.has(size)) {
          manifest.sizeToHashes.set(size, []);
        }
        manifest.sizeToHashes.get(size)!.push(contentHash);

        // Filename lookup (least reliable, but useful fallback)
        manifest.filenameToHash.set(basename.toLowerCase(), contentHash);

      } catch (err) {
        console.warn(`[ContentAddressableStore] Error processing ${filePath}:`, err);
      }
    }

    return manifest;
  }

  /**
   * Resolve a media reference to a content hash using the manifest
   */
  resolvePointer(
    pointer: string | undefined,
    size: number | undefined,
    filename: string | undefined,
    manifest: PointerManifest
  ): string | null {
    // Strategy 1: Direct sediment:// match (most reliable)
    if (pointer?.startsWith('sediment://')) {
      const hash = manifest.sedimentToHash.get(pointer);
      if (hash) return hash;
    }

    // Strategy 2: file-service:// match
    if (pointer?.startsWith('file-service://')) {
      const hash = manifest.fileIdToHash.get(pointer);
      if (hash) return hash;
    }

    // Strategy 3: Size-based match (if unique)
    if (size && manifest.sizeToHashes.has(size)) {
      const candidates = manifest.sizeToHashes.get(size)!;
      if (candidates.length === 1) {
        return candidates[0];
      }
      // If multiple candidates, try filename disambiguation
      if (filename && candidates.length > 1) {
        const filenameHash = manifest.filenameToHash.get(filename.toLowerCase());
        if (filenameHash && candidates.includes(filenameHash)) {
          return filenameHash;
        }
      }
    }

    // Strategy 4: Filename-only match (least reliable)
    if (filename) {
      const hash = manifest.filenameToHash.get(filename.toLowerCase());
      if (hash) return hash;
    }

    return null;
  }

  /**
   * Walk a directory recursively and return all file paths
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDir: string) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    }

    if (existsSync(dir)) {
      await walk(dir);
    }

    return files;
  }

  /**
   * Store all media files from a directory
   * Returns a map of original paths to content hashes
   */
  async storeDirectory(dir: string): Promise<Map<string, StoreResult>> {
    const results = new Map<string, StoreResult>();
    const files = await this.walkDirectory(dir);

    for (const filePath of files) {
      if (!this.isMediaFile(filePath)) continue;

      try {
        const result = await this.store(filePath, path.basename(filePath));
        results.set(filePath, result);
      } catch (err) {
        console.error(`[ContentAddressableStore] Failed to store ${filePath}:`, err);
      }
    }

    return results;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byMimeType: Record<string, number>;
  }> {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byMimeType: {} as Record<string, number>,
    };

    const files = await this.walkDirectory(this.mediaDir);

    for (const filePath of files) {
      try {
        const fileStats = await fs.stat(filePath);
        stats.totalFiles++;
        stats.totalSize += fileStats.size;

        const mimeType = this.getMimeType(filePath) ?? 'unknown';
        stats.byMimeType[mimeType] = (stats.byMimeType[mimeType] ?? 0) + 1;
      } catch {
        // Skip files we can't stat
      }
    }

    return stats;
  }
}

/**
 * Create a ContentAddressableStore instance
 */
export function createContentAddressableStore(
  archivePath: string,
  db: EmbeddingDatabase
): ContentAddressableStore {
  return new ContentAddressableStore(archivePath, db);
}
