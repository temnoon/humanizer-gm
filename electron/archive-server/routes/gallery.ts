/**
 * Gallery Router - Browse images from all conversations
 *
 * Routes:
 * - GET /api/gallery - List all images from conversations with media
 * - GET /api/gallery/search - Search images by AI-generated descriptions
 * - GET /api/gallery/analysis/:id - Get analysis for a specific image
 * - POST /api/gallery/analysis/batch - Batch sync analysis results from queue
 * - GET /api/gallery/analysis/search - Search images by description (FTS)
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getArchiveRoot } from '../config';
import { getConversationsFromIndex } from './archives';
import { getEmbeddingDatabase } from '../services/registry';

// Security: Maximum batch size for bulk operations
const MAX_BATCH_SIZE = 1000;

// Security: Validate UUID format
function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Security: Validate file path is within allowed directories
function isPathSafe(filePath: string, archiveRoot: string): boolean {
  const normalized = path.normalize(filePath);
  // Allow paths within archive root or common media locations
  const allowedRoots = [
    archiveRoot,
    path.join(process.env.HOME || '', 'Pictures'),
    path.join(process.env.HOME || '', 'Documents'),
  ];
  return allowedRoots.some(root => normalized.startsWith(root));
}

interface GalleryImage {
  id: string;
  url: string;
  filename: string;
  conversationFolder: string;
  conversationTitle: string;
  conversationCreatedAt: number | null;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export function createGalleryRouter(): Router {
  const router = Router();

  // List all images from conversations
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const searchQuery = (req.query.search as string)?.toLowerCase();

      const archiveRoot = getArchiveRoot();

      // Get all conversations with images from the index
      const allConversations = await getConversationsFromIndex(archiveRoot);
      const conversationsWithImages = allConversations.filter(c => c.has_images);

      const images: GalleryImage[] = [];

      for (const conv of conversationsWithImages) {
        try {
          const folderPath = path.join(archiveRoot, conv.folder);
          const mediaPath = path.join(folderPath, 'media');

          // Load media manifest if it exists
          let mediaManifest: Record<string, string> = {};
          try {
            const manifestPath = path.join(folderPath, 'media_manifest.json');
            const manifestData = await fs.readFile(manifestPath, 'utf-8');
            mediaManifest = JSON.parse(manifestData);
          } catch {
            // No manifest
          }

          // Read media files from /media/ subfolder
          let mediaFiles: string[] = [];
          try {
            const files = await fs.readdir(mediaPath);
            mediaFiles = files.filter(f =>
              /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
            );
          } catch {
            // Try root folder fallback
            const files = await fs.readdir(folderPath);
            mediaFiles = files.filter(f =>
              /\.(jpg|jpeg|png|gif|webp)$/i.test(f)
            );
          }

          for (const file of mediaFiles) {
            // Apply search filter
            if (searchQuery) {
              const matchesSearch =
                file.toLowerCase().includes(searchQuery) ||
                conv.title.toLowerCase().includes(searchQuery);
              if (!matchesSearch) continue;
            }

            images.push({
              id: `${conv.folder}/${file}`,
              url: `/api/conversations/${encodeURIComponent(conv.folder)}/media/${encodeURIComponent(file)}`,
              filename: file,
              conversationFolder: conv.folder,
              conversationTitle: conv.title,
              conversationCreatedAt: conv.created_at ?? null,
            });
          }
        } catch (err) {
          console.warn(`[gallery] Error processing ${conv.folder}:`, (err as Error).message);
          continue;
        }
      }

      // Sort by conversation creation date (newest first)
      images.sort((a, b) => (b.conversationCreatedAt || 0) - (a.conversationCreatedAt || 0));

      // Paginate
      const paginatedImages = images.slice(offset, offset + limit);

      res.json({
        images: paginatedImages,
        total: images.length,
        offset,
        limit,
        hasMore: offset + limit < images.length,
      });
    } catch (err) {
      console.error('[gallery] Error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // IMAGE ANALYSIS ENDPOINTS
  // Note: Specific routes must come BEFORE parameterized routes
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get analysis by file path
   * Security: Validates path is within allowed directories
   */
  router.get('/analysis/by-path', async (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string;

      if (!filePath) {
        res.status(400).json({ error: 'path query parameter required' });
        return;
      }

      const archiveRoot = getArchiveRoot();

      // Security: Validate path is within allowed directories
      if (!isPathSafe(filePath, archiveRoot)) {
        console.warn('[gallery] Path traversal attempt:', filePath);
        res.status(403).json({ error: 'Path not allowed' });
        return;
      }

      const db = getEmbeddingDatabase();
      const analysis = db.getImageAnalysisByPath(filePath);

      if (!analysis) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
      }

      res.json({
        success: true,
        data: analysis,
      });
    } catch (err) {
      console.error('[gallery] Analysis by path error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Batch sync analysis results from queue manager
   * Security: Validates batch size and sanitizes inputs
   */
  router.post('/analysis/batch', async (req: Request, res: Response) => {
    try {
      const { results } = req.body;

      // Security: Validate input is array
      if (!Array.isArray(results)) {
        res.status(400).json({ error: 'results must be an array' });
        return;
      }

      // Security: Limit batch size
      if (results.length > MAX_BATCH_SIZE) {
        res.status(400).json({ error: `Batch too large (max ${MAX_BATCH_SIZE})` });
        return;
      }

      const archiveRoot = getArchiveRoot();
      const db = getEmbeddingDatabase();

      let added = 0;
      let updated = 0;
      const errors: Array<{ filePath: string; error: string }> = [];

      for (const item of results) {
        try {
          // Validate required fields
          if (!item.filePath || typeof item.filePath !== 'string') {
            errors.push({ filePath: item.filePath || 'unknown', error: 'Invalid filePath' });
            continue;
          }

          if (!item.data) {
            errors.push({ filePath: item.filePath, error: 'Missing data object' });
            continue;
          }

          // Security: Validate path
          if (!isPathSafe(item.filePath, archiveRoot)) {
            errors.push({ filePath: item.filePath, error: 'Path not allowed' });
            continue;
          }

          // Check if exists
          const existing = db.getImageAnalysisByPath(item.filePath);

          // Upsert
          db.upsertImageAnalysis({
            id: existing?.id || item.id || crypto.randomUUID(),
            file_path: item.filePath,
            file_hash: item.fileHash,
            source: item.source || 'queue',
            description: item.data.description,
            categories: item.data.categories,
            objects: item.data.objects,
            scene: item.data.scene,
            mood: item.data.mood,
            model_used: item.data.model,
            confidence: item.data.confidence,
            processing_time_ms: item.processingTimeMs,
          });

          if (existing) {
            updated++;
          } else {
            added++;
          }
        } catch (err) {
          errors.push({ filePath: item.filePath, error: (err as Error).message });
        }
      }

      res.json({
        success: true,
        added,
        updated,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      console.error('[gallery] Batch sync error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Search images by description using FTS
   */
  router.get('/analysis/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 20;
      const source = req.query.source as string;

      if (!query) {
        res.status(400).json({ error: 'q query parameter required' });
        return;
      }

      const db = getEmbeddingDatabase();
      const results = db.searchImagesFTS(query, { limit, source });

      // Build URLs for each result
      const archiveRoot = getArchiveRoot();
      const resultsWithUrls = results.map(r => {
        // Determine URL based on file path
        let url = r.file_path;
        if (r.file_path.startsWith(archiveRoot)) {
          // Relative to archive - construct API URL
          const relativePath = r.file_path.slice(archiveRoot.length + 1);
          const parts = relativePath.split(path.sep);
          if (parts.length >= 2) {
            const folder = parts[0];
            const filename = parts.slice(1).join('/');
            url = `/api/conversations/${encodeURIComponent(folder)}/media/${encodeURIComponent(filename)}`;
          }
        }

        return {
          ...r,
          url,
        };
      });

      res.json({
        success: true,
        results: resultsWithUrls,
        total: results.length,
        query,
      });
    } catch (err) {
      console.error('[gallery] Search error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Get image analysis statistics
   */
  router.get('/analysis/stats', async (_req: Request, res: Response) => {
    try {
      const db = getEmbeddingDatabase();
      const stats = db.getImageAnalysisStats();

      res.json({
        success: true,
        stats,
      });
    } catch (err) {
      console.error('[gallery] Stats error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Get analysis for a specific image by ID
   * Security: Validates UUID format
   * Note: This parameterized route MUST come after all specific routes
   */
  router.get('/analysis/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Security: Validate ID format
      if (!isValidUUID(id)) {
        res.status(400).json({ error: 'Invalid ID format' });
        return;
      }

      const db = getEmbeddingDatabase();
      const analysis = db.getImageAnalysisById(id);

      if (!analysis) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
      }

      res.json({
        success: true,
        data: analysis,
      });
    } catch (err) {
      console.error('[gallery] Analysis lookup error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
