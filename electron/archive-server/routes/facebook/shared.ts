/**
 * Shared utilities and service access for Facebook routes
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { getMediaItemsDatabase, getEmbeddingDatabase } from '../../services/registry';
import { getArchiveRoot } from '../../config';
import { ThumbnailService, getAudioConverter } from '../../services/video';
import { probeVideo } from '../../services/video/VideoProbeService';
import {
  isWhisperAvailable,
  getWhisperStatus,
  downloadModel,
  listAvailableModels,
  transcribeAudio as whisperTranscribe,
} from '../../../whisper/whisper-manager';

// Re-export commonly used types
export { Router, Request, Response };
export { createReadStream, existsSync, statSync };
export { path };
export { getMediaItemsDatabase, getEmbeddingDatabase };
export { getArchiveRoot };
export { ThumbnailService, getAudioConverter };
export { probeVideo };
export {
  isWhisperAvailable,
  getWhisperStatus,
  downloadModel,
  listAvailableModels,
  whisperTranscribe,
};

// Lazy-initialized thumbnail service (singleton)
let thumbnailService: ThumbnailService | null = null;
export function getThumbnailService(): ThumbnailService {
  if (!thumbnailService) {
    thumbnailService = new ThumbnailService(getArchiveRoot());
  }
  return thumbnailService;
}

// Common content type mappings
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const VIDEO_CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

export const ALL_MEDIA_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_CONTENT_TYPES,
  ...VIDEO_CONTENT_TYPES,
};

/**
 * Resolve a media path relative to archive root
 */
export function resolveMediaPath(mediaPath: string): string {
  const archiveRoot = getArchiveRoot();
  return path.isAbsolute(mediaPath)
    ? mediaPath
    : path.resolve(archiveRoot, mediaPath);
}

/**
 * Get content type for a file extension
 */
export function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ALL_MEDIA_CONTENT_TYPES[ext] || 'application/octet-stream';
}
