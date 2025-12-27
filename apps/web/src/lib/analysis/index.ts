/**
 * Analysis module - Types and utilities for AI detection and text analysis
 */

// Types
export type {
  SplitMode,
  HighlightLayer,
  HighlightRange,
  SentenceAnalysis,
  GPTZeroSentence,
  GPTZeroResult,
  TellPhraseMatch,
  TransformationChange,
  DiffResult,
  AnalysisData,
  AIScoreLevel,
} from './types';

// Utilities
export {
  getAIScoreLevel,
  getAIScoreColor,
} from './types';

export {
  mapSentenceAnalysisToHighlights,
  mapGPTZeroToHighlights,
  mapTellPhrasesToHighlights,
  mapDiffToHighlights,
  mapAnalysisDataToHighlights,
  mergeOverlappingHighlights,
  filterHighlightsByScore,
} from './highlightMapper';
