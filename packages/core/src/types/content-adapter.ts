/**
 * ContentAdapter - Interface for format-specific import
 *
 * New formats ONLY require implementing this interface.
 * No database changes, no new tables.
 *
 * Each adapter normalizes its source format into ContentNode objects.
 */

import type { ContentNode, ContentLink, SourceType } from './content-graph.js';

/**
 * Options passed to adapter during parsing
 */
export interface AdapterOptions {
  /** Import batch ID */
  batchId?: string;

  /** Preserve original IDs from source */
  preserveIds?: boolean;

  /** Enable automatic link detection */
  linkDetection?: boolean;

  /** Base path for relative references */
  basePath?: string;

  /** Additional adapter-specific options */
  [key: string]: unknown;
}

/**
 * Result of detecting if an adapter can handle input
 */
export interface DetectionResult {
  /** Whether this adapter can handle the input */
  canHandle: boolean;

  /** Confidence score (0-1) */
  confidence: number;

  /** Detected format details */
  details?: {
    /** Detected source type */
    sourceType?: SourceType;
    /** Estimated item count */
    estimatedCount?: number;
    /** Format version if detectable */
    formatVersion?: string;
    /** Any warnings about the format */
    warnings?: string[];
  };
}

/**
 * Parse result containing nodes and their links
 */
export interface ParseResult {
  /** Parsed content nodes */
  nodes: ContentNode[];

  /** Detected/extracted links between nodes */
  links: ContentLink[];

  /** Any errors encountered during parsing */
  errors: ParseError[];

  /** Parse statistics */
  stats: {
    /** Total items found */
    totalItems: number;
    /** Successfully parsed items */
    parsedItems: number;
    /** Skipped items */
    skippedItems: number;
    /** Total words across all nodes */
    totalWords: number;
    /** Time taken to parse (ms) */
    parseTime: number;
  };
}

/**
 * Error encountered during parsing
 */
export interface ParseError {
  /** Error type */
  type: 'validation' | 'format' | 'encoding' | 'unknown';

  /** Human-readable message */
  message: string;

  /** Location in source (if applicable) */
  location?: {
    /** Line number */
    line?: number;
    /** Column number */
    column?: number;
    /** Item index */
    index?: number;
    /** Item identifier */
    itemId?: string;
  };

  /** Original error */
  cause?: Error;
}

/**
 * ContentAdapter - Interface for format-specific import
 *
 * Implement this interface to add support for a new format.
 * The adapter transforms source data into universal ContentNode objects.
 */
export interface ContentAdapter<TInput = unknown> {
  // === IDENTITY ===

  /** Unique adapter identifier (e.g., 'chatgpt', 'facebook', 'markdown') */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Source type this adapter produces */
  readonly sourceType: SourceType;

  /** Supported file extensions or MIME types */
  readonly supportedFormats: string[];

  /** Adapter version */
  readonly version: string;

  // === DETECTION ===

  /**
   * Detect if this adapter can handle the given input
   *
   * @param input - The input to check (file path, raw data, etc.)
   * @returns Detection result with confidence score
   */
  detect(input: TInput): Promise<DetectionResult> | DetectionResult;

  // === PARSING ===

  /**
   * Parse the input into ContentNode objects
   *
   * Can return either:
   * - An AsyncIterable for streaming large files
   * - A ParseResult for batch processing
   *
   * @param input - The input to parse
   * @param options - Parsing options
   */
  parse(
    input: TInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> | Promise<ParseResult>;

  // === OPTIONAL: RENDERING ===

  /**
   * Render a ContentNode back to the original format
   *
   * @param node - The node to render
   * @returns Rendered content in original format
   */
  render?(node: ContentNode): string;

  // === OPTIONAL: LINK EXTRACTION ===

  /**
   * Extract links from a ContentNode
   *
   * Called after parsing to detect relationships between nodes.
   *
   * @param node - The node to extract links from
   * @param allNodes - All nodes parsed so far (for cross-references)
   * @returns Detected links
   */
  extractLinks?(node: ContentNode, allNodes?: ContentNode[]): ContentLink[];

  // === OPTIONAL: VALIDATION ===

  /**
   * Validate input before parsing
   *
   * @param input - The input to validate
   * @returns Array of validation errors (empty if valid)
   */
  validate?(input: TInput): Promise<ParseError[]> | ParseError[];
}

/**
 * Adapter factory function type
 */
export type AdapterFactory<TInput = unknown> = () => ContentAdapter<TInput>;

/**
 * Adapter metadata for registration
 */
export interface AdapterMetadata {
  /** Adapter ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Source type */
  sourceType: SourceType;

  /** Supported formats */
  supportedFormats: string[];

  /** Version */
  version: string;

  /** Whether this is a built-in adapter */
  builtin: boolean;

  /** Priority for auto-detection (higher = checked first) */
  priority: number;
}

/**
 * Base class for implementing adapters
 *
 * Provides common utilities and default implementations.
 */
export abstract class BaseContentAdapter<TInput = unknown> implements ContentAdapter<TInput> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly sourceType: SourceType;
  abstract readonly supportedFormats: string[];
  abstract readonly version: string;

  abstract detect(input: TInput): Promise<DetectionResult> | DetectionResult;
  abstract parse(
    input: TInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> | Promise<ParseResult>;

  /**
   * Default validation (no errors)
   */
  validate(_input: TInput): ParseError[] {
    return [];
  }

  /**
   * Check if a file extension is supported
   */
  protected isExtensionSupported(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return this.supportedFormats.some(
      f => f.toLowerCase() === `.${ext}` || f.toLowerCase() === ext
    );
  }

  /**
   * Check if a MIME type is supported
   */
  protected isMimeTypeSupported(mimeType: string): boolean {
    return this.supportedFormats.some(
      f => f.toLowerCase() === mimeType.toLowerCase()
    );
  }

  /**
   * Generate a URI for this adapter's content
   */
  protected generateUri(path: string): string {
    return `content://${this.sourceType}/${path}`;
  }

  /**
   * Count words in text
   */
  protected countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Strip common markup from text
   */
  protected stripMarkup(text: string): string {
    // Basic HTML/Markdown stripping
    return text
      .replace(/<[^>]+>/g, '')           // HTML tags
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Markdown links
      .replace(/[*_~`#]+/g, '')          // Markdown formatting
      .replace(/\n{3,}/g, '\n\n')        // Excessive newlines
      .trim();
  }
}
