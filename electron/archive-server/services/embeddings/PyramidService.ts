/**
 * PyramidService - Hierarchical Embedding Pyramid Builder
 *
 * Creates 3-level embedding pyramids for content:
 * - L0: Base chunks (paragraphs/sentences) with embeddings
 * - L1: Cluster summaries with embeddings
 * - Apex: Document synthesis with embeddings
 *
 * Leverages:
 * - ChunkingService for L0 content splitting
 * - EmbeddingGenerator for nomic-embed-text embeddings
 * - Ollama for LLM summarization at L1 and apex levels
 */

import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { ChunkingService, type ContentChunk, type ChunkingResult } from '../content-graph/ChunkingService';
import {
  embed,
  embedBatch,
  chunkForEmbedding,
  computeCentroid,
  cosineSimilarity,
} from './EmbeddingGenerator';

// ============================================================================
// Types
// ============================================================================

export interface PyramidChunk {
  id: string;
  threadId: string;
  threadType: string;
  chunkIndex: number;
  content: string;
  wordCount: number;
  startOffset?: number;
  endOffset?: number;
  boundaryType?: string;
  embedding?: number[];
}

export interface PyramidSummary {
  id: string;
  threadId: string;
  level: number;
  content: string;
  wordCount: number;
  childIds: string[];
  childType: 'chunk' | 'summary';
  sourceWordCount: number;
  compressionRatio: number;
  embedding?: number[];
  modelUsed?: string;
}

export interface PyramidApex {
  id: string;
  threadId: string;
  summary: string;
  themes: string[];
  totalChunks: number;
  pyramidDepth: number;
  totalSourceWords: number;
  embedding?: number[];
  modelUsed?: string;
}

export interface PyramidBuildResult {
  threadId: string;
  chunks: PyramidChunk[];
  summaries: PyramidSummary[];
  apex: PyramidApex | null;
  stats: {
    chunksCreated: number;
    summariesCreated: number;
    totalSourceWords: number;
    pyramidDepth: number;
    processingTimeMs: number;
  };
}

export interface PyramidStats {
  totalThreads: number;
  totalChunks: number;
  totalSummaries: number;
  totalApexes: number;
  chunksWithEmbeddings: number;
  summariesWithEmbeddings: number;
  apexesWithEmbeddings: number;
}

export interface BatchResult {
  processed: number;
  total: number;
  errors: number;
  threads: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const OLLAMA_ENDPOINT = 'http://localhost:11434';
const DEFAULT_SUMMARIZATION_MODEL = 'llama3.2';
const CHUNKS_PER_SUMMARY = 5;  // Number of L0 chunks to summarize at L1
const TARGET_SUMMARY_WORDS = 150;  // Target words for L1 summaries
const TARGET_APEX_WORDS = 300;  // Target words for apex synthesis

// ============================================================================
// Service
// ============================================================================

export class PyramidService {
  private db: Database.Database;
  private chunkingService: ChunkingService;
  private summarizationModel: string;

  constructor(db: Database.Database, summarizationModel?: string) {
    this.db = db;
    this.chunkingService = new ChunkingService();
    this.summarizationModel = summarizationModel || DEFAULT_SUMMARIZATION_MODEL;
  }

  /**
   * Build a complete pyramid for a single thread
   */
  async buildPyramid(
    threadId: string,
    threadType: string,
    content: string,
    options?: {
      skipSummaries?: boolean;
      skipApex?: boolean;
      onProgress?: (phase: string, progress: number) => void;
    }
  ): Promise<PyramidBuildResult> {
    const startTime = Date.now();
    const { skipSummaries = false, skipApex = false, onProgress } = options || {};

    // Phase 1: L0 Chunking
    onProgress?.('chunking', 0);
    const chunkingResult = this.chunkingService.chunkContent(
      content,
      this.inferSourceType(threadType),
      undefined
    );

    const chunks: PyramidChunk[] = chunkingResult.chunks.map((chunk, index) => ({
      id: uuidv4(),
      threadId,
      threadType,
      chunkIndex: index,
      content: chunk.text,
      wordCount: chunk.wordCount,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      boundaryType: chunk.boundaryType,
    }));

    // Phase 2: L0 Embeddings
    onProgress?.('embedding_l0', 0.2);
    const chunkTexts = chunks.map(c => c.content);
    const chunkEmbeddings = await embedBatch(chunkTexts, {
      onProgress: (done, total) => {
        onProgress?.('embedding_l0', 0.2 + (done / total) * 0.3);
      },
    });

    // Attach embeddings to chunks
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = chunkEmbeddings[i];
    }

