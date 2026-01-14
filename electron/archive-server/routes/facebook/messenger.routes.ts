/**
 * Messenger Routes - Facebook Messenger threads and messages
 * Routes: /messenger/*
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../../services/registry';

export function createMessengerRouter(): Router {
  const router = Router();

  // GET /messenger/threads - List messenger threads
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

  // GET /messenger/thread/:threadId - Get messages in a thread
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

  // POST /messenger/import - Import all messenger threads from export
  router.post('/messenger/import', async (req: Request, res: Response) => {
    try {
      const { exportPath } = req.body;

      if (!exportPath) {
        return res.status(400).json({ error: 'exportPath is required' });
      }

      console.log('[facebook] Importing messenger from:', exportPath);

      // Import MessengerParser dynamically
      const { MessengerParser } = await import('../../services/facebook/MessengerParser.js');
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
