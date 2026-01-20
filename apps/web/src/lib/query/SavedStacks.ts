/**
 * SavedStacks - Storage and management for named filter stacks
 *
 * Provides:
 * - localStorage persistence
 * - CRUD operations for stacks
 * - Keyboard shortcut assignments (Ctrl+1..9)
 * - Optional sync to archive server
 */

import type { SavedStack, FilterTree } from './types';
import { parseQuery } from './QueryParser';

const STORAGE_KEY = 'humanizer:saved-stacks';
const MAX_STACKS = 50;

/**
 * SavedStacksStore - Manages saved filter stacks
 */
export class SavedStacksStore {
  private stacks: Map<string, SavedStack> = new Map();
  private listeners: Set<(stacks: SavedStack[]) => void> = new Set();
  private archiveServerUrl?: string;

  constructor(archiveServerUrl?: string) {
    this.archiveServerUrl = archiveServerUrl;
    this.loadFromStorage();
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Get all saved stacks
   */
  getAll(): SavedStack[] {
    return Array.from(this.stacks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get stacks as a Map (for parser resolution)
   */
  getAsMap(): Map<string, SavedStack> {
    return new Map(this.stacks);
  }

  /**
   * Get a stack by name
   */
  get(name: string): SavedStack | undefined {
    return this.stacks.get(name.toLowerCase());
  }

  /**
   * Get a stack by ID
   */
  getById(id: string): SavedStack | undefined {
    for (const stack of this.stacks.values()) {
      if (stack.id === id) return stack;
    }
    return undefined;
  }

  /**
   * Get stack by keyboard shortcut (1-9)
   */
  getByShortcut(shortcut: number): SavedStack | undefined {
    for (const stack of this.stacks.values()) {
      if (stack.keyboardShortcut === shortcut) return stack;
    }
    return undefined;
  }

  /**
   * Create a new saved stack
   */
  create(
    name: string,
    query: string,
    options: {
      description?: string;
      resultCount?: number;
      keyboardShortcut?: number;
    } = {}
  ): SavedStack {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    // Check for duplicate name
    if (this.stacks.has(normalizedName)) {
      throw new Error(`Stack with name "${normalizedName}" already exists`);
    }

    // Check max stacks
    if (this.stacks.size >= MAX_STACKS) {
      throw new Error(`Maximum of ${MAX_STACKS} saved stacks reached`);
    }

    // Parse the query
    const tree = parseQuery(query);

    const stack: SavedStack = {
      id: generateId(),
      name: normalizedName,
      query,
      tree,
      description: options.description,
      resultCount: options.resultCount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedToArchive: false,
      keyboardShortcut: options.keyboardShortcut,
    };

    this.stacks.set(normalizedName, stack);
    this.saveToStorage();
    this.notifyListeners();

    return stack;
  }

  /**
   * Update an existing stack
   */
  update(
    name: string,
    updates: Partial<Pick<SavedStack, 'query' | 'description' | 'resultCount' | 'keyboardShortcut'>>
  ): SavedStack | undefined {
    const normalizedName = name.toLowerCase();
    const existing = this.stacks.get(normalizedName);
    if (!existing) return undefined;

    const updated: SavedStack = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Re-parse query if changed
    if (updates.query && updates.query !== existing.query) {
      updated.tree = parseQuery(updates.query);
    }

    this.stacks.set(normalizedName, updated);
    this.saveToStorage();
    this.notifyListeners();

    return updated;
  }

  /**
   * Rename a stack
   */
  rename(oldName: string, newName: string): SavedStack | undefined {
    const normalizedOld = oldName.toLowerCase();
    const normalizedNew = newName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const existing = this.stacks.get(normalizedOld);
    if (!existing) return undefined;

    if (this.stacks.has(normalizedNew)) {
      throw new Error(`Stack with name "${normalizedNew}" already exists`);
    }

    const updated: SavedStack = {
      ...existing,
      name: normalizedNew,
      updatedAt: Date.now(),
    };

    this.stacks.delete(normalizedOld);
    this.stacks.set(normalizedNew, updated);
    this.saveToStorage();
    this.notifyListeners();

    return updated;
  }

  /**
   * Delete a stack
   */
  delete(name: string): boolean {
    const normalizedName = name.toLowerCase();
    const deleted = this.stacks.delete(normalizedName);

    if (deleted) {
      this.saveToStorage();
      this.notifyListeners();
    }

    return deleted;
  }

  /**
   * Record stack usage (updates lastUsed)
   */
  recordUsage(name: string): void {
    const normalizedName = name.toLowerCase();
    const stack = this.stacks.get(normalizedName);

    if (stack) {
      stack.lastUsed = Date.now();
      this.saveToStorage();
    }
  }

  /**
   * Assign a keyboard shortcut (1-9)
   */
  assignShortcut(name: string, shortcut: number | undefined): void {
    if (shortcut !== undefined && (shortcut < 1 || shortcut > 9)) {
      throw new Error('Keyboard shortcut must be 1-9');
    }

    const normalizedName = name.toLowerCase();
    const stack = this.stacks.get(normalizedName);
    if (!stack) return;

    // Remove shortcut from any other stack
    if (shortcut !== undefined) {
      for (const s of this.stacks.values()) {
        if (s.keyboardShortcut === shortcut) {
          s.keyboardShortcut = undefined;
        }
      }
    }

    stack.keyboardShortcut = shortcut;
    stack.updatedAt = Date.now();
    this.saveToStorage();
    this.notifyListeners();
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load stacks from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored) as SavedStack[];
      for (const stack of data) {
        // Re-parse query to ensure tree is valid
        stack.tree = parseQuery(stack.query);
        this.stacks.set(stack.name, stack);
      }
    } catch (error) {
      console.error('[SavedStacks] Failed to load from storage:', error);
    }
  }

  /**
   * Save stacks to localStorage
   */
  private saveToStorage(): void {
    try {
      const data = Array.from(this.stacks.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[SavedStacks] Failed to save to storage:', error);
    }
  }

  // ==========================================================================
  // Listeners
  // ==========================================================================

  /**
   * Subscribe to stack changes
   */
  subscribe(listener: (stacks: SavedStack[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const stacks = this.getAll();
    for (const listener of this.listeners) {
      listener(stacks);
    }
  }

  // ==========================================================================
  // Sync to Archive Server (Optional)
  // ==========================================================================

  /**
   * Sync a stack to the archive server
   */
  async syncToArchive(name: string): Promise<boolean> {
    if (!this.archiveServerUrl) return false;

    const stack = this.get(name);
    if (!stack) return false;

    try {
      const response = await fetch(`${this.archiveServerUrl}/api/saved-stacks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: stack.id,
          name: stack.name,
          query: stack.query,
          description: stack.description,
        }),
      });

      if (response.ok) {
        stack.syncedToArchive = true;
        this.saveToStorage();
        this.notifyListeners();
        return true;
      }
    } catch (error) {
      console.error('[SavedStacks] Failed to sync to archive:', error);
    }

    return false;
  }

  /**
   * Load stacks from the archive server
   */
  async loadFromArchive(): Promise<number> {
    if (!this.archiveServerUrl) return 0;

    try {
      const response = await fetch(`${this.archiveServerUrl}/api/saved-stacks`);
      if (!response.ok) return 0;

      const data = await response.json() as Array<{ id: string; name: string; query: string; description?: string }>;
      let imported = 0;

      for (const item of data) {
        if (!this.stacks.has(item.name)) {
          const tree = parseQuery(item.query);
          const stack: SavedStack = {
            id: item.id,
            name: item.name,
            query: item.query,
            tree,
            description: item.description,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            syncedToArchive: true,
          };
          this.stacks.set(item.name, stack);
          imported++;
        }
      }

      if (imported > 0) {
        this.saveToStorage();
        this.notifyListeners();
      }

      return imported;
    } catch (error) {
      console.error('[SavedStacks] Failed to load from archive:', error);
      return 0;
    }
  }
}

// ==========================================================================
// Singleton instance
// ==========================================================================

let instance: SavedStacksStore | null = null;

/**
 * Get or create the singleton SavedStacksStore
 */
export function getSavedStacksStore(archiveServerUrl?: string): SavedStacksStore {
  if (!instance) {
    instance = new SavedStacksStore(archiveServerUrl);
  }
  return instance;
}

// ==========================================================================
// Utilities
// ==========================================================================

function generateId(): string {
  return `stack-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Export stacks to JSON for backup
 */
export function exportStacks(stacks: SavedStack[]): string {
  return JSON.stringify(stacks, null, 2);
}

/**
 * Import stacks from JSON
 */
export function importStacks(json: string): SavedStack[] {
  const data = JSON.parse(json) as SavedStack[];
  return data.map(stack => ({
    ...stack,
    tree: parseQuery(stack.query),
  }));
}
