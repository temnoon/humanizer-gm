/**
 * LLM Provider Types for Electron/Local Use
 *
 * Simplified interface for local LLM operations with cloud fallback.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  max_tokens: number;
  temperature: number;
  model?: string;
}

export interface LLMResponse {
  response: string;
  tokens_used?: number;
  model?: string;
  provider?: string;
}

/**
 * Base interface that all LLM providers must implement
 */
export interface LLMProvider {
  /**
   * Call the LLM with a request
   */
  call(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Get the provider name
   */
  getProviderName(): string;

  /**
   * Check if this provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Simple text generation (convenience method)
   */
  generateText(prompt: string, options: { max_tokens: number; temperature: number }): Promise<string>;
}

export type ProviderType =
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'cloudflare'
  | 'openrouter'
  | 'together'
  | 'cohere'
  | 'mistral'
  | 'deepseek'
  | 'local'
  | 'custom';

/**
 * API key configuration stored locally
 */
export interface APIKeyConfig {
  openai?: string;
  anthropic?: string;
  google?: string;
  groq?: string;
  cloudflare?: string;      // Cloudflare Workers AI
  openrouter?: string;      // OpenRouter aggregator
  together?: string;        // Together.ai
}

/**
 * Model selection configuration
 */
export interface ModelConfig {
  defaultModel: string;
  ollamaUrl: string;
  preferLocal: boolean;
  apiKeys: APIKeyConfig;
  cloudflareAccountId?: string;  // Required for Cloudflare Workers AI
}

/**
 * Determine which provider to use based on model ID
 */
export function getProviderType(modelId: string): ProviderType {
  // OpenAI models
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-')) {
    return 'openai';
  }
  // Anthropic models
  if (modelId.startsWith('claude-')) {
    return 'anthropic';
  }
  // Google models
  if (modelId.startsWith('gemini-')) {
    return 'google';
  }
  // Groq models
  if (modelId.startsWith('groq/')) {
    return 'groq';
  }
  // Cloudflare Workers AI (e.g., @cf/meta/llama-3.1-8b-instruct)
  if (modelId.startsWith('@cf/')) {
    return 'cloudflare';
  }
  // OpenRouter models (e.g., openrouter/anthropic/claude-3.5-sonnet)
  if (modelId.startsWith('openrouter/') || modelId.includes('/') && !modelId.includes(':')) {
    return 'openrouter';
  }
  // Together.ai models (e.g., together/meta-llama/Llama-3.2-3B-Instruct)
  if (modelId.startsWith('together/') || modelId.startsWith('togethercomputer/')) {
    return 'together';
  }
  // Default to Ollama for local models (e.g., llama3.2:3b, qwen3:14b)
  return 'ollama';
}

/**
 * Default model configuration
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  defaultModel: 'llama3.2:3b',
  ollamaUrl: 'http://localhost:11434',
  preferLocal: true,
  apiKeys: {}
};
