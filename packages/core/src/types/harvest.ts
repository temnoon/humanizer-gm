/**
 * Harvest Types - Temporary Staging for Book Content
 *
 * A HarvestBucket is the intermediate staging area between:
 * - Archive semantic search results
 * - Curated passages in a BookProject
 *
 * This abstraction enables:
 * - Review before commit (don't pollute BookProject with noise)
 * - Batch operations (approve/reject multiple at once)
 * - AUI-driven harvesting with user oversight
 * - Deduplication and quality filtering
 */

import type { EntityMeta, EntityURI } from './entity.js';
import type { SourcePassage, HarvestConfig } from './passage.js';

// ═══════════════════════════════════════════════════════════════════
// HARVEST BUCKET - Temporary Staging Container
// ═══════════════════════════════════════════════════════════════════

/**
 * Harvest bucket lifecycle status
 */
export type HarvestStatus =
  | 'collecting'  // AUI is actively searching
  | 'reviewing'   // User is reviewing candidates
  | 'staged'      // Ready to commit to book
  | 'committed'   // Merged into BookProject (terminal)
  | 'discarded';  // Abandoned without committing (terminal)

/**
 * A temporary staging container for harvested passages.
 *
 * Lifecycle:
 * 1. AUI creates bucket for a thread/query
 * 2. AUI populates with search results (status: collecting)
 * 3. User reviews candidates (status: reviewing)
 * 4. User stages approved passages (status: staged)
 * 5. User commits to book (status: committed) - bucket can be deleted
 */
export interface HarvestBucket extends EntityMeta {
  type: 'harvest-bucket';

  /** URI of the parent book project */
  bookUri: EntityURI;

  /** URI of the thread this bucket is harvesting for (optional) */
  threadUri?: EntityURI;

  /** Current lifecycle status */
  status: HarvestStatus;

  // ─────────────────────────────────────────────────────────────────
  // Search Context
  // ─────────────────────────────────────────────────────────────────

  /** Semantic search queries used for this harvest */
  queries: string[];

  /** Configuration used for harvesting */
  config: HarvestConfig;

  /** Who initiated this harvest */
  initiatedBy: 'user' | 'aui';

  // ─────────────────────────────────────────────────────────────────
  // Passage Collections
  // ─────────────────────────────────────────────────────────────────

  /** All harvested passages (candidates before review) */
  candidates: SourcePassage[];

  /** Passages approved for staging */
  approved: SourcePassage[];

  /** Passages marked as gems (exceptional) */
  gems: SourcePassage[];

  /** Passages explicitly rejected */
  rejected: SourcePassage[];

  // ─────────────────────────────────────────────────────────────────
  // Quality Tracking
  // ─────────────────────────────────────────────────────────────────

  /** IDs of passages identified as duplicates */
  duplicateIds: string[];

  /** Source diversity statistics */
  sourceDiversity?: {
    /** Count by source type */
    bySource: Record<string, number>;
    /** Count by conversation/post ID */
    byOrigin: Record<string, number>;
    /** Whether diversity requirements are met */
    meetsRequirements: boolean;
  };

  // ─────────────────────────────────────────────────────────────────
  // Progress & Statistics
  // ─────────────────────────────────────────────────────────────────

  /** Statistics for this harvest */
  stats: HarvestStats;

  /** When harvest was started */
  startedAt: number;

  /** When harvest was completed (status changed from collecting) */
  completedAt?: number;

  /** When bucket was committed or discarded */
  finalizedAt?: number;
}

/**
 * Statistics for a harvest bucket
 */
export interface HarvestStats {
  /** Total candidates harvested */
  totalCandidates: number;

  /** Candidates reviewed so far */
  reviewed: number;

  /** Approved (including gems) */
  approved: number;

  /** Marked as gems */
  gems: number;

  /** Explicitly rejected */
  rejected: number;

  /** Identified as duplicates */
  duplicates: number;

  /** Average similarity score of candidates */
  avgSimilarity: number;

  /** Word count of approved passages */
  approvedWordCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// NARRATIVE ARC - AUI-Proposed Story Structure
// ═══════════════════════════════════════════════════════════════════

/**
 * Arc type (narrative structure pattern)
 */
export type ArcType =
  | 'linear'      // A → B → C progression
  | 'spiral'      // Return to themes at higher levels
  | 'dialectic'   // Thesis → Antithesis → Synthesis
  | 'mosaic'      // Non-linear thematic weaving
  | 'monomyth'    // Hero's journey pattern
  | 'custom';     // User-defined structure

/**
 * A proposed narrative arc for organizing book content.
 * AUI proposes, user approves/modifies.
 */
export interface NarrativeArc extends EntityMeta {
  type: 'narrative-arc';

