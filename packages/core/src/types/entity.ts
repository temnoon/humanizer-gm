/**
 * Entity Base Types - URI-Based Reference System
 *
 * Every shareable entity in Humanizer has a stable URI for cross-referencing.
 * URI Patterns:
 * - persona://author/slug
 * - style://author/slug
 * - book://author/slug
 * - source://chatgpt/{conversationId}
 * - source://notebook/{pageId}
 * - source://file/{path}
 */

// ═══════════════════════════════════════════════════════════════════
// URI & BASE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * URI reference to a shareable entity
 * Pattern: {type}://{author}/{slug}
 */
export type EntityURI = string;

/**
 * Entity types that can have URIs
 */
export type EntityType = 'persona' | 'style' | 'book' | 'source' | 'thread';

/**
 * Common metadata for all entities
 */
export interface EntityMeta {
  /** Unique identifier (for internal use) */
  id: string;

  /** Stable URI for cross-referencing */
  uri: EntityURI;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Author/owner of this entity */
  author?: string;

  /** Creation timestamp (ms since epoch) */
  createdAt: number;

  /** Last update timestamp (ms since epoch) */
  updatedAt: number;

  /** Tags for organization and discovery */
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE REFERENCE - Points to Raw Material
// ═══════════════════════════════════════════════════════════════════

/**
 * Source types supported in the archive
 */
export type SourceType =
  | 'chatgpt'
  | 'facebook'
  | 'notebook'
  | 'file'
  | 'url'
  | 'passage'
  | 'import';

/**
 * Reference to source material (NOT embedded content).
 * This is a pointer, not the content itself.
 */
export interface SourceReference {
  /** URI pattern: source://{type}/{id} */
  uri: EntityURI;

  /** Source type */
  sourceType: SourceType;

  /** Human-readable label */
  label?: string;

  /** Timestamp if available */
  timestamp?: number;

  /** Preview/excerpt (cached, not authoritative) */
  preview?: string;

  /** Conversation title if from conversation */
  conversationTitle?: string;

  /** Conversation ID if from conversation */
  conversationId?: string;

  /** Conversation folder name (for API calls) */
  conversationFolder?: string;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a URI for an entity
 */
export function generateURI(
  type: EntityType,
  author: string,
  name: string
): EntityURI {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const authorSlug = author
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${type}://${authorSlug}/${slug}`;
}

/**
 * Generate a source URI
 */
export function generateSourceURI(type: SourceType, id: string): EntityURI {
  return `source://${type}/${id}`;
}

/**
 * Parse a URI into its components
 */
export function parseURI(uri: EntityURI): {
  type: string;
  author?: string;
  slug: string;
} | null {
  const match = uri.match(/^([^:]+):\/\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;

  const [, type, first, second] = match;

  // source://type/id has different structure
  if (type === 'source') {
    return { type: first, slug: second || first };
  }

  return {
    type,
    author: first,
    slug: second || first,
  };
}

/**
 * Check if a string is a valid entity URI
 */
export function isValidURI(uri: string): uri is EntityURI {
  return /^[a-z]+:\/\/[^/]+/.test(uri);
}
