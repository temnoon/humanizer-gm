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
 * - GET /api/facebook/advertisers - List advertisers tracking you
 * - GET /api/facebook/advertisers/stats - Advertiser statistics
 * - POST /api/facebook/advertisers/import - Import advertisers
 * - GET /api/facebook/pages - List pages liked/followed
 * - GET /api/facebook/pages/stats - Pages statistics
 * - POST /api/facebook/pages/import - Import pages
 * - GET /api/facebook/reactions - List outbound reactions
 * - GET /api/facebook/reactions/stats - Reactions statistics
 * - GET /api/facebook/reactions/to/:name - Reactions to person's content
 * - POST /api/facebook/reactions/import - Import reactions
 * - GET /api/facebook/notes - List notes (long-form writing)
 * - GET /api/facebook/notes/stats - Notes statistics
 * - GET /api/facebook/notes/:id - Get note with full text
 * - GET /api/facebook/notes/search - Search notes by content
 * - POST /api/facebook/notes/import - Import notes from export
 * - POST /api/facebook/notes/embed - Generate embeddings for notes
 * - GET /api/facebook/notes/semantic-search - Semantic search notes
 * - GET /api/messenger/threads - List messenger threads
 * - GET /api/messenger/thread/:id - Get thread messages
 * - GET /api/messenger/stats - Get messenger statistics
 * - POST /api/messenger/import - Import all messenger threads from export
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

  // ═══════════════════════════════════════════════════════════════════
  // ADVERTISERS ROUTES
  // ═══════════════════════════════════════════════════════════════════

  // Get advertisers statistics
  router.get('/advertisers/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const total = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_advertisers
      `).get() as { count: number }).count;

      const dataBrokers = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_advertisers WHERE is_data_broker = 1
      `).get() as { count: number }).count;

      const byTargetingType = db.getRawDb().prepare(`
        SELECT targeting_type, COUNT(*) as count
        FROM fb_advertisers
        GROUP BY targeting_type
        ORDER BY count DESC
      `).all() as Array<{ targeting_type: string; count: number }>;

      const topAdvertisers = db.getRawDb().prepare(`
        SELECT name, interaction_count, is_data_broker
        FROM fb_advertisers
        ORDER BY interaction_count DESC
        LIMIT 10
      `).all() as Array<{ name: string; interaction_count: number; is_data_broker: number }>;

      res.json({
        total,
        dataBrokers,
        byTargetingType,
        topAdvertisers: topAdvertisers.map(a => ({
          name: a.name,
          interactionCount: a.interaction_count,
          isDataBroker: !!a.is_data_broker,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting advertisers stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List advertisers
  router.get('/advertisers', async (req: Request, res: Response) => {
    try {
      const { limit = '100', offset = '0', search, dataBrokersOnly, sortBy = 'interaction_count' } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT * FROM fb_advertisers WHERE 1=1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search}%`);
      }

      if (dataBrokersOnly === 'true') {
        sql += ` AND is_data_broker = 1`;
      }

      const validSortFields = ['interaction_count', 'name', 'first_seen', 'last_seen'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'interaction_count';
      sql += ` ORDER BY ${sortField} DESC`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const advertisers = db.getRawDb().prepare(sql).all(...params);

      res.json({
        advertisers: advertisers.map((a: any) => ({
          id: a.id,
          name: a.name,
          targetingType: a.targeting_type,
          interactionCount: a.interaction_count,
          isDataBroker: !!a.is_data_broker,
          firstSeen: a.first_seen,
          lastSeen: a.last_seen,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error listing advertisers:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import advertisers from Facebook export
  router.post('/advertisers/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const { AdvertisersAndPagesParser } = await import('../services/facebook/AdvertisersAndPagesParser.js');
      const parser = new AdvertisersAndPagesParser();

      console.log(`[facebook] Importing advertisers from: ${exportPath}`);

      const result = await parser.parseAdvertisers(exportPath);
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      let inserted = 0;
      for (const advertiser of result.advertisers) {
        db.getRawDb().prepare(`
          INSERT OR REPLACE INTO fb_advertisers
          (id, name, targeting_type, interaction_count, first_seen, last_seen, is_data_broker, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          advertiser.id,
          advertiser.name,
          advertiser.targetingType,
          advertiser.interactionCount,
          advertiser.firstSeen || null,
          advertiser.lastSeen || null,
          advertiser.isDataBroker ? 1 : 0,
          now
        );
        inserted++;
      }

      console.log(`[facebook] Advertisers import complete: ${inserted} records`);

      res.json({
        success: true,
        stats: result.stats,
        imported: inserted,
      });
    } catch (err) {
      console.error('[facebook] Error importing advertisers:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PAGES ROUTES
  // ═══════════════════════════════════════════════════════════════════

  // Get pages statistics
  router.get('/pages/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const total = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_pages
      `).get() as { count: number }).count;

      const liked = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_pages WHERE is_liked = 1
      `).get() as { count: number }).count;

      const following = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_pages WHERE is_following = 1
      `).get() as { count: number }).count;

      const dateRange = db.getRawDb().prepare(`
        SELECT MIN(liked_at) as earliest, MAX(liked_at) as latest
        FROM fb_pages WHERE liked_at > 0
      `).get() as { earliest: number | null; latest: number | null };

      res.json({
        total,
        liked,
        following,
        earliestLike: dateRange?.earliest,
        latestLike: dateRange?.latest,
      });
    } catch (err) {
      console.error('[facebook] Error getting pages stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List pages
  router.get('/pages', async (req: Request, res: Response) => {
    try {
      const { limit = '100', offset = '0', search, liked, following, sortBy = 'liked_at' } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT * FROM fb_pages WHERE 1=1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search}%`);
      }

      if (liked === 'true') {
        sql += ` AND is_liked = 1`;
      }

      if (following === 'true') {
        sql += ` AND is_following = 1`;
      }

      const validSortFields = ['liked_at', 'followed_at', 'name'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'liked_at';
      sql += ` ORDER BY ${sortField} DESC NULLS LAST`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const pages = db.getRawDb().prepare(sql).all(...params);

      res.json({
        pages: pages.map((p: any) => ({
          id: p.id,
          name: p.name,
          facebookId: p.facebook_id,
          url: p.url,
          isLiked: !!p.is_liked,
          likedAt: p.liked_at,
          likedAtDate: p.liked_at ? new Date(p.liked_at * 1000).toISOString() : null,
          isFollowing: !!p.is_following,
          followedAt: p.followed_at,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error listing pages:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import pages from Facebook export
  router.post('/pages/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const { AdvertisersAndPagesParser } = await import('../services/facebook/AdvertisersAndPagesParser.js');
      const parser = new AdvertisersAndPagesParser();

      console.log(`[facebook] Importing pages from: ${exportPath}`);

      const result = await parser.parsePages(exportPath);
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      let inserted = 0;
      for (const page of result.pages) {
        db.getRawDb().prepare(`
          INSERT OR REPLACE INTO fb_pages
          (id, name, facebook_id, url, is_liked, liked_at, is_following, followed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          page.id,
          page.name,
          page.facebookId || null,
          page.url || null,
          page.isLiked ? 1 : 0,
          page.likedAt || null,
          page.isFollowing ? 1 : 0,
          page.followedAt || null,
          now
        );
        inserted++;
      }

      console.log(`[facebook] Pages import complete: ${inserted} records`);

      res.json({
        success: true,
        stats: result.stats,
        imported: inserted,
      });
    } catch (err) {
      console.error('[facebook] Error importing pages:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // REACTIONS ROUTES (Outbound reactions - user's reactions to others' content)
  // ═══════════════════════════════════════════════════════════════════

  // Get reactions statistics
  router.get('/reactions/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const total = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_outbound_reactions
      `).get() as { count: number }).count;

      const byType = db.getRawDb().prepare(`
        SELECT reaction_type, COUNT(*) as count
        FROM fb_outbound_reactions
        GROUP BY reaction_type
        ORDER BY count DESC
      `).all() as Array<{ reaction_type: string; count: number }>;

      const byTargetType = db.getRawDb().prepare(`
        SELECT target_type, COUNT(*) as count
        FROM fb_outbound_reactions
        WHERE target_type IS NOT NULL
        GROUP BY target_type
        ORDER BY count DESC
      `).all() as Array<{ target_type: string; count: number }>;

      const topAuthors = db.getRawDb().prepare(`
        SELECT target_author, COUNT(*) as count
        FROM fb_outbound_reactions
        WHERE target_author IS NOT NULL
        GROUP BY target_author
        ORDER BY count DESC
        LIMIT 20
      `).all() as Array<{ target_author: string; count: number }>;

      const dateRange = db.getRawDb().prepare(`
        SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest
        FROM fb_outbound_reactions
        WHERE timestamp > 1000
      `).get() as { earliest: number | null; latest: number | null };

      res.json({
        total,
        byType,
        byTargetType,
        topAuthors,
        dateRange: {
          earliest: dateRange?.earliest,
          latest: dateRange?.latest,
          earliestDate: dateRange?.earliest ? new Date(dateRange.earliest * 1000).toISOString() : null,
          latestDate: dateRange?.latest ? new Date(dateRange.latest * 1000).toISOString() : null,
        },
      });
    } catch (err) {
      console.error('[facebook] Error getting reactions stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List reactions
  router.get('/reactions', async (req: Request, res: Response) => {
    try {
      const { limit = '100', offset = '0', type, targetType, targetAuthor, sortBy = 'timestamp' } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT * FROM fb_outbound_reactions WHERE 1=1`;
      const params: unknown[] = [];

      if (type) {
        sql += ` AND reaction_type = ?`;
        params.push(type);
      }

      if (targetType) {
        sql += ` AND target_type = ?`;
        params.push(targetType);
      }

      if (targetAuthor) {
        sql += ` AND target_author LIKE ?`;
        params.push(`%${targetAuthor}%`);
      }

      const validSortFields = ['timestamp', 'reaction_type', 'target_author'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'timestamp';
      sql += ` ORDER BY ${sortField} DESC`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const reactions = db.getRawDb().prepare(sql).all(...params);

      res.json({
        reactions: reactions.map((r: any) => ({
          id: r.id,
          reactionType: r.reaction_type,
          targetType: r.target_type,
          targetAuthor: r.target_author,
          timestamp: r.timestamp,
          date: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null,
          title: r.title,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error listing reactions:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get reactions to a specific person's content
  router.get('/reactions/to/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { limit = '50' } = req.query;
      const decodedName = decodeURIComponent(name);
      const db = getEmbeddingDatabase();

      const reactions = db.getRawDb().prepare(`
        SELECT reaction_type, target_type, timestamp, title
        FROM fb_outbound_reactions
        WHERE target_author = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(decodedName, parseInt(limit as string)) as any[];

      const summary = db.getRawDb().prepare(`
        SELECT reaction_type, COUNT(*) as count
        FROM fb_outbound_reactions
        WHERE target_author = ?
        GROUP BY reaction_type
      `).all(decodedName) as Array<{ reaction_type: string; count: number }>;

      const total = reactions.length;
      const dateRange = db.getRawDb().prepare(`
        SELECT MIN(timestamp) as first, MAX(timestamp) as last
        FROM fb_outbound_reactions
        WHERE target_author = ? AND timestamp > 1000
      `).get(decodedName) as { first: number | null; last: number | null };

      res.json({
        targetAuthor: decodedName,
        total,
        summary,
        dateRange: {
          first: dateRange?.first,
          last: dateRange?.last,
          firstDate: dateRange?.first ? new Date(dateRange.first * 1000).toISOString() : null,
          lastDate: dateRange?.last ? new Date(dateRange.last * 1000).toISOString() : null,
        },
        reactions: reactions.map((r) => ({
          reactionType: r.reaction_type,
          targetType: r.target_type,
          timestamp: r.timestamp,
          date: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null,
          title: r.title,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error getting reactions to person:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import reactions from Facebook export
  router.post('/reactions/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const { ReactionsParser } = await import('../services/facebook/ReactionsParser.js');
      const parser = new ReactionsParser();

      const reactionsDir = path.join(exportPath, 'your_facebook_activity/comments_and_reactions');
      console.log(`[facebook] Importing reactions from: ${reactionsDir}`);

      const reactions = await parser.parseAll(reactionsDir);
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      // Get all people for linking
      const peopleMap = new Map<string, string>();
      const people = db.getRawDb().prepare('SELECT id, name FROM fb_people').all() as Array<{ id: string; name: string }>;
      for (const p of people) {
        peopleMap.set(p.name.toLowerCase(), p.id);
      }

      let inserted = 0;
      const byType: Record<string, number> = {};
      const byTargetType: Record<string, number> = {};

      const insertStmt = db.getRawDb().prepare(`
        INSERT OR REPLACE INTO fb_outbound_reactions
        (id, reaction_type, target_type, target_author, timestamp, title, target_person_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const reaction of reactions) {
        const context = (reaction as any).context || {};
        const title = (reaction as any).title;
        const targetAuthor = context.targetAuthor || null;
        const targetType = context.targetType || 'unknown';

        // Try to link to known person
        const targetPersonId = targetAuthor ? (peopleMap.get(targetAuthor.toLowerCase()) || null) : null;

        insertStmt.run(
          reaction.id,
          reaction.reaction_type,
          targetType,
          targetAuthor,
          reaction.created_at,
          title,
          targetPersonId,
          now
        );

        inserted++;
        byType[reaction.reaction_type] = (byType[reaction.reaction_type] || 0) + 1;
        byTargetType[targetType] = (byTargetType[targetType] || 0) + 1;
      }

      console.log(`[facebook] Reactions import complete: ${inserted} records`);

      res.json({
        success: true,
        imported: inserted,
        byType,
        byTargetType,
      });
    } catch (err) {
      console.error('[facebook] Error importing reactions:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ===========================================================================
  // NOTES ENDPOINTS
  // ===========================================================================

  // Get notes statistics
  router.get('/notes/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const total = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_notes
      `).get() as { count: number }).count;

      const wordStats = db.getRawDb().prepare(`
        SELECT
          SUM(word_count) as total_words,
          AVG(word_count) as avg_words,
          MAX(word_count) as max_words,
          MIN(word_count) as min_words
        FROM fb_notes
      `).get() as { total_words: number; avg_words: number; max_words: number; min_words: number };

      const longest = db.getRawDb().prepare(`
        SELECT id, title, word_count, created_timestamp
        FROM fb_notes
        ORDER BY word_count DESC
        LIMIT 5
      `).all() as any[];

      const dateRange = db.getRawDb().prepare(`
        SELECT MIN(created_timestamp) as earliest, MAX(created_timestamp) as latest
        FROM fb_notes
        WHERE created_timestamp > 1000
      `).get() as { earliest: number | null; latest: number | null };

      const withMedia = (db.getRawDb().prepare(`
        SELECT COUNT(*) as count FROM fb_notes WHERE has_media = 1
      `).get() as { count: number }).count;

      res.json({
        total,
        totalWords: wordStats?.total_words || 0,
        averageWords: Math.round(wordStats?.avg_words || 0),
        maxWords: wordStats?.max_words || 0,
        minWords: wordStats?.min_words || 0,
        withMedia,
        longestNotes: longest.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
        })),
        dateRange: {
          earliest: dateRange?.earliest,
          latest: dateRange?.latest,
          earliestDate: dateRange?.earliest ? new Date(dateRange.earliest * 1000).toISOString() : null,
          latestDate: dateRange?.latest ? new Date(dateRange.latest * 1000).toISOString() : null,
        },
      });
    } catch (err) {
      console.error('[facebook] Error getting notes stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List notes
  router.get('/notes', async (req: Request, res: Response) => {
    try {
      const {
        limit = '50',
        offset = '0',
        sortBy = 'created_timestamp',
        search,
        minWords,
        maxWords,
      } = req.query;
      const db = getEmbeddingDatabase();

      let sql = `SELECT id, title, word_count, char_count, created_timestamp, updated_timestamp, has_media, media_count, tags FROM fb_notes WHERE 1=1`;
      const params: unknown[] = [];

      if (search) {
        sql += ` AND (title LIKE ? OR text LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      if (minWords) {
        sql += ` AND word_count >= ?`;
        params.push(parseInt(minWords as string));
      }

      if (maxWords) {
        sql += ` AND word_count <= ?`;
        params.push(parseInt(maxWords as string));
      }

      const validSortFields = ['created_timestamp', 'word_count', 'title'];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_timestamp';
      sql += ` ORDER BY ${sortField} DESC`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(parseInt(limit as string), parseInt(offset as string));

      const notes = db.getRawDb().prepare(sql).all(...params);

      res.json({
        notes: notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          charCount: n.char_count,
          createdTimestamp: n.created_timestamp,
          updatedTimestamp: n.updated_timestamp,
          hasMedia: n.has_media === 1,
          mediaCount: n.media_count,
          tags: n.tags ? JSON.parse(n.tags) : [],
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error listing notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Search notes by text content (must come before :id route)
  router.get('/notes/search', async (req: Request, res: Response) => {
    try {
      const { q, limit = '20' } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Query parameter q required' });
        return;
      }

      const db = getEmbeddingDatabase();

      const notes = db.getRawDb().prepare(`
        SELECT id, title, word_count, created_timestamp,
               substr(text, max(1, instr(lower(text), lower(?)) - 50), 200) as excerpt
        FROM fb_notes
        WHERE title LIKE ? OR text LIKE ?
        ORDER BY word_count DESC
        LIMIT ?
      `).all(q, `%${q}%`, `%${q}%`, parseInt(limit as string)) as any[];

      res.json({
        query: q,
        count: notes.length,
        results: notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          wordCount: n.word_count,
          date: n.created_timestamp ? new Date(n.created_timestamp * 1000).toISOString() : null,
          excerpt: n.excerpt ? `...${n.excerpt}...` : null,
        })),
      });
    } catch (err) {
      console.error('[facebook] Error searching notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Semantic search notes (must come before :id route)
  router.get('/notes/semantic-search', async (req: Request, res: Response) => {
    try {
      const { q, limit = '10' } = req.query;
      if (!q) {
        res.status(400).json({ error: 'Query parameter q required' });
        return;
      }

      const db = getEmbeddingDatabase();
      const { embed } = await import('../services/embeddings/EmbeddingGenerator.js');

      // Generate query embedding
      const queryEmbedding = await embed(q as string);

      // Search for similar notes
      const results = db.searchContentItems(
        queryEmbedding,
        parseInt(limit as string),
        'note',
        'facebook'
      );

      // Get full note data for results
      const notes = results.map(result => {
        const note = db.getRawDb().prepare(`
          SELECT n.id, n.title, n.word_count, n.created_timestamp,
                 substr(n.text, 1, 300) as excerpt
          FROM fb_notes n
          WHERE n.content_item_id = ?
        `).get(result.content_item_id) as any;

        return {
          id: note?.id,
          title: note?.title,
          wordCount: note?.word_count,
          date: note?.created_timestamp ? new Date(note.created_timestamp * 1000).toISOString() : null,
          excerpt: note?.excerpt ? note.excerpt + '...' : null,
          similarity: 1 - result.distance,  // Convert distance to similarity
        };
      }).filter(n => n.id);  // Filter out any null results

      res.json({
        query: q,
        count: notes.length,
        results: notes,
      });
    } catch (err) {
      console.error('[facebook] Error in semantic search:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get a specific note with full text
  router.get('/notes/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const db = getEmbeddingDatabase();

      const note = db.getRawDb().prepare(`
        SELECT * FROM fb_notes WHERE id = ?
      `).get(id) as any;

      if (!note) {
        res.status(404).json({ error: 'Note not found' });
        return;
      }

      res.json({
        id: note.id,
        title: note.title,
        text: note.text,
        wordCount: note.word_count,
        charCount: note.char_count,
        createdTimestamp: note.created_timestamp,
        updatedTimestamp: note.updated_timestamp,
        hasMedia: note.has_media === 1,
        mediaCount: note.media_count,
        mediaPaths: note.media_paths ? JSON.parse(note.media_paths) : [],
        tags: note.tags ? JSON.parse(note.tags) : [],
        date: note.created_timestamp ? new Date(note.created_timestamp * 1000).toISOString() : null,
        updatedDate: note.updated_timestamp ? new Date(note.updated_timestamp * 1000).toISOString() : null,
      });
    } catch (err) {
      console.error('[facebook] Error getting note:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Import notes from Facebook export
  router.post('/notes/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        res.status(400).json({ error: 'exportPath required' });
        return;
      }

      const { NotesParser } = await import('../services/facebook/NotesParser.js');
      const parser = new NotesParser();

      console.log(`[facebook] Importing notes from: ${exportPath}`);

      const result = await parser.parse(exportPath);
      const db = getEmbeddingDatabase();
      const now = Date.now() / 1000;

      let inserted = 0;

      const insertStmt = db.getRawDb().prepare(`
        INSERT OR REPLACE INTO fb_notes
        (id, title, text, word_count, char_count, created_timestamp, updated_timestamp,
         has_media, media_count, media_paths, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const note of result.notes) {
        insertStmt.run(
          note.id,
          note.title,
          note.text,
          note.wordCount,
          note.charCount,
          note.createdTimestamp,
          note.updatedTimestamp,
          note.hasMedia ? 1 : 0,
          note.mediaCount,
          JSON.stringify(note.mediaPaths),
          JSON.stringify(note.tags),
          now
        );
        inserted++;
      }

      console.log(`[facebook] Notes import complete: ${inserted} notes`);

      res.json({
        success: true,
        imported: inserted,
        stats: result.stats,
      });
    } catch (err) {
      console.error('[facebook] Error importing notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Embed notes for semantic search (with chunking for long content)
  router.post('/notes/embed', async (req: Request, res: Response) => {
    try {
      const { batchSize = 5, forceReembed = false } = req.body;
      const db = getEmbeddingDatabase();

      // Get notes: either all without embeddings, or all if force re-embed
      const notes = db.getRawDb().prepare(
        forceReembed
          ? `SELECT id, title, text, word_count, created_timestamp FROM fb_notes ORDER BY word_count DESC`
          : `SELECT n.id, n.title, n.text, n.word_count, n.created_timestamp
             FROM fb_notes n
             WHERE n.content_item_id IS NULL
             ORDER BY n.word_count DESC`
      ).all() as Array<{
        id: string;
        title: string;
        text: string;
        word_count: number;
        created_timestamp: number;
      }>;

      if (notes.length === 0) {
        const existingCount = (db.getRawDb().prepare(`
          SELECT COUNT(*) as count FROM content_items WHERE type = 'note' AND source = 'facebook'
        `).get() as { count: number }).count;

        res.json({
          success: true,
          message: existingCount > 0 ? 'Notes already embedded' : 'No notes to embed',
          embedded: 0,
          existingCount,
        });
        return;
      }

      console.log(`[facebook] Embedding ${notes.length} notes...`);

      // Dynamically import embedding generator and chunker
      const { embed } = await import('../services/embeddings/EmbeddingGenerator.js');
      const { ContentChunker } = await import('../services/embeddings/ContentChunker.js');

      const chunker = new ContentChunker({
        targetProseWords: 400,  // ~1600 chars, well under 24K limit
        maxChunkWords: 800,
        idPrefix: 'note_chunk',
      });

      // Threshold for chunking: ~1000 words (about 4K chars, safe for 8K token context)
      const CHUNK_THRESHOLD_WORDS = 1000;

      const now = Date.now() / 1000;
      let embedded = 0;
      let failed = 0;
      let chunkedNotes = 0;
      let totalChunks = 0;

      // Process in batches
      for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        console.log(`[facebook] Processing notes ${i + 1}-${Math.min(i + batchSize, notes.length)} of ${notes.length}`);

        for (const note of batch) {
          try {
            const contentItemId = `fb_note_content_${note.id}`;
            const embeddingText = `${note.title}\n\n${note.text}`;

            // Decide chunking strategy based on length
            const needsChunking = note.word_count > CHUNK_THRESHOLD_WORDS;
            let embedding: number[];

            if (needsChunking) {
              // Chunk the note and embed each chunk
              const chunks = chunker.chunk(embeddingText);
              console.log(`   📄 ${note.title.substring(0, 30)}... (${note.word_count} words → ${chunks.length} chunks)`);

              const chunkEmbeddings: number[][] = [];

              for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                const chunkEmbedding = await embed(chunk.content);
                chunkEmbeddings.push(chunkEmbedding);

                // Store each chunk embedding
                const chunkId = `${contentItemId}_chunk_${ci}`;
                db.insertContentItemEmbedding(
                  `emb_${chunkId}`,
                  contentItemId,  // Link to parent
                  'note_chunk',
                  'facebook',
                  chunkEmbedding
                );
              }

              // Aggregate: mean pooling of chunk embeddings
              const dim = chunkEmbeddings[0].length;
              embedding = new Array(dim).fill(0);
              for (const chunkEmb of chunkEmbeddings) {
                for (let d = 0; d < dim; d++) {
                  embedding[d] += chunkEmb[d] / chunkEmbeddings.length;
                }
              }

              chunkedNotes++;
              totalChunks += chunks.length;
            } else {
              // Direct embedding for shorter notes
              embedding = await embed(embeddingText);
              console.log(`   ✓ ${note.title.substring(0, 40)}... (${note.word_count} words)`);
            }

            // Create content_item entry (contentItemId already declared above)
            db.insertContentItem({
              id: contentItemId,
              type: 'note',
              source: 'facebook',
              text: note.text,
              title: note.title,
              created_at: note.created_timestamp,
              is_own_content: true,
              context: JSON.stringify({
                noteId: note.id,
                wordCount: note.word_count,
                chunked: needsChunking,
                chunkCount: needsChunking ? totalChunks - (chunkedNotes - 1) * 0 : 0,  // Approximate
              }),
            });

            // Insert aggregate/direct embedding for the note itself
            db.insertContentItemEmbedding(
              `emb_${contentItemId}`,
              contentItemId,
              'note',
              'facebook',
              embedding
            );

            // Link note to content_item
            db.getRawDb().prepare(`
              UPDATE fb_notes SET content_item_id = ? WHERE id = ?
            `).run(contentItemId, note.id);

            embedded++;
          } catch (err) {
            failed++;
            console.error(`   ✗ Failed: ${note.title.substring(0, 40)}...`, err);
          }
        }
      }

      console.log(`[facebook] Notes embedding complete: ${embedded} embedded, ${failed} failed`);
      if (chunkedNotes > 0) {
        console.log(`   Chunked ${chunkedNotes} long notes into ${totalChunks} chunks`);
      }

      res.json({
        success: true,
        embedded,
        failed,
        total: notes.length,
        chunkedNotes,
        totalChunks,
      });
    } catch (err) {
      console.error('[facebook] Error embedding notes:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ===========================================================================
  // Groups Routes
  // ===========================================================================

  // GET /groups/stats - Summary statistics for groups
  router.get('/groups/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const stats = db.getRawDb().prepare(`
        SELECT
          COUNT(*) as total_groups,
          SUM(post_count) as total_posts,
          SUM(comment_count) as total_comments,
          MIN(joined_at) as earliest_join,
          MAX(last_activity) as latest_activity
        FROM fb_groups
      `).get() as {
        total_groups: number;
        total_posts: number;
        total_comments: number;
        earliest_join: number | null;
        latest_join: number | null;
        latest_activity: number | null;
      } | undefined;

      const topByPosts = db.getRawDb().prepare(`
        SELECT name, post_count, comment_count
        FROM fb_groups
        ORDER BY post_count DESC
        LIMIT 5
      `).all();

      const topByComments = db.getRawDb().prepare(`
        SELECT name, post_count, comment_count
        FROM fb_groups
        ORDER BY comment_count DESC
        LIMIT 5
      `).all();

      res.json({
        totalGroups: stats?.total_groups || 0,
        totalPosts: stats?.total_posts || 0,
        totalComments: stats?.total_comments || 0,
        earliestJoin: stats?.earliest_join,
        latestActivity: stats?.latest_activity,
        topByPosts,
        topByComments,
      });
    } catch (err) {
      console.error('[facebook] Error getting groups stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /groups - List all groups with activity stats
  router.get('/groups', async (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string;
      const sortBy = (req.query.sortBy as string) || 'activity';

      let query = `
        SELECT id, name, joined_at, post_count, comment_count, last_activity
        FROM fb_groups
      `;
      const params: unknown[] = [];

      if (search) {
        query += ` WHERE name LIKE ?`;
        params.push(`%${search}%`);
      }

      // Sort options
      switch (sortBy) {
        case 'posts':
          query += ` ORDER BY post_count DESC`;
          break;
        case 'comments':
          query += ` ORDER BY comment_count DESC`;
          break;
        case 'joined':
          query += ` ORDER BY joined_at DESC`;
          break;
        case 'activity':
        default:
          query += ` ORDER BY last_activity DESC`;
      }

      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const groups = db.getRawDb().prepare(query).all(...params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as count FROM fb_groups`;
      if (search) {
        countQuery += ` WHERE name LIKE ?`;
      }
      const { count: total } = db.getRawDb().prepare(countQuery).get(
        ...(search ? [`%${search}%`] : [])
      ) as { count: number };

      res.json({
        groups,
        total,
        hasMore: offset + groups.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error listing groups:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /groups/:id - Get a single group with details
  router.get('/groups/:id', async (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const { id } = req.params;

      const group = db.getRawDb().prepare(`
        SELECT id, name, joined_at, post_count, comment_count, last_activity
        FROM fb_groups
        WHERE id = ?
      `).get(id);

      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      res.json(group);
    } catch (err) {
      console.error('[facebook] Error getting group:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /groups/:id/content - Get posts and comments for a group
  router.get('/groups/:id/content', async (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const { id } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const type = req.query.type as string; // 'post' | 'comment' | undefined (all)

      let query = `
        SELECT id, group_id, type, text, timestamp, original_author, external_urls, title
        FROM fb_group_content
        WHERE group_id = ?
      `;
      const params: unknown[] = [id];

      if (type === 'post' || type === 'comment') {
        query += ` AND type = ?`;
        params.push(type);
      }

      query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const content = db.getRawDb().prepare(query).all(...params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as count FROM fb_group_content WHERE group_id = ?`;
      const countParams: unknown[] = [id];
      if (type === 'post' || type === 'comment') {
        countQuery += ` AND type = ?`;
        countParams.push(type);
      }
      const { count: total } = db.getRawDb().prepare(countQuery).get(...countParams) as { count: number };

      res.json({
        content,
        total,
        hasMore: offset + content.length < total,
      });
    } catch (err) {
      console.error('[facebook] Error getting group content:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /groups/import - Import groups from Facebook export
  router.post('/groups/import', async (req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const { exportPath } = req.body;

      if (!exportPath) {
        return res.status(400).json({ error: 'exportPath required' });
      }

      // Import GroupsParser
      const { GroupsParser } = await import('../services/facebook/GroupsParser.js');
      const parser = new GroupsParser();

      const exists = await parser.exists(exportPath);
      if (!exists) {
        return res.status(404).json({ error: 'No groups data found in export' });
      }

      const result = await parser.parse(exportPath);

      // Insert groups
      const insertGroup = db.getRawDb().prepare(`
        INSERT OR REPLACE INTO fb_groups
        (id, name, joined_at, post_count, comment_count, last_activity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertContent = db.getRawDb().prepare(`
        INSERT OR REPLACE INTO fb_group_content
        (id, group_id, type, text, timestamp, original_author, external_urls, title, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now() / 1000;

      // Insert groups
      for (const group of result.groups) {
        insertGroup.run(
          group.id,
          group.name,
          group.joinedAt,
          group.postCount,
          group.commentCount,
          group.lastActivity,
          now
        );
      }

      // Insert posts
      for (const post of result.posts) {
        const groupId = `fb_group_${post.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 40)}`;
        insertContent.run(
          post.id,
          groupId,
          'post',
          post.text,
          post.timestamp,
          null,
          JSON.stringify(post.externalUrls),
          post.title,
          now
        );
      }

      // Insert comments
      for (const comment of result.comments) {
        const groupId = `fb_group_${comment.groupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 40)}`;
        insertContent.run(
          comment.id,
          groupId,
          'comment',
          comment.text,
          comment.timestamp,
          comment.originalPostAuthor,
          null,
          comment.title,
          now
        );
      }

      res.json({
        success: true,
        stats: result.stats,
      });
    } catch (err) {
      console.error('[facebook] Error importing groups:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // MESSENGER IMPORT ROUTE
  // ═══════════════════════════════════════════════════════════════════

  // POST /messenger/import - Import all messenger threads from export
  router.post('/messenger/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        return res.status(400).json({ error: 'exportPath is required' });
      }

      console.log('[facebook] Importing messenger from:', exportPath);

      // Import MessengerParser dynamically
      const { MessengerParser } = await import('../services/facebook/MessengerParser.js');
      const parser = new MessengerParser();

      // Parse all messenger threads
      const result = await parser.parseAll({
        exportPath,
        includeGroupChats: true,
        minMessages: 1,
        onProgress: (current, total, threadName) => {
          if (current % 100 === 0 || current === total) {
            console.log(`[messenger] Parsing thread ${current}/${total}: ${threadName}`);
          }
        },
      });

      console.log(`[messenger] Parsed ${result.threads} threads with ${result.messages.length} messages`);

      // Insert messages into content_items
      const db = getEmbeddingDatabase();
      const rawDb = db.getRawDb();

      // Prepare insert statement
      const insertStmt = rawDb.prepare(`
        INSERT OR REPLACE INTO content_items (
          id, type, source, text, title, created_at,
          author_name, is_own_content, thread_id, context,
          media_refs, metadata, search_text, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now() / 1000;
      let inserted = 0;

      // Insert in transaction for performance
      const insertMany = rawDb.transaction(() => {
        for (const msg of result.messages) {
          insertStmt.run(
            msg.id,
            msg.type,
            msg.source,
            msg.text || null,
            msg.title || null,
            msg.created_at,
            msg.author_name || null,
            msg.is_own_content ? 1 : 0,
            msg.thread_id || null,
            msg.context || null,
            msg.media_refs ? JSON.stringify(msg.media_refs) : null,
            msg.metadata ? JSON.stringify(msg.metadata) : null,
            msg.search_text || null,
            now
          );
          inserted++;
        }
      });

      insertMany();

      console.log(`[messenger] Inserted ${inserted} messages into database`);

      res.json({
        success: true,
        stats: {
          threads: result.threads,
          messages: inserted,
          errors: result.errors.length,
        },
      });
    } catch (err) {
      console.error('[facebook] Error importing messenger:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /messenger/stats - Get messenger statistics
  router.get('/messenger/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();

      const stats = db.getRawDb().prepare(`
        SELECT
          COUNT(DISTINCT thread_id) as totalThreads,
          COUNT(*) as totalMessages,
          SUM(CASE WHEN is_own_content = 1 THEN 1 ELSE 0 END) as sentMessages,
          SUM(CASE WHEN is_own_content = 0 THEN 1 ELSE 0 END) as receivedMessages,
          MIN(created_at) as earliestMessage,
          MAX(created_at) as latestMessage
        FROM content_items
        WHERE source = 'facebook' AND type = 'message'
      `).get() as {
        totalThreads: number;
        totalMessages: number;
        sentMessages: number;
        receivedMessages: number;
        earliestMessage: number;
        latestMessage: number;
      };

      // Get top threads by message count
      const topThreads = db.getRawDb().prepare(`
        SELECT
          thread_id,
          MAX(title) as title,
          COUNT(*) as messageCount,
          MAX(created_at) as lastMessage
        FROM content_items
        WHERE source = 'facebook' AND type = 'message' AND thread_id IS NOT NULL
        GROUP BY thread_id
        ORDER BY messageCount DESC
        LIMIT 10
      `).all();

      res.json({
        ...stats,
        topThreads,
      });
    } catch (err) {
      console.error('[facebook] Error getting messenger stats:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
