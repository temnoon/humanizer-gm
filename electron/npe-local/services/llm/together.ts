/**
 * Together.ai Provider
 *
 * Provides access to open-source models via Together.ai inference API.
 * Models use together/ prefix (e.g., together/meta-llama/Llama-3.2-3B-Instruct)
 *
 * API Docs: https://docs.together.ai/
 */

import type { LLMProvider, LLMRequest, LLMResponse } from './types';

interface TogetherResponse {
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
    type?: string;
  };
}

export class TogetherProvider implements LLMProvider {
  private static readonly BASE_URL = 'https://api.together.xyz/v1/chat/completions';

  constructor(
    private apiKey: string,
    private modelId: string
  ) {}

  /**
   * Normalize model ID to Together format
   * - 'together/meta-llama/Llama-3.2-3B-Instruct' -> 'meta-llama/Llama-3.2-3B-Instruct'
   * - 'togethercomputer/llama-2-7b' -> 'togethercomputer/llama-2-7b'
   */
  private normalizeModelId(): string {
    if (this.modelId.startsWith('together/')) {
      return this.modelId.slice('together/'.length);
    }
    return this.modelId;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    try {
      const response = await fetch(TogetherProvider.BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.normalizeModelId(),
          messages: request.messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Together API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as TogetherResponse;

      if (data.error) {
        throw new Error(`Together error: ${data.error.message}`);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('Together returned no choices');
      }

      return {
        response: data.choices[0].message?.content || '',
        tokens_used: data.usage?.total_tokens,
        model: this.modelId,
        provider: 'together',
      };
    } catch (error) {
      console.error('Together call failed:', error);
      throw new Error(`Together failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getProviderName(): string {
    return 'together';
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
 * Popular Together.ai models
 * Full list at: https://docs.together.ai/docs/inference-models
 */
export const TOGETHER_MODELS = [
  // Meta Llama 3.2
  'meta-llama/Llama-3.2-3B-Instruct-Turbo',
  'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
  'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
  // Meta Llama 3.1
  'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
  // Mistral
  'mistralai/Mixtral-8x7B-Instruct-v0.1',
  'mistralai/Mistral-7B-Instruct-v0.3',
  // Qwen
  'Qwen/Qwen2.5-72B-Instruct-Turbo',
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  // DeepSeek
  'deepseek-ai/DeepSeek-V3',
  'deepseek-ai/deepseek-llm-67b-chat',
  // Code models
  'codellama/CodeLlama-34b-Instruct-hf',
  // Embedding models
  'togethercomputer/m2-bert-80M-8k-retrieval',
] as const;
