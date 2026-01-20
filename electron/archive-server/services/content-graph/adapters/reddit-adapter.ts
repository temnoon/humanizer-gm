/**
 * Reddit Adapter - Parses Reddit data exports into ContentNodes
 *
 * Handles the Reddit GDPR data export format (CSV files) and converts
 * posts, comments, and messages into universal ContentNode format.
 *
 * Key files parsed:
 * - posts.csv: User's submitted posts (id, permalink, date, subreddit, title, url, body)
 * - comments.csv: User's comments (id, permalink, date, subreddit, link, parent, body, media)
 * - messages_archive.csv: Private messages (id, thread_id, date, from, to, subject, body)
 * - chat_history.csv: Chat messages (message_id, created_at, username, message, channel)
 *
 * MEDIA HANDLING:
 * Reddit exports typically contain URLs rather than local media files.
 * This adapter follows the UCG Media Best Practice where applicable:
 * - If media is a local file path, index via MediaImportService
 * - If media is a URL (common case), include as markdown link
 * - Original references stored in sourceMetadata.originalMediaRefs
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
 * CSV row type - all fields are strings from CSV parsing
 */
type CSVRow = Record<string, string>;

/**
 * Input type for Reddit adapter
 */
type RedditInput = string; // Directory path containing CSV files

/**
 * Simple CSV parser that handles quoted fields with commas and newlines
 */
function parseCSV(content: string): CSVRow[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  // Split content respecting quoted fields
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if (char === '\n' && !inQuotes) {
      lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length < 2) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  // Parse data rows
  const results: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: CSVRow = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    results.push(row);
  }

  return results;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

/**
 * Sanitize text by removing null bytes and problematic characters
 */
