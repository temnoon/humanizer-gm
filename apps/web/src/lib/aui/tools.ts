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

    case 'check_archive_health':
      return executeCheckArchiveHealth();

    case 'build_embeddings':
      return executeBuildEmbeddings(params);

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

// ═══════════════════════════════════════════════════════════════════
// PERSONA/STYLE TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List available personas
 */
async function executeListPersonas(): Promise<AUIToolResult> {
  try {
    const personas = await getPersonas();

    return {
      success: true,
      message: `Found ${personas.length} persona(s)`,
      data: {
        personas: personas.map(p => ({
          name: p.name,
          description: p.description,
          icon: p.icon,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to fetch personas',
    };
  }
}

/**
 * List available styles
 */
async function executeListStyles(): Promise<AUIToolResult> {
  try {
    const styles = await getStyles();

    return {
      success: true,
      message: `Found ${styles.length} style(s)`,
      data: {
        styles: styles.map(s => ({
          name: s.name,
          description: s.description,
          icon: s.icon,
        })),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to fetch styles',
    };
  }
}

/**
 * Apply a persona transformation to text
 */
async function executeApplyPersona(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { persona, text } = params as { persona?: string; text?: string };

  if (!persona) {
    return { success: false, error: 'Missing persona parameter' };
  }

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await transformPersona(targetText, persona);

    return {
      success: true,
      message: `Transformed with persona "${persona}"`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona transformation failed',
    };
  }
}

/**
 * Apply a style transformation to text
 */
async function executeApplyStyle(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { style, text } = params as { style?: string; text?: string };

  if (!style) {
    return { success: false, error: 'Missing style parameter' };
  }

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await transformStyle(targetText, style);

    return {
      success: true,
      message: `Transformed with style "${style}"`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style transformation failed',
    };
  }
}

/**
 * Extract a persona from sample text using Profile Factory
 */
async function executeExtractPersona(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, name, bookTitle, author } = params as {
    text?: string;
    name?: string;
    bookTitle?: string;
    author?: string;
  };

  // Use provided text or workspace content
  let sampleText = text;
  if (!sampleText && context.workspace) {
    if (context.workspace.selectedContent) {
      sampleText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      sampleText = context.workspace.bufferContent;
    }
  }

  if (!sampleText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  // Validate text length
  if (sampleText.length < 200) {
    return { success: false, error: 'Text must be at least 200 characters for meaningful extraction' };
  }

  try {
    // Use the new ProfileExtractionService
    const response = await extractPersonaAPI(sampleText, {
      customName: name,
      bookTitle: bookTitle || context.activeProject?.name,
      author: author || context.activeProject?.author,
    });

    // Convert to unified type for storage
    const unifiedPersona = toUnifiedPersona(response, author || 'user');

    return {
      success: true,
      message: `Extracted persona "${response.name}"`,
      data: {
        name: response.name,
        description: response.description,
        attributes: response.attributes,
        system_prompt: response.system_prompt?.slice(0, 200) + '...',
        example_patterns: response.example_patterns?.slice(0, 3),
        unified: unifiedPersona,
      },
      teaching: {
        whatHappened: `Analyzed ${sampleText.split(/\s+/).length} words and extracted a persona profile with voice characteristics, perspective, and tone.`,
        guiPath: ['Studio', 'Transform Panel', 'Extract', 'Persona'],
        why: 'Personas capture WHO is speaking - their perspective, vocabulary, and emotional register. Use this persona to transform other text to sound like this voice.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona extraction failed',
    };
  }
}

/**
 * Extract a style from sample text using ProfileExtractionService
 */
async function executeExtractStyle(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, name, bookTitle, author } = params as {
    text?: string;
    name?: string;
    bookTitle?: string;
    author?: string;
  };

  // Use provided text or workspace content
  let sampleText = text;
  if (!sampleText && context.workspace) {
    if (context.workspace.selectedContent) {
      sampleText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      sampleText = context.workspace.bufferContent;
    }
  }

  if (!sampleText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  // Validate text length
  if (sampleText.length < 200) {
    return { success: false, error: 'Text must be at least 200 characters for meaningful extraction' };
  }

  try {
    // Use the new ProfileExtractionService
    const response = await extractStyleAPI(sampleText, {
      customName: name,
      bookTitle: bookTitle || context.activeProject?.name,
      author: author || context.activeProject?.author,
    });

    // Convert to unified type for storage
    const unifiedStyle = toUnifiedStyle(response, author || 'user');

    return {
      success: true,
      message: `Extracted style "${response.name}"`,
      data: {
        name: response.name,
        attributes: response.attributes,
        style_prompt: response.style_prompt?.slice(0, 200) + '...',
        example_sentences: response.example_sentences?.slice(0, 3),
        unified: unifiedStyle,
      },
      teaching: {
        whatHappened: `Analyzed ${sampleText.split(/\s+/).length} words and extracted a style profile with sentence structure, vocabulary, and rhythm patterns.`,
        guiPath: ['Studio', 'Transform Panel', 'Extract', 'Style'],
        why: 'Styles capture HOW text is written - sentence patterns, vocabulary complexity, and rhetorical devices. Use this style to give any text a consistent feel.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style extraction failed',
    };
  }
}

/**
 * Auto-discover personas and styles from writing samples using ProfileExtractionService
 */
async function executeDiscoverVoices(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { min_clusters, max_clusters } = params as {
    min_clusters?: number;
    max_clusters?: number;
  };

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required for voice discovery' };
    }

    // Use the new ProfileExtractionService
    const data = await discoverVoicesAPI({
      min_clusters: min_clusters || 3,
      max_clusters: max_clusters || 7,
    });

    return {
      success: true,
      message: `Discovered ${data.personas_discovered} persona(s) and ${data.styles_discovered} style(s)`,
      data: {
        personas_discovered: data.personas_discovered,
        styles_discovered: data.styles_discovered,
        total_words_analyzed: data.total_words_analyzed,
        personas: data.personas?.slice(0, 5).map((p) => ({
          name: p.name,
          description: p.description,
        })),
        styles: data.styles?.slice(0, 5).map((s) => ({
          name: s.name,
          description: s.description,
        })),
      },
      teaching: {
        whatHappened: `Analyzed ${data.total_words_analyzed.toLocaleString()} words across your writing samples and clustered them into ${data.personas_discovered} distinct voices.`,
        guiPath: ['Studio', 'Profile', 'Discover Voices'],
        why: 'Voice discovery uses K-means clustering on text embeddings to find patterns in how you write differently in different contexts.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Voice discovery failed',
    };
  }
}

/**
 * Create a custom persona
 */
async function executeCreatePersona(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { name, description, example_texts } = params as {
    name?: string;
    description?: string;
    example_texts?: string[];
  };

  if (!name) {
    return { success: false, error: 'Missing name parameter' };
  }

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required to create personas' };
    }

    const response = await fetch(`${NPE_API_BASE}/personal/personas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || `Custom persona: ${name}`,
        example_texts: example_texts || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Creation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Created persona "${name}"`,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Persona creation failed',
    };
  }
}

/**
 * Create a custom style
 */
async function executeCreateStyle(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const { name, description, formality_score, complexity_score, tone_markers, example_texts } = params as {
    name?: string;
    description?: string;
    formality_score?: number;
    complexity_score?: number;
    tone_markers?: string[];
    example_texts?: string[];
  };

  if (!name) {
    return { success: false, error: 'Missing name parameter' };
  }

  try {
    const token = getStoredToken();
    if (!token) {
      return { success: false, error: 'Authentication required to create styles' };
    }

    const response = await fetch(`${NPE_API_BASE}/personal/styles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        description: description || `Custom style: ${name}`,
        formality_score: formality_score ?? 0.5,
        complexity_score: complexity_score ?? 0.5,
        tone_markers: tone_markers || [],
        example_texts: example_texts || [],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Creation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Created style "${name}"`,
      data: {
        id: data.id,
        name: data.name,
        description: data.description,
        formality_score: data.formality_score,
        complexity_score: data.complexity_score,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Style creation failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TEXT TRANSFORMATION TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Humanize AI-generated text
 */
async function executeHumanize(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, intensity, voiceSamples } = params as {
    text?: string;
    intensity?: 'light' | 'moderate' | 'aggressive';
    voiceSamples?: string[];
  };

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await humanize(targetText, {
      intensity: intensity || 'moderate',
      voiceSamples,
      enableLLMPolish: true,
    });

    return {
      success: true,
      message: `Humanized with ${intensity || 'moderate'} intensity`,
      content: result.transformed,
      data: {
        original: targetText.slice(0, 100) + '...',
        transformed: result.transformed,
        modelUsed: result.metadata?.modelUsed,
        baseline: result.metadata?.baseline,
        final: result.metadata?.final,
        improvement: result.metadata?.improvement,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Humanization failed',
    };
  }
}

/**
 * Detect if text is AI-generated
 */
async function executeDetectAI(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, lite } = params as { text?: string; lite?: boolean };

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result: DetectionResponse = lite
      ? await detectAILite(targetText)
      : await detectAI(targetText);

    const verdictText = result.confidence > 0.7
      ? 'Likely AI-generated'
      : result.confidence > 0.4
        ? 'Mixed/uncertain'
        : 'Likely human-written';

    return {
      success: true,
      message: `${verdictText} (${Math.round(result.confidence * 100)}% AI confidence)`,
      data: {
        confidence: result.confidence,
        verdict: result.verdict,
        verdictText,
        method: result.method,
        explanation: result.explanation,
        details: result.details,
        processingTimeMs: result.processingTimeMs,
        textLength: targetText.length,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'AI detection failed',
    };
  }
}

/**
 * Translate text to another language
 */
async function executeTranslate(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, targetLanguage, sourceLanguage } = params as {
    text?: string;
    targetLanguage?: string;
    sourceLanguage?: string;
  };

  if (!targetLanguage) {
    return { success: false, error: 'Missing targetLanguage parameter (e.g., "Spanish", "French", "Japanese")' };
  }

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NPE_API_BASE}/transformations/translate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: targetText,
        target_language: targetLanguage,
        source_language: sourceLanguage,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Translation failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      success: true,
      message: `Translated to ${targetLanguage}`,
      content: data.translated_text,
      data: {
        original: targetText.slice(0, 100) + '...',
        translated: data.translated_text,
        sourceLanguage: data.source_language || sourceLanguage || 'auto-detected',
        targetLanguage: data.target_language || targetLanguage,
        confidence: data.confidence,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Translation failed',
    };
  }
}

/**
 * Analyze text for linguistic features
 */
async function executeAnalyzeText(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text } = params as { text?: string };

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${NPE_API_BASE}/ai-detection/detect-v2/features`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: targetText }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Analysis failed: ${response.statusText}`);
    }

    const data = await response.json();

    // Summarize key findings
    const highlights: string[] = [];
    if (data.burstiness !== undefined) {
      highlights.push(`Burstiness: ${data.burstiness.toFixed(2)} (${data.burstiness > 0.5 ? 'varied' : 'uniform'} sentence lengths)`);
    }
    if (data.vocabulary_diversity !== undefined) {
      highlights.push(`Vocabulary diversity: ${data.vocabulary_diversity.toFixed(2)}`);
    }
    if (data.tell_phrase_count !== undefined && data.tell_phrase_count > 0) {
      highlights.push(`AI tell-phrases detected: ${data.tell_phrase_count}`);
    }

    return {
      success: true,
      message: `Analyzed ${targetText.split(/\s+/).length} words`,
      data: {
        wordCount: targetText.split(/\s+/).filter(w => w).length,
        sentenceCount: targetText.split(/[.!?]+/).filter(s => s.trim()).length,
        burstiness: data.burstiness,
        vocabularyDiversity: data.vocabulary_diversity,
        avgSentenceLength: data.avg_sentence_length,
        tellPhraseCount: data.tell_phrase_count,
        tellPhrases: data.tell_phrases?.slice(0, 5),
        punctuationDensity: data.punctuation_density,
        highlights,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Text analysis failed',
    };
  }
}

