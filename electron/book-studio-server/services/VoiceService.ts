/**
 * VoiceService - Server-side Author Voice Management
 *
 * Extracts voice characteristics from card content,
 * stores voice profiles, and applies voices to content.
 *
 * DEPENDENCIES:
 * - EmbeddingService: Used to store voice embeddings for similarity search.
 *   This is a service-to-service dependency. VoiceService must be initialized
 *   AFTER EmbeddingService in the initialization sequence.
 * - Ollama (external): http://localhost:11434 for voice transformation
 *
 * Voice operations:
 * - extract(): Analyze cards locally → store in author_voices table → embed via EmbeddingService
 * - apply(): Transform content via Ollama LLM
 * - CRUD: Standard create/read/update/delete operations
 */

import Database from 'better-sqlite3';
import {
  getDatabase,
  DbCard,
  DbAuthorVoice,
  VoiceSourceType,
  generateId,
  now,
} from '../database';
import { getEmbeddingService } from './EmbeddingService';

// ============================================================================
// Types
// ============================================================================

export interface VoiceProfile {
  id: string;
  bookId: string;
  name: string;
  description?: string;
  sampleText: string;
  extractedFeatures: ExtractedVoiceFeatures;
  sourceCardIds: string[];
  sourceType: VoiceSourceType;
  isPrimary: boolean;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtractedVoiceFeatures {
  // Sentence-level features
  avgSentenceLength: number;
  sentenceLengthVariance: number;

  // Word-level features
  avgWordLength: number;
  vocabularyRichness: number;
  uniqueWordRatio: number;

  // Style markers
  questionRatio: number;
  exclamationRatio: number;
  contractionRatio: number;

  // Paragraph structure
  avgParagraphLength: number;
  paragraphCount: number;

  // Tone indicators
  formalityScore: number;
  sentimentIndicators: {
    positive: number;
    negative: number;
    neutral: number;
  };

  // Common patterns
  frequentWords: string[];
  frequentPhrases: string[];
}

export interface VoiceExtractParams {
  bookId: string;
  cardIds: string[];
  name?: string;
  description?: string;
  userId?: string;
}

export interface VoiceApplyParams {
  voiceId: string;
  content: string;
  strengthFactor?: number; // 0.0 to 1.0, how strongly to apply the voice
}

export interface VoiceApplyResult {
  transformedContent: string;
  originalWordCount: number;
  transformedWordCount: number;
  changesApplied: string[];
}

// Ollama generate response
interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

// ============================================================================
// VoiceService
// ============================================================================

export class VoiceService {
  private db: Database.Database;
  private ollamaUrl: string;

  constructor() {
    this.db = getDatabase();
    this.ollamaUrl = 'http://localhost:11434';
  }

  // ============================================================================
  // Voice Extraction
  // ============================================================================

  /**
   * Extract a voice profile from cards
   */
  async extract(params: VoiceExtractParams): Promise<VoiceProfile> {
    const { bookId, cardIds, name, description, userId } = params;

    // Get cards
    const cards = this.db
      .prepare(`SELECT * FROM cards WHERE id IN (${cardIds.map(() => '?').join(',')})`)
      .all(...cardIds) as DbCard[];

    if (cards.length === 0) {
      throw new Error('No cards found for voice extraction');
    }

    // Combine card content for analysis
    const combinedContent = cards.map((c) => c.content).join('\n\n');

    // Extract features
    const extractedFeatures = this.analyzeVoice(combinedContent);

    // Create sample text (representative excerpt)
    const sampleText = this.createSampleText(cards);

    // Generate name if not provided
    const voiceName = name || this.generateVoiceName(extractedFeatures, cards);

    // Save to database
    const voiceId = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `
      INSERT INTO author_voices (
        id, book_id, name, description, sample_text, extracted_features,
        source_card_ids, source_type, is_primary, usage_count,
        created_at, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'extracted', 0, 0, ?, ?, ?)
    `
      )
      .run(
        voiceId,
        bookId,
        voiceName,
        description || null,
        sampleText,
        JSON.stringify(extractedFeatures),
        JSON.stringify(cardIds),
        timestamp,
        timestamp,
        userId || null
      );

    // Store voice embedding for similarity search
    const embeddingService = getEmbeddingService();
    try {
      await embeddingService.embedVoice(voiceId, bookId, sampleText);
    } catch (error) {
      console.warn('[VoiceService] Failed to create voice embedding:', error);
    }

