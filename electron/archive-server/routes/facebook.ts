/**
 * Facebook Router - Facebook archive browsing
 *
 * Routes:
 * - GET /api/facebook/periods - Get time periods with activity
 * - GET /api/facebook/media - List media items
 * - GET /api/facebook/media-stats - Media statistics
 * - GET /api/facebook/media-gallery - Gallery view data
 * - GET /api/facebook/media/:id/context - Get media context
 * - GET /api/facebook/image - Serve image
 * - GET /api/facebook/serve-media - Serve media file
 * - GET /api/facebook/content/:id/media - Get content's media
 * - GET /api/facebook/graph/stats - Social graph statistics
 * - GET /api/facebook/graph/people - List people
 * - GET /api/facebook/graph/top-connections - Top connections
 * - GET /api/facebook/graph/relationships/stats - Relationship stats
 * - GET /api/facebook/graph/person/:name/context - Get person context
 * - POST /api/facebook/graph/import - Import graph data
 * - GET /api/facebook/friends - List all friends
 * - GET /api/facebook/friends/stats - Friends statistics
 * - GET /api/facebook/friends/:name - Get friend details
 * - GET /api/facebook/friends/:name/friendship-date - Get friendship date
 * - POST /api/facebook/friends/import - Import friends from export
 * - GET /api/messenger/threads - List messenger threads
 * - GET /api/messenger/thread/:id - Get thread messages
 */

import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { getMediaItemsDatabase, getEmbeddingDatabase } from '../services/registry';
import { getArchiveRoot } from '../config';
import { ThumbnailService, getAudioConverter } from '../services/video';
import { probeVideo } from '../services/video/VideoProbeService';
import {
  isWhisperAvailable,
  getWhisperStatus,
  downloadModel,
  listAvailableModels,
  transcribeAudio as whisperTranscribe,
} from '../../whisper/whisper-manager';

