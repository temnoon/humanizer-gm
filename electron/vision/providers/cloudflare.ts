/**
 * Cloudflare Vision Provider
 *
 * Connects to Cloudflare Workers AI for vision inference.
 * Supports: @cf/llava-hf/llava-1.5-7b-hf, @cf/uform-gen2-qwen-500m
 *
 * Note: This provider is designed for use in Cloudflare Workers environment.
 * For Electron use, it connects via REST API to a Cloudflare Worker endpoint.
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
// CLOUDFLARE PROVIDER
// ═══════════════════════════════════════════════════════════════════

export class CloudflareVisionProvider implements VisionProvider {
  readonly type: VisionProviderType = 'cloudflare';
  readonly defaultModel: string;

  private endpoint: string;
  private accountId: string;
  private apiToken: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: VisionProviderConfig) {
    // For Cloudflare, apiKey should be the API token
    // endpoint should include account ID or be a worker URL
    if (!config.apiKey) {
      throw new Error('Cloudflare API token required');
    }

    // Parse account ID from endpoint or use default
    // Format: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run
    const accountMatch = config.endpoint?.match(/accounts\/([^/]+)/);
    this.accountId = accountMatch?.[1] || '';

    this.endpoint = config.endpoint || `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`;
    this.apiToken = config.apiKey;
    this.timeout = config.timeout || 60000;
    this.maxRetries = config.maxRetries || 2;
    this.defaultModel = config.model || getDefaultModel('cloudflare');
  }

  /**
   * Check if Cloudflare is available
   */
  async isAvailable(): Promise<boolean> {
    // Cloudflare doesn't have a simple health check
    // Verify we have required credentials
    return !!(this.apiToken && this.accountId);
  }

  /**
   * List available vision models
   */
  async listModels(): Promise<string[]> {
    // Cloudflare vision models are known statically
    return [
      '@cf/llava-hf/llava-1.5-7b-hf',
      '@cf/uform-gen2-qwen-500m',
    ];
  }

  /**
   * Analyze an image
   */
  async analyze(request: VisionRequest, model?: string): Promise<VisionResult> {
    const startTime = Date.now();
    const modelId = model || this.defaultModel;

    // Get image as base64
    const base64Image = await this.getImageBase64(request);

    // Build prompt
    const prompt = request.prompt || DEFAULT_ANALYSIS_PROMPT.userPrompt;

    // Make request with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callCloudflare(
          modelId,
          base64Image,
          prompt,
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
          confidence: 0.8,
          model: modelId,
          provider: 'cloudflare',
          processingTimeMs: Date.now() - startTime,
          rawOutput: result,
          filtered: filtered.hadCodeBlock || filtered.hadPreamble,
          filterStrategy: filtered.strategy,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on auth errors
        if (lastError.message.includes('authentication') ||
            lastError.message.includes('unauthorized')) {
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
      type: 'cloudflare',
      endpoint: this.endpoint,
      model: this.defaultModel,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      // Don't expose API token
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════

  private async getImageBase64(request: VisionRequest): Promise<string> {
    if (request.imageBase64) {
      return request.imageBase64;
    }

    if (request.imageBuffer) {
      return request.imageBuffer.toString('base64');
    }

    if (request.imageUrl) {
      if (request.imageUrl.startsWith('http')) {
        // Fetch remote URL
        const response = await fetch(request.imageUrl);
        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
      } else {
        // Local file
        const filePath = request.imageUrl.replace('file://', '');
        const buffer = await fs.promises.readFile(filePath);
        return buffer.toString('base64');
      }
    }

    throw new Error('No image provided in request');
  }

  private async callCloudflare(
    model: string,
    base64Image: string,
    prompt: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Cloudflare AI uses model-specific endpoints
      const modelPath = model.replace('@cf/', '').replace(/\//g, '-');
      const url = `${this.endpoint}/${model}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: base64Image,
          prompt: prompt,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errors = (errorData as { errors?: Array<{ message: string }> }).errors;
        const errorMessage = errors?.[0]?.message || response.statusText;
        throw new Error(`Cloudflare error ${response.status}: ${errorMessage}`);
      }

      const data = await response.json();

      // Cloudflare returns { result: { response: "..." } }
      return data.result?.response || data.result?.description || JSON.stringify(data.result);
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Cloudflare request timed out after ${this.timeout}ms`);
      }

      throw error;
    }
  }
}