  /** URI of the parent book project */
  bookUri: EntityURI;

  /** Type of narrative structure */
  arcType: ArcType;

  // ─────────────────────────────────────────────────────────────────
  // Content Structure
  // ─────────────────────────────────────────────────────────────────

  /** Core thesis/argument of the book */
  thesis: string;

  /** Major themes extracted from passages */
  themes: ArcTheme[];

  /** Proposed chapter structure */
  chapters: ChapterOutline[];

  // ─────────────────────────────────────────────────────────────────
  // Arc Shape (Pacing)
  // ─────────────────────────────────────────────────────────────────

  /** Opening strength (hooks reader?) 0-10 */
  openingStrength: number;

  /** Which chapter contains the climax/peak tension */
  climaxChapter?: number;

  /** Resolution quality 0-10 */
  resolutionQuality: number;

  // ─────────────────────────────────────────────────────────────────
  // Provenance & Status
  // ─────────────────────────────────────────────────────────────────

  /** Who proposed this arc */
  proposedBy: 'user' | 'aui';

  /** Evaluation status */
  evaluation: ArcEvaluation;

  /** AUI's rationale for this structure */
  rationale?: string;
}

/**
 * A theme within the narrative arc
 */
export interface ArcTheme {
  /** Theme identifier */
  id: string;

  /** Theme name */
  name: string;

  /** Description of the theme */
  description: string;

  /** Passage IDs that embody this theme */
  passageIds: string[];

  /** How distinct this theme is (0-1) */
  coherence: number;

  /** Relationships to other themes */
  relationships: ThemeRelationship[];
}

/**
 * Relationship between themes
 */
export interface ThemeRelationship {
  /** Target theme ID */
  targetThemeId: string;

  /** Type of relationship */
  type: 'depends-on' | 'contrasts-with' | 'leads-to' | 'part-of';

  /** Relationship strength (0-1) */
  strength: number;
}

/**
 * Chapter outline within an arc
 */
export interface ChapterOutline {
  /** Chapter number */
  number: number;

  /** Proposed title */
  title: string;

  /** Purpose/summary of this chapter */
  purpose: string;

  /** Primary theme ID */
  primaryThemeId: string;

  /** Passage IDs assigned to this chapter */
  passageIds: string[];

  /** Estimated word count */
  estimatedWordCount: number;

  /** Transition quality from previous chapter (0-10) */
  transitionFromPrevious?: number;
}

/**
 * Arc evaluation status
 */
export interface ArcEvaluation {
  /** Current status */
  status: 'pending' | 'approved' | 'rejected' | 'revised';

  /** When evaluated */
  evaluatedAt?: number;

  /** User's feedback/notes */
  feedback?: string;

  /** If revised, the revision notes */
  revisionNotes?: string;
}

// ═══════════════════════════════════════════════════════════════════
// PASSAGE LINK - Bidirectional Chapter-Passage Tracking
// ═══════════════════════════════════════════════════════════════════

/**
 * A link between a passage and its usage in a chapter.
 * Enables bidirectional navigation and orphan detection.
 */
export interface PassageLink {
  /** Unique link identifier */
  id: string;

  /** Passage ID */
  passageId: string;

  /** Chapter ID where passage is used */
  chapterId: string;

  /** Section ID within chapter (optional) */
  sectionId?: string;

  /** Position within section (for ordering) */
  position: number;

  /** How the passage is used */
  usageType: 'verbatim' | 'paraphrase' | 'inspiration' | 'reference';

  /** When this link was created */
  createdAt: number;

  /** Who created this link */
  createdBy: 'user' | 'aui';
}

// ═══════════════════════════════════════════════════════════════════
// GAP ANALYSIS - Missing Content Detection
// ═══════════════════════════════════════════════════════════════════

/**
 * A detected gap in the narrative
 */
export interface NarrativeGap {
  /** Gap identifier */
  id: string;

  /** Location of the gap */
  location: GapLocation;

  /** Type of gap */
  gapType: GapType;

  /** Description of what's missing */
  description: string;

  /** Priority level */
  priority: 'critical' | 'important' | 'nice-to-have';

  /** Suggested resolution */
  suggestion: GapSuggestion;

  /** Whether this gap has been addressed */
  resolved: boolean;

  /** How it was resolved */
  resolution?: string;
}

/**
 * Where in the book the gap exists
 */
export interface GapLocation {
  /** After this chapter */
  afterChapterId?: string;

  /** Between these two chapters */
  betweenChapterIds?: [string, string];

  /** At the very beginning */
  atBeginning?: boolean;

  /** At the very end */
  atEnd?: boolean;

