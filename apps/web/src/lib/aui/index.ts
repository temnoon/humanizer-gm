/**
 * AUI Module
 *
 * AI assistant tools and utilities for the Agentic User Interface
 *
 * Features:
 * - Tool execution (36 tools for search, transform, book-building)
 * - "Show Don't Tell" animation system
 * - Settings persistence
 * - Chat archiving (conversations become searchable content)
 */

// Tools
export {
  parseToolUses,
  cleanToolsFromResponse,
  executeTool,
  executeAllTools,
  AUI_BOOK_SYSTEM_PROMPT,
  type AUIToolResult,
  type AUIContext,
  type ParsedToolUse,
  type WorkspaceState,
} from './tools';

// Animator - "Show Don't Tell" system
export {
  auiAnimator,
  teachingToAnimation,
  ELEMENT_SELECTORS,
  AUIAnimator,
  type AnimationStep,
  type AnimationSequence,
  type AnimatorState,
  type AUIAnimatorAPI,
} from './animator';

// Settings persistence
export {
  loadAUISettings,
  saveAUISettings,
  updateAUISettings,
  resetAUISettings,
  describeSettings,
  isAnimationEnabled,
  getAnimationSpeed,
  useAUISettings,
  type AUISettings,
  type SearchSettings,
  type HumanizeSettings,
  type PersonaSettings,
  type StyleSettings,
  type AnimationSettings,
  type ArchiveSettings,
} from './settings';

// Context provider - INTEGRATED Dec 27, 2025
export {
  AUIProvider,
  useAUI,
  useAUIChat,
  useAUIAnimation,
  useAUISettingsContext,
  type ChatMessage,
  type AUIConversation,
  type AUIState,
  type AUIContextValue,
} from './AUIContext';

// Re-export PinnedContent for convenience
export type { PinnedContent } from '../buffer/pins';
