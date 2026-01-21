/**
 * DraftService - Server-side Draft Generation
 *
 * Generates chapter drafts via Ollama LLM, stores versions,
 * and supports version comparison and management.
 */

import Database from 'better-sqlite3';
import {
  getDatabase,
  DbCard,
  DbChapter,
  DbDraftVersion,
  DbAuthorVoice,
  generateId,
  now,
} from '../database';
import { getConfig } from '../config';

// ============================================================================
// Types
// ============================================================================

export interface DraftGenerationParams {
  chapterId: string;
  bookId: string;
  cardIds?: string[];
  voiceId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  prompt?: string;
  userId?: string;
}

export interface DraftGenerationResult {
  draft: DraftVersion;
  generationTime: number;
  tokenCount?: number;
}

export interface DraftVersion {
  id: string;
  chapterId: string;
  bookId: string;
  versionNumber: number;
  content: string;
  wordCount: number;
  generatorModel: string;
  generatorParams: Record<string, unknown>;
  cardIdsUsed: string[];
  voiceId?: string;
  qualityScore?: number;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  reviewNotes?: string;
  createdAt: number;
}

export interface DraftCompareResult {
  v1: DraftVersion;
  v2: DraftVersion;
  wordCountDiff: number;
  addedParagraphs: number;
  removedParagraphs: number;
  similarity: number;
}

export interface DraftGenerationProgress {
  status: 'queued' | 'generating' | 'complete' | 'error';
  progress: number;
  message?: string;
  draftId?: string;
}

// Ollama generate response
interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  model?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ============================================================================
// DraftService
// ============================================================================

export class DraftService {
  private db: Database.Database;
  private ollamaUrl: string;
  private defaultModel: string;

  constructor() {
    this.db = getDatabase();
    this.ollamaUrl = 'http://localhost:11434';
    this.defaultModel = 'llama3.2:latest';
  }

  // ============================================================================
  // Draft Generation
  // ============================================================================

  /**
   * Generate a new draft for a chapter
   */
  async generate(params: DraftGenerationParams): Promise<DraftGenerationResult> {
    const startTime = Date.now();
    const config = getConfig();

    // Get chapter
    const chapter = this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(params.chapterId) as
      | DbChapter
      | undefined;

    if (!chapter) {
      throw new Error(`Chapter not found: ${params.chapterId}`);
    }

    // Get cards to use
    let cards: DbCard[] = [];
    if (params.cardIds && params.cardIds.length > 0) {
      cards = this.db
        .prepare(`SELECT * FROM cards WHERE id IN (${params.cardIds.map(() => '?').join(',')})`)
        .all(...params.cardIds) as DbCard[];
    } else {
      // Get all cards assigned to this chapter
      cards = this.db
        .prepare('SELECT * FROM cards WHERE chapter_id = ? AND status = ?')
        .all(params.chapterId, 'placed') as DbCard[];
    }

    // Get voice if specified
    let voice: DbAuthorVoice | undefined;
    if (params.voiceId) {
      voice = this.db.prepare('SELECT * FROM author_voices WHERE id = ?').get(params.voiceId) as
        | DbAuthorVoice
        | undefined;
    }

    // Build the generation prompt
    const prompt = this.buildGenerationPrompt(chapter, cards, voice, params.prompt);

    // Generate via Ollama
    const model = params.model ?? this.defaultModel;
    const temperature = params.temperature ?? 0.7;
    const maxTokens = params.maxTokens ?? 4096;

    const generatedContent = await this.callOllama({
      model,
      prompt,
      temperature,
      maxTokens,
    });

    const endTime = Date.now();

    // Get next version number
    const lastVersion = this.db
      .prepare(
        'SELECT MAX(version_number) as max_version FROM draft_versions WHERE chapter_id = ?'
      )
      .get(params.chapterId) as { max_version: number | null } | undefined;

    const versionNumber = (lastVersion?.max_version ?? 0) + 1;

    // Calculate word count
    const wordCount = generatedContent.split(/\s+/).filter((w) => w.length > 0).length;

    // Save draft version
    const draftId = generateId();
    const timestamp = now();

    const generatorParams = {
      model,
      temperature,
      maxTokens,
      prompt: params.prompt,
    };

    this.db
      .prepare(
        `
      INSERT INTO draft_versions (
        id, chapter_id, book_id, version_number, content, word_count,
        generator_model, generator_params, card_ids_used, voice_id,
        review_status, created_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `
      )
      .run(
        draftId,
        params.chapterId,
        params.bookId,
        versionNumber,
        generatedContent,
        wordCount,
        model,
        JSON.stringify(generatorParams),
        JSON.stringify(cards.map((c) => c.id)),
        params.voiceId || null,
        timestamp,
        params.userId || null
      );

    const draft: DraftVersion = {
      id: draftId,
      chapterId: params.chapterId,
      bookId: params.bookId,
      versionNumber,
      content: generatedContent,
      wordCount,
      generatorModel: model,
      generatorParams,
      cardIdsUsed: cards.map((c) => c.id),
      voiceId: params.voiceId,
      reviewStatus: 'pending',
      createdAt: timestamp,
    };

    return {
      draft,
      generationTime: endTime - startTime,
    };
  }

