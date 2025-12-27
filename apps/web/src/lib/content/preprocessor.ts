/**
 * Content Preprocessor
 *
 * Main pipeline for transforming raw archive content into display-ready format.
 *
 * Pipeline stages:
 * 1. Fix LaTeX delimiters (ChatGPT style → standard)
 * 2. Extract thinking blocks
 * 3. Unpack JSON artifacts
 * 4. Extract image prompts
 * 5. Extract embedded metadata
 */

import type { ContainerType } from '@humanizer/core';
import type { PreprocessResult, EmbeddedMetadata } from './types';
import { fixLatexDelimiters, hasLatexDelimiters } from './latex';
import { unpackJsonArtifacts, extractImagePrompts, hasArtifacts } from './artifacts';
import { extractThinkingBlocks, hasThinkingBlocks } from './thinking';

/**
 * Preprocessing options
 */
export interface PreprocessOptions {
  /** Fix LaTeX delimiters (default: true) */
  fixLatex?: boolean;

  /** Extract thinking blocks (default: true) */
  extractThinking?: boolean;

  /** Unpack JSON artifacts (default: true) */
  unpackArtifacts?: boolean;

  /** Extract image prompts (default: true) */
  extractImagePrompts?: boolean;

  /** Extract embedded metadata (default: true) */
  extractMetadata?: boolean;

  /** Strip thinking blocks instead of making collapsible (default: false) */
  stripThinking?: boolean;
}

const defaultOptions: PreprocessOptions = {
  fixLatex: true,
  extractThinking: true,
  unpackArtifacts: true,
  extractImagePrompts: true,
  extractMetadata: true,
  stripThinking: false,
};

/**
 * Create initial preprocess result
 */
function createInitialResult(content: string): PreprocessResult {
  return {
    content,
    artifacts: [],
    math: [],
    thinking: [],
    metadata: {},
    stats: {
      originalLength: content.length,
      processedLength: content.length,
      latexConversions: 0,
      artifactsExtracted: 0,
      thinkingBlocksExtracted: 0,
    },
  };
}

/**
 * Extract embedded metadata from content
 *
 * Looks for patterns like:
 * - YAML frontmatter (---\n...\n---)
 * - JSON metadata blocks
 * - Key: value pairs at document start
 */
function extractEmbeddedMetadata(input: PreprocessResult): PreprocessResult {
  let content = input.content;
  const metadata: EmbeddedMetadata = { ...input.metadata };

  // Check for YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (yamlMatch) {
    const yamlContent = yamlMatch[1];

    // Parse simple key: value pairs
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const kvMatch = line.match(/^([^:]+):\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        let value: string | number | boolean = kvMatch[2].trim();

        // Try to parse numbers and booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^-?\d+(\.\d+)?$/.test(value)) value = parseFloat(value);

        metadata[key] = value;
      }
    }

    // Remove frontmatter from content
    content = content.slice(yamlMatch[0].length);
  }

  return {
    ...input,
    content,
    metadata,
    stats: {
      ...input.stats,
      processedLength: content.length,
    },
  };
}

/**
 * Preprocess content for display
 *
 * @param raw - Raw content string
 * @param type - Container type (for type-specific processing)
 * @param options - Processing options
 * @returns Preprocessed result
 */
export async function preprocessContent(
  raw: string,
  type?: ContainerType,
  options: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const opts = { ...defaultOptions, ...options };

  // Start with the raw content
  let result = createInitialResult(raw);

  // Skip processing for non-text types
  if (type === 'media') {
    return result;
  }

  // Stage 1: Fix LaTeX delimiters
  if (opts.fixLatex && hasLatexDelimiters(raw)) {
    result = fixLatexDelimiters(result);
  }

  // Stage 2: Extract thinking blocks
  if (opts.extractThinking && hasThinkingBlocks(result.content)) {
    result = extractThinkingBlocks(result);
  }

  // Stage 3: Unpack JSON artifacts
  if (opts.unpackArtifacts && hasArtifacts(result.content)) {
    result = unpackJsonArtifacts(result);
  }

  // Stage 4: Extract image prompts
  if (opts.extractImagePrompts) {
    result = extractImagePrompts(result);
  }

  // Stage 5: Extract embedded metadata
  if (opts.extractMetadata) {
    result = extractEmbeddedMetadata(result);
  }

  // Update final stats
  result.stats.processedLength = result.content.length;

  return result;
}

/**
 * Synchronous version for simple cases
 */
export function preprocessContentSync(
  raw: string,
  type?: ContainerType,
  options: PreprocessOptions = {}
): PreprocessResult {
  const opts = { ...defaultOptions, ...options };
  let result = createInitialResult(raw);

  if (type === 'media') {
    return result;
  }

  if (opts.fixLatex && hasLatexDelimiters(raw)) {
    result = fixLatexDelimiters(result);
  }

  if (opts.extractThinking && hasThinkingBlocks(result.content)) {
    result = extractThinkingBlocks(result);
  }

  if (opts.unpackArtifacts && hasArtifacts(result.content)) {
    result = unpackJsonArtifacts(result);
  }

  if (opts.extractImagePrompts) {
    result = extractImagePrompts(result);
  }

  if (opts.extractMetadata) {
    result = extractEmbeddedMetadata(result);
  }

  result.stats.processedLength = result.content.length;

  return result;
}

/**
 * Quick check if content needs preprocessing
 */
export function needsPreprocessing(content: string): boolean {
  return (
    hasLatexDelimiters(content) ||
    hasThinkingBlocks(content) ||
    hasArtifacts(content)
  );
}

/**
 * Get a summary of what preprocessing would do
 */
export function analyzeContent(content: string): {
  hasLatex: boolean;
  hasThinking: boolean;
  hasArtifacts: boolean;
  needsProcessing: boolean;
} {
  return {
    hasLatex: hasLatexDelimiters(content),
    hasThinking: hasThinkingBlocks(content),
    hasArtifacts: hasArtifacts(content),
    needsProcessing: needsPreprocessing(content),
  };
}
