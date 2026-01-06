/**
 * Archive Service
 *
 * Client for the archive-server API.
 * Port is dynamically determined from Electron IPC or environment.
 * Includes container normalization for unified workspace display.
 */

import type {
  ArchiveConversation,
  FlatMessage,
  ConversationListResponse,
} from './types';

import {
  type ArchiveContainer,
  type ContainerContent,
  type ArchiveSource,
  getDefaultViewHints,
} from '@humanizer/core';

import { preprocessContentSync, needsPreprocessing } from '../content';
import { getArchiveServerUrl } from '../platform';

/**
 * Get the archive API base URL (async, cached after first call)
 */
async function getApiBase(): Promise<string> {
  return getArchiveServerUrl();
}

/**
 * Fetch conversations from the archive
 */
export async function fetchConversations(options?: {
  limit?: number;
  offset?: number;
  sortBy?: 'recent' | 'oldest' | 'length-desc' | 'length-asc' | 'messages-desc';
  hasMedia?: boolean;
  hasImages?: boolean;
  hasAudio?: boolean;
  minMessages?: number;
}): Promise<ConversationListResponse> {
  const params = new URLSearchParams();

  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.hasMedia !== undefined) params.set('hasMedia', String(options.hasMedia));
  if (options?.hasImages !== undefined) params.set('hasImages', String(options.hasImages));
  if (options?.hasAudio !== undefined) params.set('hasAudio', String(options.hasAudio));
  if (options?.minMessages !== undefined) params.set('minMessages', String(options.minMessages));

  const apiBase = await getApiBase();
  const url = `${apiBase}/api/conversations?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.statusText}`);
  }

  return response.json();
}

// Message part types from archive-server
interface MessagePart {
  type: 'text' | 'image' | 'audio' | 'file' | 'code' | 'execution_output';
  content?: string;
  url?: string;
  filename?: string;
  language?: string;
  asset_pointer?: string;
}

// API response for single conversation (archive-server pre-flattens messages)
interface ConversationResponse {
  id: string;
  title: string;
  folder: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | MessagePart[];  // Can be string (legacy) or array of parts
    created_at: number;
  }>;
  created_at: number;
  updated_at: number;
}

/**
 * Fetch a single conversation's messages
 * Archive-server pre-flattens the tree structure into a linear array
 */
export async function fetchConversation(folder: string): Promise<ConversationResponse> {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}/api/conversations/${encodeURIComponent(folder)}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Extract text content from message content parts
 * Includes markdown image references for media parts
 */
function extractTextContent(content: string | MessagePart[], archiveServerUrl?: string): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part.type === 'text') {
          return part.content || '';
        }
        if (part.type === 'code') {
          return `\`\`\`${part.language || ''}\n${part.content || ''}\n\`\`\``;
        }
        if (part.type === 'execution_output') {
          return `Output:\n\`\`\`\n${part.content || ''}\n\`\`\``;
        }
        if (part.type === 'image' && part.url) {
          // Generate markdown image with full URL
          const fullUrl = part.url.startsWith('/api/')
            ? `${archiveServerUrl || ''}${part.url}`
            : part.url;
          const alt = part.filename || 'Image';
          return `![${alt}](${fullUrl})`;
        }
        if (part.type === 'audio' && part.url) {
          const fullUrl = part.url.startsWith('/api/')
            ? `${archiveServerUrl || ''}${part.url}`
            : part.url;
          return `🔊 [Audio: ${part.filename || 'audio'}](${fullUrl})`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/**
 * Extract media URLs from message content parts
 */
function extractMediaUrls(content: string | MessagePart[]): string[] {
  if (typeof content === 'string' || !Array.isArray(content)) {
    return [];
  }
  return content
    .filter(part => (part.type === 'image' || part.type === 'audio') && part.url)
    .map(part => part.url!)
    .filter(Boolean);
}

/**
 * Check if content has media
 */
function contentHasMedia(content: string | MessagePart[]): boolean {
  if (typeof content === 'string' || !Array.isArray(content)) {
    return false;
  }
  return content.some(part => part.type === 'image' || part.type === 'audio' || part.type === 'file');
}

/**
 * Convert API response to FlatMessage array
 * The archive-server already flattens messages, so this is a simple mapping
 * @param archiveServerUrl - Base URL for constructing full image URLs
 */
export function getMessages(conv: ConversationResponse, limit = 50, archiveServerUrl?: string): FlatMessage[] {
  return conv.messages.slice(0, limit).map((msg, index) => ({
    id: msg.id,
    role: msg.role,
    content: extractTextContent(msg.content, archiveServerUrl),
    created_at: msg.created_at,
    has_media: contentHasMedia(msg.content),
    media_urls: extractMediaUrls(msg.content),
    index,
  }));
}

/**
 * Format Unix timestamp to readable date
 */
export function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get year-month grouping key from timestamp
 */
export function getYearMonth(timestamp: number): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });
}

