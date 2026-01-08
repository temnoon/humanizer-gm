/**
 * Sentiment/Affect Tracker Service
 *
 * Analyzes emotional trajectory through text using the VAD model:
 * - Valence: Negative (-1) to Positive (+1)
 * - Arousal: Calm (0) to Excited (1)
 * - Dominance: Submissive (0) to Dominant (1)
 *
 * Also tracks emotional arc and identifies climax points.
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface AffectPoint {
  valence: number; // -1 to +1
  arousal: number; // 0 to 1
  dominance: number; // 0 to 1
}

export interface SentimentAnalysis {
  sentenceId: string;
  text: string;
  affect: AffectPoint;
  emotion: {
    primary: string; // e.g., "joy", "sadness", "anger"
    secondary?: string;
    intensity: number; // 0-1
  };
  tone: 'positive' | 'negative' | 'neutral' | 'mixed';
}

export interface AffectTrajectory {
  documentId: string;
  sentences: SentimentAnalysis[];
  arc: {
    // Key points in emotional arc
    opening: AffectPoint;
    climax: { index: number; affect: AffectPoint };
    resolution: AffectPoint;

    // Arc shape
    shape: 'rising' | 'falling' | 'peak' | 'valley' | 'flat' | 'wave';
    tensionPoints: number[]; // Indices of high-tension moments
  };
  summary: {
    averageValence: number;
    averageArousal: number;
    emotionalRange: number; // Variance in valence
    dominantEmotion: string;
    toneDistribution: {
      positive: number;
      negative: number;
      neutral: number;
      mixed: number;
    };
  };
}

// ═══════════════════════════════════════════════════════════════════
// EMOTION LEXICONS
// ═══════════════════════════════════════════════════════════════════

// Basic emotion word lists with VAD values
const EMOTION_LEXICON: Record<string, { valence: number; arousal: number; dominance: number; emotion: string }> = {
  // Joy/Happiness
  happy: { valence: 0.9, arousal: 0.6, dominance: 0.6, emotion: 'joy' },
  joy: { valence: 0.95, arousal: 0.7, dominance: 0.6, emotion: 'joy' },
  delighted: { valence: 0.9, arousal: 0.7, dominance: 0.6, emotion: 'joy' },
  pleased: { valence: 0.7, arousal: 0.4, dominance: 0.6, emotion: 'joy' },
  cheerful: { valence: 0.8, arousal: 0.6, dominance: 0.5, emotion: 'joy' },
  excited: { valence: 0.7, arousal: 0.9, dominance: 0.6, emotion: 'joy' },
  thrilled: { valence: 0.8, arousal: 0.9, dominance: 0.6, emotion: 'joy' },
  love: { valence: 0.9, arousal: 0.6, dominance: 0.5, emotion: 'love' },
  loved: { valence: 0.9, arousal: 0.5, dominance: 0.5, emotion: 'love' },
  adore: { valence: 0.9, arousal: 0.6, dominance: 0.4, emotion: 'love' },

  // Sadness
  sad: { valence: -0.7, arousal: 0.3, dominance: 0.3, emotion: 'sadness' },
  unhappy: { valence: -0.6, arousal: 0.3, dominance: 0.3, emotion: 'sadness' },
  miserable: { valence: -0.9, arousal: 0.4, dominance: 0.2, emotion: 'sadness' },
  depressed: { valence: -0.8, arousal: 0.2, dominance: 0.2, emotion: 'sadness' },
  grief: { valence: -0.9, arousal: 0.5, dominance: 0.2, emotion: 'sadness' },
  lonely: { valence: -0.6, arousal: 0.2, dominance: 0.2, emotion: 'sadness' },
  heartbroken: { valence: -0.9, arousal: 0.5, dominance: 0.2, emotion: 'sadness' },

  // Anger
  angry: { valence: -0.7, arousal: 0.8, dominance: 0.7, emotion: 'anger' },
  furious: { valence: -0.9, arousal: 0.95, dominance: 0.8, emotion: 'anger' },
  rage: { valence: -0.9, arousal: 0.95, dominance: 0.8, emotion: 'anger' },
  irritated: { valence: -0.5, arousal: 0.6, dominance: 0.5, emotion: 'anger' },
  annoyed: { valence: -0.4, arousal: 0.5, dominance: 0.5, emotion: 'anger' },
  frustrated: { valence: -0.6, arousal: 0.7, dominance: 0.4, emotion: 'anger' },
  hostile: { valence: -0.7, arousal: 0.7, dominance: 0.7, emotion: 'anger' },

  // Fear
  afraid: { valence: -0.7, arousal: 0.7, dominance: 0.2, emotion: 'fear' },
  scared: { valence: -0.7, arousal: 0.8, dominance: 0.2, emotion: 'fear' },
  terrified: { valence: -0.9, arousal: 0.95, dominance: 0.1, emotion: 'fear' },
  anxious: { valence: -0.5, arousal: 0.7, dominance: 0.3, emotion: 'fear' },
  worried: { valence: -0.5, arousal: 0.5, dominance: 0.3, emotion: 'fear' },
  nervous: { valence: -0.4, arousal: 0.6, dominance: 0.3, emotion: 'fear' },
  panic: { valence: -0.8, arousal: 0.95, dominance: 0.1, emotion: 'fear' },

  // Surprise
  surprised: { valence: 0.3, arousal: 0.8, dominance: 0.4, emotion: 'surprise' },
  amazed: { valence: 0.6, arousal: 0.8, dominance: 0.4, emotion: 'surprise' },
  astonished: { valence: 0.4, arousal: 0.9, dominance: 0.3, emotion: 'surprise' },
  shocked: { valence: -0.2, arousal: 0.9, dominance: 0.2, emotion: 'surprise' },
  stunned: { valence: 0.0, arousal: 0.8, dominance: 0.2, emotion: 'surprise' },

  // Disgust
  disgusted: { valence: -0.8, arousal: 0.6, dominance: 0.5, emotion: 'disgust' },
  revolted: { valence: -0.9, arousal: 0.7, dominance: 0.4, emotion: 'disgust' },
  repulsed: { valence: -0.8, arousal: 0.6, dominance: 0.4, emotion: 'disgust' },

  // Trust
  trust: { valence: 0.6, arousal: 0.3, dominance: 0.5, emotion: 'trust' },
  confident: { valence: 0.6, arousal: 0.5, dominance: 0.8, emotion: 'trust' },
  secure: { valence: 0.6, arousal: 0.2, dominance: 0.6, emotion: 'trust' },
  safe: { valence: 0.6, arousal: 0.2, dominance: 0.5, emotion: 'trust' },

  // Anticipation
  eager: { valence: 0.6, arousal: 0.7, dominance: 0.5, emotion: 'anticipation' },
  hopeful: { valence: 0.6, arousal: 0.5, dominance: 0.4, emotion: 'anticipation' },
  expectant: { valence: 0.4, arousal: 0.5, dominance: 0.4, emotion: 'anticipation' },

  // Calm/Peace
  calm: { valence: 0.4, arousal: 0.1, dominance: 0.5, emotion: 'calm' },
  peaceful: { valence: 0.6, arousal: 0.1, dominance: 0.5, emotion: 'calm' },
  serene: { valence: 0.7, arousal: 0.1, dominance: 0.5, emotion: 'calm' },
  relaxed: { valence: 0.5, arousal: 0.1, dominance: 0.5, emotion: 'calm' },
  tranquil: { valence: 0.6, arousal: 0.1, dominance: 0.5, emotion: 'calm' },
};

// Intensifiers and diminishers
const INTENSIFIERS = ['very', 'extremely', 'incredibly', 'absolutely', 'completely', 'utterly', 'deeply'];
const DIMINISHERS = ['slightly', 'somewhat', 'a bit', 'rather', 'fairly', 'kind of', 'sort of'];
const NEGATORS = ['not', "n't", 'never', 'no', 'without', 'hardly', 'barely'];

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze sentiment of a single sentence
 */
