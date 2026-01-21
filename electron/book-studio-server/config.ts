/**
 * Book Studio Server Configuration
 *
 * Centralized configuration for ALL operational parameters.
 * NO magic numbers should exist in route handlers or services.
 *
 * Storage: ~/.humanizer/config/book-studio-config.json
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ============================================================================
// Configuration Types
// ============================================================================

/** Search and retrieval settings */
export interface SearchConfig {
  /** Default result limit when not specified (default: 20) */
  defaultLimit: number;
  /** Maximum allowed limit (default: 1000) */
  maxLimit: number;
  /** Default similarity threshold (default: 0.55) */
  defaultSimilarity: number;
  /** High similarity threshold for quality matches (default: 0.85) */
  highSimilarity: number;
  /** Minimum similarity to include results (default: 0.3) */
  minSimilarity: number;
  /** Debounce delay for search input in ms (default: 300) */
  debounceMs: number;
}

/** Clustering algorithm settings */
export interface ClusteringConfig {
  /** Minimum cards to form a cluster (default: 2) */
  minClusterSize: number;
  /** Maximum clusters to generate (default: 10) */
  maxClusters: number;
  /** Similarity threshold for semantic clustering (default: 0.55) */
  similarityThreshold: number;
  /** Jaccard threshold for keyword clustering (default: 0.15) */
  jaccardThreshold: number;
  /** Search limit when gathering cluster candidates (default: 30) */
  searchLimit: number;
  /** Delay between cluster searches in ms (default: 100) */
  searchDelayMs: number;
}

/** Outline generation settings */
export interface OutlineConfig {
  /** Minimum themes required for outline (default: 3) */
  minThemes: number;
  /** Maximum themes to extract (default: 10) */
  maxThemes: number;
  /** Maximum sections in generated outline (default: 10) */
  maxSections: number;
  /** Minimum relevance for card-to-section matching (default: 0.2) */
  minRelevance: number;
  /** Theme relevance threshold (default: 0.3) */
  themeRelevanceThreshold: number;
  /** Minimum cards required per theme (default: 2) */
  minCardsPerTheme: number;
  /** Top keywords to extract per theme (default: 5) */
  topKeywordsPerTheme: number;
  /** Minimum items required before outline suggestion (default: 3) */
  minItemsForSuggestion: number;
}

/** Card review and grading settings */
export interface GradingConfig {
  /** Minimum words for meaningful analysis (default: 50) */
  minWordsForAnalysis: number;
  /** Maximum suggestions per card (default: 5) */
  maxSuggestions: number;
  /** Batch size for grading operations (default: 32) */
  batchSize: number;
  /** Auto-review cards on harvest (default: false) */
  autoReviewOnHarvest: boolean;
}

/** Card-to-chapter assignment settings */
export interface AssignmentConfig {
  /** Minimum confidence for assignment (default: 0.3) */
  minConfidence: number;
  /** High confidence threshold for auto-assignment (default: 0.8) */
  highConfidenceThreshold: number;
  /** Maximum alternative chapters to suggest (default: 3) */
  maxAlternatives: number;
  /** Auto-assign when confidence exceeds high threshold (default: false) */
  autoAssignHighConfidence: boolean;
}

/** Pyramid summarization settings */
export interface PyramidConfig {
  /** Chunks to combine per summary (default: 5) */
  chunksPerSummary: number;
  /** Target words for L1 summaries (default: 150) */
  targetSummaryWords: number;
  /** Target words for apex synthesis (default: 300) */
  targetApexWords: number;
}

/** Content harvesting settings */
export interface HarvestConfig {
  /** Default harvest target count (default: 20) */
  defaultTarget: number;
  /** Maximum harvest results (default: 100) */
  maxResults: number;
  /** Minimum word count for valid content (default: 20) */
  minWordCount: number;
  /** Maximum similarity before considering duplicate (default: 0.9) */
  dedupeThreshold: number;
  /** Diversity threshold for varied results (default: 0.7) */
  diversityThreshold: number;
  /** Discovery radius for related content (default: 0.4) */
  discoveryRadius: number;
}

