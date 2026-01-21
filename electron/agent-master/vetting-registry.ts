/**
 * Unified Vetting Registry
 *
 * Consolidates model output vetting profiles for both text and vision models.
 * Handles thinking tags, preambles, closing phrases, and JSON extraction.
 */

import type { OutputStrategy } from '../ai-control/types';
import type { VettingProfile, VettingResult } from './types';

// ═══════════════════════════════════════════════════════════════════
// VETTING PROFILES REGISTRY
// ═══════════════════════════════════════════════════════════════════

const vettingProfiles: VettingProfile[] = [
  // ============================================
  // TEXT MODELS - Reasoning/Thinking Tags
  // ============================================

  {
    modelPattern: /^qwq/i,
    modelName: 'Qwen QwQ (Reasoning)',
    provider: 'ollama',
    outputStrategy: 'xml-tags',
    thinkingTags: ['<think>', '</think>', '<thinking>', '</thinking>'],
    preamblePhrases: ['Okay, so', 'Let me', 'First,', 'Alright,'],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'Qwen reasoning model with extended thinking. Always strips <think> blocks.',
  },

  {
    modelPattern: /^deepseek-r1/i,
    modelName: 'DeepSeek R1 (Reasoning)',
    provider: 'ollama',
    outputStrategy: 'xml-tags',
    thinkingTags: ['<think>', '</think>', '<reasoning>', '</reasoning>'],
    preamblePhrases: ['Let me think', 'Okay,', 'First,'],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'DeepSeek reasoning model. Uses <think> and <reasoning> blocks.',
  },

  {
    modelPattern: /^qwen/i,
    modelName: 'Qwen (Text)',
    provider: 'ollama',
    outputStrategy: 'heuristic',
    thinkingTags: ['<think>', '</think>'],
    preamblePhrases: ['Here is', 'Here\'s', 'Okay,', 'Let me'],
    closingPhrases: ['Let me know', 'I hope this helps', 'Feel free to'],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'General Qwen models may include preambles and closings.',
  },

  {
    modelPattern: /^llama/i,
    modelName: 'Llama',
    provider: 'ollama',
    outputStrategy: 'heuristic',
    thinkingTags: [],
    preamblePhrases: [
      'Here is',
      'Here\'s',
      'Sure,',
      'Of course,',
      'I\'d be happy to',
      'Certainly,',
    ],
    closingPhrases: [
      'Let me know',
      'I hope this helps',
      'Feel free to',
      'Is there anything else',
    ],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'Llama models tend to be conversational. Strip preambles and closings.',
  },

  {
    modelPattern: /^gemma/i,
    modelName: 'Gemma',
    provider: 'ollama',
    outputStrategy: 'heuristic',
    thinkingTags: [],
    preamblePhrases: ['Here is', 'Here\'s', 'Sure!'],
    closingPhrases: ['Let me know'],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'Gemma models. Generally clean output with occasional preambles.',
  },

  {
    modelPattern: /^mistral/i,
    modelName: 'Mistral',
    provider: 'ollama',
    outputStrategy: 'heuristic',
    thinkingTags: [],
    preamblePhrases: ['Here is', 'Here\'s'],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'Mistral models. Usually clean output.',
  },

  // ============================================
  // CLOUD API MODELS - Generally Clean
  // ============================================

  {
    modelPattern: /^claude/i,
    modelName: 'Claude (Anthropic)',
    provider: 'anthropic',
    outputStrategy: 'none',
    thinkingTags: [],
    preamblePhrases: [],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'Claude models produce clean output. No vetting needed.',
  },

  {
    modelPattern: /^gpt-4|^gpt-3\.5|^o1|^o3/i,
    modelName: 'OpenAI GPT/O1',
    provider: 'openai',
    outputStrategy: 'none',
    thinkingTags: [],
    preamblePhrases: [],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-30',
    notes: 'OpenAI models produce clean output. No vetting needed.',
  },

  // ============================================
  // VISION MODELS - From vision/profiles.ts
  // ============================================

  {
    modelPattern: /^llava/i,
    modelName: 'LLaVA (Vision)',
    provider: 'ollama',
    outputStrategy: 'json-block',
    thinkingTags: [],
    preamblePhrases: [
      'Here is',
      'Here\'s',
      'Based on',
      'The image shows',
      'I can see',
      'This image',
      'Looking at',
    ],
    closingPhrases: ['Let me know', 'I hope this', 'Is there anything'],
    vetted: true,
    vettedDate: '2025-12-27',
    notes: 'LLaVA vision models. May wrap JSON in markdown blocks.',
  },

  {
    modelPattern: /^qwen.*-vl|^qwen.*vl/i,
    modelName: 'Qwen VL (Vision)',
    provider: 'ollama',
    outputStrategy: 'xml-tags',
    thinkingTags: ['<think>', '</think>', '<thinking>', '</thinking>'],
    preamblePhrases: ['Okay,', 'Let me', 'First,', 'I\'ll', 'The image'],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-27',
    notes: 'Qwen vision models. Use XML thinking tags.',
  },

  {
    modelPattern: /^minicpm-v/i,
    modelName: 'MiniCPM-V (Vision)',
    provider: 'ollama',
    outputStrategy: 'heuristic',
    thinkingTags: [],
    preamblePhrases: ['The image', 'This is', 'I can see'],
    closingPhrases: [],
    vetted: true,
    vettedDate: '2025-12-27',
    notes: 'MiniCPM vision model. Compact but capable.',
  },
];

