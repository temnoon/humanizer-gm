/**
 * HarvestService - Server-side Harvest Operations
 *
 * Handles searching archive-server, committing results as cards,
 * and recording harvest history for iterative refinement.
 */

import Database from 'better-sqlite3';
import {
  getDatabase,
  DbCard,
  DbHarvestHistoryEnhanced,
  DbHarvestInstruction,
  generateId,
  now,
} from '../database';
import { getConfig } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface HarvestSearchParams {
  bookId: string;
  query: string;
  chapterId?: string;
  similarityThreshold?: number;
  limit?: number;
  sourceTypes?: string[];
  dateRangeStart?: number;
  dateRangeEnd?: number;
  userId?: string;
}

export interface HarvestSearchResult {
  id: string;
  source_id: string;
  source_type: string;
  source: string;
  content: string;
  title?: string;
  author_name?: string;
  similarity: number;
  source_created_at?: number;
  source_url?: string;
  conversation_id?: string;
  conversation_title?: string;
  metadata?: Record<string, unknown>;
}

export interface HarvestSearchResponse {
  results: HarvestSearchResult[];
  harvestId: string;
  query: string;
  params: HarvestSearchParams;
}

export interface HarvestCommitParams {
  harvestId: string;
  acceptedIds: string[];
  rejectedIds?: string[];
  userId?: string;
}

export interface HarvestCommitResponse {
  cards: DbCard[];
  committed: number;
  harvestId: string;
}

export interface HarvestHistoryEntry {
  id: string;
  bookId: string;
  chapterId?: string;
  query: string;
  similarityThreshold: number;
  resultLimit: number;
  sourceTypes: string[];
  dateRangeStart?: number;
  dateRangeEnd?: number;
  resultCount: number;
  resultIds: string[];
  acceptedIds: string[];
  rejectedIds: string[];
  harvestedCount: number;
  parentHarvestId?: string;
  iterationNumber: number;
  adjustmentNotes?: string;
  createdAt: number;
}

export interface QuerySuggestion {
  type: 'refinement' | 'expansion' | 'related';
  query: string;
  reason: string;
  confidence: number;
}

export interface IterateHarvestParams {
  harvestId: string;
  adjustments: {
    query?: string;
    similarityThreshold?: number;
    limit?: number;
    sourceTypes?: string[];
  };
  notes?: string;
  userId?: string;
}

// Archive server response types
interface ArchiveSearchHit {
  id: string;
  content: string;
  metadata?: {
    source?: string;
    source_type?: string;
    title?: string;
    author?: string;
    created_at?: number;
    url?: string;
    conversation_id?: string;
    conversation_title?: string;
    [key: string]: unknown;
  };
  similarity?: number;
  score?: number;
}

interface ArchiveSearchResponse {
  results: ArchiveSearchHit[];
  total?: number;
  query?: string;
}

// ============================================================================
// HarvestService
// ============================================================================

export class HarvestService {
  private db: Database.Database;
  private archiveServerUrl: string;

  constructor() {
    this.db = getDatabase();
    // Archive server runs on port 3002
    this.archiveServerUrl = 'http://localhost:3002';
  }

  // ============================================================================
  // Search Operations
  // ============================================================================

  /**
   * Search archive-server for content matching the query
   */
  async search(params: HarvestSearchParams): Promise<HarvestSearchResponse> {
    const config = getConfig();

    const similarityThreshold = params.similarityThreshold ?? config.search.defaultSimilarity;
    const limit = Math.min(params.limit ?? config.harvest.defaultTarget, config.harvest.maxResults);
    const sourceTypes = params.sourceTypes ?? ['message'];

    // Get any active harvest instructions for this book
    const instructions = this.getActiveInstructions(params.bookId, params.chapterId);

    // Search archive server
    const results = await this.searchArchiveServer({
      query: params.query,
      similarity: similarityThreshold,
      limit,
      sourceTypes,
      dateRangeStart: params.dateRangeStart,
      dateRangeEnd: params.dateRangeEnd,
      instructions,
    });

    // Apply post-processing filters
    const filteredResults = this.applyFilters(results, params, instructions);

    // Create harvest history entry
    const harvestId = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `
      INSERT INTO harvest_history (
        id, book_id, chapter_id, query, source_types, result_count, harvested_count,
        similarity_threshold, result_limit, date_range_start, date_range_end,
        result_ids, accepted_ids, rejected_ids, iteration_number, config_json,
        created_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, '[]', '[]', 1, ?, ?, ?)
    `
      )
      .run(
        harvestId,
        params.bookId,
        params.chapterId || null,
        params.query,
        JSON.stringify(sourceTypes),
        filteredResults.length,
        similarityThreshold,
        limit,
        params.dateRangeStart || null,
        params.dateRangeEnd || null,
        JSON.stringify(filteredResults.map((r) => r.id)),
        JSON.stringify({ instructions: instructions.map((i) => i.id) }),
        timestamp,
        params.userId || null
      );

