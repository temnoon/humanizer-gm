/**
 * FFmpeg Path Resolver
 * Resolves the correct path to ffmpeg binary in both development and packaged environments
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';

let cachedPath: string | null = null;
let pathChecked = false;

/**
 * Get the path to the ffmpeg binary
 * Works in both development (node_modules) and packaged app (asar.unpacked)
 */
export function getFfmpegPath(): string | null {
  if (pathChecked) {
    return cachedPath;
  }

  const possiblePaths: string[] = [];

  // In packaged app, process.resourcesPath points to app.asar parent
  if (process.resourcesPath) {
    possiblePaths.push(
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg')
    );
  }

  // Development - from cwd
  possiblePaths.push(
    join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')
  );

  // Development - relative to this file (compiled in dist-electron)
  possiblePaths.push(
    join(dirname(__dirname), '..', '..', '..', 'node_modules', 'ffmpeg-static', 'ffmpeg')
  );

  // Also try requiring the package directly (works in dev)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      console.log('[FFmpeg] Found via require:', ffmpegStatic);
      cachedPath = ffmpegStatic;
      pathChecked = true;
      return cachedPath;
    }
  } catch {
    // Package not available via require
  }

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      console.log('[FFmpeg] Found at:', p);
      cachedPath = p;
      pathChecked = true;
      return cachedPath;
    }
  }

  console.warn('[FFmpeg] Not found. Tried:', possiblePaths);
  pathChecked = true;
  cachedPath = null;
  return null;
}

/**
 * Check if ffmpeg is available
 */
export function isFFmpegAvailable(): boolean {
  return getFfmpegPath() !== null;
}

/**
 * Get the path to the ffprobe binary (bundled with ffmpeg-static)
 * ffprobe is in the same directory as ffmpeg
 */
export function getFfprobePath(): string | null {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) return null;

  // ffprobe is alongside ffmpeg in ffmpeg-static
  const ffprobePath = ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
  if (existsSync(ffprobePath)) {
    return ffprobePath;
  }

  return null;
}