export function analyzeSentence(sentenceId: string, sentence: string): SentimentAnalysis {
  const words = sentence.toLowerCase().split(/\s+/);
  let totalValence = 0;
  let totalArousal = 0;
  let totalDominance = 0;
  let emotionCounts: Record<string, number> = {};
  let matchCount = 0;

  let negated = false;
  let intensified = false;
  let diminished = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-z]/g, '');

    // Check modifiers
    if (NEGATORS.some((n) => word.includes(n))) {
      negated = true;
      continue;
    }
    if (INTENSIFIERS.includes(word)) {
      intensified = true;
      continue;
    }
    if (DIMINISHERS.includes(word)) {
      diminished = true;
      continue;
    }

    // Check emotion lexicon
    if (EMOTION_LEXICON[word]) {
      const entry = EMOTION_LEXICON[word];
      let valence = entry.valence;
      let arousal = entry.arousal;
      let dominance = entry.dominance;

      // Apply modifiers
      if (negated) {
        valence *= -0.8; // Negate flips valence
        negated = false;
      }
      if (intensified) {
        valence *= 1.3;
        arousal *= 1.2;
        intensified = false;
      }
      if (diminished) {
        valence *= 0.7;
        arousal *= 0.7;
        diminished = false;
      }

      totalValence += valence;
      totalArousal += arousal;
      totalDominance += dominance;
      emotionCounts[entry.emotion] = (emotionCounts[entry.emotion] || 0) + 1;
      matchCount++;
    }
  }

  // Default to neutral if no emotion words found
  if (matchCount === 0) {
    return {
      sentenceId,
      text: sentence,
      affect: { valence: 0, arousal: 0.3, dominance: 0.5 },
      emotion: { primary: 'neutral', intensity: 0.2 },
      tone: 'neutral',
    };
  }

  // Average the values
  const affect: AffectPoint = {
    valence: Math.max(-1, Math.min(1, totalValence / matchCount)),
    arousal: Math.max(0, Math.min(1, totalArousal / matchCount)),
    dominance: Math.max(0, Math.min(1, totalDominance / matchCount)),
  };

  // Determine primary emotion
  const sortedEmotions = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1]);
  const primary = sortedEmotions[0]?.[0] || 'neutral';
  const secondary = sortedEmotions[1]?.[0];
  const intensity = Math.min(1, matchCount / (words.length * 0.3));

  // Determine tone
  let tone: SentimentAnalysis['tone'];
  if (affect.valence > 0.2) {
    tone = 'positive';
  } else if (affect.valence < -0.2) {
    tone = 'negative';
  } else if (matchCount > 1 && Math.abs(affect.valence) < 0.2) {
    tone = 'mixed';
  } else {
    tone = 'neutral';
  }

  return {
    sentenceId,
    text: sentence,
    affect,
    emotion: { primary, secondary, intensity },
    tone,
  };
}

