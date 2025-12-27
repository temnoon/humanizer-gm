/**
 * Highlight Mapper - Converts analysis data to highlight ranges
 */

import type {
  HighlightRange,
  HighlightLayer,
  SentenceAnalysis,
  GPTZeroResult,
  TellPhraseMatch,
  DiffResult,
  AnalysisData,
} from './types';

// ============================================
// Sentence Analysis → Highlights
// ============================================

export function mapSentenceAnalysisToHighlights(
  sentences: SentenceAnalysis[]
): HighlightRange[] {
  return sentences.map((sentence) => ({
    start: sentence.startOffset,
    end: sentence.endOffset ?? sentence.startOffset + sentence.text.length,
    type: 'ai-detection' as HighlightLayer,
    score: sentence.aiLikelihood,
    reason: sentence.flags.length > 0
      ? `AI: ${sentence.aiLikelihood}% - ${sentence.flags.join(', ')}`
      : `AI: ${sentence.aiLikelihood}%`,
    meta: {
      isSuspect: sentence.isSuspect,
      wordCount: sentence.wordCount,
    },
  }));
}

// ============================================
// GPTZero → Highlights
// ============================================

export function mapGPTZeroToHighlights(
  gptzero: GPTZeroResult,
  text: string
): HighlightRange[] {
  const highlights: HighlightRange[] = [];
  let currentOffset = 0;

  for (const sentence of gptzero.sentences) {
    // Find sentence position in text
    const start = text.indexOf(sentence.sentence, currentOffset);
    if (start === -1) continue;

    const end = start + sentence.sentence.length;
    currentOffset = end;

    if (sentence.highlight_sentence_for_ai) {
      highlights.push({
        start,
        end,
        type: 'gptzero',
        score: sentence.generated_prob * 100,
        reason: `GPTZero: ${(sentence.generated_prob * 100).toFixed(1)}% AI-generated`,
        meta: {
          paraphrasedProb: sentence.paraphrased_prob,
        },
      });
    }
  }

  return highlights;
}

// ============================================
// Tell Phrases → Highlights
// ============================================

export function mapTellPhrasesToHighlights(
  tellPhrases: TellPhraseMatch[]
): HighlightRange[] {
  const highlights: HighlightRange[] = [];

  for (const match of tellPhrases) {
    for (const position of match.positions) {
      highlights.push({
        start: position,
        end: position + match.phrase.length,
        type: 'tell-phrases',
        score: match.weight * 100,
        reason: `${match.phrase} (${match.category}, ${match.direction === 'ai' ? 'AI tell' : 'human tell'})`,
        meta: {
          category: match.category,
          direction: match.direction,
          weight: match.weight,
        },
      });
    }
  }

  return highlights;
}

// ============================================
// Diff → Highlights
// ============================================

export function mapDiffToHighlights(
  diff: DiffResult
): HighlightRange[] {
  return diff.changes.map((change) => ({
    start: change.position,
    end: change.position + (change.original?.length || change.replacement?.length || 0),
    type: 'diff' as HighlightLayer,
    reason: change.reason || `${change.type}: "${change.original}" → "${change.replacement}"`,
    meta: {
      changeType: change.type,
      original: change.original,
      replacement: change.replacement,
    },
  }));
}

// ============================================
// Combined Mapper
// ============================================

export function mapAnalysisDataToHighlights(
  data: AnalysisData,
  text: string,
  activeLayers: HighlightLayer[]
): HighlightRange[] {
  const highlights: HighlightRange[] = [];

  // AI Detection highlights
  if (activeLayers.includes('ai-detection') && data.sentences) {
    highlights.push(...mapSentenceAnalysisToHighlights(data.sentences));
  }

  // GPTZero highlights (premium)
  if (activeLayers.includes('gptzero') && data.gptzero) {
    highlights.push(...mapGPTZeroToHighlights(data.gptzero, text));
  }

  // Tell-phrase highlights
  if (activeLayers.includes('tell-phrases') && data.tellPhrases) {
    highlights.push(...mapTellPhrasesToHighlights(data.tellPhrases));
  }

  // Diff highlights
  if (activeLayers.includes('diff') && data.diff) {
    highlights.push(...mapDiffToHighlights(data.diff));
  }

  // Sort by start position, then by end position (longer ranges first)
  return highlights.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });
}

// ============================================
// Utility: Merge overlapping highlights
// ============================================

export function mergeOverlappingHighlights(
  highlights: HighlightRange[]
): HighlightRange[] {
  if (highlights.length === 0) return [];

  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    // Same type and overlapping
    if (current.type === last.type && current.start <= last.end) {
      // Extend the last highlight
      last.end = Math.max(last.end, current.end);
      // Take higher score
      if (current.score !== undefined && (last.score === undefined || current.score > last.score)) {
        last.score = current.score;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ============================================
// Utility: Filter highlights by score threshold
// ============================================

export function filterHighlightsByScore(
  highlights: HighlightRange[],
  minScore: number
): HighlightRange[] {
  return highlights.filter((h) => h.score === undefined || h.score >= minScore);
}
