/**
 * Book Project Types - Re-exported from @humanizer/core
 *
 * This file re-exports the unified types from @humanizer/core
 * and adds UI-specific view state types.
 *
 * For new code, prefer importing directly from '@humanizer/core':
 *   import { BookProject, DraftChapter } from '@humanizer/core';
 */

// ═══════════════════════════════════════════════════════════════════
// RE-EXPORTS FROM @humanizer/core
// ═══════════════════════════════════════════════════════════════════

// Source/Passage types
export type {
  SourceConversation,
  SourcePassage,
  BookThread,
  CurationStatus,
} from '@humanizer/core';

// Thinking types
export type {
  ThinkingDecision,
  ThinkingContext,
  AUINote,
  ConceptGraph,
} from '@humanizer/core';

import type { DecisionType as _DecisionType } from '@humanizer/core';
export type DecisionType = _DecisionType;

// Draft/Chapter types
export type {
  DraftChapter,
  DraftVersion,
  ChapterSection,
  Marginalia,
  ChapterMetadata,
  AUISuggestion,
} from '@humanizer/core';

// Book types
export type {
  BookProject,
  BookStatus,
  BookStats,
} from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// LEGACY ALIASES - For backwards compatibility
// ═══════════════════════════════════════════════════════════════════

// SourceThread is now BookThread
export type { BookThread as SourceThread } from '@humanizer/core';

// DraftSection is now ChapterSection
export type { ChapterSection as DraftSection } from '@humanizer/core';

// DraftMetadata is now ChapterMetadata
export type { ChapterMetadata as DraftMetadata } from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// UI-SPECIFIC VIEW STATE (stays local)
// ═══════════════════════════════════════════════════════════════════

/**
 * Tabs available in the book project view
 */
export type BookProjectTab = 'sources' | 'thinking' | 'drafts' | 'profile';

/**
 * View state for the book project UI
 */
export interface BookProjectViewState {
  /** Currently active tab */
  activeTab: BookProjectTab;

  /** Sources view state */
  sourcesFilter: {
    thread: string | 'all';
    status: 'all' | 'unreviewed' | 'approved' | 'gem' | 'rejected';
    showConversations: boolean;
  };

  /** Expanded conversation IDs */
  expandedConversations: Set<string>;

  /** Currently selected passage */
  selectedPassage?: string;

  /** Thinking view filter */
  thinkingFilter: {
    decisionType: 'all' | DecisionType;
  };

  /** Currently selected chapter */
  selectedChapter?: string;

  /** Edit mode enabled */
  editMode: boolean;

  /** Show version history */
  showVersionHistory: boolean;

  /** Profile/Pyramid view state */
  pyramidView: {
    /** Currently selected pyramid level (0 = chunks, higher = summaries) */
    selectedLevel: number;
    /** Currently selected node ID (chunk or summary) */
    selectedNodeId?: string;
    /** Expanded summary IDs in the hierarchy view */
    expandedNodes: Set<string>;
  };
}

/**
 * Create initial view state
 */
