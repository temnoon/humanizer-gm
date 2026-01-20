/**
 * GradingService - Card Grading Logic (Server-Side)
 *
 * Grades cards using:
 * - Stub classification (local heuristics)
 * - Chekhov analysis (local necessity scoring)
 * - SIC analysis (via NPE-Local API)
 * - Quantum analysis (via NPE-Local API, optional)
 *
 * All business logic lives here, not in frontend.
 */

import { configService, type GradingConfig, type GradeWeights } from './ConfigService';

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

export interface SICAnalysis {
  score: number;
  category: 'raw-human' | 'polished-human' | 'neat-slop' | 'messy-low-craft' | 'unknown';
  signals: string[];
}

export interface ChekhovAnalysis {
  necessity: number; // 0-1
  signals: {
    hasSpecificDetails: boolean;
    hasEmotionalContent: boolean;
    hasActionableInfo: boolean;
    hasUniqueInsight: boolean;
  };
  reasoning?: string;
}

export interface QuantumHighlights {
  dominantModality: 'literal' | 'metaphorical' | 'mixed';
  isInflectionPoint: boolean;
  modalityShift?: number;
}

export interface CardGrade {
  authenticity: number; // 1-5
  necessity: number;    // 1-5
  inflection: number;   // 1-5
  voice: number;        // 1-5
  overall: number;      // 1-5
  stubType: StubClassification;
  sicAnalysis?: SICAnalysis;
  chekhovAnalysis?: ChekhovAnalysis;
  quantumHighlights?: QuantumHighlights;
  gradedAt: string;
  gradedBy: 'auto' | 'manual';
  confidence: number;
}

export interface CardForGrading {
  id: string;
  content: string;
  sourceType?: string;
  authorName?: string;
}

// ============================================================================
// Configuration
// ============================================================================

const NPE_LOCAL_BASE = 'http://localhost:3003';

// ============================================================================
// Service
// ============================================================================

export class GradingService {
  private config: GradingConfig;

  constructor() {
    const fullConfig = configService.getAll();
    this.config = fullConfig.grading;
  }

  /**
   * Refresh config from disk
   */
  refreshConfig(): void {
    const fullConfig = configService.getAll();
    this.config = fullConfig.grading;
  }

  /**
   * Quick grade - local analysis only (fast)
   */
  quickGrade(card: CardForGrading): Partial<CardGrade> {
    const stubType = this.classifyStub(card.content);
    const wordCount = card.content.split(/\s+/).filter(Boolean).length;

    // Skip deep analysis for very short content
    if (wordCount < this.config.minWordsForAnalysis) {
      return {
        stubType,
        gradedBy: 'auto',
        gradedAt: new Date().toISOString(),
        confidence: 0.3,
        authenticity: 3,
        necessity: stubType === 'optimal' ? 3 : 2,
        inflection: 2,
        voice: 3,
        overall: 3,
      };
    }

    // Run local Chekhov analysis
    const chekhovResult = this.analyzeNecessity(card.content);
    const necessityGrade = Math.ceil(chekhovResult.necessity * 5) || 1;

    return {
      stubType,
      necessity: necessityGrade,
      chekhovAnalysis: chekhovResult,
      gradedBy: 'auto',
      gradedAt: new Date().toISOString(),
      confidence: 0.5,
      authenticity: 3,
      inflection: 2,
      voice: 3,
      overall: necessityGrade,
    };
  }

