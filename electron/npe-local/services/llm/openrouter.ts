/**
 * OpenRouter Provider
 *
 * Aggregator that provides access to 100+ models from various providers.
 * Models use provider/model format (e.g., anthropic/claude-3.5-sonnet)
 *
 * API Docs: https://openrouter.ai/docs
 */

import type { LLMProvider, LLMRequest, LLMResponse } from './types';

interface OpenRouterResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export class OpenRouterProvider implements LLMProvider {
  private static readonly BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private apiKey: string,
    private modelId: string,
    private siteName?: string,
    private siteUrl?: string
  ) {}

  /**
   * Normalize model ID to OpenRouter format
   * - 'openrouter/anthropic/claude-3.5-sonnet' -> 'anthropic/claude-3.5-sonnet'
   * - 'anthropic/claude-3.5-sonnet' -> 'anthropic/claude-3.5-sonnet'
   */
  private normalizeModelId(): string {
    if (this.modelId.startsWith('openrouter/')) {
      return this.modelId.slice('openrouter/'.length);
    }
    return this.modelId;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.siteUrl || 'https://humanizer.com',
        'X-Title': this.siteName || 'Humanizer',
      };

      const response = await fetch(OpenRouterProvider.BASE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.normalizeModelId(),
          messages: request.messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as OpenRouterResponse;

      if (data.error) {
        throw new Error(`OpenRouter error: ${data.error.message}`);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('OpenRouter returned no choices');
      }

      return {
        response: data.choices[0].message?.content || '',
        tokens_used: data.usage?.total_tokens,
        model: this.modelId,
        provider: 'openrouter',
      };
    } catch (error) {
      console.error('OpenRouter call failed:', error);
      throw new Error(`OpenRouter failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getProviderName(): string {
    return 'openrouter';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async generateText(prompt: string, options: { max_tokens: number; temperature: number }): Promise<string> {
    const response = await this.call({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.max_tokens,
      temperature: options.temperature,
    });
    return response.response;
  }
}

/**
 * Popular OpenRouter models
 * Full list at: https://openrouter.ai/models
 */
export const OPENROUTER_MODELS = [
  // Anthropic
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3-opus',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3-haiku',
  // OpenAI
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4-turbo',
  // Meta
  'meta-llama/llama-3.1-405b-instruct',
  'meta-llama/llama-3.1-70b-instruct',
  'meta-llama/llama-3.1-8b-instruct',
  // Mistral
  'mistralai/mistral-large',
  'mistralai/mistral-nemo',
  // Google
  'google/gemini-pro-1.5',
  'google/gemini-flash-1.5',
  // DeepSeek
  'deepseek/deepseek-chat',
  'deepseek/deepseek-coder',
  // Qwen
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen-2.5-coder-32b-instruct',
] as const;
