/**
 * Conversations Router - Browse and read conversations
 *
 * Routes:
 * - GET /api/conversations - List all conversations
 * - GET /api/conversations/:folder - Get single conversation
 * - GET /api/conversations/:folder/media/:filename - Serve media file
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { getArchiveRoot } from '../config';
import { getConversationsFromIndex } from './archives';

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION PARSER
// ═══════════════════════════════════════════════════════════════════

interface MessagePart {
  type: 'text' | 'image' | 'audio' | 'file' | 'code' | 'execution_output';
  content?: string;
  url?: string;
  filename?: string;
  language?: string;
  asset_pointer?: string;
}

interface ParsedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessagePart[];
  model?: string;
  created_at?: number;
  parent_id?: string;
}

interface ParsedConversation {
  id: string;
  title: string;
  created_at?: number;
  updated_at?: number;
  messages: ParsedMessage[];
  model?: string;
}

/**
 * Extract assetPointerMap from conversation.html
 * This maps file-service://file-XXX pointers to actual filenames
 */
async function extractAssetPointerMap(folderPath: string): Promise<Record<string, string>> {
  try {
    const htmlPath = path.join(folderPath, 'conversation.html');
    const html = await fs.readFile(htmlPath, 'utf-8');

    // Extract assetPointerMap = {...} from HTML
    const match = html.match(/assetPointerMap\s*=\s*(\{[^}]+\})/);
    if (match) {
      // Parse the JSON (handle unicode escapes)
      return JSON.parse(match[1]);
    }
  } catch {
    // HTML file doesn't exist or couldn't parse
  }
  return {};
}

/**
 * Load media_manifest.json which maps display names to actual filenames
 */
async function loadMediaManifest(folderPath: string): Promise<Record<string, string>> {
  try {
    const manifestPath = path.join(folderPath, 'media_manifest.json');
    const data = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    // No manifest file
  }
  return {};
}

/**
 * Parse a conversation.json file into a structured format
 */
