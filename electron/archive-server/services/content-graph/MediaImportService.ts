/**
 * MediaImportService - Unified media handling for all content adapters
 *
 * BEST PRACTICE: All adapters must use this service to handle media during import.
 *
 * The Problem:
 * - Each platform stores media differently (Instagram, Reddit, Facebook, etc.)
 * - Renderers need a standard format: ![alt](/api/ucg/media/by-hash/{hash})
 * - Without standardization, images don't render in cards, previews, workspace
 *
 * The Solution:
 * - Adapters call indexMediaFile() for each media file during import
 * - Service copies file to managed storage (~/.humanizer/media/) using hash as filename
 * - Adapters rewrite content to use standard markdown: ![image](ucg-url)
 *
 * Two Representations:
 * - Archive Canonical: Original platform path (stored in sourceMetadata.originalMediaRefs)
 * - Working Copy: UCG URL in content.text that renderers can resolve
 *
 * Media Storage:
 * - Files are copied to ~/.humanizer/media/{hash}{ext}
 * - Original exports can be deleted after import
 * - Hash-based naming provides automatic deduplication
 *
 * Usage in adapters:
 * ```typescript
 * const mediaService = new MediaImportService(exportBasePath);
 *
 * // For each media reference found in content:
 * const result = mediaService.indexMediaFile('relative/path/to/image.jpg');
 * if (result) {
 *   content += `![image](${result.url})`;
 * }
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getMediaStoragePath } from '../../config.js';

/**
 * Result of indexing a media file
 */
export interface MediaIndexResult {
  /** SHA256 hash of file content */
  hash: string;
  /** UCG-resolvable URL for renderers */
  url: string;
  /** MIME type of the file */
  mimeType: string | null;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  fileSize: number;
  /** Path to the managed copy in ~/.humanizer/media/ */
  managedPath: string;
  /** File extension (e.g., '.jpg') */
  extension: string;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    // Documents
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
 * MediaImportService - Handles media indexing during content import
 *
 * Each adapter should create an instance with the export base path,
 * then call indexMediaFile() for each media reference found.
 * Files are automatically copied to the managed storage folder.
 */
export class MediaImportService {
  private basePath: string;
  private mediaStoragePath: string;
  private indexedFiles: Map<string, MediaIndexResult> = new Map();
  private copiedHashes: Set<string> = new Set();

  /**
   * Create a new MediaImportService
   *
   * @param basePath - Base path of the export (e.g., /Users/tem/Downloads/instagram-export)
   */
  constructor(basePath: string) {
    this.basePath = basePath;
    this.mediaStoragePath = getMediaStoragePath();

    // Ensure media storage directory exists
    if (!fs.existsSync(this.mediaStoragePath)) {
      fs.mkdirSync(this.mediaStoragePath, { recursive: true });
    }
  }

  /**
   * Index a media file and return a UCG-resolvable URL
   * Copies the file to managed storage if not already present.
   *
   * @param relativePath - Path relative to basePath (e.g., 'media/posts/image.jpg')
   * @returns MediaIndexResult with hash and URL, or null if file doesn't exist
   */
  indexMediaFile(relativePath: string): MediaIndexResult | null {
    // Normalize path
    const normalizedPath = relativePath.replace(/\\/g, '/');

    // Check cache first
    if (this.indexedFiles.has(normalizedPath)) {
      return this.indexedFiles.get(normalizedPath)!;
    }

    // Build absolute path to source file
    const sourcePath = path.join(this.basePath, normalizedPath);

    // Check if file exists
    if (!fs.existsSync(sourcePath)) {
      console.warn(`[MediaImportService] File not found: ${sourcePath}`);
      return null;
    }

    try {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) {
        return null;
      }

      // Compute hash
      const hash = computeFileHash(sourcePath);
      const filename = path.basename(sourcePath);
      const extension = path.extname(filename).toLowerCase();
      const mimeType = getMimeType(filename);

      // Determine managed path (hash-based filename)
      const managedFilename = `${hash}${extension}`;
      const managedPath = path.join(this.mediaStoragePath, managedFilename);

      // Copy file to managed storage if not already there
      if (!this.copiedHashes.has(hash) && !fs.existsSync(managedPath)) {
        fs.copyFileSync(sourcePath, managedPath);
        console.log(`[MediaImportService] Copied: ${filename} -> ${managedFilename}`);
      }
      this.copiedHashes.add(hash);

      const result: MediaIndexResult = {
        hash,
        url: `/api/ucg/media/by-hash/${hash}`,
        mimeType,
        filename,
        fileSize: stat.size,
        managedPath,
        extension,
      };

      // Cache result
      this.indexedFiles.set(normalizedPath, result);

      return result;
    } catch (error) {
      console.error(`[MediaImportService] Error indexing ${relativePath}:`, error);
      return null;
    }
  }

