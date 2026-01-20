/**
 * FilterBuilder - Combined query input and visual filter tree
 *
 * Features:
 * - Query bar with syntax highlighting
 * - Visual tree display
 * - Toggle between text/visual modes
 * - Two-way sync between text and tree
 * - Quick filter chips for common operations
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { QueryBar } from './QueryBar';
import { FilterTreeView, getFilterSummary } from './FilterTreeView';
import { FilterDimensionCarousel } from './FilterDimensionCarousel';
import {
  parseQuery,
  compileFilterTree,
  filterTreeToCatuskotiFilters,
  catuskotiFiltersToTree,
  compiledQueryToString,
  type FilterTree,
  type FilterNode,
  type CompiledQuery,
  type SavedStack,
} from '../../lib/query';
import type { CatuskotiFilter } from './types';
import './filter-builder.css';

export interface FilterBuilderProps {
  /** Initial query string */
  initialQuery?: string;
  /** Initial catuskoti filters (for migration) */
  initialFilters?: CatuskotiFilter[];
  /** Called when filters change */
  onFilterChange: (compiled: CompiledQuery, tree: FilterTree) => void;
  /** Called when query is submitted */
  onSubmit?: (compiled: CompiledQuery, tree: FilterTree) => void;
  /** Saved stacks for @name resolution */
  savedStacks?: Map<string, SavedStack>;
  /** Available source types for quick filters */
  availableSources?: string[];
  /** Available tags for filtering */
  availableTags?: string[];
  /** Available content types */
  availableTypes?: string[];
  /** Show visual tree by default */
  showTree?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

type ViewMode = 'text' | 'visual' | 'both';

