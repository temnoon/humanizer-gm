/**
 * EmbeddingService - Server-side Embedding Operations
 *
 * Generates embeddings via Ollama and stores them in the vector database.
 * Provides semantic search within book content.
 *
 * ARCHITECTURE NOTE:
 * This service is the SINGLE PUBLIC API for all vector/embedding operations.
 * API routes should ONLY import from this service, never from vec-database.ts.
 *
 * This service:
 * - Generates embeddings via Ollama (port 11434)
 * - Stores/retrieves embeddings via vec-database.ts (DAO layer)
 * - Provides semantic similarity search
 * - Manages embedding lifecycle (create, read, delete)
 *
 * Dependencies:
 * - Ollama (external): http://localhost:11434
 * - vec-database.ts (internal): Pure data access layer
 */

import { getDatabase, DbCard, generateId } from '../database';
import { getConfig } from '../config';
import {
  getVecDatabase,
  storeCardEmbedding,
  getCardEmbedding,
  deleteCardEmbedding,
  findSimilarCards,
  storeChapterEmbedding,
  getChapterEmbedding,
  deleteChapterEmbedding,
  storeVoiceEmbedding,
  getVoiceEmbedding,
  findSimilarVoices,
  storeOutlineSectionEmbedding,
  getOutlineSectionEmbeddings,
  deleteOutlineEmbeddings,
  findBestSection,
  deleteAllBookEmbeddings,
  getBookEmbeddingStats,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  type StoredEmbedding,
} from '../database/vec-database';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface SimilarCard {
  cardId: string;
  similarity: number;
  card?: DbCard;
}

export interface SectionMatch {
  sectionIndex: number;
  title: string;
  similarity: number;
}

export interface EmbeddingStats {
  cardCount: number;
  chapterCount: number;
  voiceCount: number;
  outlineSectionCount: number;
  model: string;
  dimensions: number;
}

export interface BatchEmbeddingResult {
  successful: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

// Ollama embedding response
interface OllamaEmbeddingResponse {
  embedding: number[];
  model?: string;
}

// ============================================================================
// EmbeddingService
// ============================================================================

export class EmbeddingService {
  private ollamaUrl: string;
  private model: string;
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  constructor() {
    this.ollamaUrl = 'http://localhost:11434';
    this.model = 'mxbai-embed-large';
  }

  // ============================================================================
  // Core Embedding Generation
  // ============================================================================

  /**
   * Generate an embedding for text content via Ollama
   */
  async embed(content: string): Promise<EmbeddingResult> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: content,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embedding failed: ${response.status}`);
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;

      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error('Invalid embedding response from Ollama');
      }

      return {
        embedding: data.embedding,
        model: this.model,
        dimensions: data.embedding.length,
      };
    } catch (error) {
      console.error('[EmbeddingService] Embedding error:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (with rate limiting)
   */
  async embedBatch(
    texts: string[],
    options: { delayMs?: number; onProgress?: (completed: number, total: number) => void } = {}
  ): Promise<Array<EmbeddingResult | null>> {
    const { delayMs = 50, onProgress } = options;
    const results: Array<EmbeddingResult | null> = [];

    for (let i = 0; i < texts.length; i++) {
      try {
        const result = await this.embed(texts[i]);
        results.push(result);
      } catch {
        results.push(null);
      }

      if (onProgress) {
        onProgress(i + 1, texts.length);
      }

      // Rate limiting delay
      if (i < texts.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  // ============================================================================
  // Card Embedding Operations
  // ============================================================================

  /**
   * Embed and store a card's content
   */
  async embedCard(card: DbCard): Promise<void> {
    const result = await this.embed(card.content);
    storeCardEmbedding(card.id, card.book_id, result.embedding, result.model);
  }

  /**
   * Embed and store multiple cards
   */
  async embedCards(
    cards: DbCard[],
    options: { onProgress?: (completed: number, total: number) => void } = {}
  ): Promise<BatchEmbeddingResult> {
    const result: BatchEmbeddingResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      try {
        await this.embedCard(card);
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          id: card.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      if (options.onProgress) {
        options.onProgress(i + 1, cards.length);
      }

      // Small delay between requests
      if (i < cards.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    return result;
  }

  /**
   * Get card embedding if it exists
   */
  getCardEmbedding(cardId: string): StoredEmbedding | null {
    return getCardEmbedding(cardId);
  }

  /**
   * Delete a card's embedding
   */
  deleteCardEmbedding(cardId: string): void {
    deleteCardEmbedding(cardId);
  }

  /**
   * Find cards similar to a query
   */
  async findSimilarCards(
    query: string,
    bookId: string,
    options: { limit?: number; threshold?: number; excludeCardIds?: string[] } = {}
  ): Promise<SimilarCard[]> {
    const queryEmbedding = await this.embed(query);
    return findSimilarCards(queryEmbedding.embedding, bookId, options);
  }

  /**
   * Find cards similar to another card
   */
  findSimilarToCard(
    cardId: string,
    bookId: string,
    options: { limit?: number; threshold?: number } = {}
  ): SimilarCard[] {
    const cardEmbedding = getCardEmbedding(cardId);
    if (!cardEmbedding) {
      return [];
    }

    return findSimilarCards(cardEmbedding.embedding, bookId, {
      ...options,
      excludeCardIds: [cardId],
    });
  }

  // ============================================================================
  // Chapter Embedding Operations
  // ============================================================================

  /**
   * Embed and store a chapter's content
   */
  async embedChapter(chapterId: string, bookId: string, content: string): Promise<void> {
    const result = await this.embed(content);
    storeChapterEmbedding(chapterId, bookId, result.embedding, result.model);
  }

  /**
   * Get chapter embedding if it exists
   */
  getChapterEmbedding(chapterId: string): StoredEmbedding | null {
    return getChapterEmbedding(chapterId);
  }

  /**
   * Delete a chapter's embedding
   */
  deleteChapterEmbedding(chapterId: string): void {
    deleteChapterEmbedding(chapterId);
  }

  // ============================================================================
  // Voice Embedding Operations
  // ============================================================================

  /**
   * Embed and store a voice sample
   */
  async embedVoice(voiceId: string, bookId: string, sampleText: string): Promise<void> {
    const result = await this.embed(sampleText);
    storeVoiceEmbedding(voiceId, bookId, result.embedding, result.model);
  }

  /**
   * Get voice embedding if it exists
   */
  getVoiceEmbedding(voiceId: string): StoredEmbedding | null {
    return getVoiceEmbedding(voiceId);
  }

  /**
   * Find voices similar to a text sample
   */
  async findSimilarVoices(
    sampleText: string,
    bookId: string,
    options: { limit?: number; threshold?: number } = {}
  ): Promise<Array<{ voiceId: string; similarity: number }>> {
    const sampleEmbedding = await this.embed(sampleText);
    return findSimilarVoices(sampleEmbedding.embedding, bookId, options);
  }

  // ============================================================================
  // Outline Embedding Operations
  // ============================================================================

  /**
   * Embed and store outline section titles
   */
  async embedOutlineSections(
    outlineId: string,
    bookId: string,
    sections: Array<{ index: number; title: string }>
  ): Promise<BatchEmbeddingResult> {
    // Clear existing embeddings for this outline
    deleteOutlineEmbeddings(outlineId);

    const result: BatchEmbeddingResult = {
      successful: 0,
      failed: 0,
      errors: [],
    };

    for (const section of sections) {
      try {
        const embeddingResult = await this.embed(section.title);
        storeOutlineSectionEmbedding(
          outlineId,
          section.index,
          bookId,
          section.title,
          embeddingResult.embedding,
          embeddingResult.model
        );
        result.successful++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          id: `${outlineId}-${section.index}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return result;
  }

