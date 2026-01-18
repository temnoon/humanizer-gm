/**
 * AdaptiveFilters - Dynamic filter controls based on discovered facets
 *
 * Renders filter controls appropriate to each facet type:
 * - enum: Dropdown or chips with top values
 * - date_range: Date picker with presets
 * - numeric_range: Dual slider
 * - boolean: Toggle switch
 *
 * Only shows facets with sufficient coverage (relevant to user's data).
 */

import { useState, useCallback, useMemo } from 'react';
import {
  useFilters,
  describeFilterValue,
  isFacetUseful,
  type FacetDefinition,
  type FilterValue,
  type EnumFilterValue,
  type DateRangeFilterValue,
  type NumericRangeFilterValue,
  type BooleanFilterValue,
} from '../../lib/archive/FilterContext';

// =============================================================================
// Types
// =============================================================================

interface AdaptiveFiltersProps {
  /** Minimum coverage to show a facet (default 5%) */
  minCoverage?: number;
  /** Compact mode (chips only, no dropdowns) */
  compact?: boolean;
  /** Called when filters change */
  onFiltersChange?: (filterCount: number) => void;
}

// =============================================================================
// Sub-components
// =============================================================================

interface EnumFilterProps {
  facet: FacetDefinition;
  value: EnumFilterValue | null;
  onValueChange: (value: EnumFilterValue | null) => void;
  compact?: boolean;
}

