/**
 * Catuskoti Filter Types
 *
 * Based on the Buddhist tetralemma (four-cornered logic):
 * 1. Is (Affirmation) - "I want this"
 * 2. Is Not (Negation) - "I don't want this"
 * 3. Both - "Items that span/transcend this category"
 * 4. Neither - "Items that defy categorization here"
 */

/**
 * The five states of Catuskoti logic (including neutral)
 */
export type CatuskotiState = 'neutral' | 'is' | 'is-not' | 'both' | 'neither';

/**
 * Filter category types
 */
export type FilterCategory = 'source' | 'format' | 'date' | 'attribute';

/**
 * A single filter facet with Catuskoti state
 */
export interface CatuskotiFilter {
  /** Unique identifier for this filter (e.g., 'source:chatgpt') */
  id: string;

  /** Display label */
  label: string;

  /** Current filter state */
  state: CatuskotiState;

  /** Number of items matching this filter in neutral state */
  count: number;

  /** Category this filter belongs to */
  category: FilterCategory;

  /** The actual filter value to apply */
  value: string;
}

/**
 * Props for the CatuskotiChip component
 */
export interface CatuskotiChipProps {
  filter: CatuskotiFilter;
  onStateChange: (filterId: string, newState: CatuskotiState) => void;
  onDismiss?: (filterId: string) => void;
  dismissible?: boolean;
  compact?: boolean;
}

/**
 * Props for the CatuskotiFilterBar component
 */
export interface CatuskotiFilterBarProps {
  filters: CatuskotiFilter[];
  onFilterChange: (filterId: string, newState: CatuskotiState) => void;
  onClearAll: () => void;
  expanded?: boolean;
  onExpandToggle?: () => void;
}

// =======================================================================
// UTILITY FUNCTIONS
// =======================================================================

/**
 * State cycle order - most common actions first
 */
const STATE_CYCLE: CatuskotiState[] = ['neutral', 'is', 'is-not', 'both', 'neither'];

/**
 * Advance to the next state in the Catuskoti cycle
 */
export function nextCatuskotiState(current: CatuskotiState): CatuskotiState {
  const currentIndex = STATE_CYCLE.indexOf(current);
  return STATE_CYCLE[(currentIndex + 1) % STATE_CYCLE.length];
}

/**
 * Get the icon for a state
 */
export function getCatuskotiIcon(state: CatuskotiState): string {
  const icons: Record<CatuskotiState, string> = {
    'neutral': '○',
    'is': '●',
    'is-not': '⊘',
    'both': '◐',
    'neither': '◯',
  };
  return icons[state];
}

/**
 * Get human-readable description of a state
 */
export function describeCatuskotiState(state: CatuskotiState, label: string): string {
  const descriptions: Record<CatuskotiState, string> = {
    'neutral': `${label}: no filter`,
    'is': `Including ${label}`,
    'is-not': `Excluding ${label}`,
    'both': `${label}: spanning items`,
    'neither': `${label}: uncategorized`,
  };
  return descriptions[state];
}

/**
 * Get aria label for current state and next action
 */
export function getCatuskotiAriaLabel(state: CatuskotiState, label: string): string {
  const nextState = nextCatuskotiState(state);
  const current = describeCatuskotiState(state, label);
  const next = describeCatuskotiState(nextState, label);
  return `${current}. Click to change to: ${next}`;
}

/**
 * Convert Catuskoti filters to API query parameters
 */
export function catuskotiToQueryParams(
  filters: Map<string, CatuskotiFilter>
): {
  include: string[];
  exclude: string[];
  spanning: string[];
  uncategorized: string[];
} {
  const params = {
    include: [] as string[],
    exclude: [] as string[],
    spanning: [] as string[],
    uncategorized: [] as string[],
  };

  for (const filter of filters.values()) {
    switch (filter.state) {
      case 'is':
        params.include.push(filter.value);
        break;
      case 'is-not':
        params.exclude.push(filter.value);
        break;
      case 'both':
        params.spanning.push(filter.value);
        break;
      case 'neither':
        params.uncategorized.push(filter.value);
        break;
      // 'neutral' adds nothing
    }
  }

  return params;
}

/**
 * Check if any filters are active (non-neutral)
 */
export function hasActiveFilters(filters: Map<string, CatuskotiFilter>): boolean {
  for (const filter of filters.values()) {
    if (filter.state !== 'neutral') return true;
  }
  return false;
}

/**
 * Count active filters
 */
export function countActiveFilters(filters: Map<string, CatuskotiFilter>): number {
  let count = 0;
  for (const filter of filters.values()) {
    if (filter.state !== 'neutral') count++;
  }
  return count;
}
