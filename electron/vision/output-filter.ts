/**
 * Vision Output Filter
 *
 * Filters raw LLM output to extract clean JSON based on model-specific patterns.
 * Handles thinking tags, preambles, markdown code blocks, and other artifacts.
 */

import { getVisionProfile } from './profiles';
import type { VisionModelConfig } from './profiles';
import type { VisionOutputStrategy } from './types';

// ═══════════════════════════════════════════════════════════════════
// FILTER RESULT
// ═══════════════════════════════════════════════════════════════════

export interface FilterResult {
  content: string;           // Cleaned content
  json: Record<string, unknown> | null;  // Parsed JSON if valid
  hadThinkingTags: boolean;
  hadPreamble: boolean;
  hadClosing: boolean;
  hadCodeBlock: boolean;
  strategy: VisionOutputStrategy;
  success: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FILTER FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Filter vision model output and extract JSON
 */
export function filterVisionOutput(
  rawOutput: string,
  modelId: string
): FilterResult {
  const profile = getVisionProfile(modelId);

  // If no profile, try generic extraction
  if (!profile) {
    console.warn(`[VisionFilter] No profile for model: ${modelId}, using generic extraction`);
    return genericExtraction(rawOutput);
  }

  // Apply model-specific strategy
  switch (profile.outputStrategy) {
    case 'xml-tags':
      return filterXmlTags(rawOutput, profile);

    case 'heuristic':
      return filterHeuristic(rawOutput, profile);

    case 'json-block':
      return filterJsonBlock(rawOutput, profile);

    case 'structured':
      return filterStructured(rawOutput, profile);

    case 'none':
      return filterNone(rawOutput, profile);

    default:
      return genericExtraction(rawOutput);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILTER STRATEGIES
// ═══════════════════════════════════════════════════════════════════

/**
 * XML Tags Strategy - Strip <think>, <reasoning> blocks
 */
function filterXmlTags(
  text: string,
  profile: VisionModelConfig
): FilterResult {
  let content = text;
  let hadThinkingTags = false;

  // Build tag pairs from profile
  const tagPairs: Array<{ open: string; close: string }> = [];

  for (const tag of profile.patterns.thinkingTags) {
    if (tag.startsWith('</')) continue;
    const openTag = tag;
    const closeTag = tag.replace('<', '</');
    if (profile.patterns.thinkingTags.includes(closeTag)) {
      tagPairs.push({ open: openTag, close: closeTag });
    }
  }

  // Remove each tag pair and contents
  for (const { open, close } of tagPairs) {
    const regex = new RegExp(
      `${escapeRegex(open)}[\\s\\S]*?${escapeRegex(close)}`,
      'gi'
    );
    if (regex.test(content)) {
      hadThinkingTags = true;
    }
    content = content.replace(regex, '');
  }

  content = content.trim();

  // Now extract JSON from remaining content
  const jsonResult = extractJson(content);

  return {
    content: jsonResult.content,
    json: jsonResult.json,
    hadThinkingTags,
    hadPreamble: false,
    hadClosing: false,
    hadCodeBlock: jsonResult.hadCodeBlock,
    strategy: 'xml-tags',
    success: jsonResult.json !== null,
    error: jsonResult.json === null ? 'Failed to extract JSON after removing thinking tags' : undefined,
  };
}

/**
 * Heuristic Strategy - Strip conversational preambles/closings
 */
function filterHeuristic(
  text: string,
  profile: VisionModelConfig
): FilterResult {
  let content = text.trim();
  let hadPreamble = false;
  let hadClosing = false;

  // Remove preamble phrases
  for (const phrase of profile.patterns.preamblePhrases) {
    const lowerContent = content.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();

    if (lowerContent.startsWith(lowerPhrase)) {
      // Find end of preamble sentence
      const afterPhrase = content.slice(phrase.length);

      // Pattern: "Here is the analysis:\n{json}"
      const colonNewline = afterPhrase.match(/^[^:]*:\s*\n/);
      if (colonNewline) {
        content = content.slice(phrase.length + colonNewline[0].length).trim();
        hadPreamble = true;
        break;
      }

      // Pattern: "Here is:\n{json}"
      const colonMatch = afterPhrase.match(/^[^:\n]*:/);
      if (colonMatch) {
        content = content.slice(phrase.length + colonMatch[0].length).trim();
        hadPreamble = true;
        break;
      }

      // Pattern: First paragraph is preamble
      const firstPara = content.indexOf('\n\n');
      if (firstPara > 0 && firstPara < 200) {
        content = content.slice(firstPara + 2).trim();
        hadPreamble = true;
        break;
      }
    }
  }

  // Remove closing phrases
  for (const phrase of profile.patterns.closingPhrases) {
    const lowerContent = content.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();
    const idx = lowerContent.lastIndexOf(lowerPhrase);

    if (idx > 0 && idx > content.length * 0.7) {
      // Find paragraph break before closing
      const beforeClosing = content.slice(0, idx);
      const lastParaBreak = beforeClosing.lastIndexOf('\n\n');

      if (lastParaBreak > 0 && lastParaBreak > content.length * 0.6) {
        content = content.slice(0, lastParaBreak).trim();
      } else {
        content = content.slice(0, idx).trim();
      }
      hadClosing = true;
      break;
    }
  }

  // Extract JSON
  const jsonResult = extractJson(content);

  return {
    content: jsonResult.content,
    json: jsonResult.json,
    hadThinkingTags: false,
    hadPreamble,
    hadClosing,
    hadCodeBlock: jsonResult.hadCodeBlock,
    strategy: 'heuristic',
    success: jsonResult.json !== null,
    error: jsonResult.json === null ? 'Failed to extract JSON after heuristic filtering' : undefined,
  };
}

/**
 * JSON Block Strategy - Extract JSON from markdown code blocks
 */
function filterJsonBlock(
  text: string,
  profile: VisionModelConfig
): FilterResult {
  const jsonResult = extractJson(text);

  // Also apply heuristic filtering if JSON not found
  if (!jsonResult.json) {
    return filterHeuristic(text, profile);
  }

  return {
    content: jsonResult.content,
    json: jsonResult.json,
    hadThinkingTags: false,
    hadPreamble: false,
    hadClosing: false,
    hadCodeBlock: jsonResult.hadCodeBlock,
    strategy: 'json-block',
    success: true,
  };
}

/**
 * Structured Strategy - Extract from explicit output blocks
 */
function filterStructured(
  text: string,
  profile: VisionModelConfig
): FilterResult {
  let content = text;
  let json: Record<string, unknown> | null = null;

  // Check if this is a structured JSON response
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);

      // Handle { output: [...] } format
      if (parsed.output && Array.isArray(parsed.output)) {
        for (const block of parsed.output) {
          if (block.type === 'message' && Array.isArray(block.content)) {
            content = block.content
              .filter((c: { type: string; text?: string }) => c.type === 'output_text')
              .map((c: { text?: string }) => c.text)
              .join('\n');
          }
        }
      } else {
        // Direct JSON object
        json = parsed;
        content = text;
      }
    } catch {
      // Not valid JSON, try extraction
      const jsonResult = extractJson(text);
      return {
        content: jsonResult.content,
        json: jsonResult.json,
        hadCodeBlock: jsonResult.hadCodeBlock,
        strategy: 'structured',
        hadThinkingTags: false,
        hadPreamble: false,
        hadClosing: false,
        success: jsonResult.json !== null,
        error: jsonResult.json === null ? 'Failed to parse structured response' : undefined,
      };
    }
  }

