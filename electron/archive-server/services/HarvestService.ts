/**
 * HarvestService - Smart Harvest Logic (Server-Side)
 *
 * Agentic harvesting that filters for quality:
 * 1. Fetches large result set from embeddings
 * 2. Grades each result
 * 3. Filters out stubs (except breadcrumbs which get expanded)
 * 4. Returns quality results up to target
 *
 * All business logic lives here, not in frontend.
 */

import { getEmbeddingDatabase, getContentGraphDatabase } from './registry';
import { configService, type HarvestConfig as ConfigHarvestConfig, type DeduplicationConfig } from './ConfigService';
import { HybridSearchService } from './retrieval/HybridSearch.js';

// ============================================================================
// Types
// ============================================================================

export type StubClassification =
  | 'optimal'
  | 'stub-media'
  | 'stub-reference'
  | 'stub-sentence'
  | 'stub-note'
  | 'stub-breadcrumb';

export interface HarvestProgress {
  phase: 'searching' | 'grading' | 'expanding' | 'complete';
  searched: number;
  graded: number;
  accepted: number;
  rejected: number;
  expanded: number;
  target: number;
  message: string;
}

export interface HarvestOptions {
  target: number;
  searchLimit: number;
  minWordCount: number;
  expandBreadcrumbs: boolean;
  contextSize: number;
  sources?: string[];
  types?: string[];
  prioritizeConversations: boolean;
  minGrade: number;
  lengthBonusMax: number;
  lengthBonusDivisor: number;
  useHybridSearch: boolean;
  deduplication: DeduplicationConfig;
}

export interface SearchResult {
  id: string;
  content: string;
  type: string;
  source: string;
  similarity: number;
  conversationId?: string;
  conversationTitle?: string;
  authorName?: string;
  createdAt?: number;
}

export interface QuickGrade {
  stubType: StubClassification;
  wordCount: number;
  overall: number;
  necessity: number;
}

export interface ExpandedResult {
  original: SearchResult;
  stubType: StubClassification;
  grade: QuickGrade;
  expanded?: {
    previousMessages: string[];
    nextMessages: string[];
    combinedContent: string;
  };
}

export interface HarvestResult {
  results: ExpandedResult[];
  stats: {
    totalSearched: number;
    totalRejected: number;
    totalExpanded: number;
    exhausted: boolean;
  };
}

// ============================================================================
// Service
// ============================================================================

