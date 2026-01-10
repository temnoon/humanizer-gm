/**
 * AudioConverter - Convert video/audio to WAV for whisper transcription
 *
 * Uses ffmpeg to convert any media file to 16kHz mono WAV format
 * (required by whisper.cpp).
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { join, basename } from 'path';
import { getFfmpegPath, isFFmpegAvailable } from './ffmpeg-path';

export interface ConversionOptions {
  /** Sample rate (default: 16000 for whisper) */
  sampleRate?: number;
  /** Number of channels (default: 1 for mono) */
  channels?: number;
  /** Timeout in ms (default: 120000 = 2 minutes) */
  timeout?: number;
}

export interface ConversionResult {
  success: boolean;
  wavPath?: string;
  cached: boolean;
  error?: string;
  duration?: number;
}

export class AudioConverter {
  private cacheDir: string;
  private converting: Map<string, Promise<ConversionResult>> = new Map();

  constructor(cacheDir: string) {
    this.cacheDir = join(cacheDir, '.audio-cache');

    // Ensure cache directory exists
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Convert media file to WAV for whisper transcription
   * Uses caching to avoid re-conversion
   */
  async convertToWav(inputPath: string, options: ConversionOptions = {}): Promise<ConversionResult> {
    const hash = this.getFileHash(inputPath);
    const wavPath = join(this.cacheDir, `${hash}.wav`);

    // Return cached WAV if exists
    if (existsSync(wavPath)) {
      return { success: true, wavPath, cached: true };
    }

    // Check if ffmpeg is available
    if (!isFFmpegAvailable()) {
      return {
        success: false,
        cached: false,
        error: 'ffmpeg not available. Install ffmpeg-static or system ffmpeg.',
      };
    }

    // Check if already converting
    if (this.converting.has(hash)) {
      return this.converting.get(hash)!;
    }

    // Start conversion
    const promise = this.doConvert(inputPath, wavPath, options);
    this.converting.set(hash, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.converting.delete(hash);
    }
  }

  /**
   * Generate hash for input file
   */
  private getFileHash(inputPath: string): string {
    return createHash('md5').update(inputPath).digest('hex');
  }

  /**
   * Perform the actual conversion using ffmpeg
   */
  private doConvert(
    inputPath: string,
    outputPath: string,
    options: ConversionOptions
  ): Promise<ConversionResult> {
    return new Promise((resolve) => {
      const ffmpegPath = getFfmpegPath();

      if (!ffmpegPath) {
        resolve({ success: false, cached: false, error: 'ffmpeg not available' });
        return;
      }

      if (!existsSync(inputPath)) {
        resolve({ success: false, cached: false, error: `Input file not found: ${inputPath}` });
        return;
      }

      const sampleRate = options.sampleRate || 16000;
      const channels = options.channels || 1;
      const timeoutMs = options.timeout || 120000;

      // ffmpeg args for whisper-compatible WAV:
      // -i: input file
      // -ar: sample rate (16000 Hz)
      // -ac: audio channels (1 = mono)
      // -c:a pcm_s16le: 16-bit PCM encoding
      // -y: overwrite output
      const args = [
        '-i', inputPath,
        '-ar', sampleRate.toString(),
        '-ac', channels.toString(),
        '-c:a', 'pcm_s16le',
        '-y',
        outputPath,
      ];

      console.log('[AudioConverter] Converting:', basename(inputPath));

      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let duration: number | undefined;

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
        // Try to parse duration from ffmpeg output
        const durationMatch = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
        if (durationMatch) {
          const hours = parseInt(durationMatch[1], 10);
          const minutes = parseInt(durationMatch[2], 10);
          const seconds = parseFloat(durationMatch[3]);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
      });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          console.log('[AudioConverter] Conversion successful:', basename(outputPath));
          resolve({ success: true, wavPath: outputPath, cached: false, duration });
        } else {
          console.error('[AudioConverter] Conversion failed:', stderr.slice(-500));
          resolve({
            success: false,
            cached: false,
            error: `ffmpeg exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        console.error('[AudioConverter] Process error:', err);
        resolve({ success: false, cached: false, error: err.message });
      });

      // Timeout protection
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve({ success: false, cached: false, error: `Conversion timed out (${timeoutMs}ms)` });
      }, timeoutMs);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Clean up a specific WAV file from cache
   */
  cleanupWav(inputPath: string): void {
    const hash = this.getFileHash(inputPath);
    const wavPath = join(this.cacheDir, `${hash}.wav`);
    if (existsSync(wavPath)) {
      try {
        unlinkSync(wavPath);
        console.log('[AudioConverter] Cleaned up:', basename(wavPath));
      } catch (err) {
        console.error('[AudioConverter] Failed to cleanup:', err);
      }
    }
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }
}

// Singleton instance
let audioConverterInstance: AudioConverter | null = null;

export function getAudioConverter(cacheDir: string): AudioConverter {
  if (!audioConverterInstance) {
    audioConverterInstance = new AudioConverter(cacheDir);
  }
  return audioConverterInstance;
}