/**
 * Quantum reading - sentence-by-sentence tetralemma analysis
 */
async function executeQuantumRead(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, detailed } = params as { text?: string; detailed?: boolean };

  // Use provided text or workspace content
  let targetText = text;
  if (!targetText && context.workspace) {
    if (context.workspace.selectedContent) {
      targetText = context.workspace.selectedContent.text;
    } else if (context.workspace.bufferContent) {
      targetText = context.workspace.bufferContent;
    }
  }

  if (!targetText) {
    return { success: false, error: 'No text provided and no content in workspace' };
  }

  try {
    const result = await analyzeSentences(targetText);

    // Summarize the quantum reading
    const stanceEmoji: Record<string, string> = {
      literal: '📐',
      metaphorical: '🌀',
      both: '⚛️',
      neither: '○',
    };

    const dominantStance = result.overall.dominantStance as keyof typeof stanceEmoji;
    const summary = `${stanceEmoji[dominantStance] || '?'} Dominant: ${dominantStance} | Entropy: ${result.overall.avgEntropy.toFixed(2)} | Purity: ${result.overall.avgPurity.toFixed(2)}`;

    // Create sentence breakdown if detailed
    const sentenceBreakdown = detailed
      ? result.sentences.map(s => ({
          text: s.text.slice(0, 60) + (s.text.length > 60 ? '...' : ''),
          stance: s.dominant,
          emoji: stanceEmoji[s.dominant] || '?',
          tetralemma: {
            L: Math.round(s.tetralemma.literal * 100),
            M: Math.round(s.tetralemma.metaphorical * 100),
            B: Math.round(s.tetralemma.both * 100),
            N: Math.round(s.tetralemma.neither * 100),
          },
        }))
      : undefined;

    return {
      success: true,
      message: summary,
      data: {
        totalSentences: result.overall.totalSentences,
        dominantStance: result.overall.dominantStance,
        avgEntropy: result.overall.avgEntropy,
        avgPurity: result.overall.avgPurity,
        stanceCounts: {
          literal: result.sentences.filter(s => s.dominant === 'literal').length,
          metaphorical: result.sentences.filter(s => s.dominant === 'metaphorical').length,
          both: result.sentences.filter(s => s.dominant === 'both').length,
          neither: result.sentences.filter(s => s.dominant === 'neither').length,
        },
        sentences: sentenceBreakdown,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Quantum reading failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PYRAMID BUILDING TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a pyramid from book passages or text
 */
async function executeBuildPyramid(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { text, usePassages } = params as {
    text?: string;
    usePassages?: boolean;
  };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  // Determine source content
  let sourceText = text;

  if (!sourceText && usePassages !== false && context.getPassages) {
    // Build from approved/gem passages
    const passages = context.getPassages();
    const usablePassages = passages.filter(
      p => (p.curation?.status || p.status) === 'gem' || (p.curation?.status || p.status) === 'approved'
    );

    if (usablePassages.length === 0) {
      return {
        success: false,
        error: 'No approved or gem passages to build pyramid from. Mark some passages as approved or gem first.',
      };
    }

    sourceText = usablePassages
      .map(p => p.text || p.content || '')
      .filter(t => t.length > 0)
      .join('\n\n---\n\n');
  }

  // Fall back to workspace content
  if (!sourceText && context.workspace) {
    if (context.workspace.bufferContent) {
      sourceText = context.workspace.bufferContent;
    }
  }

  if (!sourceText) {
    return {
      success: false,
      error: 'No text provided and no passages or workspace content available',
    };
  }

  if (sourceText.length < 500) {
    return {
      success: false,
      error: 'Text must be at least 500 characters for meaningful pyramid building',
    };
  }

  try {
    const result = await buildPyramid(sourceText, {
      sourceInfo: {
        bookTitle: context.activeProject.name,
        author: context.activeProject.author,
      },
      onProgress: (progress) => {
        // Progress could be sent to UI via callback
        console.log(`[Pyramid] ${progress.message}`);
      },
    });

    if (!result.success || !result.pyramid) {
      return {
        success: false,
        error: result.error || 'Pyramid building failed',
      };
    }

    const pyramid = result.pyramid;
    const wordCount = sourceText.split(/\s+/).length;

    return {
      success: true,
      message: `Built ${pyramid.meta.depth}-level pyramid from ${wordCount} words`,
      data: {
        depth: pyramid.meta.depth,
        totalChunks: pyramid.meta.chunkCount,
        totalSummaries: pyramid.summaries.length,
        compressionRatio: pyramid.meta.compressionRatio.toFixed(1),
        apex: pyramid.apex ? {
          summary: pyramid.apex.summary.substring(0, 200) + '...',
          themes: pyramid.apex.themes,
          characters: pyramid.apex.characters,
          arc: pyramid.apex.arc,
          mood: pyramid.apex.mood,
        } : null,
        processingTimeMs: result.stats.processingTimeMs,
      },
      teaching: {
        whatHappened: `Processed ${wordCount} words into ${pyramid.meta.chunkCount} chunks, built ${pyramid.meta.depth} levels of summaries, and extracted ${pyramid.apex?.themes?.length || 0} themes.`,
        guiPath: ['Book Panel', 'Profile Tab', 'Build Pyramid'],
        why: 'Pyramid summarization lets your book "know itself" - the apex contains themes, characters, and arc that can guide editing and help readers understand the work at any level of depth.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Pyramid building failed',
    };
  }
}

/**
 * Get the pyramid structure for the active book
 */
function executeGetPyramid(context: AUIContext): AUIToolResult {
  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  const pyramid = context.activeProject.pyramid;

  if (!pyramid || !pyramid.chunks || pyramid.chunks.length === 0) {
    return {
      success: true,
      message: 'No pyramid built for this book yet',
      data: { hasPyramid: false },
      teaching: {
        whatHappened: 'This book does not have a pyramid structure yet.',
        guiPath: ['Book Panel', 'Profile Tab', 'Build Pyramid'],
        why: 'Use the build_pyramid tool to create one from your passages or provide text directly.',
      },
    };
  }

  const apex = pyramid.apex;

  return {
    success: true,
    message: `${pyramid.chunks.length} chunks, ${pyramid.summaries?.length || 0} summaries, ${apex ? 'apex complete' : 'no apex'}`,
    data: {
      hasPyramid: true,
      depth: (pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0) + 1,
      chunkCount: pyramid.chunks.length,
      summaryCount: pyramid.summaries?.length || 0,
      hasApex: !!apex,
      apex: apex ? {
        summary: apex.summary?.substring(0, 300),
        themes: apex.themes,
        characters: apex.characters,
        arc: apex.arc,
        mood: apex.mood,
        generatedAt: apex.generatedAt,
      } : null,
      levels: (() => {
        const levels: Array<{ level: number; count: number; avgWords: number }> = [];
        // L0 - chunks
        const chunkWords = pyramid.chunks.map(c => c.wordCount || 0);
        levels.push({
          level: 0,
          count: pyramid.chunks.length,
          avgWords: Math.round(chunkWords.reduce((a, b) => a + b, 0) / chunkWords.length || 0),
        });
        // L1+ - summaries
        const maxLevel = pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0;
        for (let l = 1; l <= maxLevel; l++) {
          const levelSummaries = pyramid.summaries?.filter(s => s.level === l) || [];
          const words = levelSummaries.map(s => s.wordCount || 0);
          levels.push({
            level: l,
            count: levelSummaries.length,
            avgWords: Math.round(words.reduce((a, b) => a + b, 0) / words.length || 0),
          });
        }
        return levels;
      })(),
    },
    teaching: {
      whatHappened: `This book has a ${pyramid.chunks.length}-chunk pyramid with ${apex ? 'a complete apex' : 'no apex yet'}.`,
      guiPath: ['Book Panel', 'Profile Tab'],
      why: 'The pyramid lets you understand the book at any level of detail - from individual passages up to the complete thematic summary.',
    },
  };
}

/**
 * Search within the pyramid's chunks
 */
function executeSearchPyramid(
  params: Record<string, unknown>,
  context: AUIContext
): AUIToolResult {
  const { query, limit = 5 } = params as { query?: string; limit?: number };

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  const pyramid = context.activeProject.pyramid;

  if (!pyramid || !pyramid.chunks || pyramid.chunks.length === 0) {
    return {
      success: false,
      error: 'No pyramid built for this book. Use build_pyramid first.',
    };
  }

  try {
    // Create a temporary pyramid structure for the search function
    const pyramidStructure = {
      chunks: pyramid.chunks,
      summaries: pyramid.summaries || [],
      apex: pyramid.apex,
      meta: {
        depth: (pyramid.summaries?.reduce((max, s) => Math.max(max, s.level), 0) || 0) + 1,
        chunkCount: pyramid.chunks.length,
        sourceWordCount: pyramid.chunks.reduce((sum, c) => sum + (c.wordCount || 0), 0),
        compressionRatio: 1,
        builtAt: pyramid.apex?.generatedAt || Date.now(),
        config: {
          chunkSize: 300,
          compressionTarget: 5,
          summarizerModel: 'haiku',
          extractorModel: 'sonnet',
          computeEmbeddings: false,
        },
      },
    };

    const results = searchChunks(pyramidStructure, query, { limit });

    return {
      success: true,
      message: `Found ${results.length} matching chunk(s) for "${query}"`,
      data: {
        query,
        results: results.map(r => ({
          chunkId: r.chunk.id,
          index: r.chunk.index,
          score: r.score.toFixed(3),
          preview: r.chunk.content.substring(0, 150) + '...',
          wordCount: r.chunk.wordCount,
        })),
      },
      teaching: {
        whatHappened: `Searched ${pyramid.chunks.length} chunks and found ${results.length} matches for "${query}".`,
        guiPath: ['Book Panel', 'Profile Tab', 'Search Pyramid'],
        why: 'Searching the pyramid helps you find specific passages within the hierarchical structure of your book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Pyramid search failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION & HARVESTING TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List conversations from the archive
 */
async function executeListConversations(
  params: Record<string, unknown>
): Promise<AUIToolResult> {
  const {
    limit = 20,
    search,
    sortBy,
    minWords,
    maxWords,
    hideEmpty,
    hideTrivial,
    hasMedia,
    hasImages,
    hasAudio,
    hasCode,
  } = params as {
    limit?: number;
    search?: string;
    sortBy?: 'recent' | 'oldest' | 'messages-desc' | 'length-desc' | 'length-asc' | 'words-desc' | 'words-asc';
    minWords?: number;
    maxWords?: number;
    hideEmpty?: boolean;
    hideTrivial?: boolean;
    hasMedia?: boolean;
    hasImages?: boolean;
    hasAudio?: boolean;
    hasCode?: boolean;
  };

  try {
    // Build query params
    const archiveServer = await getArchiveServerUrl();
    const queryParams = new URLSearchParams();
    queryParams.set('limit', String(limit));
    if (search) queryParams.set('search', search);
    if (sortBy) queryParams.set('sortBy', sortBy);
    if (hideEmpty) queryParams.set('minMessages', '1');
    if (hasMedia !== undefined) queryParams.set('hasMedia', String(hasMedia));
    if (hasImages !== undefined) queryParams.set('hasImages', String(hasImages));
    if (hasAudio !== undefined) queryParams.set('hasAudio', String(hasAudio));
    // Note: hasCode and word filters are applied client-side after fetch

    const response = await fetch(`${archiveServer}/api/conversations?${queryParams}`);

    if (!response.ok) {
      return { success: false, error: 'Failed to fetch conversations' };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.conversations) {
      console.warn('[list_conversations] API response missing conversations field');
    }
    let conversations = data.conversations || [];

    // Estimate word count from text_length (avg ~5 chars per word)
    const estimateWords = (textLength: number) => Math.round(textLength / 5);

    // Apply client-side filters
    if (hideTrivial) {
      conversations = conversations.filter((c: { text_length?: number }) =>
        estimateWords(c.text_length || 0) > 5
      );
    }
    if (minWords !== undefined) {
      conversations = conversations.filter((c: { text_length?: number }) =>
        estimateWords(c.text_length || 0) >= minWords
      );
    }
    if (maxWords !== undefined) {
      conversations = conversations.filter((c: { text_length?: number }) =>
        estimateWords(c.text_length || 0) <= maxWords
      );
    }
    // hasCode would require content inspection - note in response if requested
    const codeFilterNote = hasCode ? ' (code filter requires content inspection - showing all)' : '';

    // Apply word-based sorting if requested
    if (sortBy === 'words-desc') {
      conversations.sort((a: { text_length?: number }, b: { text_length?: number }) =>
        (b.text_length || 0) - (a.text_length || 0)
      );
    } else if (sortBy === 'words-asc') {
      conversations.sort((a: { text_length?: number }, b: { text_length?: number }) =>
        (a.text_length || 0) - (b.text_length || 0)
      );
    }

    // Build filter description for teaching
    const filterParts: string[] = [];
    if (sortBy) filterParts.push(`sorted by ${sortBy}`);
    if (minWords) filterParts.push(`min ${minWords} words`);
    if (maxWords) filterParts.push(`max ${maxWords} words`);
    if (hideTrivial) filterParts.push('hiding trivial');
    if (hasImages) filterParts.push('with images');
    if (hasAudio) filterParts.push('with audio');
    const filterDesc = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

    return {
      success: true,
      message: `Found ${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}${filterDesc}${codeFilterNote}`,
      data: {
        conversations: conversations.slice(0, limit).map((c: {
          id: string;
          title: string;
          folder?: string;
          message_count?: number;
          text_length?: number;
          created_at?: number;
          updated_at?: number;
        }) => ({
          id: c.id,
          title: c.title || 'Untitled',
          folder: c.folder,
          messageCount: c.message_count,
          wordCount: estimateWords(c.text_length || 0),
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        })),
        total: data.total || conversations.length,
        appliedFilters: filterParts,
      },
      teaching: {
        whatHappened: `Listed ${conversations.length} conversations from your archive${filterDesc}`,
        guiPath: [
          'Click Archive panel (left side)',
          'Select "Conversations" tab',
          filterParts.length > 0 ? 'Use the filter dropdowns and inputs to apply filters' : 'Browse the full list',
        ],
        why: 'Filters help you find the most meaningful conversations - longer ones often contain deeper discussions.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list conversations',
    };
  }
}

/**
 * Harvest passages from archive into the active book project
 * Combines search + auto-add to bookshelf
 */
async function executeHarvestArchive(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { query, limit = 10, minSimilarity = 0.6 } = params as {
    query?: string;
    limit?: number;
    minSimilarity?: number;
  };

  if (!query) {
    return { success: false, error: 'Missing query parameter' };
  }

  if (!context.activeProject) {
    return { success: false, error: 'No active book project. Select a book first.' };
  }

  if (!context.addPassage) {
    return { success: false, error: 'Passage operations not available' };
  }

  try {
    // First, search the archive (unified: AI conversations + Facebook + documents)
    const archiveServer = await getArchiveServerUrl();
    const response = await fetch(`${archiveServer}/api/embeddings/search/unified`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: limit * 2 }), // Get more, filter by similarity
    });

    if (!response.ok) {
      return { success: false, error: 'Archive search failed' };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.results) {
      console.warn('[harvest_archive] API response missing results field');
    }
    const results = (data.results || []).filter(
      (r: { similarity: number }) => r.similarity >= minSimilarity
    ).slice(0, limit);

    if (results.length === 0) {
      return {
        success: true,
        message: `No passages found matching "${query}" with similarity >= ${minSimilarity}`,
        data: { harvested: 0 },
        teaching: {
          whatHappened: 'Search found no results meeting your similarity threshold.',
          guiPath: ['Archive Panel', 'Explore Tab', 'Semantic Search'],
          why: 'Try a different query or lower the similarity threshold.',
        },
      };
    }

    // Add each result as a passage to the book
    const addedPassages: Array<{ id: string; content: string; similarity: number; type: string; source: string }> = [];
    const skippedPassages: Array<{ reason: string; title?: string }> = [];

    // Unified API returns both AI messages and content items (Facebook posts/comments)
    for (const result of results as Array<{
      id: string;
      type: 'message' | 'post' | 'comment' | 'document';
      source: string;
      content: string;
      title?: string;
      similarity: number;
      // Message-specific fields
      conversationId?: string;
      conversationTitle?: string;
      messageRole?: string;
      // Content item fields
      authorName?: string;
      isOwnContent?: boolean;
    }>) {
      const resultTitle = result.conversationTitle || result.title || `${result.source}: ${result.type}`;

      // DEBT-002 FIX: Validate content before saving to prevent corrupted passages
      if (!result.content) {
        skippedPassages.push({ reason: 'Missing content', title: resultTitle });
        continue;
      }

      // Check for placeholder/degraded content patterns
      if (result.content.startsWith('[Conversation:') || result.content.includes('Use semantic search for full')) {
        skippedPassages.push({ reason: 'Placeholder content detected', title: resultTitle });
        continue;
      }

      // Minimum content threshold (at least 10 words)
      const wordCount = result.content.split(/\s+/).length;
      if (wordCount < 10) {
        skippedPassages.push({ reason: `Content too short (${wordCount} words)`, title: resultTitle });
        continue;
      }

      // Determine role based on content type
      // - Messages have messageRole
      // - Facebook posts/comments: isOwnContent ? 'user' : 'assistant'
      let role: 'user' | 'assistant' = 'assistant';
      if (result.type === 'message') {
        role = (result.messageRole as 'user' | 'assistant') || 'assistant';
      } else if (result.isOwnContent) {
        role = 'user'; // User's own Facebook posts/comments
      }

      // Build tags based on content type and source
      const tags = ['harvested', query.split(' ')[0]];
      if (result.source === 'facebook') tags.push('facebook');
      if (result.type !== 'message') tags.push(result.type);

      const passage = context.addPassage({
        content: result.content,
        conversationId: result.conversationId || result.id, // Use id for non-message content
        conversationTitle: resultTitle,
        role,
        tags,
      });

      if (passage) {
        addedPassages.push({
          id: passage.id,
          content: result.content.substring(0, 100) + '...',
          similarity: result.similarity,
          type: result.type,
          source: result.source,
        });
      }
    }

    // Report any skipped passages to user
    if (skippedPassages.length > 0) {
      console.warn('[harvest_archive] Skipped passages due to validation:', skippedPassages);
    }

    // Build informative message including any skipped passages
    const skippedInfo = skippedPassages.length > 0
      ? ` (${skippedPassages.length} skipped due to validation)`
      : '';

    // Count sources for reporting
    const sourceBreakdown = addedPassages.reduce((acc, p) => {
      const key = p.type === 'message' ? 'AI conversations' : `Facebook ${p.type}s`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const sourceInfo = Object.entries(sourceBreakdown)
      .map(([k, v]) => `${v} from ${k}`)
      .join(', ');

    return {
      success: addedPassages.length > 0,
      message: addedPassages.length > 0
        ? `Harvested ${addedPassages.length} passages for "${query}" (${sourceInfo})${skippedInfo}`
        : `No valid passages found for "${query}". ${results.length} results were skipped due to content validation.`,
      data: {
        harvested: addedPassages.length,
        passages: addedPassages,
        skipped: skippedPassages,
        query,
        minSimilarity,
        sourceBreakdown,
      },
      teaching: {
        whatHappened: addedPassages.length > 0
          ? `Searched all content types (AI conversations + Facebook), found ${results.length} results, validated content, and added ${addedPassages.length} to your bookshelf${skippedInfo}`
          : `Search returned ${results.length} results, but none passed content validation. This may indicate an issue with embeddings or data quality.`,
        guiPath: [
          'Archive Panel → Explore Tab → Semantic Search',
          'Select passages you want',
          'Click "Add to Bookshelf"',
        ],
        why: addedPassages.length > 0
          ? 'Harvesting brings relevant content from your archive into your book project for curation.'
          : 'Content validation ensures only meaningful passages are added to your book. Check that embeddings are built and try different search terms.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Harvest failed',
    };
  }
}

/**
 * Generate a first draft chapter from approved passages
 */
async function executeGenerateFirstDraft(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { chapterTitle, passageIds, style } = params as {
    chapterTitle?: string;
    passageIds?: string[];
    style?: string;
  };

  if (!chapterTitle) {
    return { success: false, error: 'Missing chapterTitle parameter' };
  }

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  if (!context.getPassages || !context.createChapter) {
    return { success: false, error: 'Book operations not available' };
  }

  try {
    // Get passages - either specified or approved/gem passages
    const allPassages = context.getPassages();
    let sourcePas: SourcePassage[];

    if (passageIds && passageIds.length > 0) {
      sourcePas = allPassages.filter(p => passageIds.includes(p.id));
    } else {
      // Use approved or gem passages
      sourcePas = allPassages.filter(
        p => p.curation?.status === 'approved' || p.curation?.status === 'gem'
      );
    }

    if (sourcePas.length === 0) {
      return {
        success: false,
        error: 'No passages available. Add some passages to the bookshelf and mark them as approved or gem first.',
      };
    }

    // Collect passage content
    const passageContent = sourcePas
      .map((p, i) => `[Passage ${i + 1}]\n${p.content}`)
      .join('\n\n---\n\n');

    // Build prompt for draft generation
    const prompt = `You are writing a chapter titled "${chapterTitle}" for a book.
${style ? `Write in the style: ${style}` : ''}

Use the following passages as source material. Weave them together into a coherent chapter.
Preserve the key ideas but improve flow. Add transitions where needed.
Do not use meta-commentary - just write the chapter content.

=== SOURCE PASSAGES ===
${passageContent}
=== END PASSAGES ===

Write the chapter now:`;

    // Call LLM via the npe-api
    const token = await getStoredToken();
    const llmResponse = await fetch(`${NPE_API_BASE}/transform/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        maxTokens: 2000,
        model: 'haiku', // Fast for drafts
      }),
    });

    if (!llmResponse.ok) {
      // Fallback: just concatenate passages
      const fallbackContent = `# ${chapterTitle}\n\n${sourcePas.map(p => p.content).join('\n\n')}`;

      const chapter = context.createChapter(chapterTitle, fallbackContent);
      if (!chapter) {
        return { success: false, error: 'Failed to create chapter' };
      }

      return {
        success: true,
        message: `Created draft chapter "${chapterTitle}" (passages concatenated - LLM unavailable)`,
        data: {
          chapterId: chapter.id,
          chapterNumber: chapter.number,
          wordCount: chapter.wordCount,
          passageCount: sourcePas.length,
          mode: 'fallback',
        },
        teaching: {
          whatHappened: `Created chapter from ${sourcePas.length} passages (LLM generation unavailable, used concatenation)`,
          guiPath: ['Book Panel', 'Chapters', chapter.title],
          why: 'The chapter was created from your source material. Edit it to improve flow and add transitions.',
        },
      };
    }

    const llmData = await llmResponse.json();
    const generatedContent = llmData.text || llmData.content || '';

    // Create the chapter with generated content
    const fullContent = `# ${chapterTitle}\n\n${generatedContent}`;
    const chapter = context.createChapter(chapterTitle, fullContent);

    if (!chapter) {
      return { success: false, error: 'Failed to create chapter' };
    }

    return {
      success: true,
      message: `Created draft chapter "${chapterTitle}" from ${sourcePas.length} passages`,
      data: {
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        wordCount: chapter.wordCount,
        passageCount: sourcePas.length,
        mode: 'generated',
      },
      teaching: {
        whatHappened: `Wove ${sourcePas.length} passages into a ${chapter.wordCount}-word chapter draft`,
        guiPath: ['Book Panel', 'Chapters', chapter.title, 'Edit'],
        why: 'First drafts are starting points. Review, revise, and refine to make it yours.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Draft generation failed',
    };
  }
}

/**
 * Fill an existing chapter using the local chapter-filler service
 * Uses approved book passages and local LLM (Ollama)
 */
async function executeFillChapter(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { chapterId, style, targetWords, additionalQueries } = params as {
    chapterId?: string;
    style?: 'academic' | 'narrative' | 'conversational';
    targetWords?: number;
    additionalQueries?: string[];
  };

  if (!chapterId) {
    return { success: false, error: 'Missing chapterId parameter' };
  }

  if (!context.activeProject) {
    return { success: false, error: 'No active book project' };
  }

  // Check if we have Electron API
  const electronAPI = (window as unknown as { electronAPI?: { xanadu?: { chapters?: { fill?: (chapterId: string, bookId: string, options?: Record<string, unknown>) => Promise<{ success: boolean; chapter?: { id: string; title: string; content: string; wordCount: number }; stats?: { passagesFound: number; passagesUsed: number; generationTimeMs: number; queriesUsed: string[] }; error?: string }> } } } })?.electronAPI;

  if (!electronAPI?.xanadu?.chapters?.fill) {
    return {
      success: false,
      error: 'Local chapter filling not available. Use generate_first_draft instead.',
    };
  }

  try {
    const bookId = context.activeProject.id;
    const result = await electronAPI.xanadu.chapters.fill(chapterId, bookId, {
      style: style || 'academic',
      targetWords: targetWords || 500,
      additionalQueries: additionalQueries || [],
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Chapter fill failed',
        teaching: {
          whatHappened: 'Failed to generate chapter content',
          guiPath: ['Archive', 'Books', 'Select Book', 'Chapter', 'Fill button'],
          why: result.error?.includes('No relevant passages')
            ? 'Harvest some passages first using harvest_archive, then mark them as approved.'
            : 'Check that Ollama is running and the book has approved passages.',
        },
      };
    }

    return {
      success: true,
      message: `Filled chapter "${result.chapter?.title}" with ${result.chapter?.wordCount} words from ${result.stats?.passagesUsed} passages`,
      data: {
        chapterId: result.chapter?.id,
        title: result.chapter?.title,
        wordCount: result.chapter?.wordCount,
        passagesFound: result.stats?.passagesFound,
        passagesUsed: result.stats?.passagesUsed,
        generationTimeMs: result.stats?.generationTimeMs,
      },
      teaching: {
        whatHappened: `Generated ${result.chapter?.wordCount} words using ${result.stats?.passagesUsed} approved passages and local LLM`,
        guiPath: ['Archive', 'Books', 'Chapters Tab', 'Click chapter to view'],
        why: 'The chapter was filled using your curated passages. Edit it to refine the narrative flow.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Fill chapter failed',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// AGENT TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List available agents in the council
 */
function executeListAgents(): AUIToolResult {
  try {
    const bridge = getAgentBridge();
    const agents = bridge.getAgents();
    const isConnected = bridge.isConnected();

    if (!isConnected) {
      return {
        success: true,
        message: 'Agent council not connected (running in standalone mode)',
        data: { connected: false, agents: [] },
      };
    }

    const statusEmoji: Record<string, string> = {
      idle: '🟢',
      working: '🔵',
      waiting: '🟡',
      error: '🔴',
      disabled: '⚫',
    };

    return {
      success: true,
      message: `${agents.length} agent(s) available`,
      data: {
        connected: true,
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          house: a.house,
          status: `${statusEmoji[a.status] || '?'} ${a.status}`,
          capabilities: a.capabilities,
        })),
      },
      teaching: {
        whatHappened: `Found ${agents.length} agents in the council`,
        guiPath: ['Settings', 'Agent Council', 'View Agents'],
        why: 'Agents assist with harvesting, curating, building, and reviewing your book content.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list agents',
    };
  }
}

/**
 * Get status of a specific agent
 */
function executeGetAgentStatus(params: Record<string, unknown>): AUIToolResult {
  const { agentId } = params as { agentId?: string };

  if (!agentId) {
    return { success: false, error: 'Missing agentId parameter' };
  }

  try {
    const bridge = getAgentBridge();
    const agents = bridge.getAgents();
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${agentId}. Available: ${agents.map(a => a.id).join(', ')}`,
      };
    }

    const statusEmoji: Record<string, string> = {
      idle: '🟢 Ready',
      working: '🔵 Working',
      waiting: '🟡 Waiting for approval',
      error: '🔴 Error',
      disabled: '⚫ Disabled',
    };

    return {
      success: true,
      message: `${agent.name}: ${statusEmoji[agent.status] || agent.status}`,
      data: {
        id: agent.id,
        name: agent.name,
        house: agent.house,
        status: agent.status,
        statusDescription: statusEmoji[agent.status] || agent.status,
        capabilities: agent.capabilities,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get agent status',
    };
  }
}

/**
 * List pending proposals from agents
 */
function executeListPendingProposals(): AUIToolResult {
  try {
    const bridge = getAgentBridge();
    const proposals = bridge.getPendingProposals();

    if (proposals.length === 0) {
      return {
        success: true,
        message: 'No pending agent proposals',
        data: { proposals: [] },
      };
    }

    const urgencyEmoji: Record<string, string> = {
      low: '📋',
      normal: '📝',
      high: '⚡',
      critical: '🚨',
    };

    return {
      success: true,
      message: `${proposals.length} pending proposal(s)`,
      data: {
        proposals: proposals.map(p => ({
          id: p.id,
          agent: p.agentName,
          urgency: `${urgencyEmoji[p.urgency] || ''} ${p.urgency}`,
          action: p.actionType,
          title: p.title,
          description: p.description,
          createdAt: new Date(p.createdAt).toLocaleTimeString(),
          expiresAt: p.expiresAt ? new Date(p.expiresAt).toLocaleTimeString() : null,
        })),
      },
      teaching: {
        whatHappened: `Found ${proposals.length} proposals awaiting your decision`,
        guiPath: ['AUI Chat', 'View proposal', 'Approve or Reject'],
        why: 'Agents propose actions that may need your approval. Review and approve to let them proceed.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list proposals',
    };
  }
}

/**
 * Request work from a specific agent
 */
async function executeRequestAgent(params: Record<string, unknown>): Promise<AUIToolResult> {
  const { agentId, taskType, payload, projectId } = params as {
    agentId?: string;
    taskType?: string;
    payload?: Record<string, unknown>;
    projectId?: string;
  };

  if (!agentId) {
    return { success: false, error: 'Missing agentId parameter' };
  }

  if (!taskType) {
    return { success: false, error: 'Missing taskType parameter' };
  }

  try {
    const bridge = getAgentBridge();

    // Verify agent exists
    const agents = bridge.getAgents();
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
      return {
        success: false,
        error: `Agent not found: ${agentId}. Available: ${agents.map(a => a.id).join(', ')}`,
      };
    }

    // Request work
    const result = await bridge.requestAgentWork(agentId, taskType, payload || {}, projectId);

    if ('error' in result) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      message: `Requested ${taskType} from ${agent.name}`,
      data: {
        taskId: result.taskId,
        agent: agentId,
        taskType,
      },
      teaching: {
        whatHappened: `Dispatched a "${taskType}" task to ${agent.name}`,
        guiPath: ['AUI Chat', 'View pending proposals', 'Approve when ready'],
        why: 'The agent will work on your request and may propose actions for your approval.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to request agent work',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Passage reference within a discovered thread
 */
interface ThreadPassage {
  /** Passage ID */
  id: string;
  /** Preview text (first 100 chars) */
  text: string;
  /** Jaccard similarity to the thread theme (0.0 to 1.0) */
  similarity: number;
}

/**
 * A thematic thread discovered from passage analysis
 */
interface DiscoveredThread {
  /** Theme keyword (capitalized) */
  theme: string;
  /** Passages belonging to this thread */
  passages: ThreadPassage[];
}

/**
 * Discover thematic threads in passages using AI clustering
 * Groups similar passages together to reveal common themes
 */
async function executeDiscoverThreads(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { minPassages, maxThreads } = params as {
    minPassages?: number;
    maxThreads?: number;
  };

  // Get passages from book context
  if (!context.activeProject) {
    return {
      success: false,
      error: 'No active book project. Open a book project first.',
    };
  }

  const passages = context.getPassages?.() || [];
  if (passages.length < 3) {
    return {
      success: false,
      error: `Need at least 3 passages to discover threads. Currently have ${passages.length}.`,
    };
  }

  try {
    // Group passages by similarity using simple text clustering
    // In a full implementation, this would use embeddings
    const threads: DiscoveredThread[] = [];

    // Simple keyword extraction and grouping
    const keywordMap = new Map<string, string[]>();
    const passageKeywords = new Map<string, string[]>();

    // Extract keywords from each passage
    for (const passage of passages) {
      const text = typeof passage.content === 'string' ? passage.content : JSON.stringify(passage.content);
      // Simple keyword extraction (words 5+ chars, not common words)
      const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'where', 'these', 'those', 'being', 'having', 'making', 'during', 'through']);
      const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 5 && !commonWords.has(w));

      // Count word frequency
      const wordFreq = new Map<string, number>();
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }

      // Top keywords for this passage
      const topKeywords = Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([w]) => w);

      passageKeywords.set(passage.id, topKeywords);

      // Build global keyword → passage mapping
      for (const kw of topKeywords) {
        if (!keywordMap.has(kw)) {
          keywordMap.set(kw, []);
        }
        keywordMap.get(kw)!.push(passage.id);
      }
    }

    // Find keywords that appear in multiple passages (themes)
    const themeKeywords = Array.from(keywordMap.entries())
      .filter(([, ids]) => ids.length >= (minPassages || 2))
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxThreads || 5);

    // Build threads from theme keywords
    const usedPassages = new Set<string>();
    for (const [theme, passageIds] of themeKeywords) {
      if (threads.length >= (maxThreads || 5)) break;

      const threadPassages = passageIds
        .filter((id: string) => !usedPassages.has(id))
        .map((id: string) => {
          const p = passages.find((p: SourcePassage) => p.id === id);
          if (!p) return null;
          usedPassages.add(id);

          // Calculate Jaccard similarity: how many of this passage's keywords match the theme
          const pKeywords = passageKeywords.get(id) || [];
          const matchingKeywords = pKeywords.filter((kw: string) => kw === theme.toLowerCase());
          const totalKeywords = Math.max(pKeywords.length, 1);
          const similarity = matchingKeywords.length / totalKeywords;

          return {
            id: p.id,
            text: (typeof p.content === 'string' ? p.content : '').slice(0, 100) + '...',
            similarity: Math.round(similarity * 100) / 100, // 0.0 to 1.0
          };
        })
        .filter(Boolean) as ThreadPassage[];

      if (threadPassages.length >= (minPassages || 2)) {
        threads.push({
          theme: theme.charAt(0).toUpperCase() + theme.slice(1),
          passages: threadPassages,
        });
      }
    }

    // Group remaining unclustered passages
    const unclustered = passages
      .filter((p: SourcePassage) => !usedPassages.has(p.id))
      .map((p: SourcePassage) => ({
        id: p.id,
        text: (typeof p.content === 'string' ? p.content : '').slice(0, 100) + '...',
      }));

    return {
      success: true,
      message: `Discovered ${threads.length} thematic threads from ${passages.length} passages`,
      data: {
        totalPassages: passages.length,
        threadCount: threads.length,
        threads: threads.map(t => ({
          theme: t.theme,
          passageCount: t.passages.length,
          previewPassages: t.passages.slice(0, 3),
        })),
        unclusteredCount: unclustered.length,
        unclustered: unclustered.slice(0, 5),
      },
      teaching: {
        whatHappened: `Analyzed ${passages.length} passages and found ${threads.length} common themes`,
        guiPath: ['Bookshelf', 'Threads', 'Review grouped passages'],
        why: 'Discovering threads helps you see patterns in your collected material and organize chapters around themes.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Thread discovery failed',
    };
  }
}

/**
 * Start a guided book-building workflow
 * Orchestrates multiple agents to help build a book step by step
 */
async function executeStartBookWorkflow(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { workflowType, topic } = params as {
    workflowType?: 'harvest' | 'curate' | 'build' | 'full';
    topic?: string;
  };

  if (!context.activeProject) {
    return {
      success: false,
      error: 'No active book project. Create or open a book project first.',
    };
  }

  const workflow = workflowType || 'full';
  const projectTitle = context.activeProject.name || 'Untitled Book';

  try {
    // Define workflow steps based on type
    const steps: Array<{
      name: string;
      agentId: string;
      taskType: string;
      description: string;
    }> = [];

    switch (workflow) {
      case 'harvest':
        steps.push({
          name: 'Search Archive',
          agentId: 'harvester',
          taskType: 'search-archive',
          description: `Search for passages about "${topic || 'your topic'}"`,
        });
        break;

      case 'curate':
        steps.push({
          name: 'Assess Quality',
          agentId: 'curator',
          taskType: 'assess-passages',
          description: 'Review passages for book-worthiness',
        });
        steps.push({
          name: 'Organize Content',
          agentId: 'curator',
          taskType: 'organize-passages',
          description: 'Group passages by theme',
        });
        break;

      case 'build':
        steps.push({
          name: 'Discover Threads',
          agentId: 'builder',
          taskType: 'discover-threads',
          description: 'Find thematic patterns',
        });
        steps.push({
          name: 'Compose Chapters',
          agentId: 'builder',
          taskType: 'compose-chapter',
          description: 'Draft chapters from passages',
        });
        break;

      case 'full':
      default:
        steps.push({
          name: 'Harvest',
          agentId: 'harvester',
          taskType: 'search-archive',
          description: `Search for passages about "${topic || 'your topic'}"`,
        });
        steps.push({
          name: 'Curate',
          agentId: 'curator',
          taskType: 'assess-passages',
          description: 'Review and approve passages',
        });
        steps.push({
          name: 'Build Pyramid',
          agentId: 'builder',
          taskType: 'build-pyramid',
          description: 'Create hierarchical summary',
        });
        steps.push({
          name: 'Compose',
          agentId: 'builder',
          taskType: 'compose-chapter',
          description: 'Draft chapters from approved content',
        });
        steps.push({
          name: 'Review',
          agentId: 'reviewer',
          taskType: 'review-content',
          description: 'Check AI detection and quality',
        });
        break;
    }

    // Get current status
    const allPassages = context.getPassages?.() || [];
    const passageCount = allPassages.length;
    const approvedCount = allPassages.filter(
      (p: SourcePassage) => p.status === 'approved' || p.status === 'gem'
    ).length;
    const chapterCount = context.activeProject?.chapters?.length || 0;

    return {
      success: true,
      message: `Starting ${workflow} workflow for "${projectTitle}"`,
      data: {
        workflowType: workflow,
        project: projectTitle,
        currentState: {
          passages: passageCount,
          approved: approvedCount,
          chapters: chapterCount,
        },
        steps: steps.map((s, i) => ({
          step: i + 1,
          name: s.name,
          agent: s.agentId,
          description: s.description,
          status: 'pending',
        })),
        nextAction: steps[0]
          ? `First, the ${steps[0].agentId} will ${steps[0].description.toLowerCase()}`
          : 'No steps defined',
      },
      teaching: {
        whatHappened: `Initialized the "${workflow}" workflow with ${steps.length} steps`,
        guiPath: ['AUI Chat', 'Follow prompts', 'Approve agent proposals'],
        why: 'Guided workflows break complex tasks into manageable steps. Each agent specializes in a part of the process.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to start workflow',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3: HARVEST BUCKET TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * Harvest passages from archive into a HarvestBucket for review
 * Creates a staging area where users can approve/reject/gem passages
 */
async function executeHarvestForThread(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, queries, config } = params as {
    book_uri?: string;
    queries?: string[];
    config?: {
      min_similarity?: number;
      max_results?: number;
      sources?: string[];
    };
  };

  // Get book URI from params or active project
  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project. Create or select a book first.',
    };
  }

  if (!queries || queries.length === 0) {
    return {
      success: false,
      error: 'Missing queries parameter. Provide at least one search query.',
    };
  }

  const minSimilarity = config?.min_similarity || 0.65;
  const maxResults = config?.max_results || 50;

  try {
    // Initialize harvest bucket service
    harvestBucketService.initialize();

    // Create a harvest bucket for this search
    const bucket = harvestBucketService.createBucket(bookUri, queries, {
      config: {
        minSimilarity,
        dedupeByContent: true,
        dedupeThreshold: 0.9,
      },
      initiatedBy: 'aui',
    });

    // Search archive for each query
    const archiveServer = await getArchiveServerUrl();
    let totalCandidates = 0;
    const resultsPerQuery = Math.ceil(maxResults / queries.length);

    for (const query of queries) {
      try {
        const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, limit: resultsPerQuery * 2 }),
        });

        if (!response.ok) continue;

        const data = await response.json();

        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.results) {
          console.warn('[search_images] API response missing results field');
        }
        const results = (data.results || [])
          .filter((r: { similarity: number }) => r.similarity >= minSimilarity)
          .slice(0, resultsPerQuery);

        // Convert to SourcePassage format and add as candidates
        for (const result of results as Array<{
          message_id: string;
          content: string;
          conversation_id: string;
          role: string;
          similarity: number;
          metadata?: { title?: string };
        }>) {
          const passage: SourcePassage = {
            id: result.message_id || crypto.randomUUID(),
            text: result.content,
            wordCount: result.content?.split(/\s+/).length || 0,
            sourceRef: {
              uri: `source://chatgpt/${result.conversation_id}` as `${string}://${string}`,
              sourceType: 'chatgpt',
              conversationId: result.conversation_id,
              conversationTitle: result.metadata?.title || `Harvested: ${query}`,
            },
            similarity: result.similarity,
            curation: {
              status: 'candidate',
            },
            tags: ['harvested', query.split(' ')[0]],
            harvestedBy: query,
          };

          harvestBucketService.addCandidate(bucket.id, passage);
          totalCandidates++;
        }
      } catch (e) {
        console.warn(`[harvest_for_thread] Query "${query}" failed:`, e);
      }
    }

    // Mark bucket as ready for review
    harvestBucketService.finishCollecting(bucket.id);

    // Get updated bucket with stats
    const updatedBucket = harvestBucketService.getBucket(bucket.id);

    // GUI Bridge: Open Tools panel → Harvest tab to show results
    dispatchOpenPanel('tools', 'harvest');

    return {
      success: true,
      message: `Harvested ${totalCandidates} passages from ${queries.length} queries`,
      data: {
        bucketId: bucket.id,
        candidateCount: totalCandidates,
        queries,
        status: 'reviewing',
        stats: updatedBucket?.stats,
      },
      teaching: {
        whatHappened: `Created a harvest bucket with ${totalCandidates} passages for review`,
        guiPath: [
          'Open the Tools panel (right side)',
          'Click the "Harvest" tab',
          'Review each passage - approve, reject, or mark as gem',
          'Stage when ready, then commit to book',
        ],
        why: 'The harvest bucket is a staging area. Review passages before they become part of your book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Harvest failed',
    };
  }
}

/**
 * Propose a narrative arc based on approved passages
 * Clusters passages by theme and suggests chapter structure
 */
async function executeProposeNarrativeArc(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, arc_type, thesis } = params as {
    book_uri?: string;
    arc_type?: ArcType;
    thesis?: string;
  };

  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project.',
    };
  }

  // Get passages from context
  const passages = context.getPassages?.() || [];
  const approvedPassages = passages.filter(
    (p: SourcePassage) => p.curation?.status === 'approved' || p.curation?.status === 'gem'
  );

  if (approvedPassages.length < 3) {
    return {
      success: false,
      error: `Need at least 3 approved passages to propose a narrative arc. Currently have ${approvedPassages.length}.`,
    };
  }

  try {
    harvestBucketService.initialize();

    // Simple theme extraction (keyword clustering)
    const themeMap = new Map<string, string[]>();
    const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'where', 'these', 'those', 'being', 'having', 'making', 'during', 'through', 'because', 'while', 'after', 'before', 'between', 'within', 'without', 'something', 'anything', 'everything', 'nothing']);

    for (const passage of approvedPassages) {
      const text = typeof passage.content === 'string' ? passage.content : '';
      const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length >= 5 && !commonWords.has(w));

      // Count frequencies
      const wordFreq = new Map<string, number>();
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }

      // Top keywords
      const topKeywords = Array.from(wordFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => w);

      for (const kw of topKeywords) {
        if (!themeMap.has(kw)) themeMap.set(kw, []);
        themeMap.get(kw)!.push(passage.id);
      }
    }

    // Find major themes (appearing in 2+ passages)
    const themes = Array.from(themeMap.entries())
      .filter(([, ids]) => ids.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    // Build ArcTheme structures
    const arcThemes = themes.map(([name, passageIds], index) => ({
      id: `theme-${index + 1}`,
      name,
      description: `Theme appearing in ${passageIds.length} passages`,
      passageIds,
      coherence: passageIds.length / approvedPassages.length,
      relationships: [] as Array<{ targetThemeId: string; type: 'depends-on' | 'contrasts-with' | 'leads-to' | 'part-of'; strength: number }>,
    }));

    // Build ChapterOutline structures
    const chapters = themes.map(([theme, passageIds], index) => ({
      number: index + 1,
      title: theme.charAt(0).toUpperCase() + theme.slice(1),
      purpose: `Explore the theme of ${theme}`,
      primaryThemeId: `theme-${index + 1}`,
      passageIds,
      estimatedWordCount: passageIds.reduce((sum, id) => {
        const p = approvedPassages.find((p: SourcePassage) => p.id === id);
        return sum + (p?.wordCount || 0);
      }, 0),
    }));

    // Create narrative arc
    const arc = harvestBucketService.createArc(
      bookUri,
      thesis || `A ${arc_type || 'linear'} narrative exploring ${themes.map(([t]) => t).join(', ')}`,
      {
        arcType: arc_type || 'linear',
        proposedBy: 'aui',
      }
    );

    // Update arc with themes and chapters
    harvestBucketService.updateArc(arc.id, {
      themes: arcThemes,
      chapters,
    });

    return {
      success: true,
      message: `Proposed ${chapters.length}-chapter arc with ${themes.length} themes`,
      data: {
        arcId: arc.id,
        arcType: arc_type || 'linear',
        thesis: arc.thesis,
        chapters: chapters.map(c => ({
          title: c.title,
          passageCount: c.passageIds.length,
          estimatedWords: c.estimatedWordCount,
        })),
        themes: themes.map(([name, ids]) => ({
          name,
          passageCount: ids.length,
        })),
      },
      teaching: {
        whatHappened: `Analyzed ${approvedPassages.length} passages and proposed a ${chapters.length}-chapter structure`,
        guiPath: [
          'Archive → Books → [project] → Thinking tab',
          'Review proposed arc',
          'Approve or provide feedback',
        ],
        why: 'Narrative arcs help organize passages into a coherent story. Review and adjust the proposed structure.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to propose narrative arc',
    };
  }
}

/**
 * Trace a narrative arc through the archive
 * Uses semantic search to find chronological progression of a theme
 *
 * This tool helps find:
 * - How an idea evolved over time
 * - The progressive revelation of a theme
 * - Chronological story threads
 */
async function executeTraceNarrativeArc(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const {
    theme,
    start_date,
    end_date,
    arc_type = 'progressive',
    limit = 20,
    save_to_harvest = false,
  } = params as {
    theme: string;
    start_date?: string;
    end_date?: string;
    arc_type?: 'progressive' | 'chronological' | 'thematic' | 'dialectic';
    limit?: number;
    save_to_harvest?: boolean;
  };

  if (!theme) {
    return {
      success: false,
      error: 'Provide a theme to trace through the archive.',
    };
  }

  try {
    const archiveServer = await getArchiveServerUrl();

    // Build search queries based on arc type
    const queries: string[] = [];
    switch (arc_type) {
      case 'progressive':
        // Find how understanding evolved
        queries.push(theme);
        queries.push(`early thoughts on ${theme}`);
        queries.push(`realization about ${theme}`);
        queries.push(`understanding ${theme}`);
        queries.push(`conclusion about ${theme}`);
        break;
      case 'chronological':
        // Just search the theme, will sort by date
        queries.push(theme);
        break;
      case 'thematic':
        // Find variations on the theme
        queries.push(theme);
        queries.push(`${theme} and its implications`);
        queries.push(`different aspects of ${theme}`);
        break;
      case 'dialectic':
        // Find thesis, antithesis, synthesis
        queries.push(`${theme} thesis argument for`);
        queries.push(`${theme} counterpoint against critique`);
        queries.push(`${theme} synthesis resolution integration`);
        break;
    }

    // Collect results from all queries
    const allResults: Array<{
      id: string;
      content: string;
      similarity: number;
      conversation_id: string;
      message_id?: string;
      created_at?: number;
      title?: string;
      query_phase: string;
    }> = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: Math.ceil(limit / queries.length) * 2,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.results) {
          console.warn('[find_similar_images] API response missing results field');
        }
        const results = data.results || [];

        for (const r of results) {
          // Skip duplicates
          if (!allResults.some(ar => ar.message_id === r.message_id)) {
            allResults.push({
              id: r.id || r.message_id,
              content: r.content,
              similarity: r.similarity,
              conversation_id: r.conversation_id,
              message_id: r.message_id,
              created_at: r.created_at,
              title: r.metadata?.title || r.conversation_title,
              query_phase: arc_type === 'progressive' ?
                ['beginning', 'early', 'middle', 'development', 'conclusion'][i] || 'middle' :
                arc_type === 'dialectic' ?
                  ['thesis', 'antithesis', 'synthesis'][i] || 'thesis' :
                  'thematic',
            });
          }
        }
      }
    }

    // Sort by date for chronological arc, or by query phase for progressive
    if (arc_type === 'chronological') {
      allResults.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    }

    // Limit results
    const arcResults = allResults.slice(0, limit);

    // Group by phase for progressive/dialectic arcs
    const phases = new Map<string, typeof arcResults>();
    for (const r of arcResults) {
      const phase = r.query_phase;
      if (!phases.has(phase)) {
        phases.set(phase, []);
      }
      phases.get(phase)!.push(r);
    }

    // Optionally save to harvest bucket
    let bucketId: string | undefined;
    if (save_to_harvest && context.activeProject) {
      const { harvestBucketService } = await import('../bookshelf/HarvestBucketService');
      harvestBucketService.initialize();

      const bookUri = (context.activeProject as BookProject & { uri?: string })?.uri;
      if (bookUri) {
        const bucket = harvestBucketService.createBucket(bookUri, [theme], {
          initiatedBy: 'aui',
        });
        bucketId = bucket.id;

        // Add results as candidates
        for (const r of arcResults) {
          const passage: SourcePassage = {
            id: r.message_id || crypto.randomUUID(),
            text: r.content,
            wordCount: r.content?.split(/\s+/).length || 0,
            sourceRef: {
              uri: `source://chatgpt/${r.conversation_id}` as `${string}://${string}`,
              sourceType: 'chatgpt',
              conversationId: r.conversation_id,
              conversationTitle: r.title || 'Arc Trace',
            },
            similarity: r.similarity,
            curation: {
              status: 'candidate',
            },
            tags: ['arc-trace', r.query_phase, theme.split(' ')[0]],
          };
          harvestBucketService.addCandidate(bucket.id, passage);
        }

        harvestBucketService.finishCollecting(bucket.id);
        dispatchOpenPanel('tools', 'harvest');
      }
    }

    // Format arc structure for response
    const arcStructure = Array.from(phases.entries()).map(([phase, passages]) => ({
      phase,
      count: passages.length,
      samples: passages.slice(0, 2).map(p => ({
        preview: p.content.slice(0, 150) + '...',
        source: p.title,
        date: p.created_at ? new Date(p.created_at).toLocaleDateString() : undefined,
      })),
    }));

    // Dispatch to GUI
    dispatchSearchResults({
      results: arcResults.map(r => ({
        id: r.id,
        content: r.content,
        similarity: r.similarity,
        conversationId: r.conversation_id,
        title: r.title,
      })),
      query: theme,
      searchType: 'semantic',
      total: arcResults.length,
    }, theme);
    dispatchOpenPanel('archives', 'explore');

    return {
      success: true,
      message: `Traced "${theme}" arc: found ${arcResults.length} passages across ${phases.size} phases`,
      data: {
        theme,
        arcType: arc_type,
        totalPassages: arcResults.length,
        phases: arcStructure,
        bucketId,
        dateRange: arcResults.length > 0 ? {
          earliest: arcResults.find(r => r.created_at)?.created_at,
          latest: [...arcResults].reverse().find(r => r.created_at)?.created_at,
        } : undefined,
      },
      teaching: {
        whatHappened: `Found ${arcResults.length} passages tracing the "${arc_type}" arc of "${theme}"`,
        guiPath: [
          'Results shown in Archive → Explore tab',
          save_to_harvest ? 'Also saved to Tools → Harvest for curation' : 'Use save_to_harvest: true to save for curation',
          'Click any result to see full context',
        ],
        why: arc_type === 'progressive' ?
          'Progressive arcs show how understanding evolved over time - the journey of an idea.' :
          arc_type === 'dialectic' ?
            'Dialectic arcs show thesis/antithesis/synthesis - the resolution of tensions.' :
            'Chronological arcs reveal when ideas emerged and how they relate in time.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to trace narrative arc',
    };
  }
}

/**
 * Find passages that resonate semantically with a given passage
 * Uses embedding similarity to discover connections
 */
async function executeFindResonantMirrors(
  params: Record<string, unknown>,
  _context: AUIContext
): Promise<AUIToolResult> {
  const { passage_id, passage_text, search_scope, limit = 10 } = params as {
    passage_id?: string;
    passage_text?: string;
    search_scope?: 'book' | 'archive' | 'all';
    limit?: number;
  };

  if (!passage_text && !passage_id) {
    return {
      success: false,
      error: 'Provide either passage_text or passage_id to find resonant mirrors.',
    };
  }

  try {
    const archiveServer = await getArchiveServerUrl();
    const query = passage_text || '';

    // Search for similar messages
    const response = await fetch(`${archiveServer}/api/embeddings/search/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: limit * 2 }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'Semantic search failed. Ensure embeddings are built.',
      };
    }

    const data = await response.json();

    // Validate API response (per FALLBACK POLICY: no silent fallbacks)
    if (!data.results) {
      console.warn('[cluster_images] API response missing results field');
    }
    let results = data.results || [];

    // Filter by scope if book scope requested (would need book context)
    if (search_scope === 'book') {
      // For book scope, we'd need to filter by book passages
      // For now, just limit results
      results = results.slice(0, limit);
    } else {
      results = results.slice(0, limit);
    }

    const mirrors = results.map((r: {
      message_id: string;
      content: string;
      similarity: number;
      conversation_id: string;
      metadata?: { title?: string };
    }) => ({
      id: r.message_id,
      text: r.content?.slice(0, 200) + (r.content?.length > 200 ? '...' : ''),
      similarity: Math.round(r.similarity * 1000) / 1000,
      conversationId: r.conversation_id,
      conversationTitle: r.metadata?.title || 'Unknown',
    }));

    return {
      success: true,
      message: `Found ${mirrors.length} resonant passages`,
      data: {
        sourcePassageId: passage_id,
        sourceText: passage_text?.slice(0, 100) + '...',
        scope: search_scope || 'archive',
        mirrors,
      },
      teaching: {
        whatHappened: `Found ${mirrors.length} passages that resonate semantically with the source`,
        guiPath: [
          'Archive → Explore → Semantic Search',
          'Paste your passage text',
          'Results ranked by meaning similarity',
        ],
        why: 'Resonant mirrors reveal thematic connections across your archive. Use them to build richer narratives.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to find resonant mirrors',
    };
  }
}

/**
 * Detect narrative gaps in a book's chapter structure
 * Analyzes transitions and identifies missing content
 */
async function executeDetectNarrativeGaps(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const { book_uri, arc_id } = params as {
    book_uri?: string;
    arc_id?: string;
  };

  const bookUri = book_uri || (context.activeProject as BookProject & { uri?: string })?.uri;

  if (!bookUri) {
    return {
      success: false,
      error: 'No book URI provided and no active book project.',
    };
  }

  try {
    harvestBucketService.initialize();

    // Get arcs for this book
    const arcs = harvestBucketService.getArcsForBook(bookUri);
    const arc = arc_id ? arcs.find(a => a.id === arc_id) : arcs[0];

    if (!arc) {
      return {
        success: false,
        error: 'No narrative arc found. Use propose_narrative_arc first.',
      };
    }

    // Analyze chapters for gaps
    const chapters = (arc as NarrativeArc & { chapters?: Array<{ id: string; title: string; passageCount?: number; estimatedWordCount?: number }> }).chapters || [];
    const gaps: Array<{
      type: 'conceptual' | 'transitional' | 'emotional' | 'structural';
      location: string;
      description: string;
      suggestion: string;
    }> = [];

    // Check for structural gaps
    if (chapters.length < 3) {
      gaps.push({
        type: 'structural',
        location: 'book',
        description: 'Book has fewer than 3 chapters',
        suggestion: 'Consider breaking content into more chapters for better pacing.',
      });
    }

    // Check for thin chapters
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if ((chapter.passageCount || 0) < 2) {
        gaps.push({
          type: 'conceptual',
          location: `Chapter ${i + 1}: ${chapter.title}`,
          description: `Only ${chapter.passageCount || 0} passages`,
          suggestion: `Search archive for more content about "${chapter.title}".`,
        });
      }
      if ((chapter.estimatedWordCount || 0) < 500) {
        gaps.push({
          type: 'structural',
          location: `Chapter ${i + 1}: ${chapter.title}`,
          description: `Very short (~${chapter.estimatedWordCount || 0} words)`,
          suggestion: 'Consider merging with adjacent chapter or adding content.',
        });
      }
    }

    // Check for transitional gaps (no content between distinct themes)
    for (let i = 0; i < chapters.length - 1; i++) {
      const current = chapters[i];
      const next = chapters[i + 1];
      // Simple heuristic: if titles share no keywords, might need transition
      const currentWords = new Set(current.title.toLowerCase().split(/\s+/));
      const nextWords = new Set(next.title.toLowerCase().split(/\s+/));
      const overlap = [...currentWords].filter(w => nextWords.has(w)).length;

      if (overlap === 0 && currentWords.size > 0 && nextWords.size > 0) {
        gaps.push({
          type: 'transitional',
          location: `Between "${current.title}" and "${next.title}"`,
          description: 'Distinct themes with no obvious bridge',
          suggestion: `Look for passages that connect ${current.title} to ${next.title}.`,
        });
      }
    }

    return {
      success: true,
      message: `Found ${gaps.length} potential gaps in narrative`,
      data: {
        arcId: arc.id,
        chapterCount: chapters.length,
        gaps,
        summary: {
          conceptual: gaps.filter(g => g.type === 'conceptual').length,
          transitional: gaps.filter(g => g.type === 'transitional').length,
          structural: gaps.filter(g => g.type === 'structural').length,
        },
      },
      teaching: {
        whatHappened: `Analyzed ${chapters.length} chapters and found ${gaps.length} areas for improvement`,
        guiPath: [
          'Archive → Books → [project] → Thinking tab → Gaps',
          'Review each gap',
          'Use harvest_for_thread to fill conceptual gaps',
        ],
        why: 'Narrative gaps break reader flow. Filling them creates a more cohesive book.',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to detect narrative gaps',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// SYSTEM PROMPT → Moved to tools/system-prompt.ts
// ═══════════════════════════════════════════════════════════════════
