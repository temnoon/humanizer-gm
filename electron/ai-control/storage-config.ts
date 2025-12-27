/**
 * Storage & Indexing Configuration
 *
 * Manages embedding generation, vector storage, and content indexing
 * settings across the humanizer ecosystem.
 *
 * Key responsibilities:
 * - Embedding model selection and configuration
 * - Vector store connection management
 * - Content chunking strategies
 * - Indexing pipeline configuration
 */

import type {
  StorageConfig,
  AIProviderType,
} from './types';
import { getAdminConfig } from './admin-config';

// ═══════════════════════════════════════════════════════════════════
// EMBEDDING MODELS REGISTRY
// ═══════════════════════════════════════════════════════════════════

export interface EmbeddingModelProfile {
  modelId: string;
  provider: AIProviderType;
  displayName: string;
  dimensions: number;
  maxInputTokens: number;
  costPer1kTokens?: number;  // USD per 1K tokens
  local: boolean;
  notes?: string;
}

/**
 * Vetted embedding models
 */
export const EMBEDDING_MODELS: Record<string, EmbeddingModelProfile> = {
  // OpenAI
  'text-embedding-3-small': {
    modelId: 'text-embedding-3-small',
    provider: 'openai',
    displayName: 'OpenAI Embedding 3 Small',
    dimensions: 1536,
    maxInputTokens: 8191,
    costPer1kTokens: 0.00002,
    local: false,
    notes: 'Best balance of quality and cost',
  },
  'text-embedding-3-large': {
    modelId: 'text-embedding-3-large',
    provider: 'openai',
    displayName: 'OpenAI Embedding 3 Large',
    dimensions: 3072,
    maxInputTokens: 8191,
    costPer1kTokens: 0.00013,
    local: false,
    notes: 'Highest quality OpenAI embeddings',
  },
  'text-embedding-ada-002': {
    modelId: 'text-embedding-ada-002',
    provider: 'openai',
    displayName: 'OpenAI Ada 002',
    dimensions: 1536,
    maxInputTokens: 8191,
    costPer1kTokens: 0.0001,
    local: false,
    notes: 'Legacy, use embedding-3 instead',
  },

  // Ollama (local)
  'nomic-embed-text': {
    modelId: 'nomic-embed-text',
    provider: 'ollama',
    displayName: 'Nomic Embed Text',
    dimensions: 768,
    maxInputTokens: 8192,
    local: true,
    notes: 'Best local embedding model',
  },
  'mxbai-embed-large': {
    modelId: 'mxbai-embed-large',
    provider: 'ollama',
    displayName: 'MXBai Embed Large',
    dimensions: 1024,
    maxInputTokens: 512,
    local: true,
    notes: 'High quality but limited context',
  },
  'all-minilm': {
    modelId: 'all-minilm',
    provider: 'ollama',
    displayName: 'All MiniLM',
    dimensions: 384,
    maxInputTokens: 256,
    local: true,
    notes: 'Fast and lightweight',
  },
  'snowflake-arctic-embed': {
    modelId: 'snowflake-arctic-embed',
    provider: 'ollama',
    displayName: 'Snowflake Arctic Embed',
    dimensions: 1024,
    maxInputTokens: 512,
    local: true,
    notes: 'Good for retrieval tasks',
  },

  // Cohere
  'embed-english-v3.0': {
    modelId: 'embed-english-v3.0',
    provider: 'cohere',
    displayName: 'Cohere Embed English v3',
    dimensions: 1024,
    maxInputTokens: 512,
    costPer1kTokens: 0.0001,
    local: false,
    notes: 'Excellent for English text',
  },
  'embed-multilingual-v3.0': {
    modelId: 'embed-multilingual-v3.0',
    provider: 'cohere',
    displayName: 'Cohere Embed Multilingual v3',
    dimensions: 1024,
    maxInputTokens: 512,
    costPer1kTokens: 0.0001,
    local: false,
    notes: 'Supports 100+ languages',
  },

  // Cloudflare
  '@cf/baai/bge-base-en-v1.5': {
    modelId: '@cf/baai/bge-base-en-v1.5',
    provider: 'cloudflare',
    displayName: 'BGE Base EN (Cloudflare)',
    dimensions: 768,
    maxInputTokens: 512,
    local: false,
    notes: 'Fast edge inference',
  },
  '@cf/baai/bge-large-en-v1.5': {
    modelId: '@cf/baai/bge-large-en-v1.5',
    provider: 'cloudflare',
    displayName: 'BGE Large EN (Cloudflare)',
    dimensions: 1024,
    maxInputTokens: 512,
    local: false,
    notes: 'Higher quality edge embeddings',
  },
};

// ═══════════════════════════════════════════════════════════════════
// VECTOR STORE CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════

