/**
 * GUI Bridge - Connects AUI tool execution to Archive pane display
 *
 * Philosophy: "Show don't tell"
 * - Tools execute and return results
 * - Results are dispatched to the Archive pane
 * - User sees results in context, not buried in chat
 *
 * Event flow:
 * 1. User asks AUI to search
 * 2. Tool executes search_archive
 * 3. dispatchGUIAction sends custom event
 * 4. ExploreView receives event, displays results
 * 5. Chat shows brief confirmation with "How?" link
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type GUIActionType =
  | 'show_search_results'
  | 'filter_conversations'
  | 'highlight_items'
  | 'open_panel'
  | 'navigate_to'
  | 'set_active_tab'
  // Facet/Filter events
  | 'set_available_facets'
  | 'apply_filter'
  | 'clear_filters';

export type GUIActionTarget = 'archive' | 'tools' | 'workspace' | 'explore';

export interface GUIAction {
  type: GUIActionType;
  target: GUIActionTarget;
  data: unknown;
  /** Optional source tool for attribution */
  source?: string;
  /** Timestamp for ordering */
  timestamp?: number;
}

export interface SearchResultsPayload {
  results: Array<{
    id?: string;
    messageId?: string;
    conversationId?: string;
    content?: string;
    similarity?: number;
    role?: string;
    title?: string;
  }>;
  query: string;
  searchType: 'semantic' | 'text' | 'facebook';
  total: number;
}

export interface FilterPayload {
  filter: string;
  value: unknown;
}

export interface NavigatePayload {
  conversationId?: string;
  messageId?: string;
  tab?: string;
}

// Facet types (imported here for convenience, defined in FilterContext)
export interface FacetDefinition {
  field: string;
  label: string;
  type: 'enum' | 'date_range' | 'numeric_range' | 'boolean';
  source: string;
  distinctCount: number;
  topValues?: Array<{ value: string; count: number }>;
  range?: { min: number; max: number };
  coverage: number;
}

export interface SetFacetsPayload {
  facets: FacetDefinition[];
}

export interface ApplyFilterPayload {
  field: string;
  value: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const GUI_ACTION_EVENT = 'aui:gui-action';

// ═══════════════════════════════════════════════════════════════════
// DISPATCH
// ═══════════════════════════════════════════════════════════════════

/**
 * Dispatch a GUI action to listeners (Archive pane, etc.)
 *
 * Example usage:
 * ```ts
 * dispatchGUIAction({
 *   type: 'show_search_results',
 *   target: 'explore',
 *   data: {
 *     results: searchResults,
 *     query: 'Heart Sutra',
 *     searchType: 'semantic',
 *     total: 12
 *   }
 * });
 * ```
 */
export function dispatchGUIAction(action: GUIAction): void {
  const event = new CustomEvent<GUIAction>(GUI_ACTION_EVENT, {
    detail: {
      ...action,
      timestamp: action.timestamp ?? Date.now(),
    },
    bubbles: true,
    cancelable: false,
  });

  window.dispatchEvent(event);

  // Debug logging in development
  if (import.meta.env.DEV) {
    console.log('[GUI Bridge] Dispatched:', action.type, '->', action.target, action.data);
  }
}

/**
 * Dispatch search results to the Explore view
 */
export function dispatchSearchResults(
  payload: SearchResultsPayload,
  source: string = 'search_archive'
): void {
  dispatchGUIAction({
    type: 'show_search_results',
    target: 'explore',
    data: payload,
    source,
  });
}

/**
 * Dispatch panel open request
 */
export function dispatchOpenPanel(
  panel: 'archives' | 'tools',
  tab?: string
): void {
  dispatchGUIAction({
    type: 'open_panel',
    target: panel === 'archives' ? 'archive' : 'tools',
    data: { panel, tab },
  });
}

/**
 * Dispatch navigation to specific content
 */
export function dispatchNavigate(payload: NavigatePayload): void {
  dispatchGUIAction({
    type: 'navigate_to',
    target: 'archive',
    data: payload,
  });
}

/**
 * Dispatch available facets to FilterContext
 */
export function dispatchSetFacets(
  payload: SetFacetsPayload,
  source: string = 'discover_filters'
): void {
  dispatchGUIAction({
    type: 'set_available_facets',
    target: 'explore',
    data: payload,
    source,
  });
}

/**
 * Dispatch a filter application
 */
export function dispatchApplyFilter(
  payload: ApplyFilterPayload,
  source: string = 'aui'
): void {
  dispatchGUIAction({
    type: 'apply_filter',
    target: 'explore',
    data: payload,
    source,
  });
}

/**
 * Dispatch filter clear request
 */
export function dispatchClearFilters(source: string = 'aui'): void {
  dispatchGUIAction({
    type: 'clear_filters',
    target: 'explore',
    data: {},
    source,
  });
}

// ═══════════════════════════════════════════════════════════════════
// LISTENERS
// ═══════════════════════════════════════════════════════════════════

export type GUIActionHandler = (action: GUIAction) => void;

/**
 * Subscribe to GUI actions
 *
 * Example usage:
 * ```ts
 * useEffect(() => {
 *   const unsubscribe = subscribeToGUIActions((action) => {
 *     if (action.type === 'show_search_results' && action.target === 'explore') {
 *       setResults(action.data.results);
 *     }
 *   });
 *   return unsubscribe;
 * }, []);
 * ```
 */
export function subscribeToGUIActions(handler: GUIActionHandler): () => void {
  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<GUIAction>;
    handler(customEvent.detail);
  };

  window.addEventListener(GUI_ACTION_EVENT, listener);

  return () => {
    window.removeEventListener(GUI_ACTION_EVENT, listener);
  };
}

/**
 * Subscribe to specific action types
 */
export function subscribeToActionType(
  type: GUIActionType,
  handler: GUIActionHandler
): () => void {
  return subscribeToGUIActions((action) => {
    if (action.type === type) {
      handler(action);
    }
  });
}

/**
 * Subscribe to actions for a specific target
 */
export function subscribeToTarget(
  target: GUIActionTarget,
  handler: GUIActionHandler
): () => void {
  return subscribeToGUIActions((action) => {
    if (action.target === target) {
      handler(action);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// REACT HOOK
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useCallback, useState } from 'react';

/**
 * React hook to subscribe to GUI actions
 *
 * @param filter - Optional filter function
 * @returns Latest action matching filter
 */
export function useGUIAction(
  filter?: (action: GUIAction) => boolean
): GUIAction | null {
  const [latestAction, setLatestAction] = useState<GUIAction | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToGUIActions((action) => {
      if (!filter || filter(action)) {
        setLatestAction(action);
      }
    });

    return unsubscribe;
  }, [filter]);

  return latestAction;
}

/**
 * React hook to subscribe to search results for Explore view
 */
export function useSearchResultsAction(): {
  results: SearchResultsPayload | null;
  clear: () => void;
} {
  const [results, setResults] = useState<SearchResultsPayload | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToGUIActions((action) => {
      if (action.type === 'show_search_results' && action.target === 'explore') {
        setResults(action.data as SearchResultsPayload);
      }
    });

    return unsubscribe;
  }, []);

  const clear = useCallback(() => {
    setResults(null);
  }, []);

  return { results, clear };
}
