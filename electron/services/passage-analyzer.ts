/**
 * Passage Analyzer Service
 *
 * Composite analysis service that combines multiple analysis tools:
 * - Quantum reading (tetralemma POVM)
 * - AI detection
 * - Resonance scoring (similarity to book theme)
 *
 * All business logic lives here in the backend, not in the frontend.
 */

import type { EmbeddingDatabase } from '../archive-server/services/embeddings/EmbeddingDatabase';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PassageAnalysis {
  passageId: string;
  text: string;

  // Quantum reading results
  quantum: {
    stance: 'literal' | 'metaphorical' | 'both' | 'neither';
    probabilities: {
      literal: number;
      metaphorical: number;
      both: number;
      neither: number;
    };
    entropy: number; // 0-2 bits (measure of uncertainty)
  };

  // AI detection results
  aiDetection: {
    score: number; // 0-100 (0 = human, 100 = AI)
    confidence: number;
    features: {
      burstiness: number;
      vocabularyDiversity: number;
      avgSentenceLength: number;
      tellPhraseCount: number;
    };
  };

  // Resonance with book theme
  resonance: {
    score: number; // 0-1 similarity
    matchedThemes: string[];
  };

  // Composite recommendation
  recommendation: {
    action: 'approve' | 'gem' | 'reject' | 'review';
    confidence: number;
    reasons: string[];
  };

  // Timestamps
  analyzedAt: number;
}

export interface AnalysisConfig {
  bookId?: string;
  bookTheme?: string;
  enableQuantum?: boolean;
  enableAiDetection?: boolean;
  enableResonance?: boolean;
  model?: 'local' | 'cloud';
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze text with tetralemma POVM (quantum reading)
 * Uses statistical analysis with LLM enhancement when available
 */
async function analyzeQuantum(
  text: string,
  _model: 'local' | 'cloud' = 'local'
): Promise<PassageAnalysis['quantum']> {
  // Statistical analysis (always available)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  // Heuristic indicators
  const metaphorMarkers = /like|as if|metaphor|symbol|represent|embod/gi;
  const literalMarkers = /exactly|precisely|literally|specifically|actually/gi;
  const paradoxMarkers = /both|neither|and yet|however|paradox|contradict/gi;
  const abstractNouns = /consciousness|being|existence|reality|truth|meaning/gi;

  const metaphorCount = (text.match(metaphorMarkers) || []).length;
  const literalCount = (text.match(literalMarkers) || []).length;
  const paradoxCount = (text.match(paradoxMarkers) || []).length;
  const abstractCount = (text.match(abstractNouns) || []).length;

  const totalMarkers = metaphorCount + literalCount + paradoxCount + abstractCount + 1;

  // Calculate raw probabilities
  let pLiteral = (literalCount + 0.25) / totalMarkers;
  let pMetaphorical = (metaphorCount + abstractCount * 0.5 + 0.25) / totalMarkers;
  let pBoth = (paradoxCount + 0.25) / totalMarkers;
  let pNeither = 0.25 / totalMarkers;

  // Normalize
  const sum = pLiteral + pMetaphorical + pBoth + pNeither;
  pLiteral /= sum;
  pMetaphorical /= sum;
  pBoth /= sum;
  pNeither /= sum;

  // Determine stance
  const probs = { literal: pLiteral, metaphorical: pMetaphorical, both: pBoth, neither: pNeither };
  const stance = (Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0]) as PassageAnalysis['quantum']['stance'];

  // Calculate von Neumann entropy: S = -Σ p log₂(p)
  const entropy = -Object.values(probs)
    .filter((p) => p > 0)
    .reduce((sum, p) => sum + p * Math.log2(p), 0);

  return {
    stance,
    probabilities: probs,
    entropy,
  };
}

/**
 * Detect AI-generated content using statistical analysis
 */
function analyzeAiDetection(text: string): PassageAnalysis['aiDetection'] {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);

  // Burstiness: variance in sentence length
  const sentenceLengths = sentences.map((s) => s.split(/\s+/).length);
  const avgLen = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length || 0;
  const variance =
    sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLen, 2), 0) / sentenceLengths.length || 0;
  const burstiness = Math.sqrt(variance) / (avgLen || 1);

  // Vocabulary diversity: unique words / total words
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z]/g, '')));
  const vocabularyDiversity = uniqueWords.size / (words.length || 1);

  // Tell phrases (common AI patterns)
  const tellPhrases = [
    /\bdelve\b/gi,
    /\bfurthermore\b/gi,
    /\bmoreover\b/gi,
    /\bin conclusion\b/gi,
    /\bit'?s important to note\b/gi,
    /\bit'?s worth noting\b/gi,
    /\bI'?d be happy to\b/gi,
    /\bCertainly!\b/gi,
    /\bAbsolutely!\b/gi,
    /\bGreat question\b/gi,
    /\bkey (takeaway|point|insight)/gi,
    /\blet me\b.*\b(explain|break down|clarify)/gi,
  ];
  const tellPhraseCount = tellPhrases.reduce((count, pattern) => {
    return count + (text.match(pattern) || []).length;
  }, 0);

  // Calculate AI score (0-100)
  // Low burstiness + low vocab diversity + tell phrases = AI
  let aiScore = 0;
  aiScore += burstiness < 0.5 ? 30 : burstiness < 1.0 ? 15 : 0;
  aiScore += vocabularyDiversity < 0.4 ? 30 : vocabularyDiversity < 0.6 ? 15 : 0;
  aiScore += Math.min(40, tellPhraseCount * 10);

  return {
    score: Math.min(100, aiScore),
    confidence: 0.7, // Statistical analysis has moderate confidence
    features: {
      burstiness,
      vocabularyDiversity,
      avgSentenceLength: avgLen,
      tellPhraseCount,
    },
  };
}