// ═══════════════════════════════════════════════════════════════════
// PROFILE LOOKUP
// ═══════════════════════════════════════════════════════════════════

/**
 * Get vetting profile for a model ID
 */
export function getVettingProfile(modelId: string): VettingProfile | undefined {
  for (const profile of vettingProfiles) {
    if (profile.modelPattern.test(modelId)) {
      return profile;
    }
  }
  return undefined;
}

/**
 * List all vetting profiles
 */
export function listVettingProfiles(): VettingProfile[] {
  return [...vettingProfiles];
}

/**
 * Register a custom vetting profile
 */
export function registerVettingProfile(profile: VettingProfile): void {
  // Add at beginning so custom profiles take precedence
  vettingProfiles.unshift(profile);
  console.log(`[VettingRegistry] Registered profile for: ${profile.modelName}`);
}

// ═══════════════════════════════════════════════════════════════════
// OUTPUT FILTERING
// ═══════════════════════════════════════════════════════════════════

/**
 * Filter model output based on its vetting profile
 */
export function filterOutput(rawOutput: string, modelId: string): VettingResult {
  const profile = getVettingProfile(modelId);

  // If no profile, use generic heuristic filtering
  if (!profile) {
    console.warn(`[VettingRegistry] No profile for model: ${modelId}, using generic`);
    return filterGeneric(rawOutput);
  }

  // Apply strategy-specific filtering
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
      return {
        content: rawOutput,
        raw: rawOutput,
        strategy: 'none',
        stripped: { thinkingTags: false, preamble: false, closing: false },
        success: true,
      };

    default:
      return filterGeneric(rawOutput);
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILTER STRATEGIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Filter XML thinking tags
 */
function filterXmlTags(text: string, profile: VettingProfile): VettingResult {
  let content = text;
  let hadThinkingTags = false;

  // Build tag pairs
  const tagPairs: Array<{ open: string; close: string }> = [];
  for (const tag of profile.thinkingTags || []) {
    if (tag.startsWith('</')) continue;
    const openTag = tag;
    const closeTag = tag.replace('<', '</');
    if (profile.thinkingTags?.includes(closeTag)) {
      tagPairs.push({ open: openTag, close: closeTag });
    }
  }

  // Remove each tag pair and contents
  // Note: test() advances lastIndex on global regexes, so check via replace result
  for (const { open, close } of tagPairs) {
    const regex = new RegExp(
      `${escapeRegex(open)}[\\s\\S]*?${escapeRegex(close)}`,
      'gi'
    );
    const before = content;
    content = content.replace(regex, '');
    if (content !== before) {
      hadThinkingTags = true;
    }
  }

  content = content.trim();

  // Also apply heuristic filtering for preambles
  const heuristicResult = filterHeuristicPhrases(content, profile);

  return {
    content: heuristicResult.content,
    raw: text,
    strategy: 'xml-tags',
    stripped: {
      thinkingTags: hadThinkingTags,
      preamble: heuristicResult.hadPreamble,
      closing: heuristicResult.hadClosing,
    },
    success: true,
  };
}

/**
 * Filter heuristic preambles and closings
 * Also strips thinking tags if the profile defines them
 */
function filterHeuristic(text: string, profile: VettingProfile): VettingResult {
  let content = text.trim();
  let hadThinkingTags = false;

  // Strip thinking tags if profile defines them (some models like qwen use heuristic but output thinking)
  if (profile.thinkingTags && profile.thinkingTags.length > 0) {
    // Build tag pairs
    const tagPairs: Array<{ open: string; close: string }> = [];
    for (const tag of profile.thinkingTags) {
      if (tag.startsWith('</')) continue;
      const openTag = tag;
      const closeTag = tag.replace('<', '</');
      if (profile.thinkingTags.includes(closeTag)) {
        tagPairs.push({ open: openTag, close: closeTag });
      }
    }

    // Remove each tag pair and contents
    for (const { open, close } of tagPairs) {
      const regex = new RegExp(
        `${escapeRegex(open)}[\\s\\S]*?${escapeRegex(close)}`,
        'gi'
      );
      const before = content;
      content = content.replace(regex, '');
      if (content !== before) {
        hadThinkingTags = true;
      }
    }
    content = content.trim();
  }

  const result = filterHeuristicPhrases(content, profile);

  return {
    content: result.content,
    raw: text,
    strategy: 'heuristic',
    stripped: {
      thinkingTags: hadThinkingTags,
      preamble: result.hadPreamble,
      closing: result.hadClosing,
    },
    success: true,
  };
}

/**
 * Helper to filter preamble and closing phrases
 */
function filterHeuristicPhrases(
  text: string,
  profile: VettingProfile
): { content: string; hadPreamble: boolean; hadClosing: boolean } {
  let content = text;
  let hadPreamble = false;
  let hadClosing = false;

  // Remove preamble phrases
  for (const phrase of profile.preamblePhrases || []) {
    const lowerContent = content.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();

    if (lowerContent.startsWith(lowerPhrase)) {
      const afterPhrase = content.slice(phrase.length);

      // Pattern: "Here is the analysis:\n{content}"
      const colonNewline = afterPhrase.match(/^[^:]*:\s*\n/);
      if (colonNewline) {
        content = content.slice(phrase.length + colonNewline[0].length).trim();
        hadPreamble = true;
        break;
      }

      // Pattern: "Here is:\n{content}"
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

      // Simple: Just remove the phrase
      content = content.slice(phrase.length).trim();
      hadPreamble = true;
      break;
    }
  }

  // Remove closing phrases
  for (const phrase of profile.closingPhrases || []) {
    const lowerContent = content.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();
    const idx = lowerContent.lastIndexOf(lowerPhrase);

    if (idx > 0 && idx > content.length * 0.7) {
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

  return { content, hadPreamble, hadClosing };
}

/**
 * Filter JSON blocks from markdown
 */
function filterJsonBlock(text: string, profile: VettingProfile): VettingResult {
  // First apply heuristic filtering
  const heuristicResult = filterHeuristicPhrases(text.trim(), profile);
  let content = heuristicResult.content;

  // Try to extract JSON from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      JSON.parse(codeBlockMatch[1].trim());
      content = codeBlockMatch[1].trim();
    } catch {
      // Not valid JSON, keep as-is
    }
  }

  return {
    content,
    raw: text,
    strategy: 'json-block',
    stripped: {
      thinkingTags: false,
      preamble: heuristicResult.hadPreamble,
      closing: heuristicResult.hadClosing,
    },
    success: true,
  };
}

/**
 * Filter structured output
 */
function filterStructured(text: string, profile: VettingProfile): VettingResult {
  let content = text.trim();

  // Check if response is wrapped in a structured format
  if (content.startsWith('{') || content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);

      // Handle { output: [...] } format
      if (parsed.output && Array.isArray(parsed.output)) {
        for (const block of parsed.output) {
          if (block.type === 'message' && Array.isArray(block.content)) {
            content = block.content
              .filter((c: { type: string }) => c.type === 'output_text')
              .map((c: { text?: string }) => c.text || '')
              .join('\n');
          }
        }
      }
    } catch {
      // Not valid JSON, use as-is
    }
  }

  return {
    content,
    raw: text,
    strategy: 'structured',
    stripped: { thinkingTags: false, preamble: false, closing: false },
    success: true,
  };
}

