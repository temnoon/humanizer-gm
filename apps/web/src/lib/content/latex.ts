/**
 * LaTeX Delimiter Conversion
 *
 * ChatGPT uses \(...\) for inline and \[...\] for display math.
 * remarkMath expects $...$ for inline and $$...$$ for display.
 *
 * This module handles the conversion.
 */

import type { PreprocessResult, MathBlock } from './types';

/**
 * Convert ChatGPT-style LaTeX delimiters to standard $ delimiters
 *
 * Converts:
 * - \[...\] → $$...$$  (display math)
 * - \(...\) → $...$    (inline math)
 *
 * Also handles edge cases:
 * - Escaped backslashes (\\[ should not convert)
 * - Nested delimiters
 * - Unbalanced delimiters
 */
export function fixLatexDelimiters(input: PreprocessResult): PreprocessResult {
  let content = input.content;
  const math: MathBlock[] = [...input.math];
  let conversions = 0;

  // Track positions for math blocks
  let mathIdCounter = 0;

  // First pass: Find and convert display math \[...\]
  // Use a regex that matches \[ not preceded by another backslash
  content = content.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (match, latex, offset) => {
    conversions++;
    math.push({
      id: `math-display-${mathIdCounter++}`,
      display: true,
      latex: latex.trim(),
      offset,
      length: match.length,
    });
    return `$$${latex}$$`;
  });

  // Second pass: Find and convert inline math \(...\)
  content = content.replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (match, latex, offset) => {
    conversions++;
    math.push({
      id: `math-inline-${mathIdCounter++}`,
      display: false,
      latex: latex.trim(),
      offset,
      length: match.length,
    });
    return `$${latex}$`;
  });

  return {
    ...input,
    content,
    math,
    stats: {
      ...input.stats,
      latexConversions: input.stats.latexConversions + conversions,
    },
  };
}

/**
 * Check if content contains ChatGPT-style LaTeX delimiters
 */
export function hasLatexDelimiters(content: string): boolean {
  return /(?<!\\)\\\[|(?<!\\)\\\]|(?<!\\)\\\(|(?<!\\)\\\)/.test(content);
}

/**
 * Extract all LaTeX blocks from content (both delimeter styles)
 */
export function extractLatexBlocks(content: string): MathBlock[] {
  const blocks: MathBlock[] = [];
  let id = 0;

  // Display math: $$...$$ or \[...\]
  const displayRegex = /(?:\$\$([\s\S]*?)\$\$|(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\])/g;
  let match: RegExpExecArray | null;

  while ((match = displayRegex.exec(content)) !== null) {
    const latex = match[1] || match[2];
    blocks.push({
      id: `math-${id++}`,
      display: true,
      latex: latex.trim(),
      offset: match.index,
      length: match[0].length,
    });
  }

  // Inline math: $...$ or \(...\)
  // Avoid matching $$ by using negative lookbehind/lookahead
  const inlineRegex = /(?:(?<!\$)\$(?!\$)([\s\S]*?)(?<!\$)\$(?!\$)|(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\))/g;

  while ((match = inlineRegex.exec(content)) !== null) {
    const latex = match[1] || match[2];
    // Skip if it looks like a currency value
    if (/^\d/.test(latex)) continue;

    blocks.push({
      id: `math-${id++}`,
      display: false,
      latex: latex.trim(),
      offset: match.index,
      length: match[0].length,
    });
  }

  return blocks;
}