/** Embedding generation settings */
export interface EmbeddingsConfig {
  /** Vector dimensions (default: 768 for nomic-embed-text) */
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

/** Draft generation settings */
export interface DraftConfig {
  /** Target word count per section (default: 1500) */
  targetWordCount: number;
  /** Deduplication threshold (default: 0.85) */
  dedupeThreshold: number;
}

/** Rate limiting settings */
export interface RateLimitConfig {
  /** Max search requests per window (default: 120) */
  searchMaxRequests: number;
  /** Search rate limit window in ms (default: 60000) */
  searchWindowMs: number;
  /** Max import requests per window (default: 10) */
  importMaxRequests: number;
  /** Import rate limit window in ms (default: 300000) */
  importWindowMs: number;
}

/** Complete Book Studio configuration */
export interface BookStudioConfig {
  /** Server port (default: 3004) */
  port: number;
  /** Data storage path */
  dataPath: string;
  /** SQLite database path */
  dbPath: string;
  /** WebSocket enabled (default: true) */
  wsEnabled: boolean;
  /** Search and retrieval settings */
  search: SearchConfig;
  /** Clustering settings */
  clustering: ClusteringConfig;
  /** Outline generation settings */
  outline: OutlineConfig;
  /** Card grading settings */
  grading: GradingConfig;
  /** Assignment settings */
  assignment: AssignmentConfig;
  /** Pyramid settings */
  pyramid: PyramidConfig;
  /** Harvest settings */
  harvest: HarvestConfig;
  /** Embedding settings */
  embeddings: EmbeddingsConfig;
  /** Draft generation settings */
  draft: DraftConfig;
  /** Rate limiting settings */
  rateLimit: RateLimitConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SEARCH: SearchConfig = {
  defaultLimit: 20,
  maxLimit: 1000,
  defaultSimilarity: 0.55,
  highSimilarity: 0.85,
  minSimilarity: 0.3,
  debounceMs: 300,
};

const DEFAULT_CLUSTERING: ClusteringConfig = {
  minClusterSize: 2,
  maxClusters: 10,
  similarityThreshold: 0.55,
  jaccardThreshold: 0.15,
  searchLimit: 30,
  searchDelayMs: 100,
};

const DEFAULT_OUTLINE: OutlineConfig = {
  minThemes: 3,
  maxThemes: 10,
  maxSections: 10,
  minRelevance: 0.2,
  themeRelevanceThreshold: 0.3,
  minCardsPerTheme: 2,
  topKeywordsPerTheme: 5,
  minItemsForSuggestion: 3,
};

const DEFAULT_GRADING: GradingConfig = {
  minWordsForAnalysis: 50,
  maxSuggestions: 5,
  batchSize: 32,
  autoReviewOnHarvest: false,
};

const DEFAULT_ASSIGNMENT: AssignmentConfig = {
  minConfidence: 0.3,
  highConfidenceThreshold: 0.8,
  maxAlternatives: 3,
  autoAssignHighConfidence: false,
};

const DEFAULT_PYRAMID: PyramidConfig = {
  chunksPerSummary: 5,
  targetSummaryWords: 150,
  targetApexWords: 300,
};

const DEFAULT_HARVEST: HarvestConfig = {
  defaultTarget: 20,
  maxResults: 100,
  minWordCount: 20,
  dedupeThreshold: 0.9,
  diversityThreshold: 0.7,
  discoveryRadius: 0.4,
};

const DEFAULT_EMBEDDINGS: EmbeddingsConfig = {
  dimensions: 768,
  batchSize: 32,
  maxChunkChars: 4000,
  targetChunkChars: 2000,
  minChunkChars: 200,
};

const DEFAULT_DRAFT: DraftConfig = {
  targetWordCount: 1500,
  dedupeThreshold: 0.85,
};

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  searchMaxRequests: 120,
  searchWindowMs: 60000,
  importMaxRequests: 10,
  importWindowMs: 300000,
};

// ============================================================================
// Configuration Service
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.humanizer', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'book-studio-config.json');

let config: BookStudioConfig | null = null;

/**
 * Deep merge two objects, preferring values from 'override'
 */
function deepMerge(base: BookStudioConfig, override: Partial<BookStudioConfig>): BookStudioConfig {
  const result = { ...base } as unknown as Record<string, unknown>;

  for (const key of Object.keys(override) as Array<keyof BookStudioConfig>) {
    const overrideValue = override[key];
    const baseValue = (base as unknown as Record<string, unknown>)[key];

    if (
      overrideValue !== undefined &&
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === 'object' &&
      baseValue !== null
    ) {
      // Recursively merge nested objects
      result[key] = { ...baseValue as object, ...overrideValue as object };
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue;
    }
  }

  return result as unknown as BookStudioConfig;
}

/**
 * Load config from disk if exists
 */
function loadConfigFromDisk(): Partial<BookStudioConfig> | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('[book-studio-server] Failed to load config from disk:', error);
  }
  return null;
}

/**
 * Save config to disk
 */