/**
 * Group conversations by year-month
 */
export function groupConversationsByMonth(
  conversations: ArchiveConversation[]
): Map<string, ArchiveConversation[]> {
  const groups = new Map<string, ArchiveConversation[]>();

  for (const conv of conversations) {
    const key = getYearMonth(conv.created_at);
    const group = groups.get(key) || [];
    group.push(conv);
    groups.set(key, group);
  }

  return groups;
}

/**
 * Check if archive server is available
 */
export async function checkArchiveHealth(): Promise<boolean> {
  try {
    const apiBase = await getApiBase();
    const response = await fetch(`${apiBase}/api/archives/current`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get current archive info
 */
export async function getCurrentArchive(): Promise<{
  name: string;
  path: string;
  conversationCount: number;
} | null> {
  try {
    const apiBase = await getApiBase();
    const response = await fetch(`${apiBase}/api/archives/current`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTAINER NORMALIZATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert a conversation response to an ArchiveContainer
 */
export function conversationToContainer(
  conv: ConversationResponse,
  preprocess = true
): ArchiveContainer {
  // Combine all messages into one content block
  const rawContent = conv.messages
    .map(msg => `**${msg.role === 'user' ? 'You' : 'Assistant'}:**\n${msg.content}`)
    .join('\n\n---\n\n');

  // Preprocess if needed
  let rendered: string | undefined;
  let artifacts: ContainerContent['artifacts'];
  let thinking: ContainerContent['thinking'];

  if (preprocess && needsPreprocessing(rawContent)) {
    const result = preprocessContentSync(rawContent, 'conversation');
    rendered = result.content;
    artifacts = result.artifacts.map(a => ({
      id: a.id,
      type: a.type as 'code' | 'canvas' | 'artifact' | 'image-prompt' | 'json',
      title: a.title,
      content: a.content,
      language: a.language,
      metadata: a.metadata,
    }));
    thinking = result.thinking.map(t => ({
      id: t.id,
      content: t.content,
    }));
  }

  // Calculate word count
  const wordCount = rawContent.split(/\s+/).filter(w => w.length > 0).length;

  const container: ArchiveContainer = {
    id: conv.id,
    uri: `archive://chatgpt/conversation/${conv.id}`,
    type: 'conversation',
    content: {
      raw: rawContent,
      rendered,
      contentType: 'markdown',
      messages: conv.messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(part => part.content || '').join('\n'),
        timestamp: msg.created_at * 1000,
      })),
      artifacts,
      thinking,
    },
    meta: {
      title: conv.title || 'Untitled Conversation',
      created: conv.created_at * 1000,
      updated: conv.updated_at * 1000,
      tags: [],
      wordCount,
      messageCount: conv.messages.length,
    },
    source: {
      type: 'chatgpt',
      originalId: conv.folder,
    },
    viewHints: getDefaultViewHints('conversation', 'markdown'),
  };

  return container;
}

/**
 * Convert a single message to an ArchiveContainer
 */
export function messageToContainer(
  msg: FlatMessage,
  conversationId: string,
  conversationTitle?: string,
  preprocess = true
): ArchiveContainer {
  const rawContent = msg.content;

  let rendered: string | undefined;
  let artifacts: ContainerContent['artifacts'];
  let thinking: ContainerContent['thinking'];

  if (preprocess && needsPreprocessing(rawContent)) {
    const result = preprocessContentSync(rawContent, 'message');
    rendered = result.content;
    artifacts = result.artifacts.map(a => ({
      id: a.id,
      type: a.type as 'code' | 'canvas' | 'artifact' | 'image-prompt' | 'json',
      title: a.title,
      content: a.content,
      language: a.language,
      metadata: a.metadata,
    }));
    thinking = result.thinking.map(t => ({
      id: t.id,
      content: t.content,
    }));
  }

  const wordCount = rawContent.split(/\s+/).filter(w => w.length > 0).length;

  const container: ArchiveContainer = {
    id: msg.id,
    uri: `archive://chatgpt/conversation/${conversationId}/message/${msg.id}`,
    type: 'message',
    content: {
      raw: rawContent,
      rendered,
      contentType: 'markdown',
      artifacts,
      thinking,
    },
    meta: {
      title: conversationTitle
        ? `${msg.role === 'user' ? 'You' : 'Assistant'} - ${conversationTitle}`
        : (msg.role === 'user' ? 'Your Message' : 'Assistant Response'),
      created: msg.created_at * 1000,
      tags: [],
      wordCount,
      author: msg.role === 'user' ? 'You' : 'Assistant',
    },
    source: {
      type: 'chatgpt',
      originalId: conversationId,
    },
    parent: `archive://chatgpt/conversation/${conversationId}`,
    viewHints: getDefaultViewHints('message', 'markdown'),
  };

  return container;
}

/**
 * Facebook media item type (from archive/types.ts)
 */
interface FacebookMediaItem {
  id: string;
  file_path: string;
  filename: string;
  media_type: 'image' | 'video';
  file_size: number;
  width?: number;
  height?: number;
  created_at: number;
  description?: string;
  context?: {
    album?: string;
    post_title?: string;
  };
}

/**
 * Convert a Facebook media item to an ArchiveContainer
 */
export function facebookMediaToContainer(media: FacebookMediaItem): ArchiveContainer {
  const container: ArchiveContainer = {
    id: media.id,
    uri: `archive://facebook/media/${media.id}`,
    type: 'media',
    content: {
      raw: media.description || '',
      contentType: media.media_type === 'video' ? 'video' : 'image',
    },
    meta: {
      title: media.filename,
      created: media.created_at * 1000,
      tags: media.context?.album ? [media.context.album] : [],
      ...(media.context && {
        album: media.context.album,
        postTitle: media.context.post_title,
      }),
    },
    source: {
      type: 'facebook',
      originalId: media.id,
      path: media.file_path,
    },
    media: [{
      uri: `archive://facebook/media/${media.id}`,
      mediaType: media.media_type,
      filePath: media.file_path,
      filename: media.filename,
      fileSize: media.file_size,
      width: media.width,
      height: media.height,
      description: media.description,
    }],
    viewHints: {
      preferredView: 'media',
      allowEdit: false,
      hasMetadataModal: true,
    },
  };

  return container;
}

/**
 * Facebook content item type (from archive/types.ts)
 */
interface FacebookContentItem {
  id: string;
  type: 'post' | 'comment';
  text: string;
  title?: string;
  created_at: number;
  author_name?: string;
  is_own_content: boolean;
  media?: Array<{
    id: string;
    file_path: string;
    media_type: 'image' | 'video';
  }>;
  context?: string;
  metadata?: string;
}

/**
 * Convert a Facebook post/comment to an ArchiveContainer
 */
export function facebookContentToContainer(content: FacebookContentItem): ArchiveContainer {
  const container: ArchiveContainer = {
    id: content.id,
    uri: `archive://facebook/${content.type}/${content.id}`,
    type: content.type,
    content: {
      raw: content.text,
      contentType: 'text',
    },
    meta: {
      title: content.title || (content.type === 'post' ? 'Facebook Post' : 'Facebook Comment'),
      created: content.created_at * 1000,
      tags: [],
      author: content.author_name,
      isOwnContent: content.is_own_content,
    },
    source: {
      type: 'facebook',
      originalId: content.id,
    },
    media: content.media?.map(m => ({
      uri: `archive://facebook/media/${m.id}`,
      mediaType: m.media_type,
      filePath: m.file_path,
    })),
    viewHints: getDefaultViewHints(content.type, 'text'),
  };

  return container;
}

/**
 * Create a document container from raw text/markdown
 */
export function textToContainer(
  id: string,
  content: string,
  title: string,
  source: ArchiveSource,
  preprocess = true
): ArchiveContainer {
  let rendered: string | undefined;
  let artifacts: ContainerContent['artifacts'];
  let thinking: ContainerContent['thinking'];

  if (preprocess && needsPreprocessing(content)) {
    const result = preprocessContentSync(content, 'document');
    rendered = result.content;
    artifacts = result.artifacts.map(a => ({
      id: a.id,
      type: a.type as 'code' | 'canvas' | 'artifact' | 'image-prompt' | 'json',
      title: a.title,
      content: a.content,
      language: a.language,
      metadata: a.metadata,
    }));
    thinking = result.thinking.map(t => ({
      id: t.id,
      content: t.content,
    }));
  }

  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

  const container: ArchiveContainer = {
    id,
    uri: source.type === 'filesystem' && source.path
      ? `fs://${source.path}`
      : `archive://${source.type}/document/${id}`,
    type: 'document',
    content: {
      raw: content,
      rendered,
      contentType: 'markdown',
      artifacts,
      thinking,
    },
    meta: {
      title,
      created: Date.now(),
      tags: [],
      wordCount,
    },
    source,
    viewHints: getDefaultViewHints('document', 'markdown'),
  };

  return container;
}