    return {
      id: voiceId,
      bookId,
      name: voiceName,
      description,
      sampleText,
      extractedFeatures,
      sourceCardIds: cardIds,
      sourceType: 'extracted',
      isPrimary: false,
      usageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * Analyze text to extract voice features
   */
  private analyzeVoice(text: string): ExtractedVoiceFeatures {
    // Split into sentences
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Split into words
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    const uniqueWords = new Set(words);

    // Split into paragraphs
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Sentence-level features
    const sentenceLengths = sentences.map((s) => s.split(/\s+/).length);
    const avgSentenceLength =
      sentenceLengths.length > 0
        ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
        : 0;

    const sentenceLengthVariance =
      sentenceLengths.length > 0
        ? Math.sqrt(
            sentenceLengths.reduce(
              (sum, len) => sum + Math.pow(len - avgSentenceLength, 2),
              0
            ) / sentenceLengths.length
          )
        : 0;

    // Word-level features
    const avgWordLength =
      words.length > 0 ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0;
    const uniqueWordRatio = words.length > 0 ? uniqueWords.size / words.length : 0;
    const vocabularyRichness = Math.log(uniqueWords.size + 1) / Math.log(words.length + 1);

    // Style markers
    const questionCount = (text.match(/\?/g) || []).length;
    const exclamationCount = (text.match(/!/g) || []).length;
    const contractions = (text.match(/\b\w+'[a-z]+\b/gi) || []).length;

    const totalSentences = Math.max(sentences.length, 1);
    const questionRatio = questionCount / totalSentences;
    const exclamationRatio = exclamationCount / totalSentences;
    const contractionRatio = contractions / Math.max(words.length, 1);

    // Paragraph structure
    const avgParagraphLength =
      paragraphs.length > 0
        ? paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0) / paragraphs.length
        : 0;

    // Formality score (0 = informal, 1 = formal)
    const informalMarkers = [
      contractionRatio,
      exclamationRatio * 2,
      (text.match(/\b(like|just|really|so|basically|actually)\b/gi) || []).length /
        Math.max(words.length, 1),
    ];
    const formalityScore = 1 - Math.min(1, informalMarkers.reduce((a, b) => a + b, 0) / 3);

    // Sentiment indicators (simple word-based)
    const positiveWords = new Set([
      'good',
      'great',
      'love',
      'happy',
      'joy',
      'wonderful',
      'amazing',
      'beautiful',
      'excellent',
      'best',
    ]);
    const negativeWords = new Set([
      'bad',
      'hate',
      'sad',
      'terrible',
      'awful',
      'worst',
      'horrible',
      'poor',
      'wrong',
      'fail',
    ]);

    let positiveCount = 0;
    let negativeCount = 0;
    for (const word of uniqueWords) {
      if (positiveWords.has(word)) positiveCount++;
      if (negativeWords.has(word)) negativeCount++;
    }

    const totalSentiment = Math.max(positiveCount + negativeCount, 1);
    const sentimentIndicators = {
      positive: positiveCount / totalSentiment,
      negative: negativeCount / totalSentiment,
      neutral: 1 - (positiveCount + negativeCount) / totalSentiment,
    };

    // Frequent words (excluding common stop words)
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'of',
      'in',
      'to',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'and',
      'or',
      'but',
      'as',
      'if',
      'that',
      'this',
      'it',
      'i',
      'you',
      'he',
      'she',
      'we',
      'they',
    ]);

    const wordFreq = new Map<string, number>();
    for (const word of words) {
      if (!stopWords.has(word) && word.length > 3) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    const frequentWords = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // Frequent phrases (bigrams)
    const phrases = new Map<string, number>();
    const wordList = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    for (let i = 0; i < wordList.length - 1; i++) {
      const phrase = `${wordList[i]} ${wordList[i + 1]}`;
      if (!stopWords.has(wordList[i]) && !stopWords.has(wordList[i + 1])) {
        phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
      }
    }

    const frequentPhrases = Array.from(phrases.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase);

    return {
      avgSentenceLength,
      sentenceLengthVariance,
      avgWordLength,
      vocabularyRichness,
      uniqueWordRatio,
      questionRatio,
      exclamationRatio,
      contractionRatio,
      avgParagraphLength,
      paragraphCount: paragraphs.length,
      formalityScore,
      sentimentIndicators,
      frequentWords,
      frequentPhrases,
    };
  }

  /**
   * Create a representative sample text from cards
   */
  private createSampleText(cards: DbCard[]): string {
    // Take the best content snippet from each card
    const snippets = cards.map((card) => {
      const sentences = card.content
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20 && s.length < 300);

      return sentences.slice(0, 2).join('. ') + '.';
    });

    return snippets.join('\n\n').slice(0, 2000);
  }

