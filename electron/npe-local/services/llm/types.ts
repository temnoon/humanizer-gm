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

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google' | 'groq';

/**
 * API key configuration stored locally
 */
export interface APIKeyConfig {
  openai?: string;
  anthropic?: string;
  google?: string;
  groq?: string;
}

/**
 * Model selection configuration
 */
export interface ModelConfig {
  defaultModel: string;
  ollamaUrl: string;
  preferLocal: boolean;
  apiKeys: APIKeyConfig;
}

/**
 * Determine which provider to use based on model ID
 */
export function getProviderType(modelId: string): ProviderType {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-')) {
    return 'openai';
  }
  if (modelId.startsWith('claude-')) {
    return 'anthropic';
  }
  if (modelId.startsWith('gemini-')) {
    return 'google';
  }
  if (modelId.startsWith('llama-') || modelId.startsWith('mixtral-') || modelId.startsWith('groq/')) {
    return 'groq';
  }
  // Default to Ollama for local models
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