  /**
   * Get all outline section embeddings
   */
  getOutlineSectionEmbeddings(
    outlineId: string
  ): Array<{ sectionIndex: number; title: string; embedding: number[] }> {
    return getOutlineSectionEmbeddings(outlineId);
  }

  /**
   * Delete outline embeddings
   */
  deleteOutlineEmbeddings(outlineId: string): void {
    deleteOutlineEmbeddings(outlineId);
  }

  /**
   * Find best matching section for a card
   */
  async findBestSectionForCard(cardId: string, outlineId: string): Promise<SectionMatch | null> {
    const cardEmbedding = getCardEmbedding(cardId);
    if (!cardEmbedding) {
      return null;
    }

    return findBestSection(cardEmbedding.embedding, outlineId);
  }

  /**
   * Find best matching section for text content
   */
  async findBestSectionForText(text: string, outlineId: string): Promise<SectionMatch | null> {
    const embedding = await this.embed(text);
    return findBestSection(embedding.embedding, outlineId);
  }

  // ============================================================================
  // Similarity Operations
  // ============================================================================

  /**
   * Calculate similarity between two embeddings
   */
  calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    return cosineSimilarity(embedding1, embedding2);
  }

  /**
   * Calculate similarity between two texts
   */
  async calculateTextSimilarity(text1: string, text2: string): Promise<number> {
    const [embedding1, embedding2] = await Promise.all([this.embed(text1), this.embed(text2)]);

    return cosineSimilarity(embedding1.embedding, embedding2.embedding);
  }

  // ============================================================================
  // Book Operations
  // ============================================================================

  /**
   * Delete all embeddings for a book
   */
  deleteAllBookEmbeddings(bookId: string): void {
    deleteAllBookEmbeddings(bookId);
  }

  /**
   * Get embedding statistics for a book
   */
  getBookStats(bookId: string): EmbeddingStats {
    const stats = getBookEmbeddingStats(bookId);
    return {
      ...stats,
      model: this.model,
      dimensions: EMBEDDING_DIMENSIONS,
    };
  }

  /**
   * Rebuild all embeddings for a book's cards
   */
  async rebuildBookEmbeddings(
    bookId: string,
    options: { onProgress?: (completed: number, total: number, phase: string) => void } = {}
  ): Promise<BatchEmbeddingResult> {
    const db = getDatabase();

    // Get all cards for the book
    const cards = db
      .prepare('SELECT * FROM cards WHERE book_id = ?')
      .all(bookId) as DbCard[];

    // Delete existing embeddings
    deleteAllBookEmbeddings(bookId);

    if (options.onProgress) {
      options.onProgress(0, cards.length, 'cards');
    }

    // Embed all cards
    return this.embedCards(cards, {
      onProgress: (completed, total) => {
        if (options.onProgress) {
          options.onProgress(completed, total, 'cards');
        }
      },
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Check if Ollama is available
   */
  async checkOllamaHealth(): Promise<{ available: boolean; model: string; error?: string }> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) {
        return { available: false, model: this.model, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const hasModel = data.models?.some((m) => m.name.includes(this.model.split(':')[0]));

      if (!hasModel) {
        return {
          available: false,
          model: this.model,
          error: `Model ${this.model} not found. Run: ollama pull ${this.model}`,
        };
      }

      return { available: true, model: this.model };
    } catch (error) {
      return {
        available: false,
        model: this.model,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.model;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let embeddingServiceInstance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService();
  }
  return embeddingServiceInstance;
}