function sanitizeText(text: string): string {
  if (!text) return '';
  // Remove null bytes and other problematic control characters
  // Keep newlines (\n), tabs (\t), and carriage returns (\r)
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Parse Reddit date format: "2023-11-17 06:19:06 UTC"
 */
function parseRedditDate(dateStr: string): number {
  if (!dateStr) return Date.now();
  try {
    // Remove "UTC" suffix and parse
    const normalized = dateStr.replace(' UTC', 'Z').replace(' ', 'T');
    const date = new Date(normalized);
    return isNaN(date.getTime()) ? Date.now() : date.getTime();
  } catch {
    return Date.now();
  }
}

/**
 * Reddit Adapter - Converts Reddit exports to ContentNodes
 */
export class RedditAdapter implements ContentAdapter<RedditInput> {
  readonly id = 'reddit';
  readonly name = 'Reddit Data Export';
  readonly sourceType = 'reddit' as const;
  readonly supportedFormats = ['directory'];
  readonly version = '1.0.0';

  private mediaService: MediaImportService | null = null;

  /**
   * Detect if input directory contains Reddit export
   */
  async detect(input: RedditInput): Promise<DetectionResult> {
    try {
      if (!fs.existsSync(input)) {
        return { canHandle: false, confidence: 0 };
      }

      const stat = fs.statSync(input);
      if (!stat.isDirectory()) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for Reddit-specific files
      const expectedFiles = [
        'comments.csv',
        'posts.csv',
        'subscribed_subreddits.csv',
        'statistics.csv',
      ];

      let matchCount = 0;
      for (const file of expectedFiles) {
        if (fs.existsSync(path.join(input, file))) {
          matchCount++;
        }
      }

      if (matchCount === 0) {
        return { canHandle: false, confidence: 0 };
      }

      // Calculate confidence based on matches
      const confidence = matchCount / expectedFiles.length;

      // Count available content
      let estimatedCount = 0;
      const postsFile = path.join(input, 'posts.csv');
      const commentsFile = path.join(input, 'comments.csv');
      const messagesFile = path.join(input, 'messages_archive.csv');

      if (fs.existsSync(postsFile)) {
        const content = fs.readFileSync(postsFile, 'utf-8');
        estimatedCount += content.split('\n').length - 1;
      }
      if (fs.existsSync(commentsFile)) {
        const content = fs.readFileSync(commentsFile, 'utf-8');
        estimatedCount += content.split('\n').length - 1;
      }
      if (fs.existsSync(messagesFile)) {
        const content = fs.readFileSync(messagesFile, 'utf-8');
        estimatedCount += content.split('\n').length - 1;
      }

      return {
        canHandle: true,
        confidence,
        details: {
          sourceType: 'reddit',
          estimatedCount,
        },
      };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse Reddit export into ContentNodes
   */
  async *parse(
    input: RedditInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const batchId = options?.batchId || randomUUID();

    // Initialize MediaImportService for this import
    this.mediaService = new MediaImportService(input);
    console.log(`[reddit-adapter] Starting import from ${input}`);

    // Parse posts
    const postsFile = path.join(input, 'posts.csv');
    if (fs.existsSync(postsFile)) {
      const content = fs.readFileSync(postsFile, 'utf-8');
      const posts = parseCSV(content);

      for (const post of posts) {
        const node = this.postToNode(post, batchId, input);
        if (node) yield node;
      }
    }

    // Parse comments
    const commentsFile = path.join(input, 'comments.csv');
    if (fs.existsSync(commentsFile)) {
      const content = fs.readFileSync(commentsFile, 'utf-8');
      const comments = parseCSV(content);

      for (const comment of comments) {
        const node = this.commentToNode(comment, batchId, input);
        if (node) yield node;
      }
    }

    // Parse private messages
    const messagesFile = path.join(input, 'messages_archive.csv');
    if (fs.existsSync(messagesFile)) {
      const content = fs.readFileSync(messagesFile, 'utf-8');
      const messages = parseCSV(content);

      for (const message of messages) {
        const node = this.messageToNode(message, batchId);
        if (node) yield node;
      }
    }

    // Parse chat history
    const chatFile = path.join(input, 'chat_history.csv');
    if (fs.existsSync(chatFile)) {
      const content = fs.readFileSync(chatFile, 'utf-8');
      const chats = parseCSV(content);

      for (const chat of chats) {
        const node = this.chatToNode(chat, batchId);
        if (node) yield node;
      }
    }

    // Log media stats
    const mediaStats = this.mediaService.getStats();
    console.log(`[reddit-adapter] Media indexed: ${mediaStats.totalIndexed} files, ${Math.round(mediaStats.totalSize / 1024 / 1024)}MB`);
  }

  /**
   * Extract links from a ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];

    // Link comments to their parent posts
    if (node.source.type === 'reddit-comment') {
      const parentLink = node.metadata.sourceMetadata?.parentLink as string | undefined;
      if (parentLink && allNodes) {
        // Find parent post or comment by permalink
        const parent = allNodes.find(
          n => n.metadata.sourceMetadata?.permalink === parentLink ||
               n.uri.includes(parentLink.replace('https://www.reddit.com', ''))
        );
        if (parent) {
          links.push({
            id: randomUUID(),
            sourceId: node.id,
            targetId: parent.id,
            type: 'responds-to',
            createdAt: Date.now(),
            createdBy: 'reddit-adapter',
          });
        }
      }
    }

    // Link messages in same thread
    if (node.source.type === 'reddit-message') {
      const threadId = node.metadata.sourceMetadata?.threadId as string | undefined;
      if (threadId && allNodes) {
        const threadMessages = allNodes.filter(
          n => n.source.type === 'reddit-message' &&
               n.metadata.sourceMetadata?.threadId === threadId &&
               n.id !== node.id
        );
        for (const msg of threadMessages) {
          if ((node.metadata.createdAt || 0) > (msg.metadata.createdAt || 0)) {
            links.push({
              id: randomUUID(),
              sourceId: node.id,
              targetId: msg.id,
              type: 'follows',
              createdAt: Date.now(),
              createdBy: 'reddit-adapter',
            });
          }
        }
      }
    }

    return links;
  }

  /**
   * Convert a Reddit post to ContentNode
   */
  private postToNode(post: CSVRow, batchId: string, basePath: string): ContentNode | null {
    // Combine title and body for full content
    const title = sanitizeText(post.title || '').trim();
    const body = sanitizeText(post.body || '').trim();

    if (!title && !body) {
      return null;
    }

    const originalMediaRefs: string[] = [];
    const indexedMedia: MediaIndexResult[] = [];

    // Build content text
    let text = '';
    if (title) {
      text = `# ${title}\n\n`;
    }
    if (body) {
      text += body;
    }

    // Handle post URL - could be external link or media
    if (post.url && post.url !== post.permalink && !post.url.startsWith('/r/')) {
      // Check if URL is a local file path (rare, but possible)
      if (!post.url.startsWith('http') && this.mediaService) {
        originalMediaRefs.push(post.url);
        const indexed = this.mediaService.indexMediaFile(post.url);
        if (indexed) {
          indexedMedia.push(indexed);
          // Determine if image or other media
          if (indexed.mimeType?.startsWith('image/')) {
            text += `\n\n![image](${indexed.url})`;
          } else {
            text += `\n\n[Media](${indexed.url})`;
          }
        } else {
          text += `\n\n[Link](${post.url})`;
        }
      } else {
        // External URL - check if it's an image
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(post.url)) {
          text += `\n\n![image](${post.url})`;
          originalMediaRefs.push(post.url);
        } else {
          text += `\n\n[Link](${post.url})`;
        }
      }
    }

    const id = randomUUID();
    const createTime = parseRedditDate(post.date);

    return {
      id,
      contentHash: '',
      uri: `content://reddit/post/${post.id}`,
      content: {
        text: text.trim(),
        format: 'markdown' as ContentFormat,
      },
      metadata: {
        title: title || `Post in r/${post.subreddit}`,
        createdAt: createTime,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: [`r/${post.subreddit}`],
        sourceMetadata: {
          subreddit: post.subreddit,
          permalink: post.permalink,
          url: post.url,
          gildings: parseInt(post.gildings) || 0,
          hasMedia: originalMediaRefs.length > 0,
          originalMediaRefs,  // Archive canonical paths/URLs
          indexedMediaHashes: indexedMedia.map(m => m.hash),
        },
      },
      source: {
        type: 'reddit-post',
        adapter: this.id,
        originalId: post.id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert a Reddit comment to ContentNode
   */
  private commentToNode(comment: CSVRow, batchId: string, basePath: string): ContentNode | null {
    let text = sanitizeText(comment.body || '').trim();

    if (!text) {
      return null;
    }

    const originalMediaRefs: string[] = [];
    const indexedMedia: MediaIndexResult[] = [];

    // Handle media field - could be URL or file path
    if (comment.media) {
      const mediaRef = comment.media.trim();
      if (mediaRef) {
        // Check if it's a local file path
        if (!mediaRef.startsWith('http') && this.mediaService) {
          originalMediaRefs.push(mediaRef);
          const indexed = this.mediaService.indexMediaFile(mediaRef);
          if (indexed) {
            indexedMedia.push(indexed);
            if (indexed.mimeType?.startsWith('image/')) {
              text += `\n\n![image](${indexed.url})`;
            } else if (indexed.mimeType?.startsWith('video/')) {
              text += `\n\n[Video](${indexed.url})`;
            } else {
              text += `\n\n[Media](${indexed.url})`;
            }
          } else {
            text += `\n\n[Media: ${mediaRef}]`;
          }
        } else {
          // External URL
          originalMediaRefs.push(mediaRef);
          if (/\.(jpg|jpeg|png|gif|webp)$/i.test(mediaRef)) {
            text += `\n\n![image](${mediaRef})`;
          } else if (/\.(mp4|webm|mov)$/i.test(mediaRef)) {
            text += `\n\n[Video](${mediaRef})`;
          } else {
            text += `\n\n[Media](${mediaRef})`;
          }
        }
      }
    }

    const id = randomUUID();
    const createTime = parseRedditDate(comment.date);

    return {
      id,
      contentHash: '',
      uri: `content://reddit/comment/${comment.id}`,
      content: {
        text: text.trim(),
        format: 'markdown' as ContentFormat,
      },
      metadata: {
        title: `Comment in r/${comment.subreddit}`,
        createdAt: createTime,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: [`r/${comment.subreddit}`],
        sourceMetadata: {
          subreddit: comment.subreddit,
          permalink: comment.permalink,
          postLink: comment.link,
          parentLink: comment.parent || undefined,
          gildings: parseInt(comment.gildings) || 0,
          hasMedia: originalMediaRefs.length > 0,
          originalMediaRefs,  // Archive canonical paths/URLs
          indexedMediaHashes: indexedMedia.map(m => m.hash),
        },
      },
      source: {
        type: 'reddit-comment',
        adapter: this.id,
        originalId: comment.id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert a Reddit private message to ContentNode
   */
  private messageToNode(message: CSVRow, batchId: string): ContentNode | null {
    const body = sanitizeText(message.body || '').trim();
    const subject = sanitizeText(message.subject || '').trim();

    if (!body && !subject) {
      return null;
    }

    let text = '';
    if (subject) {
      text = `**Subject:** ${subject}\n\n`;
    }
    text += body;

    const id = randomUUID();
    const createTime = parseRedditDate(message.date);

    return {
      id,
      contentHash: '',
      uri: `content://reddit/message/${message.id}`,
      content: {
        text: text.trim(),
        format: 'markdown' as ContentFormat,
      },
      metadata: {
        title: subject || `Message with ${message.to || message.from}`,
        author: message.from,
        createdAt: createTime,
        importedAt: Date.now(),
        wordCount: this.countWords(text),
        tags: ['reddit-message'],
        sourceMetadata: {
          threadId: message.thread_id,
          from: message.from,
          to: message.to,
          permalink: message.permalink,
        },
      },
      source: {
        type: 'reddit-message',
        adapter: this.id,
        originalId: message.id,
        importBatch: batchId,
      },
      version: {
        number: 1,
        rootId: id,
      },
    };
  }

  /**
   * Convert a Reddit chat message to ContentNode
   */
  private chatToNode(chat: CSVRow, batchId: string): ContentNode | null {
    const message = sanitizeText(chat.message || '').trim();

    if (!message) {
      return null;
    }

    const id = randomUUID();
    const createTime = parseRedditDate(chat.created_at);

    return {
      id,
      contentHash: '',
      uri: `content://reddit/chat/${chat.message_id}`,
      content: {
        text: message,
        format: 'text' as ContentFormat,
      },
      metadata: {
        title: chat.channel_name || `Chat in r/${chat.subreddit || 'unknown'}`,
        author: chat.username,
        createdAt: createTime,
        importedAt: Date.now(),
        wordCount: this.countWords(message),
        tags: chat.subreddit ? [`r/${chat.subreddit}`, 'reddit-chat'] : ['reddit-chat'],
        sourceMetadata: {
          channelUrl: chat.channel_url,
          channelName: chat.channel_name,
          subreddit: chat.subreddit,
          conversationType: chat.conversation_type,
          parentMessageId: chat.thread_parent_message_id,
        },
      },
      source: {
        type: 'reddit-chat',
        adapter: this.id,
        originalId: chat.message_id,
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
export function createRedditAdapter(): RedditAdapter {
  return new RedditAdapter();
}
