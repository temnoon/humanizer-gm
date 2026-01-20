/**
 * CatuskotiFilterBar - Horizontal filter bar with Catuskoti chips
 *
 * Features:
 * - Compact horizontal scroll by default
 * - Groups filters by category
 * - Shows active filter count
 * - Clear all button
 */

import { useMemo } from 'react';
import { CatuskotiChip } from './CatuskotiChip';
import { CatuskotiFilter, CatuskotiState, FilterCategory } from './types';
import './catuskoti.css';

interface CatuskotiFilterBarProps {
  filters: CatuskotiFilter[];
  onFilterChange: (filterId: string, newState: CatuskotiState) => void;
  onClearAll: () => void;
  showCounts?: boolean;
}

export function CatuskotiFilterBar({
  filters,
  onFilterChange,
  onClearAll,
  showCounts = true,
}: CatuskotiFilterBarProps) {
  // Count active filters
  const activeCount = useMemo(() => {
    return filters.filter(f => f.state !== 'neutral').length;
  }, [filters]);

  // Group filters by category
  const groupedFilters = useMemo(() => {
    const groups: Record<FilterCategory, CatuskotiFilter[]> = {
      source: [],
      format: [],
      date: [],
      attribute: [],
    };

    for (const filter of filters) {
      groups[filter.category].push(filter);
    }

    return groups;
  }, [filters]);

  // Get category labels
  const categoryLabels: Record<FilterCategory, string> = {
    source: 'Sources',
    format: 'Format',
    date: 'Time',
    attribute: 'Attributes',
  };

  return (
    <div className="catuskoti-filter-bar">
      {/* Filter groups */}
      {Object.entries(groupedFilters).map(([category, categoryFilters]) => {
        if (categoryFilters.length === 0) return null;

        return (
          <div key={category} className="catuskoti-filter-bar__group">
            <span className="catuskoti-filter-bar__label">
              {categoryLabels[category as FilterCategory]}:
            </span>
            {categoryFilters.map(filter => (
              <CatuskotiChip
                key={filter.id}
                filter={filter}
                onStateChange={onFilterChange}
              />
            ))}
            <span className="catuskoti-filter-bar__divider" />
          </div>
        );
      })}

      {/* Clear button */}
      {activeCount > 0 && (
        <button
          className="catuskoti-filter-bar__clear"
          onClick={onClearAll}
        >
          Clear{showCounts && ` (${activeCount})`}
        </button>
      )}
    </div>
  );
}

/**
 * CatuskotiActiveStrip - Shows currently active filters in a compact strip
 */
interface CatuskotiActiveStripProps {
  filters: CatuskotiFilter[];
  onFilterChange: (filterId: string, newState: CatuskotiState) => void;
  onClearFilter: (filterId: string) => void;
  onClearAll: () => void;
}

export function CatuskotiActiveStrip({
  filters,
  onFilterChange,
  onClearFilter,
  onClearAll,
}: CatuskotiActiveStripProps) {
  const activeFilters = useMemo(() => {
    return filters.filter(f => f.state !== 'neutral');
  }, [filters]);

  if (activeFilters.length === 0) return null;

  return (
    <div className="catuskoti-active-strip">
      <span className="catuskoti-active-strip__label">Active filters:</span>
      <div className="catuskoti-active-strip__chips">
        {activeFilters.map(filter => (
          <CatuskotiChip
            key={filter.id}
            filter={filter}
            onStateChange={onFilterChange}
            onDismiss={onClearFilter}
            dismissible
            compact
          />
        ))}
      </div>
      <button
        className="catuskoti-filter-bar__clear"
        onClick={onClearAll}
      >
        Clear all
      </button>
    </div>
  );
}
