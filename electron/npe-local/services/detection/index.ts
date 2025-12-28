/**
 * HumanizerDetect - AI Detection Module (Local)
 *
 * A statistical AI detection system for Electron/local use.
 *
 * Usage:
 * ```typescript
 * import { detect, detectQuick } from './services/detection';
 *
 * // Full detection with recommendations
 * const result = detect(text, { returnSentenceAnalysis: true });
 *
 * // Quick detection
 * const quick = detectQuick(text);
 * ```
 */

// Main detection functions
export { detect, detectQuick, calculateCompositeScore } from './compositeScorer';

// Feature extraction
export {
  extractFeatures,
  calculateBurstiness,
  analyzePunctuation,
  analyzeVocabulary,
  splitSentences,
  featureSummary,
  compareToBaselines,
} from './featureExtractor';

// Tell-phrase scoring
export {
  scoreTellPhrases,
  getReplacements,
  tellPhraseSummary,
  AI_TELL_PHRASES,
  HUMAN_TELL_PHRASES,
} from './tellPhraseScorer';

// Types
export type {
  DetectionResult,
  DetectionOptions,
  ExtractedFeatures,
  BurstinessMetrics,
  PunctuationProfile,
  VocabularyMetrics,
  TellPhrase,
  TellPhraseMatch,
  TellPhraseScore,
  SentenceAnalysis,
  HumanizationRecommendation,
} from './types';

// Constants
export {
  FEATURE_WEIGHTS,
  FEATURE_WEIGHTS_STATISTICAL,
  HUMAN_BASELINES,
  AI_BASELINES,
  THRESHOLDS,
  DETECTOR_VERSION,
} from './types';
