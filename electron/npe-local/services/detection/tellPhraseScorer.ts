/**
 * Tell-Phrase Scoring for AI Detection
 *
 * Detects characteristic phrases that signal AI or human authorship.
 */

import type { TellPhrase, TellPhraseMatch, TellPhraseScore } from './types';

// ============================================================================
// Tell-Phrase Database
// ============================================================================

export const AI_TELL_PHRASES: TellPhrase[] = [
  // Filler phrases (high weight - strong AI signals)
  { phrase: "it's worth noting", category: 'ai-filler', weight: 3.0, direction: 'ai', replacements: ['notably', 'interestingly', ''] },
  { phrase: "it is worth noting", category: 'ai-filler', weight: 3.0, direction: 'ai', replacements: ['notably', ''] },
  { phrase: "it bears mentioning", category: 'ai-filler', weight: 2.5, direction: 'ai', replacements: ['also', ''] },
  { phrase: "it's important to note", category: 'ai-filler', weight: 2.5, direction: 'ai', replacements: ['importantly', ''] },
  { phrase: "it should be noted", category: 'ai-filler', weight: 2.5, direction: 'ai', replacements: ['notably', ''] },

  // Characteristic verbs
  { phrase: 'delve', category: 'ai-emphasis', weight: 3.0, direction: 'ai', replacements: ['explore', 'examine', 'investigate'] },
  { phrase: 'delving', category: 'ai-emphasis', weight: 3.0, direction: 'ai', replacements: ['exploring', 'examining'] },
  { phrase: 'testament to', category: 'ai-filler', weight: 2.5, direction: 'ai', replacements: ['evidence of', 'shows'] },
  { phrase: 'underscores', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['shows', 'highlights'] },

  // Transition overuse
  { phrase: 'moreover', category: 'ai-transition', weight: 1.5, direction: 'ai', replacements: ['also', 'and'] },
  { phrase: 'furthermore', category: 'ai-transition', weight: 1.5, direction: 'ai', replacements: ['also', 'and'] },
  { phrase: 'in conclusion', category: 'ai-transition', weight: 2.0, direction: 'ai', replacements: ['finally', ''] },
  { phrase: 'in summary', category: 'ai-transition', weight: 1.5, direction: 'ai', replacements: ['overall', ''] },
  { phrase: 'thus', category: 'ai-transition', weight: 1.0, direction: 'ai', replacements: ['so', 'therefore'] },
  { phrase: 'hence', category: 'ai-transition', weight: 1.5, direction: 'ai', replacements: ['so', 'therefore'] },
  { phrase: 'consequently', category: 'ai-transition', weight: 1.0, direction: 'ai', replacements: ['so', 'as a result'] },

  // Emphasis overuse
  { phrase: 'crucial', category: 'ai-emphasis', weight: 1.5, direction: 'ai', replacements: ['important', 'key'] },
  { phrase: 'pivotal', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['important', 'key'] },
  { phrase: 'myriad', category: 'ai-emphasis', weight: 2.5, direction: 'ai', replacements: ['many', 'numerous'] },
  { phrase: 'plethora', category: 'ai-emphasis', weight: 2.5, direction: 'ai', replacements: ['many', 'lots of'] },
  { phrase: 'multifaceted', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['complex', 'varied'] },
  { phrase: 'nuanced', category: 'ai-emphasis', weight: 1.5, direction: 'ai', replacements: ['subtle', 'complex'] },
  { phrase: 'profound', category: 'ai-emphasis', weight: 1.5, direction: 'ai', replacements: ['deep', 'significant'] },
  { phrase: 'paramount', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['most important', 'essential'] },

  // Hedge phrases
  { phrase: 'it can be argued', category: 'ai-hedge', weight: 2.0, direction: 'ai', replacements: ['some say', 'arguably'] },
  { phrase: 'one could argue', category: 'ai-hedge', weight: 1.5, direction: 'ai', replacements: ['arguably', 'some say'] },
  { phrase: 'it is clear that', category: 'ai-hedge', weight: 1.5, direction: 'ai', replacements: ['clearly', ''] },
  { phrase: 'it goes without saying', category: 'ai-filler', weight: 2.0, direction: 'ai', replacements: ['obviously', ''] },

  // Landscape/framework language
  { phrase: 'landscape', category: 'ai-filler', weight: 1.5, direction: 'ai', replacements: ['field', 'area'] },
  { phrase: 'paradigm', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['model', 'approach'] },
  { phrase: 'ecosystem', category: 'ai-filler', weight: 1.5, direction: 'ai', replacements: ['system', 'environment'] },
  { phrase: 'holistic', category: 'ai-emphasis', weight: 2.0, direction: 'ai', replacements: ['complete', 'comprehensive'] },

  // Narrative tells
  { phrase: 'in the realm of', category: 'ai-filler', weight: 2.0, direction: 'ai', replacements: ['in', 'within'] },
  { phrase: 'tapestry of', category: 'ai-emphasis', weight: 2.5, direction: 'ai', replacements: ['mix of', 'combination of'] },
  { phrase: 'journey of', category: 'ai-filler', weight: 1.5, direction: 'ai', replacements: ['process of', 'path to'] },
  { phrase: 'dance of', category: 'ai-emphasis', weight: 2.5, direction: 'ai', replacements: ['interplay of', 'balance of'] },

  // Meta-commentary (Qwen/DeepSeek pattern)
  { phrase: 'okay, so', category: 'ai-filler', weight: 3.0, direction: 'ai', replacements: [''] },
  { phrase: 'alright, so', category: 'ai-filler', weight: 3.0, direction: 'ai', replacements: [''] },
  { phrase: 'let me think', category: 'ai-filler', weight: 3.0, direction: 'ai', replacements: [''] },
  { phrase: 'first, let me', category: 'ai-filler', weight: 2.5, direction: 'ai', replacements: [''] },
];

