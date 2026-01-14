/**
 * Meta Routes - Advertisers, pages, and reactions
 * Routes: /advertisers/*, /pages/*, /reactions/*
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import { getEmbeddingDatabase } from '../../services/registry';

export function createMetaRouter(): Router {
  const router = Router();

  // ===========================================================================
  // Advertisers Routes
  // ===========================================================================

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

      const { AdvertisersAndPagesParser } = await import('../../services/facebook/AdvertisersAndPagesParser.js');
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

  // ===========================================================================
  // Pages Routes
  // ===========================================================================

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

      const { AdvertisersAndPagesParser } = await import('../../services/facebook/AdvertisersAndPagesParser.js');
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

  // ===========================================================================
  // Reactions Routes (Outbound reactions - user's reactions to others' content)
  // ===========================================================================

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

      const { ReactionsParser } = await import('../../services/facebook/ReactionsParser.js');
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

  return router;
}
