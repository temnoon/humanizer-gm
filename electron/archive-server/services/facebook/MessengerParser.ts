/**
 * MessengerParser - Parse Facebook Messenger conversations
 *
 * Reads message threads from the Facebook export and converts them to ContentItem format.
 * Each message becomes a ContentItem with type='message' and source='facebook'.
 * Threads are linked via thread_id.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ContentItem } from './types.js';

// ============================================================
// Raw Messenger JSON Structures
// ============================================================

interface MessengerThread {
  participants: Array<{ name: string }>;
  messages: MessengerMessage[];
  title: string;
  is_still_participant: boolean;
  thread_path: string;
  magic_words?: string[];
}

interface MessengerMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  is_geoblocked_for_viewer?: boolean;
  is_unsent_image_by_messenger_kid_parent?: boolean;
  // Media attachments
  photos?: Array<{ uri: string; creation_timestamp: number }>;
  videos?: Array<{ uri: string; creation_timestamp: number; thumbnail?: { uri: string } }>;
  audio_files?: Array<{ uri: string; creation_timestamp: number }>;
  gifs?: Array<{ uri: string }>;
  sticker?: { uri: string };
  share?: { link?: string; share_text?: string };
  // Reactions on this message
  reactions?: Array<{ reaction: string; actor: string }>;
  // Call info
  call_duration?: number;
  // Unsent
  is_unsent?: boolean;
}

// ============================================================
// Parser Result
// ============================================================

export interface MessengerParseResult {
  threads: number;
  messages: ContentItem[];
  mediaFiles: string[];
  errors: string[];
}

export interface MessengerParseOptions {
  exportPath: string;              // Path to Facebook export root
  ownerName?: string;              // Your name (to identify own messages)
  includeGroupChats?: boolean;     // Include group chats (default: true)
  minMessages?: number;            // Minimum messages per thread (default: 1)
  onProgress?: (current: number, total: number, threadName: string) => void;
}

// ============================================================
// Parser Implementation
// ============================================================

export class MessengerParser {
  private ownerName: string;

  constructor(ownerName: string = 'Tem Noon') {
    this.ownerName = ownerName;
  }

  /**
   * Parse all Messenger threads from the Facebook export
   */
  async parseAll(options: MessengerParseOptions): Promise<MessengerParseResult> {
    const {
      exportPath,
      ownerName = this.ownerName,
      includeGroupChats = true,
      minMessages = 1,
      onProgress,
    } = options;

    const inboxPath = path.join(exportPath, 'your_facebook_activity', 'messages', 'inbox');
    const messages: ContentItem[] = [];
    const mediaFiles: string[] = [];
    const errors: string[] = [];
    let threadCount = 0;

    // Check if inbox exists
    if (!fs.existsSync(inboxPath)) {
      errors.push(`Inbox not found at: ${inboxPath}`);
      return { threads: 0, messages: [], mediaFiles: [], errors };
    }

    // Get all thread folders
    const threadFolders = fs.readdirSync(inboxPath).filter(f => {
      const stat = fs.statSync(path.join(inboxPath, f));
      return stat.isDirectory();
    });

    console.log(`📱 Found ${threadFolders.length} Messenger threads`);

    for (let i = 0; i < threadFolders.length; i++) {
      const threadFolder = threadFolders[i];
      const threadPath = path.join(inboxPath, threadFolder);

      onProgress?.(i + 1, threadFolders.length, threadFolder);

      try {
        // Find all message_*.json files in the thread
        const messageFiles = fs.readdirSync(threadPath)
          .filter(f => f.startsWith('message_') && f.endsWith('.json'))
          .sort(); // Ensures chronological order

        if (messageFiles.length === 0) continue;

        // Parse each message file
        let threadMessages: ContentItem[] = [];
        let threadTitle = '';
        let participants: string[] = [];

        for (const messageFile of messageFiles) {
          const filePath = path.join(threadPath, messageFile);
          const content = fs.readFileSync(filePath, 'utf-8');

          try {
            const thread: MessengerThread = JSON.parse(content);

            // Get thread info from first file
            if (threadTitle === '') {
              threadTitle = thread.title || this.inferThreadTitle(thread.participants);
              participants = thread.participants.map(p => p.name).filter(n => n);
            }

            // Skip group chats if requested
            if (!includeGroupChats && participants.length > 2) {
              continue;
            }

            // Convert messages to ContentItems
            for (const msg of thread.messages) {
              const contentItem = this.convertMessage(
                msg,
                threadFolder,
                threadTitle,
                participants,
                ownerName,
                exportPath
              );

              if (contentItem) {
                threadMessages.push(contentItem);

                // Collect media files
                if (msg.photos) {
                  mediaFiles.push(...msg.photos.map(p => path.join(exportPath, p.uri)));
                }
                if (msg.videos) {
                  mediaFiles.push(...msg.videos.map(v => path.join(exportPath, v.uri)));
                }
                if (msg.audio_files) {
                  mediaFiles.push(...msg.audio_files.map(a => path.join(exportPath, a.uri)));
                }
              }
            }
          } catch (parseError) {
            errors.push(`Failed to parse ${filePath}: ${parseError}`);
          }
        }

        // Only include threads with enough messages
        if (threadMessages.length >= minMessages) {
          messages.push(...threadMessages);
          threadCount++;
        }

      } catch (err) {
        errors.push(`Failed to process thread ${threadFolder}: ${err}`);
      }
    }

    console.log(`✅ Parsed ${threadCount} threads with ${messages.length} messages`);
    if (errors.length > 0) {
      console.log(`⚠️  ${errors.length} errors encountered`);
    }

    return {
      threads: threadCount,
      messages,
      mediaFiles,
      errors,
    };
  }

  /**
   * Convert a single Messenger message to ContentItem format
   */
  private convertMessage(
    msg: MessengerMessage,
    threadId: string,
    threadTitle: string,
    participants: string[],
    ownerName: string,
    exportPath: string
  ): ContentItem | null {
    // Skip empty messages (no content, no media)
    if (!msg.content && !msg.photos?.length && !msg.videos?.length && !msg.audio_files?.length && !msg.share) {
      return null;
    }

    // Skip unsent messages
    if (msg.is_unsent) {
      return null;
    }

    const isOwnMessage = msg.sender_name === ownerName ||
                         msg.sender_name.toLowerCase() === ownerName.toLowerCase();

    // Build message text
    let text = msg.content || '';

    // Add share info if present
    if (msg.share) {
      if (msg.share.share_text) {
        text += (text ? '\n\n' : '') + `[Shared: ${msg.share.share_text}]`;
      }
      if (msg.share.link) {
        text += (text ? '\n' : '') + msg.share.link;
      }
    }

    // Add call info if present
    if (msg.call_duration !== undefined) {
      const duration = Math.floor(msg.call_duration / 60);
      text = `[Call: ${duration} minutes]`;
    }

    // Collect media references
    const mediaRefs: string[] = [];
    if (msg.photos) {
      mediaRefs.push(...msg.photos.map(p => p.uri));
    }
    if (msg.videos) {
      mediaRefs.push(...msg.videos.map(v => v.uri));
    }
    if (msg.audio_files) {
      mediaRefs.push(...msg.audio_files.map(a => a.uri));
    }
    if (msg.sticker) {
      mediaRefs.push(msg.sticker.uri);
    }
    if (msg.gifs) {
      mediaRefs.push(...msg.gifs.map(g => g.uri));
    }

    // Generate unique ID
    const messageId = `fb_msg_${threadId}_${msg.timestamp_ms}`;

    // Build search text
    const searchText = [
      threadTitle,
      msg.sender_name,
      text,
    ].filter(Boolean).join(' ').toLowerCase();

    // Build context
    const otherParticipants = participants.filter(p => p !== ownerName && p !== msg.sender_name);
    const context = JSON.stringify({
      thread_title: threadTitle,
      participants: participants,
      other_participants: otherParticipants,
      is_group: participants.length > 2,
    });

    // Build metadata
    const metadata: any = {
      thread_path: threadId,
      participants: participants,
      is_group_chat: participants.length > 2,
    };

    if (msg.reactions?.length) {
      metadata.reactions = msg.reactions;
    }

    return {
      id: messageId,
      type: 'message',
      source: 'facebook',
      text: text || undefined,
      title: threadTitle,
      created_at: Math.floor(msg.timestamp_ms / 1000), // Convert to seconds
      author_name: msg.sender_name || 'Unknown',
      is_own_content: isOwnMessage,
      thread_id: `fb_thread_${threadId}`,
      context,
      media_refs: mediaRefs.length > 0 ? mediaRefs : undefined,
      media_count: mediaRefs.length || undefined,
      metadata,
      search_text: searchText,
    };
  }

  /**
   * Infer thread title from participants
   */
  private inferThreadTitle(participants: Array<{ name: string }>): string {
    const names = participants
      .map(p => p.name)
      .filter(n => n && n !== this.ownerName);

    if (names.length === 0) return 'Unknown Chat';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} & ${names.length - 1} others`;
  }

  /**
   * Get thread statistics without full parsing
   */
  async getThreadStats(exportPath: string): Promise<{
    totalThreads: number;
    oneOnOne: number;
    groupChats: number;
    estimatedMessages: number;
  }> {
    const inboxPath = path.join(exportPath, 'your_facebook_activity', 'messages', 'inbox');

    if (!fs.existsSync(inboxPath)) {
      return { totalThreads: 0, oneOnOne: 0, groupChats: 0, estimatedMessages: 0 };
    }

    const threadFolders = fs.readdirSync(inboxPath).filter(f => {
      const stat = fs.statSync(path.join(inboxPath, f));
      return stat.isDirectory();
    });

    let oneOnOne = 0;
    let groupChats = 0;
    let estimatedMessages = 0;

    for (const folder of threadFolders) {
      const threadPath = path.join(inboxPath, folder);
      const messageFiles = fs.readdirSync(threadPath)
        .filter(f => f.startsWith('message_') && f.endsWith('.json'));

      if (messageFiles.length === 0) continue;

      // Read first message file to get participant count
      try {
        const firstFile = path.join(threadPath, messageFiles[0]);
        const content = fs.readFileSync(firstFile, 'utf-8');
        const thread: MessengerThread = JSON.parse(content);

        if (thread.participants.length > 2) {
          groupChats++;
        } else {
          oneOnOne++;
        }

        estimatedMessages += thread.messages?.length || 0;
      } catch {
        // Skip malformed threads
      }
    }

    return {
      totalThreads: threadFolders.length,
      oneOnOne,
      groupChats,
      estimatedMessages,
    };
  }
}

export default MessengerParser;