/**
 * Analyze emotional trajectory of a document
 */
export function analyzeTrajectory(documentId: string, text: string): AffectTrajectory {
  // Split into sentences
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);

  if (sentences.length === 0) {
    return createEmptyTrajectory(documentId);
  }

  // Analyze each sentence
  const analyses = sentences.map((sentence, i) =>
    analyzeSentence(`${documentId}-s${i}`, sentence)
  );

  // Calculate arc
  const opening = analyses[0]?.affect || { valence: 0, arousal: 0.3, dominance: 0.5 };
  const resolution = analyses[analyses.length - 1]?.affect || opening;

  // Find climax (highest arousal point)
  let climaxIndex = 0;
  let maxArousal = 0;
  analyses.forEach((a, i) => {
    if (a.affect.arousal > maxArousal) {
      maxArousal = a.affect.arousal;
      climaxIndex = i;
    }
  });
  const climax = { index: climaxIndex, affect: analyses[climaxIndex]?.affect || opening };

  // Find tension points (above average arousal)
  const avgArousal = analyses.reduce((sum, a) => sum + a.affect.arousal, 0) / analyses.length;
  const tensionPoints = analyses
    .map((a, i) => ({ index: i, arousal: a.affect.arousal }))
    .filter((p) => p.arousal > avgArousal + 0.1)
    .map((p) => p.index);

  // Determine arc shape
  const firstHalfAvg = analyses.slice(0, Math.floor(analyses.length / 2))
    .reduce((sum, a) => sum + a.affect.arousal, 0) / Math.floor(analyses.length / 2) || 0;
  const secondHalfAvg = analyses.slice(Math.floor(analyses.length / 2))
    .reduce((sum, a) => sum + a.affect.arousal, 0) / Math.ceil(analyses.length / 2) || 0;

  let shape: AffectTrajectory['arc']['shape'];
  if (climaxIndex > analyses.length * 0.3 && climaxIndex < analyses.length * 0.7) {
    shape = 'peak';
  } else if (firstHalfAvg > secondHalfAvg + 0.15) {
    shape = 'falling';
  } else if (secondHalfAvg > firstHalfAvg + 0.15) {
    shape = 'rising';
  } else if (tensionPoints.length > 2) {
    shape = 'wave';
  } else if (avgArousal < 0.3) {
    shape = 'flat';
  } else {
    shape = 'valley';
  }

  // Calculate summary
  const avgValence = analyses.reduce((sum, a) => sum + a.affect.valence, 0) / analyses.length;
  const valenceVariance = analyses.reduce((sum, a) => sum + Math.pow(a.affect.valence - avgValence, 2), 0) / analyses.length;
  const emotionalRange = Math.sqrt(valenceVariance);

  const toneDistribution = {
    positive: analyses.filter((a) => a.tone === 'positive').length / analyses.length,
    negative: analyses.filter((a) => a.tone === 'negative').length / analyses.length,
    neutral: analyses.filter((a) => a.tone === 'neutral').length / analyses.length,
    mixed: analyses.filter((a) => a.tone === 'mixed').length / analyses.length,
  };

  // Find dominant emotion
  const emotionCounts: Record<string, number> = {};
  analyses.forEach((a) => {
    emotionCounts[a.emotion.primary] = (emotionCounts[a.emotion.primary] || 0) + 1;
  });
  const dominantEmotion = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

  return {
    documentId,
    sentences: analyses,
    arc: {
      opening,
      climax,
      resolution,
      shape,
      tensionPoints,
    },
    summary: {
      averageValence: avgValence,
      averageArousal: avgArousal,
      emotionalRange,
      dominantEmotion,
      toneDistribution,
    },
  };
}

function createEmptyTrajectory(documentId: string): AffectTrajectory {
  return {
    documentId,
    sentences: [],
    arc: {
      opening: { valence: 0, arousal: 0.3, dominance: 0.5 },
      climax: { index: 0, affect: { valence: 0, arousal: 0.3, dominance: 0.5 } },
      resolution: { valence: 0, arousal: 0.3, dominance: 0.5 },
      shape: 'flat',
      tensionPoints: [],
    },
    summary: {
      averageValence: 0,
      averageArousal: 0.3,
      emotionalRange: 0,
      dominantEmotion: 'neutral',
      toneDistribution: { positive: 0, negative: 0, neutral: 1, mixed: 0 },
    },
  };
}

export default {
  analyzeSentence,
  analyzeTrajectory,
};
