/**
 * Chekhov Analyzer (Local Implementation)
 *
 * Every detail must serve the narrative. This analyzer detects:
 * - Narrative function (setup, payoff, characterization, worldbuilding, atmosphere, transition)
 * - Necessity score (0-1)
 * - Removal impact assessment
 *
 * Based on Chekhov's principle: "If there's a gun on the wall in act one,
 * it must go off in act three."
 */

import type { ChekhovAnalysis } from './types'

// ============================================================================
// Pattern Definitions
// ============================================================================

const SETUP_PATTERNS = [
  /\b(introduced|mentioned|established|noted|described)\b/i,
  /\bwill (later|eventually|soon)\b/i,
  /\bforeshadow/i,
  /\b(sets? up|set the stage|laying groundwork)\b/i,
  /\b(first time|initially|at first|beginning)\b/i,
  /\bonce upon a time\b/i,
  /\b(there (was|were)|there lived)\b/i,
  /\b(one day|long ago|in the (beginning|past))\b/i,
]

const PAYOFF_PATTERNS = [
  /\b(finally|at last|in the end)\b/i,
  /\b(revealed|discovered|realized|understood)\b/i,
  /\b(paid off|came back|returned to)\b/i,
  /\b(turned out|proved to be)\b/i,
  /\b(remember when|as (we|I) (mentioned|said|noted))\b/i,
  /\b(this explains|that's why|hence|therefore)\b/i,
  /\b(culminat|climax|resolution)\b/i,
  /\b(consequence|result|outcome)\b/i,
]

const CHARACTERIZATION_PATTERNS = [
  /\b(character|personality|trait|nature)\b/i,
  /\b(felt|thought|believed|wondered|feared|hoped|wished)\b/i,
  /\b(always|never|usually|tended to)\b/i,
  /\bkind of (person|man|woman)\b/i,
  /\b(deep down|at heart|in truth)\b/i,
  /\b(struggled with|grappled with|wrestled with)\b/i,
  /\b(motivation|reason|why (he|she|they))\b/i,
  /\b(personality|temperament|disposition)\b/i,
  /\bI (am|was|have been)\b/i,
]

const WORLDBUILDING_PATTERNS = [
  /\b(world|realm|kingdom|society|civilization)\b/i,
  /\b(culture|custom|tradition|ritual)\b/i,
  /\b(rule|law|system|structure)\b/i,
  /\b(history|ancient|legend|myth)\b/i,
  /\b(in this (world|place|land)|where (we|they) live)\b/i,
  /\b(how (it|things) work|the way of)\b/i,
  /\b(according to|as per|by custom)\b/i,
  /\b(era|age|period|epoch)\b/i,
]

const ATMOSPHERE_PATTERNS = [
  /\b(felt like|seemed|appeared)\b/i,
  /\b(dark|light|shadow|glow|shimmer)\b/i,
  /\b(cold|warm|hot|cool|damp|dry)\b/i,
  /\b(silence|quiet|noise|sound|echo)\b/i,
  /\b(smell|scent|fragrance|stench|odor)\b/i,
  /\b(texture|surface|rough|smooth)\b/i,
  /\b(mood|feeling|sense|ambiance|vibe)\b/i,
  /\b(eerie|cozy|tense|peaceful|chaotic)\b/i,
  /\b(weather|wind|rain|sun|storm)\b/i,
]

const TRANSITION_PATTERNS = [
  /\b(meanwhile|later|then|next|after)\b/i,
  /\b(at the same time|simultaneously)\b/i,
  /\b(moving on|turning to|shifting to)\b/i,
  /\b(however|but|yet|still|nevertheless)\b/i,
  /\b(in contrast|on the other hand)\b/i,
  /\b(back to|returning to|as for)\b/i,
  /^(so|well|anyway|now),?\s/im,
  /\b(cut to|scene change|time passed)\b/i,
]

const DISPENSABLE_PATTERNS = [
  /\b(by the way|incidentally|speaking of)\b/i,
  /\b(random|tangent|aside|digression)\b/i,
  /\b(not (really )?relevant|doesn't matter)\b/i,
  /\b(anyway|anyhow|in any case)\b/i,
  /\b(just to mention|worth noting)\b/i,
  /^\s*\([^)]+\)\s*$/m, // Parenthetical asides
]

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Count pattern matches in text
 */
function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => {
    const matches = text.match(pattern)
    return count + (matches ? matches.length : 0)
  }, 0)
}

/**
 * Detect the primary narrative function of a passage
 */
function detectNarrativeFunction(text: string): ChekhovAnalysis['function'] {
  const scores = {
    setup: countMatches(text, SETUP_PATTERNS),
    payoff: countMatches(text, PAYOFF_PATTERNS),
    characterization: countMatches(text, CHARACTERIZATION_PATTERNS),
    worldbuilding: countMatches(text, WORLDBUILDING_PATTERNS),
    atmosphere: countMatches(text, ATMOSPHERE_PATTERNS),
    transition: countMatches(text, TRANSITION_PATTERNS),
    dispensable: countMatches(text, DISPENSABLE_PATTERNS),
  }

  // Find highest scoring function
  let maxFunction: ChekhovAnalysis['function'] = 'characterization'
  let maxScore = 0

  for (const [func, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score
      maxFunction = func as ChekhovAnalysis['function']
    }
  }

  // If no clear pattern, default to characterization (most common)
  if (maxScore === 0) {
    return 'characterization'
  }

  return maxFunction
}

/**
 * Calculate necessity score (0-1)
 * Higher = more essential to narrative
 */