/**
 * Generic filtering for unvetted models
 */
function filterGeneric(text: string): VettingResult {
  let content = text;
  let hadThinkingTags = false;

  // Remove common thinking tags
  // Note: test() and replace() both advance lastIndex on global regexes,
  // so we check for match existence via replace result comparison
  const thinkingPatterns = [
    /<think>[\s\S]*?<\/think>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<reasoning>[\s\S]*?<\/reasoning>/gi,
  ];

  for (const pattern of thinkingPatterns) {
    const before = content;
    content = content.replace(pattern, '');
    if (content !== before) {
      hadThinkingTags = true;
    }
  }

  content = content.trim();

  // Apply generic preamble filtering
  const genericProfile: VettingProfile = {
    modelPattern: /.*/,
    modelName: 'Generic',
    outputStrategy: 'heuristic',
    thinkingTags: [],
    preamblePhrases: ['Here is', 'Here\'s', 'Sure,', 'Certainly,'],
    closingPhrases: ['Let me know', 'I hope this helps'],
    vetted: false,
  };

  const heuristicResult = filterHeuristicPhrases(content, genericProfile);

  return {
    content: heuristicResult.content,
    raw: text,
    strategy: 'heuristic',
    stripped: {
      thinkingTags: hadThinkingTags,
      preamble: heuristicResult.hadPreamble,
      closing: heuristicResult.hadClosing,
    },
    success: true,
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