async function parseConversation(folderPath: string): Promise<ParsedConversation> {
  const jsonPath = path.join(folderPath, 'conversation.json');
  const data = await fs.readFile(jsonPath, 'utf-8');
  const raw = JSON.parse(data);

  // Get asset pointer map for resolving image URLs
  const assetPointerMap = await extractAssetPointerMap(folderPath);
  // Get media manifest for resolving attachment display names to actual filenames
  const mediaManifest = await loadMediaManifest(folderPath);
  const folderName = path.basename(folderPath);

  const messages: ParsedMessage[] = [];

  if (raw.mapping) {
    // Build the message tree
    const nodes = Object.values(raw.mapping) as any[];

    // Sort by tree position (find root, then traverse children)
    const rootId = Object.keys(raw.mapping).find(
      id => !raw.mapping[id].parent
    );

    if (rootId) {
      const visited = new Set<string>();
      const queue = [rootId];

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = raw.mapping[nodeId];
        if (node?.message?.content?.parts) {
          const msg = node.message;
          const parts: MessagePart[] = [];

          for (const part of msg.content.parts) {
            if (typeof part === 'string') {
              if (part.trim()) {
                parts.push({ type: 'text', content: part });
              }
            } else if (part?.content_type === 'image_asset_pointer') {
              // Resolve asset pointer to actual filename using the map
              const assetPointer = part.asset_pointer as string;
              const filename = assetPointerMap[assetPointer];
              const url = filename
                ? `/api/conversations/${folderName}/media/${encodeURIComponent(filename)}`
                : assetPointer; // Fallback to raw pointer if not found
              parts.push({
                type: 'image',
                asset_pointer: assetPointer,
                url,
                filename,
              });
            } else if (part?.content_type === 'audio_asset_pointer') {
              // Resolve asset pointer to actual filename using the map
              const assetPointer = part.asset_pointer as string;
              const filename = assetPointerMap[assetPointer];
              const url = filename
                ? `/api/conversations/${folderName}/media/${encodeURIComponent(filename)}`
                : assetPointer;
              parts.push({
                type: 'audio',
                asset_pointer: assetPointer,
                url,
                filename,
              });
            } else if (part?.content_type === 'code') {
              parts.push({
                type: 'code',
                content: part.text,
                language: part.language,
              });
            } else if (part?.content_type === 'execution_output') {
              parts.push({
                type: 'execution_output',
                content: part.text,
              });
            }
          }

          // Handle attachments
          if (msg.metadata?.attachments) {
            for (const att of msg.metadata.attachments) {
              const displayName = att.filename || att.name;
              // Use media manifest to get actual filename, or fall back to display name
              const actualFilename = mediaManifest[displayName] || displayName;
              if (/\.(jpg|jpeg|png|gif|webp)$/i.test(displayName)) {
                parts.push({
                  type: 'image',
                  filename: displayName,
                  url: `/api/conversations/${folderName}/media/${encodeURIComponent(actualFilename)}`,
                });
              } else if (/\.(wav|mp3|m4a|ogg)$/i.test(displayName)) {
                parts.push({
                  type: 'audio',
                  filename: displayName,
                  url: `/api/conversations/${folderName}/media/${encodeURIComponent(actualFilename)}`,
                });
              } else {
                parts.push({
                  type: 'file',
                  filename: displayName,
                  url: `/api/conversations/${folderName}/media/${encodeURIComponent(actualFilename)}`,
                });
              }
            }
          }

          if (parts.length > 0) {
            messages.push({
              id: nodeId,
              role: msg.author?.role || 'user',
              content: parts,
              model: msg.metadata?.model_slug,
              created_at: msg.create_time,
              parent_id: node.parent,
            });
          }
        }

        // Add children to queue
        if (node?.children) {
          queue.push(...node.children);
        }
      }
    }
  }

  return {
    id: raw.id || path.basename(folderPath),
    title: raw.title || 'Untitled',
    created_at: raw.create_time,
    updated_at: raw.update_time,
    messages,
    model: raw.default_model_slug,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createConversationsRouter(): Router {
  const router = Router();

  // List all conversations
  router.get('/', async (req: Request, res: Response) => {
    try {
      const archiveRoot = getArchiveRoot();

      // Get query params for filtering
      const {
        search,
        hasImages,
        hasAudio,
        sortBy = 'created_at',
        sortOrder = 'desc',
        limit,
        offset = 0,
      } = req.query;

      // Get from index (fast)
      let conversations = await getConversationsFromIndex(archiveRoot);

      // Apply filters
      if (search) {
        const searchStr = String(search).toLowerCase();
        conversations = conversations.filter(c =>
          c.title.toLowerCase().includes(searchStr)
        );
      }

      if (hasImages === 'true') {
        conversations = conversations.filter(c => c.has_images);
      }

      if (hasAudio === 'true') {
        conversations = conversations.filter(c => c.has_audio);
      }

      // Sort
      const sortField = String(sortBy) as keyof typeof conversations[0];
      conversations.sort((a, b) => {
        const aVal = a[sortField] ?? 0;
        const bVal = b[sortField] ?? 0;
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });

      // Paginate
      const total = conversations.length;
      const startIdx = Number(offset) || 0;
      const endIdx = limit ? startIdx + Number(limit) : undefined;
      const paginated = conversations.slice(startIdx, endIdx);

      res.json({
        total,
        offset: startIdx,
        limit: limit ? Number(limit) : null,
        conversations: paginated,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get single conversation
  router.get('/:folder', async (req: Request, res: Response) => {
    try {
      const { folder } = req.params;
      const archiveRoot = getArchiveRoot();
      const folderPath = path.join(archiveRoot, folder);

      // Verify folder exists
      try {
        await fs.access(folderPath);
      } catch {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Parse and return
      const conversation = await parseConversation(folderPath);

      // Get media files from /media/ subfolder
      const mediaPath = path.join(folderPath, 'media');
      let mediaFiles: string[] = [];
      try {
        const files = await fs.readdir(mediaPath);
        mediaFiles = files.filter(f =>
          /\.(jpg|jpeg|png|gif|webp|wav|mp3|m4a|ogg)$/i.test(f)
        );
      } catch {
        // No media folder, check root folder for backwards compatibility
        const files = await fs.readdir(folderPath);
        mediaFiles = files.filter(f =>
          /\.(jpg|jpeg|png|gif|webp|wav|mp3|m4a|ogg)$/i.test(f)
        );
      }

      // Load media manifest if it exists
      let mediaManifest: Record<string, string> = {};
      try {
        const manifestPath = path.join(folderPath, 'media_manifest.json');
        const manifestData = await fs.readFile(manifestPath, 'utf-8');
        mediaManifest = JSON.parse(manifestData);
      } catch {
        // No manifest, will use filenames directly
      }

      res.json({
        ...conversation,
        folder,
        mediaFiles,
        mediaManifest,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Serve media file
  router.get('/:folder/media/:filename', async (req: Request, res: Response) => {
    try {
      const { folder, filename } = req.params;
      const archiveRoot = getArchiveRoot();

      // First try /media/ subfolder, then fall back to root folder
      let filePath = path.join(archiveRoot, folder, 'media', filename);
      if (!existsSync(filePath)) {
        filePath = path.join(archiveRoot, folder, filename);
      }

      // Security check - prevent path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(archiveRoot)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Check file exists
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Set content type based on extension
      const ext = path.extname(filename).toLowerCase();
      const contentTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
      };

      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);

      // Stream the file
      const stream = createReadStream(filePath);
      stream.pipe(res);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
