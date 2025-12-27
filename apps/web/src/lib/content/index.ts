/**
 * Content Preprocessing Module
 *
 * Transforms raw archive content into display-ready format.
 *
 * Features:
 * - LaTeX delimiter conversion (ChatGPT → standard)
 * - Artifact extraction (code, canvas, prompts)
 * - Thinking block extraction
 * - Metadata extraction (YAML frontmatter)
 *
 * Usage:
 * ```typescript
 * import { preprocessContent, needsPreprocessing } from './lib/content';
 *
 * if (needsPreprocessing(rawContent)) {
 *   const result = await preprocessContent(rawContent, 'message');
 *   console.log(result.content);  // Processed content
 *   console.log(result.artifacts); // Extracted artifacts
 * }
 * ```
 */

// Main preprocessor
export {
  preprocessContent,
  preprocessContentSync,
  needsPreprocessing,
  analyzeContent,
  type PreprocessOptions,
} from './preprocessor';

// Types
export type {
  PreprocessResult,
  Artifact,
  MathBlock,
  ThinkingBlock,
  EmbeddedMetadata,
} from './types';

// Individual processors (for direct use)
export { fixLatexDelimiters, hasLatexDelimiters, extractLatexBlocks } from './latex';
export { unpackJsonArtifacts, extractImagePrompts, hasArtifacts } from './artifacts';
export {
  extractThinkingBlocks,
  stripThinkingBlocks,
  hasThinkingBlocks,
  formatThinkingBlock,
} from './thinking';

// Sanitization & JSON extraction
export {
  sanitizeHtml,
  sanitizeMarkdown,
  escapeHtml,
  hasUnsafeContent,
} from './sanitize';

export {
  extractContent,
  processContent,
  looksLikeStructuredContent,
  type ExtractedContent,
} from './extractors';