function EnumFilter({ facet, value, onValueChange, compact }: EnumFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedValues = value?.values || [];

  const toggleValue = (val: string) => {
    const current = selectedValues;
    const next = current.includes(val)
      ? current.filter(v => v !== val)
      : [...current, val];

    if (next.length === 0) {
      onValueChange(null);
    } else {
      onValueChange({ type: 'enum', values: next });
    }
  };

  // Show top 5 values as chips if compact or if distinct count is low
  const showAsChips = compact || (facet.distinctCount <= 6);
  const topValues = facet.topValues?.slice(0, showAsChips ? 6 : 10) || [];

  if (showAsChips) {
    return (
      <div className="adaptive-filter adaptive-filter--enum">
        <span className="adaptive-filter__label">{facet.label}:</span>
        <div className="adaptive-filter__chips">
          {topValues.map(tv => (
            <button
              key={tv.value}
              className={`adaptive-filter__chip ${selectedValues.includes(tv.value) ? 'adaptive-filter__chip--active' : ''}`}
              onClick={() => toggleValue(tv.value)}
              title={`${tv.value} (${tv.count})`}
            >
              {tv.value}
              <span className="adaptive-filter__chip-count">{tv.count}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Dropdown for many values
  return (
    <div className="adaptive-filter adaptive-filter--enum adaptive-filter--dropdown">
      <button
        className={`adaptive-filter__dropdown-trigger ${selectedValues.length > 0 ? 'adaptive-filter__dropdown-trigger--active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="adaptive-filter__label">{facet.label}</span>
        {selectedValues.length > 0 && (
          <span className="adaptive-filter__badge">{selectedValues.length}</span>
        )}
        <span className="adaptive-filter__arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="adaptive-filter__dropdown">
          {topValues.map(tv => (
            <label key={tv.value} className="adaptive-filter__dropdown-item">
              <input
                type="checkbox"
                checked={selectedValues.includes(tv.value)}
                onChange={() => toggleValue(tv.value)}
              />
              <span className="adaptive-filter__dropdown-value">{tv.value}</span>
              <span className="adaptive-filter__dropdown-count">{tv.count}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface DateRangeFilterProps {
  facet: FacetDefinition;
  value: DateRangeFilterValue | null;
  onValueChange: (value: DateRangeFilterValue | null) => void;
}

function DateRangeFilter({ facet, value, onValueChange }: DateRangeFilterProps) {
  const range = facet.range as { min: number; max: number } | undefined;
  if (!range) return null;

  const minDate = new Date(range.min * 1000).toISOString().split('T')[0];
  const maxDate = new Date(range.max * 1000).toISOString().split('T')[0];

  const currentMin = value?.min ? new Date(value.min * 1000).toISOString().split('T')[0] : '';
  const currentMax = value?.max ? new Date(value.max * 1000).toISOString().split('T')[0] : '';

  const handleChange = (field: 'min' | 'max', dateStr: string) => {
    const timestamp = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : undefined;
    const newValue: DateRangeFilterValue = {
      type: 'date_range',
      min: field === 'min' ? timestamp : value?.min,
      max: field === 'max' ? timestamp : value?.max,
    };

    if (!newValue.min && !newValue.max) {
      onValueChange(null);
    } else {
      onValueChange(newValue);
    }
  };

  // Quick presets
  const applyPreset = (preset: 'week' | 'month' | 'year' | 'all') => {
    const now = Date.now() / 1000;
    let min: number | undefined;

    switch (preset) {
      case 'week':
        min = now - 7 * 24 * 60 * 60;
        break;
      case 'month':
        min = now - 30 * 24 * 60 * 60;
        break;
      case 'year':
        min = now - 365 * 24 * 60 * 60;
        break;
      case 'all':
        onValueChange(null);
        return;
    }

    onValueChange({ type: 'date_range', min, max: now });
  };

  return (
    <div className="adaptive-filter adaptive-filter--date-range">
      <span className="adaptive-filter__label">{facet.label}:</span>
      <div className="adaptive-filter__date-presets">
        <button
          className="adaptive-filter__preset"
          onClick={() => applyPreset('week')}
        >
          Week
        </button>
        <button
          className="adaptive-filter__preset"
          onClick={() => applyPreset('month')}
        >
          Month
        </button>
        <button
          className="adaptive-filter__preset"
          onClick={() => applyPreset('year')}
        >
          Year
        </button>
        <button
          className="adaptive-filter__preset"
          onClick={() => applyPreset('all')}
        >
          All
        </button>
      </div>
      <div className="adaptive-filter__date-inputs">
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={currentMin}
          onChange={(e) => handleChange('min', e.target.value)}
          className="adaptive-filter__date-input"
        />
        <span className="adaptive-filter__date-separator">to</span>
        <input
          type="date"
          min={minDate}
          max={maxDate}
          value={currentMax}
          onChange={(e) => handleChange('max', e.target.value)}
          className="adaptive-filter__date-input"
        />
      </div>
    </div>
  );
}

interface NumericRangeFilterProps {
  facet: FacetDefinition;
  value: NumericRangeFilterValue | null;
  onValueChange: (value: NumericRangeFilterValue | null) => void;
}

function NumericRangeFilter({ facet, value, onValueChange }: NumericRangeFilterProps) {
  const range = facet.range as { min: number; max: number } | undefined;
  if (!range) return null;

  const currentMin = value?.min ?? range.min;
  const currentMax = value?.max ?? range.max;

  const handleChange = (field: 'min' | 'max', numVal: number) => {
    const newValue: NumericRangeFilterValue = {
      type: 'numeric_range',
      min: field === 'min' ? numVal : value?.min,
      max: field === 'max' ? numVal : value?.max,
    };

    // Clear if back to full range
    if (newValue.min === range.min && newValue.max === range.max) {
      onValueChange(null);
    } else if (!newValue.min && !newValue.max) {
      onValueChange(null);
    } else {
      onValueChange(newValue);
    }
  };

  return (
    <div className="adaptive-filter adaptive-filter--numeric-range">
      <span className="adaptive-filter__label">{facet.label}:</span>
      <div className="adaptive-filter__range-inputs">
        <input
          type="number"
          min={range.min}
          max={range.max}
          value={currentMin}
          onChange={(e) => handleChange('min', parseInt(e.target.value, 10))}
          className="adaptive-filter__range-input"
        />
        <span className="adaptive-filter__range-separator">to</span>
        <input
          type="number"
          min={range.min}
          max={range.max}
          value={currentMax}
          onChange={(e) => handleChange('max', parseInt(e.target.value, 10))}
          className="adaptive-filter__range-input"
        />
      </div>
    </div>
  );
}

interface BooleanFilterProps {
  facet: FacetDefinition;
  value: BooleanFilterValue | null;
  onValueChange: (value: BooleanFilterValue | null) => void;
}

function BooleanFilter({ facet, value, onValueChange }: BooleanFilterProps) {
  const trueCount = facet.topValues?.find(v => v.value === 'true')?.count || 0;
  const falseCount = facet.topValues?.find(v => v.value === 'false')?.count || 0;

  const handleChange = (newValue: boolean | null) => {
    if (newValue === null) {
      onValueChange(null);
    } else {
      onValueChange({ type: 'boolean', value: newValue });
    }
  };

  return (
    <div className="adaptive-filter adaptive-filter--boolean">
      <span className="adaptive-filter__label">{facet.label}:</span>
      <div className="adaptive-filter__boolean-options">
        <button
          className={`adaptive-filter__boolean-btn ${value === null ? 'adaptive-filter__boolean-btn--active' : ''}`}
          onClick={() => handleChange(null)}
        >
          All
        </button>
        <button
          className={`adaptive-filter__boolean-btn ${value?.value === true ? 'adaptive-filter__boolean-btn--active' : ''}`}
          onClick={() => handleChange(true)}
        >
          Yes ({trueCount})
        </button>
        <button
          className={`adaptive-filter__boolean-btn ${value?.value === false ? 'adaptive-filter__boolean-btn--active' : ''}`}
          onClick={() => handleChange(false)}
        >
          No ({falseCount})
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function AdaptiveFilters({
  minCoverage = 5,
  compact = false,
  onFiltersChange,
}: AdaptiveFiltersProps) {
  const {
    availableFacets,
    activeFilters,
    isLoading,
    error,
    setFilter,
    clearAllFilters,
    hasActiveFilters,
    activeFilterCount,
    loadFacets,
  } = useFilters();

  // Filter facets by coverage and usefulness
  const visibleFacets = useMemo(() => {
    return availableFacets.filter(f =>
      f.coverage >= minCoverage && isFacetUseful(f)
    );
  }, [availableFacets, minCoverage]);

  const handleFilterChange = useCallback((field: string, value: FilterValue | null) => {
    setFilter(field, value);
    onFiltersChange?.(value === null ? activeFilterCount - 1 : activeFilterCount + 1);
  }, [setFilter, activeFilterCount, onFiltersChange]);

  const handleClearAll = useCallback(() => {
    clearAllFilters();
    onFiltersChange?.(0);
  }, [clearAllFilters, onFiltersChange]);

  // Loading state
  if (isLoading && visibleFacets.length === 0) {
    return (
      <div className="adaptive-filters adaptive-filters--loading">
        <span className="adaptive-filters__loading-text">Loading filters...</span>
      </div>
    );
  }

  // Error state
  if (error && visibleFacets.length === 0) {
    return (
      <div className="adaptive-filters adaptive-filters--error">
        <span className="adaptive-filters__error-text">{error}</span>
        <button
          className="adaptive-filters__retry-btn"
          onClick={() => loadFacets(true)}
        >
          Retry
        </button>
      </div>
    );
  }

  // No facets available
  if (visibleFacets.length === 0) {
    return null; // Don't render anything if no facets
  }

  return (
    <div className={`adaptive-filters ${compact ? 'adaptive-filters--compact' : ''}`}>
      <div className="adaptive-filters__header">
        <span className="adaptive-filters__title">Filters</span>
        {hasActiveFilters && (
          <button
            className="adaptive-filters__clear-btn"
            onClick={handleClearAll}
          >
            Clear ({activeFilterCount})
          </button>
        )}
      </div>

      <div className="adaptive-filters__list">
        {visibleFacets.map(facet => {
          const currentValue = activeFilters.get(facet.field) || null;

          switch (facet.type) {
            case 'enum':
              return (
                <EnumFilter
                  key={facet.field}
                  facet={facet}
                  value={currentValue as EnumFilterValue | null}
                  onValueChange={(v) => handleFilterChange(facet.field, v)}
                  compact={compact}
                />
              );

            case 'date_range':
              return (
                <DateRangeFilter
                  key={facet.field}
                  facet={facet}
                  value={currentValue as DateRangeFilterValue | null}
                  onValueChange={(v) => handleFilterChange(facet.field, v)}
                />
              );

            case 'numeric_range':
              return (
                <NumericRangeFilter
                  key={facet.field}
                  facet={facet}
                  value={currentValue as NumericRangeFilterValue | null}
                  onValueChange={(v) => handleFilterChange(facet.field, v)}
                />
              );

            case 'boolean':
              return (
                <BooleanFilter
                  key={facet.field}
                  facet={facet}
                  value={currentValue as BooleanFilterValue | null}
                  onValueChange={(v) => handleFilterChange(facet.field, v)}
                />
              );

            default:
              return null;
          }
        })}
      </div>

      {/* Active filters summary */}
      {hasActiveFilters && (
        <div className="adaptive-filters__active">
          {Array.from(activeFilters.entries()).map(([field, value]) => {
            const facet = availableFacets.find(f => f.field === field);
            if (!facet) return null;

            return (
              <span key={field} className="adaptive-filters__active-chip">
                {facet.label}: {describeFilterValue(facet, value)}
                <button
                  className="adaptive-filters__active-remove"
                  onClick={() => handleFilterChange(field, null)}
                  title="Remove filter"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CSS (to be added to the stylesheet)
// =============================================================================

/*
.adaptive-filters {
  padding: 8px 12px;
  border-bottom: 1px solid var(--studio-border);
  background: var(--color-bg-secondary);
}

.adaptive-filters--compact {
  padding: 4px 8px;
}

.adaptive-filters__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.adaptive-filters__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.adaptive-filters__clear-btn {
  font-size: 11px;
  color: var(--studio-accent);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
}

.adaptive-filters__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.adaptive-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.adaptive-filter__label {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.adaptive-filter__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.adaptive-filter__chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--studio-border);
  border-radius: 12px;
  cursor: pointer;
  color: var(--color-text-primary);
}

.adaptive-filter__chip--active {
  background: var(--studio-accent);
  color: white;
  border-color: var(--studio-accent);
}

.adaptive-filter__chip-count {
  font-size: 10px;
  opacity: 0.7;
}

.adaptive-filter__dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--studio-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.adaptive-filter__dropdown-trigger--active {
  border-color: var(--studio-accent);
}

.adaptive-filter__badge {
  background: var(--studio-accent);
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
}

.adaptive-filter__dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 180px;
  max-height: 200px;
  overflow-y: auto;
  background: var(--color-bg-primary);
  border: 1px solid var(--studio-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 100;
}

.adaptive-filter__dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
}

.adaptive-filter__dropdown-item:hover {
  background: var(--color-bg-secondary);
}

.adaptive-filter__date-presets,
.adaptive-filter__boolean-options {
  display: flex;
  gap: 4px;
}

.adaptive-filter__preset,
.adaptive-filter__boolean-btn {
  padding: 4px 8px;
  font-size: 11px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--studio-border);
  border-radius: 4px;
  cursor: pointer;
}

.adaptive-filter__preset:hover,
.adaptive-filter__boolean-btn:hover {
  background: var(--color-bg-secondary);
}

.adaptive-filter__boolean-btn--active {
  background: var(--studio-accent);
  color: white;
  border-color: var(--studio-accent);
}

.adaptive-filter__date-inputs,
.adaptive-filter__range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.adaptive-filter__date-input,
.adaptive-filter__range-input {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--studio-border);
  border-radius: 4px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  width: 120px;
}

.adaptive-filter__range-input {
  width: 70px;
}

.adaptive-filter__date-separator,
.adaptive-filter__range-separator {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.adaptive-filters__active {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--studio-border);
}

.adaptive-filters__active-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 11px;
  background: var(--studio-accent);
  color: white;
  border-radius: 10px;
}

.adaptive-filters__active-remove {
  background: none;
  border: none;
  color: white;
  opacity: 0.7;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}

.adaptive-filters__active-remove:hover {
  opacity: 1;
}
*/
