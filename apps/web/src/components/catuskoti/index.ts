/**
 * Catuskoti Filter System
 *
 * Four-state filter controls based on Buddhist tetralemma.
 * Includes advanced query language with TECO-inspired syntax.
 */

// Core types
export * from './types';

// Chip components
export { CatuskotiChip } from './CatuskotiChip';
export { CatuskotiFilterBar, CatuskotiActiveStrip } from './CatuskotiFilterBar';
export { CatuskotiFilterProvider, useCatuskotiFilters } from './CatuskotiFilterContext';

// Advanced query components
export { QueryBar } from './QueryBar';
export { FilterTreeView, getFilterSummary } from './FilterTreeView';
export { FilterBuilder, FilterBuilderCompact } from './FilterBuilder';

// Refinement history
export { RefinementBreadcrumbs, RefinementBreadcrumbsInline, formatStepTime } from './RefinementBreadcrumbs';
export { useRefinementHistory, updateRootCount } from './useRefinementHistory';

// Saved stacks
export { SavedStacksPicker, SavedStacksInline } from './SavedStacksPicker';

// Dimension carousel
export { FilterDimensionCarousel } from './FilterDimensionCarousel';
export type { FilterDimension } from './FilterDimensionCarousel';
