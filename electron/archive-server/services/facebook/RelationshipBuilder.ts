/**
 * RelationshipBuilder - Extracts relationships from Facebook export
 *
 * Builds edges in fb_relationships from:
 * - Tags in posts/photos → tagged_in
 * - Comments → commented_on
 * - Reactions → reacted_to
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  FbRelationship,
  FbPerson,
  FacebookPost,
  FacebookComment,
  FacebookReaction,
} from './types.js';

// Patterns to extract person names from Facebook titles
const COMMENT_PATTERNS = [
  /^(.+?) commented on (.+?)'s (post|photo|video|comment|link|album|story)\.?$/i,
  /^(.+?) commented on (.+?)'s (.+?)\.?$/i,
  /^(.+?) replied to (.+?)'s comment\.?$/i,
  /^(.+?) replied to a comment by (.+?)\.?$/i,
];

const REACTION_PATTERNS = [
  /^(.+?) liked (.+?)'s (post|photo|video|comment|link|album|story|reel)\.?$/i,
  /^(.+?) reacted to (.+?)'s (post|photo|video|comment|link|album|story|reel)\.?$/i,
  /^(.+?) liked a (post|photo|video|comment|link|album|story|reel) by (.+?)\.?$/i,
  /^(.+?) reacted to a (post|photo|video|comment|link|album|story|reel) by (.+?)\.?$/i,
];

export interface RelationshipBuilderResult {
  relationships: FbRelationship[];
  discoveredPeople: FbPerson[];
  stats: {
    tagsProcessed: number;
    commentsProcessed: number;
    reactionsProcessed: number;
    relationshipsCreated: number;
    peopleDiscovered: number;
  };
}

export interface RelationshipBuilderOptions {
  selfName?: string; // Name of the user (to exclude self-references)
}

export class RelationshipBuilder {
  private exportPath: string;
  private now: number;
  private selfName: string;
  private knownPeople: Map<string, FbPerson>;
  private discoveredPeople: Map<string, FbPerson>;
  private relationships: Map<string, FbRelationship>;

  constructor(exportPath: string, knownPeople: FbPerson[], options?: RelationshipBuilderOptions) {
    this.exportPath = exportPath;
    this.now = Date.now() / 1000;
    this.selfName = options?.selfName?.toLowerCase() || 'tem noon';
    this.knownPeople = new Map(knownPeople.map(p => [p.name.toLowerCase(), p]));
    this.discoveredPeople = new Map();
    this.relationships = new Map();
  }

  /**
   * Build all relationships from the Facebook export
   */
  async buildAll(): Promise<RelationshipBuilderResult> {
    console.log('🔗 Building relationships...');

    const stats = {
      tagsProcessed: 0,
      commentsProcessed: 0,
      reactionsProcessed: 0,
      relationshipsCreated: 0,
      peopleDiscovered: 0,
    };

    // Process tags from posts
    const tagStats = await this.processPostTags();
    stats.tagsProcessed = tagStats;

    // Process comments
    const commentStats = await this.processComments();
    stats.commentsProcessed = commentStats;

    // Process reactions
    const reactionStats = await this.processReactions();
    stats.reactionsProcessed = reactionStats;

    stats.relationshipsCreated = this.relationships.size;
    stats.peopleDiscovered = this.discoveredPeople.size;

    console.log(`✅ Relationship building complete:`);
    console.log(`   Tags processed: ${stats.tagsProcessed}`);
    console.log(`   Comments processed: ${stats.commentsProcessed}`);
    console.log(`   Reactions processed: ${stats.reactionsProcessed}`);
    console.log(`   Relationships created: ${stats.relationshipsCreated}`);
    console.log(`   People discovered: ${stats.peopleDiscovered}`);

    return {
      relationships: Array.from(this.relationships.values()),
      discoveredPeople: Array.from(this.discoveredPeople.values()),
      stats,
    };
  }

  /**
   * Process tags from posts to create tagged_in relationships
   */
  private async processPostTags(): Promise<number> {
    let count = 0;
    const postsDir = path.join(this.exportPath, 'your_facebook_activity/posts');

    // Process main posts files
    const postsFiles = [
      'your_posts__check_ins__photos_and_videos_1.json',
      'your_posts__check_ins__photos_and_videos_2.json',
    ];

    for (const file of postsFiles) {
      const filePath = path.join(postsDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const posts: FacebookPost[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          for (const post of posts) {
            if (post.tags && post.tags.length > 0) {
              for (const tag of post.tags) {
                const personId = this.getOrCreatePerson(tag.name);
                if (personId) {
                  this.addRelationship({
                    source_type: 'person',
                    source_id: personId,
                    target_type: 'content',
                    target_id: this.generatePostId(post),
                    relationship_type: 'tagged_in',
                    timestamp: post.timestamp,
                    weight: 1,
                  });
                  count++;
                }
              }
            }
          }
        } catch (err) {
          console.error(`Error processing tags from ${file}:`, err);
        }
      }
    }

    // Process album photos for tags
    const albumDir = path.join(postsDir, 'album');
    if (fs.existsSync(albumDir)) {
      try {
        const albumFiles = fs.readdirSync(albumDir).filter(f => f.endsWith('.json'));
        for (const file of albumFiles) {
          const albumPath = path.join(albumDir, file);
          const album = JSON.parse(fs.readFileSync(albumPath, 'utf-8'));
          // Album photos don't typically have tags in the export, but check anyway
          if (album.tags) {
            for (const tag of album.tags) {
              const personId = this.getOrCreatePerson(tag.name);
              if (personId) {
                this.addRelationship({
                  source_type: 'person',
                  source_id: personId,
                  target_type: 'content',
                  target_id: `fb_album_${file.replace('.json', '')}`,
                  relationship_type: 'tagged_in',
                  timestamp: album.last_modified_timestamp,
                  weight: 1,
                });
                count++;
              }
            }
          }
        }
      } catch (err) {
        console.error('Error processing album tags:', err);
      }
    }

    console.log(`   Processed ${count} tags from posts`);
    return count;
  }

  /**
   * Process comments to extract person relationships
   */
  private async processComments(): Promise<number> {
    let count = 0;
    const commentsPath = path.join(
      this.exportPath,
      'your_facebook_activity/comments_and_reactions/comments.json'
    );

    if (fs.existsSync(commentsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
        const comments: FacebookComment[] = data.comments_v2 || [];

        for (const comment of comments) {
          if (!comment.title) continue;

          // Extract the target person from the title
          const personName = this.extractPersonFromTitle(comment.title, COMMENT_PATTERNS);
          if (personName) {
            const personId = this.getOrCreatePerson(personName);
            if (personId) {
              this.addRelationship({
                source_type: 'person',
                source_id: this.getSelfId(),
                target_type: 'person',
                target_id: personId,
                relationship_type: 'commented_on',
                timestamp: comment.timestamp,
                weight: 1,
              });
              count++;
            }
          }
        }
        console.log(`   Processed ${count} comments → person edges`);
      } catch (err) {
        console.error('Error processing comments:', err);
      }
    }

    return count;
  }

  /**
   * Process reactions to extract person relationships
   */
  private async processReactions(): Promise<number> {
    let count = 0;
    const reactionsDir = path.join(this.exportPath, 'your_facebook_activity/comments_and_reactions');

    if (!fs.existsSync(reactionsDir)) {
      return 0;
    }

    try {
      const reactionFiles = fs.readdirSync(reactionsDir)
        .filter(f => f.startsWith('likes_and_reactions') && f.endsWith('.json'));

      for (const file of reactionFiles) {
        const filePath = path.join(reactionsDir, file);
        try {
          const reactions: FacebookReaction[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          for (const reaction of reactions) {
            if (!reaction.title) continue;

            // Extract the target person from the title
            const personName = this.extractPersonFromTitle(reaction.title, REACTION_PATTERNS);
            if (personName) {
              const personId = this.getOrCreatePerson(personName);
              if (personId) {
                // Determine reaction type
                const reactionType = this.extractReactionType(reaction);

                this.addRelationship({
                  source_type: 'person',
                  source_id: this.getSelfId(),
                  target_type: 'person',
                  target_id: personId,
                  relationship_type: `reacted_${reactionType}`,
                  timestamp: reaction.timestamp,
                  weight: this.getReactionWeight(reactionType),
                });
                count++;
              }
            }
          }
        } catch (err) {
          console.error(`Error processing ${file}:`, err);
        }
      }
      console.log(`   Processed ${count} reactions → person edges`);
    } catch (err) {
      console.error('Error processing reactions:', err);
    }

    return count;
  }

  /**
   * Extract person name from a Facebook title using patterns
   */
  private extractPersonFromTitle(title: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        // The person name is usually in group 2 or 3 depending on pattern
        const possibleNames = match.slice(1);
        for (const name of possibleNames) {
          // Skip if it's the self name or a content type
          if (name && !this.isSelf(name) && !this.isContentType(name)) {
            return this.decodeUtf8(name);
          }
        }
      }
    }
    return null;
  }

  /**
   * Check if a name is the user themselves
   */
  private isSelf(name: string): boolean {
    const normalized = name.toLowerCase().trim();
    return (
      normalized === this.selfName ||
      normalized === 'his own' ||
      normalized === 'her own' ||
      normalized === 'their own' ||
      normalized === 'your' ||
      normalized === 'a'
    );
  }

  /**
   * Check if a string is a content type rather than a person name
   */
  private isContentType(name: string): boolean {
    const contentTypes = new Set([
      'post', 'photo', 'video', 'comment', 'link', 'album', 'story', 'reel',
      'status', 'update', 'note', 'event', 'page', 'group', 'memory',
    ]);
    return contentTypes.has(name.toLowerCase().trim());
  }

  /**
   * Get or create a person, tracking discovered people
   */
  private getOrCreatePerson(name: string): string | null {
    if (!name || this.isSelf(name)) {
      return null;
    }

    const normalized = name.toLowerCase().trim();

    // Check if already known
    const known = this.knownPeople.get(normalized);
    if (known) {
      return known.id;
    }

    // Check if already discovered this session
    const discovered = this.discoveredPeople.get(normalized);
    if (discovered) {
      discovered.interaction_count++;
      return discovered.id;
    }

    // Create new discovered person
    const id = this.generatePersonId(name);
    const person: FbPerson = {
      id,
      name: this.decodeUtf8(name),
      is_friend: false,
      is_follower: false,
      is_following: false,
      interaction_count: 1,
      tag_count: 0,
      created_at: this.now,
    };

    this.discoveredPeople.set(normalized, person);
    return id;
  }

  /**
   * Get the self person ID
   */
  private getSelfId(): string {
    return this.generatePersonId(this.selfName);
  }

  /**
   * Add a relationship, updating weight if duplicate
   */
  private addRelationship(rel: Omit<FbRelationship, 'id' | 'created_at'>): void {
    const key = `${rel.source_type}_${rel.source_id}_${rel.target_type}_${rel.target_id}_${rel.relationship_type}`;
    const existing = this.relationships.get(key);

    if (existing) {
      existing.weight += rel.weight;
      // Update timestamp to most recent
      if (rel.timestamp && (!existing.timestamp || rel.timestamp > existing.timestamp)) {
        existing.timestamp = rel.timestamp;
      }
    } else {
      const id = this.generateRelationshipId(key);
      this.relationships.set(key, {
        id,
        ...rel,
        created_at: this.now,
      });
    }
  }

  /**
   * Extract reaction type from reaction data
   */
  private extractReactionType(reaction: FacebookReaction): string {
    if (reaction.data && reaction.data[0]?.reaction?.reaction) {
      return reaction.data[0].reaction.reaction.toLowerCase();
    }
    // Infer from title
    const title = reaction.title?.toLowerCase() || '';
    if (title.includes('liked')) return 'like';
    if (title.includes('loved') || title.includes('love')) return 'love';
    if (title.includes('haha')) return 'haha';
    if (title.includes('wow')) return 'wow';
    if (title.includes('sad') || title.includes('sorry')) return 'sad';
    if (title.includes('angry')) return 'angry';
    return 'like'; // Default
  }

  /**
   * Get weight for a reaction type (emotional reactions weighted higher)
   */
  private getReactionWeight(reactionType: string): number {
    switch (reactionType.toLowerCase()) {
      case 'love':
        return 3;
      case 'wow':
      case 'haha':
        return 2;
      case 'sad':
      case 'sorry':
      case 'angry':
        return 2;
      case 'like':
      default:
        return 1;
    }
  }

  // ============================================================
  // ID generation helpers
  // ============================================================

  private generatePersonId(name: string): string {
    const hash = createHash('md5').update(name.toLowerCase()).digest('hex').slice(0, 12);
    return `fb_person_${hash}`;
  }

  private generatePostId(post: FacebookPost): string {
    const content = `${post.timestamp}_${post.title || ''}_${post.data?.[0]?.post || ''}`;
    const hash = createHash('md5').update(content).digest('hex').slice(0, 12);
    return `fb_post_${hash}`;
  }

  private generateRelationshipId(key: string): string {
    const hash = createHash('md5').update(key).digest('hex').slice(0, 12);
    return `fb_rel_${hash}`;
  }

  private decodeUtf8(str: string): string {
    try {
      return decodeURIComponent(escape(str));
    } catch {
      return str;
    }
  }
}