// Lazy-initialized thumbnail service
let thumbnailService: ThumbnailService | null = null;
function getThumbnailService(): ThumbnailService {
  if (!thumbnailService) {
    thumbnailService = new ThumbnailService(getArchiveRoot());
  }
  return thumbnailService;
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createFacebookRouter(): Router {
  const router = Router();

  // Get time periods with activity
  router.get('/periods', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      // Query distinct periods from content_items
      const periods = db.getRawDb().prepare(`
        SELECT
          strftime('%Y', datetime(created_at, 'unixepoch')) as year,
          ((strftime('%m', datetime(created_at, 'unixepoch')) - 1) / 3 + 1) as quarter,
          COUNT(*) as count,
          MIN(created_at) as start_date,
          MAX(created_at) as end_date
        FROM content_items
        WHERE source = 'facebook'
        GROUP BY year, quarter
        ORDER BY year DESC, quarter DESC
      `).all();

      res.json({
        periods: periods.map((p: any) => ({
          period: `Q${p.quarter}_${p.year}`,
          year: parseInt(p.year),
          quarter: p.quarter,
          count: p.count,
          start_date: p.start_date,
          end_date: p.end_date,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting periods:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
      if (content.media_refs) {
        try {
          mediaRefs = JSON.parse(content.media_refs);
        } catch {
          // Try as comma-separated
          mediaRefs = content.media_refs.split(',').map((s: string) => s.trim());
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
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
      };

      res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
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
      const contentTypes: Record<string, string> = {
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

      const contentType = contentTypes[ext] || 'application/octet-stream';
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

  // Social graph stats
  router.get('/graph/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      // Get all content with context to extract target authors
      const contentWithContext = db.getRawDb().prepare(`
        SELECT context, title
        FROM content_items
        WHERE source = 'facebook'
          AND (context IS NOT NULL OR title IS NOT NULL)
      `).all() as Array<{ context: string | null; title: string | null }>;

      // Extract unique people from context.targetAuthor and title patterns
      const peopleSet = new Set<string>();
      for (const item of contentWithContext) {
        if (item.context) {
          try {
            const ctx = JSON.parse(item.context);
            if (ctx.targetAuthor) {
              peopleSet.add(ctx.targetAuthor);
            }
          } catch { /* ignore parse errors */ }
        }
        // Also extract from title patterns like "shared to X's timeline"
        if (item.title) {
          const match = item.title.match(/to ([^']+)'s timeline/);
          if (match) {
            peopleSet.add(match[1]);
          }
        }
      }

      // Count relationships (items with targetAuthor)
      const interactionCount = contentWithContext.filter(item => {
        if (item.context) {
          try {
            const ctx = JSON.parse(item.context);
            return !!ctx.targetAuthor;
          } catch { return false; }
        }
        return false;
      }).length;

      res.json({
        totalPeople: peopleSet.size,
        totalPlaces: 0,
        totalEvents: 0,
        totalRelationships: interactionCount,
      });
    } catch (err) {
      console.error('[facebook] Error getting graph stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Top connections - returns format expected by SocialGraphView
  router.get('/graph/top-connections', async (req: Request, res: Response) => {
    try {
      const { limit = '100' } = req.query;
      const db = getEmbeddingDatabase();

      // Get all content with context to extract interactions
      const contentWithContext = db.getRawDb().prepare(`
        SELECT context, title, type, created_at
        FROM content_items
        WHERE source = 'facebook'
          AND (context IS NOT NULL OR title IS NOT NULL)
      `).all() as Array<{ context: string | null; title: string | null; type: string; created_at: number }>;

      // Build interaction map: person -> { count, lastInteraction, types }
      const interactions = new Map<string, { count: number; lastInteraction: number; types: Set<string> }>();

      for (const item of contentWithContext) {
        let targetName: string | null = null;

        // Extract from context.targetAuthor
        if (item.context) {
          try {
            const ctx = JSON.parse(item.context);
            if (ctx.targetAuthor) {
              targetName = ctx.targetAuthor;
            }
          } catch { /* ignore parse errors */ }
        }

        // Also extract from title patterns
        if (!targetName && item.title) {
          const match = item.title.match(/to ([^']+)'s timeline/);
          if (match) {
            targetName = match[1];
          }
        }

        if (targetName) {
          const existing = interactions.get(targetName) || { count: 0, lastInteraction: 0, types: new Set() };
          existing.count++;
          existing.lastInteraction = Math.max(existing.lastInteraction, item.created_at);
          existing.types.add(item.type);
          interactions.set(targetName, existing);
        }
      }

      // Convert to array and sort by count
      const sorted = Array.from(interactions.entries())
        .map(([name, data]) => ({
          person: {
            id: `fb_person_${name.toLowerCase().replace(/\s+/g, '_')}`,
            name,
            is_friend: true, // Assume friends for now
          },
          total_weight: data.count,
          relationship_count: data.count,
          last_interaction: data.lastInteraction,
          interaction_types: Array.from(data.types),
        }))
        .sort((a, b) => b.total_weight - a.total_weight)
        .slice(0, parseInt(limit as string));

      res.json({
        connections: sorted,
        total: interactions.size,
      });
    } catch (err) {
      console.error('[facebook] Error getting top connections:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Relationship stats
  router.get('/graph/relationships/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      // Get interaction type breakdown
      const byType = db.getRawDb().prepare(`
        SELECT type, COUNT(*) as count
        FROM content_items
        WHERE source = 'facebook'
        GROUP BY type
      `).all();

      res.json({
        byType,
        total: (byType as any[]).reduce((sum, t) => sum + t.count, 0),
      });
    } catch (err) {
      console.error('[facebook] Error getting relationship stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List people - extracts from context.targetAuthor
  router.get('/graph/people', async (req: Request, res: Response) => {
    try {
      const { search, limit = '50', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();
      const limitNum = parseInt(limit as string);
      const offsetNum = parseInt(offset as string);

      // Get all content with context to extract people
      const contentWithContext = db.getRawDb().prepare(`
        SELECT context, title, type, created_at
        FROM content_items
        WHERE source = 'facebook'
          AND (context IS NOT NULL OR title IS NOT NULL)
      `).all() as Array<{ context: string | null; title: string | null; type: string; created_at: number }>;

      // Build people map
      const peopleMap = new Map<string, { count: number; lastSeen: number; types: Set<string> }>();

      for (const item of contentWithContext) {
        let targetName: string | null = null;

        if (item.context) {
          try {
            const ctx = JSON.parse(item.context);
            if (ctx.targetAuthor) {
              targetName = ctx.targetAuthor;
            }
          } catch { /* ignore */ }
        }

        if (!targetName && item.title) {
          const match = item.title.match(/to ([^']+)'s timeline/);
          if (match) {
            targetName = match[1];
          }
        }

        if (targetName) {
          const existing = peopleMap.get(targetName) || { count: 0, lastSeen: 0, types: new Set() };
          existing.count++;
          existing.lastSeen = Math.max(existing.lastSeen, item.created_at);
          existing.types.add(item.type);
          peopleMap.set(targetName, existing);
        }
      }

      // Convert to array
      let people = Array.from(peopleMap.entries())
        .map(([name, data]) => ({
          id: `fb_person_${name.toLowerCase().replace(/\s+/g, '_')}`,
          name,
          interaction_count: data.count,
          last_seen: data.lastSeen,
        }))
        .sort((a, b) => b.interaction_count - a.interaction_count);

      // Apply search filter
      if (search) {
        const searchLower = (search as string).toLowerCase();
        people = people.filter(p => p.name.toLowerCase().includes(searchLower));
      }

      // Apply pagination
      const total = people.length;
      people = people.slice(offsetNum, offsetNum + limitNum);

      res.json({
        total,
        people,
      });
    } catch (err) {
      console.error('[facebook] Error listing people:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get detailed context for a specific person
  router.get('/graph/person/:name/context', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { limit = '50' } = req.query;
      const db = getEmbeddingDatabase();
      const decodedName = decodeURIComponent(name);

      // Get all interactions with this person from context.targetAuthor
      const contentWithContext = db.getRawDb().prepare(`
        SELECT id, type, text, title, context, created_at, media_refs
        FROM content_items
        WHERE source = 'facebook'
          AND (context IS NOT NULL OR title IS NOT NULL)
        ORDER BY created_at DESC
      `).all() as Array<{
        id: string;
        type: string;
        text: string | null;
        title: string | null;
        context: string | null;
        created_at: number;
        media_refs: string | null;
      }>;

      // Filter for items involving this person
      const interactions: Array<{
        id: string;
        type: string;
        text: string | null;
        title: string | null;
        interactionType: string;
        date: number;
        hasMedia: boolean;
      }> = [];

      for (const item of contentWithContext) {
        let matchesName = false;
        let interactionType = item.type;

        // Check context.targetAuthor
        if (item.context) {
          try {
            const ctx = JSON.parse(item.context);
            if (ctx.targetAuthor && ctx.targetAuthor.toLowerCase() === decodedName.toLowerCase()) {
              matchesName = true;
              interactionType = ctx.action || item.type;
            }
          } catch { /* ignore */ }
        }

        // Check title for "to X's timeline" pattern
        if (!matchesName && item.title) {
          const match = item.title.match(/to ([^']+)'s timeline/i);
          if (match && match[1].toLowerCase() === decodedName.toLowerCase()) {
            matchesName = true;
            interactionType = 'shared to timeline';
          }
        }

        if (matchesName) {
          interactions.push({
            id: item.id,
            type: item.type,
            text: item.text,
            title: item.title,
            interactionType,
            date: item.created_at,
            hasMedia: !!(item.media_refs && item.media_refs !== '[]'),
          });
        }

        if (interactions.length >= parseInt(limit as string)) break;
      }

      // Get date range
      const dates = interactions.map(i => i.date).filter(d => d > 0);
      const firstInteraction = dates.length ? Math.min(...dates) : null;
      const lastInteraction = dates.length ? Math.max(...dates) : null;

      // Group by type
      const byType: Record<string, number> = {};
      for (const i of interactions) {
        byType[i.interactionType] = (byType[i.interactionType] || 0) + 1;
      }

      res.json({
        person: decodedName,
        totalInteractions: interactions.length,
        firstInteraction,
        lastInteraction,
        byType,
        interactions: interactions.slice(0, 20), // Return top 20 for preview
      });
    } catch (err) {
      console.error('[facebook] Error getting person context:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import Facebook data from export folder
  router.post('/graph/import', async (req: Request, res: Response) => {
    try {
      const { exportPath, targetPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required (path to Facebook export folder)' });
        return;
      }

      // Dynamically import the parser to avoid circular dependencies
      const { FacebookFullParser } = await import('../services/facebook/FacebookFullParser.js');
      const parser = new FacebookFullParser();

      const archiveRoot = getArchiveRoot();
      const defaultTarget = path.join(archiveRoot, 'facebook_import_' + Date.now());

      console.log(`[facebook] Starting import from: ${exportPath}`);
      console.log(`[facebook] Target directory: ${targetPath || defaultTarget}`);

      // Respond immediately, import runs in background
      res.json({
        success: true,
        message: 'Facebook import started',
        exportPath,
        targetPath: targetPath || defaultTarget,
      });

      // Run import in background
      parser.importExport({
        exportDir: exportPath,
        targetDir: targetPath || defaultTarget,
        archivePath: archiveRoot,
        generateEmbeddings: true,
        onProgress: (progress) => {
          console.log(`[facebook] Import progress: ${progress.stage} - ${progress.message}`);
        },
      }).then((result) => {
        console.log(`[facebook] Import complete:`, {
          posts: result.posts_imported,
          comments: result.comments_imported,
          reactions: result.reactions_imported,
          photos: result.photos_imported,
          videos: result.videos_imported,
        });
      }).catch((err) => {
        console.error('[facebook] Import failed:', err);
      });
    } catch (err) {
      console.error('[facebook] Error starting import:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Messenger routes
  router.get('/messenger/threads', async (req: Request, res: Response) => {
    try {
      const { limit = '50', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();

      // Get distinct threads from messages
      const threads = db.getRawDb().prepare(`
        SELECT
          thread_id,
          MAX(title) as title,
          COUNT(*) as message_count,
          MAX(created_at) as last_message,
          MIN(created_at) as first_message
        FROM content_items
        WHERE source = 'facebook' AND type = 'message' AND thread_id IS NOT NULL
        GROUP BY thread_id
        ORDER BY last_message DESC
        LIMIT ? OFFSET ?
      `).all(parseInt(limit as string), parseInt(offset as string));

      res.json({
        total: threads.length,
        threads,
      });
    } catch (err) {
      console.error('[facebook] Error listing messenger threads:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/messenger/thread/:threadId', async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      const { limit = '100', offset = '0' } = req.query;
      const db = getEmbeddingDatabase();

      const messages = db.getRawDb().prepare(`
        SELECT *
        FROM content_items
        WHERE source = 'facebook' AND type = 'message' AND thread_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `).all(threadId, parseInt(limit as string), parseInt(offset as string));

      res.json({
        threadId,
        messages,
        count: messages.length,
      });
    } catch (err) {
      console.error('[facebook] Error getting messenger thread:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // TRANSCRIPTION ROUTES
  // ═══════════════════════════════════════════════════════════════════

  // Get whisper status
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

  // ═══════════════════════════════════════════════════════════════════
  // FRIENDS ROUTES
  // ═══════════════════════════════════════════════════════════════════

  // Get friends statistics
  router.get('/friends/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const friendsCount = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_people WHERE is_friend = 1
      `).get() as { count: number }).count;

      const earliestFriendship = db.getRawDb().prepare(`
        SELECT MIN(friend_since) as earliest FROM fb_people WHERE is_friend = 1 AND friend_since > 0
      `).get() as { earliest: number | null };

      const latestFriendship = db.getRawDb().prepare(`
        SELECT MAX(friend_since) as latest FROM fb_people WHERE is_friend = 1 AND friend_since > 0
      `).get() as { latest: number | null };

      // Get friend count by year
      const byYear = db.getRawDb().prepare(`
        SELECT
          strftime('%Y', datetime(friend_since, 'unixepoch')) as year,
          COUNT(*) as count
        FROM fb_people
        WHERE is_friend = 1 AND friend_since > 0
        GROUP BY year
        ORDER BY year DESC
      `).all() as Array<{ year: string; count: number }>;

      res.json({
        totalFriends: friendsCount,
        earliestFriendship: earliestFriendship?.earliest,
        latestFriendship: latestFriendship?.latest,
        byYear,
      });
    } catch (err) {
      console.error('[facebook] Error getting friends stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List all friends
  router.get('/friends', async (req: Request, res: Response) => {
    try {
      const { limit = '100', offset = '0', search, sortBy = 'friend_since', order = 'desc' } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT * FROM fb_people WHERE is_friend = 1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search}%`);
      }

      // Validate sortBy
      const validSortFields = ['friend_since', 'name', 'interaction_count', 'last_interaction'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'friend_since';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      sql += ` ORDER BY ${sortField} ${sortOrder}`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const friends = db.getRawDb().prepare(sql).all(...params);

      const totalResult = db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_people WHERE is_friend = 1
        ${search ? 'AND name LIKE ?' : ''}
      `).get(...(search ? [`%${search}%`] : [])) as { count: number };

      res.json({
        total: totalResult.count,
        friends: friends.map((f: any) => ({
          id: f.id,
          name: f.name,
          friendSince: f.friend_since,
          friendSinceDate: f.friend_since ? new Date(f.friend_since * 1000).toISOString() : null,
          isFollower: !!f.is_follower,
          isFollowing: !!f.is_following,
          interactionCount: f.interaction_count || 0,
          lastInteraction: f.last_interaction,
        })),
        hasMore: parseInt(offset as string) + friends.length < totalResult.count,
      });
    } catch (err) {
      console.error('[facebook] Error listing friends:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get friendship details for a specific person
  router.get('/friends/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const decodedName = decodeURIComponent(name);
      const db = getEmbeddingDatabase();

      // Find the person by name (case-insensitive)
      const person = db.getRawDb().prepare(`
        SELECT * FROM fb_people WHERE LOWER(name) = LOWER(?)
      `).get(decodedName) as any;

      if (!person) {
        res.status(404).json({ error: 'Person not found' });
        return;
      }

      // Get interaction history
      const interactions = db.getRawDb().prepare(`
        SELECT id, type, text, title, context, created_at, media_refs
        FROM content_items
        WHERE source = 'facebook'
          AND (
            context LIKE ? OR
            title LIKE ?
          )
        ORDER BY created_at DESC
        LIMIT 50
      `).all(`%"targetAuthor":"${decodedName}"%`, `%${decodedName}%`) as any[];

      res.json({
        person: {
          id: person.id,
          name: person.name,
          friendSince: person.friend_since,
          friendSinceDate: person.friend_since ? new Date(person.friend_since * 1000).toISOString() : null,
          isFriend: !!person.is_friend,
          isFollower: !!person.is_follower,
          isFollowing: !!person.is_following,
          interactionCount: person.interaction_count || 0,
          tagCount: person.tag_count || 0,
          firstInteraction: person.first_interaction,
          lastInteraction: person.last_interaction,
          relationshipStrength: person.relationship_strength,
        },
        interactions: interactions.map(i => ({
          id: i.id,
          type: i.type,
          text: i.text?.slice(0, 200),
          title: i.title,
          date: i.created_at,
          hasMedia: !!(i.media_refs && i.media_refs !== '[]'),
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting friend details:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import friends from Facebook export
  router.post('/friends/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required (path to Facebook export folder)' });
        return;
      }

      // Import the FriendsParser
      const { FriendsParser } = await import('../services/facebook/FriendsParser.js');
      const parser = new FriendsParser();

      console.log(`[facebook] Importing friends from: ${exportPath}`);

      // Parse friends data
      const result = await parser.parseAll(path.join(exportPath, 'connections'));

      // Insert into database
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      let inserted = 0;
      let updated = 0;

      // Insert current friends
      for (const friend of result.friends) {
        const existing = db.getRawDb().prepare(`
          SELECT id FROM fb_people WHERE LOWER(name) = LOWER(?)
        `).get(friend.name) as { id: string } | undefined;

        if (existing) {
          // Update existing record
          db.getRawDb().prepare(`
            UPDATE fb_people
            SET is_friend = 1, friend_since = ?, updated_at = ?
            WHERE id = ?
          `).run(friend.friendshipDate, now, existing.id);
          updated++;
        } else {
          // Insert new record
          db.getRawDb().prepare(`
            INSERT INTO fb_people (id, name, is_friend, friend_since, is_follower, is_following,
                                   interaction_count, tag_count, created_at)
            VALUES (?, ?, 1, ?, 0, 0, 0, 0, ?)
          `).run(friend.id, friend.name, friend.friendshipDate, now);
          inserted++;
        }
      }

      console.log(`[facebook] Friends import complete: ${inserted} inserted, ${updated} updated`);

      res.json({
        success: true,
        stats: result.stats,
        imported: {
          inserted,
          updated,
          total: inserted + updated,
        },
      });
    } catch (err) {
      console.error('[facebook] Error importing friends:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // "When did we become friends?" endpoint
  router.get('/friends/:name/friendship-date', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const decodedName = decodeURIComponent(name);
      const db = getEmbeddingDatabase();

      const person = db.getRawDb().prepare(`
        SELECT name, friend_since, is_friend FROM fb_people WHERE LOWER(name) = LOWER(?)
      `).get(decodedName) as any;

      if (!person) {
        res.status(404).json({ error: 'Person not found' });
        return;
      }

      if (!person.is_friend) {
        res.json({
          name: person.name,
          isFriend: false,
          message: `${person.name} is not currently a friend`,
        });
        return;
      }

      if (!person.friend_since) {
        res.json({
          name: person.name,
          isFriend: true,
          friendshipDate: null,
          message: `Friendship date not available for ${person.name}`,
        });
        return;
      }

      const date = new Date(person.friend_since * 1000);
      const yearsAgo = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));

      res.json({
        name: person.name,
        isFriend: true,
        friendshipDate: person.friend_since,
        friendshipDateISO: date.toISOString(),
        friendshipDateFormatted: date.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        yearsAgo,
        message: `You became friends with ${person.name} on ${date.toLocaleDateString()} (${yearsAgo} years ago)`,
      });
    } catch (err) {
      console.error('[facebook] Error getting friendship date:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