export function FilterBuilder({
  initialQuery = '',
  initialFilters,
  onFilterChange,
  onSubmit,
  savedStacks,
  availableSources = [],
  availableTags = [],
  availableTypes = [],
  showTree = true,
  compact = false,
  className = '',
}: FilterBuilderProps) {
  // Query state
  const [query, setQuery] = useState(initialQuery);
  const [tree, setTree] = useState<FilterTree>(() => {
    if (initialFilters && initialFilters.length > 0) {
      return catuskotiFiltersToTree(initialFilters);
    }
    return parseQuery(initialQuery, { savedStacks });
  });

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>(showTree ? 'both' : 'text');
  const [isExpanded, setIsExpanded] = useState(false);

  // Track if this is initial mount to avoid calling onFilterChange immediately
  const isInitialMount = useRef(true);
  const lastNotifiedQuery = useRef(initialQuery);

  // Parse query on change
  useEffect(() => {
    const newTree = parseQuery(query, { savedStacks });
    setTree(newTree);
  }, [query, savedStacks]);

  // Compile and notify parent
  const compiled = useMemo(() => compileFilterTree(tree), [tree]);

  // Only notify parent when query actually changes from user input, not on mount
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    // Only notify if query actually changed
    if (query !== lastNotifiedQuery.current) {
      lastNotifiedQuery.current = query;
      onFilterChange(compiled, tree);
    }
  }, [query, compiled, tree, onFilterChange]);

  // Handle query submission
  const handleSubmit = useCallback((submittedTree: FilterTree) => {
    onSubmit?.(compileFilterTree(submittedTree), submittedTree);
  }, [onSubmit]);

  // Handle node removal from tree
  const handleRemoveNode = useCallback((path: number[]) => {
    // Rebuild tree without the node at path
    const removeAtPath = (node: FilterNode, currentPath: number[]): FilterNode | null => {
      if (currentPath.length === 0) {
        return null; // Remove this node
      }

      if (node.type === 'AND' || node.type === 'OR') {
        const group = node as { type: 'AND' | 'OR'; children: FilterNode[]; negated?: boolean };
        const [index, ...rest] = currentPath;
        const newChildren = group.children
          .map((child, i) => i === index ? removeAtPath(child, rest) : child)
          .filter((child): child is FilterNode => child !== null);

        if (newChildren.length === 0) {
          return null;
        }
        if (newChildren.length === 1) {
          return newChildren[0];
        }

        return { ...group, children: newChildren };
      }

      return node;
    };

    if (tree.root) {
      const newRoot = removeAtPath(tree.root, path);
      const newQuery = newRoot ? compiledQueryToString(compileFilterTree({
        ...tree,
        root: newRoot,
      })) : '';

      setQuery(newQuery);
      setTree({
        ...tree,
        root: newRoot,
        originalQuery: newQuery,
      });
    }
  }, [tree]);

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setTree({
      root: null,
      originalQuery: '',
      parseErrors: [],
      parseWarnings: [],
    });
  }, []);

  // Handle filter from dimension carousel
  const handleCarouselFilter = useCallback((queryPart: string) => {
    const newQuery = query ? `${query} & ${queryPart}` : queryPart;
    setQuery(newQuery);
  }, [query]);

  // Filter summary for collapsed view
  const filterSummary = useMemo(() => getFilterSummary(tree.root), [tree.root]);
  const hasFilters = filterSummary.length > 0;

  return (
    <div
      className={`filter-builder ${className} ${compact ? 'filter-builder--compact' : ''} ${isExpanded ? 'filter-builder--expanded' : ''}`}
    >
      {/* Main query bar */}
      <div className="filter-builder__query">
        <QueryBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Search: +source:chatgpt /pattern/ words:>100"
          autoFocus={false}
        />
      </div>

      {/* View mode toggle and controls */}
      <div className="filter-builder__controls">
        <div className="filter-builder__view-toggle" role="tablist">
          <button
            className={`filter-builder__view-btn ${viewMode === 'text' ? 'filter-builder__view-btn--active' : ''}`}
            onClick={() => setViewMode('text')}
            role="tab"
            aria-selected={viewMode === 'text'}
          >
            Text
          </button>
          <button
            className={`filter-builder__view-btn ${viewMode === 'visual' ? 'filter-builder__view-btn--active' : ''}`}
            onClick={() => setViewMode('visual')}
            role="tab"
            aria-selected={viewMode === 'visual'}
          >
            Visual
          </button>
          <button
            className={`filter-builder__view-btn ${viewMode === 'both' ? 'filter-builder__view-btn--active' : ''}`}
            onClick={() => setViewMode('both')}
            role="tab"
            aria-selected={viewMode === 'both'}
          >
            Both
          </button>
        </div>

        {hasFilters && (
          <button
            className="filter-builder__clear-btn"
            onClick={clearAllFilters}
            aria-label="Clear all filters"
          >
            Clear ({filterSummary.length})
          </button>
        )}

        {!compact && (
          <button
            className="filter-builder__expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse filter builder' : 'Expand filter builder'}
          >
            {isExpanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {/* Dimension carousel - scroll label to cycle through filter types */}
      {(viewMode === 'visual' || viewMode === 'both') && (
        <FilterDimensionCarousel
          onApplyFilter={handleCarouselFilter}
          availableSources={availableSources}
          availableTags={availableTags}
          availableTypes={availableTypes}
          compact={compact}
        />
      )}

      {/* Visual tree display */}
      {(viewMode === 'visual' || viewMode === 'both') && (
        <div className="filter-builder__tree">
          <FilterTreeView
            root={tree.root}
            onRemoveNode={handleRemoveNode}
            compact={compact}
          />
        </div>
      )}

      {/* Parse errors */}
      {tree.parseErrors.length > 0 && (
        <div className="filter-builder__errors" role="alert">
          {tree.parseErrors.map((error, i) => (
            <div key={i} className="filter-builder__error">
              <span className="filter-builder__error-icon">⚠</span>
              {error.message}
            </div>
          ))}
        </div>
      )}

      {/* Parse warnings */}
      {tree.parseWarnings.length > 0 && (
        <div className="filter-builder__warnings">
          {tree.parseWarnings.map((warning, i) => (
            <div key={i} className="filter-builder__warning">
              <span className="filter-builder__warning-icon">ℹ</span>
              {warning}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version of FilterBuilder for inline use
 */
export function FilterBuilderCompact(props: Omit<FilterBuilderProps, 'compact' | 'showTree'>) {
  return <FilterBuilder {...props} compact showTree={false} />;
}
