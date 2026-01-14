/**
 * Media URL utilities for Facebook View components
 */

import { isElectron } from '../../../../lib/platform';

/**
 * Normalize file path to a URL for media serving
 * - In Electron: Uses local-media:// protocol for direct file access
 * - In browser: Uses HTTP archive server with URL encoding (dynamic port)
 * @param filePath The raw file path
 * @param archiveServerUrl The archive server base URL (required for browser mode)
 */
export function normalizeMediaPath(filePath: string, archiveServerUrl: string | null): string {
  if (!filePath) return filePath;
  // Already a URL, return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('local-media://')) {
    return filePath;
  }
  // In Electron, use the local-media:// protocol for direct file serving
  if (isElectron) {
    return `local-media://serve${filePath}`;
  }
  // In browser, use archive server with URL encoding (dynamic port)
  if (!archiveServerUrl) {
    console.warn('Archive server URL not available');
    return filePath;
  }
  return `${archiveServerUrl}/api/facebook/serve-media?path=${encodeURIComponent(filePath)}`;
}

/**
 * Get video thumbnail URL
 * Uses the video-thumbnail endpoint which generates thumbnails on first access
 */
export function getVideoThumbnailUrl(filePath: string, archiveServerUrl: string | null): string {
  if (!filePath || !archiveServerUrl) return '';
  return `${archiveServerUrl}/api/facebook/video-thumbnail?path=${encodeURIComponent(filePath)}`;
}
