/**
 * Chekhov Analyzer Service
 *
 * Implements "Chekhov's Gun" principle: every detail must serve the narrative.
 * Analyzes text to determine if details/sentences are narratively necessary.
 *
 * Key concepts:
 * - Necessity: Does this detail contribute to the narrative arc?
 * - Setup/Payoff: Does this detail set up something that pays off later?
 * - Removal Impact: What's lost if this detail is removed?
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ChekhovAnalysis {
  sentenceId: string;
  text: string;
  necessity: number; // 0-1: How essential is this detail?
  category: 'essential' | 'supporting' | 'atmospheric' | 'dispensable';

  // Narrative function
  function: {
    type: 'setup' | 'payoff' | 'transition' | 'characterization' | 'worldbuilding' | 'atmosphere' | 'unknown';
    description: string;
  };

  // What this detail connects to
  connections: {
    setupFor?: string[]; // What this might set up
    payoffOf?: string[]; // What this pays off
  };

  // Impact assessment
  removalImpact: {
    severity: 'critical' | 'moderate' | 'minor' | 'none';
    lostElements: string[];
  };
}

export interface DocumentChekhovAnalysis {
  documentId: string;
  sentences: ChekhovAnalysis[];
  summary: {
    essentialCount: number;
    supportingCount: number;
    atmosphericCount: number;
    dispensableCount: number;
    overallTightness: number; // 0-1: Higher = tighter narrative
    suggestions: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS PATTERNS
// ═══════════════════════════════════════════════════════════════════

// Patterns that suggest narrative setup (Chekhov's guns)
const SETUP_PATTERNS = [
  /\b(noticed|saw|glimpsed|spotted|observed)\b.*\b(strange|unusual|peculiar|odd)\b/i,
  /\b(there was|hung|sat|lay|stood)\b.*\b(on the|in the|by the)\b/i,
  /\b(always|never|used to|would often)\b/i,
  /\b(didn't know then|little did|would later)\b/i,
  /\bfor some reason\b/i,
  /\b(mentioned|said|told|warned)\b.*\b(about|that)\b/i,
];

// Patterns that suggest payoff
const PAYOFF_PATTERNS = [
  /\b(finally|at last|now)\b.*\b(understood|realized|knew)\b/i,
  /\b(remembered|recalled)\b.*\b(what|that|when)\b/i,
  /\b(the same|that very)\b/i,
  /\b(this was|it was)\b.*\b(moment|time|when)\b/i,
  /\bafter all\b/i,
];

// Patterns that suggest characterization
const CHARACTER_PATTERNS = [
  /\b(always|never|typically|usually)\b.*\b(would|did|was)\b/i,
  /\b(felt|thought|believed|knew|sensed)\b/i,
  /\bhis|her|their\b.*\b(way|habit|nature|tendency)\b/i,
  /\b(loved|hated|feared|admired)\b/i,
];

// Patterns that suggest worldbuilding
const WORLD_PATTERNS = [
  /\b(in this|here in|the local|the way things)\b/i,
  /\b(tradition|custom|law|rule|system)\b/i,
  /\b(the city|the town|the village|the world)\b/i,
  /\b(everyone|nobody|people here|they all)\b/i,
];

// Patterns that suggest atmosphere only
const ATMOSPHERE_PATTERNS = [
  /\b(sky|clouds|sun|moon|stars|wind|rain)\b/i,
  /\b(silence|quiet|stillness|darkness|light)\b/i,
  /\b(smell|scent|fragrance|sound|noise)\b/i,
  /\b(beautiful|lovely|peaceful|eerie|haunting)\b/i,
];

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine the narrative function of a sentence
 */
function determineFunction(sentence: string, context: string[]): ChekhovAnalysis['function'] {
  // Check for setup patterns
  for (const pattern of SETUP_PATTERNS) {
    if (pattern.test(sentence)) {
      return {
        type: 'setup',
        description: 'Introduces element that may pay off later',
      };
    }
  }

  // Check for payoff patterns
  for (const pattern of PAYOFF_PATTERNS) {
    if (pattern.test(sentence)) {
      return {
        type: 'payoff',
        description: 'Resolves or references earlier setup',
      };
    }
  }

  // Check for characterization
  for (const pattern of CHARACTER_PATTERNS) {
    if (pattern.test(sentence)) {
      return {
        type: 'characterization',
        description: 'Reveals character trait or inner state',
      };
    }
  }

  // Check for worldbuilding
  for (const pattern of WORLD_PATTERNS) {
    if (pattern.test(sentence)) {
      return {
        type: 'worldbuilding',
        description: 'Establishes setting or world rules',
      };
    }
  }

  // Check for atmosphere
  for (const pattern of ATMOSPHERE_PATTERNS) {
    if (pattern.test(sentence)) {
      return {
        type: 'atmosphere',
        description: 'Creates mood or sensory experience',
      };
    }
  }

  // Check for transition markers
  if (/\b(then|next|after|before|meanwhile|later|earlier)\b/i.test(sentence)) {
    return {
      type: 'transition',
      description: 'Connects scenes or time periods',
    };
  }

  return {
    type: 'unknown',
    description: 'Function not clearly determined',
  };
}

/**
 * Calculate necessity score for a sentence
 */
