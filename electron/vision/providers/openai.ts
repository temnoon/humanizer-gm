/**
 * OpenAI Vision Provider
 *
 * Connects to OpenAI API for GPT-4 Vision inference.
 * Supports: gpt-4o, gpt-4o-mini, gpt-4-turbo
 */

import * as fs from 'fs';
import type {
  VisionProvider,
  VisionProviderConfig,
  VisionRequest,
  VisionResult,
  VisionProviderType,
} from '../types';
import { DEFAULT_ANALYSIS_PROMPT } from '../types';
import { filterVisionOutput } from '../output-filter';
import { getDefaultModel } from '../profiles';

// ═══════════════════════════════════════════════════════════════════
// OPENAI PROVIDER
// ═══════════════════════════════════════════════════════════════════

export class OpenAIVisionProvider implements VisionProvider {
  readonly type: VisionProviderType = 'openai';
  readonly defaultModel: string;

  private endpoint: string;
  private apiKey: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: VisionProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required');
    }

    this.endpoint = config.endpoint || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 60000; // 60s default
    this.maxRetries = config.maxRetries || 2;
    this.defaultModel = config.model || getDefaultModel('openai');
  }

  /**
   * Check if OpenAI is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.endpoint}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List available vision models
   */
  async listModels(): Promise<string[]> {
    // OpenAI vision models are known statically
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
  }

  /**
   * Analyze an image
   */
  async analyze(request: VisionRequest, model?: string): Promise<VisionResult> {
    const startTime = Date.now();
    const modelId = model || this.defaultModel;

    // Get image content
    const imageContent = await this.getImageContent(request);

    // Build messages
    const prompt = request.prompt || DEFAULT_ANALYSIS_PROMPT.userPrompt;
    const systemPrompt = request.systemPrompt || DEFAULT_ANALYSIS_PROMPT.systemPrompt;

    // Make request with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callOpenAI(
          modelId,
          imageContent,
          prompt,
          systemPrompt,
          request.temperature,
          request.maxTokens,
        );

        // Filter output
        const filtered = filterVisionOutput(result, modelId);

        if (!filtered.success || !filtered.json) {
          throw new Error(filtered.error || 'Failed to parse vision response');
        }

        const json = filtered.json as {
          description?: string;
          categories?: string[];
          objects?: string[];
          scene?: string;
          mood?: string;
        };

        return {
          description: json.description || '',
          categories: Array.isArray(json.categories) ? json.categories : [],
          objects: Array.isArray(json.objects) ? json.objects : [],
          scene: json.scene || 'unknown',
          mood: json.mood,
          confidence: 0.95, // OpenAI generally high confidence
          model: modelId,
          provider: 'openai',
          processingTimeMs: Date.now() - startTime,
          rawOutput: result,
          filtered: filtered.hadCodeBlock,
          filterStrategy: filtered.strategy,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-retriable errors
        if (lastError.message.includes('invalid_api_key') ||
            lastError.message.includes('model_not_found')) {
          throw lastError;
        }

        // Wait before retry
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Vision analysis failed');
  }

  /**
   * Get provider configuration
   */
  getConfig(): VisionProviderConfig {
    return {
      type: 'openai',
      endpoint: this.endpoint,
      model: this.defaultModel,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      // Don't expose API key
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  private async getImageContent(request: VisionRequest): Promise<{
    type: 'image_url';
    image_url: { url: string; detail?: string };
  }> {
    if (request.imageUrl && request.imageUrl.startsWith('http')) {
      // Direct URL
      return {
        type: 'image_url',
        image_url: { url: request.imageUrl, detail: 'auto' },
      };
    }

    // Convert to base64 data URL
    let base64: string;
    let mimeType = 'image/jpeg';

    if (request.imageBase64) {
      base64 = request.imageBase64;
    } else if (request.imageBuffer) {
      base64 = request.imageBuffer.toString('base64');
    } else if (request.imageUrl) {
      // Local file
      const filePath = request.imageUrl.replace('file://', '');
      const buffer = await fs.promises.readFile(filePath);
      base64 = buffer.toString('base64');

      // Detect mime type from extension
      const ext = filePath.split('.').pop()?.toLowerCase();
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'gif') mimeType = 'image/gif';
    } else {
      throw new Error('No image provided in request');
    }

    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64}`,
        detail: 'auto',
      },
    };
  }

  private async callOpenAI(
    model: string,
    imageContent: { type: 'image_url'; image_url: { url: string; detail?: string } },
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const messages: Array<{
        role: 'system' | 'user';
        content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
      }> = [];

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          imageContent,
        ],
      });

      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: temperature ?? 0.3,
          max_tokens: maxTokens ?? 1000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData as { error?: { message?: string } }).error?.message || response.statusText;
        throw new Error(`OpenAI error ${response.status}: ${errorMessage}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI request timed out after ${this.timeout}ms`);
      }

      throw error;
    }
  }
}
