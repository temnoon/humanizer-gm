/**
 * ConfigService - Centralized Configuration Management for Archive Server
 *
 * Manages all configuration sections:
 * - harvest: Smart harvest settings (target, searchLimit, minWordCount, etc.)
 * - cache: Health TTL, search debounce
 * - retrieval.qualityGate: Target count, search limit, min quality
 * - retrieval.hybrid: Dense/sparse weights, fusion settings
 * - rateLimit: Search rate limiting settings
 *
 * Storage: ~/.humanizer/config/archive-config.json
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface HarvestConfig {
  defaultTarget: number;
  searchLimit: number;
  minWordCount: number;
  expandBreadcrumbs: boolean;
  contextSize: number;
  prioritizeConversations: boolean;
}

export interface CacheConfig {
  healthTtlMs: number;
  searchDebounceMs: number;
  embeddingCacheTtlMs: number;
}

export interface QualityGateConfig {
  targetCount: number;
  searchLimit: number;
  minQuality: number;
  minWordCount: number;
}

export interface HybridSearchConfig {
  denseWeight: number;
  sparseWeight: number;
  limit: number;
  fusionK: number;
}

export interface RetrievalConfig {
  qualityGate: QualityGateConfig;
  hybrid: HybridSearchConfig;
}

export interface RateLimitConfig {
  searchMaxRequests: number;
  searchWindowMs: number;
  importMaxRequests: number;
  importWindowMs: number;
}

export interface PyramidConfig {
  /** Chunks to combine per summary (default: 5) */
  chunksPerSummary: number;
  /** Target words for L1 summaries (default: 150) */
  targetSummaryWords: number;
  /** Target words for apex synthesis (default: 300) */
  targetApexWords: number;
  /** Default summarization model (default: 'llama3.2') */
  summarizationModel: string;
}

export interface EmbeddingsConfig {
  /** Vector dimensions (default: 768) */
  dimensions: number;
  /** Batch size for embedding operations (default: 32) */
  batchSize: number;
  /** Maximum chunk size in chars (default: 4000) */
  maxChunkChars: number;
  /** Target chunk size in chars (default: 2000) */
  targetChunkChars: number;
  /** Minimum chunk size in chars (default: 200) */
  minChunkChars: number;
}

export interface ArchiveServerConfig {
  harvest: HarvestConfig;
  cache: CacheConfig;
  retrieval: RetrievalConfig;
  rateLimit: RateLimitConfig;
  pyramid: PyramidConfig;
  embeddings: EmbeddingsConfig;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: ArchiveServerConfig = {
  harvest: {
    defaultTarget: 20,
    searchLimit: 100,
    minWordCount: 75, // Require substantive content (~75 words minimum)
    expandBreadcrumbs: true,
    contextSize: 3, // More context for breadcrumbs
    prioritizeConversations: true,
  },
  cache: {
    healthTtlMs: 60000, // 1 minute
    searchDebounceMs: 300,
    embeddingCacheTtlMs: 3600000, // 1 hour
  },
  retrieval: {
    qualityGate: {
      targetCount: 40,
      searchLimit: 200,
      minQuality: 0.3,
      minWordCount: 75, // Require substantive content
    },
    hybrid: {
      denseWeight: 0.7,
      sparseWeight: 0.3,
      limit: 100,
      fusionK: 60,
    },
  },
  rateLimit: {
    searchMaxRequests: 100,
    searchWindowMs: 60000, // 1 minute
    importMaxRequests: 10,
    importWindowMs: 300000, // 5 minutes
  },
  pyramid: {
    chunksPerSummary: 5,
    targetSummaryWords: 150,
    targetApexWords: 300,
    summarizationModel: 'llama3.2',
  },
  embeddings: {
    dimensions: 768,
    batchSize: 32,
    maxChunkChars: 4000,
    targetChunkChars: 2000,
    minChunkChars: 200,
  },
};

// ============================================================================
// Service
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.humanizer', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'archive-server-config.json');

class ConfigService {
  private config: ArchiveServerConfig | null = null;
  private initialized = false;

