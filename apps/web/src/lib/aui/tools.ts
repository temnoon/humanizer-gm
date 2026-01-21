/**
 * AUI Tools - Tool definitions and execution for the AI assistant
 *
 * This file has been modularized. Core types, parser, and system prompt
 * are now in the tools/ subdirectory. Tool implementations remain here
 * for backward compatibility but are marked for future extraction.
 *
 * Module structure:
 * - tools/types.ts - Type definitions
 * - tools/parser.ts - USE_TOOL parsing
 * - tools/system-prompt.ts - AUI system prompt
 * - tools/index.ts - Re-exports
 */

// Import from modular structure
import type {
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
} from './tools/types';

// Re-export types for backward compatibility
export type {
  AUIToolResult,
  WorkspaceState,
  AUIContext,
  ParsedToolUse,
};

// Re-export parser and system prompt from modules
export { parseToolUses, cleanToolsFromResponse } from './tools/parser';
export { AUI_BOOK_SYSTEM_PROMPT } from './tools/system-prompt';

// Import harvest bucket service for Phase 3 AUI tools
import { harvestBucketService } from '../bookshelf/HarvestBucketService';
import type { HarvestBucket, NarrativeArc, ArcType } from '@humanizer/core';

// Import transform service for persona/style operations
import {
  transformPersona,
  transformStyle,
  getPersonas,
  getStyles,
  humanize,
  detectAI,
  detectAILite,
  analyzeSentences,
  type DetectionResponse,
} from '../transform/service';
import { getStoredToken } from '../auth';

// Import profile extraction service
import {
  extractPersona as extractPersonaAPI,
  extractStyle as extractStyleAPI,
  discoverVoices as discoverVoicesAPI,
  toUnifiedPersona,
  toUnifiedStyle,
} from '../profile';

// Import pyramid building service
import {
  buildPyramid,
  searchChunks,
} from '../pyramid';

// Import agent bridge
import { getAgentBridge } from './agent-bridge';
import { getArchiveServerUrl } from '../platform';

// Import GUI Bridge for "Show Don't Tell" - dispatch results to Archive pane
import { dispatchSearchResults, dispatchOpenPanel } from './gui-bridge';

// NPE API base URL
const NPE_API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';

// ═══════════════════════════════════════════════════════════════════
// TYPES → Moved to tools/types.ts
// TOOL PARSER → Moved to tools/parser.ts
// ═══════════════════════════════════════════════════════════════════

// Import parseToolUses for internal use in executeTool
import { parseToolUses } from './tools/parser';

// ═══════════════════════════════════════════════════════════════════
// TOOL EXECUTOR
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a single tool
 */
/**
 * Normalize tool names to handle AUI variations:
 * - Lowercase (CREATE_BOOK → create_book)
 * - Remove _workspace suffix (book_workspace → book)
 * - Convert new_ prefix to create_ (new_book → create_book)
 */
function normalizeToolName(rawName: string): string {
  let name = rawName.toLowerCase();

  // Remove _workspace suffix
  if (name.endsWith('_workspace')) {
    name = name.replace(/_workspace$/, '');
  }

  // Convert new_ prefix to create_
  if (name.startsWith('new_')) {
    name = name.replace(/^new_/, 'create_');
  }

  // Common semantic aliases (AUI sometimes invents creative names)
  const aliases: Record<string, string> = {
    'book': 'create_book',
    'book_create': 'create_book',      // Reversed order
    'book_builder': 'create_book',     // Creative invention
    'book_new': 'create_book',         // Another variant
    'new_book_project': 'create_book', // Verbose variant
    'project': 'create_project',
    'project_create': 'create_project', // Reversed order
    'text_analysis': 'analyze_text',
    'qbism': 'quantum_read',
    'explore': 'search_archive',
    'search': 'search_archive',
    'trace_narrative': 'trace_arc',
    'arc_search': 'trace_arc',
  };

  return aliases[name] || name;
}

