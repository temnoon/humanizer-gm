/**
 * Vision Module
 *
 * Multi-provider vision analysis with model vetting and output filtering.
 *
 * Providers:
 * - Ollama (local): llava, qwen2-vl, qwen3-vl, llama3.2-vision
 * - OpenAI: gpt-4o, gpt-4o-mini
 * - Anthropic: claude-3.5-sonnet, claude-3.5-haiku
 * - Cloudflare: @cf/llava-hf/llava-1.5-7b-hf
 */

// Types
export type {
  VisionProvider,
  VisionProviderConfig,
  VisionProviderFactory as IVisionProviderFactory,
  VisionProviderType,
  VisionOutputStrategy,
  VisionRequest,
  VisionResult,
  VisionError,
  VisionPromptTemplate,
} from './types';

export type { VisionModelConfig } from './profiles';

export { DEFAULT_ANALYSIS_PROMPT } from './types';

// Profiles
export {
  VISION_MODEL_PROFILES,
  getVisionProfile,
  isVisionModelVetted,
  getVettedModelsForProvider,
  getDefaultModel,
  listVettedVisionModels,
} from './profiles';

// Output filtering
export {
  filterVisionOutput,
  type FilterResult,
} from './output-filter';

// Providers
export { OllamaVisionProvider } from './providers/ollama';
export { OpenAIVisionProvider } from './providers/openai';
export { AnthropicVisionProvider } from './providers/anthropic';
export { CloudflareVisionProvider } from './providers/cloudflare';

// Factory
export {
  VisionProviderFactory,
  getVisionProviderFactory,
  initVisionProviders,
  getVisionProvider,
  getBestVisionProvider,
} from './factory';
