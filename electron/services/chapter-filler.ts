/**
 * Chapter Filler Service
 *
 * Fills an empty chapter by:
 * 1. Generating search queries from the chapter title
 * 2. Searching the archive for relevant passages
 * 3. Ranking and selecting the best passages
 * 4. Generating a draft using an LLM
 * 5. Updating the chapter in the database
 */

import { EmbeddingDatabase } from '../archive-server/services/embeddings/EmbeddingDatabase.js';
import { embed } from '../archive-server/services/embeddings/EmbeddingGenerator.js';
import { getModelRouter } from './model-router.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface FillChapterOptions {
  /** Writing style for the generated content */
  style?: 'academic' | 'narrative' | 'conversational';
  /** Target word count (default: 500) */
  targetWords?: number;
  /** Additional search queries beyond title-derived ones */
  additionalQueries?: string[];
  /** Maximum passages to use (default: 10) */
  maxPassages?: number;
  /** Minimum similarity threshold (default: 0.6) */
  minSimilarity?: number;
}

export interface FillChapterResult {
  success: boolean;
  chapter?: {
    id: string;
    title: string;
    content: string;
    wordCount: number;
  };
  stats?: {
    passagesFound: number;
    passagesUsed: number;
    generationTimeMs: number;
    queriesUsed: string[];
  };
  error?: string;
}

interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  conversationTitle?: string;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate search queries from a chapter title
 * Uses simple heuristics - extracts meaningful words and creates combinations
 */
function generateQueriesFromTitle(title: string): string[] {
  // Common stop words to filter out
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  ]);

  // Extract meaningful words (4+ chars, not stop words)
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w));

  const queries: string[] = [];

  // Query 1: Full title (cleaned)
  queries.push(title.replace(/[^a-zA-Z0-9\s]/g, ' ').trim());

  // Query 2-4: Individual key concepts
  for (const word of words.slice(0, 3)) {
    queries.push(word);
  }

  // Query 5: Combination of first two keywords
  if (words.length >= 2) {
    queries.push(`${words[0]} ${words[1]}`);
  }

  return [...new Set(queries)]; // Deduplicate
}

// ═══════════════════════════════════════════════════════════════════
// PASSAGE SEARCH & RANKING
// ═══════════════════════════════════════════════════════════════════

/**
 * Search archive for relevant passages
 */
async function searchPassages(
  db: EmbeddingDatabase,
  queries: string[],
  options: { maxPassages: number; minSimilarity: number }
): Promise<SearchResult[]> {
  const allResults = new Map<string, SearchResult>();
  const resultsPerQuery = Math.ceil((options.maxPassages * 2) / queries.length);

  for (const query of queries) {
    try {
      // Search with role='assistant' to get substantive content
      const results = db.searchMessages(
        await embed(query),
        resultsPerQuery,
        'assistant'
      );

      for (const result of results) {
        // Skip if below similarity threshold
        if (result.similarity < options.minSimilarity) continue;

        // Skip very short content
        if (result.content.length < 200) continue;

        // Deduplicate by ID, keeping highest similarity
        const existing = allResults.get(result.id);
        if (!existing || result.similarity > existing.similarity) {
          allResults.set(result.id, {
            id: result.id,
            content: result.content,
            similarity: result.similarity,
            conversationTitle: result.conversationTitle,
          });
        }
      }
    } catch (err) {
      console.warn(`[chapter-filler] Search failed for query "${query}":`, err);
    }
  }

  // Sort by similarity and take top N
  return Array.from(allResults.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.maxPassages);
}

/**
 * Deduplicate passages by content similarity (Jaccard)
 */