export async function executeTool(
  toolUse: ParsedToolUse,
  context: AUIContext
): Promise<AUIToolResult> {
  const { params } = toolUse;
  const name = normalizeToolName(toolUse.name);

  switch (name) {
    // Book project tools
    case 'create_book':
    case 'create_project':
      return executeCreateBook(params, context);

    // Book chapter tools
    case 'update_chapter':
      return executeUpdateChapter(params, context);

    case 'create_chapter':
      return executeCreateChapter(params, context);

    case 'delete_chapter':
      return executeDeleteChapter(params, context);

    case 'render_book':
      return executeRenderBook(context);

    case 'list_chapters':
      return executeListChapters(context);

    case 'get_chapter':
      return executeGetChapter(params, context);

    // Workspace tools (new)
    case 'get_workspace':
      return executeGetWorkspace(context);

    case 'save_to_chapter':
      return executeSaveToChapter(params, context);

    // Archive tools (new)
    case 'search_archive':
      return executeSearchArchive(params);

    case 'search_facebook':
      return executeSearchFacebook(params);

    case 'search_content':
      return executeSearchContent(params);

    case 'check_archive_health':
      return executeCheckArchiveHealth();

    case 'build_embeddings':
      return executeBuildEmbeddings(params);

    case 'discover_filters':
      return executeDiscoverFilters(params);

    case 'apply_filter':
      return executeApplyFilter(params);

    case 'clear_filters':
      return executeClearFilters();

    case 'list_conversations':
      return executeListConversations(params);

    case 'harvest_archive':
      return executeHarvestArchive(params, context);

    // Passage tools (new)
    case 'add_passage':
      return executeAddPassage(params, context);

    case 'list_passages':
      return executeListPassages(context);

    case 'mark_passage':
      return executeMarkPassage(params, context);

    // Image tools (new)
    case 'describe_image':
      return executeDescribeImage(params, context);

    case 'search_images':
      return executeSearchImages(params);

    case 'classify_image':
      return executeClassifyImage(params, context);

    case 'find_similar_images':
      return executeFindSimilarImages(params, context);

    case 'cluster_images':
      return executeClusterImages(params);

    case 'add_image_passage':
      return executeAddImagePassage(params, context);

    // Persona/Style tools
    case 'list_personas':
      return executeListPersonas();

    case 'list_styles':
      return executeListStyles();

    case 'apply_persona':
      return executeApplyPersona(params, context);

    case 'apply_style':
      return executeApplyStyle(params, context);

    case 'extract_persona':
      return executeExtractPersona(params, context);

    case 'extract_style':
      return executeExtractStyle(params, context);

    case 'discover_voices':
      return executeDiscoverVoices(params);

    case 'create_persona':
      return executeCreatePersona(params);

    case 'create_style':
      return executeCreateStyle(params);

    // Text transformation tools
    case 'humanize':
      return executeHumanize(params, context);

    case 'detect_ai':
      return executeDetectAI(params, context);

    case 'translate':
      return executeTranslate(params, context);

    case 'analyze_text':
      return executeAnalyzeText(params, context);

    case 'quantum_read':
      return executeQuantumRead(params, context);

    // Pyramid building tools
    case 'build_pyramid':
      return executeBuildPyramid(params, context);

    case 'get_pyramid':
      return executeGetPyramid(context);

    case 'search_pyramid':
      return executeSearchPyramid(params, context);

    // Draft generation tools
    case 'generate_first_draft':
      return executeGenerateFirstDraft(params, context);

    case 'fill_chapter':
      return executeFillChapter(params, context);

    // Agent tools
    case 'list_agents':
      return executeListAgents();

    case 'get_agent_status':
      return executeGetAgentStatus(params);

    case 'list_pending_proposals':
      return executeListPendingProposals();

    case 'request_agent':
      return executeRequestAgent(params);

    // Workflow tools
    case 'discover_threads':
      return executeDiscoverThreads(params, context);

    case 'start_book_workflow':
      return executeStartBookWorkflow(params, context);

    // Phase 3: Harvest bucket tools
    case 'harvest_for_thread':
      return executeHarvestForThread(params, context);

    case 'propose_narrative_arc':
      return executeProposeNarrativeArc(params, context);

    case 'find_resonant_mirrors':
      return executeFindResonantMirrors(params, context);

    case 'detect_narrative_gaps':
      return executeDetectNarrativeGaps(params, context);

    case 'trace_arc':
      return executeTraceNarrativeArc(params, context);

    // ─────────────────────────────────────────────────────────────────
    // Book Studio API Tools (25 tools)
    // ─────────────────────────────────────────────────────────────────

    // Card tools (5)
    case 'list_cards':
      return executeListCards(params, context);

    case 'harvest_card':
      return executeHarvestCard(params, context);

    case 'update_card':
      return executeUpdateCard(params, context);

    case 'move_card':
      return executeMoveCard(params, context);

    case 'batch_update_cards':
      return executeBatchUpdateCards(params, context);

    // Harvest workflow tools (5)
    case 'search_for_harvest':
      return executeSearchForHarvest(params, context);

    case 'commit_harvest':
      return executeCommitHarvest(params, context);

    case 'iterate_harvest':
      return executeIterateHarvest(params, context);

    case 'get_harvest_history':
      return executeGetHarvestHistory(params, context);

    case 'create_harvest_rule':
      return executeCreateHarvestRule(params, context);

    // Draft tools (5)
    case 'generate_chapter_draft':
      return executeGenerateChapterDraft(params, context);

    case 'save_draft':
      return executeSaveDraft(params, context);

    case 'review_draft':
      return executeReviewDraft(params, context);

    case 'accept_draft':
      return executeAcceptDraft(params, context);

    case 'compare_drafts':
      return executeCompareDrafts(params, context);

    // Voice tools (5)
    case 'extract_voice':
      return executeExtractVoice(params, context);

    case 'list_book_voices':
      return executeListBookVoices(params, context);

    case 'apply_book_voice':
      return executeApplyBookVoice(params, context);

    case 'set_primary_voice':
      return executeSetPrimaryVoice(params, context);

    case 'get_voice_features':
      return executeGetVoiceFeatures(params, context);

    // Assignment tools (3)
    case 'auto_assign_cards':
      return executeAutoAssignCards(params, context);

    case 'apply_assignments':
      return executeApplyAssignments(params, context);

    case 'get_assignment_stats':
      return executeGetAssignmentStats(params, context);

    // Batch tools (2)
    case 'create_chapters_batch':
      return executeCreateChaptersBatch(params, context);

    case 'harvest_cards_batch':
      return executeHarvestCardsBatch(params, context);

    default:
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
  }
}

