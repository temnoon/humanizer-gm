/**
 * Profile Extraction Types
 *
 * Types for NPE-API persona/style extraction endpoints.
 */

// ═══════════════════════════════════════════════════════════════════
// PERSONA EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Request to extract a persona from text
 */
export interface ExtractPersonaRequest {
  /** Text to extract persona from (50-20000 characters) */
  text: string;
  /** Optional book title for attribution */
  bookTitle?: string;
  /** Optional author name */
  author?: string;
  /** Optional chapter reference */
  chapter?: string;
  /** Custom name for the persona */
  customName?: string;
}

/**
 * Extracted persona attributes from NPE-API
 */
export interface ExtractedPersonaAttributes {
  /** Point of view (e.g., "first-person introspective") */
  perspective?: string;
  /** Emotional register (e.g., "contemplative, earnest") */
  tone?: string;
  /** Mode of expression (e.g., "expository", "narrative") */
  rhetoricalMode?: string;
  /** Characteristic patterns identified */
  characteristicPatterns?: string[];
  /** Voice register (formal/casual/etc) */
  register?: string;
}

/**
 * Response from extract-persona endpoint
 */
export interface ExtractPersonaResponse {
  /** Database ID if saved */
  persona_id?: number;
  /** Generated persona name */
  name: string;
  /** Description of the persona */
  description: string;
  /** System prompt for using the persona */
  system_prompt: string;
  /** Extracted attributes */
  attributes: ExtractedPersonaAttributes;
  /** Example patterns from the text */
  example_patterns: string[];
  /** Source information */
  source_info: {
    bookTitle?: string;
    author?: string;
    chapter?: string;
    wordCount: number;
  };
  /** Unique extraction ID */
  extraction_id: string;
  /** Processing time in ms */
  processing_time_ms: number;
}

// ═══════════════════════════════════════════════════════════════════
// STYLE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Request to extract a style from text
 */
export interface ExtractStyleRequest {
  /** Text to extract style from (50-20000 characters) */
  text: string;
  /** Optional book title for attribution */
  bookTitle?: string;
  /** Optional author name */
  author?: string;
  /** Optional chapter reference */
  chapter?: string;
  /** Custom name for the style */
  customName?: string;
}

/**
 * Extracted style attributes from NPE-API
 */
export interface ExtractedStyleAttributes {
  /** Sentence structure patterns */
  sentenceStructure?: string;
  /** Vocabulary characteristics */
  vocabulary?: string;
  /** Rhythm and pacing */
  rhythm?: string;
  /** Punctuation style */
  punctuationStyle?: string;
  /** Identified rhetorical devices */
  rhetoricalDevices?: string[];
  /** Formality level (1-10) */
  formalityScore?: number;
  /** Complexity level (1-10) */
  complexityScore?: number;
  /** Average sentence length */
  avgSentenceLength?: number;
}

/**
 * Response from extract-style endpoint
 */
export interface ExtractStyleResponse {
  /** Database ID if saved */
  style_id?: number;
  /** Generated style name */
  name: string;
  /** Style prompt for applying the style */
  style_prompt: string;
  /** Extracted attributes */
  attributes: ExtractedStyleAttributes;
  /** Example sentences from the text */
  example_sentences: string[];
  /** Source information */
  source_info: {
    bookTitle?: string;
    author?: string;
    chapter?: string;
    wordCount: number;
  };
  /** Unique extraction ID */
  extraction_id: string;
  /** Processing time in ms */
  processing_time_ms: number;
}

// ═══════════════════════════════════════════════════════════════════
// VOICE DISCOVERY
// ═══════════════════════════════════════════════════════════════════

/**
 * Request to discover voices from writing samples
 */
export interface DiscoverVoicesRequest {
  /** Minimum clusters to find */
  min_clusters?: number;
  /** Maximum clusters to find */
  max_clusters?: number;
}

/**
 * Discovered persona from clustering
 */
export interface DiscoveredPersona {
  id: number;
  user_id: string;
  name: string;
  description?: string;
  auto_discovered: boolean;
  embedding_signature?: number[];
  example_texts?: string[];
  custom_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Discovered style from clustering
 */
export interface DiscoveredStyle {
  id: number;
  user_id: string;
  name: string;
  description?: string;
  auto_discovered: boolean;
  formality_score?: number;
  complexity_score?: number;
  avg_sentence_length?: number;
  vocab_diversity?: number;
  tone_markers?: string[];
  example_texts?: string[];
  custom_metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Response from discover-voices endpoint
 */
export interface DiscoverVoicesResponse {
  /** Number of personas discovered */
  personas_discovered: number;
  /** Number of styles discovered */
  styles_discovered: number;
  /** The discovered personas */
  personas: DiscoveredPersona[];
  /** The discovered styles */
  styles: DiscoveredStyle[];
  /** Total words analyzed */
  total_words_analyzed: number;
}

// ═══════════════════════════════════════════════════════════════════
// BOOK PROFILE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Request to extract a full book profile
 */
export interface ExtractBookProfileRequest {
  /** Text content from the book */
  text: string;
  /** Book title */
  bookTitle: string;
  /** Author name */
  author?: string;
  /** Extract persona? */
  extractPersona?: boolean;
  /** Extract style? */
  extractStyle?: boolean;
  /** Extract themes? */
  extractThemes?: boolean;
}

/**
 * Extracted themes from book content
 */
export interface ExtractedThemes {
  /** Core themes identified */
  themes: string[];
  /** Key characters or entities */
  characters?: string[];
  /** Narrative arc description */
  arc?: string;
  /** Central thesis if applicable */
  thesis?: string;
  /** Overall mood */
  mood?: string;
}

/**
 * Combined book profile extraction result
 */
export interface BookProfileExtractionResult {
  /** Extracted persona (if requested) */
  persona?: ExtractPersonaResponse;
  /** Extracted style (if requested) */
  style?: ExtractStyleResponse;
  /** Extracted themes (if requested) */
  themes?: ExtractedThemes;
  /** Total processing time */
  totalProcessingTimeMs: number;
}
