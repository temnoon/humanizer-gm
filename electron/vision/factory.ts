/**
 * Vision Provider Factory
 *
 * Creates and manages vision provider instances.
 * Handles provider selection, configuration, and fallback.
 */

import type {
  VisionProvider,
  VisionProviderConfig,
  VisionProviderFactory as IVisionProviderFactory,
  VisionProviderType,
} from './types';
import { OllamaVisionProvider } from './providers/ollama';
import { OpenAIVisionProvider } from './providers/openai';
import { AnthropicVisionProvider } from './providers/anthropic';
import { CloudflareVisionProvider } from './providers/cloudflare';

// ═══════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════

export class VisionProviderFactory implements IVisionProviderFactory {
  private configs: Map<VisionProviderType, VisionProviderConfig> = new Map();
  private instances: Map<VisionProviderType, VisionProvider> = new Map();

  constructor(configs?: Partial<Record<VisionProviderType, VisionProviderConfig>>) {
    if (configs) {
      for (const [type, config] of Object.entries(configs)) {
        if (config) {
          this.configs.set(type as VisionProviderType, config);
        }
      }
    }
  }

  /**
   * Configure a provider
   */
  configure(config: VisionProviderConfig): void {
    this.configs.set(config.type, config);
    // Clear cached instance so it's recreated with new config
    this.instances.delete(config.type);
  }

  /**
   * Create a provider instance
   */
  create(config: VisionProviderConfig): VisionProvider {
    switch (config.type) {
      case 'ollama':
        return new OllamaVisionProvider(config);

      case 'openai':
        return new OpenAIVisionProvider(config);

      case 'anthropic':
        return new AnthropicVisionProvider(config);

      case 'cloudflare':
        return new CloudflareVisionProvider(config);

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  /**
   * Get a provider instance (cached)
   */
  get(type: VisionProviderType): VisionProvider | null {
    // Check cache
    const cached = this.instances.get(type);
    if (cached) return cached;

    // Check config
    const config = this.configs.get(type);
    if (!config) return null;

    // Create and cache
    try {
      const instance = this.create(config);
      this.instances.set(type, instance);
      return instance;
    } catch {
      return null;
    }
  }

  /**
   * Get the best available provider
   * Priority: ollama (local) > openai > anthropic > cloudflare
   */
  async getBestProvider(): Promise<VisionProvider | null> {
    const priority: VisionProviderType[] = ['ollama', 'openai', 'anthropic', 'cloudflare'];

    for (const type of priority) {
      const provider = this.get(type);
      if (provider) {
        try {
          const available = await provider.isAvailable();
          if (available) {
            return provider;
          }
        } catch {
          // Continue to next provider
        }
      }
    }

    return null;
  }

  /**
   * Get first available provider from a list
   */
  async getFirstAvailable(types: VisionProviderType[]): Promise<VisionProvider | null> {
    for (const type of types) {
      const provider = this.get(type);
      if (provider) {
        try {
          const available = await provider.isAvailable();
          if (available) {
            return provider;
          }
        } catch {
          // Continue to next provider
        }
      }
    }

    return null;
  }

  /**
   * List all configured providers
   */
  listProviders(): VisionProviderType[] {
    return Array.from(this.configs.keys());
  }

  /**
   * List available providers (that pass isAvailable check)
   */
  async listAvailableProviders(): Promise<VisionProviderType[]> {
    const available: VisionProviderType[] = [];

    for (const type of this.configs.keys()) {
      const provider = this.get(type);
      if (provider) {
        try {
          if (await provider.isAvailable()) {
            available.push(type);
          }
        } catch {
          // Skip unavailable
        }
      }
    }

    return available;
  }

  /**
   * Check if any provider is available
   */
  async hasAnyProvider(): Promise<boolean> {
    return (await this.getBestProvider()) !== null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULT FACTORY INSTANCE
// ═══════════════════════════════════════════════════════════════════

let defaultFactory: VisionProviderFactory | null = null;

/**
 * Get the default factory instance
 */
export function getVisionProviderFactory(): VisionProviderFactory {
  if (!defaultFactory) {
    defaultFactory = new VisionProviderFactory();

    // Auto-configure Ollama with defaults
    defaultFactory.configure({
      type: 'ollama',
      endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434',
    });
  }

  return defaultFactory;
}

/**
 * Initialize the factory with configurations
 */
export function initVisionProviders(
  configs: Partial<Record<VisionProviderType, VisionProviderConfig>>
): VisionProviderFactory {
  defaultFactory = new VisionProviderFactory(configs);
  return defaultFactory;
}

/**
 * Quick helper to get a provider
 */
export function getVisionProvider(type: VisionProviderType): VisionProvider | null {
  return getVisionProviderFactory().get(type);
}

/**
 * Quick helper to get best available provider
 */
export async function getBestVisionProvider(): Promise<VisionProvider | null> {
  return getVisionProviderFactory().getBestProvider();
}
