/**
 * Media Routes - Media serving, gallery, thumbnails, transcription
 * Routes: /media*, /image, /serve-media, /video*, /content/:id/media, /transcription/*
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

// Lazy-initialized thumbnail service (singleton)
let thumbnailService: ThumbnailService | null = null;
function getThumbnailService(): ThumbnailService {
  if (!thumbnailService) {
    thumbnailService = new ThumbnailService(getArchiveRoot());
  }
  return thumbnailService;
}

// Content type mappings
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

export function createMediaRouter(): Router {
  const router = Router();

  // Media statistics
  router.get('/media-stats', async (_req: Request, res: Response) => {
    try {
      const mediaDb = getMediaItemsDatabase();
      const bySource = mediaDb.getMediaCountBySource();
      const total = mediaDb.getTotalMediaCount();

      // Get total file size
      const db = getEmbeddingDatabase();
      const sizeResult = db.getRawDb().prepare(`
        SELECT SUM(file_size) as total_size FROM media_items
      `).get() as { total_size: number } | undefined;

      res.json({
        total,
        bySource,
        totalSize: sizeResult?.total_size || 0,
        totalSizeMB: ((sizeResult?.total_size || 0) / (1024 * 1024)).toFixed(2),
      });
    } catch (err) {
      console.error('[facebook] Error getting media stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List media items
  router.get('/media', async (req: Request, res: Response) => {
    try {
      const {
        type,
        source_type,
        limit = '50',
        offset = '0',
        page = '0'
      } = req.query;

      const mediaDb = getMediaItemsDatabase();
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string) || parseInt(page as string) * limitNum;

      const items = mediaDb.getMediaItems({
        mediaType: type as string,
        sourceType: source_type as string,
        limit: limitNum,
        offset: offsetNum,
      });

      const total = mediaDb.getTotalMediaCount();

      res.json({
        media: items,
        total,
        hasMore: offsetNum + items.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error listing media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Media gallery view with pagination
  router.get('/media-gallery', async (req: Request, res: Response) => {
    try {
      const {
        page = '0',
        pageSize = '50',
        limit = '50',
        offset = '0'
      } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string) || parseInt(limit as string);
      const offsetNum = parseInt(offset as string) || pageNum * pageSizeNum;

      const mediaDb = getMediaItemsDatabase();
      const items = mediaDb.getMediaItems({
        limit: pageSizeNum,
        offset: offsetNum,
      });

      const total = mediaDb.getTotalMediaCount();

      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        items: items.map(item => ({
          id: item.id,
          file_path: item.file_path,
          filename: item.filename,
          media_type: item.media_type,
          file_size: item.file_size,
          width: item.width,
          height: item.height,
          created_at: item.created_at,
          source_type: item.source_type,
          context: item.context,
          context_id: item.context_id,
          description: item.description,
        })),
        hasMore: offsetNum + items.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error getting media gallery:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get media context (related content)
  router.get('/media/:mediaId/context', async (req: Request, res: Response) => {
    try {
      const { mediaId } = req.params;
      const db = getEmbeddingDatabase();

      // Try facebook_media table first, then media_items
      let mediaItem = db.getRawDb().prepare(`
        SELECT * FROM facebook_media WHERE id = ?
      `).get(mediaId);

      if (!mediaItem) {
        mediaItem = db.getRawDb().prepare(`
          SELECT * FROM media_items WHERE id = ?
        `).get(mediaId);
      }

      if (!mediaItem) {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      // Get related media (same album/post/event)
      let relatedMedia: any[] = [];
      if ((mediaItem as any).context_id) {
        relatedMedia = db.getRawDb().prepare(`
          SELECT id, file_path, media_type, created_at
          FROM facebook_media
          WHERE context_id = ? AND id != ?
          ORDER BY created_at ASC
        `).all((mediaItem as any).context_id, mediaId);
      }

      // Get linked content items that reference this media (by ID or file_path)
      const filePath = (mediaItem as any).file_path || '';
      const contentItems = db.getRawDb().prepare(`
        SELECT id, type, title, text, created_at, author_name
        FROM content_items
        WHERE media_refs LIKE ? OR media_refs LIKE ?
        ORDER BY created_at DESC
      `).all(`%${mediaId}%`, `%${filePath}%`);

      res.json({
        media: mediaItem,
        relatedMedia,
        contentItems,
      });
    } catch (err) {
      console.error('[facebook] Error getting media context:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get content item's media
  router.get('/content/:contentId/media', async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const db = getEmbeddingDatabase();

      // Get the content item
      const content = db.getContentItem(contentId);
      if (!content) {
        res.status(404).json({ error: 'Content not found' });
        return;
      }

      // Parse media refs (these are file paths, not IDs)
      let mediaRefs: string[] = [];
      const mediaRefsRaw = content.media_refs as string | undefined;
      if (mediaRefsRaw) {
        try {
          mediaRefs = JSON.parse(mediaRefsRaw);
        } catch {
          // Try as comma-separated
          mediaRefs = mediaRefsRaw.split(',').map((s: string) => s.trim());
        }
      }

      // Query by file_path since media_refs contains paths, not IDs
      let media: any[] = [];
      if (mediaRefs.length > 0) {
        // First try to find in facebook_media table
        const mediaDb = getMediaItemsDatabase();
        const fbMedia = db.getRawDb().prepare(`
          SELECT * FROM facebook_media WHERE file_path IN (${mediaRefs.map(() => '?').join(',')})
        `).all(...mediaRefs);

        if (fbMedia.length > 0) {
          media = fbMedia;
        } else {
          // Fallback: try media_items table
          const genericMedia = db.getRawDb().prepare(`
            SELECT * FROM media_items WHERE file_path IN (${mediaRefs.map(() => '?').join(',')})
          `).all(...mediaRefs);

          if (genericMedia.length > 0) {
            media = genericMedia;
          } else {
            // Last resort: construct minimal media objects from file paths
            media = mediaRefs.map((filePath, idx) => {
              const filename = path.basename(filePath);
              const ext = path.extname(filePath).toLowerCase();
              const isVideo = ['.mp4', '.mov', '.webm', '.avi'].includes(ext);
              return {
                id: `ref_${idx}`,
                file_path: filePath,
                filename,
                media_type: isVideo ? 'video' : 'image',
              };
            });
          }
        }
      }

      res.json({
        contentId,
        media,
        count: media.length,
      });
    } catch (err) {
      console.error('[facebook] Error getting content media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve image (with path security)
  router.get('/image', async (req: Request, res: Response) => {
    try {
      const { path: imagePath } = req.query;

      if (!imagePath || typeof imagePath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Decode if base64
      let decodedPath = imagePath;
      try {
        // Check if it looks like base64
        if (/^[A-Za-z0-9+/=]+$/.test(imagePath) && imagePath.length > 50) {
          decodedPath = Buffer.from(imagePath, 'base64').toString('utf-8');
        }
      } catch {
        // Use as-is
      }

      // Resolve path
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(decodedPath)
        ? decodedPath
        : path.resolve(archiveRoot, decodedPath);

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
      createReadStream(resolved).pipe(res);
    } catch (err) {
      console.error('[facebook] Error serving image:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve media files with Range support for video seeking
  router.get('/serve-media', async (req: Request, res: Response) => {
    try {
      const { path: mediaPath } = req.query;

      if (!mediaPath || typeof mediaPath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Resolve path - handle both absolute and relative
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(mediaPath)
        ? mediaPath
        : path.resolve(archiveRoot, mediaPath);

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'File not found', path: resolved });
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      const stat = statSync(resolved);
      const fileSize = stat.size;

      // Handle Range requests for video seeking
      const range = req.headers.range;
      if (range && contentType.startsWith('video/')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });

        createReadStream(resolved, { start, end }).pipe(res);
      } else {
        // Full file response
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        createReadStream(resolved).pipe(res);
      }
    } catch (err) {
      console.error('[facebook] Error serving media:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get or generate video thumbnail
  router.get('/video-thumbnail', async (req: Request, res: Response) => {
    try {
      const { path: videoPath } = req.query;

      if (!videoPath || typeof videoPath !== 'string') {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Resolve path
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(videoPath)
        ? videoPath
        : path.resolve(archiveRoot, videoPath);

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'Video not found', path: resolved });
        return;
      }

      // Pre-check: Audio files in /audio/ folders don't have video tracks
      // Return early to avoid thumbnail service throwing on audio-only files
      if (resolved.includes('/audio/') || resolved.includes('\\audio\\')) {
        res.status(404).json({
          error: 'Audio-only file',
          audioOnly: true,
        });
        return;
      }

      const service = getThumbnailService();
      const result = await service.getThumbnail(resolved);

      if (result.success && result.thumbnailPath) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
        createReadStream(result.thumbnailPath).pipe(res);
      } else if (result.audioOnly) {
        // Audio-only files don't have thumbnails - return 404 (not an error)
        res.status(404).json({
          error: 'Audio-only file',
          audioOnly: true,
        });
      } else {
        res.status(500).json({
          error: 'Thumbnail generation failed',
          details: result.error,
        });
      }
    } catch (err) {
      console.error('[facebook] Error serving video thumbnail:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get video probe stats
  router.get('/video-probe/stats', async (_req: Request, res: Response) => {
    try {
      const mediaDb = getMediaItemsDatabase();
      const stats = mediaDb.getVideoTrackStats();
      res.json(stats);
    } catch (err) {
      console.error('[facebook] Error getting video probe stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Probe videos to detect audio-only MP4s
  router.post('/video-probe/run', async (req: Request, res: Response) => {
    try {
      const { limit = 50 } = req.body || {};
      const mediaDb = getMediaItemsDatabase();

      // Get unprobed videos
      const unprobed = mediaDb.getUnprobedVideos(limit);

      if (unprobed.length === 0) {
        res.json({ probed: 0, message: 'All videos have been probed' });
        return;
      }

      console.log(`[facebook] Probing ${unprobed.length} videos...`);

      // Probe each video
      const updates: Array<{ id: string; hasVideoTrack: boolean }> = [];
      let audioOnlyCount = 0;

      for (const video of unprobed) {
        const result = await probeVideo(video.file_path);
        updates.push({ id: video.id, hasVideoTrack: result.hasVideoTrack });
        if (!result.hasVideoTrack) audioOnlyCount++;
      }

      // Batch update database
      const updated = mediaDb.batchUpdateVideoTrack(updates);

      console.log(`[facebook] Probed ${updated} videos, ${audioOnlyCount} are audio-only`);

      res.json({
        probed: updated,
        audioOnly: audioOnlyCount,
        remaining: mediaDb.getUnprobedVideos(1).length > 0,
      });
    } catch (err) {
      console.error('[facebook] Error probing videos:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ===========================================================================
  // Transcription Routes
  // ===========================================================================

  router.get('/transcription/status', async (_req: Request, res: Response) => {
    try {
      const status = await getWhisperStatus();
      const mediaDb = getMediaItemsDatabase();
      const stats = mediaDb.getTranscriptionStats();

      res.json({
        whisper: status,
        stats,
      });
    } catch (err) {
      console.error('[facebook] Error getting transcription status:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List available models
  router.get('/transcription/models', async (_req: Request, res: Response) => {
    try {
      const models = listAvailableModels();
      res.json({ models });
    } catch (err) {
      console.error('[facebook] Error listing models:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Download a model
  router.post('/transcription/models/download', async (req: Request, res: Response) => {
    try {
      const { model = 'ggml-base.en.bin' } = req.body || {};

      console.log(`[facebook] Downloading whisper model: ${model}`);

      const success = await downloadModel(model, (progress) => {
        console.log(`[facebook] Download progress: ${progress.percent}%`);
      });

      if (success) {
        res.json({ success: true, model });
      } else {
        res.status(500).json({ success: false, error: 'Download failed' });
      }
    } catch (err) {
      console.error('[facebook] Error downloading model:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Transcribe a single media file
  router.post('/transcription/transcribe', async (req: Request, res: Response) => {
    try {
      const { mediaId, path: mediaPath, model = 'ggml-tiny.en.bin' } = req.body || {};

      if (!mediaId && !mediaPath) {
        res.status(400).json({ error: 'mediaId or path required' });
        return;
      }

      // Check if whisper is available
      if (!isWhisperAvailable()) {
        res.status(503).json({
          error: 'Whisper not available. Module may not be loaded.',
          hint: 'Restart the app to initialize whisper.'
        });
        return;
      }

      const mediaDb = getMediaItemsDatabase();
      let filePath = mediaPath;
      let id = mediaId;

      // If mediaId provided, look up the file path
      if (mediaId && !mediaPath) {
        const item = mediaDb.getMediaById(mediaId);
        if (!item) {
          res.status(404).json({ error: 'Media item not found' });
          return;
        }
        filePath = item.file_path;
        id = item.id;
      }

      // Resolve path
      const archiveRoot = getArchiveRoot();
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(archiveRoot, filePath);

      if (!existsSync(resolved)) {
        res.status(404).json({ error: 'File not found', path: resolved });
        return;
      }

      console.log(`[facebook] Starting transcription: ${path.basename(resolved)}`);
      console.log(`[facebook] Using model: ${model}`);

      // Update status to processing
      if (id) {
        mediaDb.updateTranscriptionStatus(id, 'processing');
      }

      // Convert to WAV if needed
      const ext = path.extname(resolved).toLowerCase();
      let audioPath = resolved;

      if (ext !== '.wav') {
        const converter = getAudioConverter(archiveRoot);
        const convResult = await converter.convertToWav(resolved);

        if (!convResult.success || !convResult.wavPath) {
          if (id) {
            mediaDb.updateTranscriptionStatus(id, 'failed');
          }
          res.status(500).json({
            error: 'Failed to convert audio',
            details: convResult.error
          });
          return;
        }

        audioPath = convResult.wavPath;
        console.log(`[facebook] Converted to WAV: ${path.basename(audioPath)}`);
      }

      // Transcribe using whisper
      try {
        const result = await whisperTranscribe(audioPath, model);

        // Store transcript in database
        if (id && result.text) {
          mediaDb.updateTranscript(id, result.text, 'completed');
        }

        console.log(`[facebook] Transcription complete: ${result.text?.slice(0, 100)}...`);

        res.json({
          success: true,
          mediaId: id,
          transcript: result.text,
          segments: result.segments,
          language: result.language,
          duration: result.duration,
        });
      } catch (transcribeError) {
        if (id) {
          mediaDb.updateTranscriptionStatus(id, 'failed');
        }
        throw transcribeError;
      }
    } catch (err) {
      console.error('[facebook] Error transcribing:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get transcript for a media item
  router.get('/transcription/:mediaId', async (req: Request, res: Response) => {
    try {
      const { mediaId } = req.params;
      const mediaDb = getMediaItemsDatabase();

      const result = mediaDb.getTranscript(mediaId);
      if (!result) {
        res.status(404).json({ error: 'Media item not found' });
        return;
      }

      res.json({
        mediaId,
        transcript: result.transcript,
        status: result.status,
      });
    } catch (err) {
      console.error('[facebook] Error getting transcript:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Search transcripts
  router.get('/transcription/search', async (req: Request, res: Response) => {
    try {
      const { q, query, limit = '50' } = req.query;
      const searchQuery = (q || query) as string;

      if (!searchQuery) {
        res.status(400).json({ error: 'q or query parameter required' });
        return;
      }

      const mediaDb = getMediaItemsDatabase();
      const results = mediaDb.searchTranscripts(searchQuery, parseInt(limit as string));

      res.json({
        query: searchQuery,
        results,
        count: results.length,
      });
    } catch (err) {
      console.error('[facebook] Error searching transcripts:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get untranscribed media
  router.get('/transcription/pending', async (req: Request, res: Response) => {
    try {
      const { limit = '50' } = req.query;
      const mediaDb = getMediaItemsDatabase();

      const pending = mediaDb.getUntranscribedMedia(parseInt(limit as string));

      res.json({
        count: pending.length,
        items: pending,
      });
    } catch (err) {
      console.error('[facebook] Error getting pending transcriptions:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
