/**
 * Content Preprocessing Types
 *
 * Types for the content preprocessing pipeline that transforms
 * raw archive content into display-ready format.
 */

/**
 * Extracted artifact from content
 */
export interface Artifact {
  /** Unique ID for this artifact */
  id: string;

  /** Type of artifact */
  type: 'code' | 'canvas' | 'artifact' | 'image-prompt' | 'json' | 'thinking';

  /** Title from the artifact metadata */
  title: string;

  /** The actual content */
  content: string;

  /** Language for code blocks */
  language?: string;

  /** Original position in content (character offset) */
  offset: number;

  /** Length in original content */
  length: number;

  /** Placeholder text used in preprocessed content */
  placeholder: string;

  /** Original metadata from the artifact */
  metadata?: Record<string, unknown>;
}

/**
 * Extracted math block
 */
export interface MathBlock {
  /** Unique ID */
  id: string;

  /** Display or inline */
  display: boolean;

  /** The LaTeX content */
  latex: string;

  /** Position in content */
  offset: number;

  /** Length in original */
  length: number;
}

/**
 * Extracted thinking block
 */
export interface ThinkingBlock {
  /** Unique ID */
  id: string;

  /** The thinking content */
  content: string;

  /** Position in content */
  offset: number;

  /** Length in original */
  length: number;

  /** Placeholder text */
  placeholder: string;
}

/**
 * Embedded metadata extracted from content
 */
export interface EmbeddedMetadata {
  /** Key-value pairs */
  [key: string]: unknown;
}

/**
 * Result of preprocessing a piece of content
 */
export interface PreprocessResult {
  /** Cleaned content ready for display */
  content: string;

  /** Extracted artifacts */
  artifacts: Artifact[];

  /** Extracted math blocks (for reference, already converted inline) */
  math: MathBlock[];

  /** Extracted thinking blocks */
  thinking: ThinkingBlock[];

  /** Embedded metadata found */
  metadata: EmbeddedMetadata;

  /** Processing stats */
  stats: {
    /** Original character count */
    originalLength: number;
    /** Processed character count */
    processedLength: number;
    /** Number of LaTeX conversions */
    latexConversions: number;
    /** Number of artifacts extracted */
    artifactsExtracted: number;
    /** Number of thinking blocks extracted */
    thinkingBlocksExtracted: number;
  };
}
