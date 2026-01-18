/**
 * FilterContext - Centralized state for adaptive search filters
 *
 * Manages:
 * - Available facets (discovered from actual database contents)
 * - Active filters (user selections)
 * - Filter combination mode (AND/OR)
 *
 * Integrates with GUI Bridge for AUI tool communication.
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { getArchiveServerUrl } from '../platform';

// =============================================================================
// Types (mirror backend types)
// =============================================================================

export type FacetType = 'enum' | 'date_range' | 'numeric_range' | 'boolean';
export type FacetSource = 'conversations' | 'content_items' | 'content_blocks' | 'messages';

export interface TopValue {
  value: string;
  count: number;
}

export interface DateRange {
  min: number;  // Unix timestamp
  max: number;  // Unix timestamp
}

export interface NumericRange {
  min: number;
  max: number;
}

export interface FacetDefinition {
  field: string;
  label: string;
  type: FacetType;
  source: FacetSource;
  distinctCount: number;
  topValues?: TopValue[];
  range?: DateRange | NumericRange;
  coverage: number;  // Percentage of records with value (0-100)
}

export interface DiscoveryResult {
  facets: FacetDefinition[];
  discoveredAt: number;
  totalRecords: {
    conversations: number;
    contentItems: number;
    contentBlocks: number;
    messages: number;
  };
}

// =============================================================================
// Filter Value Types
// =============================================================================

export type FilterValue =
  | EnumFilterValue
  | DateRangeFilterValue
  | NumericRangeFilterValue
  | BooleanFilterValue;

export interface EnumFilterValue {
  type: 'enum';
  values: string[];  // Selected values (OR within)
}

export interface DateRangeFilterValue {
  type: 'date_range';
  min?: number;  // Unix timestamp
  max?: number;  // Unix timestamp
}

export interface NumericRangeFilterValue {
  type: 'numeric_range';
  min?: number;
  max?: number;
}

export interface BooleanFilterValue {
  type: 'boolean';
  value: boolean;
}

// =============================================================================
// Filter Spec for Search API
// =============================================================================

export interface FilterSpec {
  field: string;
  source: FacetSource;
  value: FilterValue;
}

// =============================================================================
// Context Value
// =============================================================================

export interface FilterContextValue {
  /** Available facets discovered from the database */
  availableFacets: FacetDefinition[];
  /** Active filters (keyed by field name) */
  activeFilters: Map<string, FilterValue>;
  /** Whether facets are currently loading */
  isLoading: boolean;
  /** Error from last facet load */
  error: string | null;
  /** When facets were last discovered */
  discoveredAt: number | null;
  /** Total record counts */
  totalRecords: DiscoveryResult['totalRecords'] | null;
  /** Filter combination mode */
  filterMode: 'and' | 'or';
  /** Load/refresh facets from the API */
  loadFacets: (forceRefresh?: boolean) => Promise<void>;
  /** Set a filter value for a field */
  setFilter: (field: string, value: FilterValue | null) => void;
  /** Clear a specific filter */
  clearFilter: (field: string) => void;
  /** Clear all active filters */
  clearAllFilters: () => void;
  /** Set filter combination mode */
  setFilterMode: (mode: 'and' | 'or') => void;
  /** Build filter specs for search API */
  buildFilterSpecs: () => FilterSpec[];
  /** Check if any filters are active */
  hasActiveFilters: boolean;
  /** Get count of active filters */
  activeFilterCount: number;
}

// =============================================================================
// Context
// =============================================================================

const FilterContext = createContext<FilterContextValue | null>(null);

export function useFilters(): FilterContextValue {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
}

/**
 * Convenience hook to check if a specific facet is available
 */
export function useFacet(field: string): FacetDefinition | null {
  const { availableFacets } = useFilters();
  return availableFacets.find(f => f.field === field) || null;
}

/**
 * Convenience hook for a specific filter's value
 */
export function useFilterValue(field: string): FilterValue | null {
  const { activeFilters } = useFilters();
  return activeFilters.get(field) || null;
}

// =============================================================================
// Provider
// =============================================================================

interface FilterProviderProps {
  children: ReactNode;
  /** Auto-load facets on mount */
  autoLoad?: boolean;
}