  /**
   * Full grade - includes API calls to SIC and Quantum (slower)
   */
  async fullGrade(card: CardForGrading): Promise<CardGrade> {
    const stubType = this.classifyStub(card.content);

    // Local Chekhov analysis
    const chekhovResult = this.analyzeNecessity(card.content);
    const necessityGrade = Math.ceil(chekhovResult.necessity * 5) || 1;

    // Initialize grades
    let authenticityGrade = 3;
    let inflectionGrade = 2;
    let voiceGrade = 3;
    let sicAnalysis: SICAnalysis | undefined;
    let quantumHighlights: QuantumHighlights | undefined;

    // SIC analysis (if enabled)
    if (this.config.enableSIC) {
      try {
        sicAnalysis = await this.fetchSICAnalysis(card.content);
        authenticityGrade = Math.ceil((sicAnalysis.score / 100) * 5) || 1;

        // Boost voice grade for raw-human content
        if (sicAnalysis.category === 'raw-human') {
          voiceGrade = 4;
        } else if (sicAnalysis.category === 'polished-human') {
          voiceGrade = 5;
        }
      } catch (error) {
        console.warn('[GradingService] SIC analysis failed:', error);
      }
    }

    // Quantum analysis (if enabled)
    if (this.config.enableQuantum) {
      try {
        quantumHighlights = await this.fetchQuantumAnalysis(card.content);
        inflectionGrade = quantumHighlights.isInflectionPoint
          ? 5
          : quantumHighlights.modalityShift && quantumHighlights.modalityShift > 0.5
          ? 4
          : 2;
      } catch (error) {
        console.warn('[GradingService] Quantum analysis failed:', error);
      }
    }

    // Calculate weighted overall grade
    const weights = this.config.gradeWeights;
    const overallRaw =
      authenticityGrade * weights.authenticity +
      necessityGrade * weights.necessity +
      inflectionGrade * weights.inflection +
      voiceGrade * weights.voice +
      3 * weights.clarity; // Default clarity

    const overallGrade = Math.round(overallRaw);

    return {
      authenticity: authenticityGrade,
      necessity: necessityGrade,
      inflection: inflectionGrade,
      voice: voiceGrade,
      overall: Math.min(5, Math.max(1, overallGrade)),
      stubType,
      sicAnalysis,
      chekhovAnalysis: chekhovResult,
      quantumHighlights,
      gradedAt: new Date().toISOString(),
      gradedBy: 'auto',
      confidence: sicAnalysis ? 0.8 : 0.5,
    };
  }

  /**
   * Classify stub type using heuristics
   */
  classifyStub(content: string): StubClassification {
    const trimmed = content.trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const sentenceCount = trimmed.split(/[.!?]+/).filter(Boolean).length;
    const hasUrl = /https?:\/\//.test(trimmed);

    // Media: image/video/audio patterns
    if (
      /\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|pdf)$/i.test(trimmed) ||
      /\[image\]|\[video\]|\[audio\]|\[attachment\]/i.test(trimmed) ||
      /!\[.*\]\(.*\)/.test(trimmed)
    ) {
      return 'stub-media';
    }

    // Reference: URL-heavy content
    if (hasUrl && wordCount < 100) {
      const urls = trimmed.match(/https?:\/\/\S+/g) || [];
      const urlLength = urls.join('').length;
      if (urlLength / trimmed.length > 0.3) return 'stub-reference';
    }

    // Sentence: very short, single sentence
    if (wordCount <= 25 && sentenceCount <= 1) return 'stub-sentence';

    // Note: short with quick-capture markers
    if (
      wordCount < 50 &&
      /^(TODO|NOTE|IDEA|REMEMBER|TBD|FIXME|WIP):/i.test(trimmed)
    ) {
      return 'stub-note';
    }

    // Breadcrumb: navigation phrases
    if (
      /^(in the context of|related to|see also|this leads to|following up on|as mentioned in|regarding|re:|cf\.|per|about the)/i.test(
        trimmed
      ) &&
      wordCount < 30
    ) {
      return 'stub-breadcrumb';
    }

    // Check for list-like content
    const lines = trimmed.split('\n').filter(Boolean);
    if (
      lines.length > 2 &&
      lines.every((line) => line.length < 50 && /^[-•*\d.]/.test(line.trim()))
    ) {
      if (wordCount < 50) return 'stub-breadcrumb';
    }

