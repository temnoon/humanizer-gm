/**
 * Persona Store - Persistent storage for the global CuratorPersona
 *
 * The CuratorPersona is the user's primary assistant with:
 * - Canonic text: Identity-building passages (WHO the curator is)
 * - Worldview text: Knowledge base (WHAT the curator knows)
 * - Persistent memory: Best practices, preferences, significant moments
 *
 * This store handles:
 * - Loading/saving persona to localStorage
 * - Memory consolidation (learning from interactions)
 * - Passage reference management
 * - System prompt generation from canonic text
 */

import { useState, useCallback, useEffect } from 'react';
import type {
  CuratorPersona,
  CuratorBestPractice,
  CuratorPreference,
  CuratorMoment,
  EntityURI,
} from '@humanizer/core';
import { createDefaultCuratorPersona } from '@humanizer/core';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = 'humanizer-curator-persona';
const PERSONA_VERSION = 1;

/** Maximum best practices to keep */
const MAX_BEST_PRACTICES = 50;

/** Maximum preferences to keep */
const MAX_PREFERENCES = 100;

/** Maximum significant moments to keep */
const MAX_MOMENTS = 200;

/** Memory consolidation interval (24 hours) */
const CONSOLIDATION_INTERVAL = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// STORAGE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Load the global curator persona from localStorage
 */
export function loadCuratorPersona(): CuratorPersona {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createDefaultCuratorPersona('curator://user/default', 'Guide');
    }

    const parsed = JSON.parse(stored) as CuratorPersona & { _version?: number };

    // Migrate if needed
    if (!parsed._version || parsed._version < PERSONA_VERSION) {
      return migratePersona(parsed);
    }

    return parsed;
  } catch {
    return createDefaultCuratorPersona('curator://user/default', 'Guide');
  }
}

/**
 * Save the curator persona to localStorage
 */
