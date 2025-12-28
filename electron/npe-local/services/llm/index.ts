/**
 * LLM Provider Factory
 *
 * Creates the appropriate LLM provider based on model ID and available API keys.
 * Prioritizes local (Ollama) when available, falls back to cloud providers.
 */

import type { LLMProvider, ModelConfig, APIKeyConfig } from './types';
import { getProviderType, DEFAULT_MODEL_CONFIG } from './types';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export * from './types';
export { OllamaProvider } from './ollama';
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';

// Runtime configuration (can be updated at startup)
let currentConfig: ModelConfig = { ...DEFAULT_MODEL_CONFIG };

/**
 * Update the global model configuration
 */
export function setModelConfig(config: Partial<ModelConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Get current model configuration
 */
export function getModelConfig(): ModelConfig {
  return { ...currentConfig };
}

/**
 * Set API keys
 */
export function setAPIKeys(keys: APIKeyConfig): void {
  currentConfig.apiKeys = { ...currentConfig.apiKeys, ...keys };
}

/**
 * Create an LLM provider instance based on model ID
 *
 * @param modelId - The model identifier (e.g., 'llama3.2:3b', 'gpt-4o', 'claude-3-5-sonnet')
 * @param config - Optional configuration override
 * @returns LLMProvider instance
 */
export async function createLLMProvider(
  modelId?: string,
  config?: Partial<ModelConfig>
): Promise<LLMProvider> {
  const effectiveConfig = { ...currentConfig, ...config };
  const model = modelId || effectiveConfig.defaultModel;
  const providerType = getProviderType(model);

  // If preferLocal is true, try Ollama first
  if (effectiveConfig.preferLocal && providerType === 'ollama') {
    const ollamaProvider = new OllamaProvider(model, effectiveConfig.ollamaUrl);
    if (await ollamaProvider.isAvailable()) {
      return ollamaProvider;
    }
    console.warn(`Ollama not available for model ${model}, checking cloud fallback...`);
  }

  switch (providerType) {
    case 'ollama': {
      return new OllamaProvider(model, effectiveConfig.ollamaUrl);
    }

    case 'openai': {
      const apiKey = effectiveConfig.apiKeys.openai;
      if (!apiKey) {
        throw new Error('OpenAI API key not configured. Please add your API key in settings.');
      }
      return new OpenAIProvider(apiKey, model);
    }

    case 'anthropic': {
      const apiKey = effectiveConfig.apiKeys.anthropic;
      if (!apiKey) {
        throw new Error('Anthropic API key not configured. Please add your API key in settings.');
      }
      return new AnthropicProvider(apiKey, model);
    }

    case 'google': {
      // Google provider not implemented for local yet
      throw new Error('Google AI provider not yet implemented for local use');
    }

    case 'groq': {
      // Groq provider not implemented for local yet
      throw new Error('Groq provider not yet implemented for local use');
    }

    default:
      // Fallback to Ollama
      return new OllamaProvider(effectiveConfig.defaultModel, effectiveConfig.ollamaUrl);
  }
}

/**
 * Create an Ollama provider directly
 */
export function createOllamaProvider(model?: string): OllamaProvider {
  return new OllamaProvider(
    model || currentConfig.defaultModel,
    currentConfig.ollamaUrl
  );
}

/**
 * Check if Ollama is available
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const provider = new OllamaProvider('', currentConfig.ollamaUrl);
    return await provider.isAvailable();
  } catch {
    return false;
  }
}

/**
 * List available Ollama models
 */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const provider = new OllamaProvider('', currentConfig.ollamaUrl);
    return await provider.listModels();
  } catch {
    return [];
  }
}

/**
 * Default models for different use cases
 */
export const DEFAULT_MODELS = {
  general: 'llama3.2:3b',
  humanization: 'llama3.2:3b',
  detection: 'llama3.2:3b',
  sic: 'llama3.2:3b',
  chat: 'llama3.2:3b',
} as const;

/**
 * Get the default model for a specific use case
 */
export function getDefaultModel(useCase: keyof typeof DEFAULT_MODELS): string {
  return DEFAULT_MODELS[useCase] || currentConfig.defaultModel;
}
