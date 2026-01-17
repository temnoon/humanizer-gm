/**
 * Book Studio Configuration System
 *
 * Supports:
 * 1. File-based defaults (loaded from localStorage key 'bookstudio-config')
 * 2. Runtime user overrides (stored in localStorage key 'bookstudio-user-config')
 * 3. Programmatic overrides (in-memory only)
 *
 * Priority: programmatic > user > file defaults
 */

// ============================================================================
// Configuration Schema
// ============================================================================

export interface BookStudioConfig {
  // Search & Filtering
  search: {
    defaultLimit: number
    similarityThreshold: number // For deduplication
    debounceMs: number
  }

  // Metadata fields to surface in filters
  // These are discovered dynamically but user can pin favorites
  metadata: {
    pinnedFields: string[] // e.g., ['gizmo_id', 'default_model_slug']
    hiddenFields: string[] // Fields to hide from UI
  }

  // Content categorization
  content: {
    stubWordThreshold: number // Below this = stub
    fullArticleWordThreshold: number // Above this = full article
    voiceSamplePatterns: string[] // Regex patterns for voice sample detection
  }

  // Draft generation
  draft: {
    defaultModel: string
    temperature: number
    targetWordCount: number
    preserveVoice: boolean
    includeTransitions: boolean
  }

  // UI preferences
  ui: {
    defaultStagingView: 'grid' | 'timeline' | 'canvas' | 'clusters'
    defaultSearchMode: 'smart' | 'text' | 'semantic' | 'images' | 'browse' | 'web'
    showWordCounts: boolean
    compactCards: boolean
  }

  // API endpoints (for flexibility)
  api: {
    archiveBase: string
    ollamaBase: string
    npeLocalBase: string // For SIC analysis
    bookStudioBase: string // Book Studio server (port 3004)
    bookStudioWs: string   // WebSocket URL
    useApiBackend: boolean // Use API server instead of localStorage
  }

  // Review agent configuration
  reviewAgent: {
    runAt: 'harvest' | 'background' | 'on-demand' | 'hybrid'
    enableSIC: boolean
    enableChekhov: boolean
    enableQuantum: boolean
    minWordsForAnalysis: number // Skip deep analysis for short content
    autoGradeOnHarvest: boolean
    gradeWeights: {
      authenticity: number // SIC weight
      necessity: number    // Chekhov weight
      inflection: number   // Quantum weight
      voice: number        // Voice coherence weight
      clarity: number      // General clarity weight
    }
  }

  // Clustering configuration
  clustering: {
    similarityThreshold: number // 0.0-1.0
    minClusterSize: number
    maxClusters: number
    enableReactiveClustering: boolean
    autoRecomputeThreshold: number // Number of changes before prompting recompute
  }

  // Outline detection
  outlineDetection: {
    enabled: boolean
    minItemsForOutline: number
    autoSuggestChapters: boolean
  }
}

// ============================================================================
// Storage Keys
// ============================================================================

const CONFIG_FILE_KEY = 'bookstudio-config'
const USER_CONFIG_KEY = 'bookstudio-user-config'

// ============================================================================
// In-Memory State
// ============================================================================

let fileConfig: Partial<BookStudioConfig> = {}
let userConfig: Partial<BookStudioConfig> = {}
let programmaticConfig: Partial<BookStudioConfig> = {}
let configListeners: Array<() => void> = []

// ============================================================================
// Deep Merge Utility
// ============================================================================

function deepMerge<T extends object>(
  base: T,
  ...overrides: Array<Partial<T>>
): T {
  const result = { ...base }

  for (const override of overrides) {
    if (!override) continue

    for (const key of Object.keys(override) as Array<keyof T>) {
      const baseValue = result[key]
      const overrideValue = override[key]

      if (
        overrideValue !== undefined &&
        typeof baseValue === 'object' &&
        baseValue !== null &&
        !Array.isArray(baseValue) &&
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue)
      ) {
        result[key] = deepMerge(
          baseValue as Record<string, unknown>,
          overrideValue as Record<string, unknown>
        ) as T[keyof T]
      } else if (overrideValue !== undefined) {
        result[key] = overrideValue as T[keyof T]
      }
    }
  }

  return result
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load configuration from localStorage
 */
export function loadConfig(): void {
  try {
    const fileStr = localStorage.getItem(CONFIG_FILE_KEY)
    if (fileStr) {
      fileConfig = JSON.parse(fileStr)
    }
  } catch (e) {
    console.warn('Failed to load file config:', e)
  }

  try {
    const userStr = localStorage.getItem(USER_CONFIG_KEY)
    if (userStr) {
      userConfig = JSON.parse(userStr)
    }
  } catch (e) {
    console.warn('Failed to load user config:', e)
  }
}

/**
 * Get the current merged configuration
 * Priority: programmatic > user > file > schema defaults
 */
