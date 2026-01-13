/**
 * GroupsParser - Parse Facebook Groups data from export JSON
 *
 * Parses:
 * - groups/group_posts_and_comments.json - Your posts in groups
 * - groups/your_comments_in_groups.json - Your comments on group posts
 * - groups/your_group_membership_activity.json - Group join history
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ParsedGroupPost {
  id: string;
  groupName: string;
  text: string;
  timestamp: number;
  externalUrls: string[];
  hasAttachments: boolean;
  title: string;  // Original "Tem Noon posted in GROUP_NAME." title
}

export interface ParsedGroupComment {
  id: string;
  groupName: string;
  text: string;
  timestamp: number;
  author: string;
  originalPostAuthor: string;  // Extracted from title "commented on X's post"
  title: string;
}

export interface ParsedGroupMembership {
  id: string;
  groupName: string;
  joinedAt: number;
}

export interface ParsedGroup {
  id: string;
  name: string;
  joinedAt: number | null;
  postCount: number;
  commentCount: number;
  lastActivity: number;
}

export interface GroupsParseResult {
  groups: ParsedGroup[];
  posts: ParsedGroupPost[];
  comments: ParsedGroupComment[];
  memberships: ParsedGroupMembership[];
  stats: {
    totalGroups: number;
    totalPosts: number;
    totalComments: number;
    totalMemberships: number;
    groupsWithMostPosts: Array<{ name: string; count: number }>;
    groupsWithMostComments: Array<{ name: string; count: number }>;
    dateRange: { earliest: number; latest: number };
  };
}

// ═══════════════════════════════════════════════════════════════════
// RAW JSON TYPES (from Facebook export)
// ═══════════════════════════════════════════════════════════════════

interface RawGroupPost {
  timestamp: number;
  data: Array<{ post?: string }>;
  title: string;
  attachments?: Array<{
    data: Array<{
      external_context?: { url: string };
      media?: { uri: string };
    }>;
  }>;
}

interface RawGroupComment {
  timestamp: number;
  data: Array<{
    comment?: {
      timestamp: number;
      comment: string;
      author: string;
      group: string;
    };
  }>;
  title: string;
}

interface RawGroupMembership {
  timestamp: number;
  data: Array<{ name: string }>;
  title: string;
}

// ═══════════════════════════════════════════════════════════════════
// PARSER CLASS
// ═══════════════════════════════════════════════════════════════════

export class GroupsParser {
  private groupsBasePath: string = '';

  /**
   * Parse all groups data from the Facebook export
   */
  async parse(exportPath: string): Promise<GroupsParseResult> {
    this.groupsBasePath = path.join(exportPath, 'your_facebook_activity', 'groups');

    console.log(`📁 Parsing groups from: ${this.groupsBasePath}`);

    // Parse all three data sources
    const posts = await this.parsePosts();
    const comments = await this.parseComments();
    const memberships = await this.parseMemberships();

    // Build aggregated group data
    const groupMap = new Map<string, ParsedGroup>();

    // Add groups from memberships (these have join dates)
    for (const membership of memberships) {
      const id = this.generateGroupId(membership.groupName);
      if (!groupMap.has(id)) {
        groupMap.set(id, {
          id,
          name: membership.groupName,
          joinedAt: membership.joinedAt,
          postCount: 0,
          commentCount: 0,
          lastActivity: membership.joinedAt,
        });
      }
    }

    // Add groups from posts (may not be in memberships if left)
    for (const post of posts) {
      const id = this.generateGroupId(post.groupName);
      if (!groupMap.has(id)) {
        groupMap.set(id, {
          id,
          name: post.groupName,
          joinedAt: null,
          postCount: 0,
          commentCount: 0,
          lastActivity: post.timestamp,
        });
      }
      const group = groupMap.get(id)!;
      group.postCount++;
      group.lastActivity = Math.max(group.lastActivity, post.timestamp);
    }

    // Add groups from comments
    for (const comment of comments) {
      const id = this.generateGroupId(comment.groupName);
      if (!groupMap.has(id)) {
        groupMap.set(id, {
          id,
          name: comment.groupName,
          joinedAt: null,
          postCount: 0,
          commentCount: 0,
          lastActivity: comment.timestamp,
        });
      }
      const group = groupMap.get(id)!;
      group.commentCount++;
      group.lastActivity = Math.max(group.lastActivity, comment.timestamp);
    }

    const groups = Array.from(groupMap.values()).sort((a, b) =>
      (b.postCount + b.commentCount) - (a.postCount + a.commentCount)
    );

    // Calculate stats
    const allTimestamps = [
      ...posts.map(p => p.timestamp),
      ...comments.map(c => c.timestamp),
      ...memberships.map(m => m.joinedAt),
    ].filter(t => t > 1000);

    const postsByGroup = new Map<string, number>();
    for (const post of posts) {
      postsByGroup.set(post.groupName, (postsByGroup.get(post.groupName) || 0) + 1);
    }

    const commentsByGroup = new Map<string, number>();
    for (const comment of comments) {
      commentsByGroup.set(comment.groupName, (commentsByGroup.get(comment.groupName) || 0) + 1);
    }

    const stats = {
      totalGroups: groups.length,
      totalPosts: posts.length,
      totalComments: comments.length,
      totalMemberships: memberships.length,
      groupsWithMostPosts: Array.from(postsByGroup.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
      groupsWithMostComments: Array.from(commentsByGroup.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
      dateRange: {
        earliest: allTimestamps.length > 0 ? Math.min(...allTimestamps) : 0,
        latest: allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0,
      },
    };

    console.log(`\n✅ Groups parsing complete:`);
    console.log(`   Total groups: ${stats.totalGroups}`);
    console.log(`   Total posts: ${stats.totalPosts}`);
    console.log(`   Total comments: ${stats.totalComments}`);
    console.log(`   Group memberships: ${stats.totalMemberships}`);
    if (stats.groupsWithMostPosts.length > 0) {
      console.log(`   Most active group (posts): "${stats.groupsWithMostPosts[0].name}" (${stats.groupsWithMostPosts[0].count} posts)`);
    }
    if (stats.dateRange.earliest > 0) {
      console.log(`   Date range: ${new Date(stats.dateRange.earliest * 1000).toISOString().split('T')[0]} to ${new Date(stats.dateRange.latest * 1000).toISOString().split('T')[0]}`);
    }

    return { groups, posts, comments, memberships, stats };
  }

  /**
   * Parse posts in groups
   */
  private async parsePosts(): Promise<ParsedGroupPost[]> {
    const postsFile = path.join(this.groupsBasePath, 'group_posts_and_comments.json');

    try {
      const rawData = await fs.readFile(postsFile, 'utf-8');
      const data = JSON.parse(rawData);
      const rawPosts: RawGroupPost[] = data.group_posts_v2 || [];

      console.log(`   Found ${rawPosts.length} group posts`);

      const posts: ParsedGroupPost[] = [];

      for (const raw of rawPosts) {
        const text = this.decodeFacebookUnicode(raw.data?.[0]?.post || '');
        const groupName = this.extractGroupNameFromTitle(raw.title, 'posted in');

        // Extract URLs from attachments
        const externalUrls: string[] = [];
        if (raw.attachments) {
          for (const attachment of raw.attachments) {
            for (const item of attachment.data || []) {
              if (item.external_context?.url) {
                externalUrls.push(item.external_context.url);
              }
            }
          }
        }

        posts.push({
          id: this.generatePostId(groupName, raw.timestamp, text),
          groupName,
          text,
          timestamp: raw.timestamp,
          externalUrls,
          hasAttachments: externalUrls.length > 0 || (raw.attachments?.length || 0) > 0,
          title: this.decodeFacebookUnicode(raw.title),
        });
      }

      return posts;
    } catch (err) {
      console.log(`   No group posts file found or error parsing`);
      return [];
    }
  }

  /**
   * Parse comments in groups
   */
  private async parseComments(): Promise<ParsedGroupComment[]> {
    const commentsFile = path.join(this.groupsBasePath, 'your_comments_in_groups.json');

    try {
      const rawData = await fs.readFile(commentsFile, 'utf-8');
      const data = JSON.parse(rawData);
      const rawComments: RawGroupComment[] = data.group_comments_v2 || [];

      console.log(`   Found ${rawComments.length} group comments`);

      const comments: ParsedGroupComment[] = [];

      for (const raw of rawComments) {
        const commentData = raw.data?.[0]?.comment;
        if (!commentData) continue;

        const text = this.decodeFacebookUnicode(commentData.comment || '');
        const groupName = this.decodeFacebookUnicode(commentData.group || '');
        const author = this.decodeFacebookUnicode(commentData.author || '');
        const originalPostAuthor = this.extractOriginalAuthor(raw.title);

        comments.push({
          id: this.generateCommentId(groupName, raw.timestamp, text),
          groupName,
          text,
          timestamp: commentData.timestamp || raw.timestamp,
          author,
          originalPostAuthor,
          title: this.decodeFacebookUnicode(raw.title),
        });
      }

      return comments;
    } catch (err) {
      console.log(`   No group comments file found or error parsing`);
      return [];
    }
  }

  /**
   * Parse group membership history
   */
  private async parseMemberships(): Promise<ParsedGroupMembership[]> {
    const membershipFile = path.join(this.groupsBasePath, 'your_group_membership_activity.json');

    try {
      const rawData = await fs.readFile(membershipFile, 'utf-8');
      const data = JSON.parse(rawData);
      const rawMemberships: RawGroupMembership[] = data.groups_joined_v2 || [];

      console.log(`   Found ${rawMemberships.length} group memberships`);

      const memberships: ParsedGroupMembership[] = [];

      for (const raw of rawMemberships) {
        const groupName = this.decodeFacebookUnicode(raw.data?.[0]?.name || '');
        if (!groupName) continue;

        memberships.push({
          id: this.generateGroupId(groupName),
          groupName,
          joinedAt: raw.timestamp,
        });
      }

      return memberships;
    } catch (err) {
      console.log(`   No group membership file found or error parsing`);
      return [];
    }
  }

  /**
   * Extract group name from title like "Tem Noon posted in GROUP_NAME."
   */
  private extractGroupNameFromTitle(title: string, action: string): string {
    const decoded = this.decodeFacebookUnicode(title);
    const pattern = new RegExp(`${action}\\s+(.+?)\\s*\\.?$`, 'i');
    const match = decoded.match(pattern);
    return match ? match[1].trim().replace(/\.$/, '') : decoded;
  }

  /**
   * Extract original post author from "commented on X's post"
   */
  private extractOriginalAuthor(title: string): string {
    const decoded = this.decodeFacebookUnicode(title);
    // "Tem Noon commented on Bryan Schmidt's post."
    // "Tem Noon commented on his own post."
    const match = decoded.match(/commented on (.+?)['']s post/i);
    if (match) {
      return match[1] === 'his own' || match[1] === 'her own' ? 'self' : match[1];
    }
    return '';
  }

  /**
   * Generate stable ID for a group
   */
  private generateGroupId(groupName: string): string {
    const slug = groupName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 40);
    return `fb_group_${slug}`;
  }

  /**
   * Generate stable ID for a post
   */
  private generatePostId(groupName: string, timestamp: number, text: string): string {
    const hash = crypto.createHash('md5')
      .update(`${groupName}:${timestamp}:${text.substring(0, 100)}`)
      .digest('hex')
      .substring(0, 8);
    return `fb_gpost_${timestamp}_${hash}`;
  }

  /**
   * Generate stable ID for a comment
   */
  private generateCommentId(groupName: string, timestamp: number, text: string): string {
    const hash = crypto.createHash('md5')
      .update(`${groupName}:${timestamp}:${text.substring(0, 100)}`)
      .digest('hex')
      .substring(0, 8);
    return `fb_gcmt_${timestamp}_${hash}`;
  }

  /**
   * Decode Facebook's non-standard Unicode encoding
   */
  private decodeFacebookUnicode(text: string): string {
    if (!text) return '';

    try {
      const parsed = JSON.parse(`"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);
      const bytes = new Uint8Array([...parsed].map(c => c.charCodeAt(0)));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return text
        .replace(/\\u00([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/Â\u00a0/g, ' ')
        .replace(/Â /g, ' ')
        .replace(/\u00c2\u00a0/g, ' ');
    }
  }

  /**
   * Check if groups data exists
   */
  async exists(exportPath: string): Promise<boolean> {
    const groupsPath = path.join(exportPath, 'your_facebook_activity', 'groups');
    const postsFile = path.join(groupsPath, 'group_posts_and_comments.json');
    const commentsFile = path.join(groupsPath, 'your_comments_in_groups.json');

    try {
      await fs.access(postsFile);
      return true;
    } catch {
      try {
        await fs.access(commentsFile);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get quick stats without full parsing
   */
  async getQuickStats(exportPath: string): Promise<{
    postsCount: number;
    commentsCount: number;
    membershipsCount: number;
    hasData: boolean;
  }> {
    const groupsPath = path.join(exportPath, 'your_facebook_activity', 'groups');

    let postsCount = 0;
    let commentsCount = 0;
    let membershipsCount = 0;

    try {
      const postsData = await fs.readFile(path.join(groupsPath, 'group_posts_and_comments.json'), 'utf-8');
      postsCount = (JSON.parse(postsData).group_posts_v2 || []).length;
    } catch { /* ignore */ }

    try {
      const commentsData = await fs.readFile(path.join(groupsPath, 'your_comments_in_groups.json'), 'utf-8');
      commentsCount = (JSON.parse(commentsData).group_comments_v2 || []).length;
    } catch { /* ignore */ }

    try {
      const membershipData = await fs.readFile(path.join(groupsPath, 'your_group_membership_activity.json'), 'utf-8');
      membershipsCount = (JSON.parse(membershipData).groups_joined_v2 || []).length;
    } catch { /* ignore */ }

    return {
      postsCount,
      commentsCount,
      membershipsCount,
      hasData: postsCount > 0 || commentsCount > 0,
    };
  }
}
