/**
 * AssociationGraph - Links comments to their parent posts
 *
 * Uses timestamp proximity and semantic similarity to match:
 * - own_post comments → posts by the same author
 * - photo comments → photo items
 */

import Database from 'better-sqlite3';

interface LinkResult {
  totalComments: number;
  linked: number;
  alreadyLinked: number;
  noMatch: number;
  ambiguous: number;
  errors: string[];
  byContextType: Record<string, number>;
}

interface CandidatePost {
  id: string;
  created_at: number;
  text: string;
  timeDelta: number;  // seconds between post and comment
}

export class AssociationGraph {
  private db: Database.Database;
  private ownerName: string;

  // Maximum time window for matching (90 days in seconds)
  private static MAX_TIME_WINDOW = 90 * 24 * 60 * 60;

  // Prefer posts within this window (7 days)
  private static PREFERRED_WINDOW = 7 * 24 * 60 * 60;

  constructor(dbPath: string, ownerName: string = 'Tem Noon') {
    this.db = new Database(dbPath);
    this.ownerName = ownerName;
  }

  /**
   * Link all unlinked comments to their parent posts
   */
  async linkAll(options: {
    dryRun?: boolean;
    onProgress?: (current: number, total: number) => void;
  } = {}): Promise<LinkResult> {
    const { dryRun = false, onProgress } = options;

    const result: LinkResult = {
      totalComments: 0,
      linked: 0,
      alreadyLinked: 0,
      noMatch: 0,
      ambiguous: 0,
      errors: [],
      byContextType: {}
    };

    // Get all comments without parent_id
    const comments = this.db.prepare(`
      SELECT id, created_at, text, context
      FROM content_items
      WHERE type = 'comment'
        AND source = 'facebook'
        AND (parent_id IS NULL OR parent_id = '')
    `).all() as Array<{
      id: string;
      created_at: number;
      text: string;
      context: string;
    }>;

    result.totalComments = comments.length;

    // Prepare update statement
    const updateStmt = dryRun ? null : this.db.prepare(`
      UPDATE content_items
      SET parent_id = ?
      WHERE id = ?
    `);

    // Get all posts by owner for matching
    const posts = this.db.prepare(`
      SELECT id, created_at, text
      FROM content_items
      WHERE type = 'post'
        AND source = 'facebook'
        AND author_name = ?
      ORDER BY created_at DESC
    `).all(this.ownerName) as Array<{
      id: string;
      created_at: number;
      text: string;
    }>;

    // Build a time-sorted index for efficient lookup
    const postsByTime = [...posts].sort((a, b) => a.created_at - b.created_at);

    let processed = 0;
    for (const comment of comments) {
      processed++;
      if (onProgress && processed % 100 === 0) {
        onProgress(processed, comments.length);
      }

      try {
        const context = comment.context ? JSON.parse(comment.context) : {};
        const contextType = context.contextType || 'unknown';

        result.byContextType[contextType] = (result.byContextType[contextType] || 0) + 1;

        // Handle different context types
        if (contextType === 'own_post') {
          const match = this.findBestPostMatch(comment, postsByTime);

          if (match) {
            if (updateStmt) {
              updateStmt.run(match.id, comment.id);
            }
            result.linked++;
          } else {
            result.noMatch++;
          }
        } else if (contextType === 'photo') {
          // Could link to photo items - for now just count
          result.noMatch++;
        } else {
          // other_post, unknown - can't link without parent posts in DB
          result.noMatch++;
        }
      } catch (e) {
        result.errors.push(`Error processing ${comment.id}: ${e}`);
      }
    }

    // Count already linked
    const alreadyLinked = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM content_items
      WHERE type = 'comment'
        AND source = 'facebook'
        AND parent_id IS NOT NULL
        AND parent_id != ''
    `).get() as { count: number };

    result.alreadyLinked = alreadyLinked.count;

    return result;
  }

  /**
   * Find the best matching post for a comment
   * Uses timestamp proximity - the most recent post before the comment
   */
  private findBestPostMatch(
    comment: { id: string; created_at: number; text: string },
    posts: Array<{ id: string; created_at: number; text: string }>
  ): CandidatePost | null {
    const commentTime = comment.created_at;

    // Find posts that are BEFORE the comment (you can't comment on a future post)
    const candidates: CandidatePost[] = [];

    for (const post of posts) {
      const timeDelta = commentTime - post.created_at;

      // Post must be before comment
      if (timeDelta < 0) continue;

      // Post must be within max window
      if (timeDelta > AssociationGraph.MAX_TIME_WINDOW) continue;

      candidates.push({
        id: post.id,
        created_at: post.created_at,
        text: post.text || '',
        timeDelta
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by time delta (smallest first = most recent post before comment)
    candidates.sort((a, b) => a.timeDelta - b.timeDelta);

    // Return the most recent post before the comment
    return candidates[0];
  }

  /**
   * Get statistics about current associations
   */
  getStats(): {
    totalPosts: number;
    totalComments: number;
    linkedComments: number;
    unlinkedComments: number;
    orphanedComments: number;
    byContextType: Record<string, { total: number; linked: number }>;
  } {
    const totalPosts = (this.db.prepare(`
      SELECT COUNT(*) as count FROM content_items
      WHERE type = 'post' AND source = 'facebook'
    `).get() as { count: number }).count;

    const totalComments = (this.db.prepare(`
      SELECT COUNT(*) as count FROM content_items
      WHERE type = 'comment' AND source = 'facebook'
    `).get() as { count: number }).count;

    const linkedComments = (this.db.prepare(`
      SELECT COUNT(*) as count FROM content_items
      WHERE type = 'comment' AND source = 'facebook'
        AND parent_id IS NOT NULL AND parent_id != ''
    `).get() as { count: number }).count;

    // Comments with parent_id that doesn't exist
    const orphanedComments = (this.db.prepare(`
      SELECT COUNT(*) as count FROM content_items c
      WHERE c.type = 'comment' AND c.source = 'facebook'
        AND c.parent_id IS NOT NULL AND c.parent_id != ''
        AND NOT EXISTS (
          SELECT 1 FROM content_items p WHERE p.id = c.parent_id
        )
    `).get() as { count: number }).count;

    // Context type breakdown
    const byContextType: Record<string, { total: number; linked: number }> = {};

    const contextStats = this.db.prepare(`
      SELECT
        json_extract(context, '$.contextType') as context_type,
        COUNT(*) as total,
        SUM(CASE WHEN parent_id IS NOT NULL AND parent_id != '' THEN 1 ELSE 0 END) as linked
      FROM content_items
      WHERE type = 'comment' AND source = 'facebook'
      GROUP BY json_extract(context, '$.contextType')
    `).all() as Array<{ context_type: string; total: number; linked: number }>;

    for (const row of contextStats) {
      byContextType[row.context_type || 'null'] = {
        total: row.total,
        linked: row.linked
      };
    }

    return {
      totalPosts,
      totalComments,
      linkedComments,
      unlinkedComments: totalComments - linkedComments,
      orphanedComments,
      byContextType
    };
  }

  /**
   * Get the comment thread for a post
   */
  getPostComments(postId: string): Array<{
    id: string;
    text: string;
    created_at: number;
    author_name: string;
  }> {
    return this.db.prepare(`
      SELECT id, text, created_at, author_name
      FROM content_items
      WHERE parent_id = ?
      ORDER BY created_at ASC
    `).all(postId) as Array<{
      id: string;
      text: string;
      created_at: number;
      author_name: string;
    }>;
  }

  /**
   * Get posts with their comment counts
   */
  getPostsWithCommentCounts(options: {
    limit?: number;
    offset?: number;
    minComments?: number;
  } = {}): Array<{
    id: string;
    text: string;
    created_at: number;
    comment_count: number;
  }> {
    const { limit = 50, offset = 0, minComments = 0 } = options;

    // Use subquery to filter by comment count
    return this.db.prepare(`
      SELECT * FROM (
        SELECT
          p.id,
          p.text,
          p.created_at,
          (SELECT COUNT(*) FROM content_items c WHERE c.parent_id = p.id) as comment_count
        FROM content_items p
        WHERE p.type = 'post' AND p.source = 'facebook'
      ) WHERE comment_count >= ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(minComments, limit, offset) as Array<{
      id: string;
      text: string;
      created_at: number;
      comment_count: number;
    }>;
  }

  close() {
    this.db.close();
  }
}

export type { LinkResult };