function saveConfigToDisk(config: BookStudioConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    // Only save operational config, not paths
    const toSave = {
      search: config.search,
      clustering: config.clustering,
      outline: config.outline,
      grading: config.grading,
      assignment: config.assignment,
      pyramid: config.pyramid,
      harvest: config.harvest,
      embeddings: config.embeddings,
      draft: config.draft,
      rateLimit: config.rateLimit,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2));
    console.log('[book-studio-server] Config saved to disk');
  } catch (error) {
    console.warn('[book-studio-server] Failed to save config to disk:', error);
  }
}

/**
 * Initialize configuration
 */
export async function initConfig(): Promise<BookStudioConfig> {
  if (config) return config;

  // Get user data directory (Electron app data location)
  const userDataPath = app?.getPath?.('userData') || process.cwd();
  const dataPath = path.join(userDataPath, 'book-studio');
  const dbPath = path.join(dataPath, 'books.db');

  // Ensure data directory exists
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }

  // Build default config
  const defaults: BookStudioConfig = {
    port: 3004,
    dataPath,
    dbPath,
    wsEnabled: true,
    search: DEFAULT_SEARCH,
    clustering: DEFAULT_CLUSTERING,
    outline: DEFAULT_OUTLINE,
    grading: DEFAULT_GRADING,
    assignment: DEFAULT_ASSIGNMENT,
    pyramid: DEFAULT_PYRAMID,
    harvest: DEFAULT_HARVEST,
    embeddings: DEFAULT_EMBEDDINGS,
    draft: DEFAULT_DRAFT,
    rateLimit: DEFAULT_RATE_LIMIT,
  };

  // Try to load from disk and merge
  const diskConfig = loadConfigFromDisk();
  let finalConfig: BookStudioConfig;
  if (diskConfig) {
    finalConfig = deepMerge(defaults, diskConfig);
    console.log('[book-studio-server] Merged config from disk');
  } else {
    finalConfig = defaults;
    saveConfigToDisk(finalConfig);
    console.log('[book-studio-server] Using default config');
  }

  // Store in module-level config
  config = finalConfig;

  console.log(`[book-studio-server] Config initialized:`);
  console.log(`  - Port: ${finalConfig.port}`);
  console.log(`  - Data: ${finalConfig.dataPath}`);
  console.log(`  - DB: ${finalConfig.dbPath}`);
  console.log(`  - Search limit: ${finalConfig.search.defaultLimit}`);
  console.log(`  - Clustering threshold: ${finalConfig.clustering.similarityThreshold}`);

  return finalConfig;
}

/**
 * Get current configuration (must call initConfig first)
 */
export function getConfig(): BookStudioConfig {
  if (!config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return config;
}

/**
 * Update a configuration section
 */
export function updateConfig<K extends keyof BookStudioConfig>(
  section: K,
  updates: Partial<BookStudioConfig[K]>
): BookStudioConfig[K] {
  if (!config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }

  const current = config[section];
  if (typeof current === 'object' && current !== null) {
    config[section] = { ...current, ...updates } as BookStudioConfig[K];
  } else {
    config[section] = updates as BookStudioConfig[K];
  }

  saveConfigToDisk(config);
  return config[section];
}

/**
 * Reset a configuration section to defaults
 */
export function resetConfigSection<K extends keyof BookStudioConfig>(section: K): void {
  if (!config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }

  const defaults: Record<string, unknown> = {
    search: DEFAULT_SEARCH,
    clustering: DEFAULT_CLUSTERING,
    outline: DEFAULT_OUTLINE,
    grading: DEFAULT_GRADING,
    assignment: DEFAULT_ASSIGNMENT,
    pyramid: DEFAULT_PYRAMID,
    harvest: DEFAULT_HARVEST,
    embeddings: DEFAULT_EMBEDDINGS,
    draft: DEFAULT_DRAFT,
    rateLimit: DEFAULT_RATE_LIMIT,
  };

  if (section in defaults) {
    config[section] = defaults[section] as BookStudioConfig[K];
    saveConfigToDisk(config);
  }
}

/**
 * Get data path
 */
export function getDataPath(): string {
  return getConfig().dataPath;
}

/**
 * Get database path
 */
export function getDbPath(): string {
  return getConfig().dbPath;
}

/**
 * Export defaults for testing
 */
export const DEFAULTS = {
  search: DEFAULT_SEARCH,
  clustering: DEFAULT_CLUSTERING,
  outline: DEFAULT_OUTLINE,
  grading: DEFAULT_GRADING,
  assignment: DEFAULT_ASSIGNMENT,
  pyramid: DEFAULT_PYRAMID,
  harvest: DEFAULT_HARVEST,
  embeddings: DEFAULT_EMBEDDINGS,
  draft: DEFAULT_DRAFT,
  rateLimit: DEFAULT_RATE_LIMIT,
};
