/**
 * Ollama Vision Provider
 *
 * Connects to local Ollama instance for vision model inference.
 * Supports: llava, qwen2-vl, qwen3-vl, llama3.2-vision, minicpm-v
 */

import * as fs from 'fs';
import * as path from 'path';
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
// OLLAMA PROVIDER
// ═══════════════════════════════════════════════════════════════════

export class OllamaVisionProvider implements VisionProvider {
  readonly type: VisionProviderType = 'ollama';
  readonly defaultModel: string;

  private endpoint: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: VisionProviderConfig) {
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.timeout = config.timeout || 90000; // 90s default for vision
    this.maxRetries = config.maxRetries || 2;
    this.defaultModel = config.model || getDefaultModel('ollama');
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.endpoint}/api/tags`, {
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
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      if (!response.ok) return [];

      const data = await response.json();
      const models: string[] = data.models?.map((m: { name: string }) => m.name) || [];

      // Filter to known vision models
      const visionModelPatterns = [
        'llava',
        'qwen2-vl',
        'qwen3-vl',
        'llama3.2-vision',
        'minicpm-v',
        'bakllava',
      ];

      return models.filter(model =>
        visionModelPatterns.some(pattern =>
          model.toLowerCase().includes(pattern)
        )
      );
    } catch {
      return [];
    }
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
    const systemPrompt = request.systemPrompt || DEFAULT_ANALYSIS_PROMPT.systemPrompt;

    // Make request with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.callOllama(
          modelId,
          base64Image,
          prompt,
          systemPrompt,
          request.temperature,
        );

        // Filter output
        const filtered = filterVisionOutput(result.response, modelId);

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
          confidence: 0.8, // Ollama doesn't provide confidence
          model: modelId,
          provider: 'ollama',
          processingTimeMs: Date.now() - startTime,
          rawOutput: result.response,
          filtered: filtered.hadThinkingTags || filtered.hadPreamble || filtered.hadCodeBlock,
          filterStrategy: filtered.strategy,
          hadThinkingTags: filtered.hadThinkingTags,
          hadPreamble: filtered.hadPreamble,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on non-retriable errors
        if (lastError.message.includes('model not found')) {
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
      type: 'ollama',
      endpoint: this.endpoint,
      model: this.defaultModel,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
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
      // Fetch image from URL
      if (request.imageUrl.startsWith('file://') || request.imageUrl.startsWith('/')) {
        // Local file
        const filePath = request.imageUrl.replace('file://', '');
        const buffer = await fs.promises.readFile(filePath);
        return buffer.toString('base64');
      } else {
        // Remote URL
        const response = await fetch(request.imageUrl);
        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
      }
    }

    throw new Error('No image provided in request');
  }

  private async callOllama(
    model: string,
    base64Image: string,
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
  ): Promise<{ response: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const body: Record<string, unknown> = {
        model,
        prompt,
        images: [base64Image],
        stream: false,
        options: {
          temperature: temperature ?? 0.3,
        },
      };

      if (systemPrompt) {
        body.system = systemPrompt;
      }

      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.timeout}ms`);
      }

      throw error;
    }
  }
}
