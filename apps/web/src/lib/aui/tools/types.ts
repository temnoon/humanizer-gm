/**
 * AUI Tools - Type Definitions
 *
 * Central type definitions for all AUI tool operations.
 * This file has no internal dependencies and is imported by all other tools modules.
 */

import type { BookProject, DraftChapter, SourcePassage } from '../../../components/archive/book-project/types';
import type { ArchiveContainer } from '@humanizer/core';
import type { SelectedFacebookMedia, SelectedFacebookContent } from '../../../components/archive/types';
import type { PinnedContent } from '../../buffer/pins';

// ═══════════════════════════════════════════════════════════════════
// TOOL RESULT
// ═══════════════════════════════════════════════════════════════════

export interface AUIToolResult {
  success: boolean;
  message?: string;
  content?: string;
  data?: unknown;
  error?: string;

  /**
   * Teaching output - shows the user how to do this themselves
   * Following the "Teach By Doing" philosophy
   */
  teaching?: {
    /** What this action accomplished */
    whatHappened: string;
    /** GUI path to do this manually */
    guiPath?: string[];
    /** Command/shortcut if available */
    shortcut?: string;
    /** Explanation of why this matters */
    why?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// WORKSPACE STATE
// ═══════════════════════════════════════════════════════════════════

/** Workspace state - what's currently displayed */
export interface WorkspaceState {
  /** Current text content in the buffer */
  bufferContent: string | null;
  /** Buffer name/title */
  bufferName: string | null;
  /** Selected Facebook media (if viewing media) - legacy */
  selectedMedia: SelectedFacebookMedia | null;
  /** Selected Facebook content (if viewing post/comment) - legacy */
  selectedContent: SelectedFacebookContent | null;
  /** Current view mode */
  viewMode: 'text' | 'media' | 'content' | 'graph' | 'book';
  /** Currently selected content container (unified) */
  selectedContainer: ArchiveContainer | null;
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT
// ═══════════════════════════════════════════════════════════════════

export interface AUIContext {
  // Book operations - supports both old (activeProject) and new (activeBook) APIs
  activeProject?: BookProject | null;
  activeBook?: BookProject | null;
  createProject?: (name: string, subtitle?: string) => BookProject;
  updateChapter: (chapterId: string, content: string, changes?: string) => void;
  createChapter: (title: string, content?: string) => DraftChapter | null;
  deleteChapter: (chapterId: string) => void;
  renderBook: () => string;
  getChapter: (chapterId: string) => DraftChapter | null | undefined;

  // Passage operations
  addPassage?: (passage: {
    content: string;
    conversationId?: string;
    conversationTitle: string;
    role?: 'user' | 'assistant';
    tags?: string[];
  }) => SourcePassage | null;
  updatePassage?: (passageId: string, updates: Partial<SourcePassage>) => void;
  getPassages?: () => SourcePassage[];

  // Workspace state
  workspace?: WorkspaceState;

  // Pinned content (Items 9-12: tool integration with pins)
  pinnedContent?: PinnedContent[];
}

// ═══════════════════════════════════════════════════════════════════
// PARSED TOOL USE
// ═══════════════════════════════════════════════════════════════════

export interface ParsedToolUse {
  name: string;
  params: Record<string, unknown>;
  raw: string;
}

// Re-export external types for convenience
export type { BookProject, DraftChapter, SourcePassage };
export type { ArchiveContainer };
export type { SelectedFacebookMedia, SelectedFacebookContent };
export type { PinnedContent };
