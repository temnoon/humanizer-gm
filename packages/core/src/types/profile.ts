/**
 * Profile Types - Persona, Style, and Book Profile
 *
 * These types define HOW content is written:
 * - Persona: WHO writes (voice, vocabulary, influences)
 * - Style: HOW they write (structure, formality, devices)
 * - BookProfile: "Knowing" a book (themes, philosophy, tone)
 */

import type { EntityMeta, EntityURI, SourceReference } from './entity.js';

// ═══════════════════════════════════════════════════════════════════
// PERSONA - WHO Perceives and Writes
// ═══════════════════════════════════════════════════════════════════

/**
 * A Persona is a voice/character that can be used across books and transformations.
 * Derived from source material, it captures the WHO of writing.
 */
export interface Persona extends EntityMeta {
  type: 'persona';

  /**
   * Voice characteristics for this persona
   */
  voice: {
    /** First-person characterization: "I am..." */
    selfDescription: string;

    /** Writing style tendencies */
    styleNotes: string[];

    /** Typical sentence patterns */
    syntaxPatterns?: string[];

    /** Register: formal, casual, academic, poetic, conversational */
    register: VoiceRegister;

    /** Emotional range: reserved, expressive, neutral */
    emotionalRange: EmotionalRange;
  };

  /**
   * NPE-API extracted attributes (populated by ProfileExtractionService)
   */
  extracted?: {
    /** Point of view */
    perspective?: string;

    /** Emotional register */
    tone?: string;

    /** Expository, narrative, argumentative, etc. */
    rhetoricalMode?: string;

    /** Characteristic patterns found in the text */
    characteristicPatterns?: string[];

    /** When this extraction was performed */
    extractedAt?: number;

    /** Source text used for extraction */
    sourceWordCount?: number;
  };

  /**
   * Vocabulary profile
   */
  vocabulary: {
    /** Words/phrases this persona prefers */
    preferred: string[];

    /** Words/phrases to avoid */
    avoided: string[];

    /** Domain-specific terminology */
    domainTerms?: string[];
  };

  /**
   * Influences (other authors, styles, traditions)
   */
  influences: {
    name: string;
    weight: number; // 0-1
    notes?: string;
  }[];

  /**
   * Example passages that exemplify this voice
   */
  exemplars: {
    text: string;
    sourceRef?: EntityURI;
    notes?: string;
  }[];

  /**
   * Sources this persona was derived from
   */
  derivedFrom: SourceReference[];

  /**
   * System prompt for LLM transformations using this persona
   */
  systemPrompt?: string;
}

export type VoiceRegister =
  | 'formal'
  | 'casual'
  | 'academic'
  | 'poetic'
  | 'conversational'
  | 'technical';

export type EmotionalRange = 'reserved' | 'expressive' | 'neutral';

// ═══════════════════════════════════════════════════════════════════
// STYLE - HOW They Write
// ═══════════════════════════════════════════════════════════════════

/**
 * A Style defines HOW to write (distinct from WHO is writing).
 * Can be combined with Personas for voice + structure.
 */
export interface Style extends EntityMeta {
  type: 'style';

  /**
   * Style characteristics
   */
  characteristics: {
    /** Formality level 1-10 */
    formality: number;

    /** Abstraction level */
    abstractionLevel: AbstractionLevel;

    /** Sentence complexity preference */
    complexity: Complexity;

    /** Metaphor usage density */
    metaphorDensity: Density;
  };

  /**
   * Structural patterns
   */
  structure: {
    /** Preferred paragraph length */
    paragraphLength: 'short' | 'medium' | 'long' | 'varied';

    /** Uses lists/bullets */
    usesLists: boolean;

    /** Uses section headers */
    usesHeaders: boolean;

    /** Uses blockquotes/epigraphs */
    usesEpigraphs: boolean;
  };

  /**
   * NPE-API extracted attributes (populated by ProfileExtractionService)
   */
  extracted?: {
    /** Sentence structure analysis */
    sentenceStructure?: string;

    /** Vocabulary analysis */
    vocabulary?: string;

    /** Rhythm analysis */
    rhythm?: string;

    /** Punctuation style */
    punctuationStyle?: string;

    /** Rhetorical devices found */
    rhetoricalDevices?: string[];

    /** When this extraction was performed */
    extractedAt?: number;

    /** Source text used for extraction */
    sourceWordCount?: number;
  };

