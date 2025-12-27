/**
 * AUI Settings - Persistent preferences for AUI tool execution
 *
 * Philosophy:
 * - Tools remember their last-used settings
 * - When AUI executes a tool, it uses the user's preferred settings
 * - User builds up a personalized "AUI profile" over time
 * - Settings sync with the teaching system ("Using your saved settings...")
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SearchSettings {
  /** Default search type */
  type: 'semantic' | 'keyword' | 'hybrid';
  /** Include ChatGPT conversations */
  includeChatGPT: boolean;
  /** Include Facebook content */
  includeFacebook: boolean;
  /** Default result limit */
  limit: number;
}

export interface HumanizeSettings {
  /** Default intensity */
  intensity: 'subtle' | 'moderate' | 'significant';
  /** Enable SIC analysis */
  enableSicAnalysis: boolean;
  /** Enable LLM polish */
  enableLLMPolish: boolean;
}

export interface PersonaSettings {
  /** Last used persona */
  lastPersona: string;
  /** Custom personas created */
  customPersonas: string[];
}

export interface StyleSettings {
  /** Last used style */
  lastStyle: string;
  /** Custom styles created */
  customStyles: string[];
}

export interface AnimationSettings {
  /** Whether to show "show don't tell" animations */
  enabled: boolean;
  /** Animation speed multiplier (0.5 = slow, 1 = normal, 2 = fast) */
  speed: number;
  /** Show keyboard shortcut toasts */
  showShortcuts: boolean;
}

export interface ArchiveSettings {
  /** Auto-archive AUI conversations */
  archiveChats: boolean;
  /** Default conversation tag */
  chatTag: string;
}

export interface AutomationSettings {
  /** Automation mode for agent operations */
  mode: 'guided' | 'autonomous';
  /** Show agent proposals in chat */
  showProposals: boolean;
  /** Auto-approve low-risk operations */
  autoApproveLowRisk: boolean;
}

export interface ModelSettings {
  /** Preferred model for draft generation */
  draftModel: 'haiku' | 'sonnet' | 'opus' | 'ollama-local';
  /** Preferred model for summarization */
  summaryModel: 'haiku' | 'sonnet';
  /** Use local Ollama when available */
  preferLocal: boolean;
}

export interface AUISettings {
  search: SearchSettings;
  humanize: HumanizeSettings;
  persona: PersonaSettings;
  style: StyleSettings;
  animation: AnimationSettings;
  archive: ArchiveSettings;
  automation: AutomationSettings;
  model: ModelSettings;
  /** Version for migrations */
  version: number;
  /** Last updated timestamp */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'humanizer-aui-settings';
const CURRENT_VERSION = 1;

const DEFAULT_SETTINGS: AUISettings = {
  search: {
    type: 'semantic',
    includeChatGPT: true,
    includeFacebook: true,
    limit: 10,
  },
  humanize: {
    intensity: 'moderate',
    enableSicAnalysis: false,
    enableLLMPolish: true,
  },
  persona: {
    lastPersona: '',
    customPersonas: [],
  },
  style: {
    lastStyle: '',
    customStyles: [],
  },
  animation: {
    enabled: true,
    speed: 1,
    showShortcuts: true,
  },
  archive: {
    archiveChats: true,
    chatTag: 'aui-conversation',
  },
  automation: {
    mode: 'guided',
    showProposals: true,
    autoApproveLowRisk: false,
  },
  model: {
    draftModel: 'haiku',
    summaryModel: 'haiku',
    preferLocal: true,
  },
  version: CURRENT_VERSION,
  updatedAt: new Date().toISOString(),
};

// ═══════════════════════════════════════════════════════════════════
// STORAGE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Load settings from localStorage
 */
export function loadAUISettings(): AUISettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(stored) as Partial<AUISettings>;