function deduplicatePassages(passages: SearchResult[], threshold = 0.7): SearchResult[] {
  const result: SearchResult[] = [];

  for (const passage of passages) {
    const passageWords = new Set(passage.content.toLowerCase().split(/\s+/));
    let isDuplicate = false;

    for (const existing of result) {
      const existingWords = new Set(existing.content.toLowerCase().split(/\s+/));
      const intersection = new Set([...passageWords].filter(w => existingWords.has(w)));
      const union = new Set([...passageWords, ...existingWords]);
      const jaccard = intersection.size / union.size;

      if (jaccard > threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(passage);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// DRAFT GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate chapter content using LLM
 */
async function generateDraft(
  title: string,
  bookName: string,
  passages: SearchResult[],
  options: { style: string; targetWords: number }
): Promise<string> {
  const router = getModelRouter({ preference: 'local-only' });

  // Build source material from passages
  const sourceMaterial = passages
    .slice(0, 8) // Use top 8 passages max for context
    .map((p, i) => `[Source ${i + 1}]: ${p.content.substring(0, 600)}`)
    .join('\n\n');

  // Style-specific instructions
  const styleInstructions: Record<string, string> = {
    academic: 'Use an academic but accessible tone. Include clear definitions, structured arguments, and appropriate philosophical vocabulary.',
    narrative: 'Use a narrative, engaging tone. Weave ideas together as a story of intellectual discovery.',
    conversational: 'Use a conversational, approachable tone. Explain concepts as if talking to an interested friend.',
  };

  const prompt = `You are writing a chapter for a book titled "${bookName}".

Chapter Title: ${title}

Writing Style: ${styleInstructions[options.style] || styleInstructions.academic}

Target Length: approximately ${options.targetWords} words

Source Material (use these ideas, but synthesize into original prose):
${sourceMaterial}

Instructions:
1. Write a cohesive chapter that explores the topic indicated by the title
2. Draw from the source material but synthesize into original prose
3. Include an engaging opening and a thoughtful conclusion
4. Maintain the specified writing style throughout
5. Target approximately ${options.targetWords} words

Write the chapter now:`;

  const result = await router.generate({
    prompt,
    maxTokens: Math.ceil(options.targetWords * 1.5), // Allow some buffer
    temperature: 0.7,
    taskType: 'draft',
  });

  if (!result.success || !result.text) {
    throw new Error(result.error || 'Generation failed');
  }

  return result.text;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Fill an empty chapter with generated content
 */
export async function fillChapter(
  chapterId: string,
  bookId: string,
  archivePath: string,
  options: FillChapterOptions = {}
): Promise<FillChapterResult> {
  const startTime = Date.now();

  // Default options
  const style = options.style || 'academic';
  const targetWords = options.targetWords || 500;
  const maxPassages = options.maxPassages || 10;
  const minSimilarity = options.minSimilarity || 0.4; // Lowered from 0.6 for better recall
  const additionalQueries = options.additionalQueries || [];

  try {
    // Initialize database
    const db = new EmbeddingDatabase(archivePath);

    // Get chapter info
    const chapter = db.getBookChapter(chapterId);
    if (!chapter) {
      return { success: false, error: `Chapter not found: ${chapterId}` };
    }

    // Get book info
    const book = db.getBook(bookId);
    if (!book) {
      return { success: false, error: `Book not found: ${bookId}` };
    }

    const chapterTitle = chapter.title as string;
    const bookName = book.name as string;

    // FIRST: Check for approved/gem passages in the book itself
    // These are passages the user has already curated - use them directly!
    const bookPassages = db.getBookPassages(bookId);
    const approvedPassages = bookPassages.filter(
      (p) => p.curationStatus === 'approved' || p.curationStatus === 'gem'
    );

    let passages: SearchResult[] = [];

    if (approvedPassages.length > 0) {
      // Use the book's own curated passages
      console.log(`[chapter-filler] Using ${approvedPassages.length} approved book passages`);
      passages = approvedPassages.slice(0, maxPassages).map((p, i) => ({
        id: p.id as string,
        content: p.text as string,
        similarity: 1.0 - (i * 0.01), // Rank by order, all highly relevant
        conversationTitle: (p.sourceRef as { conversationTitle?: string })?.conversationTitle,
      }));
    } else {
      // FALLBACK: Search archive for passages
      // Generate search queries
      const titleQueries = generateQueriesFromTitle(chapterTitle);
      const allQueries = [...titleQueries, ...additionalQueries].slice(0, 6);

      console.log(`[chapter-filler] No approved passages, searching archive with queries:`, allQueries);

      // Search for passages in archive
      const rawPassages = await searchPassages(db, allQueries, { maxPassages: maxPassages * 2, minSimilarity });

      if (rawPassages.length === 0) {
        return {
          success: false,
          error: `No relevant passages found. Try harvesting content first, or use broader search terms.`,
          stats: {
            passagesFound: 0,
            passagesUsed: 0,
            generationTimeMs: Date.now() - startTime,
            queriesUsed: allQueries,
          },
        };
      }

      // Deduplicate
      passages = deduplicatePassages(rawPassages);
      console.log(`[chapter-filler] Found ${rawPassages.length} archive passages, ${passages.length} after dedup`);
    }

    console.log(`[chapter-filler] Using ${passages.length} passages for generation`);

    // Generate draft
    console.log(`[chapter-filler] Generating ${style} draft (~${targetWords} words)...`);
    const content = await generateDraft(chapterTitle, bookName, passages, { style, targetWords });
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

    // Update chapter in database
    db.upsertBookChapter({
      id: chapterId,
      bookId,
      number: chapter.number as number,
      title: chapterTitle,
      content,
      wordCount,
      status: 'draft',
      version: ((chapter.version as number) || 0) + 1,
    });

    // Save version snapshot
    const passageSource = approvedPassages.length > 0 ? 'book passages' : 'archive search';
    db.saveChapterVersion(
      chapterId,
      ((chapter.version as number) || 0) + 1,
      content,
      `Auto-generated from ${passages.length} ${passageSource}`,
      'aui'
    );

    console.log(`[chapter-filler] Chapter filled: ${wordCount} words`);

    return {
      success: true,
      chapter: {
        id: chapterId,
        title: chapterTitle,
        content,
        wordCount,
      },
      stats: {
        passagesFound: approvedPassages.length > 0 ? approvedPassages.length : passages.length,
        passagesUsed: passages.length,
        generationTimeMs: Date.now() - startTime,
        queriesUsed: approvedPassages.length > 0 ? ['(used book passages)'] : additionalQueries,
      },
    };
  } catch (error) {
    console.error('[chapter-filler] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stats: {
        passagesFound: 0,
        passagesUsed: 0,
        generationTimeMs: Date.now() - startTime,
        queriesUsed: [],
      },
    };
  }
}

export default { fillChapter };
