/**
 * Unified Book Types
 *
 * This is the unified book system that merges:
 * - BookshelfService (URI-based references, rich Persona/Style)
 * - BookProjectService (rich curation, thinking, chapters)
 *
 * Key principles:
 * 1. URI-based references for all entities
 * 2. Rich curation with thinking context
 * 3. Pyramid summarization for "knowing" the book
 * 4. NPE-API integration for extraction
 */

import type { EntityMeta, EntityURI, SourceReference } from './entity.js';
import type {
  SourcePassage,
  BookThread,
  HarvestConfig,
  SourceConversation,
} from './passage.js';
import type { Persona, Style, BookProfile } from './profile.js';
import type { PyramidStructure } from './pyramid.js';
import type { ThinkingDecision, ThinkingContext } from './thinking.js';

// ═══════════════════════════════════════════════════════════════════
// BOOK PROJECT - The Unified Container
// ═══════════════════════════════════════════════════════════════════

/**
 * Book project status
 */
export type BookStatus =
  | 'planning' // Initial setup
  | 'harvesting' // Collecting passages
  | 'curating' // Reviewing and organizing
  | 'drafting' // Writing chapters
  | 'mastering' // Final polish
  | 'complete'; // Done

/**
 * Book type - distinguishes multi-chapter books from single-chapter papers
 * - book: Multi-chapter work with TOC (default)
 * - paper: Single-chapter work like essays or articles
 */
export type BookType = 'book' | 'paper';

/**
 * A Book Project - the main container for a book being created.
 *
 * This unified type combines:
 * - URI-based references (from BookshelfService)
 * - Rich curation/thinking (from BookProjectService)
 * - Pyramid summarization (NEW)
 * - Book profile (NEW)
 */
export interface BookProject extends EntityMeta {
  type: 'book';

  /** Book type: 'book' (multi-chapter with TOC) or 'paper' (single-chapter essay/article) */
  bookType?: BookType;

  /** Subtitle */
  subtitle?: string;

  /** Current status */
  status: BookStatus;

  // ─────────────────────────────────────────────────────────────────
  // References (URI-based)
  // ─────────────────────────────────────────────────────────────────

  /** References to personas used in this book */
  personaRefs: EntityURI[];

  /** References to styles used in this book */
  styleRefs: EntityURI[];

  // ─────────────────────────────────────────────────────────────────
  // Book Profile - "Knowing" the Book
  // ─────────────────────────────────────────────────────────────────

  /** Profile extracted from content (themes, philosophy, tone) */
  profile?: BookProfile;

  // ─────────────────────────────────────────────────────────────────
  // Content Structure
  // ─────────────────────────────────────────────────────────────────

  /** Thematic threads for organizing content */
  threads: BookThread[];

  /** Harvest configuration */
  harvestConfig?: HarvestConfig;

  /** References to harvested sources */
  sourceRefs: SourceReference[];

  /** Curated passages */
  passages: SourcePassage[];

  /** The actual chapters */
  chapters: DraftChapter[];

  // ─────────────────────────────────────────────────────────────────
  // Editorial
  // ─────────────────────────────────────────────────────────────────

  /** Editorial guidelines */
  editorial?: {
    principles?: string[];
    audience?: string;
    notes?: string;
  };

  // ─────────────────────────────────────────────────────────────────
  // Thinking/Curation Context
  // ─────────────────────────────────────────────────────────────────

  /** Thinking layer (decisions, context, notes) */
  thinking?: {
    decisions: ThinkingDecision[];
    context: ThinkingContext;
  };

  // ─────────────────────────────────────────────────────────────────
  // Pyramid Summarization
  // ─────────────────────────────────────────────────────────────────

  /** Pyramid summary structure */
  pyramid?: PyramidStructure;

  // ─────────────────────────────────────────────────────────────────
  // Statistics (cached)
  // ─────────────────────────────────────────────────────────────────

  /** Book statistics */
  stats: BookStats;

  // ─────────────────────────────────────────────────────────────────
  // Legacy structure (for backward compatibility)
  // TODO: Remove after migration
  // ─────────────────────────────────────────────────────────────────

