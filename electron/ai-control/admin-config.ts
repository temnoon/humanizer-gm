/**
 * Admin AI Configuration
 *
 * System-wide settings that control all AI interactions.
 * Only admins can modify these settings.
 *
 * Includes:
 * - Provider configuration (API keys, endpoints)
 * - Model allowlists/blocklists
 * - Budget controls
 * - Default model classes
 * - Safety configuration (IMMUTABLE core settings)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  SystemAIConfig,
  AIProviderConfig,
  AIProviderType,
  SafetyConfig,
  AuditConfig,
  StorageConfig,
  ModelClass,
} from './types';
import { DEFAULT_MODEL_CLASSES } from './model-classes';
import { IMMUTABLE_SAFETY } from './safety';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const CONFIG_DIR = path.join(os.homedir(), '.humanizer', 'config');
const CONFIG_FILE = 'ai-config.json';
const CONFIG_VERSION = 1;

// ═══════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Default provider configurations
 */
const DEFAULT_PROVIDERS: Record<AIProviderType, AIProviderConfig> = {
  ollama: {
    type: 'ollama',
    endpoint: 'http://localhost:11434',
    enabled: true,
    timeout: 120000,  // 2 minutes for local inference
    maxRetries: 2,
  },
  openai: {
    type: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    enabled: !!process.env.OPENAI_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 60,
  },
  anthropic: {
    type: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    apiKey: process.env.ANTHROPIC_API_KEY,
    enabled: !!process.env.ANTHROPIC_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 60,
  },
  cloudflare: {
    type: 'cloudflare',
    endpoint: process.env.CLOUDFLARE_AI_GATEWAY,
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    enabled: !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
    timeout: 30000,
    maxRetries: 2,
    rateLimitRPM: 100,
  },
  google: {
    type: 'google',
    endpoint: 'https://generativelanguage.googleapis.com',
    apiKey: process.env.GOOGLE_AI_API_KEY,
    enabled: !!process.env.GOOGLE_AI_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 60,
  },
  cohere: {
    type: 'cohere',
    endpoint: 'https://api.cohere.ai',
    apiKey: process.env.COHERE_API_KEY,
    enabled: !!process.env.COHERE_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 100,
  },
  mistral: {
    type: 'mistral',
    endpoint: 'https://api.mistral.ai',
    apiKey: process.env.MISTRAL_API_KEY,
    enabled: !!process.env.MISTRAL_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 60,
  },
  groq: {
    type: 'groq',
    endpoint: 'https://api.groq.com',
    apiKey: process.env.GROQ_API_KEY,
    enabled: !!process.env.GROQ_API_KEY,
    timeout: 30000,
    maxRetries: 3,
    rateLimitRPM: 30,  // Groq has strict rate limits
  },
  together: {
    type: 'together',
    endpoint: 'https://api.together.xyz',
    apiKey: process.env.TOGETHER_API_KEY,
    enabled: !!process.env.TOGETHER_API_KEY,
    timeout: 60000,
    maxRetries: 3,
    rateLimitRPM: 60,
  },
  deepseek: {
    type: 'deepseek',
    endpoint: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
    enabled: !!process.env.DEEPSEEK_API_KEY,
    timeout: 120000,  // DeepSeek can be slow
    maxRetries: 2,
    rateLimitRPM: 60,
  },
  local: {
    type: 'local',
    endpoint: 'http://localhost:8080',
    enabled: false,
    timeout: 120000,
    maxRetries: 1,
  },
  custom: {
    type: 'custom',
    enabled: false,
    timeout: 60000,
    maxRetries: 2,
  },
};

/**
 * Default audit configuration
 */
const DEFAULT_AUDIT: AuditConfig = {
  enabled: true,
  logRequests: true,
  logResponses: false,  // Responses can be large
  logTokenUsage: true,
  logCosts: true,
  logErrors: true,
  retentionDays: 90,
  exportFormat: 'json',
};

/**
 * Default storage configuration
 */
const DEFAULT_STORAGE: StorageConfig = {
  embeddingProvider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  embeddingDimensions: 768,
  vectorStore: 'sqlite-vec',
  autoIndexNewContent: true,
  indexingBatchSize: 100,
  indexingConcurrency: 2,
  chunkSize: 512,
  chunkOverlap: 50,
  chunkStrategy: 'sentence',
  retentionDays: undefined,  // Keep forever by default
  maxStorageGB: undefined,
};

/**
 * Default system configuration
 */
