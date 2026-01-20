/**
 * useRefinementHistory - Hook for managing progressive filter refinement
 *
 * Tracks drill-down history with undo/redo support.
 * Each refinement step records the query, tree, and result count.
 */

import { useState, useCallback, useMemo } from 'react';
import type { FilterTree, RefinementStep, RefinementHistory, CompiledQuery } from '../../lib/query';
import { compileFilterTree, hasActiveFilters, compiledQueryToString } from '../../lib/query';

export interface UseRefinementHistoryOptions {
  /** Maximum number of history steps to keep */
  maxSteps?: number;
  /** Initial result count (all items) */
  initialCount?: number;
  /** Callback when history changes */
  onHistoryChange?: (history: RefinementHistory) => void;
}

export interface UseRefinementHistoryReturn {
  /** Current refinement history */
  history: RefinementHistory;
  /** Current step (may be null if at root) */
  currentStep: RefinementStep | null;
  /** Whether we can go back */
  canUndo: boolean;
  /** Whether we can go forward */
  canRedo: boolean;
  /** Push a new refinement step */
  pushRefinement: (tree: FilterTree, resultCount: number, label?: string) => void;
  /** Go back to previous step */
  undo: () => RefinementStep | null;
  /** Go forward to next step */
  redo: () => RefinementStep | null;
  /** Go to a specific step by index */
  goToStep: (index: number) => RefinementStep | null;
  /** Clear all history */
  clearHistory: () => void;
  /** Get the filter tree at a specific step */
  getStepTree: (index: number) => FilterTree | null;
  /** Get all steps for display */
  allSteps: RefinementStep[];
}

/**
 * Generate a unique ID for a refinement step
 */
function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate a label for a refinement step based on the query
 */
function generateStepLabel(tree: FilterTree, resultCount: number): string {
  if (!tree.root) {
    return `All: ${resultCount.toLocaleString()}`;
  }

  const compiled = compileFilterTree(tree);
  const parts: string[] = [];

  // Summarize the most important filters
  if (compiled.sourceTypes?.length) {
    parts.push(`+${compiled.sourceTypes[0]}`);
  }
  if (compiled.excludeSourceTypes?.length) {
    parts.push(`-${compiled.excludeSourceTypes[0]}`);
  }
  if (compiled.searchQuery) {
    const truncated = compiled.searchQuery.length > 12
      ? compiled.searchQuery.slice(0, 12) + '...'
      : compiled.searchQuery;
    parts.push(`"${truncated}"`);
  }
  if (compiled.regexPatterns?.length) {
    parts.push('/regex/');
  }
  if (compiled.minWords !== undefined || compiled.maxWords !== undefined) {
    parts.push('words:...');
  }
  if (compiled.dateRange?.start || compiled.dateRange?.end) {
    parts.push('date:...');
  }

  const label = parts.length > 0 ? parts.join(' ') : 'Filtered';
  return `${label}: ${resultCount.toLocaleString()}`;
}