    // Store L0 chunks in database
    this.storeChunks(chunks);

    let summaries: PyramidSummary[] = [];
    let apex: PyramidApex | null = null;

    // Phase 3: L1 Summaries (if not skipped)
    if (!skipSummaries && chunks.length > 1) {
      onProgress?.('summarizing_l1', 0.5);
      summaries = await this.createL1Summaries(chunks, threadId);

      // Embed summaries
      if (summaries.length > 0) {
        const summaryTexts = summaries.map(s => s.content);
        const summaryEmbeddings = await embedBatch(summaryTexts);
        for (let i = 0; i < summaries.length; i++) {
          summaries[i].embedding = summaryEmbeddings[i];
        }

        // Store L1 summaries
        this.storeSummaries(summaries);
      }
    }

    // Phase 4: Apex (if not skipped and enough content)
    if (!skipApex && chunks.length >= 3) {
      onProgress?.('apex', 0.8);
      apex = await this.createApex(
        threadId,
        chunks,
        summaries,
        chunkingResult.sourceWordCount
      );

      if (apex) {
        // Embed apex
        apex.embedding = await embed(apex.summary);
        this.storeApex(apex);
      }
    }

    onProgress?.('complete', 1);

    const processingTimeMs = Date.now() - startTime;
    const pyramidDepth = apex ? 3 : (summaries.length > 0 ? 2 : 1);

    return {
      threadId,
      chunks,
      summaries,
      apex,
      stats: {
        chunksCreated: chunks.length,
        summariesCreated: summaries.length,
        totalSourceWords: chunkingResult.sourceWordCount,
        pyramidDepth,
        processingTimeMs,
      },
    };
  }

