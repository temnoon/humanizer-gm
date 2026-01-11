/**
 * AUI Tools - Tool Parser
 *
 * Parses USE_TOOL invocations from AUI responses.
 * Handles nested JSON objects with proper brace matching.
 */

import type { ParsedToolUse } from './types';

// ═══════════════════════════════════════════════════════════════════
// TOOL PARSER
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse USE_TOOL invocations from AUI response
 * Handles nested JSON objects properly
 */
export function parseToolUses(response: string): ParsedToolUse[] {
  const uses: ParsedToolUse[] = [];

  // Find all USE_TOOL occurrences and extract JSON with brace matching
  // Accept "USE_TOOL" or "USE TOOL" (LLMs sometimes use space instead of underscore)
  // Comma between tool name and JSON is optional (LLMs sometimes omit it)
  const toolPattern = /USE[_\s]TOOL\s*\(\s*(\w+)\s*,?\s*/gi;

  let match;
  while ((match = toolPattern.exec(response)) !== null) {
    const name = match[1];
    const startIdx = match.index + match[0].length;

    // Find matching closing brace for JSON object
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let jsonEnd = -1;

    for (let i = startIdx; i < response.length; i++) {
      const char = response[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\' && inString) {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }

    if (jsonEnd > startIdx) {
      const paramsStr = response.slice(startIdx, jsonEnd);
      try {
        const params = JSON.parse(paramsStr);
        const raw = response.slice(match.index, jsonEnd + 1); // Include closing paren

        uses.push({
          name,
          params,
          raw,
        });
      } catch (e) {
        console.warn('Failed to parse tool JSON:', paramsStr, e);
      }
    }
  }

  return uses;
}

/**
 * Remove tool invocations from response for clean display
 * Uses the same brace-matching logic as parseToolUses
 */
export function cleanToolsFromResponse(response: string): string {
  const toolUses = parseToolUses(response);

  // Remove each tool use from the response
  let cleaned = response;
  for (const use of toolUses) {
    cleaned = cleaned.replace(use.raw, '');
  }

  // Clean up extra whitespace and newlines
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}
