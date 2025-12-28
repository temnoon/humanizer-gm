/**
 * OpenAI Provider
 *
 * Cloud fallback using OpenAI API (GPT-4, GPT-4o, etc.)
 */

import type { LLMProvider, LLMRequest, LLMResponse } from './types';

export class OpenAIProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private modelId: string
  ) {}

  async call(request: LLMRequest): Promise<LLMResponse> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: request.messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorData}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };

      if (!data.choices || data.choices.length === 0) {
        throw new Error('OpenAI returned no choices');
      }

      return {
        response: data.choices[0].message?.content || '',
        tokens_used: data.usage?.total_tokens,
        model: this.modelId,
        provider: 'openai'
      };
    } catch (error) {
      console.error('OpenAI call failed:', error);
      throw new Error(`OpenAI failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getProviderName(): string {
    return 'openai';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  async generateText(prompt: string, options: { max_tokens: number; temperature: number }): Promise<string> {
    const response = await this.call({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.max_tokens,
      temperature: options.temperature
    });
    return response.response;
  }
}