export function FilterProvider({ children, autoLoad = true }: FilterProviderProps) {
  const [availableFacets, setAvailableFacets] = useState<FacetDefinition[]>([]);
  const [activeFilters, setActiveFilters] = useState<Map<string, FilterValue>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveredAt, setDiscoveredAt] = useState<number | null>(null);
  const [totalRecords, setTotalRecords] = useState<DiscoveryResult['totalRecords'] | null>(null);
  const [filterMode, setFilterMode] = useState<'and' | 'or'>('and');

  /**
   * Load facets from the discovery API
   */
  const loadFacets = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const apiBase = await getArchiveServerUrl();
      const endpoint = forceRefresh
        ? `${apiBase}/api/embeddings/discovery/refresh`
        : `${apiBase}/api/embeddings/discovery/facets`;

      const response = await fetch(endpoint, {
        method: forceRefresh ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to load facets: ${response.statusText}`);
      }

      const result: DiscoveryResult = await response.json();

      setAvailableFacets(result.facets);
      setDiscoveredAt(result.discoveredAt);
      setTotalRecords(result.totalRecords);

      console.log(`[FilterContext] Loaded ${result.facets.length} facets`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load facets';
      setError(message);
      console.error('[FilterContext] Error loading facets:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Set a filter value
   */
  const setFilter = useCallback((field: string, value: FilterValue | null) => {
    setActiveFilters(prev => {
      const next = new Map(prev);
      if (value === null) {
        next.delete(field);
      } else {
        next.set(field, value);
      }
      return next;
    });
  }, []);

  /**
   * Clear a specific filter
   */
  const clearFilter = useCallback((field: string) => {
    setFilter(field, null);
  }, [setFilter]);

  /**
   * Clear all filters
   */
  const clearAllFilters = useCallback(() => {
    setActiveFilters(new Map());
  }, []);

  /**
   * Build filter specs for search API
   */
  const buildFilterSpecs = useCallback((): FilterSpec[] => {
    const specs: FilterSpec[] = [];

    for (const [field, value] of activeFilters) {
      const facet = availableFacets.find(f => f.field === field);
      if (facet) {
        specs.push({
          field,
          source: facet.source,
          value,
        });
      }
    }

    return specs;
  }, [activeFilters, availableFacets]);

  // Computed values
  const hasActiveFilters = activeFilters.size > 0;
  const activeFilterCount = activeFilters.size;

  // Auto-load facets on mount
  useEffect(() => {
    if (autoLoad) {
      loadFacets();
    }
  }, [autoLoad, loadFacets]);

  // Listen for GUI Bridge events to update facets
  useEffect(() => {
    const handleGUIAction = (event: CustomEvent) => {
      const action = event.detail;
      if (action?.type === 'set_available_facets' && action.data?.facets) {
        setAvailableFacets(action.data.facets);
        setDiscoveredAt(Date.now());
      }
      if (action?.type === 'apply_filter' && action.data) {
        const { field, value } = action.data;
        setFilter(field, value);
      }
      if (action?.type === 'clear_filters') {
        clearAllFilters();
      }
    };

    window.addEventListener('aui:gui-action', handleGUIAction as EventListener);
    return () => {
      window.removeEventListener('aui:gui-action', handleGUIAction as EventListener);
    };
  }, [setFilter, clearAllFilters]);

  const value: FilterContextValue = {
    availableFacets,
    activeFilters,
    isLoading,
    error,
    discoveredAt,
    totalRecords,
    filterMode,
    loadFacets,
    setFilter,
    clearFilter,
    clearAllFilters,
    setFilterMode,
    buildFilterSpecs,
    hasActiveFilters,
    activeFilterCount,
  };

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get human-readable description of a filter value
 */
export function describeFilterValue(facet: FacetDefinition, value: FilterValue): string {
  switch (value.type) {
    case 'enum':
      if (value.values.length === 1) {
        return value.values[0];
      }
      return `${value.values.length} selected`;

    case 'date_range': {
      const parts: string[] = [];
      if (value.min) {
        parts.push(`from ${new Date(value.min * 1000).toLocaleDateString()}`);
      }
      if (value.max) {
        parts.push(`to ${new Date(value.max * 1000).toLocaleDateString()}`);
      }
      return parts.join(' ') || 'any date';
    }

    case 'numeric_range': {
      const parts: string[] = [];
      if (value.min !== undefined) {
        parts.push(`>= ${value.min}`);
      }
      if (value.max !== undefined) {
        parts.push(`<= ${value.max}`);
      }
      return parts.join(', ') || 'any value';
    }

    case 'boolean':
      return value.value ? 'Yes' : 'No';

    default:
      return 'unknown';
  }
}

/**
 * Check if a facet has enough data to be useful for filtering
 */
export function isFacetUseful(facet: FacetDefinition): boolean {
  // Boolean facets need both true and false values
  if (facet.type === 'boolean') {
    const topValues = facet.topValues || [];
    const hasTrue = topValues.some(v => v.value === 'true' && v.count > 0);
    const hasFalse = topValues.some(v => v.value === 'false' && v.count > 0);
    return hasTrue && hasFalse;
  }

  // Enum facets need at least 2 values
  if (facet.type === 'enum') {
    return (facet.topValues?.length || 0) >= 2;
  }

  // Range facets need a non-trivial range
  if (facet.type === 'date_range' || facet.type === 'numeric_range') {
    const range = facet.range;
    return range !== undefined && range.min !== range.max;
  }

  return true;
}