function calculateNecessity(
  sentence: string,
  functionType: ChekhovAnalysis['function']['type'],
  documentContext: string[]
): number {
  let score = 0.5; // Base score

  // Function-based scoring
  switch (functionType) {
    case 'setup':
      score += 0.3; // Setups are important
      break;
    case 'payoff':
      score += 0.35; // Payoffs are very important
      break;
    case 'characterization':
      score += 0.2;
      break;
    case 'worldbuilding':
      score += 0.15;
      break;
    case 'transition':
      score += 0.1;
      break;
    case 'atmosphere':
      score += 0.05;
      break;
    default:
      score -= 0.1;
  }

  // Content-based adjustments
  const words = sentence.split(/\s+/).length;

  // Dialogue is usually necessary
  if (/"[^"]*"/.test(sentence) || /'[^']*'/.test(sentence)) {
    score += 0.15;
  }

  // Action verbs suggest plot movement
  if (/\b(ran|jumped|grabbed|shouted|threw|pulled|pushed|opened|closed)\b/i.test(sentence)) {
    score += 0.1;
  }

  // Very short sentences often carry weight
  if (words < 6) {
    score += 0.1;
  }

  // Very long sentences might be overwritten
  if (words > 40) {
    score -= 0.1;
  }

  // Named characters suggest importance
  if (/[A-Z][a-z]+/.test(sentence) && !/^[A-Z]/.test(sentence)) {
    score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Categorize based on necessity score
 */
function categorize(necessity: number): ChekhovAnalysis['category'] {
  if (necessity >= 0.75) return 'essential';
  if (necessity >= 0.5) return 'supporting';
  if (necessity >= 0.3) return 'atmospheric';
  return 'dispensable';
}

/**
 * Assess removal impact
 */
function assessRemovalImpact(
  sentence: string,
  necessity: number,
  functionType: ChekhovAnalysis['function']['type']
): ChekhovAnalysis['removalImpact'] {
  const lostElements: string[] = [];

  if (functionType === 'setup') {
    lostElements.push('Future payoff becomes confusing');
  }
  if (functionType === 'payoff') {
    lostElements.push('Resolution of earlier setup');
  }
  if (functionType === 'characterization') {
    lostElements.push('Character depth');
  }
  if (functionType === 'worldbuilding') {
    lostElements.push('World coherence');
  }
  if (functionType === 'transition') {
    lostElements.push('Scene flow');
  }
  if (functionType === 'atmosphere') {
    lostElements.push('Mood/tone');
  }

  // Dialogue always has some impact
  if (/"[^"]*"/.test(sentence)) {
    lostElements.push('Character voice');
  }

  let severity: ChekhovAnalysis['removalImpact']['severity'];
  if (necessity >= 0.75) {
    severity = 'critical';
  } else if (necessity >= 0.5) {
    severity = 'moderate';
  } else if (necessity >= 0.3) {
    severity = 'minor';
  } else {
    severity = 'none';
  }

  return { severity, lostElements };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyze a single sentence for narrative necessity
 */
export function analyzeSentence(
  sentenceId: string,
  sentence: string,
  context: string[] = []
): ChekhovAnalysis {
  const func = determineFunction(sentence, context);
  const necessity = calculateNecessity(sentence, func.type, context);
  const category = categorize(necessity);
  const removalImpact = assessRemovalImpact(sentence, necessity, func.type);

  return {
    sentenceId,
    text: sentence,
    necessity,
    category,
    function: func,
    connections: {
      setupFor: func.type === 'setup' ? ['(potential future payoff)'] : undefined,
      payoffOf: func.type === 'payoff' ? ['(earlier setup)'] : undefined,
    },
    removalImpact,
  };
}

/**
 * Analyze an entire document for narrative tightness
 */
export function analyzeDocument(
  documentId: string,
  text: string
): DocumentChekhovAnalysis {
  // Split into sentences
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);

  // Analyze each sentence
  const analyses = sentences.map((sentence, i) => {
    const context = sentences.slice(Math.max(0, i - 3), i); // Previous 3 sentences
    return analyzeSentence(`${documentId}-s${i}`, sentence, context);
  });

  // Calculate summary
  const essentialCount = analyses.filter((a) => a.category === 'essential').length;
  const supportingCount = analyses.filter((a) => a.category === 'supporting').length;
  const atmosphericCount = analyses.filter((a) => a.category === 'atmospheric').length;
  const dispensableCount = analyses.filter((a) => a.category === 'dispensable').length;

  const totalCount = analyses.length || 1;
  const overallTightness = (essentialCount + supportingCount * 0.7) / totalCount;

  // Generate suggestions
  const suggestions: string[] = [];

  if (dispensableCount > totalCount * 0.2) {
    suggestions.push(`Consider removing ${dispensableCount} dispensable sentences for tighter prose.`);
  }

  if (atmosphericCount > totalCount * 0.3) {
    suggestions.push('High atmospheric content. Ensure mood serves the narrative purpose.');
  }

  const setupCount = analyses.filter((a) => a.function.type === 'setup').length;
  const payoffCount = analyses.filter((a) => a.function.type === 'payoff').length;

  if (setupCount > payoffCount * 2) {
    suggestions.push('Many setups without payoffs. Consider resolving introduced elements.');
  }

  if (overallTightness > 0.8) {
    suggestions.push('Excellent narrative tightness. Every sentence earns its place.');
  }

  return {
    documentId,
    sentences: analyses,
    summary: {
      essentialCount,
      supportingCount,
      atmosphericCount,
      dispensableCount,
      overallTightness,
      suggestions,
    },
  };
}

export default {
  analyzeSentence,
  analyzeDocument,
};