export interface VectorStoreProfile {
  type: StorageConfig['vectorStore'];
  displayName: string;
  local: boolean;
  persistent: boolean;
  supportsMetadata: boolean;
  supportsFiltering: boolean;
  maxDimensions?: number;
  notes?: string;
  defaultConfig?: Record<string, unknown>;
}

/**
 * Supported vector stores
 */
export const VECTOR_STORES: Record<StorageConfig['vectorStore'], VectorStoreProfile> = {
  'sqlite-vec': {
    type: 'sqlite-vec',
    displayName: 'SQLite-vec',
    local: true,
    persistent: true,
    supportsMetadata: true,
    supportsFiltering: true,
    notes: 'Built-in, no external dependencies',
    defaultConfig: {
      dbPath: '~/.humanizer/vectors.db',
    },
  },
  'local': {
    type: 'local',
    displayName: 'Local (In-Memory)',
    local: true,
    persistent: false,
    supportsMetadata: true,
    supportsFiltering: true,
    notes: 'Fast but not persistent',
  },
  'chroma': {
    type: 'chroma',
    displayName: 'ChromaDB',
    local: true,
    persistent: true,
    supportsMetadata: true,
    supportsFiltering: true,
    notes: 'Feature-rich, Python backend',
    defaultConfig: {
      host: 'localhost',
      port: 8000,
    },
  },
  'pinecone': {
    type: 'pinecone',
    displayName: 'Pinecone',
    local: false,
    persistent: true,
    supportsMetadata: true,
    supportsFiltering: true,
    maxDimensions: 20000,
    notes: 'Managed cloud vector DB',
    defaultConfig: {
      environment: 'us-east-1-aws',
    },
  },
  'qdrant': {
    type: 'qdrant',
    displayName: 'Qdrant',
    local: true,  // Can be self-hosted
    persistent: true,
    supportsMetadata: true,
    supportsFiltering: true,
    notes: 'High performance, self-hostable',
    defaultConfig: {
      host: 'localhost',
      port: 6333,
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// CHUNKING STRATEGIES
// ═══════════════════════════════════════════════════════════════════

export interface ChunkingStrategy {
  id: StorageConfig['chunkStrategy'];
  displayName: string;
  description: string;
  recommendedSize: number;
  recommendedOverlap: number;
}

/**
 * Available chunking strategies
 */
export const CHUNKING_STRATEGIES: Record<StorageConfig['chunkStrategy'], ChunkingStrategy> = {
  fixed: {
    id: 'fixed',
    displayName: 'Fixed Size',
    description: 'Split by character count',
    recommendedSize: 512,
    recommendedOverlap: 50,
  },
  sentence: {
    id: 'sentence',
    displayName: 'Sentence',
    description: 'Split at sentence boundaries',
    recommendedSize: 512,
    recommendedOverlap: 1,  // 1 sentence overlap
  },
  paragraph: {
    id: 'paragraph',
    displayName: 'Paragraph',
    description: 'Split at paragraph boundaries',
    recommendedSize: 1024,
    recommendedOverlap: 0,  // No overlap needed
  },
  semantic: {
    id: 'semantic',
    displayName: 'Semantic',
    description: 'Split by semantic similarity',
    recommendedSize: 512,
    recommendedOverlap: 50,
  },
};

// ═══════════════════════════════════════════════════════════════════
// STORAGE CONFIG MANAGER
// ═══════════════════════════════════════════════════════════════════

/**
 * Storage configuration manager
 */
export class StorageConfigManager {
  private adminConfig = getAdminConfig();

  /**
   * Get current storage configuration
   */
  async getConfig(): Promise<StorageConfig> {
    const config = await this.adminConfig.getConfig();
    return config.storage;
  }

  /**
   * Update storage configuration
   */
  async updateConfig(updates: Partial<StorageConfig>): Promise<StorageConfig> {
    await this.adminConfig.updateStorageConfig(updates);
    return this.getConfig();
  }

  /**
   * Get embedding model profile
   */
  getEmbeddingModel(modelId: string): EmbeddingModelProfile | undefined {
    return EMBEDDING_MODELS[modelId];
  }

  /**
   * Get current embedding model profile
   */
  async getCurrentEmbeddingModel(): Promise<EmbeddingModelProfile | undefined> {
    const config = await this.getConfig();
    return EMBEDDING_MODELS[config.embeddingModel];
  }

  /**
   * Set embedding model
   */
  async setEmbeddingModel(modelId: string): Promise<void> {
    const profile = EMBEDDING_MODELS[modelId];
    if (!profile) {
      throw new Error(`Unknown embedding model: ${modelId}`);
    }

    await this.updateConfig({
      embeddingProvider: profile.provider,
      embeddingModel: modelId,
      embeddingDimensions: profile.dimensions,
    });
  }

  /**
   * Get vector store profile
   */
  getVectorStore(type: StorageConfig['vectorStore']): VectorStoreProfile {
    return VECTOR_STORES[type];
  }

  /**
   * Set vector store
   */
  async setVectorStore(
    type: StorageConfig['vectorStore'],
    config?: Record<string, unknown>
  ): Promise<void> {
    const profile = VECTOR_STORES[type];
    if (!profile) {
      throw new Error(`Unknown vector store: ${type}`);
    }

    await this.updateConfig({
      vectorStore: type,
      vectorStoreConfig: config || profile.defaultConfig,
    });
  }

  /**
   * Set chunking strategy
   */
  async setChunkingStrategy(
    strategy: StorageConfig['chunkStrategy'],
    options?: { size?: number; overlap?: number }
  ): Promise<void> {
    const profile = CHUNKING_STRATEGIES[strategy];
    if (!profile) {
      throw new Error(`Unknown chunking strategy: ${strategy}`);
    }

    await this.updateConfig({
      chunkStrategy: strategy,
      chunkSize: options?.size ?? profile.recommendedSize,
      chunkOverlap: options?.overlap ?? profile.recommendedOverlap,
    });
  }

  /**
   * List local embedding models
   */
  listLocalEmbeddingModels(): EmbeddingModelProfile[] {
    return Object.values(EMBEDDING_MODELS).filter(m => m.local);
  }

  /**
   * List cloud embedding models
   */
  listCloudEmbeddingModels(): EmbeddingModelProfile[] {
    return Object.values(EMBEDDING_MODELS).filter(m => !m.local);
  }

  /**
   * List local vector stores
   */
  listLocalVectorStores(): VectorStoreProfile[] {
    return Object.values(VECTOR_STORES).filter(s => s.local);
  }

  /**
   * Get recommended configuration for local-only setup
   */
  getLocalOnlyConfig(): Partial<StorageConfig> {
    return {
      embeddingProvider: 'ollama',
      embeddingModel: 'nomic-embed-text',
      embeddingDimensions: 768,
      vectorStore: 'sqlite-vec',
      chunkStrategy: 'sentence',
      chunkSize: 512,
      chunkOverlap: 1,
    };
  }

  /**
   * Get recommended configuration for cloud setup
   */
  getCloudConfig(): Partial<StorageConfig> {
    return {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      vectorStore: 'pinecone',
      chunkStrategy: 'semantic',
      chunkSize: 512,
      chunkOverlap: 50,
    };
  }

  /**
   * Get recommended configuration for hybrid setup
   */
  getHybridConfig(): Partial<StorageConfig> {
    return {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      embeddingDimensions: 1536,
      vectorStore: 'sqlite-vec',  // Local storage
      chunkStrategy: 'sentence',
      chunkSize: 512,
      chunkOverlap: 1,
    };
  }

  /**
   * Validate configuration compatibility
   */
  async validateConfig(config: Partial<StorageConfig>): Promise<{
    valid: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check embedding model exists
    if (config.embeddingModel && !EMBEDDING_MODELS[config.embeddingModel]) {
      issues.push(`Unknown embedding model: ${config.embeddingModel}`);
    }

    // Check vector store exists
    if (config.vectorStore && !VECTOR_STORES[config.vectorStore]) {
      issues.push(`Unknown vector store: ${config.vectorStore}`);
    }

    // Check dimension compatibility
    if (config.embeddingModel && config.vectorStore) {
      const embedProfile = EMBEDDING_MODELS[config.embeddingModel];
      const storeProfile = VECTOR_STORES[config.vectorStore];

      if (embedProfile && storeProfile.maxDimensions) {
        if (embedProfile.dimensions > storeProfile.maxDimensions) {
          issues.push(
            `Embedding dimensions (${embedProfile.dimensions}) exceed ` +
            `vector store max (${storeProfile.maxDimensions})`
          );
        }
      }
    }

    // Check chunk size vs embedding model
    if (config.chunkSize && config.embeddingModel) {
      const embedProfile = EMBEDDING_MODELS[config.embeddingModel];
      if (embedProfile && config.chunkSize > embedProfile.maxInputTokens * 4) {
        warnings.push(
          `Chunk size (${config.chunkSize}) may exceed embedding model's ` +
          `max input (${embedProfile.maxInputTokens} tokens)`
        );
      }
    }

    // Check chunking strategy exists
    if (config.chunkStrategy && !CHUNKING_STRATEGIES[config.chunkStrategy]) {
      issues.push(`Unknown chunking strategy: ${config.chunkStrategy}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _storageConfig: StorageConfigManager | null = null;

/**
 * Get the singleton storage config manager
 */
export function getStorageConfig(): StorageConfigManager {
  if (!_storageConfig) {
    _storageConfig = new StorageConfigManager();
  }
  return _storageConfig;
}
