/**
 * Book Studio AUI Tools
 *
 * Tools that connect to the Book Studio API (port 3004) for:
 * - Card management (harvest, assign, move)
 * - Draft generation and versioning
 * - Voice extraction and application
 * - Harvest workflow (search, commit, iterate)
 *
 * These tools enable end-to-end book creation through the AUI.
 */

import type { AUIToolResult, AUIContext } from './types';
import {
  apiClient,
  type HarvestSearchResult,
  type HarvestHistoryEntry,
  type HarvestInstruction,
  type DraftVersion,
  type DraftComparison,
  type VoiceProfile,
  type VoiceApplicationResult,
} from '../../book-studio/api-client';
import type { HarvestCard, Chapter } from '../../book-studio/types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the active book ID from context
 * Supports both activeProject and activeBook patterns
 */
function getActiveBookId(context: AUIContext): string | null {
  return context.activeProject?.id || context.activeBook?.id || null;
}

/**
 * Format a card for display
 */
function formatCardSummary(card: HarvestCard): string {
  const preview = card.content.slice(0, 100) + (card.content.length > 100 ? '...' : '');
  return `- **${card.title || 'Untitled'}** (${card.status}): ${preview}`;
}

// ============================================================================
// Card Tools (5)
// ============================================================================

/**
 * list_cards - List all cards in active book
 */
