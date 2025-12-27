/**
 * Thinking Types - Curator Context and Decisions
 *
 * These types capture the curator's working memory:
 * - Decisions made during the curation process
 * - AUI notes and suggestions
 * - Concept graphs showing relationships
 *
 * "Thinking" is the meta-layer above content - how the curator
 * is understanding and organizing the material.
 */

// ═══════════════════════════════════════════════════════════════════
// THINKING DECISION - Record of Curator Choices
// ═══════════════════════════════════════════════════════════════════

/**
 * Types of decisions the curator can make
 */
export type DecisionType =
  | 'harvest' // Collecting passages from sources
  | 'cluster' // Grouping passages by theme
  | 'concept' // Identifying a concept/idea
  | 'order' // Deciding on sequence
  | 'structure' // Organizational decisions
  | 'edit' // Content editing decisions
  | 'curate'; // Approval/rejection decisions

/**
 * A decision made during the curation process.
 * Forms a decision log for provenance and learning.
 */
export interface ThinkingDecision {
  /** Unique identifier */
  id: string;

  /** When the decision was made */
  timestamp: number;

  /** Type of decision */
  type: DecisionType;

  /** Brief title */
  title: string;

  /** Detailed description */
  description: string;

  /** Additional structured details */
  details?: Record<string, unknown>;

  // ─────────────────────────────────────────────────────────────────
  // Provenance
  // ─────────────────────────────────────────────────────────────────

  /** Who initiated this decision */
  triggeredBy?: 'user' | 'aui' | 'system';

  /** Confidence score (0-1) for AUI decisions */
  confidence?: number;

  /** Was this decision reversed/undone? */
  reversed?: boolean;

  /** ID of decision that reversed this */
  reversedBy?: string;
}

// ═══════════════════════════════════════════════════════════════════
// AUI NOTE - Agent Observations and Suggestions
// ═══════════════════════════════════════════════════════════════════

/**
 * Types of AUI notes
 */
export type AUINodeType =
  | 'observation' // Something the AUI noticed
  | 'suggestion' // A recommendation
  | 'question' // Something to consider
  | 'reminder'; // Future action needed

/**
 * A note from the AUI (Agent-based Adaptive UI).
 * These capture the AUI's ongoing understanding.
 */
export interface AUINote {
  /** Unique identifier */
  id: string;

  /** When the note was created */
  timestamp: number;

  /** The note content */
  content: string;

  /** Type of note */
  type: AUINodeType;

  /** What this note relates to */
  relatedTo?: {
    type: 'passage' | 'chapter' | 'concept' | 'thread' | 'book';
    id: string;
  };

  /** Has this been addressed? */
  resolved: boolean;

  /** When it was resolved */
  resolvedAt?: number;

  /** How it was resolved */
  resolution?: string;
}

// ═══════════════════════════════════════════════════════════════════
// THINKING CONTEXT - Current Working State
// ═══════════════════════════════════════════════════════════════════

/**
 * The curator's current thinking state.
 * This is the "working memory" of the curation session.
 */
export interface ThinkingContext {
  /** Currently active thread */
  activeThread?: string;

  /** Currently focused chapter */
  currentChapter?: string;

  /** Recent search queries */
  recentQueries: string[];

  /** Concepts the curator has pinned for attention */
  pinnedConcepts: string[];

  /** AUI notes and observations */
  auiNotes: AUINote[];

  /** Concept graph (if built) */
  conceptGraph?: ConceptGraph;

  /** Session start time */
  sessionStart?: number;

  /** Last activity time */
  lastActivity?: number;
}

// ═══════════════════════════════════════════════════════════════════
// CONCEPT GRAPH - Relationship Visualization
// ═══════════════════════════════════════════════════════════════════

/**
 * Types of edges in the concept graph
 */
export type ConceptEdgeType =
  | 'depends-on' // A requires B
  | 'related-to' // A and B are related
  | 'contrasts-with' // A and B are in tension
  | 'leads-to' // A leads to B (temporal/logical)
  | 'part-of'; // A is part of B

/**
 * A node in the concept graph
 */
export interface ConceptNode {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Importance weight (for sizing/positioning) */
  weight: number;

  /** Associated thread (if any) */
  thread?: string;

  /** Description of the concept */
  description?: string;

  /** Passage IDs that exemplify this concept */
  exemplarPassages?: string[];
}

/**
 * An edge in the concept graph
 */
export interface ConceptEdge {
  /** Source node ID */
  from: string;

  /** Target node ID */
  to: string;

  /** Relationship type */
  type: ConceptEdgeType;

  /** Edge weight */
  weight?: number;

  /** Edge label (for display) */
  label?: string;
}

/**
 * A graph of concepts and their relationships.
 * Emerges from curation and helps organize the book.
 */
export interface ConceptGraph {
  /** Concept nodes */
  nodes: ConceptNode[];

  /** Relationships between concepts */
  edges: ConceptEdge[];

  /** When the graph was last updated */
  updatedAt?: number;

  /** Layout hints for visualization */
  layout?: {
    type: 'force' | 'hierarchical' | 'radial';
    frozen?: boolean;
    positions?: Record<string, { x: number; y: number }>;
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new empty thinking context
 */
export function createThinkingContext(): ThinkingContext {
  return {
    recentQueries: [],
    pinnedConcepts: [],
    auiNotes: [],
    sessionStart: Date.now(),
    lastActivity: Date.now(),
  };
}

/**
 * Add an AUI note to the context
 */
export function addAUINote(
  context: ThinkingContext,
  note: Omit<AUINote, 'id' | 'timestamp' | 'resolved'>
): AUINote {
  const newNote: AUINote = {
    ...note,
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    resolved: false,
  };
  context.auiNotes.push(newNote);
  return newNote;
}

/**
 * Get unresolved AUI notes
 */
export function getUnresolvedNotes(context: ThinkingContext): AUINote[] {
  return context.auiNotes.filter((note) => !note.resolved);
}

/**
 * Get notes related to a specific entity
 */
export function getNotesFor(
  context: ThinkingContext,
  entityType: 'passage' | 'chapter' | 'concept' | 'thread' | 'book',
  entityId: string
): AUINote[] {
  return context.auiNotes.filter(
    (note) =>
      note.relatedTo?.type === entityType && note.relatedTo?.id === entityId
  );
}
