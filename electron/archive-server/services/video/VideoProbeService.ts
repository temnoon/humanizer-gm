/**
 * VideoProbeService - Detect video/audio tracks in media files
 *
 * Uses ffprobe to determine if a video file has a video track (vs audio-only)
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getFfprobePath } from './ffmpeg-path';

export interface ProbeResult {
  hasVideoTrack: boolean;
  hasAudioTrack: boolean;
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  error?: string;
}

/**
 * Probe a video file to detect its streams
 */
export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const ffprobePath = getFfprobePath();

  if (!ffprobePath) {
    return { hasVideoTrack: true, hasAudioTrack: true, error: 'ffprobe not available' };
  }

  if (!existsSync(filePath)) {
    return { hasVideoTrack: true, hasAudioTrack: true, error: 'File not found' };
  }

  return new Promise((resolve) => {
    // Use ffprobe to get stream info as JSON
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ];

    const proc = spawn(ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          hasVideoTrack: true, // Assume video if probe fails
          hasAudioTrack: true,
          error: `ffprobe exited with code ${code}: ${stderr}`,
        });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const streams = data.streams || [];

        let hasVideoTrack = false;
        let hasAudioTrack = false;
        let videoCodec: string | undefined;
        let audioCodec: string | undefined;
        let width: number | undefined;
        let height: number | undefined;

        for (const stream of streams) {
          if (stream.codec_type === 'video') {
            hasVideoTrack = true;
            videoCodec = stream.codec_name;
            width = stream.width;
            height = stream.height;
          } else if (stream.codec_type === 'audio') {
            hasAudioTrack = true;
            audioCodec = stream.codec_name;
          }
        }

        const duration = data.format?.duration
          ? parseFloat(data.format.duration)
          : undefined;

        resolve({
          hasVideoTrack,
          hasAudioTrack,
          duration,
          width,
          height,
          videoCodec,
          audioCodec,
        });
      } catch (err) {
        resolve({
          hasVideoTrack: true,
          hasAudioTrack: true,
          error: `Failed to parse ffprobe output: ${(err as Error).message}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        hasVideoTrack: true,
        hasAudioTrack: true,
        error: err.message,
      });
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({
        hasVideoTrack: true,
        hasAudioTrack: true,
        error: 'Probe timed out',
      });
    }, 10000);
  });
}

/**
 * Batch probe multiple videos
 */
export async function probeVideos(
  filePaths: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const result = await probeVideo(filePath);
    results.set(filePath, result);
    onProgress?.(i + 1, filePaths.length);
  }

  return results;
}