  /**
   * Generate a name for the voice based on features
   */
  private generateVoiceName(features: ExtractedVoiceFeatures, cards: DbCard[]): string {
    const descriptors: string[] = [];

    // Formality
    if (features.formalityScore > 0.7) {
      descriptors.push('Formal');
    } else if (features.formalityScore < 0.3) {
      descriptors.push('Casual');
    }

    // Sentence style
    if (features.avgSentenceLength > 20) {
      descriptors.push('Elaborate');
    } else if (features.avgSentenceLength < 10) {
      descriptors.push('Concise');
    }

    // Tone
    if (features.questionRatio > 0.2) {
      descriptors.push('Inquisitive');
    }
    if (features.exclamationRatio > 0.1) {
      descriptors.push('Enthusiastic');
    }

    // Default descriptor
    if (descriptors.length === 0) {
      descriptors.push('Balanced');
    }

    // Add source hint
    const sourceHint =
      cards[0]?.title || cards[0]?.source || `${cards.length} cards`;

    return `${descriptors.join(' ')} Voice (from ${sourceHint})`.slice(0, 100);
  }

  // ============================================================================
  // Voice Application
  // ============================================================================

  /**
   * Apply a voice profile to transform content
   */
  async apply(params: VoiceApplyParams): Promise<VoiceApplyResult> {
    const { voiceId, content, strengthFactor = 0.7 } = params;

    // Get voice
    const voice = this.get(voiceId);
    if (!voice) {
      throw new Error(`Voice not found: ${voiceId}`);
    }

    // Build transformation prompt
    const prompt = this.buildTransformPrompt(voice, content, strengthFactor);

    // Call Ollama for transformation
    const transformedContent = await this.callOllama(prompt);

    // Increment usage count
    this.db.prepare('UPDATE author_voices SET usage_count = usage_count + 1 WHERE id = ?').run(voiceId);

    const originalWordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    const transformedWordCount = transformedContent
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return {
      transformedContent,
      originalWordCount,
      transformedWordCount,
      changesApplied: this.describeChanges(voice.extractedFeatures),
    };
  }

  /**
   * Build the transformation prompt
   */
  private buildTransformPrompt(
    voice: VoiceProfile,
    content: string,
    strength: number
  ): string {
    const features = voice.extractedFeatures;

    const styleInstructions: string[] = [];

    // Sentence length
    if (features.avgSentenceLength > 15) {
      styleInstructions.push(
        `Use longer, more elaborate sentences (aim for ${Math.round(features.avgSentenceLength)} words per sentence)`
      );
    } else if (features.avgSentenceLength < 12) {
      styleInstructions.push(
        `Use shorter, punchier sentences (aim for ${Math.round(features.avgSentenceLength)} words per sentence)`
      );
    }

    // Formality
    if (features.formalityScore > 0.7) {
      styleInstructions.push('Maintain a formal, professional tone');
      styleInstructions.push('Avoid contractions');
    } else if (features.formalityScore < 0.4) {
      styleInstructions.push('Use a casual, conversational tone');
      styleInstructions.push('Feel free to use contractions');
    }

    // Questions and exclamations
    if (features.questionRatio > 0.15) {
      styleInstructions.push('Include rhetorical questions');
    }
    if (features.exclamationRatio > 0.08) {
      styleInstructions.push('Add emphasis with exclamations where appropriate');
    }

    // Vocabulary
    if (features.frequentWords.length > 0) {
      styleInstructions.push(
        `Try to incorporate words like: ${features.frequentWords.slice(0, 5).join(', ')}`
      );
    }

    // Strength modifier
    const strengthNote =
      strength < 0.5
        ? 'Make subtle adjustments while preserving the original meaning and most of the original phrasing.'
        : strength > 0.8
          ? 'Fully transform the text to match the voice style, rewriting as needed.'
          : 'Moderately adjust the text to better match the voice style.';

    return `You are a skilled editor. Transform the following text to match this author's voice.

VOICE SAMPLE:
${voice.sampleText.slice(0, 1000)}

STYLE GUIDELINES:
${styleInstructions.map((s) => `- ${s}`).join('\n')}

TRANSFORMATION STRENGTH:
${strengthNote}

ORIGINAL TEXT TO TRANSFORM:
${content}

TRANSFORMED TEXT:`;
  }