    return {
      results: filteredResults,
      harvestId,
      query: params.query,
      params,
    };
  }

  /**
   * Search archive server via HTTP
   */
  private async searchArchiveServer(params: {
    query: string;
    similarity: number;
    limit: number;
    sourceTypes: string[];
    dateRangeStart?: number;
    dateRangeEnd?: number;
    instructions: DbHarvestInstruction[];
  }): Promise<HarvestSearchResult[]> {
    try {
      // Build search request
      const searchBody = {
        query: params.query,
        similarity: params.similarity,
        limit: params.limit,
        source_types: params.sourceTypes,
        date_range: params.dateRangeStart
          ? {
              start: params.dateRangeStart,
              end: params.dateRangeEnd,
            }
          : undefined,
      };

      const response = await fetch(`${this.archiveServerUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody),
      });

      if (!response.ok) {
        throw new Error(`Archive search failed: ${response.status}`);
      }

      const data = (await response.json()) as ArchiveSearchResponse;

      // Map to our result format
      return (data.results || []).map((hit) => ({
        id: hit.id,
        source_id: hit.id,
        source_type: hit.metadata?.source_type || 'message',
        source: hit.metadata?.source || 'archive',
        content: hit.content,
        title: hit.metadata?.title,
        author_name: hit.metadata?.author,
        similarity: hit.similarity ?? hit.score ?? 0,
        source_created_at: hit.metadata?.created_at,
        source_url: hit.metadata?.url,
        conversation_id: hit.metadata?.conversation_id,
        conversation_title: hit.metadata?.conversation_title,
        metadata: hit.metadata,
      }));
    } catch (error) {
      console.error('[HarvestService] Archive search error:', error);
      return [];
    }
  }

  /**
   * Apply harvest instructions as filters
   */
  private applyFilters(
    results: HarvestSearchResult[],
    params: HarvestSearchParams,
    instructions: DbHarvestInstruction[]
  ): HarvestSearchResult[] {
    const config = getConfig();
    let filtered = [...results];

    // Apply instruction filters
    for (const instruction of instructions) {
      const text = instruction.instruction_text.toLowerCase();

      switch (instruction.instruction_type) {
        case 'exclude':
          filtered = filtered.filter(
            (r) =>
              !r.content.toLowerCase().includes(text) &&
              !(r.title?.toLowerCase().includes(text) ?? false)
          );
          break;

        case 'avoid':
          // Deprioritize but don't remove
          filtered = filtered.map((r) => ({
            ...r,
            similarity:
              r.content.toLowerCase().includes(text) ||
              (r.title?.toLowerCase().includes(text) ?? false)
                ? r.similarity * 0.8
                : r.similarity,
          }));
          break;

        case 'prefer':
          // Boost matching results
          filtered = filtered.map((r) => ({
            ...r,
            similarity:
              r.content.toLowerCase().includes(text) ||
              (r.title?.toLowerCase().includes(text) ?? false)
                ? Math.min(1, r.similarity * 1.2)
                : r.similarity,
          }));
          break;
      }
    }

    // Remove low-quality results
    filtered = filtered.filter((r) => {
      const wordCount = r.content.split(/\s+/).length;
      return wordCount >= config.harvest.minWordCount;
    });

    // Deduplicate by content similarity
    filtered = this.deduplicateResults(filtered, config.harvest.dedupeThreshold);

    // Sort by similarity
    filtered.sort((a, b) => b.similarity - a.similarity);

    return filtered;
  }

  /**
   * Remove near-duplicate results
   */
  private deduplicateResults(
    results: HarvestSearchResult[],
    threshold: number
  ): HarvestSearchResult[] {
    const unique: HarvestSearchResult[] = [];

    for (const result of results) {
      const isDuplicate = unique.some((existing) => {
        const similarity = this.textSimilarity(existing.content, result.content);
        return similarity >= threshold;
      });

      if (!isDuplicate) {
        unique.push(result);
      }
    }

    return unique;
  }

  /**
   * Calculate text similarity (Jaccard on word sets)
   */
  private textSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  // ============================================================================
  // Commit Operations
  // ============================================================================

  /**
   * Commit search results as cards
   */
  commit(params: HarvestCommitParams): HarvestCommitResponse {
    // Get harvest entry
    const harvest = this.db
      .prepare('SELECT * FROM harvest_history WHERE id = ?')
      .get(params.harvestId) as DbHarvestHistoryEnhanced | undefined;

    if (!harvest) {
      throw new Error(`Harvest not found: ${params.harvestId}`);
    }

    const resultIds = JSON.parse(harvest.result_ids || '[]') as string[];
    const acceptedIds = params.acceptedIds.filter((id) => resultIds.includes(id));
    const rejectedIds = params.rejectedIds?.filter((id) => resultIds.includes(id)) || [];

    // Create cards for accepted results
    const cards: DbCard[] = [];
    const timestamp = now();

    // We need to fetch the actual result data - it's stored in the response, not the history
    // For now, we'll create placeholder cards and expect the frontend to provide full data
    // This is a TODO: store full results in harvest_history or a separate table

    for (const sourceId of acceptedIds) {
      const cardId = generateId();

      // Insert card with minimal data - frontend will need to provide content
      this.db
        .prepare(
          `
        INSERT INTO cards (
          id, book_id, chapter_id, source_id, source_type, source, content_origin,
          content, harvested_at, status, created_at, updated_at, user_id
        ) VALUES (?, ?, ?, ?, 'message', 'harvest', 'original', '', ?, 'staging', ?, ?, ?)
      `
        )
        .run(
          cardId,
          harvest.book_id,
          harvest.chapter_id || null,
          sourceId,
          timestamp,
          timestamp,
          timestamp,
          params.userId || null
        );

      cards.push({
        id: cardId,
        book_id: harvest.book_id,
        chapter_id: harvest.chapter_id || null,
        source_id: sourceId,
        source_type: 'message',
        source: 'harvest',
        content_origin: 'original',
        content: '',
        title: null,
        author_name: null,
        similarity: null,
        source_created_at: null,
        source_created_at_status: 'unknown',
        harvested_at: timestamp,
        source_url: null,
        conversation_id: null,
        conversation_title: null,
        user_notes: '',
        ai_context: null,
        ai_summary: null,
        tags: '[]',
        canvas_position: null,
        status: 'staging',
        metadata: null,
        grade: null,
        is_outline: 0,
        outline_structure: null,
        role: 'main_source',
        user_id: params.userId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    // Update harvest history
    this.db
      .prepare(
        `
      UPDATE harvest_history SET
        accepted_ids = ?,
        rejected_ids = ?,
        harvested_count = ?
      WHERE id = ?
    `
      )
      .run(
        JSON.stringify(acceptedIds),
        JSON.stringify(rejectedIds),
        acceptedIds.length,
        params.harvestId
      );

    return {
      cards,
      committed: acceptedIds.length,
      harvestId: params.harvestId,
    };
  }

  /**
   * Commit with full result data (preferred method)
   */
  commitWithData(
    harvestId: string,
    results: HarvestSearchResult[],
    acceptedIds: string[],
    rejectedIds: string[] = [],
    userId?: string
  ): HarvestCommitResponse {
    const harvest = this.db
      .prepare('SELECT * FROM harvest_history WHERE id = ?')
      .get(harvestId) as DbHarvestHistoryEnhanced | undefined;

    if (!harvest) {
      throw new Error(`Harvest not found: ${harvestId}`);
    }

    const cards: DbCard[] = [];
    const timestamp = now();

    // Create map of results by ID
    const resultMap = new Map(results.map((r) => [r.id, r]));

    for (const sourceId of acceptedIds) {
      const result = resultMap.get(sourceId);
      if (!result) continue;

      const cardId = generateId();

      this.db
        .prepare(
          `
        INSERT INTO cards (
          id, book_id, chapter_id, source_id, source_type, source, content_origin,
          content, title, author_name, similarity, source_created_at, source_created_at_status,
          harvested_at, source_url, conversation_id, conversation_title,
          status, metadata, created_at, updated_at, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'original', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?, ?, ?)
      `
        )
        .run(
          cardId,
          harvest.book_id,
          harvest.chapter_id || null,
          result.source_id,
          result.source_type,
          result.source,
          result.content,
          result.title || null,
          result.author_name || null,
          result.similarity,
          result.source_created_at || null,
          result.source_created_at ? 'known' : 'unknown',
          timestamp,
          result.source_url || null,
          result.conversation_id || null,
          result.conversation_title || null,
          result.metadata ? JSON.stringify(result.metadata) : null,
          timestamp,
          timestamp,
          userId || null
        );

      cards.push({
        id: cardId,
        book_id: harvest.book_id,
        chapter_id: harvest.chapter_id || null,
        source_id: result.source_id,
        source_type: result.source_type,
        source: result.source,
        content_origin: 'original',
        content: result.content,
        title: result.title || null,
        author_name: result.author_name || null,
        similarity: result.similarity,
        source_created_at: result.source_created_at || null,
        source_created_at_status: result.source_created_at ? 'known' : 'unknown',
        harvested_at: timestamp,
        source_url: result.source_url || null,
        conversation_id: result.conversation_id || null,
        conversation_title: result.conversation_title || null,
        user_notes: '',
        ai_context: null,
        ai_summary: null,
        tags: '[]',
        canvas_position: null,
        status: 'staging',
        metadata: result.metadata ? JSON.stringify(result.metadata) : null,
        grade: null,
        is_outline: 0,
        outline_structure: null,
        role: 'main_source',
        user_id: userId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    // Update harvest history
    this.db
      .prepare(
        `
      UPDATE harvest_history SET
        accepted_ids = ?,
        rejected_ids = ?,
        harvested_count = ?
      WHERE id = ?
    `
      )
      .run(JSON.stringify(acceptedIds), JSON.stringify(rejectedIds), cards.length, harvestId);

    return {
      cards,
      committed: cards.length,
      harvestId,
    };
  }

  // ============================================================================
  // History Operations
  // ============================================================================

  /**
   * Get harvest history for a book
   */
  getHistory(
    bookId: string,
    options: { page?: number; limit?: number; chapterId?: string } = {}
  ): { harvests: HarvestHistoryEntry[]; total: number; page: number; pageSize: number } {
    const page = options.page ?? 1;
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = (page - 1) * limit;

    let countQuery = 'SELECT COUNT(*) as count FROM harvest_history WHERE book_id = ?';
    let selectQuery = `
      SELECT * FROM harvest_history
      WHERE book_id = ?
    `;
    const params: (string | number)[] = [bookId];

    if (options.chapterId) {
      countQuery += ' AND chapter_id = ?';
      selectQuery += ' AND chapter_id = ?';
      params.push(options.chapterId);
    }

    selectQuery += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const countRow = this.db.prepare(countQuery).get(...params) as { count: number };
    const total = countRow.count;

    const rows = this.db.prepare(selectQuery).all(...params, limit, offset) as Array<
      Record<string, unknown>
    >;

    const harvests: HarvestHistoryEntry[] = rows.map((row) => ({
      id: row.id as string,
      bookId: row.book_id as string,
      chapterId: (row.chapter_id as string) || undefined,
      query: row.query as string,
      similarityThreshold: (row.similarity_threshold as number) ?? 0.3,
      resultLimit: (row.result_limit as number) ?? 20,
      sourceTypes: JSON.parse((row.source_types as string) || '[]'),
      dateRangeStart: (row.date_range_start as number) || undefined,
      dateRangeEnd: (row.date_range_end as number) || undefined,
      resultCount: (row.result_count as number) || 0,
      resultIds: JSON.parse((row.result_ids as string) || '[]'),
      acceptedIds: JSON.parse((row.accepted_ids as string) || '[]'),
      rejectedIds: JSON.parse((row.rejected_ids as string) || '[]'),
      harvestedCount: (row.harvested_count as number) || 0,
      parentHarvestId: (row.parent_harvest_id as string) || undefined,
      iterationNumber: (row.iteration_number as number) ?? 1,
      adjustmentNotes: (row.adjustment_notes as string) || undefined,
      createdAt: row.created_at as number,
    }));

    return { harvests, total, page, pageSize: limit };
  }

  /**
   * Get a specific harvest entry
   */
  getHarvest(harvestId: string): HarvestHistoryEntry | null {
    const row = this.db.prepare('SELECT * FROM harvest_history WHERE id = ?').get(harvestId) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      bookId: row.book_id as string,
      chapterId: (row.chapter_id as string) || undefined,
      query: row.query as string,
      similarityThreshold: (row.similarity_threshold as number) ?? 0.3,
      resultLimit: (row.result_limit as number) ?? 20,
      sourceTypes: JSON.parse((row.source_types as string) || '[]'),
      dateRangeStart: (row.date_range_start as number) || undefined,
      dateRangeEnd: (row.date_range_end as number) || undefined,
      resultCount: (row.result_count as number) || 0,
      resultIds: JSON.parse((row.result_ids as string) || '[]'),
      acceptedIds: JSON.parse((row.accepted_ids as string) || '[]'),
      rejectedIds: JSON.parse((row.rejected_ids as string) || '[]'),
      harvestedCount: (row.harvested_count as number) || 0,
      parentHarvestId: (row.parent_harvest_id as string) || undefined,
      iterationNumber: (row.iteration_number as number) ?? 1,
      adjustmentNotes: (row.adjustment_notes as string) || undefined,
      createdAt: row.created_at as number,
    };
  }

  // ============================================================================
  // Iteration Operations
  // ============================================================================

  /**
   * Create an iterative harvest based on a previous one
   */
  async iterate(params: IterateHarvestParams): Promise<HarvestSearchResponse> {
    const parentHarvest = this.getHarvest(params.harvestId);
    if (!parentHarvest) {
      throw new Error(`Parent harvest not found: ${params.harvestId}`);
    }

    // Build new search params from parent + adjustments
    const searchParams: HarvestSearchParams = {
      bookId: parentHarvest.bookId,
      chapterId: parentHarvest.chapterId,
      query: params.adjustments.query ?? parentHarvest.query,
      similarityThreshold:
        params.adjustments.similarityThreshold ?? parentHarvest.similarityThreshold,
      limit: params.adjustments.limit ?? parentHarvest.resultLimit,
      sourceTypes: params.adjustments.sourceTypes ?? parentHarvest.sourceTypes,
      dateRangeStart: parentHarvest.dateRangeStart,
      dateRangeEnd: parentHarvest.dateRangeEnd,
      userId: params.userId,
    };

    // Run new search
    const response = await this.search(searchParams);

    // Update the new harvest entry to link to parent
    this.db
      .prepare(
        `
      UPDATE harvest_history SET
        parent_harvest_id = ?,
        iteration_number = ?,
        adjustment_notes = ?
      WHERE id = ?
    `
      )
      .run(
        params.harvestId,
        parentHarvest.iterationNumber + 1,
        params.notes || null,
        response.harvestId
      );

    return response;
  }

  // ============================================================================
  // Suggestion Operations
  // ============================================================================

  /**
   * Suggest query refinements based on harvest history
   */
  getSuggestions(bookId: string): QuerySuggestion[] {
    const suggestions: QuerySuggestion[] = [];

    // Get recent harvests
    const { harvests } = this.getHistory(bookId, { limit: 10 });

    if (harvests.length === 0) {
      return [
        {
          type: 'expansion',
          query: 'memories conversations stories',
          reason: 'Start with broad search terms',
          confidence: 0.5,
        },
      ];
    }

    // Analyze patterns
    const successfulQueries = harvests.filter((h) => h.harvestedCount > 0).map((h) => h.query);

    const lowYieldQueries = harvests.filter((h) => h.resultCount > 0 && h.harvestedCount === 0);

    // Suggest based on successful patterns
    if (successfulQueries.length > 0) {
      const keywords = this.extractCommonKeywords(successfulQueries);
      if (keywords.length >= 2) {
        suggestions.push({
          type: 'related',
          query: keywords.slice(0, 3).join(' '),
          reason: `Based on your successful harvests`,
          confidence: 0.7,
        });
      }
    }

    // Suggest refinements for low-yield searches
    for (const harvest of lowYieldQueries.slice(0, 2)) {
      suggestions.push({
        type: 'refinement',
        query: `"${harvest.query}" specific moments`,
        reason: `Refine: "${harvest.query}" had results but none accepted`,
        confidence: 0.6,
      });
    }

    // Suggest expanding similarity threshold if harvests are sparse
    const avgYield =
      harvests.reduce((sum, h) => sum + h.harvestedCount, 0) / Math.max(harvests.length, 1);
    if (avgYield < 3 && harvests.length > 2) {
      suggestions.push({
        type: 'expansion',
        query: harvests[0]?.query || 'general search',
        reason: 'Consider lowering similarity threshold to find more results',
        confidence: 0.5,
      });
    }

    return suggestions.slice(0, 5);
  }

  /**
   * Extract common keywords from queries
   */
  private extractCommonKeywords(queries: string[]): string[] {
    const wordCounts = new Map<string, number>();
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
    ]);

    for (const query of queries) {
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    return Array.from(wordCounts.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
  }

  // ============================================================================
  // Instruction Operations
  // ============================================================================

  /**
   * Get active harvest instructions for a book/chapter
   */
  getActiveInstructions(bookId: string, chapterId?: string): DbHarvestInstruction[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM harvest_instructions
      WHERE book_id = ? AND active = 1
        AND (chapter_id IS NULL OR chapter_id = ?)
      ORDER BY priority DESC
    `
      )
      .all(bookId, chapterId || null) as DbHarvestInstruction[];

    return rows;
  }

  /**
   * Create a harvest instruction
   */
  createInstruction(params: {
    bookId: string;
    chapterId?: string;
    instructionType: 'include' | 'exclude' | 'prefer' | 'avoid';
    instructionText: string;
    appliesToSources?: string[];
    priority?: number;
    userId?: string;
  }): DbHarvestInstruction {
    const id = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `
      INSERT INTO harvest_instructions (
        id, book_id, chapter_id, instruction_type, instruction_text,
        applies_to_sources, priority, active, created_at, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `
      )
      .run(
        id,
        params.bookId,
        params.chapterId || null,
        params.instructionType,
        params.instructionText,
        params.appliesToSources ? JSON.stringify(params.appliesToSources) : null,
        params.priority ?? 1,
        timestamp,
        timestamp,
        params.userId || null
      );

    return {
      id,
      book_id: params.bookId,
      chapter_id: params.chapterId || null,
      instruction_type: params.instructionType,
      instruction_text: params.instructionText,
      applies_to_sources: params.appliesToSources ? JSON.stringify(params.appliesToSources) : null,
      applies_to_date_range: null,
      priority: params.priority ?? 1,
      active: 1,
      created_at: timestamp,
      updated_at: timestamp,
      user_id: params.userId || null,
    };
  }

  /**
   * Delete a harvest instruction
   */
  deleteInstruction(instructionId: string): void {
    this.db.prepare('DELETE FROM harvest_instructions WHERE id = ?').run(instructionId);
  }

  /**
   * Toggle instruction active state
   */
  toggleInstruction(instructionId: string, active: boolean): void {
    this.db
      .prepare('UPDATE harvest_instructions SET active = ?, updated_at = ? WHERE id = ?')
      .run(active ? 1 : 0, now(), instructionId);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let harvestServiceInstance: HarvestService | null = null;

export function getHarvestService(): HarvestService {
  if (!harvestServiceInstance) {
    harvestServiceInstance = new HarvestService();
  }
  return harvestServiceInstance;
}