  /** Within this chapter */
  withinChapterId?: string;
}

/**
 * Types of narrative gaps
 */
export type GapType =
  | 'conceptual'    // Missing explanation of key idea
  | 'transitional'  // Jarring jump between sections
  | 'emotional'     // Missing emotional beat
  | 'contextual'    // Reader lacks needed context
  | 'structural';   // Missing piece of arc

/**
 * Suggested way to fill a gap
 */
export interface GapSuggestion {
  /** Type of fill */
  fillType: 'existing-passage' | 'new-writing' | 'reorder' | 'bridge';

  /** Details of the suggestion */
  details: string;

  /** Passage IDs that might fill the gap (if existing-passage) */
  candidatePassageIds?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new harvest bucket
 */
export function createHarvestBucket(
  bookUri: EntityURI,
  queries: string[],
  options?: {
    threadUri?: EntityURI;
    config?: Partial<HarvestConfig>;
    initiatedBy?: 'user' | 'aui';
  }
): HarvestBucket {
  const id = `harvest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();

  return {
    id,
    uri: `harvest://${id}`,
    type: 'harvest-bucket',
    name: `Harvest ${new Date().toISOString().slice(0, 10)}`,
    createdAt: now,
    updatedAt: now,
    tags: [],
    bookUri,
    threadUri: options?.threadUri,
    status: 'collecting',
    queries,
    config: {
      queriesPerThread: 10,
      minWordCount: 50,
      maxWordCount: 500,
      minSimilarity: 0.65,
      dedupeByContent: true,
      dedupeThreshold: 0.9,
      ...options?.config,
    },
    initiatedBy: options?.initiatedBy || 'user',
    candidates: [],
    approved: [],
    gems: [],
    rejected: [],
    duplicateIds: [],
    stats: {
      totalCandidates: 0,
      reviewed: 0,
      approved: 0,
      gems: 0,
      rejected: 0,
      duplicates: 0,
      avgSimilarity: 0,
      approvedWordCount: 0,
    },
    startedAt: now,
  };
}

/**
 * Create a new narrative arc
 */
export function createNarrativeArc(
  bookUri: EntityURI,
  thesis: string,
  options?: {
    arcType?: ArcType;
    proposedBy?: 'user' | 'aui';
  }
): NarrativeArc {
  const id = `arc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();

  return {
    id,
    uri: `arc://${id}`,
    type: 'narrative-arc',
    name: 'Narrative Arc',
    createdAt: now,
    updatedAt: now,
    tags: [],
    bookUri,
    arcType: options?.arcType || 'linear',
    thesis,
    themes: [],
    chapters: [],
    openingStrength: 0,
    resolutionQuality: 0,
    proposedBy: options?.proposedBy || 'aui',
    evaluation: {
      status: 'pending',
    },
  };
}

/**
 * Create a passage link
 */
export function createPassageLink(
  passageId: string,
  chapterId: string,
  position: number,
  options?: {
    sectionId?: string;
    usageType?: PassageLink['usageType'];
    createdBy?: 'user' | 'aui';
  }
): PassageLink {
  return {
    id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    passageId,
    chapterId,
    sectionId: options?.sectionId,
    position,
    usageType: options?.usageType || 'verbatim',
    createdAt: Date.now(),
    createdBy: options?.createdBy || 'user',
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if a harvest bucket is in a terminal state
 */
export function isHarvestTerminal(bucket: HarvestBucket): boolean {
  return bucket.status === 'committed' || bucket.status === 'discarded';
}

/**
 * Check if a harvest bucket is ready to commit
 */
export function isHarvestReady(bucket: HarvestBucket): boolean {
  return bucket.status === 'staged' && bucket.approved.length > 0;
}

/**
 * Calculate harvest progress (0-100)
 */
export function getHarvestProgress(bucket: HarvestBucket): number {
  const total = bucket.candidates.length;
  if (total === 0) return 0;
  return Math.round((bucket.stats.reviewed / total) * 100);
}

/**
 * Get all approved passages (approved + gems)
 */
export function getAllApproved(bucket: HarvestBucket): SourcePassage[] {
  return [...bucket.approved, ...bucket.gems];
}

/**
 * Check if an arc is approved
 */
export function isArcApproved(arc: NarrativeArc): boolean {
  return arc.evaluation.status === 'approved';
}

/**
 * Get unlinked passages (passages not used in any chapter)
 */
export function getOrphanedPassages(
  passageIds: string[],
  links: PassageLink[]
): string[] {
  const linkedIds = new Set(links.map((l) => l.passageId));
  return passageIds.filter((id) => !linkedIds.has(id));
}

/**
 * Get passage usage count across chapters
 */
export function getPassageUsageCount(
  passageId: string,
  links: PassageLink[]
): number {
  return links.filter((l) => l.passageId === passageId).length;
}
