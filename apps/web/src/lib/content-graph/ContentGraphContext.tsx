/**
 * ContentGraphContext - React context for Universal Content Graph
 *
 * Provides access to content graph operations throughout the app.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  ContentNode,
  ContentLink,
  ContentNodeQuery,
  ContentLinkQuery,
  LinkType,
  SourceType,
} from '@humanizer/core';

/**
 * API client for content graph operations
 */
export interface ContentGraphAPI {
  // Node operations
  getNode(id: string): Promise<ContentNode | null>;
  getNodeByUri(uri: string): Promise<ContentNode | null>;
  queryNodes(query: ContentNodeQuery): Promise<ContentNode[]>;
  searchNodes(query: string, limit?: number): Promise<ContentNode[]>;
  createNode(options: CreateNodeOptions): Promise<ContentNode>;
  updateNode(id: string, updates: Partial<ContentNode>): Promise<ContentNode | null>;
  deleteNode(id: string): Promise<boolean>;

  // Link operations
  getLinksFrom(nodeId: string, type?: LinkType): Promise<ContentLink[]>;
  getLinksTo(nodeId: string, type?: LinkType): Promise<ContentLink[]>;
  createLink(options: CreateLinkOptions): Promise<ContentLink>;
  deleteLink(id: string): Promise<boolean>;

  // Graph operations
  getDerivatives(nodeId: string): Promise<ContentNode[]>;
  getLineage(nodeId: string): Promise<ContentNode[]>;
  getRelated(nodeId: string, depth?: number): Promise<ContentNode[]>;

  // Version operations
  getVersionHistory(nodeId: string): Promise<ContentNode[]>;
  revertToVersion(nodeId: string, versionNumber: number): Promise<ContentNode | null>;

  // Stats
  getStats(): Promise<ContentGraphStats>;
}

interface CreateNodeOptions {
  text: string;
  format?: string;
  title?: string;
  author?: string;
  tags?: string[];
  sourceType: SourceType;
  sourceMetadata?: Record<string, unknown>;
}

interface CreateLinkOptions {
  sourceId: string;
  targetId: string;
  type: LinkType;
  strength?: number;
  metadata?: Record<string, unknown>;
}

interface ContentGraphStats {
  nodeCount: number;
  linkCount: number;
  sourceTypeCounts: Record<string, number>;
  linkTypeCounts: Record<string, number>;
}

/**
 * Context state
 */
interface ContentGraphState {
  // Currently selected node
  selectedNode: ContentNode | null;

  // Recently viewed nodes
  recentNodes: ContentNode[];

  // Search results
  searchResults: ContentNode[];
  searchQuery: string;
  isSearching: boolean;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Stats
  stats: ContentGraphStats | null;
}

/**
 * Context value
 */
interface ContentGraphContextValue extends ContentGraphState {
  // API methods
  api: ContentGraphAPI;

  // Actions
  selectNode: (node: ContentNode | null) => void;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  refreshStats: () => Promise<void>;
}

const ContentGraphContext = createContext<ContentGraphContextValue | null>(null);

/**
 * Default API implementation using fetch to local server
 */
