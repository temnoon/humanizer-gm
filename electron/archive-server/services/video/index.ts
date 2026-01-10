/**
 * Video Services
 * Provides video processing capabilities including thumbnail generation
 */

export { getFfmpegPath, getFfprobePath, isFFmpegAvailable } from './ffmpeg-path';
export { ThumbnailService, type ThumbnailOptions, type ThumbnailResult } from './ThumbnailService';
export { probeVideo, probeVideos, type ProbeResult } from './VideoProbeService';
