/**
 * Video Services
 * Provides video processing capabilities including thumbnail generation
 */

export { getFfmpegPath, isFFmpegAvailable } from './ffmpeg-path';
export { ThumbnailService, type ThumbnailOptions, type ThumbnailResult } from './ThumbnailService';
