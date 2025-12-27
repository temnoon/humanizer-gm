/**
 * Vision Model Vetting Profiles
 *
 * Each vision model has known output patterns that we filter.
 * UNVETTED models will produce a warning but still attempt processing.
 *
 * To add a new model:
 * 1. Test the model with sample images
 * 2. Identify output patterns (thinking tags, preambles, JSON wrapping)
 * 3. Add profile with appropriate strategy
 * 4. Set vetted: true after verification
 */

import type { VisionProviderType } from './types';

// Re-export for convenience
export type { VisionModelConfig } from './types';
import type { VisionModelConfig } from './types';

// ═══════════════════════════════════════════════════════════════════
// VISION MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════════

export const VISION_MODEL_PROFILES: Record<string, VisionModelConfig> = {

  // ============================================
  // OLLAMA LOCAL MODELS
  // ============================================

  'llava:13b': {
    modelId: 'llava:13b',
    displayName: 'LLaVA 13B',
    provider: 'ollama',
    supportsMultipleImages: false,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'json-block',
    patterns: {
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
      closingPhrases: [
        'Let me know',
        'I hope this',
        'Is there anything',
      ],
    },
    notes: 'Primary local vision model. May wrap JSON in markdown blocks.',
  },

  'llava:7b': {
    modelId: 'llava:7b',
    displayName: 'LLaVA 7B',
    provider: 'ollama',
    supportsMultipleImages: false,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'json-block',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [
        'Here is',
        'Here\'s',
        'The image',
        'I can see',
      ],
      closingPhrases: [],
    },
    notes: 'Smaller LLaVA. Faster but less detailed.',
  },

  'llava:34b': {
    modelId: 'llava:34b',
    displayName: 'LLaVA 34B',
    provider: 'ollama',
    supportsMultipleImages: false,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'json-block',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [
        'Here is',
        'Here\'s',
        'Based on my analysis',
        'The image shows',
        'I can see',
      ],
      closingPhrases: [
        'Let me know',
        'I hope this helps',
      ],
    },
    notes: 'Largest LLaVA. Most detailed but slowest.',
  },

  'qwen2-vl:7b': {
    modelId: 'qwen2-vl:7b',
    displayName: 'Qwen2-VL 7B',
    provider: 'ollama',
    supportsMultipleImages: true,
    supportedFormats: ['jpeg', 'png', 'webp'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'xml-tags',
    patterns: {
      thinkingTags: [
        '<think>',
        '</think>',
        '<thinking>',
        '</thinking>',
      ],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Qwen vision model. Uses XML thinking tags like text Qwen.',
  },

  'qwen3-vl:8b': {
    modelId: 'qwen3-vl:8b',
    displayName: 'Qwen3-VL 8B',
    provider: 'ollama',
    supportsMultipleImages: true,
    supportedFormats: ['jpeg', 'png', 'webp'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'heuristic',
    patterns: {
      thinkingTags: [
        '<think>',
        '</think>',
      ],
      preamblePhrases: [
        'Okay,',
        'Let me',
        'First,',
        'I\'ll',
        'The image',
      ],
      closingPhrases: [],
    },
    notes: 'Qwen3 vision. May output thinking as plain text.',
  },

  'llama3.2-vision:11b': {
    modelId: 'llama3.2-vision:11b',
    displayName: 'Llama 3.2 Vision 11B',
    provider: 'ollama',
    supportsMultipleImages: true,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'heuristic',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [
        'Here is',
        'Here\'s',
        'The image',
        'I can see',
        'This appears',
      ],
      closingPhrases: [
        'Let me know',
        'Feel free',
      ],
    },
    notes: 'Meta Llama vision model. Clean output, heuristic filtering.',
  },

  'minicpm-v:8b': {
    modelId: 'minicpm-v:8b',
    displayName: 'MiniCPM-V 8B',
    provider: 'ollama',
    supportsMultipleImages: true,
    supportedFormats: ['jpeg', 'png', 'webp'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'json-block',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Efficient vision model. Generally clean JSON output.',
  },

  // ============================================
  // CLOUDFLARE WORKERS AI MODELS
  // ============================================

  '@cf/llava-hf/llava-1.5-7b-hf': {
    modelId: '@cf/llava-hf/llava-1.5-7b-hf',
    displayName: 'LLaVA 1.5 7B (Cloudflare)',
    provider: 'cloudflare',
    supportsMultipleImages: false,
    supportedFormats: ['jpeg', 'png', 'webp'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'heuristic',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [
        'The image',
        'I can see',
        'This is',
      ],
      closingPhrases: [],
    },
    notes: 'Cloudflare-hosted LLaVA. Fast, good for batch processing.',
  },

  '@cf/uform-gen2-qwen-500m': {
    modelId: '@cf/uform-gen2-qwen-500m',
    displayName: 'UForm Gen2 Qwen 500M (Cloudflare)',
    provider: 'cloudflare',
    supportsMultipleImages: false,
    supportedFormats: ['jpeg', 'png', 'webp'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Very fast, basic captioning. Good for quick categorization.',
  },

  // ============================================
  // OPENAI MODELS
  // ============================================

  'gpt-4o': {
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    supportsMultipleImages: true,
    maxImageSize: 20 * 1024 * 1024, // 20MB
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'OpenAI flagship. Excellent quality, clean structured output.',
  },

  'gpt-4o-mini': {
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    provider: 'openai',
    supportsMultipleImages: true,
    maxImageSize: 20 * 1024 * 1024,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Smaller GPT-4o. Good balance of speed/quality/cost.',
  },

  'gpt-4-turbo': {
    modelId: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    provider: 'openai',
    supportsMultipleImages: true,
    maxImageSize: 20 * 1024 * 1024,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'GPT-4 Turbo with vision. Legacy, prefer gpt-4o.',
  },

  // ============================================
  // ANTHROPIC MODELS
  // ============================================

  // Alias for convenience
  'claude-3.5-sonnet': {
    modelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    supportsMultipleImages: true,
    maxImageSize: 5 * 1024 * 1024,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Alias for claude-3-5-sonnet-20241022',
  },

  'claude-3-5-sonnet-20241022': {
    modelId: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    supportsMultipleImages: true,
    maxImageSize: 5 * 1024 * 1024, // 5MB per image
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Anthropic flagship. Excellent at following JSON format instructions.',
  },

  'claude-3-5-haiku-20241022': {
    modelId: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    supportsMultipleImages: true,
    maxImageSize: 5 * 1024 * 1024,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Fast Anthropic model. Good for high-volume processing.',
  },

  'claude-3-opus-20240229': {
    modelId: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    provider: 'anthropic',
    supportsMultipleImages: true,
    maxImageSize: 5 * 1024 * 1024,
    supportedFormats: ['jpeg', 'png', 'webp', 'gif'],
    vetted: true,
    vettedDate: '2025-12-27',
    outputStrategy: 'none',
    patterns: {
      thinkingTags: [],
      preamblePhrases: [],
      closingPhrases: [],
    },
    notes: 'Most capable Claude. Use for complex analysis.',
  },
};

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize model ID by stripping provider prefixes
 */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/^(ollama|local)\//, '');
}

/**
 * Get profile for a model
 */
export function getVisionProfile(modelId: string): VisionModelConfig | undefined {
  // Try raw ID first
  const profile = VISION_MODEL_PROFILES[modelId];
  if (profile) return profile;

  // Try normalized ID
  const normalizedId = normalizeModelId(modelId);
  return VISION_MODEL_PROFILES[normalizedId];
}

/**
 * Check if a vision model is vetted
 */
export function isVisionModelVetted(modelId: string): boolean {
  const profile = getVisionProfile(modelId);
  return profile?.vetted === true;
}

/**
 * Get all vetted models for a provider
 */
export function getVettedModelsForProvider(
  provider: VisionProviderType
): VisionModelConfig[] {
  return Object.values(VISION_MODEL_PROFILES)
    .filter(p => p.provider === provider && p.vetted);
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: VisionProviderType): string {
  const defaults: Record<VisionProviderType, string> = {
    ollama: 'llava:13b',
    cloudflare: '@cf/llava-hf/llava-1.5-7b-hf',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-20241022',
  };
  return defaults[provider];
}

/**
 * List all vetted model IDs
 */
export function listVettedVisionModels(): string[] {
  return Object.keys(VISION_MODEL_PROFILES)
    .filter(id => VISION_MODEL_PROFILES[id].vetted);
}
