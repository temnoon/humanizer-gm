/**
 * ConfigService - Centralized Configuration Management for Book Studio Server
 *
 * Manages all configuration sections:
 * - grading: Enable SIC, Chekhov, Quantum, min words, weights
 * - ui: Default staging view, show word counts, compact cards
 * - draft: Default model, temperature, target word count
 *
 * Storage: ~/.humanizer/config/bookstudio-config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface GradeWeights {
  authenticity: number;
  necessity: number;
  inflection: number;
  voice: number;
  clarity: number;
}

export interface GradingConfig {
  enableSIC: boolean;
  enableChekhov: boolean;
  enableQuantum: boolean;
  minWordsForAnalysis: number;
  runAt: 'harvest' | 'background' | 'hybrid';
  gradeWeights: GradeWeights;
}

export interface UIConfig {
  defaultStagingView: 'list' | 'cards' | 'kanban';
  showWordCounts: boolean;
  compactCards: boolean;
  autoExpandCards: boolean;
  showGradeDetails: boolean;
}

export interface DraftConfig {
  defaultModel: string;
  temperature: number;
  targetWordCount: number;
  maxTokens: number;
}

export interface OutlineDetectionConfig {
  enabled: boolean;
  minItemsForOutline: number;
}

export interface BookStudioServerConfig {
  grading: GradingConfig;
  ui: UIConfig;
  draft: DraftConfig;
  outlineDetection: OutlineDetectionConfig;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: BookStudioServerConfig = {
  grading: {
    enableSIC: true,
    enableChekhov: true,
    enableQuantum: false, // Expensive, opt-in
    minWordsForAnalysis: 30,
    runAt: 'hybrid',
    gradeWeights: {
      authenticity: 0.25,
      necessity: 0.25,
      inflection: 0.15,
      voice: 0.2,
      clarity: 0.15,
    },
  },
  ui: {
    defaultStagingView: 'cards',
    showWordCounts: true,
    compactCards: false,
    autoExpandCards: false,
    showGradeDetails: true,
  },
  draft: {
    defaultModel: 'llama3.2',
    temperature: 0.7,
    targetWordCount: 500,
    maxTokens: 2048,
  },
  outlineDetection: {
    enabled: true,
    minItemsForOutline: 3,
  },
};

// ============================================================================
// Service
// ============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.humanizer', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'bookstudio-config.json');

class ConfigService {
  private config: BookStudioServerConfig | null = null;
  private initialized = false;

  /**
   * Initialize the configuration service
   * Loads from disk or creates defaults
   */
  init(): BookStudioServerConfig {
    if (this.initialized && this.config) {
      return this.config;
    }

    try {
      // Ensure config directory exists
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      // Try to load existing config
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const loaded = JSON.parse(data);

        // Merge with defaults to handle missing keys
        this.config = this.mergeWithDefaults(loaded);
        this.initialized = true;

        console.log('[BookStudioConfigService] Loaded config from disk');
        return this.config;
      }
    } catch (error) {
      console.error('[BookStudioConfigService] Error loading config:', error);
    }

    // File doesn't exist or is invalid, use defaults
    this.config = { ...DEFAULT_CONFIG };
    this.initialized = true;

    // Save defaults to disk
    this.save();
    console.log('[BookStudioConfigService] Created default config');
    return this.config;
  }

  /**
   * Get the full configuration
   */
  getAll(): BookStudioServerConfig {
    if (!this.config) {
      this.init();
    }
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Get a specific section
   */
  getSection<K extends keyof BookStudioServerConfig>(
    section: K
  ): BookStudioServerConfig[K] {
    if (!this.config) {
      this.init();
    }
    return JSON.parse(JSON.stringify(this.config![section]));
  }

  /**
   * Update a specific section
   */
  updateSection<K extends keyof BookStudioServerConfig>(
    section: K,
    values: Partial<BookStudioServerConfig[K]>
  ): BookStudioServerConfig[K] {
    if (!this.config) {
      this.init();
    }

    // Handle nested objects (like gradeWeights)
    if (section === 'grading') {
      const currentGrading = this.config!.grading;
      const newValues = values as Partial<GradingConfig>;

      this.config!.grading = {
        ...currentGrading,
        ...newValues,
        gradeWeights: {
          ...currentGrading.gradeWeights,
          ...(newValues.gradeWeights || {}),
        },
      };
    } else {
      this.config![section] = {
        ...this.config![section],
        ...values,
      } as BookStudioServerConfig[K];
    }

    this.save();
    return this.getSection(section);
  }

  /**
   * Reset all config to defaults
   */
  reset(): BookStudioServerConfig {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.save();
    return this.getAll();
  }

  /**
   * Reset a specific section to defaults
   */
  resetSection<K extends keyof BookStudioServerConfig>(
    section: K
  ): BookStudioServerConfig[K] {
    if (!this.config) {
      this.init();
    }

    this.config![section] = JSON.parse(
      JSON.stringify(DEFAULT_CONFIG[section])
    ) as BookStudioServerConfig[K];
    this.save();
    return this.getSection(section);
  }

  /**
   * Save config to disk
   */
  private save(): void {
    if (!this.config) return;

    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify(this.config, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[BookStudioConfigService] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Deep merge loaded config with defaults to handle missing keys
   */
  private mergeWithDefaults(
    loaded: Partial<BookStudioServerConfig>
  ): BookStudioServerConfig {
    return {
      grading: {
        ...DEFAULT_CONFIG.grading,
        ...(loaded.grading || {}),
        gradeWeights: {
          ...DEFAULT_CONFIG.grading.gradeWeights,
          ...(loaded.grading?.gradeWeights || {}),
        },
      },
      ui: {
        ...DEFAULT_CONFIG.ui,
        ...(loaded.ui || {}),
      },
      draft: {
        ...DEFAULT_CONFIG.draft,
        ...(loaded.draft || {}),
      },
      outlineDetection: {
        ...DEFAULT_CONFIG.outlineDetection,
        ...(loaded.outlineDetection || {}),
      },
    };
  }
}

// Singleton instance
export const configService = new ConfigService();