  /**
   * Style prompt for LLM transformations
   */
  stylePrompt: string;

  /**
   * Example sentences that exemplify this style
   */
  exampleSentences?: string[];

  /**
   * Sources this style was derived from
   */
  derivedFrom: SourceReference[];
}

export type AbstractionLevel = 'grounded' | 'abstract' | 'technical' | 'mixed';
export type Complexity = 'simple' | 'moderate' | 'complex' | 'varied';
export type Density = 'sparse' | 'moderate' | 'rich';

// ═══════════════════════════════════════════════════════════════════
// BOOK PROFILE - "Knowing" a Book
// ═══════════════════════════════════════════════════════════════════

/**
 * A BookProfile represents the curator's "knowing" of a book.
 * Built from pyramid summarization and extraction.
 */
export interface BookProfile {
  /**
   * Pyramid apex summary - the distilled essence
   */
  apex: {
    /** Top-level synthesis (1-2 paragraphs) */
    summary: string;

    /** Core themes extracted */
    themes: string[];

    /** Key characters/entities */
    characters?: string[];

    /** Narrative arc description */
    arc?: string;
  };

  /**
   * Philosophy/worldview of the book
   */
  philosophy?: {
    /** Key positions taken */
    stances: string[];

    /** Underlying assumptions */
    assumptions: string[];

    /** Intellectual influences detected */
    influences: string[];
  };

  /**
   * Tone and affect
   */
  tone: {
    /** Overall tone (e.g., "contemplative and earnest") */
    overall: string;

    /** Register (e.g., "academic but accessible") */
    register: string;

    /** How emotion changes through the work */
    emotionalArc?: string;
  };

  /**
   * Setting and world
   */
  setting?: {
    /** Where/when the book takes place */
    context: string;

    /** World rules and constraints */
    constraints: string[];
  };

