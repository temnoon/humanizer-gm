/**
 * CatuskotiFilterContext - Global state management for Catuskoti filters
 *
 * Provides filter state and actions to any component in the tree.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import {
  CatuskotiFilter,
  CatuskotiState,
  FilterCategory,
  catuskotiToQueryParams,
  countActiveFilters,
  hasActiveFilters,
} from './types';

// =======================================================================
// Context Types
// =======================================================================

interface CatuskotiFilterContextValue {
  /** All filters */
  filters: Map<string, CatuskotiFilter>;

  /** Filters as array for rendering */
  filterList: CatuskotiFilter[];

  /** Set a filter's state */
  setFilterState: (filterId: string, state: CatuskotiState) => void;

  /** Clear a single filter (set to neutral) */
  clearFilter: (filterId: string) => void;

  /** Clear all filters */
  clearAllFilters: () => void;

  /** Number of active (non-neutral) filters */
  activeFilterCount: number;

  /** Whether any filters are active */
  hasActiveFilters: boolean;

  /** Get query parameters for API calls */
  getQueryParams: () => ReturnType<typeof catuskotiToQueryParams>;

  /** Initialize/update filters from source data */
  initializeFilters: (sourceData: Array<{ id: string; label: string; count: number; category: FilterCategory; value: string }>) => void;
}

// =======================================================================
// Context
// =======================================================================

const CatuskotiFilterContext = createContext<CatuskotiFilterContextValue | null>(null);

// =======================================================================
// Hook
// =======================================================================

export function useCatuskotiFilters() {
  const context = useContext(CatuskotiFilterContext);
  if (!context) {
    throw new Error('useCatuskotiFilters must be used within CatuskotiFilterProvider');
  }
  return context;
}

// =======================================================================
// Provider
// =======================================================================

interface CatuskotiFilterProviderProps {
  children: ReactNode;
  initialFilters?: CatuskotiFilter[];
}

export function CatuskotiFilterProvider({
  children,
  initialFilters = [],
}: CatuskotiFilterProviderProps) {
  const [filters, setFilters] = useState<Map<string, CatuskotiFilter>>(() => {
    const map = new Map<string, CatuskotiFilter>();
    for (const filter of initialFilters) {
      map.set(filter.id, { ...filter, state: filter.state || 'neutral' });
    }
    return map;
  });

  // Set a specific filter's state
  const setFilterState = useCallback((filterId: string, state: CatuskotiState) => {
    setFilters(prev => {
      const next = new Map(prev);
      const filter = next.get(filterId);
      if (filter) {
        next.set(filterId, { ...filter, state });
      }
      return next;
    });
  }, []);

  // Clear a single filter
  const clearFilter = useCallback((filterId: string) => {
    setFilterState(filterId, 'neutral');
  }, [setFilterState]);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilters(prev => {
      const next = new Map(prev);
      for (const [id, filter] of next) {
        next.set(id, { ...filter, state: 'neutral' });
      }
      return next;
    });
  }, []);

  // Initialize filters from source data (e.g., from API stats)
  const initializeFilters = useCallback(
    (sourceData: Array<{ id: string; label: string; count: number; category: FilterCategory; value: string }>) => {
      setFilters(prev => {
        const next = new Map<string, CatuskotiFilter>();
        for (const data of sourceData) {
          // Preserve existing state if filter already exists
          const existing = prev.get(data.id);
          next.set(data.id, {
            id: data.id,
            label: data.label,
            count: data.count,
            category: data.category,
            value: data.value,
            state: existing?.state || 'neutral',
          });
        }
        return next;
      });
    },
    []
  );

  // Computed values
  const filterList = useMemo(() => Array.from(filters.values()), [filters]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const hasActiveFiltersValue = useMemo(() => hasActiveFilters(filters), [filters]);

  const getQueryParams = useCallback(() => catuskotiToQueryParams(filters), [filters]);

  // Context value
  const value: CatuskotiFilterContextValue = {
    filters,
    filterList,
    setFilterState,
    clearFilter,
    clearAllFilters,
    activeFilterCount,
    hasActiveFilters: hasActiveFiltersValue,
    getQueryParams,
    initializeFilters,
  };

  return (
    <CatuskotiFilterContext.Provider value={value}>
      {children}
    </CatuskotiFilterContext.Provider>
  );
}
