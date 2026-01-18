/**
 * AdapterRegistry - Manages content adapters for the Universal Content Graph
 *
 * The registry handles:
 * - Adapter registration and lookup
 * - Auto-detection of content formats
 * - Adapter lifecycle management
 */

import type {
  ContentAdapter,
  AdapterMetadata,
  DetectionResult,
  AdapterFactory,
  SourceType,
} from '@humanizer/core';

/**
 * Registered adapter entry
 */
interface RegisteredAdapter {
  metadata: AdapterMetadata;
  factory: AdapterFactory;
  instance?: ContentAdapter;
}

/**
 * AdapterRegistry - Central registry for content adapters
 */
export class AdapterRegistry {
  private adapters: Map<string, RegisteredAdapter> = new Map();

  /**
   * Register an adapter
   *
   * @param factory - Factory function to create the adapter
   * @param metadata - Optional metadata override
   */
  register<TInput = unknown>(
    factory: AdapterFactory<TInput>,
    metadata?: Partial<AdapterMetadata>
  ): void {
    // Create instance to extract metadata
    const instance = factory();

    const fullMetadata: AdapterMetadata = {
      id: instance.id,
      name: instance.name,
      sourceType: instance.sourceType,
      supportedFormats: instance.supportedFormats,
      version: instance.version,
      builtin: false,
      priority: 0,
      ...metadata,
    };

    this.adapters.set(instance.id, {
      metadata: fullMetadata,
      factory: factory as AdapterFactory,
      instance: instance as ContentAdapter,
    });

    console.log(`[AdapterRegistry] Registered adapter: ${instance.id} (${instance.name})`);
  }

  /**
   * Unregister an adapter
   */
  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  /**
   * Get an adapter by ID
   */
  get(id: string): ContentAdapter | undefined {
    const entry = this.adapters.get(id);
    if (!entry) return undefined;

    // Lazy instantiation
    if (!entry.instance) {
      entry.instance = entry.factory();
    }
    return entry.instance;
  }

  /**
   * Get adapter metadata
   */
  getMetadata(id: string): AdapterMetadata | undefined {
    return this.adapters.get(id)?.metadata;
  }

  /**
   * List all registered adapters
   */
  list(): AdapterMetadata[] {
    return Array.from(this.adapters.values())
      .map(entry => entry.metadata)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get adapters by source type
   */
  getBySourceType(sourceType: SourceType): ContentAdapter[] {
    return Array.from(this.adapters.values())
      .filter(entry => entry.metadata.sourceType === sourceType)
      .map(entry => {
        if (!entry.instance) {
          entry.instance = entry.factory();
        }
        return entry.instance;
      });
  }

  /**
   * Get adapters that support a file extension
   */
  getByExtension(extension: string): ContentAdapter[] {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    const extLower = ext.toLowerCase();

    return Array.from(this.adapters.values())
      .filter(entry =>
        entry.metadata.supportedFormats.some(
          f => f.toLowerCase() === extLower || f.toLowerCase() === extLower.slice(1)
        )
      )
      .sort((a, b) => b.metadata.priority - a.metadata.priority)
      .map(entry => {
        if (!entry.instance) {
          entry.instance = entry.factory();
        }
        return entry.instance;
      });
  }

  /**
   * Get adapters that support a MIME type
   */
  getByMimeType(mimeType: string): ContentAdapter[] {
    const mimeLower = mimeType.toLowerCase();

    return Array.from(this.adapters.values())
      .filter(entry =>
        entry.metadata.supportedFormats.some(f => f.toLowerCase() === mimeLower)
      )
      .sort((a, b) => b.metadata.priority - a.metadata.priority)
      .map(entry => {
        if (!entry.instance) {
          entry.instance = entry.factory();
        }
        return entry.instance;
      });
  }

  /**
   * Auto-detect the best adapter for input
   *
   * Runs detection on all adapters and returns the best match.
   *
   * @param input - The input to detect
   * @param hint - Optional hint (file extension, MIME type)
   * @returns Best matching adapter and detection result
   */
  async detect(
    input: unknown,
    hint?: { extension?: string; mimeType?: string }
  ): Promise<{ adapter: ContentAdapter; result: DetectionResult } | null> {
    // Get candidate adapters
    let candidates: ContentAdapter[];

    if (hint?.extension) {
      candidates = this.getByExtension(hint.extension);
    } else if (hint?.mimeType) {
      candidates = this.getByMimeType(hint.mimeType);
    } else {
      // Try all adapters, sorted by priority
      candidates = Array.from(this.adapters.values())
        .sort((a, b) => b.metadata.priority - a.metadata.priority)
        .map(entry => {
          if (!entry.instance) {
            entry.instance = entry.factory();
          }
          return entry.instance;
        });
    }

    // Run detection on each candidate
    let bestMatch: { adapter: ContentAdapter; result: DetectionResult } | null = null;
    let bestConfidence = 0;

    for (const adapter of candidates) {
      try {
        const result = await adapter.detect(input);
        if (result.canHandle && result.confidence > bestConfidence) {
          bestMatch = { adapter, result };
          bestConfidence = result.confidence;

          // Perfect match, stop searching
          if (result.confidence >= 1.0) {
            break;
          }
        }
      } catch (error) {
        console.warn(`[AdapterRegistry] Detection failed for ${adapter.id}:`, error);
      }
    }

    return bestMatch;
  }

  /**
   * Detect all adapters that can handle the input
   *
   * @param input - The input to detect
   * @returns All matching adapters with their detection results, sorted by confidence
   */
  async detectAll(
    input: unknown
  ): Promise<Array<{ adapter: ContentAdapter; result: DetectionResult }>> {
    const results: Array<{ adapter: ContentAdapter; result: DetectionResult }> = [];

    for (const entry of this.adapters.values()) {
      try {
        if (!entry.instance) {
          entry.instance = entry.factory();
        }
        const result = await entry.instance.detect(input);
        if (result.canHandle) {
          results.push({ adapter: entry.instance, result });
        }
      } catch (error) {
        console.warn(`[AdapterRegistry] Detection failed for ${entry.metadata.id}:`, error);
      }
    }

    // Sort by confidence (highest first)
    return results.sort((a, b) => b.result.confidence - a.result.confidence);
  }

  /**
   * Check if any adapter can handle the input
   */
  async canHandle(input: unknown): Promise<boolean> {
    const result = await this.detect(input);
    return result !== null;
  }

  /**
   * Get count of registered adapters
   */
  get count(): number {
    return this.adapters.size;
  }

  /**
   * Clear all registered adapters
   */
  clear(): void {
    this.adapters.clear();
  }
}

/**
 * Global adapter registry instance
 */
export const adapterRegistry = new AdapterRegistry();

/**
 * Register a built-in adapter
 */
export function registerBuiltinAdapter<TInput = unknown>(
  factory: AdapterFactory<TInput>,
  priority: number = 0
): void {
  adapterRegistry.register(factory, { builtin: true, priority });
}