export function useRefinementHistory(
  options: UseRefinementHistoryOptions = {}
): UseRefinementHistoryReturn {
  const { maxSteps = 20, initialCount = 0, onHistoryChange } = options;

  // History state
  const [history, setHistory] = useState<RefinementHistory>(() => ({
    steps: [
      {
        id: generateStepId(),
        query: '',
        tree: { root: null, originalQuery: '', parseErrors: [], parseWarnings: [] },
        resultCount: initialCount,
        timestamp: Date.now(),
        label: `All: ${initialCount.toLocaleString()}`,
      },
    ],
    currentIndex: 0,
  }));

  // Computed values
  const currentStep = useMemo(
    () => history.steps[history.currentIndex] || null,
    [history]
  );

  const canUndo = useMemo(
    () => history.currentIndex > 0,
    [history.currentIndex]
  );

  const canRedo = useMemo(
    () => history.currentIndex < history.steps.length - 1,
    [history.currentIndex, history.steps.length]
  );

  const allSteps = useMemo(
    () => history.steps.slice(0, history.currentIndex + 1),
    [history.steps, history.currentIndex]
  );

  // Push a new refinement step
  const pushRefinement = useCallback((
    tree: FilterTree,
    resultCount: number,
    label?: string
  ) => {
    setHistory(prev => {
      // Truncate any forward history
      const steps = prev.steps.slice(0, prev.currentIndex + 1);

      // Create new step
      const newStep: RefinementStep = {
        id: generateStepId(),
        query: tree.originalQuery,
        tree,
        resultCount,
        timestamp: Date.now(),
        label: label || generateStepLabel(tree, resultCount),
      };

      // Add new step and trim if necessary
      const newSteps = [...steps, newStep];
      if (newSteps.length > maxSteps) {
        newSteps.shift();
      }

      const newHistory: RefinementHistory = {
        steps: newSteps,
        currentIndex: newSteps.length - 1,
      };

      onHistoryChange?.(newHistory);
      return newHistory;
    });
  }, [maxSteps, onHistoryChange]);

  // Undo - go back one step
  const undo = useCallback((): RefinementStep | null => {
    if (!canUndo) return null;

    let result: RefinementStep | null = null;
    setHistory(prev => {
      const newIndex = prev.currentIndex - 1;
      result = prev.steps[newIndex] || null;
      const newHistory = { ...prev, currentIndex: newIndex };
      onHistoryChange?.(newHistory);
      return newHistory;
    });
    return result;
  }, [canUndo, onHistoryChange]);

  // Redo - go forward one step
  const redo = useCallback((): RefinementStep | null => {
    if (!canRedo) return null;

    let result: RefinementStep | null = null;
    setHistory(prev => {
      const newIndex = prev.currentIndex + 1;
      result = prev.steps[newIndex] || null;
      const newHistory = { ...prev, currentIndex: newIndex };
      onHistoryChange?.(newHistory);
      return newHistory;
    });
    return result;
  }, [canRedo, onHistoryChange]);

  // Go to a specific step
  const goToStep = useCallback((index: number): RefinementStep | null => {
    if (index < 0 || index >= history.steps.length) return null;

    let result: RefinementStep | null = null;
    setHistory(prev => {
      result = prev.steps[index] || null;
      const newHistory = { ...prev, currentIndex: index };
      onHistoryChange?.(newHistory);
      return newHistory;
    });
    return result;
  }, [history.steps.length, onHistoryChange]);

  // Clear all history
  const clearHistory = useCallback(() => {
    const newHistory: RefinementHistory = {
      steps: [
        {
          id: generateStepId(),
          query: '',
          tree: { root: null, originalQuery: '', parseErrors: [], parseWarnings: [] },
          resultCount: initialCount,
          timestamp: Date.now(),
          label: `All: ${initialCount.toLocaleString()}`,
        },
      ],
      currentIndex: 0,
    };
    setHistory(newHistory);
    onHistoryChange?.(newHistory);
  }, [initialCount, onHistoryChange]);

  // Get tree at a specific step
  const getStepTree = useCallback((index: number): FilterTree | null => {
    return history.steps[index]?.tree || null;
  }, [history.steps]);

  return {
    history,
    currentStep,
    canUndo,
    canRedo,
    pushRefinement,
    undo,
    redo,
    goToStep,
    clearHistory,
    getStepTree,
    allSteps,
  };
}

/**
 * Update the root step's result count (used when initial count is loaded)
 */
export function updateRootCount(
  history: RefinementHistory,
  newCount: number
): RefinementHistory {
  if (history.steps.length === 0) return history;

  const rootStep = history.steps[0];
  const updatedRoot: RefinementStep = {
    ...rootStep,
    resultCount: newCount,
    label: `All: ${newCount.toLocaleString()}`,
  };

  return {
    ...history,
    steps: [updatedRoot, ...history.steps.slice(1)],
  };
}
