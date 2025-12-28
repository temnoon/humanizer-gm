/**
 * Composite Scorer for AI Detection
 *
 * Combines statistical features, tell-phrase analysis, and optional LLM analysis
 * into a final AI likelihood score.
 */

import type {
  DetectionResult,
  DetectionOptions,
  ExtractedFeatures,
  SentenceAnalysis,
  HumanizationRecommendation,
} from './types';
import {
  DETECTOR_VERSION,
  FEATURE_WEIGHTS_STATISTICAL,
  AI_BASELINES,
  HUMAN_BASELINES,
  THRESHOLDS,
} from './types';
import { extractFeatures, splitSentences } from './featureExtractor';
import { scoreTellPhrases } from './tellPhraseScorer';

// ============================================================================
// Score Normalization
// ============================================================================

/**
 * Normalize a value to 0-100 scale based on AI vs human baselines.
 * Higher score = more AI-like.
 */
function normalizeScore(
  value: number,
  humanBaseline: number,
  aiBaseline: { min: number; max: number; typical: number },
  invert: boolean = false
): number {
  // Distance from human baseline toward AI range
  const humanDist = Math.abs(value - humanBaseline);
  const aiDist = Math.abs(value - aiBaseline.typical);

  // Relative position: 0 = at human baseline, 100 = at AI typical
  const range = Math.abs(humanBaseline - aiBaseline.typical);
  if (range === 0) return 50;

  let score = (humanDist / range) * 100;

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // If value is on wrong side of human baseline, reduce score
  if (invert) {
    if (value > humanBaseline && humanBaseline > aiBaseline.typical) {
      score = Math.max(0, 100 - score);
    }
  }

  return score;
}

/**
 * Calculate sentence complexity score (presence of extremes)
 */
function calculateSentenceComplexity(sentenceLengths: number[]): number {
  if (sentenceLengths.length < 5) return 50; // Insufficient data

  // Human text has more very short (<5 words) and very long (>30 words) sentences
  const veryShort = sentenceLengths.filter(l => l < 5).length;
  const veryLong = sentenceLengths.filter(l => l > 30).length;
  const extremeRatio = (veryShort + veryLong) / sentenceLengths.length;

  // Higher extreme ratio = more human-like (lower AI score)
  // Typical human: 10-20% extremes, AI: <5%
  if (extremeRatio > 0.15) return 25; // Very human-like
  if (extremeRatio > 0.08) return 40; // Somewhat human
  if (extremeRatio > 0.03) return 60; // Uncertain
  return 80; // Very uniform = AI-like
}

/**
 * Calculate punctuation contrast score (semicolon vs em-dash)
 */
function calculatePunctuationContrast(semicolonRate: number, emDashRate: number): number {
  // Human: high semicolons (~1.5%), low em-dashes (<0.5%)
  // AI: low semicolons (<0.3%), high em-dashes (>1%)

  const semicolonScore = semicolonRate > 0.8 ? 0 : semicolonRate < 0.1 ? 100 : 50;
  const emDashScore = emDashRate > 1.5 ? 100 : emDashRate < 0.3 ? 0 : 50;

  return (semicolonScore * 0.7 + emDashScore * 0.3);
}

// ============================================================================
// Main Detection Functions
// ============================================================================

/**
 * Full AI detection with all features.
 */
