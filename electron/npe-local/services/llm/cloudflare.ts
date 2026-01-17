/**
 * Cloudflare Workers AI Provider
 *
 * Provides access to models via Cloudflare Workers AI.
 * Models use the @cf/ prefix (e.g., @cf/meta/llama-3.1-8b-instruct)
 *
 * API Docs: https://developers.cloudflare.com/workers-ai/
 */

import type { LLMProvider, LLMRequest, LLMResponse } from './types';

interface CloudflareAIResponse {
  result?: {
    response?: string;
  };
  success: boolean;
  errors?: Array<{ message: string }>;
}

export class CloudflareProvider implements LLMProvider {
  private baseUrl: string;

  constructor(
    private apiKey: string,
    private accountId: string,
    private modelId: string
  ) {
    // Remove @cf/ prefix for API path
    const modelPath = modelId.startsWith('@cf/') ? modelId.slice(4) : modelId;
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelPath}`;
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    try {
      // Convert messages to Cloudflare format
      const prompt = request.messages
        .map(m => {
          if (m.role === 'system') return `[System]: ${m.content}`;
          if (m.role === 'user') return `[User]: ${m.content}`;
          return `[Assistant]: ${m.content}`;
        })
        .join('\n\n');

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloudflare AI error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as CloudflareAIResponse;

      if (!data.success || data.errors?.length) {
        const errorMsg = data.errors?.[0]?.message || 'Unknown error';
        throw new Error(`Cloudflare AI error: ${errorMsg}`);
      }

      return {
        response: data.result?.response || '',
        model: this.modelId,
        provider: 'cloudflare',
      };
    } catch (error) {
      console.error('Cloudflare AI call failed:', error);
      throw new Error(`Cloudflare AI failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getProviderName(): string {
    return 'cloudflare';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && this.apiKey.length > 0 && !!this.accountId;
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
 * Available Cloudflare Workers AI models
 * See: https://developers.cloudflare.com/workers-ai/models/
 */
export const CLOUDFLARE_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.1-70b-instruct',
  '@cf/meta/llama-3.2-1b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.2',
  '@cf/deepseek-ai/deepseek-math-7b-instruct',
  '@cf/google/gemma-7b-it',
  '@cf/qwen/qwen1.5-7b-chat-awq',
] as const;
