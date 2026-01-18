/**
 * Universal Content Graph (UCG) - Core Type Definitions
 *
 * A single, universal content interchange format that all sources normalize to.
 * New formats require only adapters, never schema changes.
 *
 * Principles:
 * - One Content Type: Every piece of content becomes a ContentNode
 * - Adapters Over Tables: New format = new adapter function, not new table
 * - Content Addressing: Hash-based identity enables deduplication and integrity
 * - Link Graph: All relationships are explicit, bidirectional, traversable
 * - Version Control: Every mutation creates a new version, history is preserved
 * - Derivatives Track Lineage: Transformations link back to source
 */

// =============================================================================
// CONTENT NODE - The Universal Content Type
// =============================================================================

/**
 * ContentNode - The universal content interchange type
 *
 * Every piece of content in the system, regardless of origin,
 * is stored as a ContentNode. This is the ONLY content storage type.
 */
export interface ContentNode {
  // === IDENTITY ===
  /** UUID for this version */
  id: string;

  /** SHA-256 of content (for deduplication) */
  contentHash: string;

  /** Canonical URI: content://{source}/{path} */
  uri: string;

  // === CONTENT ===
  content: ContentNodeContent;

  // === METADATA ===
  metadata: ContentNodeMetadata;

  // === SOURCE TRACKING ===
  source: ContentNodeSource;

  // === VERSION CONTROL ===
  version: ContentNodeVersion;

  // === LINK ANCHORS ===
  /** Positions within content that can be linked to/from */
  anchors?: ContentAnchor[];
}

/**
 * Content payload - the actual content data
 */
export interface ContentNodeContent {
  /** Plain text (always present, for tools) */
  text: string;

  /** Original format for rendering */
  format: ContentFormat;

  /** Pre-rendered HTML/markdown if needed */
  rendered?: string;

  /** For non-text content */
  binary?: {
    /** Reference to blob storage (SHA-256 hash) */
    hash: string;
    /** MIME type of the binary content */
    mimeType: string;
  };
}

/**
 * Metadata about the content
 */
export interface ContentNodeMetadata {
  /** Human-readable title */
  title?: string;

  /** Author/creator of the content */
  author?: string;

  /** Original creation time (ms since epoch) */
  createdAt: number;

  /** When imported to UCG (ms since epoch) */
  importedAt: number;

  /** Word count */
  wordCount: number;

  /** Detected or specified language */
  language?: string;

  /** User-applied tags */
  tags: string[];

  /** Source-specific metadata preserved as-is */
  sourceMetadata: Record<string, unknown>;
}

/**
 * Source tracking - where the content came from
 */
export interface ContentNodeSource {
  /** Source type identifier */
  type: SourceType;

  /** Which adapter created this */
  adapter: string;

  /** ID in source system */
  originalId?: string;

  /** Path/location in source */
  originalPath?: string;

  /** Which import job */
  importBatch?: string;
}

/**
 * Version control - track content evolution
 */
export interface ContentNodeVersion {
  /** Monotonic version number */
  number: number;

  /** Previous version (if edited) */
  parentId?: string;

  /** Original import node */
  rootId: string;

  /** What created this version */
  operation?: string;

  /** Who/what made the change */
  operatorId?: string;
}

/**
 * Anchor point within content for fine-grained linking
 */
export interface ContentAnchor {
  /** Anchor identifier within this node */
  id: string;

  /** Character offset start */
  start: number;

  /** Character offset end */
  end: number;

  /** Anchor type/purpose */
  type: 'heading' | 'quote' | 'selection' | 'semantic' | 'custom';

  /** Optional label for this anchor */
  label?: string;
}

// =============================================================================
// CONTENT FORMATS
// =============================================================================

/**
 * Supported content formats
 */
export type ContentFormat =
  | 'text'           // Plain text
  | 'markdown'       // Markdown
  | 'html'           // HTML
  | 'latex'          // LaTeX
  | 'json'           // Structured JSON
  | 'code'           // Source code (with language in metadata)
  | 'conversation'   // Chat format (messages array in sourceMetadata)
  | 'binary';        // Non-text (image, audio, video, PDF)

// =============================================================================
// SOURCE TYPES
// =============================================================================

/**
 * Known source types for UCG content
 * This extends the base SourceType from entity.ts with additional content-specific types
 */
export type ContentSourceType =
  // AI Assistants
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  // Social Media
  | 'facebook-post'
  | 'facebook-comment'
  | 'facebook-message'
  | 'twitter'
  | 'mastodon'
  // Communication
  | 'discord'
  | 'slack'
  | 'email'
  // Documents
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'docx'
  | 'html'
  | 'epub'
  // Notes
  | 'notebook'       // Apple Notes, etc.
  | 'obsidian'
  | 'notion'
  | 'roam'
  // Other
  | 'rss'
  | 'transform'      // Created by transformation
  | 'compose'        // User-written
  | 'import'         // Generic import
  | 'facebook'       // Generic Facebook (for entity compat)
  | 'file'           // Generic file (for entity compat)
  | 'url'            // URL import (for entity compat)
  | 'passage'        // Passage (for entity compat)
  | 'unknown';

// Re-export as SourceType for backwards compatibility
export type SourceType = ContentSourceType;

// =============================================================================
// CONTENT LINK - Bidirectional Relationships
// =============================================================================

/**
 * ContentLink - Explicit relationship between content nodes
 *
 * All links are stored with both directions for efficient traversal.
 */
