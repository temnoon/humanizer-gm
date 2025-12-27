/**
 * Passage Types - Source Material and Curation
 *
 * A passage is an extracted piece of text from the archive that
 * has been curated for use in book projects.
 */

import type { EntityURI, SourceReference } from './entity.js';

// ═══════════════════════════════════════════════════════════════════
// SOURCE PASSAGE - Curated Text Extract
// ═══════════════════════════════════════════════════════════════════

/**
 * Curation status for a passage
 */
export type CurationStatus =
  | 'candidate' // Harvested but not reviewed
  | 'unreviewed' // Alias for candidate
  | 'approved' // Reviewed and approved
  | 'gem' // Exceptional passage
  | 'rejected'; // Not suitable

/**
 * A curated passage extracted from source material.
 * Combines harvest metadata with curation state.
 */
export interface SourcePassage {
  /** Unique identifier */
  id: string;

  /** Reference to original source */
  sourceRef: SourceReference;

  /** The extracted text */
  text: string;

  /** Word count */
  wordCount: number;

  /** Character range in original (if available) */
  range?: { start: number; end: number };

  // ─────────────────────────────────────────────────────────────────
  // Harvest metadata (from semantic search/collection)
  // ─────────────────────────────────────────────────────────────────

  /** Query that harvested this passage */
  harvestedBy?: string;

  /** Similarity score from semantic search (0-1) */
  similarity?: number;

  /** Role in original conversation (if from conversation) */
  role?: 'user' | 'assistant';

  /** Timestamp of original content */
  timestamp?: number;

  // ─────────────────────────────────────────────────────────────────
  // Curation metadata
  // ─────────────────────────────────────────────────────────────────

  curation: {
    /** Current curation status */
    status: CurationStatus;

    /** When curation occurred */
    curatedAt?: number;

    /** Who curated (user or AUI) */
    curatedBy?: 'user' | 'aui';

    /** Curator's notes */
    notes?: string;
  };

  /** Tags for organization */
  tags: string[];

  /** Which threads/themes this belongs to (URIs) */
  threadRefs?: EntityURI[];

  // ─────────────────────────────────────────────────────────────────
  // Legacy aliases (for backward compatibility)
  // TODO: Remove after migration
  // ─────────────────────────────────────────────────────────────────

  /** @deprecated Use `text` instead */
  content?: string;

  /** @deprecated Use `curation.status` instead */
  status?: CurationStatus;

  /** @deprecated Use `curation.notes` instead */
  curatorNotes?: string;

  /** @deprecated Use `sourceRef.conversationId` instead */
  conversationId?: string;

  /** @deprecated Use `sourceRef.conversationTitle` instead */
  conversationTitle?: string;
}

// ═══════════════════════════════════════════════════════════════════
// BOOK THREAD - Thematic Organization
// ═══════════════════════════════════════════════════════════════════

/**
 * A thematic thread within a book project.
 * Threads organize passages by theme and drive semantic search.
 */
export interface BookThread {
  /** Unique identifier */
  id: string;

  /** Thread name */
  name: string;

  /** Description of the theme */
  description?: string;

  /** Display color (hex or CSS color) */
  color: string;

  /** Semantic search queries for harvesting */
  queries: string[];

  /** Passage IDs assigned to this thread */
  passageIds: string[];

  // ─────────────────────────────────────────────────────────────────
  // Computed statistics (cached)
  // ─────────────────────────────────────────────────────────────────

  /** Number of passages in this thread */
  passageCount?: number;

  /** Average similarity score of passages */
  avgSimilarity?: number;
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE CONVERSATION - Archive Source
// ═══════════════════════════════════════════════════════════════════

/**
 * A conversation from the archive (ChatGPT, Facebook, etc.).
 * Used for displaying available sources.
 */
export interface SourceConversation {
  /** Conversation ID */
  conversationId: string;

  /** Conversation title */
  title: string;

  /** Timestamp of conversation */
  timestamp: number;

  /** Number of messages */
  messageCount: number;

  /** Total word count */
  wordCount: number;

  /** Preview text */
  preview: string;

  /** Source type */
  source: 'openai' | 'facebook' | 'notebook' | 'import';
}

// ═══════════════════════════════════════════════════════════════════
// HARVEST CONFIG - Collection Settings
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration for harvesting passages from sources
 */
export interface HarvestConfig {
  /** Number of results per query */
  queriesPerThread?: number;

  /** Minimum word count for passages */
  minWordCount?: number;

  /** Maximum word count for passages */
  maxWordCount?: number;

  /** Minimum similarity threshold */
  minSimilarity?: number;

  /** Deduplicate by content similarity */
  dedupeByContent?: boolean;

  /** Dedupe similarity threshold */
  dedupeThreshold?: number;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize legacy status values to unified CurationStatus
 */
export function normalizeCurationStatus(
  status: string
): CurationStatus {
  const statusMap: Record<string, CurationStatus> = {
    candidate: 'candidate',
    unreviewed: 'candidate',
    approved: 'approved',
    gem: 'gem',
    rejected: 'rejected',
  };
  return statusMap[status.toLowerCase()] || 'candidate';
}

/**
 * Check if a passage is approved (approved or gem)
 */
export function isPassageApproved(passage: SourcePassage): boolean {
  return (
    passage.curation.status === 'approved' ||
    passage.curation.status === 'gem'
  );
}

/**
 * Check if a passage is a gem
 */
export function isPassageGem(passage: SourcePassage): boolean {
  return passage.curation.status === 'gem';
}
