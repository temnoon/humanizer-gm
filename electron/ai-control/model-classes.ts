/**
 * Default Model Classes
 *
 * Built-in capability definitions that ship with the system.
 * Users can customize these and create their own.
 *
 * Each class defines:
 * - What capability it provides
 * - Ranked model preferences (fallback chain)
 * - Default parameters
 * - Safety level
 */

import type {
  ModelClass,
  ModelPreference,
  BuiltInCapability,
  SafetyLevel,
} from './types';

// ═══════════════════════════════════════════════════════════════════
// MODEL PREFERENCE HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a model preference with sensible defaults
 */
function pref(
  modelId: string,
  provider: ModelPreference['provider'],
  priority: number,
  options?: Partial<ModelPreference>
): ModelPreference {
  return {
    modelId,
    provider,
    priority,
    ...options,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TRANSLATION CLASS
// ═══════════════════════════════════════════════════════════════════

export const TRANSLATION_CLASS: ModelClass = {
  id: 'translation',
  name: 'Language Translation',
  description: 'Translate text between languages with cultural context',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.3,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are an expert translator. Translate accurately while preserving:
- Meaning and nuance
- Cultural context
- Tone and register
- Idioms (adapt appropriately)`,

  models: [
    pref('gpt-4o', 'openai', 1),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 2),
    pref('qwen3:14b', 'ollama', 3, { conditions: { requiresPrivate: true } }),
    pref('gemini-1.5-pro', 'google', 4),
    pref('mixtral-8x7b', 'mistral', 5),
    pref('llama-3.3-70b', 'ollama', 6, { conditions: { requiresLocal: true } }),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// CODING CLASS
// ═══════════════════════════════════════════════════════════════════

export const CODING_CLASS: ModelClass = {
  id: 'coding',
  name: 'Code Generation & Review',
  description: 'Generate, review, refactor, and explain code',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.2,
  defaultMaxTokens: 8192,

  systemPromptPrefix: `You are an expert software engineer. Write clean, maintainable code.
Follow best practices:
- Clear variable names
- Proper error handling
- Security-conscious
- Well-documented`,

  models: [
    pref('claude-3-5-sonnet-20241022', 'anthropic', 1),
    pref('gpt-4o', 'openai', 2),
    pref('deepseek-coder-v2', 'deepseek', 3),
    pref('qwen2.5-coder:32b', 'ollama', 4, { conditions: { requiresLocal: true } }),
    pref('codellama:34b', 'ollama', 5, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-pro', 'google', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// CREATIVE WRITING CLASS
// ═══════════════════════════════════════════════════════════════════

export const CREATIVE_CLASS: ModelClass = {
  id: 'creative',
  name: 'Creative Writing',
  description: 'Generate creative content: stories, poetry, scripts',
  category: 'text',
  safetyLevel: 'creative',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.8,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are a creative writing assistant with a rich imagination.
Create engaging, original content that:
- Has authentic voice
- Evokes emotion
- Uses vivid imagery
- Respects genre conventions`,

  models: [
    pref('claude-3-opus-20240229', 'anthropic', 1),
    pref('gpt-4o', 'openai', 2),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 3),
    pref('qwen3:14b', 'ollama', 4, { conditions: { requiresLocal: true } }),
    pref('mixtral-8x22b', 'mistral', 5),
    pref('gemini-1.5-pro', 'google', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// ANALYSIS CLASS
// ═══════════════════════════════════════════════════════════════════

export const ANALYSIS_CLASS: ModelClass = {
  id: 'analysis',
  name: 'Text Analysis',
  description: 'Analyze text for sentiment, themes, structure, style',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.1,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are an analytical expert. Provide objective, thorough analysis.
Be specific, cite evidence from the text, and organize findings clearly.`,

  models: [
    pref('gpt-4o-mini', 'openai', 1),
    pref('claude-3-5-haiku-20241022', 'anthropic', 2),
    pref('qwen3:8b', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-flash', 'google', 4),
    pref('gpt-4o', 'openai', 5),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// SUMMARIZATION CLASS
// ═══════════════════════════════════════════════════════════════════

export const SUMMARIZATION_CLASS: ModelClass = {
  id: 'summarization',
  name: 'Document Summarization',
  description: 'Summarize documents while preserving key information',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.2,
  defaultMaxTokens: 2048,

  systemPromptPrefix: `You are an expert summarizer. Create concise, accurate summaries that:
- Capture main points
- Preserve key details
- Maintain logical flow
- Are proportional to source length`,

  models: [
    pref('claude-3-5-haiku-20241022', 'anthropic', 1),
    pref('gpt-4o-mini', 'openai', 2),
    pref('qwen3:8b', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-flash', 'google', 4),
    pref('mixtral-8x7b', 'mistral', 5),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// OCR CLASS
// ═══════════════════════════════════════════════════════════════════

export const OCR_CLASS: ModelClass = {
  id: 'ocr',
  name: 'Image Text Extraction',
  description: 'Extract and transcribe text from images',
  category: 'vision',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.1,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are an OCR specialist. Extract text from images with:
- Exact character reproduction
- Proper formatting preservation
- Handling of multiple columns/regions
- Recognition of handwriting when applicable`,

  models: [
    pref('gpt-4o', 'openai', 1),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 2),
    pref('qwen3-vl:8b', 'ollama', 3, {
      conditions: { requiresLocal: true },
      outputStrategy: 'heuristic',
    }),
    pref('llava:34b', 'ollama', 4, {
      conditions: { requiresLocal: true },
      outputStrategy: 'json-block',
    }),
    pref('gemini-1.5-pro', 'google', 5),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// VISION CLASS
// ═══════════════════════════════════════════════════════════════════

export const VISION_CLASS: ModelClass = {
  id: 'vision',
  name: 'Image Understanding',
  description: 'Describe, analyze, and understand images',
  category: 'vision',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.3,
  defaultMaxTokens: 2048,

  systemPromptPrefix: `You are a vision analysis expert. Describe images with:
- Accurate object identification
- Scene understanding
- Mood and atmosphere detection
- Relevant context and details`,

  models: [
    pref('gpt-4o', 'openai', 1),
    pref('qwen3-vl:8b', 'ollama', 2, {
      conditions: { requiresLocal: true },
      outputStrategy: 'heuristic',
    }),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 3),
    pref('llama3.2-vision:11b', 'ollama', 4, {
      conditions: { requiresLocal: true },
      outputStrategy: 'heuristic',
    }),
    pref('llava:13b', 'ollama', 5, {
      conditions: { requiresLocal: true },
      outputStrategy: 'json-block',
    }),
    pref('@cf/llava-hf/llava-1.5-7b-hf', 'cloudflare', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING CLASS
// ═══════════════════════════════════════════════════════════════════

export const EMBEDDING_CLASS: ModelClass = {
  id: 'embedding',
  name: 'Text Embeddings',
  description: 'Generate vector embeddings for semantic search',
  category: 'embedding',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  models: [
    pref('text-embedding-3-small', 'openai', 1),
    pref('text-embedding-3-large', 'openai', 2),
    pref('nomic-embed-text', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('mxbai-embed-large', 'ollama', 4, { conditions: { requiresLocal: true } }),
    pref('embed-english-v3.0', 'cohere', 5),
    pref('@cf/baai/bge-base-en-v1.5', 'cloudflare', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// HUMANIZER CLASS
// ═══════════════════════════════════════════════════════════════════

export const HUMANIZER_CLASS: ModelClass = {
  id: 'humanizer',
  name: 'AI Detection Evasion',
  description: 'Rewrite AI-generated text to appear human-written',
  category: 'text',
  safetyLevel: 'creative',  // Needs freedom for style variation
  builtIn: true,
  version: 1,

  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are a style transformation expert. Rewrite text to:
- Sound naturally human
- Vary sentence structure
- Include authentic voice
- Avoid AI writing patterns`,

  models: [
    pref('qwen3:14b', 'ollama', 1, { conditions: { requiresLocal: true } }),
    pref('mistral-large', 'mistral', 2),
    pref('llama-3.3-70b', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('mixtral-8x22b', 'mistral', 4),
    pref('gemma2:27b', 'ollama', 5, { conditions: { requiresLocal: true } }),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// DETECTION CLASS
// ═══════════════════════════════════════════════════════════════════

export const DETECTION_CLASS: ModelClass = {
  id: 'detection',
  name: 'AI Content Detection',
  description: 'Detect AI-generated content (privacy-first, local only)',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.0,  // Deterministic
  defaultMaxTokens: 1024,

  systemPromptPrefix: `You are an AI content detection specialist. Analyze text for:
- Statistical patterns typical of AI
- Repetitive structures
- Lack of personal voice
- Overly perfect grammar/flow`,

  // Detection is LOCAL ONLY for privacy
  models: [
    pref('qwen3:8b', 'ollama', 1, { conditions: { requiresLocal: true, requiresPrivate: true } }),
    pref('llama-3.2:3b', 'ollama', 2, { conditions: { requiresLocal: true, requiresPrivate: true } }),
    pref('mistral:7b', 'ollama', 3, { conditions: { requiresLocal: true, requiresPrivate: true } }),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// CHAT CLASS
// ═══════════════════════════════════════════════════════════════════

export const CHAT_CLASS: ModelClass = {
  id: 'chat',
  name: 'Conversational AI',
  description: 'General-purpose conversational assistant',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are a helpful, knowledgeable assistant.
Be conversational, accurate, and helpful.`,

  models: [
    pref('gpt-4o', 'openai', 1),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 2),
    pref('qwen3:14b', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-pro', 'google', 4),
    pref('llama-3.3-70b', 'ollama', 5, { conditions: { requiresLocal: true } }),
    pref('mixtral-8x22b', 'mistral', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// REASONING CLASS
// ═══════════════════════════════════════════════════════════════════

export const REASONING_CLASS: ModelClass = {
  id: 'reasoning',
  name: 'Complex Reasoning',
  description: 'Multi-step reasoning, logic, math, planning',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.1,
  defaultMaxTokens: 8192,

  systemPromptPrefix: `You are a reasoning expert. Think step by step.
Break down complex problems, show your work, verify conclusions.`,

  models: [
    pref('o1-preview', 'openai', 1),
    pref('o1-mini', 'openai', 2),
    pref('claude-3-opus-20240229', 'anthropic', 3),
    pref('qwq-32b', 'ollama', 4, {
      conditions: { requiresLocal: true },
      outputStrategy: 'xml-tags',
    }),
    pref('deepseek-r1:32b', 'ollama', 5, {
      conditions: { requiresLocal: true },
      outputStrategy: 'xml-tags',
    }),
    pref('gpt-4o', 'openai', 6),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION CLASS
// ═══════════════════════════════════════════════════════════════════

export const EXTRACTION_CLASS: ModelClass = {
  id: 'extraction',
  name: 'Structured Data Extraction',
  description: 'Extract structured data from unstructured text',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.0,  // Deterministic for consistent extraction
  defaultMaxTokens: 4096,

  systemPromptPrefix: `You are a data extraction specialist.
Extract structured information accurately.
Always respond with valid JSON matching the requested schema.`,

  systemPromptSuffix: `
Respond ONLY with valid JSON. No explanations or other text.`,

  models: [
    pref('gpt-4o', 'openai', 1),
    pref('claude-3-5-sonnet-20241022', 'anthropic', 2),
    pref('gpt-4o-mini', 'openai', 3),
    pref('qwen3:14b', 'ollama', 4, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-flash', 'google', 5),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// CLASSIFICATION CLASS
// ═══════════════════════════════════════════════════════════════════

export const CLASSIFICATION_CLASS: ModelClass = {
  id: 'classification',
  name: 'Content Classification',
  description: 'Classify text into categories',
  category: 'text',
  safetyLevel: 'standard',
  builtIn: true,
  version: 1,

  defaultTemperature: 0.0,  // Deterministic
  defaultMaxTokens: 256,

  systemPromptPrefix: `You are a classification expert.
Classify content accurately and consistently.
Respond with only the category label(s) requested.`,

  models: [
    pref('gpt-4o-mini', 'openai', 1),
    pref('claude-3-5-haiku-20241022', 'anthropic', 2),
    pref('qwen3:8b', 'ollama', 3, { conditions: { requiresLocal: true } }),
    pref('gemini-1.5-flash', 'google', 4),
    pref('mistral:7b', 'ollama', 5, { conditions: { requiresLocal: true } }),
  ],
};

// ═══════════════════════════════════════════════════════════════════
// ALL DEFAULT CLASSES
// ═══════════════════════════════════════════════════════════════════

/**
 * All built-in model classes
 */
export const DEFAULT_MODEL_CLASSES: Record<BuiltInCapability, ModelClass> = {
  translation: TRANSLATION_CLASS,
  coding: CODING_CLASS,
  creative: CREATIVE_CLASS,
  analysis: ANALYSIS_CLASS,
  summarization: SUMMARIZATION_CLASS,
  ocr: OCR_CLASS,
  vision: VISION_CLASS,
  embedding: EMBEDDING_CLASS,
  humanizer: HUMANIZER_CLASS,
  detection: DETECTION_CLASS,
  chat: CHAT_CLASS,
  reasoning: REASONING_CLASS,
  extraction: EXTRACTION_CLASS,
  classification: CLASSIFICATION_CLASS,
};

/**
 * Get a model class by ID
 */
export function getModelClass(id: string): ModelClass | undefined {
  return DEFAULT_MODEL_CLASSES[id as BuiltInCapability];
}

/**
 * List all built-in capability IDs
 */
export function listBuiltInCapabilities(): BuiltInCapability[] {
  return Object.keys(DEFAULT_MODEL_CLASSES) as BuiltInCapability[];
}

/**
 * Create a custom model class
 */
export function createCustomClass(
  id: string,
  name: string,
  description: string,
  models: ModelPreference[],
  options?: Partial<ModelClass>
): ModelClass {
  if (DEFAULT_MODEL_CLASSES[id as BuiltInCapability]) {
    throw new Error(`Cannot create custom class with built-in ID: ${id}`);
  }

  return {
    id,
    name,
    description,
    category: 'text',
    safetyLevel: 'standard',
    builtIn: false,
    version: 1,
    models,
    ...options,
  };
}
