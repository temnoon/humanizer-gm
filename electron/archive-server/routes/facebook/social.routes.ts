/**
 * Social Routes - Social graph and friends
 * Routes: /graph/*, /friends/*
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import { getEmbeddingDatabase } from '../../services/registry';
import { getArchiveRoot } from '../../config';

export function createSocialRouter(): Router {
  const router = Router();

  // ===========================================================================
  // Graph Routes
  // ===========================================================================

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
      const { FacebookFullParser } = await import('../../services/facebook/FacebookFullParser.js');
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

  // ===========================================================================
  // Friends Routes
  // ===========================================================================

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
      const { FriendsParser } = await import('../../services/facebook/FriendsParser.js');
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