  /**
   * Call Ollama for text transformation
   */
  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2:latest',
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 2048,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama failed: ${response.status}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      return data.response?.trim() || '';
    } catch (error) {
      console.error('[VoiceService] Ollama error:', error);
      throw error;
    }
  }

  /**
   * Describe what changes the voice applies
   */
  private describeChanges(features: ExtractedVoiceFeatures): string[] {
    const changes: string[] = [];

    if (features.avgSentenceLength > 15) {
      changes.push('Longer, more complex sentences');
    } else if (features.avgSentenceLength < 12) {
      changes.push('Shorter, more direct sentences');
    }

    if (features.formalityScore > 0.7) {
      changes.push('More formal tone');
    } else if (features.formalityScore < 0.4) {
      changes.push('More casual tone');
    }

    if (features.questionRatio > 0.15) {
      changes.push('Added rhetorical questions');
    }

    if (features.contractionRatio > 0.05) {
      changes.push('Uses contractions');
    }

    return changes;
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * Get a voice profile by ID
   */
  get(voiceId: string): VoiceProfile | null {
    const row = this.db.prepare('SELECT * FROM author_voices WHERE id = ?').get(voiceId) as
      | DbAuthorVoice
      | undefined;

    return row ? this.dbToVoiceProfile(row) : null;
  }

  /**
   * List all voices for a book
   */
  list(bookId: string): VoiceProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM author_voices WHERE book_id = ? ORDER BY is_primary DESC, usage_count DESC')
      .all(bookId) as DbAuthorVoice[];

    return rows.map(this.dbToVoiceProfile);
  }

  /**
   * Create a manual voice profile
   */
  create(params: {
    bookId: string;
    name: string;
    description?: string;
    sampleText: string;
    userId?: string;
  }): VoiceProfile {
    const features = this.analyzeVoice(params.sampleText);
    const voiceId = generateId();
    const timestamp = now();

    this.db
      .prepare(
        `
      INSERT INTO author_voices (
        id, book_id, name, description, sample_text, extracted_features,
        source_card_ids, source_type, is_primary, usage_count,
        created_at, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, '[]', 'manual', 0, 0, ?, ?, ?)
    `
      )
      .run(
        voiceId,
        params.bookId,
        params.name,
        params.description || null,
        params.sampleText,
        JSON.stringify(features),
        timestamp,
        timestamp,
        params.userId || null
      );

    // Store embedding
    const embeddingService = getEmbeddingService();
    embeddingService
      .embedVoice(voiceId, params.bookId, params.sampleText)
      .catch((err) => console.warn('[VoiceService] Failed to embed voice:', err));

    return {
      id: voiceId,
      bookId: params.bookId,
      name: params.name,
      description: params.description,
      sampleText: params.sampleText,
      extractedFeatures: features,
      sourceCardIds: [],
      sourceType: 'manual',
      isPrimary: false,
      usageCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /**
   * Update a voice profile
   */
  update(
    voiceId: string,
    updates: { name?: string; description?: string; sampleText?: string }
  ): VoiceProfile | null {
    const voice = this.get(voiceId);
    if (!voice) return null;

    const timestamp = now();
    const fields: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [timestamp];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description || null);
    }
    if (updates.sampleText !== undefined) {
      fields.push('sample_text = ?');
      values.push(updates.sampleText);
      fields.push('extracted_features = ?');
      values.push(JSON.stringify(this.analyzeVoice(updates.sampleText)));
    }

    values.push(voiceId);

    this.db.prepare(`UPDATE author_voices SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.get(voiceId);
  }

  /**
   * Set a voice as primary for a book
   */
  setPrimary(voiceId: string): void {
    const voice = this.get(voiceId);
    if (!voice) return;

    // Clear existing primary
    this.db
      .prepare('UPDATE author_voices SET is_primary = 0 WHERE book_id = ?')
      .run(voice.bookId);

    // Set new primary
    this.db.prepare('UPDATE author_voices SET is_primary = 1 WHERE id = ?').run(voiceId);
  }

  /**
   * Delete a voice profile
   */
  delete(voiceId: string): void {
    this.db.prepare('DELETE FROM author_voices WHERE id = ?').run(voiceId);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Convert database row to VoiceProfile
   */
  private dbToVoiceProfile(row: DbAuthorVoice): VoiceProfile {
    return {
      id: row.id,
      bookId: row.book_id,
      name: row.name,
      description: row.description || undefined,
      sampleText: row.sample_text,
      extractedFeatures: row.extracted_features
        ? JSON.parse(row.extracted_features)
        : this.analyzeVoice(row.sample_text),
      sourceCardIds: row.source_card_ids ? JSON.parse(row.source_card_ids) : [],
      sourceType: row.source_type || 'manual',
      isPrimary: row.is_primary === 1,
      usageCount: row.usage_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let voiceServiceInstance: VoiceService | null = null;

export function getVoiceService(): VoiceService {
  if (!voiceServiceInstance) {
    voiceServiceInstance = new VoiceService();
  }
  return voiceServiceInstance;
}