  /**
   * Build the generation prompt from chapter, cards, and voice
   */
  private buildGenerationPrompt(
    chapter: DbChapter,
    cards: DbCard[],
    voice?: DbAuthorVoice,
    customPrompt?: string
  ): string {
    const config = getConfig();
    const parts: string[] = [];

    // System context
    parts.push(`You are a skilled writer helping to draft a chapter titled "${chapter.title}".`);

    // Voice instructions
    if (voice) {
      parts.push(`\n\nWrite in this voice style:\n${voice.sample_text}`);
      if (voice.extracted_features) {
        try {
          const features = JSON.parse(voice.extracted_features);
          if (features.tone) parts.push(`Tone: ${features.tone}`);
          if (features.style) parts.push(`Style: ${features.style}`);
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Chapter-specific instructions
    if (chapter.draft_instructions) {
      parts.push(`\n\nChapter instructions:\n${chapter.draft_instructions}`);
    }

    // Custom prompt
    if (customPrompt) {
      parts.push(`\n\nAdditional instructions:\n${customPrompt}`);
    }

    // Source material from cards
    if (cards.length > 0) {
      parts.push('\n\nUse the following source material to write the chapter:');

      // Sort cards by role priority
      const sortedCards = [...cards].sort((a, b) => {
        const rolePriority: Record<string, number> = {
          author_voice: 1,
          main_source: 2,
          example: 3,
          evidence: 4,
          reference: 5,
          epigraph: 6,
          counterpoint: 7,
          background: 8,
        };
        return (rolePriority[a.role] || 99) - (rolePriority[b.role] || 99);
      });

      for (const card of sortedCards) {
        const label = card.role !== 'main_source' ? ` [${card.role}]` : '';
        parts.push(`\n---${label}\n${card.content}`);
      }
    }

    // Target word count
    parts.push(
      `\n\nTarget word count: approximately ${config.draft.targetWordCount} words.`
    );
    parts.push('\n\nWrite the chapter now:');

    return parts.join('\n');
  }

  /**
   * Call Ollama to generate content
   */
  private async callOllama(params: {
    model: string;
    prompt: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          prompt: params.prompt,
          stream: false,
          options: {
            temperature: params.temperature,
            num_predict: params.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama generation failed: ${response.status}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      return data.response.trim();
    } catch (error) {
      console.error('[DraftService] Generation error:', error);
      throw error;
    }
  }

  // ============================================================================
  // Version Management
  // ============================================================================

  /**
   * Get all draft versions for a chapter
   */
  getVersions(chapterId: string): DraftVersion[] {
    const rows = this.db
      .prepare('SELECT * FROM draft_versions WHERE chapter_id = ? ORDER BY version_number DESC')
      .all(chapterId) as DbDraftVersion[];

    return rows.map(this.dbToDraftVersion);
  }

  /**
   * Get a specific draft version
   */
  getVersion(versionId: string): DraftVersion | null {
    const row = this.db.prepare('SELECT * FROM draft_versions WHERE id = ?').get(versionId) as
      | DbDraftVersion
      | undefined;

    return row ? this.dbToDraftVersion(row) : null;
  }

  /**
   * Get the latest draft version for a chapter
   */
  getLatestVersion(chapterId: string): DraftVersion | null {
    const row = this.db
      .prepare(
        'SELECT * FROM draft_versions WHERE chapter_id = ? ORDER BY version_number DESC LIMIT 1'
      )
      .get(chapterId) as DbDraftVersion | undefined;

    return row ? this.dbToDraftVersion(row) : null;
  }

  /**
   * Save a manually created draft version
   */
  saveVersion(params: {
    chapterId: string;
    bookId: string;
    content: string;
    voiceId?: string;
    userId?: string;
  }): DraftVersion {
    // Get next version number
    const lastVersion = this.db
      .prepare(
        'SELECT MAX(version_number) as max_version FROM draft_versions WHERE chapter_id = ?'
      )
      .get(params.chapterId) as { max_version: number | null } | undefined;

    const versionNumber = (lastVersion?.max_version ?? 0) + 1;
    const wordCount = params.content.split(/\s+/).filter((w) => w.length > 0).length;

    const draftId = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `
      INSERT INTO draft_versions (
        id, chapter_id, book_id, version_number, content, word_count,
        generator_model, generator_params, card_ids_used, voice_id,
        review_status, created_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'manual', '{}', '[]', ?, 'pending', ?, ?)
    `
      )
      .run(
        draftId,
        params.chapterId,
        params.bookId,
        versionNumber,
        params.content,
        wordCount,
        params.voiceId || null,
        timestamp,
        params.userId || null
      );

    return {
      id: draftId,
      chapterId: params.chapterId,
      bookId: params.bookId,
      versionNumber,
      content: params.content,
      wordCount,
      generatorModel: 'manual',
      generatorParams: {},
      cardIdsUsed: [],
      voiceId: params.voiceId,
      reviewStatus: 'pending',
      createdAt: timestamp,
    };
  }

  // ============================================================================
  // Version Comparison
  // ============================================================================

  /**
   * Compare two draft versions
   */
  compare(versionId1: string, versionId2: string): DraftCompareResult | null {
    const v1 = this.getVersion(versionId1);
    const v2 = this.getVersion(versionId2);

    if (!v1 || !v2) {
      return null;
    }

    // Get paragraphs
    const paragraphs1 = v1.content.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const paragraphs2 = v2.content.split(/\n\n+/).filter((p) => p.trim().length > 0);

    // Simple paragraph comparison
    const set1 = new Set(paragraphs1.map((p) => p.trim().toLowerCase().slice(0, 100)));
    const set2 = new Set(paragraphs2.map((p) => p.trim().toLowerCase().slice(0, 100)));

    const added = paragraphs2.filter(
      (p) => !set1.has(p.trim().toLowerCase().slice(0, 100))
    ).length;
    const removed = paragraphs1.filter(
      (p) => !set2.has(p.trim().toLowerCase().slice(0, 100))
    ).length;

    // Calculate text similarity
    const similarity = this.textSimilarity(v1.content, v2.content);

    return {
      v1,
      v2,
      wordCountDiff: v2.wordCount - v1.wordCount,
      addedParagraphs: added,
      removedParagraphs: removed,
      similarity,
    };
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
  // Review Operations
  // ============================================================================

  /**
   * Update review status of a draft version
   */
  updateReviewStatus(
    versionId: string,
    status: 'pending' | 'approved' | 'rejected' | 'needs_revision',
    notes?: string
  ): void {
    this.db
      .prepare('UPDATE draft_versions SET review_status = ?, review_notes = ? WHERE id = ?')
      .run(status, notes || null, versionId);
  }

  /**
   * Set quality score for a draft version
   */
  setQualityScore(versionId: string, score: number): void {
    this.db
      .prepare('UPDATE draft_versions SET quality_score = ? WHERE id = ?')
      .run(Math.max(0, Math.min(1, score)), versionId);
  }

  // ============================================================================
  // Accept Operations
  // ============================================================================

  /**
   * Accept a draft version and copy its content to the chapter
   */
  accept(versionId: string): DbChapter {
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error(`Draft version not found: ${versionId}`);
    }

    const timestamp = now();

    // Update chapter with draft content
    this.db
      .prepare(
        `
      UPDATE chapters SET
        content = ?,
        word_count = ?,
        updated_at = ?
      WHERE id = ?
    `
      )
      .run(version.content, version.wordCount, timestamp, version.chapterId);

    // Mark version as approved
    this.updateReviewStatus(versionId, 'approved');

    // Return updated chapter
    const chapter = this.db
      .prepare('SELECT * FROM chapters WHERE id = ?')
      .get(version.chapterId) as DbChapter;

    return chapter;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Convert database row to DraftVersion
   */
  private dbToDraftVersion(row: DbDraftVersion): DraftVersion {
    return {
      id: row.id,
      chapterId: row.chapter_id,
      bookId: row.book_id,
      versionNumber: row.version_number,
      content: row.content,
      wordCount: row.word_count,
      generatorModel: row.generator_model || 'unknown',
      generatorParams: row.generator_params ? JSON.parse(row.generator_params) : {},
      cardIdsUsed: row.card_ids_used ? JSON.parse(row.card_ids_used) : [],
      voiceId: row.voice_id || undefined,
      qualityScore: row.quality_score || undefined,
      reviewStatus: row.review_status,
      reviewNotes: row.review_notes || undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Check if Ollama is available
   */
  async checkOllamaHealth(): Promise<{ available: boolean; model: string; error?: string }> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      if (!response.ok) {
        return { available: false, model: this.defaultModel, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const hasModel = data.models?.some((m) =>
        m.name.includes(this.defaultModel.split(':')[0])
      );

      if (!hasModel) {
        return {
          available: false,
          model: this.defaultModel,
          error: `Model ${this.defaultModel} not found. Run: ollama pull ${this.defaultModel}`,
        };
      }

      return { available: true, model: this.defaultModel };
    } catch (error) {
      return {
        available: false,
        model: this.defaultModel,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Delete a draft version
   */
  deleteVersion(versionId: string): void {
    this.db.prepare('DELETE FROM draft_versions WHERE id = ?').run(versionId);
  }

  /**
   * Delete all draft versions for a chapter
   */
  deleteAllVersions(chapterId: string): void {
    this.db.prepare('DELETE FROM draft_versions WHERE chapter_id = ?').run(chapterId);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let draftServiceInstance: DraftService | null = null;

export function getDraftService(): DraftService {
  if (!draftServiceInstance) {
    draftServiceInstance = new DraftService();
  }
  return draftServiceInstance;
}
