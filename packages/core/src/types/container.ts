/**
 * Unified Archive Container Types
 *
 * The ArchiveContainer is the universal selection type for the workspace.
 * Any archive item (conversation, message, post, media, document) can be
 * represented as a container and displayed in the workspace.
 *
 * This unifies:
 * - ChatGPT/Claude conversations and messages
 * - Facebook posts, comments, and media
 * - Book chapters, passages, and threads
 * - Filesystem documents (txt, md, docx, pdf)
 *
 * URI Patterns:
 * - archive://chatgpt/{conversationId}
 * - archive://chatgpt/{conversationId}/message/{messageId}
 * - archive://facebook/post/{postId}
 * - archive://facebook/comment/{commentId}
 * - archive://facebook/media/{mediaId}
 * - archive://book/{bookId}/chapter/{chapterId}
 * - archive://book/{bookId}/passage/{passageId}
 * - fs://{path}
 */

import type { EntityURI, SourceType, SourceReference } from './entity.js';

// ═══════════════════════════════════════════════════════════════════
// CONTAINER TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Types of containers that can be selected and displayed
 */
export type ContainerType =
  // Conversation sources
  | 'conversation'      // Full ChatGPT/Claude conversation
  | 'message'           // Single message from conversation
  // Social sources
  | 'post'              // Facebook post
  | 'comment'           // Facebook comment
  // Media
  | 'media'             // Image/video/audio file
  // Book project
  | 'chapter'           // Book chapter
  | 'passage'           // Book passage / curated text
  | 'thinking'          // Book thinking/decision
  | 'thread'            // Book thread (thematic collection)
  // Filesystem
  | 'document'          // Text/markdown/docx file
  | 'folder';           // Folder container

/**
 * Content type for the container's payload
 */
export type ContentType =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio';

/**
 * Preferred view mode for the container
 */
export type ViewMode =
  | 'text'      // Plain text rendering
  | 'markdown'  // Markdown with code/math
  | 'media'     // Image/video/audio player
  | 'book'      // Book editing view
  | 'graph'     // Network visualization
  | 'split'     // Side-by-side comparison
  | 'json';     // JSON tree view

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE SOURCE - Where Content Came From
// ═══════════════════════════════════════════════════════════════════

/**
 * Archive source type (aligned with existing SourceType but expanded)
 */
export type ArchiveSourceType =
  | 'chatgpt'
  | 'claude'
  | 'facebook'
  | 'notebook'
  | 'book'
  | 'filesystem'
  | 'import'
  | 'url';

/**
 * Source tracking for container origin
 */
export interface ArchiveSource {
  /** Source type */
  type: ArchiveSourceType;

  /** Original path/ID in source system */
  originalId?: string;

  /** Path to file/folder if filesystem */
  path?: string;

  /** API endpoint that provided this */
  endpoint?: string;

  /** Archive name/folder */
  archiveName?: string;

  /** Import timestamp */
  importedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════
// MEDIA REFERENCE - Linked Media Items
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to linked media (not embedded)
 */
export interface MediaReference {
  /** Media container URI */
  uri: EntityURI;

  /** Media type */
  mediaType: 'image' | 'video' | 'audio';

  /** File path for local access */
  filePath?: string;

  /** URL for remote access */
  url?: string;

  /** Thumbnail URL if available */
  thumbnailUrl?: string;

  /** Display filename */
  filename?: string;

  /** File size in bytes */
  fileSize?: number;

  /** Dimensions for images/video */
  width?: number;
  height?: number;

  /** Duration for audio/video (seconds) */
  duration?: number;

  /** Alt text / description */
  description?: string;
}

// ═══════════════════════════════════════════════════════════════════
// RELATED CONTAINER - Cross-References
// ═══════════════════════════════════════════════════════════════════

/**
 * Reference to a related container
 */
export interface RelatedContainer {
  /** Related container URI */
  uri: EntityURI;

  /** Type of relationship */
  relation:
    | 'parent'      // This is contained within that
    | 'child'       // That is contained within this
    | 'sibling'     // Same level in hierarchy
    | 'previous'    // Temporal predecessor
    | 'next'        // Temporal successor
    | 'references'  // This mentions that
    | 'mentioned-by' // That mentions this
    | 'similar'     // Semantically similar
    | 'version-of'; // Different version of same

  /** Preview text or label */
  label?: string;

  /** Relevance score (0-1) if applicable */
  score?: number;
}

// ═══════════════════════════════════════════════════════════════════
// CONTAINER CONTENT - The Payload
// ═══════════════════════════════════════════════════════════════════

/**
 * Container content (the actual payload)
 */
export interface ContainerContent {
  /** Raw content as stored/imported */
  raw: string;

  /** Preprocessed content for display (LaTeX fixed, artifacts unpacked) */
  rendered?: string;

  /** Content type */
  contentType: ContentType;

  /** For conversations: individual messages */
  messages?: ContainerMessage[];

  /** Extracted artifacts (code blocks, canvases, etc.) */
  artifacts?: ExtractedArtifact[];

  /** Extracted thinking blocks */
  thinking?: ThinkingBlock[];

  /** Embedded metadata from content */
  embeddedMeta?: Record<string, unknown>;
}

/**
 * Message within a conversation container
 */
export interface ContainerMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  rendered?: string;
  timestamp?: number;
  hasMedia?: boolean;
  media?: MediaReference[];
}

/**
 * Extracted artifact (code, canvas, image prompt, etc.)
 */
export interface ExtractedArtifact {
  id: string;
  type: 'code' | 'canvas' | 'artifact' | 'image-prompt' | 'json';
  title?: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Extracted thinking/reasoning block
 */
export interface ThinkingBlock {
  id: string;
  content: string;
  collapsed?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// CONTAINER METADATA
// ═══════════════════════════════════════════════════════════════════

/**
 * Container metadata
 */
export interface ContainerMeta {
  /** Display title */
  title: string;

