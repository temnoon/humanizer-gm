/**
 * Facebook Adapter - Parses Facebook/Meta exports into ContentNodes
 *
 * Handles Facebook data export format and converts various content types
 * (posts, comments, messages, notes, group posts) into universal ContentNode format.
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

// ============================================================================
// Facebook Export Types
// ============================================================================

interface FacebookMessageFile {
  participants: Array<{ name: string }>;
  messages: FacebookMessage[];
  title: string;
  is_still_participant: boolean;
  thread_path: string;
}

interface FacebookMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  type: string;
  photos?: Array<{ uri: string }>;
  audio_files?: Array<{ uri: string }>;
  videos?: Array<{ uri: string }>;
  files?: Array<{ uri: string }>;
  reactions?: Array<{ reaction: string; actor: string }>;
  sticker?: { uri: string };
  share?: { link?: string; share_text?: string };
  is_unsent?: boolean;
}

interface FacebookPost {
  timestamp: number;
  data?: Array<{ post?: string }>;
  title?: string;
  attachments?: Array<{
    data?: Array<{
      media?: { uri?: string };
      external_context?: { url?: string; name?: string };
    }>;
  }>;
  tags?: Array<{ name: string }>;
}

interface FacebookComment {
  timestamp: number;
  comment?: string;
  data?: Array<{ comment?: { comment?: string } }>;
  title?: string;
  author?: string;
  group?: string;
}

interface FacebookNote {
  title?: string;
  created_timestamp?: number;
  updated_timestamp?: number;
  text?: string;
  tags?: Array<{ name: string }>;
}

// Input types for Facebook adapter
type FacebookInput =
  | string  // Directory path
  | { exportPath: string };  // Object with path

// ============================================================================
// Facebook Adapter Implementation
// ============================================================================

export class FacebookAdapter implements ContentAdapter<FacebookInput> {
  readonly id = 'facebook';
  readonly name = 'Facebook/Meta Export';
  readonly sourceType = 'facebook' as const;
  readonly supportedFormats = [
    'directory',
    'facebook-export',
  ];
  readonly version = '1.0.0';

  private mediaService: MediaImportService | null = null;

  /**
   * Detect if input is a Facebook export directory
   */
  async detect(input: FacebookInput): Promise<DetectionResult> {
    try {
      const exportPath = this.getExportPath(input);
      if (!exportPath || !fs.existsSync(exportPath)) {
        return { canHandle: false, confidence: 0 };
      }

      const stat = fs.statSync(exportPath);
      if (!stat.isDirectory()) {
        return { canHandle: false, confidence: 0 };
      }

      // Check for Facebook-specific directory structure
      const hasMessages = fs.existsSync(path.join(exportPath, 'messages')) ||
                          fs.existsSync(path.join(exportPath, 'your_activity_across_facebook', 'messages'));
      const hasPosts = fs.existsSync(path.join(exportPath, 'posts')) ||
                       fs.existsSync(path.join(exportPath, 'your_activity_across_facebook', 'posts'));
      const hasComments = fs.existsSync(path.join(exportPath, 'comments')) ||
                          fs.existsSync(path.join(exportPath, 'your_activity_across_facebook', 'comments'));

      if (hasMessages || hasPosts || hasComments) {
        return {
          canHandle: true,
          confidence: 1.0,
          details: {
            sourceType: 'facebook',
            estimatedCount: undefined, // Will be calculated during parse
          },
        };
      }

      return { canHandle: false, confidence: 0 };
    } catch {
      return { canHandle: false, confidence: 0 };
    }
  }

  /**
   * Parse Facebook export into ContentNodes
   *
   * Creates MediaImportService for indexing media files and rewriting URLs.
   */
  async *parse(
    input: FacebookInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const exportPath = this.getExportPath(input);
    if (!exportPath) {
      throw new Error('Invalid Facebook export path');
    }

    const batchId = options?.batchId || randomUUID();

    // Initialize MediaImportService for this import
    this.mediaService = new MediaImportService(exportPath);
    console.log(`[facebook-adapter] Starting import from ${exportPath}`);

    // Parse messages (with media)
    yield* this.parseMessages(exportPath, batchId);

    // Parse posts (with media)
    yield* this.parsePosts(exportPath, batchId);

    // Parse comments
    yield* this.parseComments(exportPath, batchId);

    // Parse notes
    yield* this.parseNotes(exportPath, batchId);

    // Parse group posts
    yield* this.parseGroupPosts(exportPath, batchId);

    // Log media stats
    const mediaStats = this.mediaService.getStats();
    console.log(`[facebook-adapter] Media indexed: ${mediaStats.totalIndexed} files, ${Math.round(mediaStats.totalSize / 1024 / 1024)}MB`);
  }

  /**
   * Extract links from a ContentNode
   */
  extractLinks(node: ContentNode, allNodes?: ContentNode[]): ContentLink[] {
    const links: ContentLink[] = [];

    // Link messages to their thread
    if (node.metadata.sourceMetadata?.threadId) {
      const parentThread = allNodes?.find(
        n => n.source.originalId === node.metadata.sourceMetadata?.threadId &&
            n.metadata.sourceMetadata?.isThread === true
      );
      if (parentThread) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: parentThread.id,
          type: 'child',
          createdAt: Date.now(),
          createdBy: 'facebook-adapter',
        });
        links.push({
          id: randomUUID(),
          sourceId: parentThread.id,
          targetId: node.id,
          type: 'parent',
          createdAt: Date.now(),
          createdBy: 'facebook-adapter',
        });
      }
    }

    // Link comments to posts
    if (node.metadata.sourceMetadata?.parentPostId) {
      const parentPost = allNodes?.find(
        n => n.source.originalId === node.metadata.sourceMetadata?.parentPostId
      );
      if (parentPost) {
        links.push({
          id: randomUUID(),
          sourceId: node.id,
          targetId: parentPost.id,
          type: 'responds-to',
          createdAt: Date.now(),
          createdBy: 'facebook-adapter',
        });
      }
    }

    return links;
  }

  // ===========================================================================
  // Private Methods - Parsing Different Content Types
  // ===========================================================================

  private getExportPath(input: FacebookInput): string | null {
    if (typeof input === 'string') {
      return input;
    }
    if (typeof input === 'object' && input !== null && 'exportPath' in input) {
      return input.exportPath;
    }
    return null;
  }

  /**
   * Parse Facebook messages
   */
  private async *parseMessages(
    exportPath: string,
    batchId: string
  ): AsyncIterable<ContentNode> {
    const messagePaths = [
      path.join(exportPath, 'messages', 'inbox'),
      path.join(exportPath, 'messages', 'archived_threads'),
      path.join(exportPath, 'your_activity_across_facebook', 'messages', 'inbox'),
    ];

    for (const msgPath of messagePaths) {
      if (!fs.existsSync(msgPath)) continue;

      const threadDirs = fs.readdirSync(msgPath).filter(f => {
        const fullPath = path.join(msgPath, f);
        return fs.statSync(fullPath).isDirectory();
      });

      for (const threadDir of threadDirs) {
        const threadPath = path.join(msgPath, threadDir);
        const messageFiles = fs.readdirSync(threadPath).filter(
          f => f.startsWith('message') && f.endsWith('.json')
        );

        if (messageFiles.length === 0) continue;

        let threadTitle = threadDir;
        let participants: string[] = [];
        const allMessages: FacebookMessage[] = [];

        // Read all message files in thread
        for (const file of messageFiles) {
          try {
            const content = fs.readFileSync(path.join(threadPath, file), 'utf-8');
            const data: FacebookMessageFile = JSON.parse(content);

            threadTitle = data.title || threadDir;
            participants = data.participants.map(p => this.decodeFacebookString(p.name));

            for (const msg of data.messages) {
              if (msg.content && !msg.is_unsent) {
                allMessages.push(msg);
              }
            }
          } catch (err) {
            console.warn(`[FacebookAdapter] Failed to parse ${file}:`, err);
          }
        }

        if (allMessages.length === 0) continue;

        // Sort chronologically
        allMessages.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

        // Create thread node (conversation container)
        const threadId = randomUUID();
        const threadText = allMessages
          .map(m => `[${this.decodeFacebookString(m.sender_name)}]: ${this.decodeFacebookString(m.content || '')}`)
          .join('\n\n');

        yield {
          id: threadId,
          contentHash: '',
          uri: `content://facebook-message/thread/${threadDir}`,
          content: {
            text: threadText,
            format: 'conversation' as ContentFormat,
          },
          metadata: {
            title: this.decodeFacebookString(threadTitle),
            createdAt: allMessages[0].timestamp_ms,
            importedAt: Date.now(),
            wordCount: this.countWords(threadText),
            tags: [],
            sourceMetadata: {
              isThread: true,
              messageCount: allMessages.length,
              participants,
            },
          },
          source: {
            type: 'facebook-message',
            adapter: this.id,
            originalId: threadDir,
            originalPath: threadPath,
            importBatch: batchId,
          },
          version: {
            number: 1,
            rootId: threadId,
          },
        };

        // Create individual message nodes
        for (const msg of allMessages) {
          let text = this.decodeFacebookString(msg.content || '');
          const originalMediaRefs: string[] = [];
          const indexedMedia: MediaIndexResult[] = [];

          // Handle shared links
          if (msg.share?.link) {
            text += `\n\n[Shared: ${msg.share.share_text || msg.share.link}](${msg.share.link})`;
          }

          // Handle photos with media indexing
          if (msg.photos && this.mediaService) {
            for (const photo of msg.photos) {
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

          // Handle videos with media indexing
          if (msg.videos && this.mediaService) {
            for (const video of msg.videos) {
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

          // Handle audio files with media indexing
          if (msg.audio_files && this.mediaService) {
            for (const audio of msg.audio_files) {
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

          // Handle files with media indexing
          if (msg.files && this.mediaService) {
            for (const file of msg.files) {
              originalMediaRefs.push(file.uri);
              const indexed = this.mediaService.indexMediaFile(file.uri);
              if (indexed) {
                indexedMedia.push(indexed);
                text += `\n\n[File](${indexed.url})`;
              } else {
                text += `\n\n[File: ${file.uri}]`;
              }
            }
          }

          // Handle sticker with media indexing
          if (msg.sticker?.uri && this.mediaService) {
            originalMediaRefs.push(msg.sticker.uri);
            const indexed = this.mediaService.indexMediaFile(msg.sticker.uri);
            if (indexed) {
              indexedMedia.push(indexed);
              text += `\n\n![sticker](${indexed.url})`;
            } else {
              text += `\n\n[Sticker: ${msg.sticker.uri}]`;
            }
          }

          if (!text.trim()) continue;

          const msgId = randomUUID();
          const originalMsgId = `${threadDir}-${msg.timestamp_ms}`;

          yield {
            id: msgId,
            contentHash: '',
            uri: `content://facebook-message/${threadDir}/${msg.timestamp_ms}`,
            content: {
              text: text.trim(),
              format: 'markdown' as ContentFormat,
            },
            metadata: {
              author: this.decodeFacebookString(msg.sender_name),
              createdAt: msg.timestamp_ms,
              importedAt: Date.now(),
              wordCount: this.countWords(text),
              tags: [],
              sourceMetadata: {
                threadId: threadDir,
                threadTitle: this.decodeFacebookString(threadTitle),
                type: msg.type,
                hasMedia: originalMediaRefs.length > 0,
                hasShare: !!msg.share,
                reactions: msg.reactions,
                originalMediaRefs,  // Archive canonical paths
                indexedMediaHashes: indexedMedia.map(m => m.hash),
              },
            },
            source: {
              type: 'facebook-message',
              adapter: this.id,
              originalId: originalMsgId,
              originalPath: `${threadPath}/${msg.timestamp_ms}`,
              importBatch: batchId,
            },
            version: {
              number: 1,
              rootId: msgId,
            },
          };
        }
      }
    }
  }

  /**
   * Parse Facebook posts
   */
  private async *parsePosts(
    exportPath: string,
    batchId: string
  ): AsyncIterable<ContentNode> {
    const postsPaths = [
      path.join(exportPath, 'posts', 'your_posts__check_ins__photos_and_videos_1.json'),
      path.join(exportPath, 'posts', 'your_posts_1.json'),
      path.join(exportPath, 'your_activity_across_facebook', 'posts', 'your_posts__check_ins__photos_and_videos_1.json'),
    ];

    for (const postsPath of postsPaths) {
      if (!fs.existsSync(postsPath)) continue;

      try {
        const content = fs.readFileSync(postsPath, 'utf-8');
        const posts: FacebookPost[] = JSON.parse(content);

        for (const post of posts) {
          let text = this.extractPostText(post);
          const originalMediaRefs: string[] = [];
          const indexedMedia: MediaIndexResult[] = [];

          // Handle attachments with media
          if (post.attachments && this.mediaService) {
            for (const attachment of post.attachments) {
              if (attachment.data) {
                for (const item of attachment.data) {
                  // Handle media attachments (photos, videos)
                  if (item.media?.uri) {
                    originalMediaRefs.push(item.media.uri);
                    const indexed = this.mediaService.indexMediaFile(item.media.uri);
                    if (indexed) {
                      indexedMedia.push(indexed);
                      text += `\n\n![image](${indexed.url})`;
                    } else {
                      text += `\n\n[Media: ${item.media.uri}]`;
                    }
                  }

                  // Handle external links
                  if (item.external_context?.url) {
                    const linkName = item.external_context.name || item.external_context.url;
                    text += `\n\n[${this.decodeFacebookString(linkName)}](${item.external_context.url})`;
                  }
                }
              }
            }
          }

          if (!text.trim()) continue;

          const postId = randomUUID();
          const timestamp = post.timestamp * 1000; // Convert to ms

          yield {
            id: postId,
            contentHash: '',
            uri: `content://facebook-post/${post.timestamp}`,
            content: {
              text: this.decodeFacebookString(text.trim()),
              format: 'markdown' as ContentFormat,
            },
            metadata: {
              title: post.title ? this.decodeFacebookString(post.title) : undefined,
              createdAt: timestamp,
              importedAt: Date.now(),
              wordCount: this.countWords(text),
              tags: post.tags?.map(t => this.decodeFacebookString(t.name)) || [],
              sourceMetadata: {
                hasAttachments: !!post.attachments?.length,
                attachmentCount: post.attachments?.length || 0,
                hasMedia: originalMediaRefs.length > 0,
                originalMediaRefs,  // Archive canonical paths
                indexedMediaHashes: indexedMedia.map(m => m.hash),
              },
            },
            source: {
              type: 'facebook-post',
              adapter: this.id,
              originalId: `post-${post.timestamp}`,
              originalPath: postsPath,
              importBatch: batchId,
            },
            version: {
              number: 1,
              rootId: postId,
            },
          };
        }
      } catch (err) {
        console.warn(`[FacebookAdapter] Failed to parse posts from ${postsPath}:`, err);
      }
    }
  }

  /**
   * Parse Facebook comments
   */
  private async *parseComments(
    exportPath: string,
    batchId: string
  ): AsyncIterable<ContentNode> {
    const commentsPaths = [
      path.join(exportPath, 'comments', 'comments.json'),
      path.join(exportPath, 'comments_and_reactions', 'comments.json'),
      path.join(exportPath, 'your_activity_across_facebook', 'comments', 'comments.json'),
    ];

    for (const commentsPath of commentsPaths) {
      if (!fs.existsSync(commentsPath)) continue;

      try {
        const content = fs.readFileSync(commentsPath, 'utf-8');
        const data = JSON.parse(content);
        const comments: FacebookComment[] = data.comments || data;

        for (const comment of comments) {
          const text = this.extractCommentText(comment);
          if (!text.trim()) continue;

          const commentId = randomUUID();
          const timestamp = comment.timestamp * 1000;

          yield {
            id: commentId,
            contentHash: '',
            uri: `content://facebook-comment/${comment.timestamp}`,
            content: {
              text: this.decodeFacebookString(text),
              format: 'text' as ContentFormat,
            },
            metadata: {
              author: comment.author ? this.decodeFacebookString(comment.author) : undefined,
              createdAt: timestamp,
              importedAt: Date.now(),
              wordCount: this.countWords(text),
              tags: [],
              sourceMetadata: {
                title: comment.title ? this.decodeFacebookString(comment.title) : undefined,
                group: comment.group ? this.decodeFacebookString(comment.group) : undefined,
              },
            },
            source: {
              type: 'facebook-comment',
              adapter: this.id,
              originalId: `comment-${comment.timestamp}`,
              originalPath: commentsPath,
              importBatch: batchId,
            },
            version: {
              number: 1,
              rootId: commentId,
            },
          };
        }
      } catch (err) {
        console.warn(`[FacebookAdapter] Failed to parse comments from ${commentsPath}:`, err);
      }
    }
  }

  /**
   * Parse Facebook notes
   */
  private async *parseNotes(
    exportPath: string,
    batchId: string
  ): AsyncIterable<ContentNode> {
    const notesPaths = [
      path.join(exportPath, 'notes', 'notes.json'),
      path.join(exportPath, 'your_activity_across_facebook', 'notes', 'notes.json'),
    ];

    for (const notesPath of notesPaths) {
      if (!fs.existsSync(notesPath)) continue;

      try {
        const content = fs.readFileSync(notesPath, 'utf-8');
        const data = JSON.parse(content);
        const notes: FacebookNote[] = data.notes || data;

        for (const note of notes) {
          const text = note.text || '';
          if (!text.trim()) continue;

          const noteId = randomUUID();
          const timestamp = (note.created_timestamp || note.updated_timestamp || Date.now() / 1000) * 1000;

          yield {
            id: noteId,
            contentHash: '',
            uri: `content://facebook-note/${note.created_timestamp || Date.now()}`,
            content: {
              text: this.decodeFacebookString(text),
              format: 'markdown' as ContentFormat,
            },
            metadata: {
              title: note.title ? this.decodeFacebookString(note.title) : 'Untitled Note',
              createdAt: timestamp,
              importedAt: Date.now(),
              wordCount: this.countWords(text),
              tags: note.tags?.map(t => this.decodeFacebookString(t.name)) || [],
              sourceMetadata: {
                updatedAt: note.updated_timestamp ? note.updated_timestamp * 1000 : undefined,
              },
            },
            source: {
              type: 'facebook-post', // Notes are similar to posts
              adapter: this.id,
              originalId: `note-${note.created_timestamp}`,
              originalPath: notesPath,
              importBatch: batchId,
            },
            version: {
              number: 1,
              rootId: noteId,
            },
          };
        }
      } catch (err) {
        console.warn(`[FacebookAdapter] Failed to parse notes from ${notesPath}:`, err);
      }
    }
  }

  /**
   * Parse Facebook group posts
   */
  private async *parseGroupPosts(
    exportPath: string,
    batchId: string
  ): AsyncIterable<ContentNode> {
    const groupPaths = [
      path.join(exportPath, 'groups', 'your_posts_in_groups.json'),
      path.join(exportPath, 'groups', 'your_group_membership_activity.json'),
      path.join(exportPath, 'your_activity_across_facebook', 'groups'),
    ];

    for (const groupPath of groupPaths) {
      if (!fs.existsSync(groupPath)) continue;

      // Handle directory vs file
      const stat = fs.statSync(groupPath);
      const files = stat.isDirectory()
        ? fs.readdirSync(groupPath).filter(f => f.endsWith('.json')).map(f => path.join(groupPath, f))
        : [groupPath];

      for (const filePath of files) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content);
          const posts: Array<{
            timestamp: number;
            data?: Array<{ post?: string }>;
            title?: string;
            group?: string;
          }> = data.group_posts_v2 || data.posts || data;

          for (const post of posts) {
            if (!Array.isArray(posts)) continue;

            const text = post.data?.[0]?.post || '';
            if (!text.trim()) continue;

            const postId = randomUUID();
            const timestamp = post.timestamp * 1000;

            yield {
              id: postId,
              contentHash: '',
              uri: `content://facebook-group-post/${post.timestamp}`,
              content: {
                text: this.decodeFacebookString(text),
                format: 'text' as ContentFormat,
              },
              metadata: {
                title: post.title ? this.decodeFacebookString(post.title) : undefined,
                createdAt: timestamp,
                importedAt: Date.now(),
                wordCount: this.countWords(text),
                tags: [],
                sourceMetadata: {
                  groupName: post.group ? this.decodeFacebookString(post.group) : undefined,
                  isGroupPost: true,
                },
              },
              source: {
                type: 'facebook-post', // Group posts use facebook-post source type
                adapter: this.id,
                originalId: `group-post-${post.timestamp}`,
                originalPath: filePath,
                importBatch: batchId,
              },
              version: {
                number: 1,
                rootId: postId,
              },
            };
          }
        } catch (err) {
          console.warn(`[FacebookAdapter] Failed to parse group posts from ${filePath}:`, err);
        }
      }
    }
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private extractPostText(post: FacebookPost): string {
    const parts: string[] = [];

    if (post.data) {
      for (const item of post.data) {
        if (item.post) {
          parts.push(item.post);
        }
      }
    }

    if (post.title) {
      parts.unshift(post.title);
    }

    return parts.join('\n\n');
  }

  private extractCommentText(comment: FacebookComment): string {
    if (comment.comment) {
      return comment.comment;
    }
    if (comment.data?.[0]?.comment?.comment) {
      return comment.data[0].comment.comment;
    }
    return '';
  }

  /**
   * Decode Facebook's escaped unicode strings
   */
  private decodeFacebookString(str: string): string {
    try {
      // Facebook uses \u00XX encoding for UTF-8 bytes
      return str.replace(/\\u00([0-9a-fA-F]{2})/g, (_, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
      });
    } catch {
      return str;
    }
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }
}

/**
 * Factory function for adapter registration
 */
export function createFacebookAdapter(): FacebookAdapter {
  return new FacebookAdapter();
}