export class HarvestService {
  /**
   * Run smart harvest
   */
  async harvest(
    query: string,
    options: Partial<HarvestOptions> = {},
    onProgress?: (progress: HarvestProgress) => void
  ): Promise<HarvestResult> {
    // Get config defaults
    await configService.init();
    const defaultConfig = configService.getSection('harvest');

    const cfg: HarvestOptions = {
      target: options.target ?? defaultConfig.defaultTarget,
      searchLimit: options.searchLimit ?? defaultConfig.searchLimit,
      minWordCount: options.minWordCount ?? defaultConfig.minWordCount,
      expandBreadcrumbs: options.expandBreadcrumbs ?? defaultConfig.expandBreadcrumbs,
      contextSize: options.contextSize ?? defaultConfig.contextSize,
      sources: options.sources,
      types: options.types,
      prioritizeConversations: options.prioritizeConversations ?? defaultConfig.prioritizeConversations,
      minGrade: options.minGrade ?? defaultConfig.minGrade,
      lengthBonusMax: options.lengthBonusMax ?? defaultConfig.lengthBonusMax,
      lengthBonusDivisor: options.lengthBonusDivisor ?? defaultConfig.lengthBonusDivisor,
      useHybridSearch: options.useHybridSearch ?? defaultConfig.useHybridSearch,
      deduplication: options.deduplication ?? defaultConfig.deduplication,
    };

    const acceptedResults: ExpandedResult[] = [];
    const seenSourceIds = new Set<string>(); // Prevent duplicate source IDs
    let totalSearched = 0;
    let totalRejected = 0;
    let totalExpanded = 0;
    let exhausted = false;

    // Phase: Searching
    onProgress?.({
      phase: 'searching',
      searched: 0,
      graded: 0,
      accepted: 0,
      rejected: 0,
      expanded: 0,
      target: cfg.target,
      message: `Searching for "${query}"...`,
    });

    // Search embeddings
    console.log(`[HarvestService] Searching for "${query}" with limit ${cfg.searchLimit}`);
    const searchResults = await this.searchEmbeddings(query, cfg);

    console.log(`[HarvestService] Search returned ${searchResults.length} results`);

    if (searchResults.length === 0) {
      exhausted = true;
      onProgress?.({
        phase: 'complete',
        searched: 0,
        graded: 0,
        accepted: 0,
        rejected: 0,
        expanded: 0,
        target: cfg.target,
        message: 'No results found',
      });
      return {
        results: [],
        stats: { totalSearched: 0, totalRejected: 0, totalExpanded: 0, exhausted: true },
      };
    }

    // Prioritize conversations over social media if configured
    let sortedResults = searchResults;
    if (cfg.prioritizeConversations) {
      sortedResults = [...searchResults].sort((a, b) => {
        const aIsConvo = a.type === 'message' || a.source === 'openai' || a.source === 'claude';
        const bIsConvo = b.type === 'message' || b.source === 'openai' || b.source === 'claude';

        if (aIsConvo && !bIsConvo) return -1;
        if (!aIsConvo && bIsConvo) return 1;
        return b.similarity - a.similarity;
      });
    }

    totalSearched = sortedResults.length;

    // Phase: Grading
    onProgress?.({
      phase: 'grading',
      searched: totalSearched,
      graded: 0,
      accepted: 0,
      rejected: 0,
      expanded: 0,
      target: cfg.target,
      message: `Grading ${sortedResults.length} results...`,
    });

    // Grade and filter each result
    for (let i = 0; i < sortedResults.length; i++) {
      const result = sortedResults[i];

      // Skip if we already have enough
      if (acceptedResults.length >= cfg.target) break;

      // Skip invalid results
      if (!result || !result.content || typeof result.content !== 'string') {
        totalRejected++;
        continue;
      }

      // Skip duplicate source IDs
      if (seenSourceIds.has(result.id)) {
        totalRejected++;
        continue;
      }
      seenSourceIds.add(result.id);

      const stubType = this.classifyStub(result.content);
      const wordCount = result.content.split(/\s+/).filter(Boolean).length;
      const grade = this.quickGrade(result.content, stubType, wordCount);

      // Update progress
      onProgress?.({
        phase: 'grading',
        searched: totalSearched,
        graded: i + 1,
        accepted: acceptedResults.length,
        rejected: totalRejected,
        expanded: totalExpanded,
        target: cfg.target,
        message: `Grading ${i + 1}/${sortedResults.length}...`,
      });

      // Check if this is a stub
      if (stubType !== 'optimal') {
        // Handle breadcrumbs specially - expand them
        if (stubType === 'stub-breadcrumb' && cfg.expandBreadcrumbs && result.conversationId) {
          onProgress?.({
            phase: 'expanding',
            searched: totalSearched,
            graded: i + 1,
            accepted: acceptedResults.length,
            rejected: totalRejected,
            expanded: totalExpanded,
            target: cfg.target,
            message: 'Expanding breadcrumb context...',
          });

          const expanded = await this.expandBreadcrumb(result, cfg.contextSize);
          if (expanded) {
            totalExpanded++;
            const expandedWordCount = expanded.combinedContent.split(/\s+/).filter(Boolean).length;
            if (expandedWordCount >= cfg.minWordCount) {
              acceptedResults.push({
                original: result,
                stubType: 'optimal', // Upgraded after expansion
                grade: {
                  stubType: 'optimal',
                  wordCount: expandedWordCount,
                  overall: 4, // Boost for expanded content
                  necessity: 4,
                },
                expanded,
              });
              continue;
            }
          }
        }

        // Skip other stubs and short content
        if (wordCount < cfg.minWordCount) {
          totalRejected++;
          continue;
        }
      }

      // Check word count even for "optimal" classified content
      if (wordCount < cfg.minWordCount) {
        totalRejected++;
        continue;
      }

      // Accept if grade meets minimum threshold (configurable, default 2.5)
      if (grade.overall >= cfg.minGrade) {
        acceptedResults.push({
          original: result,
          stubType,
          grade,
        });
      } else {
        totalRejected++;
      }
    }

    // Check if we found enough
    exhausted = acceptedResults.length < cfg.target;

    // Final progress update
    onProgress?.({
      phase: 'complete',
      searched: totalSearched,
      graded: totalSearched,
      accepted: acceptedResults.length,
      rejected: totalRejected,
      expanded: totalExpanded,
      target: cfg.target,
      message: exhausted
        ? `Found ${acceptedResults.length} quality results (search exhausted)`
        : `Found ${acceptedResults.length} quality results`,
    });

    return {
      results: acceptedResults,
      stats: {
        totalSearched,
        totalRejected,
        totalExpanded,
        exhausted,
      },
    };
  }