  // If we extracted content but not JSON, try to parse it
  if (!json && content) {
    const jsonResult = extractJson(content);
    json = jsonResult.json;
    if (jsonResult.json) {
      content = jsonResult.content;
    }
  }

  return {
    content,
    json,
    hadThinkingTags: false,
    hadPreamble: false,
    hadClosing: false,
    hadCodeBlock: false,
    strategy: 'structured',
    success: json !== null,
    error: json === null ? 'Failed to extract structured output' : undefined,
  };
}

/**
 * None Strategy - No filtering, just extract JSON
 */
function filterNone(
  text: string,
  _profile: VisionModelConfig
): FilterResult {
  const jsonResult = extractJson(text);

  return {
    content: jsonResult.content,
    json: jsonResult.json,
    hadThinkingTags: false,
    hadPreamble: false,
    hadClosing: false,
    hadCodeBlock: jsonResult.hadCodeBlock,
    strategy: 'none',
    success: jsonResult.json !== null,
    error: jsonResult.json === null ? 'Failed to parse JSON' : undefined,
  };
}

/**
 * Generic Extraction - For unvetted models
 */
function genericExtraction(text: string): FilterResult {
  // Try all strategies in order
  const jsonResult = extractJson(text);

  if (jsonResult.json) {
    return {
      content: jsonResult.content,
      json: jsonResult.json,
      hadThinkingTags: false,
      hadPreamble: false,
      hadClosing: false,
      hadCodeBlock: jsonResult.hadCodeBlock,
      strategy: 'none',
      success: true,
    };
  }

  // Try removing common patterns
  let content = text;

  // Remove thinking tags generically
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  content = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

  const jsonResult2 = extractJson(content);

  return {
    content: jsonResult2.content,
    json: jsonResult2.json,
    hadThinkingTags: content !== text,
    hadPreamble: false,
    hadClosing: false,
    hadCodeBlock: jsonResult2.hadCodeBlock,
    strategy: 'none',
    success: jsonResult2.json !== null,
    error: jsonResult2.json === null ? 'Failed to extract JSON from unvetted model output' : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// JSON EXTRACTION
// ═══════════════════════════════════════════════════════════════════

interface JsonExtractResult {
  content: string;
  json: Record<string, unknown> | null;
  hadCodeBlock: boolean;
}

/**
 * Extract JSON from text, handling code blocks and raw JSON
 */
function extractJson(text: string): JsonExtractResult {
  const trimmed = text.trim();

  // Strategy 1: Extract from markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const json = JSON.parse(codeBlockMatch[1].trim());
      return {
        content: codeBlockMatch[1].trim(),
        json,
        hadCodeBlock: true,
      };
    } catch {
      // Continue to other strategies
    }
  }

  // Strategy 2: Find JSON object in text
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[0]);
      return {
        content: jsonMatch[0],
        json,
        hadCodeBlock: false,
      };
    } catch {
      // Try to fix common JSON issues
      let fixedJson = jsonMatch[0];

      // Remove trailing commas
      fixedJson = fixedJson.replace(/,\s*([\]}])/g, '$1');

      // Fix unquoted keys
      fixedJson = fixedJson.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');

      try {
        const json = JSON.parse(fixedJson);
        return {
          content: fixedJson,
          json,
          hadCodeBlock: false,
        };
      } catch {
        // Give up on this match
      }
    }
  }

  // Strategy 3: Raw JSON (entire text is JSON)
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      return {
        content: trimmed,
        json,
        hadCodeBlock: false,
      };
    } catch {
      // Not valid JSON
    }
  }

  return {
    content: trimmed,
    json: null,
    hadCodeBlock: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