export function detect(text: string, options: DetectionOptions = {}): DetectionResult {
  const startTime = Date.now();

  // Validate input
  const minLength = options.minTextLength || 100;
  if (text.length < minLength) {
    throw new Error(`Text too short for reliable detection (minimum ${minLength} characters)`);
  }

  // Extract features
  const extractedFeatures = extractFeatures(text);
  const tellPhraseResult = scoreTellPhrases(text);

  // Calculate individual component scores (0-100, higher = more AI-like)
  const burstinessScore = normalizeScore(
    extractedFeatures.burstiness.burstiness,
    HUMAN_BASELINES.burstiness,
    AI_BASELINES.burstiness,
    true
  );

  const sentenceComplexityScore = calculateSentenceComplexity(
    extractedFeatures.burstiness.sentenceLengths
  );

  const punctuationContrastScore = calculatePunctuationContrast(
    extractedFeatures.punctuation.semicolonRate,
    extractedFeatures.punctuation.emDashRate
  );

  // Tell-phrase score: positive = AI-like
  // Normalize to 0-100 (typical range -5 to +15)
  const rawTellScore = tellPhraseResult.score;
  const tellPhraseScore = Math.max(0, Math.min(100, 50 + rawTellScore * 4));

  // Llama signature: 0% em-dashes is very suspicious
  const llamaSignature = extractedFeatures.punctuation.emDashRate === 0 ? 90 : 30;

  // Vocabulary richness (weak signal)
  const vocabScore = extractedFeatures.vocabulary.bigramDiversity < 0.80 ? 70 : 40;

  // Weighted composite score
  const weights = FEATURE_WEIGHTS_STATISTICAL;
  const aiLikelihood =
    burstinessScore * weights.burstiness +
    sentenceComplexityScore * weights.sentenceComplexity +
    punctuationContrastScore * weights.punctuationContrast +
    tellPhraseScore * weights.tellPhraseScore +
    llamaSignature * weights.llamaSignature +
    vocabScore * weights.vocabularyRichness;

  // Determine verdict
  let verdict: 'human' | 'mixed' | 'ai';
  if (aiLikelihood >= THRESHOLDS.aiLikely) {
    verdict = 'ai';
  } else if (aiLikelihood <= THRESHOLDS.humanLikely) {
    verdict = 'human';
  } else {
    verdict = 'mixed';
  }

  // Determine confidence
  let confidence: 'low' | 'medium' | 'high';
  const extremity = Math.abs(aiLikelihood - 50);
  if (extremity > 25) {
    confidence = 'high';
  } else if (extremity > 12) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Build recommendations
  const humanizationRecommendations: HumanizationRecommendation[] = [];

  if (options.returnHumanizationRecommendations !== false && verdict !== 'human') {
    if (burstinessScore > 60) {
      humanizationRecommendations.push({
        type: 'burstiness',
        priority: 'high',
        description: 'Sentence lengths are too uniform. Add more variety.',
        currentValue: extractedFeatures.burstiness.burstiness,
        targetValue: HUMAN_BASELINES.burstiness,
        suggestedFix: 'Mix very short sentences with longer, complex ones.',
      });
    }

    if (extractedFeatures.punctuation.semicolonRate < 0.5) {
      humanizationRecommendations.push({
        type: 'semicolons',
        priority: 'medium',
        description: 'Low semicolon usage is an AI tell.',
        currentValue: extractedFeatures.punctuation.semicolonRate,
        targetValue: HUMAN_BASELINES.semicolonRate,
        suggestedFix: 'Replace some commas or periods with semicolons where appropriate.',
      });
    }

    if (tellPhraseResult.aiTellWeight > 5) {
      humanizationRecommendations.push({
        type: 'tell-words',
        priority: 'high',
        description: 'AI tell-phrases detected.',
        currentValue: tellPhraseResult.aiTellWeight,
        targetValue: 0,
        suggestedFix: 'Replace phrases like "delve", "myriad", "tapestry" with simpler alternatives.',
      });
    }
  }

  // Optional sentence analysis
  let sentenceAnalysis: SentenceAnalysis[] | undefined;
  if (options.returnSentenceAnalysis) {
    const sentences = splitSentences(text);
    let offset = 0;
    sentenceAnalysis = sentences.map(sentence => {
      const wordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
      const flags: string[] = [];
      let likelihood = 50;

      // Very uniform length is suspicious
      if (wordCount >= 12 && wordCount <= 18) {
        flags.push('uniform-length');
        likelihood += 10;
      }

      // Check for tell-phrases in sentence
      const sentenceTells = scoreTellPhrases(sentence);
      if (sentenceTells.aiTellWeight > 0) {
        flags.push('ai-tell-phrase');
        likelihood += Math.min(30, sentenceTells.aiTellWeight * 10);
      }

      const analysis: SentenceAnalysis = {
        text: sentence,
        startOffset: offset,
        wordCount,
        aiLikelihood: Math.min(100, Math.max(0, likelihood)),
        flags,
        isSuspect: likelihood > 65,
      };

      offset += sentence.length + 1;
      return analysis;
    });
  }

  const processingTimeMs = Date.now() - startTime;

  return {
    aiLikelihood: Math.round(aiLikelihood * 10) / 10,
    confidence,
    verdict,
    features: {
      burstiness: extractedFeatures.burstiness.burstiness,
      semicolonRate: extractedFeatures.punctuation.semicolonRate,
      emDashRate: extractedFeatures.punctuation.emDashRate,
      tellPhraseScore: tellPhraseResult.score,
      ngramDiversity: extractedFeatures.vocabulary.bigramDiversity,
      sentenceComplexity: sentenceComplexityScore,
      punctuationContrast: punctuationContrastScore,
    },
    extractedFeatures,
    tellPhrases: tellPhraseResult,
    sentenceAnalysis,
    humanizationRecommendations,
    processingTimeMs,
    detectorVersion: DETECTOR_VERSION,
    method: 'statistical',
  };
}

/**
 * Quick detection for simple API responses.
 */
export function detectQuick(text: string): {
  aiLikelihood: number;
  verdict: 'human' | 'mixed' | 'ai';
  confidence: 'low' | 'medium' | 'high';
} {
  const result = detect(text, {
    returnSentenceAnalysis: false,
    returnHumanizationRecommendations: false,
  });

  return {
    aiLikelihood: result.aiLikelihood,
    verdict: result.verdict,
    confidence: result.confidence,
  };
}

/**
 * Calculate composite score from pre-extracted features.
 */
export function calculateCompositeScore(features: ExtractedFeatures): number {
  const tellResult = { score: 0, aiTellWeight: 0, humanTellWeight: 0, matches: [] };

  const burstinessScore = normalizeScore(
    features.burstiness.burstiness,
    HUMAN_BASELINES.burstiness,
    AI_BASELINES.burstiness,
    true
  );

  const sentenceComplexityScore = calculateSentenceComplexity(
    features.burstiness.sentenceLengths
  );

  const punctuationContrastScore = calculatePunctuationContrast(
    features.punctuation.semicolonRate,
    features.punctuation.emDashRate
  );

  const weights = FEATURE_WEIGHTS_STATISTICAL;
  return (
    burstinessScore * weights.burstiness +
    sentenceComplexityScore * weights.sentenceComplexity +
    punctuationContrastScore * weights.punctuationContrast +
    50 * weights.tellPhraseScore + // Neutral without text
    30 * weights.llamaSignature +
    40 * weights.vocabularyRichness
  );
}
