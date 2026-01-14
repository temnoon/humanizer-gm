/**
 * Groups Routes - Facebook group activity
 * Routes: /groups/*
 */

import { Router, Request, Response } from 'express';
import { getEmbeddingDatabase } from '../../services/registry';

export function createGroupsRouter(): Router {
  const router = Router();

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
      const { GroupsParser } = await import('../../services/facebook/GroupsParser.js');
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

  return router;
}
