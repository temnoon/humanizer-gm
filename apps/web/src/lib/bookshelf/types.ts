/**
 * Bookshelf Types - Re-exported from @humanizer/core
 *
 * This file re-exports the unified types from @humanizer/core
 * for backwards compatibility with existing imports.
 *
 * For new code, prefer importing directly from '@humanizer/core':
 *   import { BookProject, Persona, Style } from '@humanizer/core';
 */

// ═══════════════════════════════════════════════════════════════════
// RE-EXPORTS FROM @humanizer/core
// ═══════════════════════════════════════════════════════════════════

// Entity types
export type {
  EntityURI,
  EntityMeta,
  SourceReference,
  SourceType,
  EntityType,
} from '@humanizer/core';

export {
  generateURI,
  generateSourceURI,
  parseURI,
  isValidURI,
} from '@humanizer/core';

// Profile types
export type {
  Persona,
  Style,
  BookProfile,
  VoiceRegister,
  EmotionalRange,
  AbstractionLevel,
  Complexity,
  Density,
} from '@humanizer/core';

export { isPersona, isStyle } from '@humanizer/core';

// Passage types
export type {
  SourcePassage,
  BookThread,
  SourceConversation,
  HarvestConfig,
  CurationStatus,
} from '@humanizer/core';

export {
  normalizeCurationStatus,
  isPassageApproved,
  isPassageGem,
} from '@humanizer/core';

// Book types
export type {
  BookProject,
  BookStatus,
  DraftChapter,
  ChapterStatus,
  DraftVersion,
  ChapterSection,
  Marginalia,
  MarginaliaType,
  ChapterMetadata,
  AUISuggestion,
  BookStats,
  Bookshelf,
  BookshelfIndex,
  TransformationContext,
  ResolvedPersona,
  ResolvedStyle,
  ResolvedBookProject,
} from '@humanizer/core';

export {
  isBookProject,
  isResolved,
  createBookProject,
  createDraftChapter,
  createBookshelf,
} from '@humanizer/core';

// Pyramid types
export type {
  PyramidChunk,
  PyramidSummary,
  PyramidApex,
  PyramidStructure,
  PyramidConfig,
} from '@humanizer/core';

export {
  DEFAULT_PYRAMID_CONFIG,
  calculatePyramidDepth,
  getNodesAtLevel,
  isPyramidComplete,
} from '@humanizer/core';

// Thinking types
export type {
  ThinkingDecision,
  ThinkingContext,
  AUINote,
  ConceptGraph,
  ConceptNode,
  ConceptEdge,
  DecisionType,
  AUINodeType,
  ConceptEdgeType,
} from '@humanizer/core';

export {
  createThinkingContext,
  addAUINote,
  getUnresolvedNotes,
  getNotesFor,
} from '@humanizer/core';

// Harvest types (staging, arcs, links)
export type {
  HarvestStatus,
  HarvestBucket,
  HarvestStats,
  ArcType,
  NarrativeArc,
  ArcTheme,
  ThemeRelationship,
  ChapterOutline,
  ArcEvaluation,
  PassageLink,
  NarrativeGap,
  GapLocation,
  GapType,
  GapSuggestion,
} from '@humanizer/core';

export {
  createHarvestBucket,
  createNarrativeArc,
  createPassageLink,
  isHarvestTerminal,
  isHarvestReady,
  getHarvestProgress,
  getAllApproved,
  isArcApproved,
  getOrphanedPassages,
  getPassageUsageCount,
} from '@humanizer/core';
