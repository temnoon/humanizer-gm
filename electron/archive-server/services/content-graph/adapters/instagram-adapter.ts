/**
 * Instagram Adapter - Parses Instagram data exports into ContentNodes
 *
 * Handles the Instagram GDPR data export format (JSON files) and converts
 * posts, comments, and messages into universal ContentNode format.
 *
 * Key files parsed:
 * - your_instagram_activity/media/posts_1.json: User's posts
 * - your_instagram_activity/comments/post_comments_N.json: User's comments
 * - your_instagram_activity/messages/inbox/{user}/message_N.json: DM conversations
 * - your_instagram_activity/messages/message_requests/{user}/message_N.json: Message requests
 *
 * MEDIA HANDLING:
 * This adapter follows the UCG Media Best Practice:
 * 1. Media files are indexed via MediaImportService (hashed, stored in media_items)
 * 2. Content is rewritten to use standard markdown: ![image](/api/ucg/media/by-hash/{hash})
 * 3. Original platform paths stored in sourceMetadata.originalMediaRefs
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ContentNode,
  ContentLink,
  ContentFormat,
  ContentAdapter,
  AdapterOptions,
  DetectionResult,
} from '@humanizer/core';
import { MediaImportService, type MediaIndexResult } from '../MediaImportService.js';

/**
 * Instagram text is often encoded with UTF-8 bytes misread as Latin-1
 * This fixes common mojibake patterns
 */
function fixInstagramEncoding(text: string): string {
  if (!text) return '';
  try {
    // Instagram exports UTF-8 as Latin-1 encoded bytes
    // Decode by converting each char code to bytes and re-interpreting as UTF-8
    const bytes = new Uint8Array(text.split('').map(c => c.charCodeAt(0)));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return text;
  }
}

/**
 * Sanitize text by removing null bytes and problematic characters
 */
function sanitizeText(text: string): string {
  if (!text) return '';
  const fixed = fixInstagramEncoding(text);
  // Remove null bytes and other problematic control characters
  return fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// =============================================================================
// Instagram JSON Types
// =============================================================================

interface InstagramPost {
  media?: Array<{
    uri: string;
    creation_timestamp: number;
    title?: string;
  }>;
  title?: string;
  creation_timestamp: number;
}

interface InstagramComment {
  string_map_data: {
    Comment?: { value: string };
    'Media Owner'?: { value: string };
    Time?: { timestamp: number };
  };
}

interface InstagramMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: Array<{ uri: string; creation_timestamp: number }>;
  videos?: Array<{ uri: string; creation_timestamp: number }>;
  audio_files?: Array<{ uri: string; creation_timestamp: number }>;
  share?: { link?: string; share_text?: string };
  reactions?: Array<{ reaction: string; actor: string }>;
  is_unsent?: boolean;
}

interface InstagramConversation {
  participants: Array<{ name: string }>;
  messages: InstagramMessage[];
  title: string;
  thread_path: string;
  is_still_participant?: boolean;
}

/**
 * Instagram Adapter - Converts Instagram exports to ContentNodes
 *
 * Implements UCG Media Best Practice for proper image rendering.
 */
export class InstagramAdapter implements ContentAdapter<string> {
  readonly id = 'instagram';
  readonly name = 'Instagram Data Export';
  readonly sourceType = 'instagram' as const;
  readonly supportedFormats = ['directory'];
  readonly version = '1.0.0';

  private mediaService: MediaImportService | null = null;