  /**
   * Index a media file by absolute path
   */
  indexMediaFileAbsolute(absolutePath: string): MediaIndexResult | null {
    if (!fs.existsSync(absolutePath)) {
      console.warn(`[MediaImportService] File not found: ${absolutePath}`);
      return null;
    }

    // Check cache by absolute path
    if (this.indexedFiles.has(absolutePath)) {
      return this.indexedFiles.get(absolutePath)!;
    }

    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        return null;
      }

      const hash = computeFileHash(absolutePath);
      const filename = path.basename(absolutePath);
      const extension = path.extname(filename).toLowerCase();
      const mimeType = getMimeType(filename);

      // Determine managed path (hash-based filename)
      const managedFilename = `${hash}${extension}`;
      const managedPath = path.join(this.mediaStoragePath, managedFilename);

      // Copy file to managed storage if not already there
      if (!this.copiedHashes.has(hash) && !fs.existsSync(managedPath)) {
        fs.copyFileSync(absolutePath, managedPath);
        console.log(`[MediaImportService] Copied: ${filename} -> ${managedFilename}`);
      }
      this.copiedHashes.add(hash);

      const result: MediaIndexResult = {
        hash,
        url: `/api/ucg/media/by-hash/${hash}`,
        mimeType,
        filename,
        fileSize: stat.size,
        managedPath,
        extension,
      };

      // Cache result
      this.indexedFiles.set(absolutePath, result);

      return result;
    } catch (error) {
      console.error(`[MediaImportService] Error indexing ${absolutePath}:`, error);
      return null;
    }
  }

  /**
   * Convert platform-specific media reference to UCG markdown
   *
   * @param originalRef - Original reference (e.g., 'media/posts/image.jpg')
   * @param altText - Alt text for the image (optional)
   * @returns Markdown image string or null if file not found
   */
  toMarkdownImage(originalRef: string, altText: string = 'image'): string | null {
    const result = this.indexMediaFile(originalRef);
    if (!result) return null;

    return `![${altText}](${result.url})`;
  }

  /**
   * Rewrite content to replace platform media references with UCG URLs
   *
   * @param content - Original content with platform-specific references
   * @param mediaRefs - Array of {original, replacement} or just original paths
   * @returns Rewritten content with UCG URLs
   */
  rewriteMediaReferences(
    content: string,
    mediaRefs: Array<{ original: string; altText?: string }>
  ): { content: string; indexed: MediaIndexResult[]; failed: string[] } {
    let rewrittenContent = content;
    const indexed: MediaIndexResult[] = [];
    const failed: string[] = [];

    for (const ref of mediaRefs) {
      const result = this.indexMediaFile(ref.original);
      if (result) {
        indexed.push(result);
        // Replace file:// URLs or raw paths with UCG URLs
        const patterns = [
          `file://${path.join(this.basePath, ref.original)}`,
          `file://${ref.original}`,
          ref.original,
        ];
        for (const pattern of patterns) {
          rewrittenContent = rewrittenContent.replace(pattern, result.url);
        }
      } else {
        failed.push(ref.original);
      }
    }

    return { content: rewrittenContent, indexed, failed };
  }

  /**
   * Get statistics about indexed media
   */
  getStats(): { totalIndexed: number; totalSize: number; totalCopied: number; byMimeType: Record<string, number> } {
    const byMimeType: Record<string, number> = {};
    let totalSize = 0;

    for (const result of this.indexedFiles.values()) {
      totalSize += result.fileSize;
      const mime = result.mimeType || 'unknown';
      byMimeType[mime] = (byMimeType[mime] || 0) + 1;
    }

    return {
      totalIndexed: this.indexedFiles.size,
      totalSize,
      totalCopied: this.copiedHashes.size,
      byMimeType,
    };
  }

  /**
   * Clear the cache (useful between imports)
   */
  clearCache(): void {
    this.indexedFiles.clear();
    this.copiedHashes.clear();
  }

  /**
   * Get the managed storage path
   */
  getMediaStoragePath(): string {
    return this.mediaStoragePath;
  }
}

/**
 * Create a MediaImportService for an export directory
 */
export function createMediaImportService(exportBasePath: string): MediaImportService {
  return new MediaImportService(exportBasePath);
}