export function saveCuratorPersona(persona: CuratorPersona): void {
  try {
    const toStore = {
      ...persona,
      _version: PERSONA_VERSION,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.warn('[PersonaStore] Failed to save:', e);
  }
}

/**
 * Reset persona to defaults
 */
export function resetCuratorPersona(): CuratorPersona {
  const fresh = createDefaultCuratorPersona('curator://user/default', 'Guide');
  saveCuratorPersona(fresh);
  return fresh;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY OPERATIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Add a best practice to the persona's memory
 */
export function addBestPractice(
  practice: string,
  context: string,
  sourceInteraction?: string
): CuratorPersona {
  const persona = loadCuratorPersona();
  const now = Date.now();

  // Check if this practice already exists (reinforce if so)
  const existing = persona.memory.bestPractices.find(
    (bp) => bp.practice.toLowerCase() === practice.toLowerCase()
  );

  if (existing) {
    existing.reinforcementCount += 1;
    existing.discoveredAt = now; // Update to most recent
  } else {
    const newPractice: CuratorBestPractice = {
      id: `bp_${now}_${Math.random().toString(36).slice(2, 8)}`,
      practice,
      context,
      discoveredAt: now,
      reinforcementCount: 1,
      sourceInteraction,
    };
    persona.memory.bestPractices.unshift(newPractice);

    // Trim to max
    if (persona.memory.bestPractices.length > MAX_BEST_PRACTICES) {
      // Keep the most reinforced and most recent
      persona.memory.bestPractices.sort((a, b) => {
        const scoreA = a.reinforcementCount * 1000 + a.discoveredAt / 1e10;
        const scoreB = b.reinforcementCount * 1000 + b.discoveredAt / 1e10;
        return scoreB - scoreA;
      });
      persona.memory.bestPractices = persona.memory.bestPractices.slice(
        0,
        MAX_BEST_PRACTICES
      );
    }
  }

  persona.updatedAt = now;
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Update a user preference
 */
export function updatePreference(
  category: CuratorPreference['category'],
  key: string,
  value: string
): CuratorPersona {
  const persona = loadCuratorPersona();
  const now = Date.now();

  const existing = persona.memory.preferences.find(
    (p) => p.category === category && p.key === key
  );

  if (existing) {
    // Increase confidence if value is the same, reset if different
    if (existing.value === value) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
    } else {
      existing.value = value;
      existing.confidence = 0.5; // Reset confidence
    }
    existing.lastObservedAt = now;
  } else {
    const newPref: CuratorPreference = {
      category,
      key,
      value,
      confidence: 0.5,
      lastObservedAt: now,
    };
    persona.memory.preferences.push(newPref);

    // Trim to max
    if (persona.memory.preferences.length > MAX_PREFERENCES) {
      persona.memory.preferences.sort(
        (a, b) => b.lastObservedAt - a.lastObservedAt
      );
      persona.memory.preferences = persona.memory.preferences.slice(
        0,
        MAX_PREFERENCES
      );
    }
  }

  persona.updatedAt = now;
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Record a significant moment
 */
export function recordSignificantMoment(
  summary: string,
  significance: string,
  tags: string[],
  relatedPassages?: EntityURI[]
): CuratorPersona {
  const persona = loadCuratorPersona();
  const now = Date.now();

  const moment: CuratorMoment = {
    timestamp: now,
    summary,
    significance,
    tags,
    relatedPassages,
  };

  persona.memory.significantMoments.unshift(moment);

  // Trim to max
  if (persona.memory.significantMoments.length > MAX_MOMENTS) {
    persona.memory.significantMoments = persona.memory.significantMoments.slice(
      0,
      MAX_MOMENTS
    );
  }

  // Update recurring themes based on tags
  for (const tag of tags) {
    if (!persona.memory.recurringThemes.includes(tag)) {
      const tagCount = persona.memory.significantMoments.filter((m) =>
        m.tags.includes(tag)
      ).length;
      if (tagCount >= 3) {
        persona.memory.recurringThemes.push(tag);
      }
    }
  }

  persona.updatedAt = now;
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Increment interaction count and update last active time
 */
export function recordInteraction(): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.state.interactionCount += 1;
  persona.state.lastActiveAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

// ═══════════════════════════════════════════════════════════════════
// CANONIC / WORLDVIEW MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Add a passage to the canonic text (identity-building)
 */
export function addCanonicPassage(passageRef: EntityURI): CuratorPersona {
  const persona = loadCuratorPersona();

  if (!persona.canonic.passageRefs.includes(passageRef)) {
    persona.canonic.passageRefs.push(passageRef);
    persona.state.lastTrainedAt = Date.now();
    persona.updatedAt = Date.now();
    saveCuratorPersona(persona);
  }

  return persona;
}

/**
 * Remove a passage from the canonic text
 */
export function removeCanonicPassage(passageRef: EntityURI): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.canonic.passageRefs = persona.canonic.passageRefs.filter(
    (ref) => ref !== passageRef
  );
  persona.state.lastTrainedAt = Date.now();
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Add a passage to the worldview (knowledge base)
 */
export function addWorldviewPassage(passageRef: EntityURI): CuratorPersona {
  const persona = loadCuratorPersona();

  if (!persona.worldview.passageRefs.includes(passageRef)) {
    persona.worldview.passageRefs.push(passageRef);
    persona.state.lastTrainedAt = Date.now();
    persona.updatedAt = Date.now();
    saveCuratorPersona(persona);
  }

  return persona;
}

/**
 * Remove a passage from the worldview
 */
export function removeWorldviewPassage(passageRef: EntityURI): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.worldview.passageRefs = persona.worldview.passageRefs.filter(
    (ref) => ref !== passageRef
  );
  persona.state.lastTrainedAt = Date.now();
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Update embedding anchors (main themes for filtering)
 */
export function updateEmbeddingAnchors(anchors: string[]): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.worldview.embeddingAnchors = anchors;
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Update worldview domains
 */
export function updateWorldviewDomains(domains: string[]): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.worldview.domains = domains;
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Update the system prompt (usually regenerated from canonic text)
 */
export function updateSystemPrompt(prompt: string): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.canonic.systemPrompt = prompt;
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Update core stances
 */
export function updateCoreStances(stances: string[]): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.canonic.coreStances = stances;
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

// ═══════════════════════════════════════════════════════════════════
// APPEARANCE
// ═══════════════════════════════════════════════════════════════════

/**
 * Update curator appearance
 */
export function updateAppearance(
  updates: Partial<CuratorPersona['appearance']>
): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.appearance = { ...persona.appearance, ...updates };
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

/**
 * Toggle curator active state
 */
export function setCuratorActive(isActive: boolean): CuratorPersona {
  const persona = loadCuratorPersona();
  persona.state.isActive = isActive;
  if (isActive) {
    persona.state.lastActiveAt = Date.now();
  }
  persona.updatedAt = Date.now();
  saveCuratorPersona(persona);
  return persona;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY CONSOLIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Consolidate memory - called periodically to clean up and optimize
 */
export function consolidateMemory(): CuratorPersona {
  const persona = loadCuratorPersona();
  const now = Date.now();

  // Only consolidate if enough time has passed
  if (now - persona.memory.lastConsolidatedAt < CONSOLIDATION_INTERVAL) {
    return persona;
  }

  // Remove low-confidence preferences that haven't been observed recently
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  persona.memory.preferences = persona.memory.preferences.filter(
    (p) => p.confidence > 0.3 || p.lastObservedAt > oneWeekAgo
  );

  // Remove low-reinforcement best practices
  persona.memory.bestPractices = persona.memory.bestPractices.filter(
    (bp) => bp.reinforcementCount > 0 || bp.discoveredAt > oneWeekAgo
  );

  // Update recurring themes based on current moments
  const themeCount = new Map<string, number>();
  for (const moment of persona.memory.significantMoments) {
    for (const tag of moment.tags) {
      themeCount.set(tag, (themeCount.get(tag) || 0) + 1);
    }
  }
  persona.memory.recurringThemes = Array.from(themeCount.entries())
    .filter(([_, count]) => count >= 3)
    .map(([tag]) => tag);

  persona.memory.lastConsolidatedAt = now;
  persona.updatedAt = now;
  saveCuratorPersona(persona);
  return persona;
}

// ═══════════════════════════════════════════════════════════════════
// MIGRATIONS
// ═══════════════════════════════════════════════════════════════════

function migratePersona(
  old: Partial<CuratorPersona & { _version?: number }>
): CuratorPersona {
  // Start with defaults
  const migrated = createDefaultCuratorPersona(
    old.uri || 'curator://user/default',
    old.name || 'Guide'
  );

  // Copy over any existing data
  if (old.canonic) {
    migrated.canonic = { ...migrated.canonic, ...old.canonic };
  }
  if (old.worldview) {
    migrated.worldview = { ...migrated.worldview, ...old.worldview };
  }
  if (old.memory) {
    migrated.memory = { ...migrated.memory, ...old.memory };
  }
  if (old.appearance) {
    migrated.appearance = { ...migrated.appearance, ...old.appearance };
  }
  if (old.state) {
    migrated.state = { ...migrated.state, ...old.state };
  }

  saveCuratorPersona(migrated);
  return migrated;
}

// ═══════════════════════════════════════════════════════════════════
// QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get best practices for a specific context
 */
export function getBestPracticesFor(context: string): CuratorBestPractice[] {
  const persona = loadCuratorPersona();
  const contextLower = context.toLowerCase();
  return persona.memory.bestPractices.filter((bp) =>
    bp.context.toLowerCase().includes(contextLower)
  );
}

/**
 * Get preference value
 */
export function getPreference(
  category: CuratorPreference['category'],
  key: string
): string | null {
  const persona = loadCuratorPersona();
  const pref = persona.memory.preferences.find(
    (p) => p.category === category && p.key === key
  );
  return pref?.value ?? null;
}

/**
 * Get moments by tag
 */
export function getMomentsByTag(tag: string): CuratorMoment[] {
  const persona = loadCuratorPersona();
  return persona.memory.significantMoments.filter((m) => m.tags.includes(tag));
}

/**
 * Check if curator has canonic passages defined
 */
export function hasCanonicIdentity(): boolean {
  const persona = loadCuratorPersona();
  return persona.canonic.passageRefs.length > 0;
}

/**
 * Check if curator has worldview defined
 */
export function hasWorldview(): boolean {
  const persona = loadCuratorPersona();
  return persona.worldview.passageRefs.length > 0;
}

// ═══════════════════════════════════════════════════════════════════
// REACT HOOK
// ═══════════════════════════════════════════════════════════════════

/**
 * React hook for curator persona with auto-sync
 */
export function useCuratorPersona() {
  const [persona, setPersona] = useState<CuratorPersona>(loadCuratorPersona);

  // Listen for changes from other tabs/windows
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setPersona(JSON.parse(e.newValue));
        } catch {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Periodic memory consolidation
  useEffect(() => {
    const interval = setInterval(() => {
      const updated = consolidateMemory();
      setPersona(updated);
    }, 60 * 60 * 1000); // Check every hour

    return () => clearInterval(interval);
  }, []);

  const updatePersona = useCallback((updates: Partial<CuratorPersona>) => {
    const current = loadCuratorPersona();
    const updated = { ...current, ...updates, updatedAt: Date.now() };
    saveCuratorPersona(updated);
    setPersona(updated);
    return updated;
  }, []);

  const addCanonic = useCallback((passageRef: EntityURI) => {
    const updated = addCanonicPassage(passageRef);
    setPersona(updated);
  }, []);

  const addWorldview = useCallback((passageRef: EntityURI) => {
    const updated = addWorldviewPassage(passageRef);
    setPersona(updated);
  }, []);

  const learnBestPractice = useCallback(
    (practice: string, context: string, source?: string) => {
      const updated = addBestPractice(practice, context, source);
      setPersona(updated);
    },
    []
  );

  const learnPreference = useCallback(
    (category: CuratorPreference['category'], key: string, value: string) => {
      const updated = updatePreference(category, key, value);
      setPersona(updated);
    },
    []
  );

  const recordMoment = useCallback(
    (
      summary: string,
      significance: string,
      tags: string[],
      passages?: EntityURI[]
    ) => {
      const updated = recordSignificantMoment(
        summary,
        significance,
        tags,
        passages
      );
      setPersona(updated);
    },
    []
  );

  const reset = useCallback(() => {
    const fresh = resetCuratorPersona();
    setPersona(fresh);
  }, []);

  return {
    persona,
    updatePersona,
    addCanonic,
    addWorldview,
    learnBestPractice,
    learnPreference,
    recordMoment,
    reset,
    isConfigured: hasCanonicIdentity() || hasWorldview(),
    hasIdentity: hasCanonicIdentity(),
    hasKnowledge: hasWorldview(),
  };
}
