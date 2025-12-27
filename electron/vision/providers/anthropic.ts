/**
 * Anthropic Vision Provider
 *
 * Connects to Anthropic API for Claude Vision inference.
 * Supports: claude-3.5-sonnet, claude-3.5-haiku, claude-3-opus
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
// ANTHROPIC PROVIDER
// ═══════════════════════════════════════════════════════════════════

export class AnthropicVisionProvider implements VisionProvider {
  readonly type: VisionProviderType = 'anthropic';
  readonly defaultModel: string;

  private endpoint: string;
  private apiKey: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: VisionProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key required');
    }

    this.endpoint = config.endpoint || 'https://api.anthropic.com/v1';
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 60000; // 60s default
    this.maxRetries = config.maxRetries || 2;
    this.defaultModel = config.model || getDefaultModel('anthropic');
  }

  /**
   * Check if Anthropic is available
   */
  async isAvailable(): Promise<boolean> {
    // Anthropic doesn't have a simple health check endpoint
    // Just verify API key format
    return this.apiKey.startsWith('sk-ant-');
  }

  /**
   * List available vision models
   */
  async listModels(): Promise<string[]> {
    // Anthropic vision models are known statically
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
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
        const result = await this.callAnthropic(
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
          confidence: 0.95, // Anthropic generally high confidence
          model: modelId,
          provider: 'anthropic',
          processingTimeMs: Date.now() - startTime,
          rawOutput: result,
          filtered: filtered.hadCodeBlock,
          filterStrategy: filtered.strategy,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-retriable errors
        if (lastError.message.includes('authentication_error') ||
            lastError.message.includes('invalid_api_key')) {
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
      type: 'anthropic',
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
    type: 'image';
    source: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }> {
    let base64: string;
    let mediaType = 'image/jpeg';

    if (request.imageBase64) {
      base64 = request.imageBase64;
    } else if (request.imageBuffer) {
      base64 = request.imageBuffer.toString('base64');
    } else if (request.imageUrl) {
      if (request.imageUrl.startsWith('http')) {
        // Fetch remote URL
        const response = await fetch(request.imageUrl);
        const buffer = await response.arrayBuffer();
        base64 = Buffer.from(buffer).toString('base64');

        // Get content type from response
        const contentType = response.headers.get('content-type');
        if (contentType) mediaType = contentType;
      } else {
        // Local file
        const filePath = request.imageUrl.replace('file://', '');
        const buffer = await fs.promises.readFile(filePath);
        base64 = buffer.toString('base64');

        // Detect mime type from extension
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext === 'png') mediaType = 'image/png';
        else if (ext === 'webp') mediaType = 'image/webp';
        else if (ext === 'gif') mediaType = 'image/gif';
      }
    } else {
      throw new Error('No image provided in request');
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64,
      },
    };
  }

  private async callAnthropic(
    model: string,
    imageContent: {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    },
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const messages = [
        {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: prompt },
          ],
        },
      ];

      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens ?? 1000,
        temperature: temperature ?? 0.3,
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const response = await fetch(`${this.endpoint}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = (errorData as { error?: { message?: string } }).error?.message || response.statusText;
        throw new Error(`Anthropic error ${response.status}: ${errorMessage}`);
      }

      const data = await response.json();

      // Extract text from content blocks
      const content = data.content || [];
      const textBlocks = content.filter((block: { type: string }) => block.type === 'text');
      return textBlocks.map((block: { text: string }) => block.text).join('\n');
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Anthropic request timed out after ${this.timeout}ms`);
      }

      throw error;
    }
  }
}