  /**
   * Calculate Jaccard similarity between two texts (0.0 to 1.0)
   */
  private jaccardSimilarity(text1: string, text2: string): number {
    const normalize = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words1 = new Set(normalize(text1).split(' ').filter(Boolean));
    const words2 = new Set(normalize(text2).split(' ').filter(Boolean));

    if (words1.size === 0 && words2.size === 0) return 1.0;
    if (words1.size === 0 || words2.size === 0) return 0.0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Check if content is duplicate based on dedup config
   */
  private isDuplicate(
    content: string,
    seenPrefixes: Set<string>,
    seenContents: string[],
    dedupConfig: DeduplicationConfig
  ): boolean {
    const normalizePrefix = (text: string): string => {
      return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, dedupConfig.prefixLength);
    };

    // Prefix-based check
    if (dedupConfig.method === 'prefix' || dedupConfig.method === 'both') {
      const prefix = normalizePrefix(content);
      if (seenPrefixes.has(prefix)) {
        return true;
      }
    }

    // Jaccard-based check
    if (dedupConfig.method === 'jaccard' || dedupConfig.method === 'both') {
      for (const seen of seenContents) {
        const similarity = this.jaccardSimilarity(content, seen);
        if (similarity >= dedupConfig.jaccardThreshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Search embeddings database
   * Uses filtered search to ensure quality content
   * Optionally uses HybridSearch (dense + FTS5) when enabled
   */
  private async searchEmbeddings(
    query: string,
    config: HarvestOptions
  ): Promise<SearchResult[]> {
    try {
      const embDb = getEmbeddingDatabase();
      const { embed } = await import('./embeddings/EmbeddingGenerator');

      // Generate query embedding (convert to Float32Array for HybridSearch compatibility)
      const queryEmbeddingArray = await embed(query);
      const queryEmbedding = new Float32Array(queryEmbeddingArray);

      // Deduplication tracking
      const seenPrefixes = new Set<string>();
      const seenContents: string[] = [];
      const normalizePrefix = (text: string): string => {
        return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, config.deduplication.prefixLength);
      };

      const addToDedup = (content: string) => {
        seenPrefixes.add(normalizePrefix(content));
        // Only track content for Jaccard if using Jaccard dedup (memory optimization)
        if (config.deduplication.method === 'jaccard' || config.deduplication.method === 'both') {
          seenContents.push(content);
        }
      };

      // Get full message info and filter by content length
      const results: SearchResult[] = [];
      // Minimum 200 chars to be useful (roughly 30-40 words)
      const minContentLength = 200;

      // === HybridSearch for content_nodes (dense + FTS5) ===
      if (config.useHybridSearch) {
        try {
          const db = embDb.getRawDb();
          const vecLoaded = embDb.isVecLoaded();
          const hybridSearch = new HybridSearchService(db, vecLoaded);

          console.log(`[HarvestService] Running HybridSearch for "${query}"`);
          const hybridResults = await hybridSearch.search(query, queryEmbedding, {
            searchLimit: config.searchLimit * 3,
            limit: config.searchLimit,
            denseWeight: 0.6,
            sparseWeight: 0.25,
          });

          // Fetch content for hybrid results
          for (const hr of hybridResults) {
            try {
              // Get content from content_nodes table
              const row = db.prepare(`
                SELECT id, text, title, type, source, word_count, author_name, created_at
                FROM content_nodes WHERE id = ?
              `).get(hr.id) as {
                id: string;
                text: string;
                title?: string;
                type: string;
                source: string;
                word_count: number;
                author_name?: string;
                created_at?: number;
              } | undefined;

              if (!row || !row.text || row.text.length < minContentLength) continue;

              // Check for duplicates using configurable dedup
              if (this.isDuplicate(row.text, seenPrefixes, seenContents, config.deduplication)) {
                continue;
              }
              addToDedup(row.text);

              results.push({
                id: row.id,
                content: row.text,
                type: row.type || 'content',
                source: row.source || 'archive',
                similarity: hr.fusedScore,
                authorName: row.author_name,
                createdAt: row.created_at,
              });

              if (results.length >= config.searchLimit) break;
            } catch (err) {
              // Skip invalid hybrid results
            }
          }

          console.log(`[HarvestService] HybridSearch returned ${results.length} results`);
        } catch (err) {
          console.warn('[HarvestService] HybridSearch failed, falling back to dense-only:', err);
        }
      }

      // === Dense-only search for messages (existing behavior) ===
      if (results.length < config.searchLimit) {
        // Search 5x the limit to account for filtering and deduplication
        const searchLimit = (config.searchLimit - results.length) * 5;
        const messageResults = embDb.searchMessagesFiltered(
          queryEmbeddingArray, // Use number[] for EmbeddingDatabase methods
          [], // No explicit filters, but the search returns full content
          searchLimit
        );

        for (const result of messageResults) {
          // Skip short content early
          if (!result.content || result.content.length < minContentLength) {
            continue;
          }

          // Skip duplicates using configurable dedup
          if (this.isDuplicate(result.content, seenPrefixes, seenContents, config.deduplication)) {
            continue;
          }
          addToDedup(result.content);

          try {
            results.push({
              id: result.id,
              content: result.content,
              type: 'message',
              source: 'openai',
              similarity: result.similarity,
              conversationId: result.conversationId,
              conversationTitle: result.metadata?.conversationTitle as string,
              createdAt: result.metadata?.createdAt as number,
            });
          } catch (error) {
            // Skip invalid results
          }

          // Stop if we have enough
          if (results.length >= config.searchLimit) break;
        }
      }

      // === Also search content items if we need more ===
      if (results.length < config.searchLimit) {
        try {
          const contentResults = embDb.searchContentItems(
            queryEmbeddingArray, // Use number[] for EmbeddingDatabase methods
            (config.searchLimit - results.length) * 3,
            config.types?.[0],
            config.sources?.[0]
          );

          for (const result of contentResults) {
            const item = embDb.getContentItem(result.content_item_id);
            if (item && typeof item.text === 'string' && item.text.length >= minContentLength) {
              // Skip duplicates using configurable dedup
              if (this.isDuplicate(item.text, seenPrefixes, seenContents, config.deduplication)) {
                continue;
              }
              addToDedup(item.text);

              results.push({
                id: result.content_item_id,
                content: item.text,
                type: result.type,
                source: result.source,
                similarity: 1 - result.distance,
                authorName: item.author_name as string | undefined,
                createdAt: item.created_at as number | undefined,
              });

              if (results.length >= config.searchLimit) break;
            }
          }
        } catch (error) {
          // Content search failed, continue with existing results
        }
      }

      // Sort by quality: combine similarity with word count bonus (configurable)
      // Longer content gets a boost to prioritize substantive results
      results.sort((a, b) => {
        const aWordCount = a.content.split(/\s+/).filter(Boolean).length;
        const bWordCount = b.content.split(/\s+/).filter(Boolean).length;
        const aLengthBonus = Math.min(config.lengthBonusMax, aWordCount / config.lengthBonusDivisor);
        const bLengthBonus = Math.min(config.lengthBonusMax, bWordCount / config.lengthBonusDivisor);
        const aScore = a.similarity + aLengthBonus;
        const bScore = b.similarity + bLengthBonus;
        return bScore - aScore;
      });

      console.log(`[HarvestService] Search returned ${results.length} unique results (min ${minContentLength} chars, ${seenPrefixes.size} prefixes checked)`);

      // Limit to config.searchLimit
      return results.slice(0, config.searchLimit);
    } catch (error) {
      console.error('[HarvestService] Search failed:', error);
      return [];
    }
  }

  /**
   * Classify stub type
   */
  private classifyStub(content: string): StubClassification {
    const trimmed = content.trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const sentenceCount = trimmed.split(/[.!?]+/).filter(Boolean).length;
    const hasUrl = /https?:\/\//.test(trimmed);

    // Media
    if (
      /\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|pdf)$/i.test(trimmed) ||
      /\[image\]|\[video\]|\[audio\]|\[attachment\]/i.test(trimmed) ||
      /!\[.*\]\(.*\)/.test(trimmed)
    ) {
      return 'stub-media';
    }

    // Reference
    if (hasUrl && wordCount < 100) {
      const urls = trimmed.match(/https?:\/\/\S+/g) || [];
      const urlLength = urls.join('').length;
      if (urlLength / trimmed.length > 0.3) return 'stub-reference';
    }

    // Sentence
    if (wordCount <= 25 && sentenceCount <= 1) return 'stub-sentence';

    // Note
    if (
      wordCount < 50 &&
      /^(TODO|NOTE|IDEA|REMEMBER|TBD|FIXME|WIP):/i.test(trimmed)
    ) {
      return 'stub-note';
    }

    // Breadcrumb
    if (
      /^(in the context of|related to|see also|this leads to|following up on|as mentioned in|regarding|re:|cf\.|per|about the)/i.test(
        trimmed
      ) &&
      wordCount < 30
    ) {
      return 'stub-breadcrumb';
    }

    return 'optimal';
  }

  /**
   * Quick grade
   */
  private quickGrade(
    content: string,
    stubType: StubClassification,
    wordCount: number
  ): QuickGrade {
    // Calculate necessity based on content signals
    const hasSpecificDetails = /\d+/.test(content) || /\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(content);
    const hasEmotionalContent = /\b(love|hate|fear|joy|feel|felt|think|believe)\b/i.test(content);
    const hasActionable = /\b(should|must|need to|try to|make sure)\b/i.test(content);
    const hasInsight = /\b(realized|discovered|key is|important thing|interestingly)\b/i.test(content);

    const signalCount = [hasSpecificDetails, hasEmotionalContent, hasActionable, hasInsight].filter(Boolean).length;
    const necessity = Math.min(5, Math.max(1, Math.ceil(signalCount / 4 * 5) + 1));

    // Overall based on stub type and signals
    let overall = stubType === 'optimal' ? necessity : Math.max(1, necessity - 1);

    // Boost for longer content
    if (wordCount > 100) overall = Math.min(5, overall + 1);

    return {
      stubType,
      wordCount,
      overall,
      necessity,
    };
  }

  /**
   * Expand breadcrumb by fetching context
   */
  private async expandBreadcrumb(
    result: SearchResult,
    contextSize: number
  ): Promise<{ previousMessages: string[]; nextMessages: string[]; combinedContent: string } | null> {
    if (!result.conversationId) return null;

    try {
      const embDb = getEmbeddingDatabase();
      const messages = embDb.getMessagesForConversation(result.conversationId);

      // Find the target message index
      const targetIndex = messages.findIndex(m => m.content === result.content);
      if (targetIndex === -1) return null;

      // Get context messages
      const startIndex = Math.max(0, targetIndex - contextSize);
      const endIndex = Math.min(messages.length - 1, targetIndex + contextSize);

      const previousMessages = messages
        .slice(startIndex, targetIndex)
        .map(m => m.content || '');
      const nextMessages = messages
        .slice(targetIndex + 1, endIndex + 1)
        .map(m => m.content || '');

      const combinedContent = [
        ...previousMessages,
        result.content,
        ...nextMessages,
      ].join('\n\n---\n\n');

      return {
        previousMessages,
        nextMessages,
        combinedContent,
      };
    } catch (error) {
      console.error('[HarvestService] Failed to expand breadcrumb:', error);
      return null;
    }
  }
}

// Singleton instance
let harvestServiceInstance: HarvestService | null = null;

export function getHarvestService(): HarvestService {
  if (!harvestServiceInstance) {
    harvestServiceInstance = new HarvestService();
  }
  return harvestServiceInstance;
}