export function getConfig(): BookStudioConfig {
  // Schema defaults are defined here - the ONLY place defaults exist
  const schemaDefaults: BookStudioConfig = {
    search: {
      defaultLimit: 20,
      similarityThreshold: 0.85,
      debounceMs: 300,
    },
    metadata: {
      pinnedFields: [],
      hiddenFields: [],
    },
    content: {
      stubWordThreshold: 50,
      fullArticleWordThreshold: 500,
      voiceSamplePatterns: [],
    },
    draft: {
      defaultModel: '',
      temperature: 0.7,
      targetWordCount: 1500,
      preserveVoice: true,
      includeTransitions: true,
    },
    ui: {
      defaultStagingView: 'grid',
      defaultSearchMode: 'smart',
      showWordCounts: true,
      compactCards: false,
    },
    api: {
      archiveBase: '/api/archive',
      ollamaBase: 'http://localhost:11434',
      npeLocalBase: 'http://localhost:3003',
      bookStudioBase: 'http://127.0.0.1:3004/api',
      bookStudioWs: 'ws://127.0.0.1:3004/ws',
      useApiBackend: true, // Default to API backend when available
    },
    reviewAgent: {
      runAt: 'hybrid',
      enableSIC: false, // Disabled: requires NPE-Local on 3003, noisy for short content
      enableChekhov: true,
      enableQuantum: false, // Opt-in (slower, requires stepping through sentences)
      minWordsForAnalysis: 50,
      autoGradeOnHarvest: true,
      gradeWeights: {
        authenticity: 0.25,
        necessity: 0.25,
        inflection: 0.20,
        voice: 0.15,
        clarity: 0.15,
      },
    },
    clustering: {
      similarityThreshold: 0.55,
      minClusterSize: 2,
      maxClusters: 10,
      enableReactiveClustering: true,
      autoRecomputeThreshold: 5,
    },
    outlineDetection: {
      enabled: true,
      minItemsForOutline: 3,
      autoSuggestChapters: true,
    },
  }

  return deepMerge(schemaDefaults, fileConfig, userConfig, programmaticConfig)
}

/**
 * Get a specific config value using dot notation
 * e.g., getConfigValue('search.defaultLimit')
 */
export function getConfigValue<T>(path: string): T | undefined {
  const config = getConfig()
  const parts = path.split('.')
  let current: unknown = config

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current as T
}

// ============================================================================
// Configuration Updates
// ============================================================================

/**
 * Update user configuration (persisted to localStorage)
 */
export function setUserConfig(updates: Partial<BookStudioConfig>): void {
  userConfig = deepMerge(userConfig as BookStudioConfig, updates)
  localStorage.setItem(USER_CONFIG_KEY, JSON.stringify(userConfig))
  notifyListeners()
}

/**
 * Update a specific user config value using dot notation
 */
export function setUserConfigValue(path: string, value: unknown): void {
  const parts = path.split('.')
  const updates: Record<string, unknown> = {}
  let current = updates

  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value

  setUserConfig(updates as Partial<BookStudioConfig>)
}

/**
 * Update file configuration (the "defaults" layer)
 */
export function setFileConfig(config: Partial<BookStudioConfig>): void {
  fileConfig = config
  localStorage.setItem(CONFIG_FILE_KEY, JSON.stringify(fileConfig))
  notifyListeners()
}

/**
 * Update programmatic configuration (in-memory only, highest priority)
 */
export function setProgrammaticConfig(updates: Partial<BookStudioConfig>): void {
  programmaticConfig = deepMerge(programmaticConfig as BookStudioConfig, updates)
  notifyListeners()
}

/**
 * Reset user configuration to file defaults
 */
export function resetUserConfig(): void {
  userConfig = {}
  localStorage.removeItem(USER_CONFIG_KEY)
  notifyListeners()
}

/**
 * Export current configuration as JSON string
 */
export function exportConfig(): string {
  return JSON.stringify(getConfig(), null, 2)
}

/**
 * Import configuration from JSON string (sets as file config)
 */
export function importConfig(jsonStr: string): boolean {
  try {
    const imported = JSON.parse(jsonStr)
    setFileConfig(imported)
    return true
  } catch (e) {
    console.error('Failed to import config:', e)
    return false
  }
}

// ============================================================================
// Change Listeners
// ============================================================================

/**
 * Subscribe to configuration changes
 */
export function subscribeToConfig(listener: () => void): () => void {
  configListeners.push(listener)
  return () => {
    configListeners = configListeners.filter(l => l !== listener)
  }
}

function notifyListeners(): void {
  configListeners.forEach(l => l())
}

// ============================================================================
// React Hook
// ============================================================================

import { useState, useEffect, useCallback } from 'react'

/**
 * React hook for using configuration
 * Re-renders when config changes
 */
export function useConfig(): BookStudioConfig {
  const [config, setConfig] = useState(getConfig)

  useEffect(() => {
    return subscribeToConfig(() => setConfig(getConfig()))
  }, [])

  return config
}

/**
 * React hook for a specific config value
 */
export function useConfigValue<T>(path: string): [T | undefined, (value: T) => void] {
  const [value, setValue] = useState<T | undefined>(() => getConfigValue(path))

  useEffect(() => {
    return subscribeToConfig(() => setValue(getConfigValue(path)))
  }, [path])

  const updateValue = useCallback((newValue: T) => {
    setUserConfigValue(path, newValue)
  }, [path])

  return [value, updateValue]
}

// ============================================================================
// Initialize on load
// ============================================================================

loadConfig()