  /**
   * Detect if input directory contains Instagram export
   */
  async detect(input: string): Promise<DetectionResult> {
    try {
      if (!fs.existsSync(input)) {
        return { canHandle: false, confidence: 0 };
      }

      const stat = fs.statSync(input);
      if (!stat.isDirectory()) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for Instagram-specific structure
      const expectedPaths = [
        'your_instagram_activity',
        'your_instagram_activity/messages',
        'your_instagram_activity/media',
        'personal_information',
      ];

      let matchCount = 0;
      for (const p of expectedPaths) {
        if (fs.existsSync(path.join(input, p))) {
          matchCount++;
        }
      }

      if (matchCount === 0) {
        return { canHandle: false, confidence: 0 };
      }

      const confidence = matchCount / expectedPaths.length;

      // Estimate content count
      let estimatedCount = 0;
      const postsFile = path.join(input, 'your_instagram_activity/media/posts_1.json');
      const commentsFile = path.join(input, 'your_instagram_activity/comments/post_comments_1.json');
      const inboxDir = path.join(input, 'your_instagram_activity/messages/inbox');

      if (fs.existsSync(postsFile)) {
        try {
          const posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
          estimatedCount += Array.isArray(posts) ? posts.length : 0;
        } catch { /* ignore */ }
      }

      if (fs.existsSync(commentsFile)) {
        try {
          const comments = JSON.parse(fs.readFileSync(commentsFile, 'utf-8'));
          estimatedCount += Array.isArray(comments) ? comments.length : 0;
        } catch { /* ignore */ }
      }

      if (fs.existsSync(inboxDir)) {
        const conversations = fs.readdirSync(inboxDir);
        estimatedCount += conversations.length * 10; // Rough estimate
      }

      return {
        canHandle: true,
        confidence,
        details: {
          sourceType: 'instagram',
          estimatedCount,
        },
      };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse Instagram export into ContentNodes
   *
   * Creates MediaImportService for indexing media files and rewriting URLs.
   */
  async *parse(
    input: string,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const batchId = options?.batchId || randomUUID();

    // Initialize MediaImportService for this import
    this.mediaService = new MediaImportService(input);
    console.log(`[instagram-adapter] Starting import from ${input}`);

    // Parse posts (with media)
    yield* this.parsePosts(input, batchId);

    // Parse comments
    yield* this.parseComments(input, batchId);

    // Parse DM conversations (with media)
    yield* this.parseMessages(input, batchId);

    // Log media stats
    const mediaStats = this.mediaService.getStats();
    console.log(`[instagram-adapter] Media indexed: ${mediaStats.totalIndexed} files, ${Math.round(mediaStats.totalSize / 1024 / 1024)}MB`);
  }

  /**
   * Parse Instagram posts with proper media handling
   */
  private async *parsePosts(input: string, batchId: string): AsyncIterable<ContentNode> {
    const postFiles = [
      path.join(input, 'your_instagram_activity/media/posts_1.json'),
      path.join(input, 'content/posts_1.json'),
    ];

    for (const postsFile of postFiles) {
      if (!fs.existsSync(postsFile)) continue;

      try {
        const content = fs.readFileSync(postsFile, 'utf-8');
        const posts: InstagramPost[] = JSON.parse(content);

        for (const post of posts) {
          const node = this.postToNode(post, batchId, input);
          if (node) yield node;
        }
      } catch (err) {
        console.error(`[instagram-adapter] Error parsing posts: ${err}`);
      }
    }
  }

  /**
   * Parse Instagram comments
   */
  private async *parseComments(input: string, batchId: string): AsyncIterable<ContentNode> {
    const commentsDir = path.join(input, 'your_instagram_activity/comments');
    if (!fs.existsSync(commentsDir)) return;

    const commentFiles = fs.readdirSync(commentsDir)
      .filter(f => f.startsWith('post_comments') && f.endsWith('.json'));

    for (const file of commentFiles) {
      try {
        const content = fs.readFileSync(path.join(commentsDir, file), 'utf-8');
        const comments: InstagramComment[] = JSON.parse(content);

        for (const comment of comments) {
          const node = this.commentToNode(comment, batchId);
          if (node) yield node;
        }
      } catch (err) {
        console.error(`[instagram-adapter] Error parsing comments from ${file}: ${err}`);
      }
    }
  }

  /**
   * Parse Instagram DM messages with proper media handling
   */
  private async *parseMessages(input: string, batchId: string): AsyncIterable<ContentNode> {
    const messageDirs = [
      path.join(input, 'your_instagram_activity/messages/inbox'),
      path.join(input, 'your_instagram_activity/messages/message_requests'),
    ];

    for (const messagesDir of messageDirs) {
      if (!fs.existsSync(messagesDir)) continue;

      const conversations = fs.readdirSync(messagesDir)
        .filter(d => fs.statSync(path.join(messagesDir, d)).isDirectory());

      for (const convDir of conversations) {
        const convPath = path.join(messagesDir, convDir);
        const messageFiles = fs.readdirSync(convPath)
          .filter(f => f.startsWith('message_') && f.endsWith('.json'))
          .sort();

        for (const msgFile of messageFiles) {
          try {
            const content = fs.readFileSync(path.join(convPath, msgFile), 'utf-8');
            const conversation: InstagramConversation = JSON.parse(content);

            // Yield the conversation as a node
            const convNode = this.conversationToNode(conversation, batchId, input);
            if (convNode) yield convNode;

            // Yield individual messages as nodes
            for (const message of conversation.messages) {
              const msgNode = this.messageToNode(message, conversation, batchId, input);
              if (msgNode) yield msgNode;
            }
          } catch (err) {
            console.error(`[instagram-adapter] Error parsing ${msgFile}: ${err}`);
          }
        }
      }
    }
  }

  /**
   * Extract links from a ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];

    if (node.source.type === 'instagram-message' && allNodes) {
      const threadPath = node.metadata.sourceMetadata?.threadPath as string | undefined;
      if (threadPath) {
        const conversation = allNodes.find(
          n => n.source.type === 'instagram-conversation' &&
               n.metadata.sourceMetadata?.threadPath === threadPath
        );
        if (conversation) {
          links.push({
            id: randomUUID(),
            sourceId: node.id,
            targetId: conversation.id,
            type: 'parent',
            createdAt: Date.now(),
            createdBy: 'instagram-adapter',
          });
        }
      }
    }

    return links;
  }

  /**
   * Convert Instagram post to ContentNode with indexed media
   */
  private postToNode(post: InstagramPost, batchId: string, basePath: string): ContentNode | null {
    const title = sanitizeText(post.title || '');
    const createTime = (post.creation_timestamp || 0) * 1000;

    // Build content text with properly indexed media
    let text = title || 'Instagram Post';
    const originalMediaRefs: string[] = [];
    const indexedMedia: MediaIndexResult[] = [];

    if (post.media && post.media.length > 0 && this.mediaService) {
      text += '\n\n';
      for (const media of post.media) {
        originalMediaRefs.push(media.uri);

        // Index the media file and get UCG URL
        const indexed = this.mediaService.indexMediaFile(media.uri);
        if (indexed) {
          indexedMedia.push(indexed);
          if (media.title) {
            text += `${sanitizeText(media.title)}\n`;
          }
          // Use standard UCG URL that renderers can resolve
          text += `![image](${indexed.url})\n\n`;
        } else {
          // Fallback: include original path for debugging
          text += `[Image: ${media.uri}]\n\n`;
        }
      }
    }

    if (!text.trim()) return null;

    const id = randomUUID();

    return {
      id,
      contentHash: '',
      uri: `content://instagram/post/${id}`,
      content: {
        text: text.trim(),
        format: 'markdown' as ContentFormat,
      },
      metadata: {
        title: title || 'Instagram Post',
        createdAt: createTime,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: ['instagram-post'],
        sourceMetadata: {
          mediaCount: post.media?.length || 0,
          originalMediaRefs,  // Archive canonical paths
          indexedMediaHashes: indexedMedia.map(m => m.hash),
        },
      },
      source: {
        type: 'instagram-post',
        adapter: this.id,
        originalId: id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert Instagram comment to ContentNode
   */
  private commentToNode(comment: InstagramComment, batchId: string): ContentNode | null {
    const data = comment.string_map_data;
    const text = sanitizeText(data.Comment?.value || '');
    const mediaOwner = sanitizeText(data['Media Owner']?.value || '');
    const timestamp = (data.Time?.timestamp || 0) * 1000;

    if (!text) return null;

    const id = randomUUID();

    return {
      id,
      contentHash: '',
      uri: `content://instagram/comment/${id}`,
      content: {
        text,
        format: 'text' as ContentFormat,
      },
      metadata: {
        title: `Comment on ${mediaOwner}'s post`,
        createdAt: timestamp,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: ['instagram-comment'],
        sourceMetadata: {
          mediaOwner,
        },
      },
      source: {
        type: 'instagram-comment',
        adapter: this.id,
        originalId: id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert Instagram conversation to ContentNode (summary)
   */
  private conversationToNode(
    conversation: InstagramConversation,
    batchId: string,
    basePath: string
  ): ContentNode | null {
    const participants = conversation.participants.map(p => sanitizeText(p.name)).join(', ');
    const title = sanitizeText(conversation.title) || participants;
    const messageCount = conversation.messages.length;

    const timestamps = conversation.messages
      .map(m => m.timestamp_ms)
      .filter(t => t > 0);
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const latest = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

    const text = `Conversation with ${participants}\n\n${messageCount} messages from ${new Date(earliest).toLocaleDateString()} to ${new Date(latest).toLocaleDateString()}`;

    const id = randomUUID();

    return {
      id,
      contentHash: '',
      uri: `content://instagram/conversation/${conversation.thread_path}`,
      content: {
        text,
        format: 'text' as ContentFormat,
      },
      metadata: {
        title,
        createdAt: earliest,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: ['instagram-conversation'],
        sourceMetadata: {
          threadPath: conversation.thread_path,
          participants: conversation.participants.map(p => p.name),
          messageCount,
          isStillParticipant: conversation.is_still_participant,
        },
      },
      source: {
        type: 'instagram-conversation',
        adapter: this.id,
        originalId: conversation.thread_path,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert Instagram message to ContentNode with indexed media
   */
  private messageToNode(
    message: InstagramMessage,
    conversation: InstagramConversation,
    batchId: string,
    basePath: string
  ): ContentNode | null {
    if (message.is_unsent) return null;

    const sender = sanitizeText(message.sender_name);
    let text = sanitizeText(message.content || '');
    const originalMediaRefs: string[] = [];
    const indexedMedia: MediaIndexResult[] = [];

    // Handle shared links
    if (message.share?.link) {
      text += `\n\n[Shared: ${message.share.share_text || message.share.link}](${message.share.link})`;
    }

    // Handle photos with proper media indexing
    if (message.photos && this.mediaService) {
      for (const photo of message.photos) {
        originalMediaRefs.push(photo.uri);
        const indexed = this.mediaService.indexMediaFile(photo.uri);
        if (indexed) {
          indexedMedia.push(indexed);
          text += `\n\n![photo](${indexed.url})`;
        } else {
          text += `\n\n[Photo: ${photo.uri}]`;
        }
      }
    }

    // Handle videos
    if (message.videos && this.mediaService) {
      for (const video of message.videos) {
        originalMediaRefs.push(video.uri);
        const indexed = this.mediaService.indexMediaFile(video.uri);
        if (indexed) {
          indexedMedia.push(indexed);
          text += `\n\n[Video](${indexed.url})`;
        } else {
          text += `\n\n[Video: ${video.uri}]`;
        }
      }
    }

    // Handle audio
    if (message.audio_files && this.mediaService) {
      for (const audio of message.audio_files) {
        originalMediaRefs.push(audio.uri);
        const indexed = this.mediaService.indexMediaFile(audio.uri);
        if (indexed) {
          indexedMedia.push(indexed);
          text += `\n\n[Audio](${indexed.url})`;
        } else {
          text += `\n\n[Audio: ${audio.uri}]`;
        }
      }
    }

    if (!text.trim()) return null;

    const id = randomUUID();
    const timestamp = message.timestamp_ms;

    return {
      id,
      contentHash: '',
      uri: `content://instagram/message/${id}`,
      content: {
        text: text.trim(),
        format: 'markdown' as ContentFormat,
      },
      metadata: {
        title: `${sender} in ${conversation.title}`,
        author: sender,
        createdAt: timestamp,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: ['instagram-message'],
        sourceMetadata: {
          threadPath: conversation.thread_path,
          sender,
          hasMedia: originalMediaRefs.length > 0,
          originalMediaRefs,  // Archive canonical paths
          indexedMediaHashes: indexedMedia.map(m => m.hash),
          reactions: message.reactions,
        },
      },
      source: {
        type: 'instagram-message',
        adapter: this.id,
        originalId: id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
}

/**
 * Factory function for adapter registration
 */
export function createInstagramAdapter(): InstagramAdapter {
  return new InstagramAdapter();
}