    // Migrate if needed
    if (!parsed.version || parsed.version < CURRENT_VERSION) {
      return migrateSettings(parsed);
    }

    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      search: { ...DEFAULT_SETTINGS.search, ...parsed.search },
      humanize: { ...DEFAULT_SETTINGS.humanize, ...parsed.humanize },
      persona: { ...DEFAULT_SETTINGS.persona, ...parsed.persona },
      style: { ...DEFAULT_SETTINGS.style, ...parsed.style },
      animation: { ...DEFAULT_SETTINGS.animation, ...parsed.animation },
      archive: { ...DEFAULT_SETTINGS.archive, ...parsed.archive },
      automation: { ...DEFAULT_SETTINGS.automation, ...parsed.automation },
      model: { ...DEFAULT_SETTINGS.model, ...parsed.model },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to localStorage
 */
export function saveAUISettings(settings: AUISettings): void {
  try {
    const toStore = {
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.warn('[AUI Settings] Failed to save:', e);
  }
}

/**
 * Update specific settings category
 */
export function updateAUISettings<K extends keyof AUISettings>(
  category: K,
  updates: Partial<AUISettings[K]>
): AUISettings {
  const current = loadAUISettings();
  const updated: AUISettings = {
    ...current,
    [category]: {
      ...(current[category] as object),
      ...updates,
    },
    updatedAt: new Date().toISOString(),
  };
  saveAUISettings(updated);
  return updated;
}

/**
 * Reset settings to defaults
 */
export function resetAUISettings(): AUISettings {
  const defaults = { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() };
  saveAUISettings(defaults);
  return defaults;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATIONS
// ═══════════════════════════════════════════════════════════════════

function migrateSettings(old: Partial<AUISettings>): AUISettings {
  // Currently just merge with defaults
  // Add version-specific migrations as needed
  const migrated: AUISettings = {
    ...DEFAULT_SETTINGS,
    ...old,
    version: CURRENT_VERSION,
    updatedAt: new Date().toISOString(),
  };

  saveAUISettings(migrated);
  return migrated;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER HOOKS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get a human-readable description of current settings
 * Used when AUI shows "Using your saved settings..."
 */
export function describeSettings(category: keyof AUISettings): string {
  const settings = loadAUISettings();

  switch (category) {
    case 'search':
      return `${settings.search.type} search, ${settings.search.limit} results`;

    case 'humanize':
      return `${settings.humanize.intensity} intensity${settings.humanize.enableSicAnalysis ? ' + SIC analysis' : ''}`;

    case 'persona':
      return settings.persona.lastPersona || 'no persona selected';

    case 'style':
      return settings.style.lastStyle || 'no style selected';

    case 'animation':
      return settings.animation.enabled
        ? `animations at ${settings.animation.speed}x speed`
        : 'animations disabled';

    case 'archive':
      return settings.archive.archiveChats
        ? `archiving chats with tag "${settings.archive.chatTag}"`
        : 'not archiving chats';

    case 'automation':
      return `${settings.automation.mode} mode${settings.automation.autoApproveLowRisk ? ', auto-approve low-risk' : ''}`;

    case 'model':
      return `${settings.model.draftModel} for drafts, ${settings.model.preferLocal ? 'prefer local' : 'prefer cloud'}`;

    default:
      return '';
  }
}

/**
 * Check if animations are enabled
 */
export function isAnimationEnabled(): boolean {
  return loadAUISettings().animation.enabled;
}

/**
 * Get animation speed multiplier
 */
export function getAnimationSpeed(): number {
  return loadAUISettings().animation.speed;
}

// ═══════════════════════════════════════════════════════════════════
// REACT HOOK
// ═══════════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect } from 'react';

/**
 * React hook for AUI settings with auto-sync
 */
export function useAUISettings() {
  const [settings, setSettings] = useState<AUISettings>(loadAUISettings);

  // Listen for changes from other tabs/windows
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettings(JSON.parse(e.newValue));
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const update = useCallback(<K extends keyof AUISettings>(
    category: K,
    updates: Partial<AUISettings[K]>
  ) => {
    const updated = updateAUISettings(category, updates);
    setSettings(updated);
  }, []);

  const reset = useCallback(() => {
    const defaults = resetAUISettings();
    setSettings(defaults);
  }, []);

  return {
    settings,
    update,
    reset,
    describe: describeSettings,
  };
}