export function createDefaultConfig(): SystemAIConfig {
  return {
    version: CONFIG_VERSION,
    updatedAt: new Date().toISOString(),

    // Default user profile bootstrap
    defaultProfile: {
      preferLocalModels: true,
      preferFastModels: false,
      preferCheapModels: false,
      preferredLanguage: 'en',
      writingStyle: 'casual',
      verbosity: 'balanced',
      formality: 'neutral',
    },

    // Provider configuration
    providers: DEFAULT_PROVIDERS,
    enabledProviders: Object.entries(DEFAULT_PROVIDERS)
      .filter(([_, config]) => config.enabled)
      .map(([type]) => type as AIProviderType),

    // No model restrictions by default
    allowedModels: undefined,
    blockedModels: undefined,

    // Default model classes
    modelClasses: { ...DEFAULT_MODEL_CLASSES },

    // No budget limits by default
    globalDailyBudget: undefined,
    globalMonthlyBudget: undefined,
    perUserDailyBudget: undefined,
    perUserMonthlyBudget: undefined,

    // Rate limiting
    globalRateLimitRPM: 1000,
    perUserRateLimitRPM: 100,

    // Fallback chain
    globalFallbackChain: [
      'qwen3:14b',          // Local first
      'llama-3.3-70b',      // Local backup
      'gpt-4o-mini',        // Cheap cloud
      'claude-3-5-haiku',   // Cheap Anthropic
      'gpt-4o',             // Premium fallback
    ],

    // Safety (uses immutable defaults)
    safety: IMMUTABLE_SAFETY,

    // Audit
    audit: DEFAULT_AUDIT,

    // Storage
    storage: DEFAULT_STORAGE,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN CONFIG MANAGER
// ═══════════════════════════════════════════════════════════════════

/**
 * Admin configuration manager
 */
export class AdminConfigManager {
  private config: SystemAIConfig | null = null;
  private configPath: string;

  constructor() {
    this.ensureConfigDir();
    this.configPath = path.join(CONFIG_DIR, CONFIG_FILE);
  }

  /**
   * Ensure config directory exists
   */
  private ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  /**
   * Load configuration from disk
   */
  async load(): Promise<SystemAIConfig> {
    if (this.config) return this.config;

    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(content) as SystemAIConfig;

        // Merge with defaults to pick up new fields
        this.config = this.mergeWithDefaults(loaded);

        // CRITICAL: Enforce immutable safety - override any tampering
        this.config.safety = {
          ...this.config.safety,
          ...IMMUTABLE_SAFETY,
        };

        return this.config;
      } catch (error) {
        console.error('Failed to load AI config:', error);
      }
    }

    // Create default config
    this.config = createDefaultConfig();
    await this.save();
    return this.config;
  }

  /**
   * Merge loaded config with defaults
   */
  private mergeWithDefaults(loaded: Partial<SystemAIConfig>): SystemAIConfig {
    const defaults = createDefaultConfig();

    return {
      ...defaults,
      ...loaded,
      // Deep merge providers
      providers: {
        ...defaults.providers,
        ...(loaded.providers || {}),
      },
      // Deep merge model classes
      modelClasses: {
        ...defaults.modelClasses,
        ...(loaded.modelClasses || {}),
      },
      // Audit
      audit: {
        ...defaults.audit,
        ...(loaded.audit || {}),
      },
      // Storage
      storage: {
        ...defaults.storage,
        ...(loaded.storage || {}),
      },
      // Safety is ALWAYS enforced
      safety: IMMUTABLE_SAFETY,
    };
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<void> {
    if (!this.config) return;

    this.ensureConfigDir();
    this.config.updatedAt = new Date().toISOString();
    this.config.version = CONFIG_VERSION;

    // CRITICAL: Enforce immutable safety before saving
    this.config.safety = {
      ...this.config.safety,
      ...IMMUTABLE_SAFETY,
    };

    fs.writeFileSync(
      this.configPath,
      JSON.stringify(this.config, null, 2)
    );
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<SystemAIConfig> {
    return this.load();
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<SystemAIConfig>): Promise<SystemAIConfig> {
    const config = await this.load();

    // Apply updates (except safety - that's immutable)
    const { safety, ...safeUpdates } = updates;

    Object.assign(config, safeUpdates);

    // Recalculate enabled providers
    if (updates.providers) {
      config.enabledProviders = Object.entries(config.providers)
        .filter(([_, cfg]) => cfg.enabled)
        .map(([type]) => type as AIProviderType);
    }

    await this.save();
    return config;
  }

  // ─────────────────────────────────────────────────────────────────
  // PROVIDER MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update a provider configuration
   */
  async updateProvider(
    provider: AIProviderType,
    updates: Partial<AIProviderConfig>
  ): Promise<void> {
    const config = await this.load();
    config.providers[provider] = {
      ...config.providers[provider],
      ...updates,
      type: provider,  // Type cannot be changed
    };

    // Update enabled list
    config.enabledProviders = Object.entries(config.providers)
      .filter(([_, cfg]) => cfg.enabled)
      .map(([type]) => type as AIProviderType);

    await this.save();
  }

  /**
   * Set provider API key
   */
  async setProviderApiKey(
    provider: AIProviderType,
    apiKey: string
  ): Promise<void> {
    await this.updateProvider(provider, {
      apiKey,
      enabled: true,  // Enable if key is set
    });
  }

  /**
   * Enable/disable a provider
   */
  async setProviderEnabled(
    provider: AIProviderType,
    enabled: boolean
  ): Promise<void> {
    await this.updateProvider(provider, { enabled });
  }

  /**
   * Get list of available (enabled + configured) providers
   */
  async getAvailableProviders(): Promise<AIProviderType[]> {
    const config = await this.load();
    return config.enabledProviders;
  }

  // ─────────────────────────────────────────────────────────────────
  // MODEL CLASS MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Add or update a model class
   */
  async setModelClass(modelClass: ModelClass): Promise<void> {
    const config = await this.load();
    config.modelClasses[modelClass.id] = modelClass;
    await this.save();
  }

  /**
   * Remove a custom model class (cannot remove built-in)
   */
  async removeModelClass(classId: string): Promise<boolean> {
    const config = await this.load();
    const cls = config.modelClasses[classId];

    if (!cls || cls.builtIn) {
      return false;  // Cannot remove built-in or non-existent
    }

    delete config.modelClasses[classId];
    await this.save();
    return true;
  }

  /**
   * Get a model class by ID
   */
  async getModelClass(classId: string): Promise<ModelClass | undefined> {
    const config = await this.load();
    return config.modelClasses[classId];
  }

  /**
   * List all model classes
   */
  async listModelClasses(): Promise<ModelClass[]> {
    const config = await this.load();
    return Object.values(config.modelClasses);
  }

  // ─────────────────────────────────────────────────────────────────
  // BUDGET MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Set global budget limits
   */
  async setGlobalBudget(
    dailyLimit?: number,
    monthlyLimit?: number
  ): Promise<void> {
    await this.updateConfig({
      globalDailyBudget: dailyLimit,
      globalMonthlyBudget: monthlyLimit,
    });
  }

  /**
   * Set per-user budget limits
   */
  async setPerUserBudget(
    dailyLimit?: number,
    monthlyLimit?: number
  ): Promise<void> {
    await this.updateConfig({
      perUserDailyBudget: dailyLimit,
      perUserMonthlyBudget: monthlyLimit,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // MODEL ALLOWLIST/BLOCKLIST
  // ─────────────────────────────────────────────────────────────────

  /**
   * Set allowed models (whitelist)
   */
  async setAllowedModels(models: string[] | undefined): Promise<void> {
    await this.updateConfig({ allowedModels: models });
  }

  /**
   * Set blocked models (blacklist)
   */
  async setBlockedModels(models: string[]): Promise<void> {
    await this.updateConfig({ blockedModels: models });
  }

  /**
   * Check if a model is allowed
   */
  async isModelAllowed(modelId: string): Promise<boolean> {
    const config = await this.load();

    // Check blocklist first
    if (config.blockedModels?.includes(modelId)) {
      return false;
    }

    // Check allowlist if set
    if (config.allowedModels && config.allowedModels.length > 0) {
      return config.allowedModels.includes(modelId);
    }

    // Default: allowed
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // STORAGE CONFIGURATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update storage configuration
   */
  async updateStorageConfig(updates: Partial<StorageConfig>): Promise<void> {
    const config = await this.load();
    config.storage = { ...config.storage, ...updates };
    await this.save();
  }

  /**
   * Get storage configuration
   */
  async getStorageConfig(): Promise<StorageConfig> {
    const config = await this.load();
    return config.storage;
  }

  // ─────────────────────────────────────────────────────────────────
  // AUDIT CONFIGURATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update audit configuration
   */
  async updateAuditConfig(updates: Partial<AuditConfig>): Promise<void> {
    const config = await this.load();
    config.audit = { ...config.audit, ...updates };
    await this.save();
  }

  // ─────────────────────────────────────────────────────────────────
  // EXPORT/IMPORT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Export configuration as JSON
   */
  async exportConfig(): Promise<string> {
    const config = await this.load();

    // Redact API keys for export
    const exportConfig = { ...config };
    exportConfig.providers = {} as typeof config.providers;

    for (const [key, provider] of Object.entries(config.providers)) {
      exportConfig.providers[key as AIProviderType] = {
        ...provider,
        apiKey: provider.apiKey ? '***REDACTED***' : undefined,
      };
    }

    return JSON.stringify(exportConfig, null, 2);
  }

  /**
   * Import configuration from JSON (preserves API keys)
   */
  async importConfig(json: string): Promise<SystemAIConfig> {
    const imported = JSON.parse(json) as SystemAIConfig;
    const current = await this.load();

    // Preserve existing API keys (don't import redacted ones)
    for (const [key, provider] of Object.entries(imported.providers || {})) {
      if (provider.apiKey === '***REDACTED***') {
        const currentProvider = current.providers[key as AIProviderType];
        if (currentProvider) {
          provider.apiKey = currentProvider.apiKey;
        } else {
          delete provider.apiKey;
        }
      }
    }

    // Merge and save
    this.config = this.mergeWithDefaults(imported);
    await this.save();
    return this.config;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════

let _adminConfig: AdminConfigManager | null = null;

/**
 * Get the singleton admin config manager
 */
export function getAdminConfig(): AdminConfigManager {
  if (!_adminConfig) {
    _adminConfig = new AdminConfigManager();
  }
  return _adminConfig;
}
