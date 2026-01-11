/**
 * AUI Tools - Module Index
 *
 * Central export point for all AUI tool functionality.
 * This provides the public API while the implementations are modularized.
 */

// Re-export types
export type {
  AUIToolResult,
  WorkspaceState,
  AUIContext,
  ParsedToolUse,
  BookProject,
  DraftChapter,
  SourcePassage,
  ArchiveContainer,
  SelectedFacebookMedia,
  SelectedFacebookContent,
  PinnedContent,
} from './types';

// Re-export parser functions
export { parseToolUses, cleanToolsFromResponse } from './parser';

// Re-export system prompt
export { AUI_BOOK_SYSTEM_PROMPT } from './system-prompt';