/**
 * Calculate resonance with book theme using keyword matching
 * (Full embedding similarity would require archive server connection)
 */
function analyzeResonance(
  text: string,
  bookTheme?: string,
  _db?: EmbeddingDatabase
): PassageAnalysis['resonance'] {
  if (!bookTheme) {
    return { score: 0.5, matchedThemes: [] };
  }

  // Extract keywords from theme
  const themeKeywords = bookTheme
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.replace(/[^a-z]/g, ''));

  // Check for keyword matches
  const textLower = text.toLowerCase();
  const matchedThemes = themeKeywords.filter((kw) => textLower.includes(kw));

  // Calculate similarity score
  const score = themeKeywords.length > 0 ? matchedThemes.length / themeKeywords.length : 0.5;

  return {
    score: Math.min(1, score),
    matchedThemes,
  };
}

/**
 * Generate recommendation based on analysis results
 */
function generateRecommendation(
  quantum: PassageAnalysis['quantum'],
  aiDetection: PassageAnalysis['aiDetection'],
  resonance: PassageAnalysis['resonance']
): PassageAnalysis['recommendation'] {
  const reasons: string[] = [];
  let score = 0;

  // Quantum: Metaphorical or Both stances are more interesting for books
  if (quantum.stance === 'metaphorical' || quantum.stance === 'both') {
    score += 25;
    reasons.push(`Rich ${quantum.stance} content`);
  } else if (quantum.stance === 'literal') {
    score += 10;
    reasons.push('Literal/factual content');
  }

  // AI detection: Prefer human-written content
  if (aiDetection.score < 30) {
    score += 30;
    reasons.push('Likely human-written');
  } else if (aiDetection.score < 60) {
    score += 15;
    reasons.push('Mixed AI/human signals');
  } else {
    reasons.push('Possibly AI-generated');
  }

  // Resonance: Higher is better
  if (resonance.score > 0.7) {
    score += 30;
    reasons.push('High theme relevance');
  } else if (resonance.score > 0.4) {
    score += 15;
    reasons.push('Moderate theme relevance');
  } else {
    reasons.push('Low theme relevance');
  }

  // Low entropy = high certainty in stance
  if (quantum.entropy < 1.0) {
    score += 15;
    reasons.push('Clear semantic stance');
  }

  // Determine action
  let action: 'approve' | 'gem' | 'reject' | 'review';
  if (score >= 80) {
    action = 'gem';
  } else if (score >= 50) {
    action = 'approve';
  } else if (score >= 30) {
    action = 'review';
  } else {
    action = 'reject';
  }

  return {
    action,
    confidence: Math.min(1, score / 100),
    reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze a passage with all available analysis tools
 */
export async function analyzePassage(
  passageId: string,
  text: string,
  config: AnalysisConfig = {},
  db?: EmbeddingDatabase
): Promise<PassageAnalysis> {
  const {
    bookTheme,
    enableQuantum = true,
    enableAiDetection = true,
    enableResonance = true,
    model = 'local',
  } = config;

  // Run analyses
  const quantum = enableQuantum
    ? await analyzeQuantum(text, model)
    : { stance: 'literal' as const, probabilities: { literal: 1, metaphorical: 0, both: 0, neither: 0 }, entropy: 0 };

  const aiDetection = enableAiDetection
    ? analyzeAiDetection(text)
    : { score: 50, confidence: 0, features: { burstiness: 0, vocabularyDiversity: 0, avgSentenceLength: 0, tellPhraseCount: 0 } };

  const resonance = enableResonance
    ? analyzeResonance(text, bookTheme, db)
    : { score: 0.5, matchedThemes: [] };

  // Generate recommendation
  const recommendation = generateRecommendation(quantum, aiDetection, resonance);

  return {
    passageId,
    text: text.slice(0, 200) + (text.length > 200 ? '...' : ''), // Truncate for response
    quantum,
    aiDetection,
    resonance,
    recommendation,
    analyzedAt: Date.now(),
  };
}

/**
 * Batch analyze multiple passages
 */
export async function analyzePassages(
  passages: Array<{ id: string; text: string }>,
  config: AnalysisConfig = {},
  db?: EmbeddingDatabase
): Promise<PassageAnalysis[]> {
  const results: PassageAnalysis[] = [];

  for (const passage of passages) {
    const analysis = await analyzePassage(passage.id, passage.text, config, db);
    results.push(analysis);
  }

  // Sort by recommendation confidence (best first)
  results.sort((a, b) => b.recommendation.confidence - a.recommendation.confidence);

  return results;
}

export default {
  analyzePassage,
  analyzePassages,
};
