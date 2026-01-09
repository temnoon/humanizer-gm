/**
 * Tool Registry - Configurable tools with visibility settings
 *
 * Defines all available tools in the ToolsPanel with metadata
 * and handles persisting visibility preferences to localStorage.
 *
 * Extracted from Studio.tsx during modularization
 */

export interface ToolDefinition {
  id: string;
  icon: string;
  label: string;
  description: string;
  category: 'transform' | 'analyze' | 'edit' | 'book' | 'advanced' | 'settings';
  defaultVisible: boolean;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Transform tools - the main humanizer features
  { id: 'humanizer', icon: '✦', label: 'Humanize', description: 'Computer humanizer - make AI text human', category: 'transform', defaultVisible: true },
  { id: 'persona', icon: '◐', label: 'Persona', description: 'Apply persona transformation', category: 'transform', defaultVisible: true },
  { id: 'style', icon: '❧', label: 'Style', description: 'Style transformation', category: 'transform', defaultVisible: true },

  // Analyze tools
  { id: 'sentencing', icon: '◈', label: 'Sentencing', description: 'Narrative sentencing - quantum density analysis', category: 'analyze', defaultVisible: true },
  { id: 'profile', icon: '◑', label: 'Profile', description: 'Profile factory - create personas', category: 'analyze', defaultVisible: true },

  // Edit tools
  { id: 'editor', icon: '¶', label: 'Editor', description: 'Markdown editor', category: 'edit', defaultVisible: true },
  { id: 'harvest', icon: '🌾', label: 'Harvest', description: 'Passage curation queue', category: 'edit', defaultVisible: true },

  // Book tools
  { id: 'arc', icon: '◠', label: 'Arc', description: 'Trace narrative arcs through your archive', category: 'book', defaultVisible: true },
  { id: 'threads', icon: '⚯', label: 'Threads', description: 'Discover thematic threads', category: 'book', defaultVisible: true },
  { id: 'chapters', icon: '❡', label: 'Chapters', description: 'Manage book chapters', category: 'book', defaultVisible: true },

  // Advanced tools (hidden by default)
  { id: 'pipelines', icon: '⚡', label: 'Pipelines', description: 'Preset workflows', category: 'advanced', defaultVisible: false },
  { id: 'split', icon: '✂', label: 'Split', description: 'Split content into parts', category: 'advanced', defaultVisible: false },
  { id: 'filter', icon: '◇', label: 'Filter', description: 'Filter by criteria', category: 'advanced', defaultVisible: false },
  { id: 'order', icon: '≡', label: 'Order', description: 'Arrange content', category: 'advanced', defaultVisible: false },
  { id: 'buffer', icon: '◎', label: 'Buffer', description: 'Buffer operations', category: 'advanced', defaultVisible: false },

  // Settings - always last
  { id: 'settings', icon: '⚙', label: 'Settings', description: 'Tool visibility settings', category: 'settings', defaultVisible: true },
];

// Storage key for localStorage
const STORAGE_KEY = 'humanizer-tool-visibility';

/**
 * Load tool visibility preferences from localStorage
 * Returns defaults if nothing saved or on error
 */
export function loadToolVisibility(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load tool visibility:', e);
  }
  // Return defaults
  return TOOL_REGISTRY.reduce((acc, tool) => {
    acc[tool.id] = tool.defaultVisible;
    return acc;
  }, {} as Record<string, boolean>);
}

/**
 * Save tool visibility preferences to localStorage
 */
export function saveToolVisibility(visibility: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch (e) {
    console.error('Failed to save tool visibility:', e);
  }
}