function createContentGraphAPI(baseUrl: string = '/api/content-graph'): ContentGraphAPI {
  const fetchJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${url}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  };

  return {
    // Node operations
    async getNode(id) {
      return fetchJson(`/nodes/${id}`);
    },

    async getNodeByUri(uri) {
      return fetchJson(`/nodes/by-uri?uri=${encodeURIComponent(uri)}`);
    },

    async queryNodes(query) {
      return fetchJson('/nodes/query', {
        method: 'POST',
        body: JSON.stringify(query),
      });
    },

    async searchNodes(query, limit = 50) {
      return fetchJson(`/nodes/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    },

    async createNode(options) {
      return fetchJson('/nodes', {
        method: 'POST',
        body: JSON.stringify(options),
      });
    },

    async updateNode(id, updates) {
      return fetchJson(`/nodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },

    async deleteNode(id) {
      const result = await fetchJson<{ success: boolean }>(`/nodes/${id}`, {
        method: 'DELETE',
      });
      return result.success;
    },

    // Link operations
    async getLinksFrom(nodeId, type) {
      const typeParam = type ? `&type=${type}` : '';
      return fetchJson(`/links?from=${nodeId}${typeParam}`);
    },

    async getLinksTo(nodeId, type) {
      const typeParam = type ? `&type=${type}` : '';
      return fetchJson(`/links?to=${nodeId}${typeParam}`);
    },

    async createLink(options) {
      return fetchJson('/links', {
        method: 'POST',
        body: JSON.stringify(options),
      });
    },

    async deleteLink(id) {
      const result = await fetchJson<{ success: boolean }>(`/links/${id}`, {
        method: 'DELETE',
      });
      return result.success;
    },

    // Graph operations
    async getDerivatives(nodeId) {
      return fetchJson(`/graph/derivatives/${nodeId}`);
    },

    async getLineage(nodeId) {
      return fetchJson(`/graph/lineage/${nodeId}`);
    },

    async getRelated(nodeId, depth = 2) {
      return fetchJson(`/graph/related/${nodeId}?depth=${depth}`);
    },

    // Version operations
    async getVersionHistory(nodeId) {
      return fetchJson(`/versions/${nodeId}`);
    },

    async revertToVersion(nodeId, versionNumber) {
      return fetchJson(`/versions/${nodeId}/revert`, {
        method: 'POST',
        body: JSON.stringify({ versionNumber }),
      });
    },

    // Stats
    async getStats() {
      return fetchJson('/stats');
    },
  };
}

/**
 * Provider props
 */
interface ContentGraphProviderProps {
  children: ReactNode;
  api?: ContentGraphAPI;
  baseUrl?: string;
}

/**
 * ContentGraphProvider - Provides content graph context to children
 */
export function ContentGraphProvider({
  children,
  api: externalApi,
  baseUrl,
}: ContentGraphProviderProps) {
  const [state, setState] = useState<ContentGraphState>({
    selectedNode: null,
    recentNodes: [],
    searchResults: [],
    searchQuery: '',
    isSearching: false,
    isLoading: false,
    error: null,
    stats: null,
  });

  // Create or use provided API
  const api = useMemo(
    () => externalApi || createContentGraphAPI(baseUrl),
    [externalApi, baseUrl]
  );

  // Select a node
  const selectNode = useCallback((node: ContentNode | null) => {
    setState(prev => {
      // Add to recent nodes if selecting a new node
      const recentNodes = node && !prev.recentNodes.some(n => n.id === node.id)
        ? [node, ...prev.recentNodes.slice(0, 9)]
        : prev.recentNodes;

      return {
        ...prev,
        selectedNode: node,
        recentNodes,
      };
    });
  }, []);

  // Search for nodes
  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setState(prev => ({
        ...prev,
        searchResults: [],
        searchQuery: '',
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      searchQuery: query,
      isSearching: true,
      error: null,
    }));

    try {
      const results = await api.searchNodes(query);
      setState(prev => ({
        ...prev,
        searchResults: results,
        isSearching: false,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        isSearching: false,
        error: error instanceof Error ? error.message : 'Search failed',
      }));
    }
  }, [api]);

  // Clear search
  const clearSearch = useCallback(() => {
    setState(prev => ({
      ...prev,
      searchResults: [],
      searchQuery: '',
    }));
  }, []);

  // Refresh stats
  const refreshStats = useCallback(async () => {
    try {
      const stats = await api.getStats();
      setState(prev => ({ ...prev, stats }));
    } catch (error) {
      console.error('Failed to refresh stats:', error);
    }
  }, [api]);

  const value: ContentGraphContextValue = useMemo(
    () => ({
      ...state,
      api,
      selectNode,
      search,
      clearSearch,
      refreshStats,
    }),
    [state, api, selectNode, search, clearSearch, refreshStats]
  );

  return (
    <ContentGraphContext.Provider value={value}>
      {children}
    </ContentGraphContext.Provider>
  );
}

/**
 * Hook to use content graph context
 */
export function useContentGraph(): ContentGraphContextValue {
  const context = useContext(ContentGraphContext);
  if (!context) {
    throw new Error('useContentGraph must be used within a ContentGraphProvider');
  }
  return context;
}

/**
 * Hook to use just the API
 */
export function useContentGraphAPI(): ContentGraphAPI {
  const { api } = useContentGraph();
  return api;
}