export function createViewState(): BookProjectViewState {
  return {
    activeTab: 'sources',
    sourcesFilter: {
      thread: 'all',
      status: 'all',
      showConversations: true,
    },
    expandedConversations: new Set(),
    thinkingFilter: {
      decisionType: 'all',
    },
    editMode: false,
    showVersionHistory: false,
    pyramidView: {
      selectedLevel: 0,
      expandedNodes: new Set(),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// DEMO DATA - For development and testing
// ═══════════════════════════════════════════════════════════════════

import type { BookProject as CoreBookProject } from '@humanizer/core';

/**
 * Demo book project for testing
 */
export const DEMO_BOOK_PROJECT: CoreBookProject = {
  id: 'demo-lamain',
  uri: 'book://tem-noon/the-pulse-of-lamain',
  type: 'book',
  name: 'The Pulse of Lamain',
  subtitle: 'A Galactic Chronicle',
  description: 'Exploring the mysterious planet at the center of Tem Noon\'s Galaxy',
  author: 'tem-noon',
  createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  updatedAt: Date.now() - 1 * 60 * 60 * 1000,
  tags: ['sci-fi', 'worldbuilding'],
  status: 'curating',
  personaRefs: [],
  styleRefs: [],
  threads: [
    {
      id: 'tech',
      name: 'Technology',
      description: 'How the Lamish pulse works',
      color: '#3b82f6',
      queries: ['Lamain pulse technology', 'pulse regulator mechanics'],
      passageIds: [],
      passageCount: 8,
      avgSimilarity: 0.85,
    },
    {
      id: 'culture',
      name: 'Culture',
      description: 'Mythology and significance',
      color: '#8b5cf6',
      queries: ['Lamain cultural mythology', 'outer rim beliefs'],
      passageIds: [],
      passageCount: 12,
      avgSimilarity: 0.79,
    },
    {
      id: 'science',
      name: 'Science',
      description: 'Physics and debates',
      color: '#10b981',
      queries: ['pulse creation theory', 'galactic physics'],
      passageIds: [],
      passageCount: 6,
      avgSimilarity: 0.72,
    },
  ],
  sourceRefs: [],
  passages: [
    {
      id: 'p-1',
      sourceRef: {
        uri: 'source://chatgpt/conv-1',
        sourceType: 'chatgpt',
        label: 'Lamainian Technology',
        conversationId: 'conv-1',
        conversationTitle: 'Lamainian Technology',
      },
      text: 'The Lamainian pulse regulator operates on principles that challenge our understanding of spacetime. Unlike conventional drives, it doesn\'t move through space—it convinces space that it\'s already elsewhere.',
      wordCount: 42,
      role: 'assistant',
      timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
      harvestedBy: 'Lamain pulse technology',
      similarity: 0.92,
      curation: {
        status: 'gem',
        curatedBy: 'user',
        curatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        notes: 'Core concept - use in opening chapter',
      },
      tags: ['technology', 'physics'],
    },
  ],
  chapters: [
    {
      id: 'ch-1',
      number: 1,
      title: 'The Pulse Awakens',
      content: `# The Pulse Awakens

You don't hear the Lamish pulse. You *feel* it.

Not with your ears, or even your body in the conventional sense. It's deeper than that—a resonance that vibrates in the spaces between your thoughts, in the pauses between heartbeats.

The Lamainian pulse regulator operates on principles that challenge our understanding of spacetime. Unlike conventional drives, it doesn't move through space—it convinces space that it's already elsewhere.

---

*Work in progress. Need to bridge technology explanation with sensory experience.*
`,
      wordCount: 87,
      version: 2,
      versions: [],
      status: 'drafting',
      sections: [],
      marginalia: [],
      metadata: {
        lastEditedBy: 'user',
        lastEditedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      },
      passageRefs: ['p-1'],
    },
  ],
  thinking: {
    decisions: [
      {
        id: 'd-1',
        timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
        type: 'harvest',
        title: 'Initial harvest complete',
        description: 'Collected 5 conversations containing references to Lamain',
        triggeredBy: 'user',
      },
      {
        id: 'd-2',
        timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
        type: 'cluster',
        title: 'Identified 3 thematic threads',
        description: 'Technology, Culture, and Science emerge as distinct narrative threads',
        triggeredBy: 'aui',
        confidence: 0.87,
      },
    ],
    context: {
      activeThread: 'tech',
      recentQueries: ['Lamain pulse technology', 'galactic heartbeat'],
      pinnedConcepts: ['pulse-consciousness', 'spacetime-manipulation'],
      auiNotes: [
        {
          id: 'n-1',
          timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
          content: 'Consider opening with the sensory experience of the pulse before explaining the technology',
          type: 'suggestion',
          relatedTo: { type: 'chapter', id: 'ch-1' },
          resolved: false,
        },
      ],
    },
  },
  stats: {
    totalSources: 5,
    totalPassages: 26,
    approvedPassages: 14,
    gems: 3,
    chapters: 1,
    wordCount: 87,
  },
};