  /**
   * Statistics about the profile extraction
   */
  stats: {
    /** Depth of pyramid (number of levels) */
    pyramidDepth: number;

    /** Total chunks at L0 */
    totalChunks: number;

    /** Compression ratio achieved */
    compressionRatio: number;

    /** When profile was last updated */
    lastUpdated: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// CURATOR PERSONA - Global User Assistant
// ═══════════════════════════════════════════════════════════════════

/**
 * A CuratorPersona is the global assistant for a user/member.
 *
 * Unlike node-specific curators, this is the user's primary assistant
 * with persistent memory of their setup, preferences, and best practices.
 *
 * Architecture:
 * - Canonic text: Identity-building passages (WHO the curator is)
 * - Worldview text: Knowledge base (WHAT the curator knows)
 * - Memory: Persistent record of interactions and learned preferences
 *
 * This is the first "node assistant" - the pattern will inform future
 * specialized node agents (book curators, collection curators, etc.)
 */
export interface CuratorPersona extends EntityMeta {
  type: 'curator-persona';

  /**
   * Canonic text - defines WHO the curator is
   * High-commitment passages that form the curator's identity/voice
   */
  canonic: {
    /** References to identity-building passages */
    passageRefs: EntityURI[];

    /** Extracted voice characteristics from canonic text */
    voice?: Persona;

    /** System prompt built from canonic passages */
    systemPrompt: string;

    /** Minimum commitment score for canonic passages (default 0.7) */
    commitmentThreshold: number;

    /** Key phrases that define curator's stance */
    coreStances: string[];
  };

  /**
   * Worldview text - knowledge the curator can draw from
   * Not identity-defining, but informative context
   */
  worldview: {
    /** References to knowledge-base passages */
    passageRefs: EntityURI[];

    /** Main themes for embedding anchor filtering */
    embeddingAnchors: string[];

    /** Topic domains the curator has knowledge in */
    domains: string[];

    /** How flexibly to apply this knowledge (0-1) */
    flexibility: number;
  };

  /**
   * Persistent memory - learned preferences and practices
   * This is what makes the assistant truly personal over time
   */
  memory: {
    /** Best practices discovered through use */
    bestPractices: CuratorBestPractice[];

    /** User preferences learned over time */
    preferences: CuratorPreference[];

    /** Significant interactions worth remembering */
    significantMoments: CuratorMoment[];

    /** Topics the user returns to frequently */
    recurringThemes: string[];

    /** When memory was last consolidated */
    lastConsolidatedAt: number;
  };

  /**
   * Appearance and presentation
   */
  appearance: {
    /** Display name (e.g., "Guide", "Curator", custom name) */
    displayName: string;

    /** Short description shown in UI */
    tagline?: string;

    /** Icon identifier */
    icon: 'question' | 'curator' | 'assistant' | 'guide' | 'custom';

    /** Custom icon URL if icon is 'custom' */
    customIconUrl?: string;

    /** Position in UI */
    position: 'corner' | 'sidebar' | 'floating';
  };

  /**
   * Operational state
   */
  state: {
    /** Is the curator currently active? */
    isActive: boolean;

    /** When this persona was last used */
    lastActiveAt: number;

    /** When this persona was last trained/updated */
    lastTrainedAt: number;

    /** Number of interactions since creation */
    interactionCount: number;
  };
}

/**
 * A best practice learned through use
 */
export interface CuratorBestPractice {
  /** Unique identifier */
  id: string;

  /** What the practice is */
  practice: string;

  /** Context in which it applies */
  context: string;

  /** When this was discovered */
  discoveredAt: number;

  /** How often this has been useful (reinforcement count) */
  reinforcementCount: number;

  /** Source interaction that led to this practice */
  sourceInteraction?: string;
}

/**
 * A user preference learned over time
 */
export interface CuratorPreference {
  /** Preference category */
  category: 'workflow' | 'style' | 'content' | 'interaction' | 'other';

  /** The preference key */
  key: string;

  /** The preference value */
  value: string;

  /** Confidence in this preference (0-1, based on consistency) */
  confidence: number;

  /** When this was last observed */
  lastObservedAt: number;
}

/**
 * A significant moment worth remembering
 */
export interface CuratorMoment {
  /** When this occurred */
  timestamp: number;

  /** Brief description */
  summary: string;

  /** Why this was significant */
  significance: string;

  /** Related passage refs if any */
  relatedPassages?: EntityURI[];

  /** Tags for retrieval */
  tags: string[];
}

/**
 * Factory for creating a default CuratorPersona
 */
export function createDefaultCuratorPersona(
  uri: EntityURI,
  displayName = 'Guide'
): CuratorPersona {
  const now = Date.now();
  const id = `curator_${now}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    type: 'curator-persona',
    id,
    uri,
    name: displayName,
    tags: ['curator', 'global-assistant'],
    createdAt: now,
    updatedAt: now,

    canonic: {
      passageRefs: [],
      systemPrompt: `You are ${displayName}, a thoughtful assistant helping the user explore and curate their personal archives. You synthesize rather than lecture. You understand rather than viralize. You help the user become smarter about themselves.`,
      commitmentThreshold: 0.7,
      coreStances: [],
    },

    worldview: {
      passageRefs: [],
      embeddingAnchors: [],
      domains: [],
      flexibility: 0.8,
    },

    memory: {
      bestPractices: [],
      preferences: [],
      significantMoments: [],
      recurringThemes: [],
      lastConsolidatedAt: now,
    },

    appearance: {
      displayName,
      icon: 'guide',
      position: 'corner',
    },

    state: {
      isActive: true,
      lastActiveAt: now,
      lastTrainedAt: now,
      interactionCount: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════

/**
 * Type guard for Persona
 */
export function isPersona(entity: unknown): entity is Persona {
  return (
    typeof entity === 'object' &&
    entity !== null &&
    (entity as Persona).type === 'persona'
  );
}

/**
 * Type guard for Style
 */
export function isStyle(entity: unknown): entity is Style {
  return (
    typeof entity === 'object' &&
    entity !== null &&
    (entity as Style).type === 'style'
  );
}

/**
 * Type guard for CuratorPersona
 */
export function isCuratorPersona(entity: unknown): entity is CuratorPersona {
  return (
    typeof entity === 'object' &&
    entity !== null &&
    (entity as CuratorPersona).type === 'curator-persona'
  );
}