  /**
   * @deprecated Use `sourceRefs`, `passages`, `threads` directly
   */
  sources?: {
    conversations: SourceConversation[];
    passages: SourcePassage[];
    threads: BookThread[];
  };

  /**
   * @deprecated Use `chapters` directly
   */
  drafts?: {
    chapters: DraftChapter[];
    outline?: string;
    introduction?: string;
  };
}

/**
 * Book statistics
 */
export interface BookStats {
  /** Total source references */
  totalSources: number;

  /** Total passages collected */
  totalPassages: number;

  /** Passages that have been approved */
  approvedPassages: number;

  /** Passages marked as gems */
  gems: number;

  /** Number of chapters */
  chapters: number;

  /** Total word count across chapters */
  wordCount: number;

  /** @deprecated Use totalSources instead */
  totalConversations?: number;
}

// ═══════════════════════════════════════════════════════════════════
// DRAFT CHAPTER - Chapter Content and Versions
// ═══════════════════════════════════════════════════════════════════

/**
 * Chapter status
 */
export type ChapterStatus = 'outline' | 'drafting' | 'revising' | 'complete';

/**
 * A draft chapter with version history.
 */
export interface DraftChapter {
  /** Unique identifier */
  id: string;

  /** Chapter number */
  number: number;

  /** Chapter title */
  title: string;

  /** Epigraph/opening quote */
  epigraph?: {
    text: string;
    source?: string;
  };

  /** Current content (markdown) */
  content: string;

  /** Word count */
  wordCount: number;

  /** Current version number */
  version: number;

  /** Version history */
  versions: DraftVersion[];

  /** Chapter status */
  status: ChapterStatus;

  /** Sections within the chapter */
  sections: ChapterSection[];

  /** Marginalia/notes */
  marginalia: Marginalia[];

  /** Writer notes - not included in final output, for production only */
  writerNotes?: string;

  /** Metadata */
  metadata: ChapterMetadata;

  /** References to passages used in this chapter */
  passageRefs: string[];
}

/**
 * A version of a chapter
 */
export interface DraftVersion {
  /** Version number */
  version: number;

  /** When this version was created */
  timestamp: number;

  /** Content at this version */
  content: string;

  /** Word count at this version */
  wordCount: number;

  /** Description of changes */
  changes: string;

  /** Who created this version */
  createdBy: 'user' | 'aui';
}

/**
 * A section within a chapter
 */
export interface ChapterSection {
  /** Unique identifier */
  id: string;

  /** Section title (optional) */
  title?: string;

  /** Start line in content */
  startLine: number;

  /** End line in content */
  endLine: number;

  /** Passages used in this section */
  passageIds: string[];
}

/**
 * Marginalia types
 */
export type MarginaliaType =
  | 'commentary' // Author's commentary
  | 'reference' // External reference
  | 'question' // Question to address
  | 'connection' // Connection to other content
  | 'todo'; // Action item

/**
 * A note in the margins
 */
export interface Marginalia {
  /** Unique identifier */
  id: string;

  /** Type of marginalia */
  type: MarginaliaType;

  /** The note text */
  text: string;

  /** Text this is anchored to (optional) */
  anchorText?: string;

  /** Related passage ID */
  passageId?: string;

  /** Related section ID */
  sectionId?: string;

  /** When created */
  createdAt: number;

  /** Who created */
  createdBy: 'user' | 'aui';
}

/**
 * Chapter metadata
 */
export interface ChapterMetadata {
  /** Who last edited */
  lastEditedBy: 'user' | 'aui';

  /** When last edited */
  lastEditedAt: number;

  /** Notes (key-value pairs) */
  notes?: Array<{
    key: string;
    value: string;
    timestamp: number;
  }>;

  /** AUI suggestions */
  auiSuggestions?: AUISuggestion[];
}

/**
 * An AUI suggestion for the chapter
 */
export interface AUISuggestion {
  /** Unique identifier */
  id: string;