    return 'optimal';
  }

  /**
   * Local Chekhov necessity analysis
   */
  analyzeNecessity(content: string): ChekhovAnalysis {
    const signals = {
      hasSpecificDetails: this.detectSpecificDetails(content),
      hasEmotionalContent: this.detectEmotionalContent(content),
      hasActionableInfo: this.detectActionableInfo(content),
      hasUniqueInsight: this.detectUniqueInsight(content),
    };

    // Calculate necessity score (0-1)
    const signalCount = Object.values(signals).filter(Boolean).length;
    const baseScore = signalCount / 4;

    // Adjust based on content characteristics
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const lengthBonus = Math.min(wordCount / 200, 0.2); // Up to 0.2 bonus for longer content

    const necessity = Math.min(1, baseScore + lengthBonus);

    return {
      necessity,
      signals,
    };
  }

  // ===========================================================================
  // Private Methods - Signal Detection
  // ===========================================================================

  private detectSpecificDetails(content: string): boolean {
    // Look for numbers, dates, names, specific nouns
    const hasNumbers = /\d+/.test(content);
    const hasDates = /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|\d{1,2}\/\d{1,2})/i.test(
      content
    );
    const hasProperNouns = /\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(content);
    const hasQuotes = /"[^"]{10,}"/.test(content);

    return hasNumbers || hasDates || hasProperNouns || hasQuotes;
  }

  private detectEmotionalContent(content: string): boolean {
    // Look for emotional language
    const emotionalWords = /\b(love|hate|fear|joy|sad|angry|excited|worried|grateful|proud|ashamed|anxious|happy|frustrated|amazed|shocked|disappointed|thrilled|nervous)\b/i;
    const exclamations = /!{2,}|\?!|!\?/.test(content);
    const firstPerson =
      /\b(I feel|I felt|I think|I believe|I wish|I hope|I'm afraid|I'm excited)\b/i.test(
        content
      );

    return (
      emotionalWords.test(content) || exclamations || firstPerson
    );
  }

  private detectActionableInfo(content: string): boolean {
    // Look for actionable language
    const actionVerbs = /\b(should|must|need to|have to|try to|make sure|remember to|don't forget|consider|implement|create|build|fix|update|check)\b/i;
    const imperatives = /^(Do|Don't|Make|Try|Remember|Consider|Check|Update|Create|Build|Fix)\b/m;
    const steps = /\b(first|then|next|finally|step \d|1\.|2\.|3\.)/i;

    return (
      actionVerbs.test(content) ||
      imperatives.test(content) ||
      steps.test(content)
    );
  }

  private detectUniqueInsight(content: string): boolean {
    // Look for insight markers
    const insightPhrases = /\b(I realized|I discovered|the key is|what matters is|the important thing|interestingly|surprisingly|contrary to|unlike|whereas|however|on the other hand|in contrast)\b/i;
    const metaphors = /\b(like a|as if|similar to|reminds me of|kind of like)\b/i;
    const questions =
      content.split(/[.!]/).filter((s) => s.trim().endsWith('?')).length > 0;

    return (
      insightPhrases.test(content) || metaphors.test(content) || questions
    );
  }

  // ===========================================================================
  // Private Methods - API Calls
  // ===========================================================================

  private async fetchSICAnalysis(content: string): Promise<SICAnalysis> {
    const response = await fetch(
      `${NPE_LOCAL_BASE}/transformations/analyze`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
      }
    );

    if (!response.ok) {
      throw new Error(`SIC analysis failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      score: data.sicScore ?? data.score ?? 50,
      category: this.mapSICCategory(data.category ?? data.classification),
      signals: data.signals ?? data.markers ?? [],
    };
  }

  private mapSICCategory(
    raw: string | undefined
  ): SICAnalysis['category'] {
    if (!raw) return 'unknown';
    const lower = raw.toLowerCase();
    if (lower.includes('polished') && lower.includes('human'))
      return 'polished-human';
    if (lower.includes('raw') && lower.includes('human')) return 'raw-human';
    if (lower.includes('neat') || lower.includes('slop')) return 'neat-slop';
    if (lower.includes('messy') || lower.includes('low'))
      return 'messy-low-craft';
    return 'unknown';
  }

  private async fetchQuantumAnalysis(
    content: string
  ): Promise<QuantumHighlights> {
    // Start quantum session
    const startResponse = await fetch(
      `${NPE_LOCAL_BASE}/quantum-analysis/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
      }
    );

    if (!startResponse.ok) {
      throw new Error(`Quantum analysis start failed: ${startResponse.status}`);
    }

    const session = await startResponse.json();
    const sessionId = session.sessionId;

    // Simplified analysis - step through a few sentences
    let hasInflection = false;
    let dominantModality: QuantumHighlights['dominantModality'] = 'literal';
    let maxModalityShift = 0;

    for (let i = 0; i < Math.min(session.totalSentences || 3, 5); i++) {
      try {
        const stepResponse = await fetch(
          `${NPE_LOCAL_BASE}/quantum-analysis/step`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }
        );

        if (!stepResponse.ok) break;

        const step = await stepResponse.json();
        if (step.isInflectionPoint) hasInflection = true;
        if (step.modalityShift && step.modalityShift > maxModalityShift) {
          maxModalityShift = step.modalityShift;
        }
        if (step.modality === 'metaphorical') {
          dominantModality =
            dominantModality === 'literal' ? 'mixed' : 'metaphorical';
        }
      } catch {
        break;
      }
    }

    return {
      dominantModality,
      isInflectionPoint: hasInflection,
      modalityShift: maxModalityShift,
    };
  }
}

// Singleton instance
let gradingServiceInstance: GradingService | null = null;

export function getGradingService(): GradingService {
  if (!gradingServiceInstance) {
    gradingServiceInstance = new GradingService();
  }
  return gradingServiceInstance;
}