export async function executeListCards(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const status = params.status as string | undefined;
  const chapterId = params.chapterId as string | undefined;

  try {
    let cards = await apiClient.listCards(bookId);

    // Filter by status if provided
    if (status) {
      cards = cards.filter(c => c.status === status);
    }

    // Filter by chapter if provided
    if (chapterId) {
      cards = cards.filter(c => c.suggestedChapterId === chapterId);
    }

    const stagingCount = cards.filter(c => c.status === 'staging').length;
    const placedCount = cards.filter(c => c.suggestedChapterId).length;

    return {
      success: true,
      message: `Found ${cards.length} cards (${stagingCount} staging, ${placedCount} placed)`,
      data: {
        cards: cards.slice(0, 20), // Limit to first 20 for display
        total: cards.length,
        stagingCount,
        placedCount,
      },
      teaching: {
        whatHappened: `Listed ${cards.length} cards from your book`,
        guiPath: ['Book Studio', 'Cards Panel'],
        why: 'Cards are harvested passages ready for organizing into chapters',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list cards',
    };
  }
}

/**
 * harvest_card - Create single card from content
 */
export async function executeHarvestCard(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const content = params.content as string;
  const title = params.title as string | undefined;
  const sourceType = (params.sourceType as string) || 'manual';
  const tags = (params.tags as string[]) || [];

  if (!content) {
    return {
      success: false,
      error: 'Content is required to harvest a card',
    };
  }

  try {
    const card: HarvestCard = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sourceId: `manual-${Date.now()}`,
      sourceType: (sourceType === 'manual' ? 'document' : sourceType) as HarvestCard['sourceType'],
      source: 'AUI Tool',
      contentOrigin: 'original',
      content,
      title,
      sourceCreatedAt: Math.floor(Date.now() / 1000),
      sourceCreatedAtStatus: 'unknown',
      harvestedAt: Math.floor(Date.now() / 1000),
      userNotes: '',
      tags,
      status: 'staging',
      isOutline: false,
    };

    const result = await apiClient.harvestCard(bookId, card);

    return {
      success: true,
      message: `Created card "${result.title || 'Untitled'}" (${result.id})`,
      data: result,
      teaching: {
        whatHappened: 'Created a new card from content',
        guiPath: ['Book Studio', 'Harvest', 'Add Card'],
        why: 'Cards capture content that can later be organized into chapters',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to harvest card',
    };
  }
}

/**
 * update_card - Update card metadata/notes
 */
export async function executeUpdateCard(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const cardId = params.cardId as string;
  if (!cardId) {
    return {
      success: false,
      error: 'cardId is required',
    };
  }

  const updates: Partial<HarvestCard> = {};
  if (params.userNotes !== undefined) updates.userNotes = params.userNotes as string;
  if (params.tags !== undefined) updates.tags = params.tags as string[];
  if (params.status !== undefined) updates.status = params.status as HarvestCard['status'];
  if (params.grade !== undefined) updates.grade = params.grade as HarvestCard['grade'];

  try {
    const result = await apiClient.updateCard(cardId, updates);

    return {
      success: true,
      message: `Updated card "${result.title || cardId}"`,
      data: result,
      teaching: {
        whatHappened: 'Updated card metadata',
        guiPath: ['Book Studio', 'Card Details', 'Edit'],
        why: 'Card metadata helps with organization and curation',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to update card',
    };
  }
}

/**
 * move_card - Assign card to chapter
 */
export async function executeMoveCard(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const cardId = params.cardId as string;
  const chapterId = params.chapterId as string;

  if (!cardId) {
    return {
      success: false,
      error: 'cardId is required',
    };
  }

  if (!chapterId) {
    return {
      success: false,
      error: 'chapterId is required',
    };
  }

  try {
    const result = await apiClient.moveCardToChapter(cardId, chapterId);

    return {
      success: true,
      message: `Moved card to chapter ${chapterId}`,
      data: result,
      teaching: {
        whatHappened: 'Assigned card to a chapter',
        guiPath: ['Book Studio', 'Cards', 'Drag to Chapter'],
        why: 'Moving cards to chapters organizes your content for drafting',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to move card',
    };
  }
}

/**
 * batch_update_cards - Update multiple cards at once
 */
export async function executeBatchUpdateCards(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const cardIds = params.cardIds as string[];
  if (!cardIds || cardIds.length === 0) {
    return {
      success: false,
      error: 'cardIds array is required',
    };
  }

  const updates: Partial<Pick<HarvestCard, 'suggestedChapterId' | 'status' | 'grade' | 'tags'>> = {};
  if (params.chapterId !== undefined) updates.suggestedChapterId = params.chapterId as string;
  if (params.status !== undefined) updates.status = params.status as HarvestCard['status'];
  if (params.grade !== undefined) updates.grade = params.grade as HarvestCard['grade'];
  if (params.tags !== undefined) updates.tags = params.tags as string[];

  try {
    const result = await apiClient.batchUpdateCards(cardIds, updates);

    return {
      success: true,
      message: `Updated ${result.updatedCount} cards`,
      data: result,
      teaching: {
        whatHappened: `Batch updated ${result.updatedCount} cards`,
        guiPath: ['Book Studio', 'Cards', 'Multi-select', 'Batch Edit'],
        why: 'Batch operations speed up organization of many cards',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to batch update cards',
    };
  }
}

// ============================================================================
// Harvest Workflow Tools (5)
// ============================================================================

/**
 * search_for_harvest - Search archive for content to harvest
 */
export async function executeSearchForHarvest(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const query = params.query as string;
  if (!query) {
    return {
      success: false,
      error: 'query is required',
    };
  }

  const chapterId = params.chapterId as string | undefined;
  const similarityThreshold = params.similarityThreshold as number | undefined;
  const limit = (params.limit as number) || 20;
  const sourceTypes = params.sourceTypes as string[] | undefined;

  try {
    const result = await apiClient.harvestSearch({
      bookId,
      query,
      chapterId,
      similarityThreshold,
      limit,
      sourceTypes,
    });

    return {
      success: true,
      message: `Found ${result.results.length} results for "${query}" (harvestId: ${result.harvestId})`,
      data: {
        results: result.results,
        harvestId: result.harvestId,
        query: result.query,
      },
      teaching: {
        whatHappened: `Searched archive and found ${result.results.length} matching passages`,
        guiPath: ['Book Studio', 'Harvest', 'Search'],
        why: 'Search results can be committed as cards using commit_harvest',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to search archive',
    };
  }
}

/**
 * commit_harvest - Convert search results to cards
 */
export async function executeCommitHarvest(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const harvestId = params.harvestId as string;
  const acceptedIds = params.acceptedIds as string[];

  if (!harvestId) {
    return {
      success: false,
      error: 'harvestId is required',
    };
  }

  if (!acceptedIds || acceptedIds.length === 0) {
    return {
      success: false,
      error: 'acceptedIds array is required',
    };
  }

  const rejectedIds = params.rejectedIds as string[] | undefined;
  const results = params.results as HarvestSearchResult[] | undefined;

  try {
    const result = await apiClient.harvestCommit({
      harvestId,
      acceptedIds,
      rejectedIds,
      results,
    });

    return {
      success: true,
      message: `Committed ${result.committed} cards from harvest`,
      data: {
        cards: result.cards,
        committed: result.committed,
        harvestId: result.harvestId,
      },
      teaching: {
        whatHappened: `Created ${result.committed} cards from harvest search results`,
        guiPath: ['Book Studio', 'Harvest', 'Accept Results'],
        why: 'Committed cards become part of your book project for curation',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to commit harvest',
    };
  }
}

/**
 * iterate_harvest - Refine previous search with adjustments
 */
export async function executeIterateHarvest(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const harvestId = params.harvestId as string;
  if (!harvestId) {
    return {
      success: false,
      error: 'harvestId is required',
    };
  }

  const adjustments: {
    query?: string;
    similarityThreshold?: number;
    limit?: number;
    sourceTypes?: string[];
  } = {};

  if (params.query !== undefined) adjustments.query = params.query as string;
  if (params.similarityThreshold !== undefined) adjustments.similarityThreshold = params.similarityThreshold as number;
  if (params.limit !== undefined) adjustments.limit = params.limit as number;
  if (params.sourceTypes !== undefined) adjustments.sourceTypes = params.sourceTypes as string[];

  const notes = params.notes as string | undefined;

  try {
    const result = await apiClient.harvestIterate(harvestId, adjustments, notes);

    return {
      success: true,
      message: `Refined search: ${result.results.length} results (harvestId: ${result.harvestId})`,
      data: result,
      teaching: {
        whatHappened: 'Refined harvest search with new parameters',
        guiPath: ['Book Studio', 'Harvest', 'Refine Search'],
        why: 'Iteration helps find better content by adjusting search criteria',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to iterate harvest',
    };
  }
}

/**
 * get_harvest_history - View past harvests
 */
export async function executeGetHarvestHistory(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const page = params.page as number | undefined;
  const limit = params.limit as number | undefined;
  const chapterId = params.chapterId as string | undefined;

  try {
    const result = await apiClient.getHarvestHistory(bookId, { page, limit, chapterId });

    return {
      success: true,
      message: `Found ${result.harvests.length} harvest sessions`,
      data: {
        harvests: result.harvests,
        pagination: result.pagination,
      },
      teaching: {
        whatHappened: 'Retrieved harvest history for your book',
        guiPath: ['Book Studio', 'Harvest', 'History'],
        why: 'History helps track what content has been searched and harvested',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get harvest history',
    };
  }
}

/**
 * create_harvest_rule - Add include/exclude rules for harvesting
 */
export async function executeCreateHarvestRule(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const instructionType = params.type as HarvestInstruction['instructionType'];
  const instructionText = params.text as string;

  if (!instructionType || !instructionText) {
    return {
      success: false,
      error: 'type and text are required',
    };
  }

  const chapterId = params.chapterId as string | undefined;
  const appliesToSources = params.sources as string[] | undefined;
  const priority = (params.priority as number) || 0;

  try {
    const result = await apiClient.createHarvestInstruction({
      bookId,
      chapterId,
      instructionType,
      instructionText,
      appliesToSources,
      priority,
    });

    return {
      success: true,
      message: `Created ${instructionType} rule: "${instructionText}"`,
      data: result,
      teaching: {
        whatHappened: `Created a ${instructionType} rule for harvesting`,
        guiPath: ['Book Studio', 'Harvest', 'Rules'],
        why: 'Rules help guide what content to include or exclude during harvest',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to create harvest rule',
    };
  }
}

// ============================================================================
// Draft Tools (5)
// ============================================================================

/**
 * generate_chapter_draft - Generate via LLM with voice
 */
export async function executeGenerateChapterDraft(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const chapterId = params.chapterId as string;
  if (!chapterId) {
    return {
      success: false,
      error: 'chapterId is required',
    };
  }

  const cardIds = params.cardIds as string[] | undefined;
  const voiceId = params.voiceId as string | undefined;
  const model = params.model as string | undefined;
  const temperature = params.temperature as number | undefined;
  const maxTokens = params.maxTokens as number | undefined;
  const prompt = params.prompt as string | undefined;

  try {
    const result = await apiClient.generateDraft({
      chapterId,
      bookId,
      cardIds,
      voiceId,
      model,
      temperature,
      maxTokens,
      prompt,
    });

    return {
      success: true,
      message: `Generated draft v${result.draft.versionNumber} (${result.draft.wordCount} words) in ${result.generationTime}ms`,
      data: result,
      teaching: {
        whatHappened: `Generated a new draft version using LLM`,
        guiPath: ['Book Studio', 'Chapters', 'Generate Draft'],
        why: 'LLM drafts weave cards together into coherent chapter content',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to generate draft',
    };
  }
}

/**
 * save_draft - Save manual draft version
 */
export async function executeSaveDraft(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const chapterId = params.chapterId as string;
  const content = params.content as string;

  if (!chapterId || !content) {
    return {
      success: false,
      error: 'chapterId and content are required',
    };
  }

  const voiceId = params.voiceId as string | undefined;

  try {
    const result = await apiClient.saveDraft({
      chapterId,
      bookId,
      content,
      voiceId,
    });

    return {
      success: true,
      message: `Saved draft v${result.versionNumber} (${result.wordCount} words)`,
      data: result,
      teaching: {
        whatHappened: 'Saved a new draft version',
        guiPath: ['Book Studio', 'Chapters', 'Save Draft'],
        why: 'Draft versions let you track changes and compare iterations',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to save draft',
    };
  }
}

/**
 * review_draft - Set review status
 */
export async function executeReviewDraft(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const versionId = params.versionId as string;
  const status = params.status as DraftVersion['reviewStatus'];

  if (!versionId || !status) {
    return {
      success: false,
      error: 'versionId and status are required',
    };
  }

  const notes = params.notes as string | undefined;

  try {
    await apiClient.reviewDraft(versionId, status, notes);

    return {
      success: true,
      message: `Set draft review status to "${status}"`,
      data: { versionId, status, notes },
      teaching: {
        whatHappened: `Updated draft review status`,
        guiPath: ['Book Studio', 'Drafts', 'Review'],
        why: 'Review status tracks which drafts are ready for publication',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to review draft',
    };
  }
}

/**
 * accept_draft - Publish draft to chapter
 */
export async function executeAcceptDraft(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const versionId = params.versionId as string;

  if (!versionId) {
    return {
      success: false,
      error: 'versionId is required',
    };
  }

  try {
    const result = await apiClient.acceptDraft(versionId);

    return {
      success: true,
      message: `Accepted draft and published to chapter "${result.title}"`,
      data: result,
      teaching: {
        whatHappened: 'Published draft content to the chapter',
        guiPath: ['Book Studio', 'Drafts', 'Accept'],
        why: 'Accepting a draft makes it the official chapter content',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to accept draft',
    };
  }
}

/**
 * compare_drafts - Diff two draft versions
 */
export async function executeCompareDrafts(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const v1 = params.v1 as string;
  const v2 = params.v2 as string;

  if (!v1 || !v2) {
    return {
      success: false,
      error: 'v1 and v2 version IDs are required',
    };
  }

  try {
    const result = await apiClient.compareDrafts(v1, v2);

    if (!result) {
      return {
        success: false,
        error: 'Failed to compare drafts - one or both versions not found',
      };
    }

    return {
      success: true,
      message: `Compared drafts: ${result.additions} additions, ${result.deletions} deletions, ${result.wordCountDiff > 0 ? '+' : ''}${result.wordCountDiff} words`,
      data: result,
      teaching: {
        whatHappened: 'Compared two draft versions',
        guiPath: ['Book Studio', 'Drafts', 'Compare'],
        why: 'Comparison helps understand what changed between versions',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to compare drafts',
    };
  }
}

// ============================================================================
// Voice Tools (5)
// ============================================================================

/**
 * extract_voice - Extract voice profile from card samples
 */
export async function executeExtractVoice(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const cardIds = params.cardIds as string[];
  if (!cardIds || cardIds.length === 0) {
    return {
      success: false,
      error: 'cardIds array is required',
    };
  }

  const name = params.name as string | undefined;
  const description = params.description as string | undefined;

  try {
    const result = await apiClient.extractVoice({
      bookId,
      cardIds,
      name,
      description,
    });

    return {
      success: true,
      message: `Extracted voice "${result.name}" from ${cardIds.length} cards`,
      data: result,
      teaching: {
        whatHappened: 'Extracted a voice profile from your writing samples',
        guiPath: ['Book Studio', 'Voice', 'Extract'],
        why: 'Voice profiles capture your writing style for consistent drafts',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to extract voice',
    };
  }
}

/**
 * list_book_voices - List voices for active book
 */
export async function executeListBookVoices(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  try {
    const voices = await apiClient.listVoices(bookId);
    const primary = voices.find(v => v.isPrimary);

    return {
      success: true,
      message: `Found ${voices.length} voice profiles${primary ? ` (primary: "${primary.name}")` : ''}`,
      data: {
        voices,
        primary: primary?.id,
      },
      teaching: {
        whatHappened: 'Listed voice profiles for your book',
        guiPath: ['Book Studio', 'Voice', 'List'],
        why: 'Voice profiles help maintain consistent tone across chapters',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to list voices',
    };
  }
}

/**
 * apply_book_voice - Transform content with voice
 */
export async function executeApplyBookVoice(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const voiceId = params.voiceId as string;
  const content = params.content as string;

  if (!voiceId || !content) {
    return {
      success: false,
      error: 'voiceId and content are required',
    };
  }

  const strengthFactor = params.strength as number | undefined;

  try {
    const result = await apiClient.applyVoice({
      voiceId,
      content,
      strengthFactor,
    });

    return {
      success: true,
      message: `Applied voice transformation (strength: ${result.strengthFactor})`,
      data: result,
      content: result.transformedContent,
      teaching: {
        whatHappened: 'Transformed content using voice profile',
        guiPath: ['Book Studio', 'Voice', 'Apply'],
        why: 'Voice application rewrites content to match your writing style',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to apply voice',
    };
  }
}

/**
 * set_primary_voice - Set default voice for book
 */
export async function executeSetPrimaryVoice(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const voiceId = params.voiceId as string;

  if (!voiceId) {
    return {
      success: false,
      error: 'voiceId is required',
    };
  }

  try {
    await apiClient.setPrimaryVoice(voiceId);

    return {
      success: true,
      message: `Set voice ${voiceId} as primary`,
      data: { voiceId },
      teaching: {
        whatHappened: 'Set the primary voice for your book',
        guiPath: ['Book Studio', 'Voice', 'Set Primary'],
        why: 'Primary voice is used by default when generating drafts',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to set primary voice',
    };
  }
}

/**
 * get_voice_features - Get extracted voice features
 */
export async function executeGetVoiceFeatures(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const voiceId = params.voiceId as string;

  if (!voiceId) {
    return {
      success: false,
      error: 'voiceId is required',
    };
  }

  try {
    const features = await apiClient.getVoiceFeatures(voiceId);

    return {
      success: true,
      message: features
        ? `Voice features: ${features.toneDescriptors?.join(', ') || 'no descriptors'}`
        : 'No features extracted yet',
      data: features,
      teaching: {
        whatHappened: 'Retrieved extracted voice features',
        guiPath: ['Book Studio', 'Voice', 'Details'],
        why: 'Voice features describe sentence patterns, vocabulary, and tone',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get voice features',
    };
  }
}

// ============================================================================
// Assignment Tools (3)
// ============================================================================

/**
 * auto_assign_cards - ML-based assignment proposals
 */
export async function executeAutoAssignCards(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  // This would call an ML endpoint to propose card assignments
  // For now, we'll use basic similarity matching via the search API
  try {
    const cards = await apiClient.listCards(bookId);
    const unassignedCards = cards.filter(c => !c.suggestedChapterId && c.status === 'staging');

    // Get chapters to suggest assignments
    const chapters = await apiClient.listChapters(bookId);

    if (chapters.length === 0) {
      return {
        success: false,
        error: 'No chapters exist. Create chapters first before auto-assigning.',
      };
    }

    // Simple heuristic: propose based on keyword matching
    // In a full implementation, this would use semantic embeddings
    const proposals = unassignedCards.map(card => {
      // Find best matching chapter based on title keywords
      const cardWords = new Set(card.content.toLowerCase().split(/\s+/));
      let bestChapter = chapters[0];
      let bestScore = 0;

      for (const chapter of chapters) {
        const chapterWords = chapter.title.toLowerCase().split(/\s+/);
        const matches = chapterWords.filter(w => cardWords.has(w)).length;
        if (matches > bestScore) {
          bestScore = matches;
          bestChapter = chapter;
        }
      }

      return {
        cardId: card.id,
        cardTitle: card.title,
        suggestedChapterId: bestChapter.id,
        suggestedChapterTitle: bestChapter.title,
        confidence: bestScore > 0 ? Math.min(0.5 + bestScore * 0.1, 0.95) : 0.3,
      };
    });

    return {
      success: true,
      message: `Generated ${proposals.length} assignment proposals`,
      data: {
        proposals,
        unassignedCount: unassignedCards.length,
        totalCards: cards.length,
      },
      teaching: {
        whatHappened: 'Generated card-to-chapter assignment proposals',
        guiPath: ['Book Studio', 'Cards', 'Auto-Assign'],
        why: 'Auto-assignment suggests where cards might fit based on content',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to auto-assign cards',
    };
  }
}

/**
 * apply_assignments - Apply selected assignment proposals
 */
export async function executeApplyAssignments(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const assignments = params.assignments as Array<{ cardId: string; chapterId: string }>;

  if (!assignments || assignments.length === 0) {
    return {
      success: false,
      error: 'assignments array is required with cardId and chapterId pairs',
    };
  }

  try {
    const cardIds = assignments.map(a => a.cardId);
    // Group by chapter for batch updates
    const byChapter: Record<string, string[]> = {};
    for (const a of assignments) {
      if (!byChapter[a.chapterId]) byChapter[a.chapterId] = [];
      byChapter[a.chapterId].push(a.cardId);
    }

    let appliedCount = 0;
    for (const [chapterId, ids] of Object.entries(byChapter)) {
      const result = await apiClient.batchUpdateCards(ids, { suggestedChapterId: chapterId });
      appliedCount += result.updatedCount;
    }

    return {
      success: true,
      message: `Applied ${appliedCount} card assignments`,
      data: { appliedCount, totalRequested: assignments.length },
      teaching: {
        whatHappened: 'Applied card-to-chapter assignments',
        guiPath: ['Book Studio', 'Cards', 'Apply Assignments'],
        why: 'Applying assignments organizes cards into their chapters',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to apply assignments',
    };
  }
}

/**
 * get_assignment_stats - Get progress metrics
 */
export async function executeGetAssignmentStats(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  try {
    const cards = await apiClient.listCards(bookId);
    const chapters = await apiClient.listChapters(bookId);

    const staging = cards.filter(c => c.status === 'staging').length;
    const assigned = cards.filter(c => c.suggestedChapterId).length;
    const unassigned = cards.filter(c => !c.suggestedChapterId).length;

    const chapterStats = chapters.map(ch => ({
      id: ch.id,
      title: ch.title,
      cardCount: cards.filter(c => c.suggestedChapterId === ch.id).length,
      wordCount: ch.wordCount,
    }));

    return {
      success: true,
      message: `${assigned}/${cards.length} cards assigned (${staging} staging, ${unassigned} unassigned)`,
      data: {
        totalCards: cards.length,
        staging,
        assigned,
        unassigned,
        chapterStats,
      },
      teaching: {
        whatHappened: 'Retrieved assignment progress statistics',
        guiPath: ['Book Studio', 'Overview'],
        why: 'Stats help track progress toward completing your book',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to get assignment stats',
    };
  }
}

// ============================================================================
// Batch Operations (2)
// ============================================================================

/**
 * create_chapters_batch - Create multiple chapters at once
 */
export async function executeCreateChaptersBatch(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const titles = params.titles as string[];
  if (!titles || titles.length === 0) {
    return {
      success: false,
      error: 'titles array is required',
    };
  }

  try {
    const chapters = await apiClient.createChaptersBatch(bookId, titles);

    return {
      success: true,
      message: `Created ${chapters.length} chapters`,
      data: { chapters },
      teaching: {
        whatHappened: `Created ${chapters.length} new chapters`,
        guiPath: ['Book Studio', 'Chapters', 'Create Multiple'],
        why: 'Batch creation quickly sets up your book structure',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to create chapters',
    };
  }
}

/**
 * harvest_cards_batch - Batch create cards from content array
 */
export async function executeHarvestCardsBatch(
  params: Record<string, unknown>,
  context: AUIContext
): Promise<AUIToolResult> {
  const bookId = getActiveBookId(context);
  if (!bookId) {
    return {
      success: false,
      error: 'No active book. Create or select a book first.',
    };
  }

  const contents = params.contents as Array<{
    content: string;
    title?: string;
    tags?: string[];
  }>;

  if (!contents || contents.length === 0) {
    return {
      success: false,
      error: 'contents array is required',
    };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const cards: HarvestCard[] = contents.map((item, index) => ({
      id: `card-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
      sourceId: `batch-${Date.now()}-${index}`,
      sourceType: 'document' as HarvestCard['sourceType'],
      source: 'AUI Batch Tool',
      contentOrigin: 'original' as HarvestCard['contentOrigin'],
      content: item.content,
      title: item.title,
      sourceCreatedAt: now,
      sourceCreatedAtStatus: 'unknown' as HarvestCard['sourceCreatedAtStatus'],
      harvestedAt: now,
      userNotes: '',
      tags: item.tags || [],
      status: 'staging' as HarvestCard['status'],
      isOutline: false,
    }));

    const result = await apiClient.harvestCardsBatch(bookId, cards);

    return {
      success: true,
      message: `Created ${result.length} cards`,
      data: { cards: result },
      teaching: {
        whatHappened: `Batch created ${result.length} cards`,
        guiPath: ['Book Studio', 'Harvest', 'Batch Import'],
        why: 'Batch harvesting quickly imports multiple pieces of content',
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to batch harvest cards',
    };
  }
}
