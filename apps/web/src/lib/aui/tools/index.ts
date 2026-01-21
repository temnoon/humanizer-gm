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

// Re-export persona/style tools
export {
  executeListPersonas,
  executeListStyles,
  executeApplyPersona,
  executeApplyStyle,
  executeExtractPersona,
  executeExtractStyle,
  executeDiscoverVoices,
  executeCreatePersona,
  executeCreateStyle,
} from './personas';

// Re-export transform tools
export {
  executeHumanize,
  executeDetectAI,
  executeTranslate,
  executeAnalyzeText,
  executeQuantumRead,
} from './transforms';

// Re-export pyramid tools
export {
  executeBuildPyramid,
  executeGetPyramid,
  executeSearchPyramid,
} from './pyramid';

// Re-export conversation & harvesting tools
export {
  executeListConversations,
  executeHarvestArchive,
  executeGenerateFirstDraft,
  executeFillChapter,
} from './conversations';

// Re-export agent tools
export {
  executeListAgents,
  executeGetAgentStatus,
  executeListPendingProposals,
  executeRequestAgent,
} from './agents';

// Re-export workflow tools
export {
  executeDiscoverThreads,
  executeStartBookWorkflow,
  type ThreadPassage,
  type DiscoveredThread,
} from './workflows';

// Re-export harvest bucket tools
export {
  executeHarvestForThread,
  executeProposeNarrativeArc,
  executeTraceNarrativeArc,
  executeFindResonantMirrors,
  executeDetectNarrativeGaps,
} from './harvest-buckets';

// Re-export Book Studio API tools (25 tools)
export {
  // Card tools
  executeListCards,
  executeHarvestCard,
  executeUpdateCard,
  executeMoveCard,
  executeBatchUpdateCards,
  // Harvest workflow tools
  executeSearchForHarvest,
  executeCommitHarvest,
  executeIterateHarvest,
  executeGetHarvestHistory,
  executeCreateHarvestRule,
  // Draft tools
  executeGenerateChapterDraft,
  executeSaveDraft,
  executeReviewDraft,
  executeAcceptDraft,
  executeCompareDrafts,
  // Voice tools
  executeExtractVoice,
  executeListBookVoices,
  executeApplyBookVoice,
  executeSetPrimaryVoice,
  executeGetVoiceFeatures,
  // Assignment tools
  executeAutoAssignCards,
  executeApplyAssignments,
  executeGetAssignmentStats,
  // Batch tools
  executeCreateChaptersBatch,
  executeHarvestCardsBatch,
} from './book-studio';