function calculateNecessity(text: string, narrativeFunction: ChekhovAnalysis['function']): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length

  // Base necessity by function
  const functionWeights: Record<ChekhovAnalysis['function'], number> = {
    payoff: 0.9,        // Payoffs are highly necessary
    setup: 0.75,        // Setups are important but need payoffs
    characterization: 0.7,
    worldbuilding: 0.65,
    atmosphere: 0.55,
    transition: 0.45,
    dispensable: 0.2,
  }

  let necessity = functionWeights[narrativeFunction]

  // Adjustments based on content analysis

  // Concrete details increase necessity
  const concretePatterns = [
    /\b(specifically|precisely|exactly)\b/i,
    /\b(because|since|as|due to)\b/i, // Causal connections
    /\b(result|consequence|effect|impact)\b/i,
    /\b\d+\b/, // Numbers add specificity
  ]
  const concreteScore = countMatches(text, concretePatterns)
  necessity += Math.min(concreteScore * 0.05, 0.15)

  // Emotional content increases necessity
  const emotionalPatterns = [
    /\b(love|hate|fear|hope|joy|sorrow|anger|despair)\b/i,
    /\b(heart|soul|spirit)\b/i,
    /\b(cry|laugh|scream|whisper)\b/i,
  ]
  const emotionalScore = countMatches(text, emotionalPatterns)
  necessity += Math.min(emotionalScore * 0.05, 0.1)

  // Dialogue often more necessary
  const hasDialogue = /"[^"]*"/.test(text) || /'[^']*'/.test(text)
  if (hasDialogue) {
    necessity += 0.1
  }

  // Action verbs increase necessity
  const actionPatterns = [
    /\b(ran|jumped|grabbed|threw|pulled|pushed)\b/i,
    /\b(said|shouted|whispered|replied|asked)\b/i,
    /\b(saw|heard|felt|noticed|realized)\b/i,
  ]
  const actionScore = countMatches(text, actionPatterns)
  necessity += Math.min(actionScore * 0.03, 0.1)

  // Very short passages might be fragments (lower necessity)
  if (wordCount < 20) {
    necessity *= 0.8
  }

  // Very long passages might be bloated (slightly lower necessity)
  if (wordCount > 500) {
    necessity *= 0.95
  }

  // Repetitive language reduces necessity
  const words = text.toLowerCase().split(/\s+/)
  const uniqueWords = new Set(words)
  const repetitionRatio = uniqueWords.size / words.length
  if (repetitionRatio < 0.5) {
    necessity *= 0.9
  }

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, necessity))
}

/**
 * Generate removal impact assessment
 */
function assessRemovalImpact(
  _text: string,
  narrativeFunction: ChekhovAnalysis['function'],
  necessity: number
): string {
  if (necessity >= 0.8) {
    switch (narrativeFunction) {
      case 'payoff':
        return 'Critical - removing this would leave narrative threads unresolved'
      case 'setup':
        return 'Important - future payoffs depend on this setup'
      case 'characterization':
        return 'Essential - key character insight would be lost'
      default:
        return 'Significant - removing would noticeably weaken the narrative'
    }
  }

  if (necessity >= 0.6) {
    switch (narrativeFunction) {
      case 'worldbuilding':
        return 'Helpful - adds context but story could survive without it'
      case 'atmosphere':
        return 'Enhancing - contributes to mood but not structurally necessary'
      case 'transition':
        return 'Connecting - smooths narrative flow but could be shortened'
      default:
        return 'Useful - strengthens narrative but not essential'
    }
  }

  if (necessity >= 0.4) {
    return 'Optional - could be cut with minimal impact on narrative'
  }

  return 'Dispensable - removing would improve focus and pacing'
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Analyze the narrative necessity of a passage using Chekhov's principle
 */
export function analyzeNecessity(text: string): ChekhovAnalysis {
  const narrativeFunction = detectNarrativeFunction(text)
  const necessity = calculateNecessity(text, narrativeFunction)
  const removalImpact = assessRemovalImpact(text, narrativeFunction, necessity)

  return {
    necessity,
    function: narrativeFunction,
    removalImpact,
  }
}

/**
 * Batch analyze multiple passages
 */
export function analyzeNecessityBatch(texts: string[]): ChekhovAnalysis[] {
  return texts.map(text => analyzeNecessity(text))
}

/**
 * Get a quick necessity score without full analysis
 */
export function quickNecessityScore(text: string): number {
  const narrativeFunction = detectNarrativeFunction(text)
  return calculateNecessity(text, narrativeFunction)
}

/**
 * Check if text appears to be setup for something
 */
export function isSetup(text: string): boolean {
  return countMatches(text, SETUP_PATTERNS) > countMatches(text, PAYOFF_PATTERNS)
}

/**
 * Check if text appears to be a payoff
 */
export function isPayoff(text: string): boolean {
  return countMatches(text, PAYOFF_PATTERNS) > countMatches(text, SETUP_PATTERNS)
}

/**
 * Find potential setup/payoff pairs in a collection of texts
 */
export function findSetupPayoffPairs(texts: string[]): Array<{ setupIndex: number; payoffIndex: number; confidence: number }> {
  const pairs: Array<{ setupIndex: number; payoffIndex: number; confidence: number }> = []

  // Extract key nouns/concepts from each text
  const concepts = texts.map(t => {
    const words = t.toLowerCase().match(/\b[a-z]{4,}\b/g) || []
    return new Set(words)
  })

  for (let i = 0; i < texts.length; i++) {
    if (!isSetup(texts[i])) continue

    for (let j = i + 1; j < texts.length; j++) {
      if (!isPayoff(texts[j])) continue

      // Check for shared concepts
      const shared = [...concepts[i]].filter(word => concepts[j].has(word))
      if (shared.length > 2) {
        pairs.push({
          setupIndex: i,
          payoffIndex: j,
          confidence: Math.min(shared.length / 5, 1),
        })
      }
    }
  }

  return pairs
}