export const HUMAN_TELL_PHRASES: TellPhrase[] = [
  // First-person specificity
  { phrase: 'i remember', category: 'human-specific', weight: 1.5, direction: 'human' },
  { phrase: 'i recall', category: 'human-specific', weight: 1.5, direction: 'human' },
  { phrase: 'i noticed', category: 'human-specific', weight: 1.0, direction: 'human' },
  { phrase: 'i realized', category: 'human-specific', weight: 1.0, direction: 'human' },
  { phrase: 'i thought', category: 'human-specific', weight: 1.0, direction: 'human' },
  { phrase: 'i felt', category: 'human-specific', weight: 1.0, direction: 'human' },

  // Natural hedges
  { phrase: 'kind of', category: 'human-hedge', weight: 0.3, direction: 'human' },
  { phrase: 'sort of', category: 'human-hedge', weight: 0.3, direction: 'human' },
  { phrase: 'i think', category: 'human-hedge', weight: 0.2, direction: 'human' },
  { phrase: 'i guess', category: 'human-hedge', weight: 0.3, direction: 'human' },
  { phrase: 'actually', category: 'human-hedge', weight: 0.2, direction: 'human' },
  { phrase: 'honestly', category: 'human-hedge', weight: 0.3, direction: 'human' },

  // Colloquialisms
  { phrase: 'you know', category: 'human-hedge', weight: 1.5, direction: 'human' },
  { phrase: 'i mean', category: 'human-hedge', weight: 1.0, direction: 'human' },
  { phrase: "don't get me wrong", category: 'human-hedge', weight: 2.0, direction: 'human' },
  { phrase: 'to be honest', category: 'human-hedge', weight: 1.5, direction: 'human' },
  { phrase: 'the thing is', category: 'human-hedge', weight: 1.5, direction: 'human' },

  // Temporal specificity
  { phrase: 'back in', category: 'human-specific', weight: 1.0, direction: 'human' },
  { phrase: 'a few years ago', category: 'human-specific', weight: 1.0, direction: 'human' },
  { phrase: 'growing up', category: 'human-specific', weight: 1.0, direction: 'human' },
];

const ALL_TELL_PHRASES = [...AI_TELL_PHRASES, ...HUMAN_TELL_PHRASES];

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Score text for AI/human tell-phrases
 */
export function scoreTellPhrases(text: string): TellPhraseScore {
  const lowerText = text.toLowerCase();
  const matches: TellPhraseMatch[] = [];
  let aiTellWeight = 0;
  let humanTellWeight = 0;

  for (const tellPhrase of ALL_TELL_PHRASES) {
    const positions: number[] = [];
    let searchStart = 0;
    let pos: number;

    // Find all occurrences
    while ((pos = lowerText.indexOf(tellPhrase.phrase, searchStart)) !== -1) {
      positions.push(pos);
      searchStart = pos + 1;
    }

    if (positions.length > 0) {
      const match: TellPhraseMatch = {
        phrase: tellPhrase.phrase,
        category: tellPhrase.category,
        count: positions.length,
        weight: tellPhrase.weight,
        direction: tellPhrase.direction,
        positions,
      };
      matches.push(match);

      const totalWeight = tellPhrase.weight * positions.length;
      if (tellPhrase.direction === 'ai') {
        aiTellWeight += totalWeight;
      } else {
        humanTellWeight += totalWeight;
      }
    }
  }

  // Composite score: positive = AI-like, negative = human-like
  const score = aiTellWeight - humanTellWeight;

  return {
    score,
    matches,
    aiTellWeight,
    humanTellWeight,
  };
}

/**
 * Get replacement suggestions for detected tell-phrases
 */
export function getReplacements(matches: TellPhraseMatch[]): Map<string, string[]> {
  const replacements = new Map<string, string[]>();

  for (const match of matches) {
    if (match.direction === 'ai') {
      const tellPhrase = AI_TELL_PHRASES.find(tp => tp.phrase === match.phrase);
      if (tellPhrase?.replacements) {
        replacements.set(match.phrase, tellPhrase.replacements);
      }
    }
  }

  return replacements;
}

/**
 * Get summary of tell-phrase analysis
 */
export function tellPhraseSummary(score: TellPhraseScore): string {
  const aiMatches = score.matches.filter(m => m.direction === 'ai');
  const humanMatches = score.matches.filter(m => m.direction === 'human');

  const parts: string[] = [];

  if (aiMatches.length > 0) {
    const topAI = aiMatches
      .sort((a, b) => b.weight * b.count - a.weight * a.count)
      .slice(0, 3)
      .map(m => `"${m.phrase}" (${m.count}x)`);
    parts.push(`AI tells: ${topAI.join(', ')}`);
  }

  if (humanMatches.length > 0) {
    const topHuman = humanMatches
      .sort((a, b) => b.weight * b.count - a.weight * a.count)
      .slice(0, 3)
      .map(m => `"${m.phrase}" (${m.count}x)`);
    parts.push(`Human tells: ${topHuman.join(', ')}`);
  }

  if (parts.length === 0) {
    return 'No distinctive tell-phrases detected';
  }

  return parts.join('; ');
}
