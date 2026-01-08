/**
 * Model Router Service
 *
 * Routes AI tasks to appropriate models based on:
 * - Task type (quick analysis, deep analysis, draft generation)
 * - User preference (local-only, cloud-when-needed, cloud-preferred)
 * - Model availability
 * - Cost estimation
 *
 * Supports:
 * - Local: Ollama models (gemma3, qwen3, llama3, mistral)
 * - Cloud: Anthropic (Claude), Cloudflare Workers AI
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type ModelProvider = 'ollama' | 'anthropic' | 'cloudflare';
export type ModelTier = 'fast' | 'balanced' | 'quality';
export type UserPreference = 'local-only' | 'cloud-when-needed' | 'cloud-preferred';

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  tier: ModelTier;
  maxTokens: number;
  costPer1kTokens: number; // USD (0 for local)
  capabilities: string[];
}

export interface RouterConfig {
  preference: UserPreference;
  anthropicApiKey?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  ollamaEndpoint?: string;
}

export interface GenerationRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  taskType?: 'quick-analysis' | 'deep-analysis' | 'draft' | 'final';
  systemPrompt?: string;
}

export interface GenerationResult {
  success: boolean;
  text?: string;
  error?: string;
  model: {
    provider: ModelProvider;
    modelId: string;
    tier: ModelTier;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
  };
  latencyMs: number;
}

// ═══════════════════════════════════════════════════════════════════
// MODEL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

const OLLAMA_MODELS: ModelConfig[] = [
  {
    provider: 'ollama',
    modelId: 'gemma3:4b',
    tier: 'fast',
    maxTokens: 4096,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis', 'summarization'],
  },
  {
    provider: 'ollama',
    modelId: 'llama3.2:3b',
    tier: 'fast',
    maxTokens: 4096,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis'],
  },
  {
    provider: 'ollama',
    modelId: 'mistral:7b',
    tier: 'balanced',
    maxTokens: 8192,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis', 'code'],
  },
  {
    provider: 'ollama',
    modelId: 'qwen3:14b',
    tier: 'quality',
    maxTokens: 8192,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis', 'reasoning', 'multilingual'],
  },
  {
    provider: 'ollama',
    modelId: 'gemma3:12b',
    tier: 'quality',
    maxTokens: 8192,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis', 'reasoning'],
  },
];

const ANTHROPIC_MODELS: ModelConfig[] = [
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku-20241022',
    tier: 'fast',
    maxTokens: 8192,
    costPer1kTokens: 0.001, // $1/MTok input, $5/MTok output averaged
    capabilities: ['generation', 'analysis', 'code'],
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    tier: 'balanced',
    maxTokens: 8192,
    costPer1kTokens: 0.006,
    capabilities: ['generation', 'analysis', 'reasoning', 'code', 'creative'],
  },
  {
    provider: 'anthropic',
    modelId: 'claude-opus-4-20250514',
    tier: 'quality',
    maxTokens: 8192,
    costPer1kTokens: 0.03,
    capabilities: ['generation', 'analysis', 'reasoning', 'creative', 'complex'],
  },
];

const CLOUDFLARE_MODELS: ModelConfig[] = [
  {
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3-8b-instruct',
    tier: 'fast',
    maxTokens: 2048,
    costPer1kTokens: 0, // Free tier
    capabilities: ['generation', 'analysis'],
  },
  {
    provider: 'cloudflare',
    modelId: '@cf/mistral/mistral-7b-instruct-v0.1',
    tier: 'balanced',
    maxTokens: 2048,
    costPer1kTokens: 0,
    capabilities: ['generation', 'analysis'],
  },
];

// ═══════════════════════════════════════════════════════════════════
// MODEL ROUTER CLASS
// ═══════════════════════════════════════════════════════════════════

export class ModelRouter {
  private config: RouterConfig;
  private ollamaAvailable: boolean | null = null;

  constructor(config: RouterConfig) {
    this.config = {
      ollamaEndpoint: 'http://localhost:11434',
      ...config,
    };
  }

  /**
   * Check if Ollama is available
   */
  async checkOllamaAvailable(): Promise<boolean> {
    if (this.ollamaAvailable !== null) {
      return this.ollamaAvailable;
    }

    try {
      const response = await fetch(`${this.config.ollamaEndpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      this.ollamaAvailable = response.ok;
    } catch {
      this.ollamaAvailable = false;
    }

    return this.ollamaAvailable;
  }

  /**
   * Get available Ollama models
   */
  async getAvailableOllamaModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.ollamaEndpoint}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models || []).map((m: { name: string }) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Select the best model for a task
   */
  async selectModel(taskType: GenerationRequest['taskType'] = 'deep-analysis'): Promise<ModelConfig> {
    const { preference } = this.config;

    // Determine required tier
    let requiredTier: ModelTier;
    switch (taskType) {
      case 'quick-analysis':
        requiredTier = 'fast';
        break;
      case 'deep-analysis':
      case 'draft':
        requiredTier = 'balanced';
        break;
      case 'final':
        requiredTier = 'quality';
        break;
      default:
        requiredTier = 'balanced';
    }

    // Try models based on preference
    if (preference === 'local-only' || preference === 'cloud-when-needed') {
      // Try Ollama first
      const ollamaAvailable = await this.checkOllamaAvailable();
      if (ollamaAvailable) {
        const availableModels = await this.getAvailableOllamaModels();
        const matchingOllama = OLLAMA_MODELS.filter(
          (m) => m.tier === requiredTier && availableModels.some((am) => am.startsWith(m.modelId.split(':')[0]))
        );
        if (matchingOllama.length > 0) {
          return matchingOllama[0];
        }
        // Fall back to any available Ollama model
        const anyOllama = OLLAMA_MODELS.find((m) =>
          availableModels.some((am) => am.startsWith(m.modelId.split(':')[0]))
        );
        if (anyOllama) return anyOllama;
      }

      if (preference === 'local-only') {
        throw new Error('No local models available and preference is local-only');
      }
    }

    // Try cloud models
    if (this.config.anthropicApiKey) {
      const matchingAnthropic = ANTHROPIC_MODELS.find((m) => m.tier === requiredTier);
      if (matchingAnthropic) return matchingAnthropic;
      return ANTHROPIC_MODELS[0]; // Default to fastest
    }

    if (this.config.cloudflareAccountId && this.config.cloudflareApiToken) {
      const matchingCf = CLOUDFLARE_MODELS.find((m) => m.tier === requiredTier);
      if (matchingCf) return matchingCf;
      return CLOUDFLARE_MODELS[0];
    }

    // Last resort: try Ollama anyway
    const ollamaAvailable = await this.checkOllamaAvailable();
    if (ollamaAvailable) {
      return OLLAMA_MODELS[0];
    }

    throw new Error('No models available. Configure Ollama, Anthropic, or Cloudflare.');
  }

  /**
   * Generate text using the appropriate model
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const startTime = Date.now();

    try {
      const model = await this.selectModel(request.taskType);
      let result: GenerationResult;

      switch (model.provider) {
        case 'ollama':
          result = await this.generateOllama(model, request);
          break;
        case 'anthropic':
          result = await this.generateAnthropic(model, request);
          break;
        case 'cloudflare':
          result = await this.generateCloudflare(model, request);
          break;
        default:
          throw new Error(`Unknown provider: ${model.provider}`);
      }

      result.latencyMs = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        model: { provider: 'ollama', modelId: 'unknown', tier: 'fast' },
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Generate using Ollama
   */
  private async generateOllama(model: ModelConfig, request: GenerationRequest): Promise<GenerationResult> {
    const response = await fetch(`${this.config.ollamaEndpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.modelId,
        prompt: request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? model.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    const promptTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
    const completionTokens = Math.ceil((data.response?.length || 0) / 4);

    return {
      success: true,
      text: data.response || '',
      model: { provider: model.provider, modelId: model.modelId, tier: model.tier },
      usage: {
        promptTokens,
        completionTokens,
        estimatedCost: 0, // Ollama is free
      },
      latencyMs: 0,
    };
  }

  /**
   * Generate using Anthropic
   */
  private async generateAnthropic(model: ModelConfig, request: GenerationRequest): Promise<GenerationResult> {
    if (!this.config.anthropicApiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.modelId,
        max_tokens: request.maxTokens ?? model.maxTokens,
        messages: [{ role: 'user', content: request.prompt }],
        system: request.systemPrompt,
        temperature: request.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Anthropic error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const usage = data.usage || {};

    return {
      success: true,
      text,
      model: { provider: model.provider, modelId: model.modelId, tier: model.tier },
      usage: {
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        estimatedCost: ((usage.input_tokens || 0) + (usage.output_tokens || 0)) * model.costPer1kTokens / 1000,
      },
      latencyMs: 0,
    };
  }

  /**
   * Generate using Cloudflare Workers AI
   */
  private async generateCloudflare(model: ModelConfig, request: GenerationRequest): Promise<GenerationResult> {
    if (!this.config.cloudflareAccountId || !this.config.cloudflareApiToken) {
      throw new Error('Cloudflare credentials not configured');
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.cloudflareAccountId}/ai/run/${model.modelId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.cloudflareApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt,
          max_tokens: request.maxTokens ?? model.maxTokens,
          temperature: request.temperature ?? 0.7,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Cloudflare error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.result?.response || '';

    return {
      success: true,
      text,
      model: { provider: model.provider, modelId: model.modelId, tier: model.tier },
      usage: {
        promptTokens: Math.ceil(request.prompt.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        estimatedCost: 0, // Cloudflare free tier
      },
      latencyMs: 0,
    };
  }

  /**
   * Estimate cost for a generation request
   */
  async estimateCost(request: GenerationRequest): Promise<{ model: ModelConfig; estimatedCost: number }> {
    const model = await this.selectModel(request.taskType);
    const promptTokens = Math.ceil(request.prompt.length / 4);
    const estimatedCompletionTokens = request.maxTokens || 1000;
    const totalTokens = promptTokens + estimatedCompletionTokens;
    const estimatedCost = (totalTokens * model.costPer1kTokens) / 1000;

    return { model, estimatedCost };
  }

  /**
   * Get all available models
   */
  async listAvailableModels(): Promise<ModelConfig[]> {
    const available: ModelConfig[] = [];

    // Check Ollama
    const ollamaAvailable = await this.checkOllamaAvailable();
    if (ollamaAvailable) {
      const ollamaModels = await this.getAvailableOllamaModels();
      OLLAMA_MODELS.forEach((m) => {
        if (ollamaModels.some((om) => om.startsWith(m.modelId.split(':')[0]))) {
          available.push(m);
        }
      });
    }

    // Add Anthropic if configured
    if (this.config.anthropicApiKey) {
      available.push(...ANTHROPIC_MODELS);
    }

    // Add Cloudflare if configured
    if (this.config.cloudflareAccountId && this.config.cloudflareApiToken) {
      available.push(...CLOUDFLARE_MODELS);
    }

    return available;
  }
}

// Singleton instance
let routerInstance: ModelRouter | null = null;

export function getModelRouter(config?: RouterConfig): ModelRouter {
  if (!routerInstance && config) {
    routerInstance = new ModelRouter(config);
  }
  if (!routerInstance) {
    routerInstance = new ModelRouter({ preference: 'local-only' });
  }
  return routerInstance;
}

export function configureModelRouter(config: RouterConfig): ModelRouter {
  routerInstance = new ModelRouter(config);
  return routerInstance;
}

export default {
  ModelRouter,
  getModelRouter,
  configureModelRouter,
};