  /**
   * Initialize the configuration service
   * Loads from disk or creates defaults
   */
  async init(): Promise<ArchiveServerConfig> {
    if (this.initialized && this.config) {
      return this.config;
    }

    try {
      // Ensure config directory exists
      await fs.mkdir(CONFIG_DIR, { recursive: true });

      // Try to load existing config
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      const loaded = JSON.parse(data);

      // Merge with defaults to handle missing keys
      this.config = this.mergeWithDefaults(loaded);
      this.initialized = true;

      console.log('[ConfigService] Loaded config from disk');
      return this.config;
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      this.config = { ...DEFAULT_CONFIG };
      this.initialized = true;

      // Save defaults to disk
      await this.save();
      console.log('[ConfigService] Created default config');
      return this.config;
    }
  }

  /**
   * Get the full configuration
   */
  getAll(): ArchiveServerConfig {
    if (!this.config) {
      throw new Error('ConfigService not initialized. Call init() first.');
    }
    return { ...this.config };
  }

  /**
   * Get a specific section
   */
  getSection<K extends keyof ArchiveServerConfig>(
    section: K
  ): ArchiveServerConfig[K] {
    if (!this.config) {
      throw new Error('ConfigService not initialized. Call init() first.');
    }
    return { ...this.config[section] };
  }

  /**
   * Update a specific section
   */
  async updateSection<K extends keyof ArchiveServerConfig>(
    section: K,
    values: Partial<ArchiveServerConfig[K]>
  ): Promise<ArchiveServerConfig[K]> {
    if (!this.config) {
      throw new Error('ConfigService not initialized. Call init() first.');
    }

    // Deep merge for nested objects
    if (section === 'retrieval') {
      const currentRetrieval = this.config.retrieval as RetrievalConfig;
      const newValues = values as Partial<RetrievalConfig>;

      this.config.retrieval = {
        qualityGate: {
          ...currentRetrieval.qualityGate,
          ...(newValues.qualityGate || {}),
        },
        hybrid: {
          ...currentRetrieval.hybrid,
          ...(newValues.hybrid || {}),
        },
      };
    } else {
      this.config[section] = {
        ...this.config[section],
        ...values,
      } as ArchiveServerConfig[K];
    }

    await this.save();
    return this.getSection(section);
  }

  /**
   * Reset all config to defaults
   */
  async reset(): Promise<ArchiveServerConfig> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
    return this.getAll();
  }

  /**
   * Reset a specific section to defaults
   */
  async resetSection<K extends keyof ArchiveServerConfig>(
    section: K
  ): Promise<ArchiveServerConfig[K]> {
    if (!this.config) {
      throw new Error('ConfigService not initialized. Call init() first.');
    }

    this.config[section] = { ...DEFAULT_CONFIG[section] } as ArchiveServerConfig[K];
    await this.save();
    return this.getSection(section);
  }

  /**
   * Save config to disk
   */
  private async save(): Promise<void> {
    if (!this.config) return;

    try {
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(
        CONFIG_FILE,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[ConfigService] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Deep merge loaded config with defaults to handle missing keys
   */
  private mergeWithDefaults(loaded: Partial<ArchiveServerConfig>): ArchiveServerConfig {
    return {
      harvest: {
        ...DEFAULT_CONFIG.harvest,
        ...(loaded.harvest || {}),
      },
      cache: {
        ...DEFAULT_CONFIG.cache,
        ...(loaded.cache || {}),
      },
      retrieval: {
        qualityGate: {
          ...DEFAULT_CONFIG.retrieval.qualityGate,
          ...(loaded.retrieval?.qualityGate || {}),
        },
        hybrid: {
          ...DEFAULT_CONFIG.retrieval.hybrid,
          ...(loaded.retrieval?.hybrid || {}),
        },
      },
      rateLimit: {
        ...DEFAULT_CONFIG.rateLimit,
        ...(loaded.rateLimit || {}),
      },
      pyramid: {
        ...DEFAULT_CONFIG.pyramid,
        ...(loaded.pyramid || {}),
      },
      embeddings: {
        ...DEFAULT_CONFIG.embeddings,
        ...(loaded.embeddings || {}),
      },
    };
  }
}

// Singleton instance
export const configService = new ConfigService();
