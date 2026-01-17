/**
 * Fallback Router
 *
 * Tries providers in priority order, with automatic failover on errors.
 * Tracks failed providers and skips them temporarily to improve response times.
 */

import type { LLMProvider, LLMRequest, LLMResponse, ProviderType } from './types';
import { createLLMProvider, getModelConfig } from './index';

interface ProviderFailure {
  lastFailure: number;
  failCount: number;
}

// Track failures per provider
const providerFailures = new Map<ProviderType, ProviderFailure>();

// How long to skip a failed provider (ms)
const FAILURE_COOLDOWN = 60_000; // 1 minute

// Max failures before longer cooldown
const MAX_FAILURES = 3;
const EXTENDED_COOLDOWN = 300_000; // 5 minutes

/**
 * Check if a provider should be skipped due to recent failures
 */
function shouldSkipProvider(provider: ProviderType): boolean {
  const failure = providerFailures.get(provider);
  if (!failure) return false;

  const cooldown = failure.failCount >= MAX_FAILURES ? EXTENDED_COOLDOWN : FAILURE_COOLDOWN;
  const timeSinceFailure = Date.now() - failure.lastFailure;

  return timeSinceFailure < cooldown;
}

/**
 * Record a provider failure
 */
function recordFailure(provider: ProviderType): void {
  const existing = providerFailures.get(provider);
  providerFailures.set(provider, {
    lastFailure: Date.now(),
    failCount: (existing?.failCount ?? 0) + 1,
  });
}

/**
 * Record a provider success (resets failure count)
 */
function recordSuccess(provider: ProviderType): void {
  providerFailures.delete(provider);
}

/**
 * Get current provider health status
 */
export function getProviderHealth(): Map<ProviderType, { available: boolean; failCount: number; cooldownRemaining: number }> {
  const health = new Map<ProviderType, { available: boolean; failCount: number; cooldownRemaining: number }>();
  const providers: ProviderType[] = ['ollama', 'openai', 'anthropic', 'cloudflare', 'openrouter', 'together'];

  for (const provider of providers) {
    const failure = providerFailures.get(provider);
    if (!failure) {
      health.set(provider, { available: true, failCount: 0, cooldownRemaining: 0 });
    } else {
      const cooldown = failure.failCount >= MAX_FAILURES ? EXTENDED_COOLDOWN : FAILURE_COOLDOWN;
      const remaining = Math.max(0, cooldown - (Date.now() - failure.lastFailure));
      health.set(provider, {
        available: remaining === 0,
        failCount: failure.failCount,
        cooldownRemaining: remaining,
      });
    }
  }

  return health;
}

/**
 * Reset all provider failure tracking
 */
export function resetProviderHealth(): void {
  providerFailures.clear();
}

/**
 * Default provider priority order
 * Local first, then fast cloud providers, then premium
 */
export const DEFAULT_PROVIDER_PRIORITY: ProviderType[] = [
  'ollama',      // Local - no cost, fastest if available
  'together',    // Fast, cheap, good open-source models
  'cloudflare',  // Fast edge inference
  'openrouter',  // Aggregator with fallback options
  'openai',      // Premium
  'anthropic',   // Premium
];

export interface FallbackOptions {
  /** Provider priority order (default: local first, then cloud) */
  providerPriority?: ProviderType[];
  /** Skip providers that recently failed */
  skipFailedProviders?: boolean;
  /** Maximum providers to try before giving up */
  maxAttempts?: number;
  /** Timeout per provider attempt (ms) */
  timeoutPerAttempt?: number;
}

/**
 * Fallback Router - tries providers in order until one succeeds
 */
export class FallbackRouter implements LLMProvider {
  private options: Required<FallbackOptions>;

  constructor(
    private preferredModel: string,
    options?: FallbackOptions
  ) {
    this.options = {
      providerPriority: options?.providerPriority ?? DEFAULT_PROVIDER_PRIORITY,
      skipFailedProviders: options?.skipFailedProviders ?? true,
      maxAttempts: options?.maxAttempts ?? 3,
      timeoutPerAttempt: options?.timeoutPerAttempt ?? 30_000,
    };
  }

  async call(request: LLMRequest): Promise<LLMResponse> {
    const errors: string[] = [];
    let attempts = 0;

    for (const providerType of this.options.providerPriority) {
      if (attempts >= this.options.maxAttempts) {
        break;
      }

      // Skip providers on cooldown
      if (this.options.skipFailedProviders && shouldSkipProvider(providerType)) {
        console.log(`[fallback-router] Skipping ${providerType} (on cooldown)`);
        continue;
      }

      attempts++;

      try {
        // Get model for this provider
        const model = this.getModelForProvider(providerType);

        // Create provider
        const provider = await createLLMProvider(model);

        // Check availability
        if (!(await provider.isAvailable())) {
          console.log(`[fallback-router] ${providerType} not available`);
          continue;
        }

        // Make the call with timeout
        const response = await this.callWithTimeout(provider, request);

        // Success!
        recordSuccess(providerType);
        console.log(`[fallback-router] Success with ${providerType}`);
        return response;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${providerType}: ${msg}`);
        recordFailure(providerType);
        console.warn(`[fallback-router] ${providerType} failed:`, msg);
      }
    }

    throw new Error(`All providers failed:\n${errors.join('\n')}`);
  }

  /**
   * Get appropriate model ID for a provider type
   */
  private getModelForProvider(providerType: ProviderType): string {
    // If preferred model matches this provider, use it directly
    const config = getModelConfig();

    switch (providerType) {
      case 'ollama':
        return config.defaultModel || 'llama3.2:3b';
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-haiku-20240307';
      case 'cloudflare':
        return '@cf/meta/llama-3.1-8b-instruct';
      case 'openrouter':
        return 'meta-llama/llama-3.1-8b-instruct';
      case 'together':
        return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
      default:
        return this.preferredModel;
    }
  }

  /**
   * Call provider with timeout
   */
  private async callWithTimeout(provider: LLMProvider, request: LLMRequest): Promise<LLMResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout after ${this.options.timeoutPerAttempt}ms`));
      }, this.options.timeoutPerAttempt);

      provider.call(request)
        .then((response) => {
          clearTimeout(timeout);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  getProviderName(): string {
    return 'fallback-router';
  }

  async isAvailable(): Promise<boolean> {
    // Available if any provider is available
    for (const providerType of this.options.providerPriority) {
      if (!shouldSkipProvider(providerType)) {
        return true;
      }
    }
    return false;
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
 * Create a fallback router with default settings
 */
export function createFallbackRouter(preferredModel?: string, options?: FallbackOptions): FallbackRouter {
  const config = getModelConfig();
  return new FallbackRouter(preferredModel || config.defaultModel, options);
}
