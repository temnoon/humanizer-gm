/**
 * AUI Module
 *
 * AI assistant tools and utilities for the Agentic User Interface
 *
 * Features:
 * - Tool execution (36 tools for search, transform, book-building)
 * - "Show Don't Tell" animation system
 * - GUI Bridge for tool-to-archive communication
 * - Settings persistence
 * - Curator Persona with persistent memory
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

// GUI Bridge - Tool results to Archive pane - ADDED Dec 30, 2025
export {
  GUI_ACTION_EVENT,
  type GUIAction,
  type GUIActionType,
  type GUIActionTarget,
  type SearchResultsPayload,
  type FilterPayload,
  type NavigatePayload,
  type GUIActionHandler,
  dispatchGUIAction,
  dispatchSearchResults,
  dispatchOpenPanel,
  dispatchNavigate,
  subscribeToGUIActions,
  subscribeToActionType,
  subscribeToTarget,
  useGUIAction,
  useSearchResultsAction,
} from './gui-bridge';

// Curator Persona - Persistent AI identity - ADDED Dec 30, 2025
export {
  loadCuratorPersona,
  saveCuratorPersona,
  resetCuratorPersona,
  addBestPractice,
  updatePreference,
  recordSignificantMoment,
  recordInteraction,
  addCanonicPassage,
  removeCanonicPassage,
  addWorldviewPassage,
  removeWorldviewPassage,
  updateEmbeddingAnchors,
  updateWorldviewDomains,
  updateSystemPrompt,
  updateCoreStances,
  updateAppearance,
  setCuratorActive,
  consolidateMemory,
  getBestPracticesFor,
  getPreference,
  getMomentsByTag,
  hasCanonicIdentity,
  hasWorldview,
  useCuratorPersona,
} from './persona-store';

// Context Builder - Bridge between React contexts and AUI tools - ADDED Dec 31, 2025
export {
  buildAUIContext,
  buildMinimalAUIContext,
} from './context-builder';

// Re-export PinnedContent for convenience
export type { PinnedContent } from '../buffer/pins';