/**
 * Execute all tools in a response
 */
export async function executeAllTools(
  response: string,
  context: AUIContext
): Promise<{ results: AUIToolResult[]; hasTools: boolean }> {
  const toolUses = parseToolUses(response);

  if (toolUses.length === 0) {
    return { results: [], hasTools: false };
  }

  const results: AUIToolResult[] = [];

  for (const toolUse of toolUses) {
    const result = await executeTool(toolUse, context);
    results.push(result);
  }

  return { results, hasTools: true };
}

// ═══════════════════════════════════════════════════════════════════
// BOOK TOOLS → Moved to tools/book.ts
// ═══════════════════════════════════════════════════════════════════

import {
  executeCreateBook,
  executeUpdateChapter,
  executeCreateChapter,
  executeDeleteChapter,
  executeRenderBook,
  executeListChapters,
  executeGetChapter,
} from './tools/book';

// ═══════════════════════════════════════════════════════════════════
// WORKSPACE TOOLS → Moved to tools/workspace.ts
// ═══════════════════════════════════════════════════════════════════

import {
  executeGetWorkspace,
  executeSaveToChapter,
} from './tools/workspace';

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE SEARCH TOOLS → Moved to tools/archive.ts
// ═══════════════════════════════════════════════════════════════════

import {
  executeSearchArchive,
  executeCheckArchiveHealth,
  executeBuildEmbeddings,
  executeSearchFacebook,
  executeSearchContent,
  executeDiscoverFilters,
  executeApplyFilter,
  executeClearFilters,
} from './tools/archive';

// ═══════════════════════════════════════════════════════════════════
// PASSAGE MANAGEMENT TOOLS → Moved to tools/passages.ts
// ═══════════════════════════════════════════════════════════════════

import {
  executeAddPassage,
  executeListPassages,
  executeMarkPassage,
} from './tools/passages';

// ═══════════════════════════════════════════════════════════════════
// IMAGE TOOLS → Moved to tools/images.ts
// ═══════════════════════════════════════════════════════════════════

import {
  executeDescribeImage,
  executeSearchImages,
  executeClassifyImage,
  executeFindSimilarImages,
  executeClusterImages,
  executeAddImagePassage,
} from './tools/images';
import {
  executeListPersonas,
  executeListStyles,
  executeApplyPersona,
  executeApplyStyle,
  executeExtractPersona,
  executeExtractStyle,
  executeDiscoverVoices,
  executeCreatePersona,
  executeCreateStyle,
} from './tools/personas';
import {
  executeHumanize,
  executeDetectAI,
  executeTranslate,
  executeAnalyzeText,
  executeQuantumRead,
} from './tools/transforms';
import {
  executeBuildPyramid,
  executeGetPyramid,
  executeSearchPyramid,
} from './tools/pyramid';
import {
  executeListConversations,
  executeHarvestArchive,
  executeGenerateFirstDraft,
  executeFillChapter,
} from './tools/conversations';
import {
  executeListAgents,
  executeGetAgentStatus,
  executeListPendingProposals,
  executeRequestAgent,
} from './tools/agents';
import {
  executeDiscoverThreads,
  executeStartBookWorkflow,
} from './tools/workflows';
import {
  executeHarvestForThread,
  executeProposeNarrativeArc,
  executeTraceNarrativeArc,
  executeFindResonantMirrors,
  executeDetectNarrativeGaps,
} from './tools/harvest-buckets';
import {
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
} from './tools/book-studio';

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT → Moved to tools/system-prompt.ts
// ═══════════════════════════════════════════════════════════════════
