/**
 * ThumbnailService - Lazy video thumbnail generation with caching
 *
 * Thumbnails are stored in .thumbnails/ subdirectory within archive
 * Named by video file hash: {md5_hash}.jpg
 *
 * Features:
 * - Lazy generation on first request
 * - Deduplication for concurrent requests
 * - 30-second timeout protection
 * - Configurable thumbnail size
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getFfmpegPath, isFFmpegAvailable } from './ffmpeg-path';
import { probeVideo } from './VideoProbeService';

export interface ThumbnailOptions {
  /** Thumbnail width in pixels. Default: 320 */
  width?: number;
  /** JPEG quality 1-31 (lower = better). Default: 5 */
  quality?: number;
  /** Seconds into video to capture. Default: 1 */
  seekSeconds?: number;
}

export interface ThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  cached: boolean;
  error?: string;
  /** True if the file is audio-only (no video track) */
  audioOnly?: boolean;
}

export class ThumbnailService {
  private archivePath: string;
  private thumbnailDir: string;
  private generating: Map<string, Promise<ThumbnailResult>> = new Map();

  constructor(archivePath: string) {
    this.archivePath = archivePath;
    this.thumbnailDir = join(archivePath, '.thumbnails');

    // Ensure thumbnail directory exists
    if (!existsSync(this.thumbnailDir)) {
      mkdirSync(this.thumbnailDir, { recursive: true });
    }
  }

  /**
   * Get or generate a thumbnail for a video file
   * Uses deduplication to prevent concurrent generation of same thumbnail
   * Skips audio-only files (returns audioOnly: true)
   */
  async getThumbnail(videoPath: string, options: ThumbnailOptions = {}): Promise<ThumbnailResult> {
    const hash = this.getVideoHash(videoPath);
    const thumbnailPath = join(this.thumbnailDir, `${hash}.jpg`);
    const audioOnlyMarker = join(this.thumbnailDir, `${hash}.audio-only`);

    // Return cached thumbnail if exists
    if (existsSync(thumbnailPath)) {
      return { success: true, thumbnailPath, cached: true };
    }

    // Check if we've already determined this is audio-only
    if (existsSync(audioOnlyMarker)) {
      return { success: false, cached: true, audioOnly: true, error: 'Audio-only file' };
    }

    // Check if ffmpeg is available
    if (!isFFmpegAvailable()) {
      return {
        success: false,
        cached: false,
        error: 'ffmpeg not available. Install ffmpeg-static or system ffmpeg.',
      };
    }

    // Check if already generating
    if (this.generating.has(hash)) {
      return this.generating.get(hash)!;
    }

    // Probe to check if file has video track
    const probeResult = await probeVideo(videoPath);
    if (!probeResult.hasVideoTrack) {
      // Mark as audio-only so we don't probe again
      try {
        writeFileSync(audioOnlyMarker, 'audio-only');
      } catch {
        // Ignore write errors
      }
      console.log('[Thumbnail] Skipping audio-only file:', videoPath);
      return { success: false, cached: false, audioOnly: true, error: 'Audio-only file (no video track)' };
    }

    // Generate new thumbnail
    const promise = this.generateThumbnail(videoPath, thumbnailPath, options);
    this.generating.set(hash, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.generating.delete(hash);
    }
  }

  /**
   * Generate hash for video file (path + mtime for cache key)
   */
  private getVideoHash(videoPath: string): string {
    try {
      const stat = statSync(videoPath);
      const content = `${videoPath}:${stat.mtimeMs}`;
      return createHash('md5').update(content).digest('hex');
    } catch {
      return createHash('md5').update(videoPath).digest('hex');
    }
  }

  /**
   * Generate thumbnail using ffmpeg
   */
  private generateThumbnail(
    videoPath: string,
    outputPath: string,
    options: ThumbnailOptions
  ): Promise<ThumbnailResult> {
    return new Promise((resolve) => {
      const ffmpegPath = getFfmpegPath();

      if (!ffmpegPath) {
        resolve({ success: false, cached: false, error: 'ffmpeg not available' });
        return;
      }

      if (!existsSync(videoPath)) {
        resolve({ success: false, cached: false, error: `Video file not found: ${videoPath}` });
        return;
      }

      const width = options.width || 320;
      const quality = options.quality || 5;
      const seekSeconds = options.seekSeconds || 1;

      // ffmpeg args:
      // -ss: seek to position (before -i for fast seeking)
      // -i: input file
      // -vframes 1: output single frame
      // -vf scale: scale width, auto height (maintain aspect ratio)
      // -q:v: JPEG quality
      // -y: overwrite output
      const args = [
        '-ss', seekSeconds.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-vf', `scale=${width}:-1`,
        '-q:v', quality.toString(),
        '-y',
        outputPath,
      ];

      console.log('[Thumbnail] Generating:', videoPath);

      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log('[Thumbnail] Generated successfully:', outputPath);
          resolve({ success: true, thumbnailPath: outputPath, cached: false });
        } else {
          console.error('[Thumbnail] Generation failed:', stderr.slice(-500));
          resolve({
            success: false,
            cached: false,
            error: `ffmpeg exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        console.error('[Thumbnail] Process error:', err);
        resolve({ success: false, cached: false, error: err.message });
      });

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve({ success: false, cached: false, error: 'Thumbnail generation timed out (30s)' });
      }, 30000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Check if thumbnail exists (for status checking without generation)
   */
  hasThumbnail(videoPath: string): boolean {
    const hash = this.getVideoHash(videoPath);
    const thumbnailPath = join(this.thumbnailDir, `${hash}.jpg`);
    return existsSync(thumbnailPath);
  }

  /**
   * Get thumbnail path without generating (returns null if not cached)
   */
  getCachedThumbnailPath(videoPath: string): string | null {
    const hash = this.getVideoHash(videoPath);
    const thumbnailPath = join(this.thumbnailDir, `${hash}.jpg`);
    return existsSync(thumbnailPath) ? thumbnailPath : null;
  }

  /**
   * Get the thumbnail directory path
   */
  getThumbnailDir(): string {
    return this.thumbnailDir;
  }
}
