/**
 * Archives Router - Manage multiple archives
 *
 * Routes:
 * - GET /api/archives - List available archives
 * - GET /api/archives/current - Get current archive info
 * - POST /api/archives/switch - Switch to different archive
 * - POST /api/archives/create - Create new archive
 * - POST /api/index/rebuild - Rebuild conversation index
 * - GET /api/index/status - Get index status
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getConfig, setArchivePath, getArchiveRoot, PATHS } from '../config';

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION INDEX
// ═══════════════════════════════════════════════════════════════════

const INDEX_FILENAME = '_conversation_index.json';

interface ConversationIndexEntry {
  id: string;
  title: string;
  folder: string;
  message_count: number;
  text_length: number;
  has_media: boolean;
  has_images: boolean;
  has_audio: boolean;
  created_at?: number;
  updated_at?: number;
  indexed_at: number;
}

interface ConversationIndex {
  [folder: string]: ConversationIndexEntry;
}

/**
 * Build or update the conversation index for an archive
 */
export async function buildConversationIndex(
  archiveRoot: string,
  forceRebuild = false
): Promise<ConversationIndex> {
  const indexPath = path.join(archiveRoot, INDEX_FILENAME);
  let existingIndex: ConversationIndex = {};

  // Load existing index if not forcing rebuild
  if (!forceRebuild) {
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      existingIndex = JSON.parse(data);
      console.log(`[archives] Loaded existing index with ${Object.keys(existingIndex).length} entries`);
    } catch {
      console.log('[archives] No existing index, building fresh');
    }
  }

  const folders = await fs.readdir(archiveRoot);
  const updatedIndex: ConversationIndex = {};
  let newCount = 0;
  let updatedCount = 0;

  for (const folder of folders) {
    // Skip non-conversation folders
    if (folder.startsWith('_') || !/^\d{4}-\d{2}-\d{2}/.test(folder)) {
      continue;
    }

    const jsonPath = path.join(archiveRoot, folder, 'conversation.json');

    try {
      const stat = await fs.stat(jsonPath);
      const mtime = stat.mtime.getTime();

      // Check if we have a cached entry that's still valid
      if (existingIndex[folder] && existingIndex[folder].indexed_at >= mtime) {
        updatedIndex[folder] = existingIndex[folder];
        continue;
      }

      // Parse and index this conversation
      const data = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(data);

      let messageCount = 0;
      let totalTextLength = 0;
      let hasImages = false;
      let hasAudio = false;

      if (parsed.mapping) {
        for (const node of Object.values(parsed.mapping) as any[]) {
          if (node.message?.content?.parts) {
            const hasContent = node.message.content.parts.some((part: any) =>
              (typeof part === 'string' && part.trim().length > 0) ||
              (typeof part === 'object' && part !== null)
            );
            if (hasContent) {
              messageCount++;
              for (const part of node.message.content.parts) {
                if (typeof part === 'string') {
                  totalTextLength += part.length;
                } else if (part?.content_type === 'image_asset_pointer') {
                  hasImages = true;
                } else if (part?.content_type === 'audio_asset_pointer') {
                  hasAudio = true;
                }
              }
            }
          }
          // Check attachments
          if (node.message?.metadata?.attachments?.length > 0) {
            for (const att of node.message.metadata.attachments) {
              const filename = att.filename || att.name || '';
              if (/\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) hasImages = true;
              if (/\.(wav|mp3|m4a|ogg)$/i.test(filename)) hasAudio = true;
            }
          }
        }
      }

      // Check folder for media files
      try {
        const folderContents = await fs.readdir(path.join(archiveRoot, folder));
        for (const f of folderContents) {
          if (/\.(jpg|jpeg|png|gif|webp)$/i.test(f)) hasImages = true;
          if (/\.(wav|mp3|m4a|ogg)$/i.test(f)) hasAudio = true;
        }
      } catch {}

      updatedIndex[folder] = {
        id: parsed.id || folder,
        title: parsed.title || 'Untitled',
        folder: folder,
        message_count: messageCount,
        text_length: totalTextLength,
        has_media: hasImages || hasAudio,
        has_images: hasImages,
        has_audio: hasAudio,
        created_at: parsed.create_time,
        updated_at: parsed.update_time,
        indexed_at: Date.now(),
      };

      if (existingIndex[folder]) {
        updatedCount++;
      } else {
        newCount++;
      }
    } catch (err) {
      console.warn(`[archives] Skipping folder ${folder}: ${(err as Error).message}`);
    }
  }

  // Save the updated index
  await fs.writeFile(indexPath, JSON.stringify(updatedIndex, null, 2));
  console.log(`[archives] Index saved: ${Object.keys(updatedIndex).length} conversations (${newCount} new, ${updatedCount} updated)`);

  return updatedIndex;
}

