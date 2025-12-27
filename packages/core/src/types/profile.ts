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
