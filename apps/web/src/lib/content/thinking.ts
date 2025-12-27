/**
 * Thinking Block Extraction
 *
 * Extracts reasoning/thinking blocks from AI responses:
 * - <thinking>...</thinking> (Claude)
 * - <antThinking>...</antThinking> (Anthropic artifacts)
 * - <reasoning>...</reasoning> (Generic)
 */

import type { PreprocessResult, ThinkingBlock } from './types';

let thinkingIdCounter = 0;

/**
 * Generate a unique thinking block ID
 */
function generateThinkingId(): string {
  return `thinking-${Date.now()}-${thinkingIdCounter++}`;
}

/**
 * Extract thinking blocks from content
 *
 * Thinking blocks are often hidden in AI responses.
 * We extract them and render as collapsible sections.
 */
export function extractThinkingBlocks(input: PreprocessResult): PreprocessResult {
  let content = input.content;
  const thinking: ThinkingBlock[] = [...input.thinking];

  // Pattern to match various thinking block formats
  const thinkingPattern = /<(thinking|antThinking|reasoning)>([\s\S]*?)<\/\1>/gi;

  const replacements: Array<{ original: string; placeholder: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = thinkingPattern.exec(content)) !== null) {
    const tagName = match[1];
    const thinkingContent = match[2].trim();
    const originalMatch = match[0];
    const offset = match.index;

    // Skip empty thinking blocks
    if (!thinkingContent) continue;

    const block: ThinkingBlock = {
      id: generateThinkingId(),
      content: thinkingContent,
      offset,
      length: originalMatch.length,
      placeholder: '',
    };

    // Create a collapsible placeholder
    const placeholder = `\n\n<details class="thinking-block">\n<summary>Reasoning (${tagName})</summary>\n\n${thinkingContent}\n\n</details>\n\n`;

    block.placeholder = placeholder;
    thinking.push(block);

    replacements.push({ original: originalMatch, placeholder });
  }

  // Apply replacements (reverse order to preserve offsets)
  for (const { original, placeholder } of replacements.reverse()) {
    content = content.replace(original, placeholder);
  }

  return {
    ...input,
    content,
    thinking,
    stats: {
      ...input.stats,
      thinkingBlocksExtracted: input.stats.thinkingBlocksExtracted + replacements.length,
    },
  };
}

/**
 * Remove thinking blocks entirely (for clean display)
 */
export function stripThinkingBlocks(content: string): string {
  return content.replace(/<(thinking|antThinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
}

/**
 * Check if content contains thinking blocks
 */
export function hasThinkingBlocks(content: string): boolean {
  return /<(thinking|antThinking|reasoning)>/i.test(content);
}

/**
 * Format thinking block for display
 */
export function formatThinkingBlock(block: ThinkingBlock, collapsed = true): string {
  if (collapsed) {
    return `<details class="thinking-block">\n<summary>Reasoning</summary>\n\n${block.content}\n\n</details>`;
  }
  return `<div class="thinking-block thinking-block--expanded">\n<strong>Reasoning:</strong>\n\n${block.content}\n</div>`;
}