export interface ContentLink {
  /** Unique identifier */
  id: string;

  /** Source ContentNode id */
  sourceId: string;

  /** Target ContentNode id */
  targetId: string;

  /** Link semantics */
  type: LinkType;

  /** 0-1 for weighted relationships */
  strength?: number;

  /** Position within source content */
  sourceAnchor?: LinkAnchor;

  /** Position within target content */
  targetAnchor?: LinkAnchor;

  /** When link was created (ms since epoch) */
  createdAt: number;

  /** User or system identifier */
  createdBy?: string;

  /** Additional link metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Anchor position within a content node
 */
export interface LinkAnchor {
  /** Character offset start */
  start: number;

  /** Character offset end */
  end: number;

  /** Snippet for verification */
  text?: string;
}

/**
 * Types of relationships between content nodes
 */
export type LinkType =
  // Structural
  | 'parent'           // Hierarchical containment
  | 'child'            // Child of parent
  | 'sibling'          // Same level

  // Derivation
  | 'derived-from'     // This was created from that (transformation)
  | 'version-of'       // This is a newer version of that
  | 'fork-of'          // Branched from

  // Reference
  | 'references'       // Explicit citation/quote
  | 'responds-to'      // Reply/response relationship
  | 'related-to'       // Semantic similarity (auto-computed)

  // Curation
  | 'harvested-into'   // Content harvested into a book
  | 'placed-in'        // Content placed in chapter

  // Temporal
  | 'follows'          // Comes after in sequence
  | 'precedes';        // Comes before

// =============================================================================
// CONTENT BLOB - Binary Storage
// =============================================================================

/**
 * Binary blob storage for non-text content
 */
export interface ContentBlob {
  /** SHA-256 hash (primary key) */
  hash: string;

  /** Binary data */
  data: Uint8Array;

  /** MIME type */
  mimeType: string;

  /** Size in bytes */
  size: number;

  /** When stored (ms since epoch) */
  createdAt: number;
}

// =============================================================================
// HELPER TYPES
// =============================================================================

/**
 * Options for creating a new ContentNode
 */
export interface CreateContentNodeOptions {
  /** Plain text content */
  text: string;

  /** Content format */
  format?: ContentFormat;

  /** Pre-rendered content */
  rendered?: string;

  /** Title */
  title?: string;

  /** Author */
  author?: string;

  /** Original creation time */
  createdAt?: number;

  /** Tags */
  tags?: string[];

  /** Source type */
  sourceType: SourceType;

  /** Adapter name */
  adapter?: string;

  /** Original ID in source system */
  originalId?: string;

  /** Original path */
  originalPath?: string;

  /** Import batch ID */
  importBatch?: string;

  /** Source-specific metadata */
  sourceMetadata?: Record<string, unknown>;
}

/**
 * Options for creating a new ContentLink
 */
export interface CreateContentLinkOptions {
  /** Source node ID */
  sourceId: string;

  /** Target node ID */
  targetId: string;

  /** Link type */
  type: LinkType;

  /** Link strength (0-1) */
  strength?: number;

  /** Source anchor */
  sourceAnchor?: LinkAnchor;

  /** Target anchor */
  targetAnchor?: LinkAnchor;

  /** Creator identifier */
  createdBy?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query options for retrieving content nodes
 */
export interface ContentNodeQuery {
  /** Filter by source type */
  sourceType?: SourceType | SourceType[];

  /** Filter by tags (AND) */
  tags?: string[];

  /** Filter by date range */
  dateRange?: {
    start?: number;
    end?: number;
  };

  /** Full-text search query */
  searchQuery?: string;

  /** Limit results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Order by field */
  orderBy?: 'createdAt' | 'importedAt' | 'title' | 'wordCount';

  /** Order direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Query options for retrieving links
 */
export interface ContentLinkQuery {
  /** Filter by node ID (source or target) */
  nodeId?: string;

  /** Filter by link type */
  type?: LinkType | LinkType[];

  /** Only links FROM this node */
  direction?: 'outgoing' | 'incoming' | 'both';

  /** Minimum strength */
  minStrength?: number;

  /** Limit results */
  limit?: number;
}

/**
 * Version history entry
 */
export interface ContentVersion {
  /** Version ID */
  id: string;

  /** Version number */
  number: number;

  /** Previous version ID */
  parentId?: string;

  /** What operation created this version */
  operation?: string;

  /** Who created this version */
  operatorId?: string;

  /** When created */
  createdAt: number;

  /** Summary of changes */
  changeSummary?: string;
}

/**
 * Lineage information for a content node
 */
export interface ContentLineage {
  /** The content node */
  node: ContentNode;

  /** All nodes this was derived from (recursive) */
  ancestors: ContentNode[];

  /** All nodes derived from this (recursive) */
  descendants: ContentNode[];

  /** Version history */
  versions: ContentVersion[];
}

// =============================================================================
// URI HELPERS
// =============================================================================

/**
 * Generate a content URI
 */
export function generateContentURI(sourceType: SourceType, path: string): string {
  return `content://${sourceType}/${path}`;
}

/**
 * Parse a content URI
 */
export function parseContentURI(uri: string): { sourceType: string; path: string } | null {
  const match = uri.match(/^content:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { sourceType: match[1], path: match[2] };
}

/**
 * Check if a string is a valid content URI
 */
export function isValidContentURI(uri: string): boolean {
  return /^content:\/\/[^/]+\/.+$/.test(uri);
}
