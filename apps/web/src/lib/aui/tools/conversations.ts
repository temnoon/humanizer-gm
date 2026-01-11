/**
 * AUI Tools - Conversation & Harvesting Operations
 *
 * Handles conversation listing and content harvesting:
 * - List conversations from archive
 * - Harvest passages from archive into book projects
 * - Generate first draft chapters from passages
 * - Fill chapters using local LLM
 */

import type { AUIContext, AUIToolResult, SourcePassage } from './types';
import { getArchiveServerUrl } from '../../platform';
import { getStoredToken } from '../../auth';

// NPE API base URL
const NPE_API_BASE = import.meta.env.VITE_API_URL || 'https://npe-api.tem-527.workers.dev';

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION & HARVESTING TOOLS
// ═══════════════════════════════════════════════════════════════════

/**
 * List conversations from the archive
 */
export async function executeListConversations(
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
export async function executeHarvestArchive(
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
export async function executeGenerateFirstDraft(
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
export async function executeFillChapter(
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