  /**
   * Build pyramids for all unembedded content items
   */
  async buildPyramidsForUnembedded(
    onProgress?: (completed: number, total: number, currentId: string) => void
  ): Promise<BatchResult> {
    // Find content items without pyramid data
    const unembedded = this.db.prepare(`
      SELECT ci.id, ci.type, ci.text
      FROM content_items ci
      LEFT JOIN pyramid_chunks pc ON pc.thread_id = ci.id
      WHERE ci.text IS NOT NULL
        AND LENGTH(ci.text) > 50
        AND pc.id IS NULL
      LIMIT 1000
    `).all() as Array<{ id: string; type: string; text: string }>;

    const result: BatchResult = {
      processed: 0,
      total: unembedded.length,
      errors: 0,
      threads: [],
    };

    for (let i = 0; i < unembedded.length; i++) {
      const item = unembedded[i];
      try {
        onProgress?.(i, unembedded.length, item.id);
        await this.buildPyramid(item.id, item.type, item.text, {
          skipSummaries: item.text.length < 2000, // Only create summaries for longer content
          skipApex: item.text.length < 5000,
        });
        result.processed++;
        result.threads.push(item.id);
      } catch (error) {
        console.error(`[PyramidService] Failed to build pyramid for ${item.id}:`, error);
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Get pyramid statistics
   */
  getStats(): PyramidStats {
    const stats = this.db.prepare(`
      SELECT
        (SELECT COUNT(DISTINCT thread_id) FROM pyramid_chunks) as totalThreads,
        (SELECT COUNT(*) FROM pyramid_chunks) as totalChunks,
        (SELECT COUNT(*) FROM pyramid_summaries) as totalSummaries,
        (SELECT COUNT(*) FROM pyramid_apex) as totalApexes,
        (SELECT COUNT(*) FROM pyramid_chunks WHERE embedding IS NOT NULL) as chunksWithEmbeddings,
        (SELECT COUNT(*) FROM pyramid_summaries WHERE embedding IS NOT NULL) as summariesWithEmbeddings,
        (SELECT COUNT(*) FROM pyramid_apex WHERE embedding IS NOT NULL) as apexesWithEmbeddings
    `).get() as PyramidStats;

    return stats;
  }

  /**
   * Search across pyramid levels
   */
  async searchPyramid(
    query: string,
    options?: {
      limit?: number;
      levels?: ('chunk' | 'summary' | 'apex')[];
      threadTypes?: string[];
    }
  ): Promise<Array<{
    id: string;
    threadId: string;
    level: 'chunk' | 'summary' | 'apex';
    content: string;
    similarity: number;
  }>> {
    const { limit = 20, levels = ['chunk', 'summary', 'apex'], threadTypes } = options || {};

    // Generate query embedding
    const queryEmbedding = await embed(query);

    const results: Array<{
      id: string;
      threadId: string;
      level: 'chunk' | 'summary' | 'apex';
      content: string;
      similarity: number;
    }> = [];

    // Search chunks
    if (levels.includes('chunk')) {
      const chunkQuery = threadTypes
        ? `SELECT id, thread_id, content, embedding FROM pyramid_chunks
           WHERE embedding IS NOT NULL AND thread_type IN (${threadTypes.map(() => '?').join(',')})
           LIMIT ?`
        : `SELECT id, thread_id, content, embedding FROM pyramid_chunks
           WHERE embedding IS NOT NULL LIMIT ?`;

      const chunks = threadTypes
        ? (this.db.prepare(chunkQuery).all(...threadTypes, limit * 3) as Array<{ id: string; thread_id: string; content: string; embedding: Buffer }>)
        : (this.db.prepare(chunkQuery).all(limit * 3) as Array<{ id: string; thread_id: string; content: string; embedding: Buffer }>);

      for (const chunk of chunks) {
        if (!chunk.embedding) continue;
        const embedding = this.bufferToFloatArray(chunk.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        results.push({
          id: chunk.id,
          threadId: chunk.thread_id,
          level: 'chunk',
          content: chunk.content,
          similarity,
        });
      }
    }

    // Search summaries
    if (levels.includes('summary')) {
      const summaries = this.db.prepare(`
        SELECT id, thread_id, content, embedding
        FROM pyramid_summaries
        WHERE embedding IS NOT NULL
        LIMIT ?
      `).all(limit * 2) as Array<{ id: string; thread_id: string; content: string; embedding: Buffer }>;

      for (const summary of summaries) {
        if (!summary.embedding) continue;
        const embedding = this.bufferToFloatArray(summary.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        results.push({
          id: summary.id,
          threadId: summary.thread_id,
          level: 'summary',
          content: summary.content,
          similarity,
        });
      }
    }

    // Search apex
    if (levels.includes('apex')) {
      const apexes = this.db.prepare(`
        SELECT id, thread_id, summary as content, embedding
        FROM pyramid_apex
        WHERE embedding IS NOT NULL
        LIMIT ?
      `).all(limit) as Array<{ id: string; thread_id: string; content: string; embedding: Buffer }>;

      for (const apex of apexes) {
        if (!apex.embedding) continue;
        const embedding = this.bufferToFloatArray(apex.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        results.push({
          id: apex.id,
          threadId: apex.thread_id,
          level: 'apex',
          content: apex.content,
          similarity,
        });
      }
    }

    // Sort by similarity and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Delete pyramid data for a thread
   */
  deletePyramid(threadId: string): void {
    this.db.prepare('DELETE FROM pyramid_chunks WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM pyramid_summaries WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM pyramid_apex WHERE thread_id = ?').run(threadId);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Create L1 summaries by grouping chunks
   */
  private async createL1Summaries(
    chunks: PyramidChunk[],
    threadId: string
  ): Promise<PyramidSummary[]> {
    const summaries: PyramidSummary[] = [];
    const numGroups = Math.ceil(chunks.length / CHUNKS_PER_SUMMARY);

    for (let i = 0; i < numGroups; i++) {
      const groupStart = i * CHUNKS_PER_SUMMARY;
      const groupEnd = Math.min(groupStart + CHUNKS_PER_SUMMARY, chunks.length);
      const groupChunks = chunks.slice(groupStart, groupEnd);

      // Combine chunks for summarization
      const combinedText = groupChunks.map(c => c.content).join('\n\n');
      const sourceWordCount = groupChunks.reduce((sum, c) => sum + c.wordCount, 0);

      try {
        const summaryText = await this.summarize(
          combinedText,
          TARGET_SUMMARY_WORDS,
          'Summarize the following content concisely:'
        );

        const wordCount = summaryText.split(/\s+/).filter(Boolean).length;

        summaries.push({
          id: uuidv4(),
          threadId,
          level: 1,
          content: summaryText,
          wordCount,
          childIds: groupChunks.map(c => c.id),
          childType: 'chunk',
          sourceWordCount,
          compressionRatio: sourceWordCount / wordCount,
          modelUsed: this.summarizationModel,
        });
      } catch (error) {
        console.warn(`[PyramidService] Failed to create L1 summary for group ${i}:`, error);
        // Create a simple extractive summary as fallback
        const extractive = groupChunks[0].content.substring(0, 500);
        summaries.push({
          id: uuidv4(),
          threadId,
          level: 1,
          content: extractive,
          wordCount: extractive.split(/\s+/).filter(Boolean).length,
          childIds: groupChunks.map(c => c.id),
          childType: 'chunk',
          sourceWordCount,
          compressionRatio: sourceWordCount / extractive.split(/\s+/).filter(Boolean).length,
          modelUsed: 'extractive',
        });
      }
    }

    return summaries;
  }

  /**
   * Create apex synthesis
   */
  private async createApex(
    threadId: string,
    chunks: PyramidChunk[],
    summaries: PyramidSummary[],
    totalSourceWords: number
  ): Promise<PyramidApex | null> {
    try {
      // Use summaries if available, otherwise use chunks
      const contentToSynthesize = summaries.length > 0
        ? summaries.map(s => s.content).join('\n\n')
        : chunks.map(c => c.content).join('\n\n');

      const prompt = `Provide a comprehensive synthesis of the following content. Include:
1. Main themes and ideas
2. Key insights
3. Overall message or conclusion

Content:`;

      const synthesis = await this.summarize(contentToSynthesize, TARGET_APEX_WORDS, prompt);

      // Extract themes
      const themes = this.extractThemes(synthesis);

      return {
        id: uuidv4(),
        threadId,
        summary: synthesis,
        themes,
        totalChunks: chunks.length,
        pyramidDepth: summaries.length > 0 ? 3 : 2,
        totalSourceWords,
        modelUsed: this.summarizationModel,
      };
    } catch (error) {
      console.warn(`[PyramidService] Failed to create apex:`, error);
      return null;
    }
  }

  /**
   * Call Ollama for summarization
   */
  private async summarize(
    content: string,
    targetWords: number,
    systemPrompt: string
  ): Promise<string> {
    // Ensure content fits in context window
    const truncatedContent = content.length > 8000
      ? content.substring(0, 8000) + '...'
      : content;

    const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.summarizationModel,
        prompt: `${systemPrompt}\n\n${truncatedContent}\n\nProvide a summary in approximately ${targetWords} words:`,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: targetWords * 2,  // Allow some flexibility
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Ollama summarization failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.response?.trim() || '';
  }

  /**
   * Extract themes from synthesis text
   */
  private extractThemes(text: string): string[] {
    // Simple heuristic: look for capitalized phrases or bullet points
    const themes: string[] = [];

    // Look for numbered or bulleted items
    const bulletMatches = text.match(/(?:^|\n)[\-\*\•\d\.]+\s*([A-Z][^.\n]{5,50})/g);
    if (bulletMatches) {
      for (const match of bulletMatches.slice(0, 5)) {
        const theme = match.replace(/^[\s\-\*\•\d\.]+/, '').trim();
        if (theme.length > 5) themes.push(theme);
      }
    }

    // Look for emphasized phrases (in quotes or with colons)
    const emphMatches = text.match(/["']([^"']{5,50})["']|:\s*([A-Z][^.\n]{5,40})/g);
    if (emphMatches) {
      for (const match of emphMatches.slice(0, 5 - themes.length)) {
        const theme = match.replace(/^[:"'\s]+|[:"'\s]+$/g, '').trim();
        if (theme.length > 5 && !themes.includes(theme)) themes.push(theme);
      }
    }

    return themes.slice(0, 5);
  }

  /**
   * Store chunks in database
   */
  private storeChunks(chunks: PyramidChunk[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pyramid_chunks (
        id, thread_id, thread_type, chunk_index, content, word_count,
        start_offset, end_offset, boundary_type, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: PyramidChunk[]) => {
      for (const chunk of items) {
        stmt.run(
          chunk.id,
          chunk.threadId,
          chunk.threadType,
          chunk.chunkIndex,
          chunk.content,
          chunk.wordCount,
          chunk.startOffset ?? null,
          chunk.endOffset ?? null,
          chunk.boundaryType ?? null,
          chunk.embedding ? this.floatArrayToBuffer(chunk.embedding) : null,
          Date.now() / 1000
        );
      }
    });

    insertMany(chunks);
  }

  /**
   * Store summaries in database
   */
  private storeSummaries(summaries: PyramidSummary[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pyramid_summaries (
        id, thread_id, level, content, word_count, child_ids, child_type,
        source_word_count, compression_ratio, embedding, model_used, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: PyramidSummary[]) => {
      for (const summary of items) {
        stmt.run(
          summary.id,
          summary.threadId,
          summary.level,
          summary.content,
          summary.wordCount,
          JSON.stringify(summary.childIds),
          summary.childType,
          summary.sourceWordCount,
          summary.compressionRatio,
          summary.embedding ? this.floatArrayToBuffer(summary.embedding) : null,
          summary.modelUsed ?? null,
          Date.now() / 1000
        );
      }
    });

    insertMany(summaries);
  }

  /**
   * Store apex in database
   */
  private storeApex(apex: PyramidApex): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pyramid_apex (
        id, thread_id, summary, themes, total_chunks, pyramid_depth,
        total_source_words, embedding, model_used, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apex.id,
      apex.threadId,
      apex.summary,
      JSON.stringify(apex.themes),
      apex.totalChunks,
      apex.pyramidDepth,
      apex.totalSourceWords,
      apex.embedding ? this.floatArrayToBuffer(apex.embedding) : null,
      apex.modelUsed ?? null,
      Date.now() / 1000,
      Date.now() / 1000
    );
  }

  /**
   * Convert float array to buffer for storage
   */
  private floatArrayToBuffer(arr: number[]): Buffer {
    const buffer = Buffer.alloc(arr.length * 4);
    for (let i = 0; i < arr.length; i++) {
      buffer.writeFloatLE(arr[i], i * 4);
    }
    return buffer;
  }

  /**
   * Convert buffer to float array
   */
  private bufferToFloatArray(buffer: Buffer): number[] {
    const arr = new Array(buffer.length / 4);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = buffer.readFloatLE(i * 4);
    }
    return arr;
  }

  /**
   * Infer UCG source type from thread type
   */
  private inferSourceType(threadType: string): 'chatgpt' | 'claude' | 'facebook-post' | 'text' {
    const typeMap: Record<string, 'chatgpt' | 'claude' | 'facebook-post' | 'text'> = {
      'conversation': 'chatgpt',
      'message': 'chatgpt',
      'post': 'facebook-post',
      'comment': 'facebook-post',
      'document': 'text',
    };
    return typeMap[threadType] || 'text';
  }
}

// Factory function
let pyramidServiceInstance: PyramidService | null = null;

export function getPyramidService(db: Database.Database): PyramidService {
  if (!pyramidServiceInstance) {
    pyramidServiceInstance = new PyramidService(db);
  }
  return pyramidServiceInstance;
}

export function resetPyramidService(): void {
  pyramidServiceInstance = null;
}