  /** Creation timestamp (unix ms) */
  created: number;

  /** Last update timestamp (unix ms) */
  updated?: number;

  /** Author/creator */
  author?: string;

  /** Tags for organization */
  tags: string[];

  /** Word count */
  wordCount?: number;

  /** Character count */
  charCount?: number;

  /** Message count (for conversations) */
  messageCount?: number;

  /** Is this user's own content? */
  isOwnContent?: boolean;

  /** Additional format-specific metadata */
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// VIEW HINTS - UI Rendering Guidance
// ═══════════════════════════════════════════════════════════════════

/**
 * UI hints for rendering the container
 */
export interface ViewHints {
  /** Preferred view mode */
  preferredView: ViewMode;

  /** Can this content be edited? */
  allowEdit: boolean;

  /** Show floating metadata modal? */
  hasMetadataModal: boolean;

  /** Show in split view with original? */
  showOriginal?: boolean;

  /** Collapse long content? */
  collapsible?: boolean;

  /** Custom CSS class */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════
// THE UNIFIED CONTAINER
// ═══════════════════════════════════════════════════════════════════

/**
 * ArchiveContainer - The Universal Selection Type
 *
 * Any archive item can be represented as a container.
 * This is what gets selected and displayed in the workspace.
 */
export interface ArchiveContainer {
  // ─────────────────────────────────────────────────────────────────
  // Identity
  // ─────────────────────────────────────────────────────────────────

  /** Unique identifier */
  id: string;

  /** Stable URI for cross-referencing */
  uri: EntityURI;

  /** Container type */
  type: ContainerType;

  // ─────────────────────────────────────────────────────────────────
  // Content
  // ─────────────────────────────────────────────────────────────────

  /** The content payload */
  content: ContainerContent;

  // ─────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────

  /** Container metadata */
  meta: ContainerMeta;

  // ─────────────────────────────────────────────────────────────────
  // Source Tracking
  // ─────────────────────────────────────────────────────────────────

  /** Where this came from */
  source: ArchiveSource;

  // ─────────────────────────────────────────────────────────────────
  // Relations
  // ─────────────────────────────────────────────────────────────────

  /** Parent container URI (if nested) */
  parent?: EntityURI;

  /** Child container URIs (if has children) */
  children?: EntityURI[];

  /** Linked media items */
  media?: MediaReference[];

  /** Related containers (cross-references) */
  related?: RelatedContainer[];

  // ─────────────────────────────────────────────────────────────────
  // UI Hints
  // ─────────────────────────────────────────────────────────────────

  /** Rendering hints */
  viewHints?: ViewHints;
}

// ═══════════════════════════════════════════════════════════════════
// CONTAINER FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a container URI
 */
export function generateContainerURI(
  type: ContainerType,
  source: ArchiveSourceType,
  id: string,
  parentId?: string
): EntityURI {
  if (source === 'filesystem') {
    return `fs://${id}`;
  }

  if (parentId) {
    return `archive://${source}/${parentId}/${type}/${id}`;
  }

  return `archive://${source}/${type}/${id}`;
}

/**
 * Parse a container URI
 */
export function parseContainerURI(uri: EntityURI): {
  source: ArchiveSourceType;
  type: ContainerType;
  id: string;
  parentId?: string;
} | null {
  // Filesystem pattern: fs://path/to/file
  if (uri.startsWith('fs://')) {
    return {
      source: 'filesystem',
      type: 'document',
      id: uri.slice(5),
    };
  }

  // Archive pattern: archive://source/type/id or archive://source/parentId/type/id
  const archiveMatch = uri.match(/^archive:\/\/([^/]+)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
  if (archiveMatch) {
    const [, source, second, third, fourth] = archiveMatch;

    if (fourth) {
      // Has parent: archive://source/parentId/type/id
      return {
        source: source as ArchiveSourceType,
        type: third as ContainerType,
        id: fourth,
        parentId: second,
      };
    }

    // No parent: archive://source/type/id
    return {
      source: source as ArchiveSourceType,
      type: second as ContainerType,
      id: third,
    };
  }

  return null;
}

/**
 * Create default view hints based on container type
 */
export function getDefaultViewHints(type: ContainerType, contentType: ContentType): ViewHints {
  switch (type) {
    case 'media':
      return {
        preferredView: 'media',
        allowEdit: false,
        hasMetadataModal: true,
      };

    case 'conversation':
      return {
        preferredView: 'markdown',
        allowEdit: false,
        hasMetadataModal: true,
        collapsible: true,
      };

    case 'chapter':
    case 'passage':
      return {
        preferredView: 'book',
        allowEdit: true,
        hasMetadataModal: true,
      };

    case 'document':
      return {
        preferredView: contentType === 'markdown' ? 'markdown' : 'text',
        allowEdit: true,
        hasMetadataModal: true,
      };

    default:
      return {
        preferredView: 'markdown',
        allowEdit: true,
        hasMetadataModal: false,
      };
  }
}

/**
 * Check if container content needs preprocessing
 */
export function needsPreprocessing(content: string): boolean {
  // Check for ChatGPT-style LaTeX delimiters
  if (/\\\[|\\\]|\\\(|\\\)/.test(content)) {
    return true;
  }

  // Check for embedded JSON artifacts
  if (/```json\s*\n\s*\{[\s\S]*?"type"\s*:/.test(content)) {
    return true;
  }

  // Check for thinking blocks
  if (/<thinking>|<antThinking>/.test(content)) {
    return true;
  }

  return false;
}