/**
 * Get conversations from index (fast path)
 */
export async function getConversationsFromIndex(archiveRoot: string): Promise<ConversationIndexEntry[]> {
  const indexPath = path.join(archiveRoot, INDEX_FILENAME);

  try {
    const data = await fs.readFile(indexPath, 'utf-8');
    const index: ConversationIndex = JSON.parse(data);
    return Object.values(index);
  } catch {
    // Index doesn't exist, build it
    console.log('[archives] Index not found, building...');
    const index = await buildConversationIndex(archiveRoot);
    return Object.values(index);
  }
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════

export function createArchivesRouter(): Router {
  const router = Router();

  // List available archives
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();

      if (config.archiveConfig.isCustomPath) {
        // Custom mode - return single archive
        const stats = await getArchiveStats(config.archiveConfig.archivePath);
        res.json({
          current: config.archiveConfig.archiveName,
          archives: [{
            name: config.archiveConfig.archiveName,
            path: config.archiveConfig.archivePath,
            ...stats,
          }],
        });
        return;
      }

      // Standard mode - list all archives in base directory
      const entries = await fs.readdir(PATHS.DEFAULT_ARCHIVES_BASE, { withFileTypes: true });
      const archives = [];

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const archivePath = path.join(PATHS.DEFAULT_ARCHIVES_BASE, entry.name);
          const stats = await getArchiveStats(archivePath);
          archives.push({
            name: entry.name,
            path: archivePath,
            ...stats,
          });
        }
      }

      res.json({
        current: config.archiveConfig.archiveName,
        archives: archives.sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get current archive info
  router.get('/current', async (_req: Request, res: Response) => {
    try {
      const config = getConfig();
      const stats = await getArchiveStats(config.archiveConfig.archivePath);

      res.json({
        name: config.archiveConfig.archiveName,
        path: config.archiveConfig.archivePath,
        isCustomPath: config.archiveConfig.isCustomPath,
        ...stats,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Switch to different archive
  router.post('/switch', async (req: Request, res: Response) => {
    try {
      const { archive } = req.body;

      if (!archive) {
        res.status(400).json({ error: 'archive name required' });
        return;
      }

      await setArchivePath(archive);

      res.json({
        success: true,
        current: archive,
        path: getArchiveRoot(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Create new archive
  router.post('/create', async (req: Request, res: Response) => {
    try {
      const { name } = req.body;

      if (!name) {
        res.status(400).json({ error: 'archive name required' });
        return;
      }

      const config = getConfig();
      if (config.archiveConfig.isCustomPath) {
        res.status(400).json({ error: 'Cannot create archives in custom path mode' });
        return;
      }

      const archivePath = path.join(PATHS.DEFAULT_ARCHIVES_BASE, name);

      // Check if already exists
      try {
        await fs.access(archivePath);
        res.status(400).json({ error: 'Archive already exists' });
        return;
      } catch {
        // Good - doesn't exist
      }

      // Create the directory
      await fs.mkdir(archivePath, { recursive: true });

      res.json({
        success: true,
        name,
        path: archivePath,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Rebuild index
  router.post('/index/rebuild', async (_req: Request, res: Response) => {
    try {
      const archiveRoot = getArchiveRoot();
      console.log(`[archives] Rebuilding index for ${archiveRoot}...`);

      const index = await buildConversationIndex(archiveRoot, true);

      res.json({
        success: true,
        count: Object.keys(index).length,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get index status
  router.get('/index/status', async (_req: Request, res: Response) => {
    try {
      const archiveRoot = getArchiveRoot();
      const indexPath = path.join(archiveRoot, INDEX_FILENAME);

      try {
        const stat = await fs.stat(indexPath);
        const data = await fs.readFile(indexPath, 'utf-8');
        const index = JSON.parse(data);

        res.json({
          exists: true,
          count: Object.keys(index).length,
          lastModified: stat.mtime.toISOString(),
          size: stat.size,
        });
      } catch {
        res.json({
          exists: false,
          count: 0,
        });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function getArchiveStats(archivePath: string): Promise<{
  conversationCount: number;
  indexExists: boolean;
}> {
  try {
    const indexPath = path.join(archivePath, INDEX_FILENAME);
    const data = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(data);
    return {
      conversationCount: Object.keys(index).length,
      indexExists: true,
    };
  } catch {
    // Count folders manually
    try {
      const entries = await fs.readdir(archivePath);
      const conversationFolders = entries.filter(e => /^\d{4}-\d{2}-\d{2}/.test(e));
      return {
        conversationCount: conversationFolders.length,
        indexExists: false,
      };
    } catch {
      return {
        conversationCount: 0,
        indexExists: false,
      };
    }
  }
}
