/**
 * Analysis Types - Shared types for AI detection and text analysis
 */

// ============================================
// Split Mode Types
// ============================================

export type SplitMode =
  | 'view'      // Clean reading (default)
  | 'edit'      // Minimal editing UI
  | 'analyze'   // Show analysis overlays
  | 'transform' // Original vs transformed with diff
  | 'compare';  // Generic side-by-side

// ============================================
// Highlight Layer Types
// ============================================

export type HighlightLayer =
  | 'ai-detection'   // Sentence-level AI scores (color gradient)
  | 'gptzero'        // GPTZero flagged sentences (premium)
  | 'tell-phrases'   // Tell-word positions
  | 'diff'           // Added/removed/changed text
  | 'stylometry';    // Burstiness, punctuation patterns

// ============================================
// Highlight Range Types
// ============================================

export interface HighlightRange {
  /** Start position in text (character offset) */
  start: number;
  /** End position in text (character offset) */
  end: number;
  /** Type of highlight layer */
  type: HighlightLayer;
  /** Score for gradient coloring (0-100) */
  score?: number;
  /** Tooltip/reason text */
  reason?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

// ============================================
// Sentence Analysis (from backend)
// ============================================

export interface SentenceAnalysis {
  text: string;
  startOffset: number;
  endOffset?: number;
  wordCount: number;
  aiLikelihood: number;  // 0-100
  flags: string[];
  isSuspect: boolean;
}

// ============================================
// GPTZero Result (from backend)
// ============================================

export interface GPTZeroSentence {
  sentence: string;
  generated_prob: number;  // 0-1
  highlight_sentence_for_ai: boolean;
  paraphrased_prob?: number;
}

export interface GPTZeroResult {
  verdict: 'human' | 'ai' | 'mixed';
  confidence: number;
  sentences: GPTZeroSentence[];
  highlightedMarkdown?: string;
}

// ============================================
// Tell Phrase Match (from backend)
// ============================================

export interface TellPhraseMatch {
  phrase: string;
  category: string;
  count: number;
  weight: number;
  direction: 'ai' | 'human';
  positions: number[];  // Character positions
}

// ============================================
// Diff Result (from humanization)
// ============================================

export interface TransformationChange {
  type: 'burstiness' | 'semicolon' | 'tell-word' | 'em-dash' | 'add' | 'remove' | 'modify';
  original: string;
  replacement: string;
  position: number;
  reason?: string;
}

export interface DiffResult {
  original: string;
  transformed: string;
  changes: TransformationChange[];
  aiLikelihoodBefore: number;
  aiLikelihoodAfter: number;
}

// ============================================
// Combined Analysis Data
// ============================================

export interface AnalysisData {
  /** Sentence-level analysis from HumanizerDetect v2 */
  sentences?: SentenceAnalysis[];
  /** GPTZero results (premium) */
  gptzero?: GPTZeroResult;
  /** Tell-phrase matches */
  tellPhrases?: TellPhraseMatch[];
  /** Diff/transform results */
  diff?: DiffResult;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: string;
}

// ============================================
// Highlight Level (for AI score gradients)
// ============================================

export type AIScoreLevel = 'high' | 'medium' | 'low';

export function getAIScoreLevel(score: number): AIScoreLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function getAIScoreColor(score: number): string {
  const level = getAIScoreLevel(score);
  switch (level) {
    case 'high': return 'var(--color-error, #dc2626)';
    case 'medium': return 'var(--color-warning, #d97706)';
    case 'low': return 'var(--color-success, #16a34a)';
  }
}