  /** Type of suggestion */
  type: 'structure' | 'content' | 'style' | 'connection';

  /** Description of the suggestion */
  description: string;

  /** Whether the suggestion was applied */
  applied: boolean;

  /** When applied */
  appliedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════
// BOOKSHELF - Registry of All Entities
// ═══════════════════════════════════════════════════════════════════

/**
 * The Bookshelf is the top-level registry of all entities.
 */
export interface Bookshelf {
  /** All registered personas */
  personas: Map<EntityURI, Persona>;

  /** All registered styles */
  styles: Map<EntityURI, Style>;

  /** All book projects */
  books: Map<EntityURI, BookProject>;

  /** Index for efficient lookup */
  index: BookshelfIndex;
}

/**
 * Index for bookshelf lookup
 */
export interface BookshelfIndex {
  /** URIs by type */
  byType: {
    personas: EntityURI[];
    styles: EntityURI[];
    books: EntityURI[];
  };

  /** URIs by tag */
  byTag: Map<string, EntityURI[]>;

  /** URIs by author */
  byAuthor: Map<string, EntityURI[]>;
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFORMATION CONTEXT
// ═══════════════════════════════════════════════════════════════════

/**
 * Context for applying transformations.
 * References personas and styles by URI.
 */
export interface TransformationContext {
  /** Which persona to write as */
  personaRef?: EntityURI;

  /** Which style to apply */
  styleRef?: EntityURI;

  /** Which book this is for */
  bookRef?: EntityURI;

  /** Additional instructions */
  instructions?: string;
}

// ═══════════════════════════════════════════════════════════════════
// RESOLVED ENTITIES - For Display
// ═══════════════════════════════════════════════════════════════════

/**
 * A resolved persona (with full data, not just reference)
 */
export interface ResolvedPersona extends Persona {
  _resolved: true;
}

/**
 * A resolved style (with full data, not just reference)
 */
export interface ResolvedStyle extends Style {
  _resolved: true;
}

/**
 * A resolved book project (with embedded personas and styles)
 */
export interface ResolvedBookProject
  extends Omit<BookProject, 'personaRefs' | 'styleRefs'> {
  _resolved: true;
  personas: Persona[];
  styles: Style[];
}

// ═══════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════

/**
 * Type guard for BookProject
 */
export function isBookProject(entity: unknown): entity is BookProject {
  return (
    typeof entity === 'object' &&
    entity !== null &&
    (entity as BookProject).type === 'book'
  );
}

/**
 * Type guard for resolved entities
 */
export function isResolved<T extends { _resolved?: boolean }>(
  entity: T
): entity is T & { _resolved: true } {
  return entity._resolved === true;
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new empty book project
 */
export function createBookProject(
  name: string,
  author: string = 'unknown'
): BookProject {
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const authorSlug = author
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    id,
    uri: `book://${authorSlug}/${slug}`,
    type: 'book',
    name,
    author,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: [],
    status: 'planning',
    personaRefs: [],
    styleRefs: [],
    threads: [],
    sourceRefs: [],
    passages: [],
    chapters: [],
    stats: {
      totalSources: 0,
      totalPassages: 0,
      approvedPassages: 0,
      gems: 0,
      chapters: 0,
      wordCount: 0,
    },
  };
}

/**
 * Create a new draft chapter
 */
export function createDraftChapter(
  number: number,
  title: string
): DraftChapter {
  const id = `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();

  return {
    id,
    number,
    title,
    content: '',
    wordCount: 0,
    version: 1,
    versions: [],
    status: 'outline',
    sections: [],
    marginalia: [],
    metadata: {
      lastEditedBy: 'user',
      lastEditedAt: now,
    },
    passageRefs: [],
  };
}

/**
 * Create an empty bookshelf
 */
export function createBookshelf(): Bookshelf {
  return {
    personas: new Map(),
    styles: new Map(),
    books: new Map(),
    index: {
      byType: {
        personas: [],
        styles: [],
        books: [],
      },
      byTag: new Map(),
      byAuthor: new Map(),
    },
  };
}
