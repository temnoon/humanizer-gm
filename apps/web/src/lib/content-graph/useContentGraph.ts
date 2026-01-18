/**
 * useContentGraph - React hooks for Universal Content Graph
 *
 * Provides convenient hooks for common content graph operations.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useContentGraphAPI } from './ContentGraphContext.js';
import type {
  ContentNode,
  ContentLink,
  ContentNodeQuery,
  LinkType,
  SourceType,
} from '@humanizer/core';

/**
 * Hook to fetch and manage a single content node
 */
export function useContentNode(nodeId: string | null) {
  const api = useContentGraphAPI();
  const [node, setNode] = useState<ContentNode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNode = useCallback(async () => {
    if (!nodeId) {
      setNode(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.getNode(nodeId);
      setNode(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch node');
      setNode(null);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId]);

  useEffect(() => {
    fetchNode();
  }, [fetchNode]);

  return {
    node,
    isLoading,
    error,
    refetch: fetchNode,
  };
}

/**
 * Hook to query content nodes with filters
 */
export function useContentNodes(query: ContentNodeQuery) {
  const api = useContentGraphAPI();
  const [nodes, setNodes] = useState<ContentNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize query for dependency comparison
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const fetchNodes = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const results = await api.queryNodes(query);
      setNodes(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch nodes');
      setNodes([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, queryKey]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  return {
    nodes,
    isLoading,
    error,
    refetch: fetchNodes,
  };
}

/**
 * Hook to search content nodes
 */
export function useContentSearch(initialQuery: string = '') {
  const api = useContentGraphAPI();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ContentNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (searchQuery: string) => {
    setQuery(searchQuery);

    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await api.searchNodes(searchQuery);
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [api]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  return {
    query,
    results,
    isSearching,
    error,
    search,
    clear,
  };
}

/**
 * Hook to get links for a node
 */
export function useContentLinks(
  nodeId: string | null,
  direction: 'from' | 'to' | 'both' = 'both',
  type?: LinkType
) {
  const api = useContentGraphAPI();
  const [links, setLinks] = useState<ContentLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!nodeId) {
      setLinks([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let results: ContentLink[] = [];

      if (direction === 'from' || direction === 'both') {
        const fromLinks = await api.getLinksFrom(nodeId, type);
        results = results.concat(fromLinks);
      }

      if (direction === 'to' || direction === 'both') {
        const toLinks = await api.getLinksTo(nodeId, type);
        results = results.concat(toLinks);
      }

      // Deduplicate
      const seen = new Set<string>();
      results = results.filter(link => {
        if (seen.has(link.id)) return false;
        seen.add(link.id);
        return true;
      });

      setLinks(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch links');
      setLinks([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId, direction, type]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  return {
    links,
    isLoading,
    error,
    refetch: fetchLinks,
  };
}

/**
 * Hook to get derivatives of a node (what was derived from it)
 */
export function useDerivatives(nodeId: string | null) {
  const api = useContentGraphAPI();
  const [derivatives, setDerivatives] = useState<ContentNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDerivatives = useCallback(async () => {
    if (!nodeId) {
      setDerivatives([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await api.getDerivatives(nodeId);
      setDerivatives(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch derivatives');
      setDerivatives([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId]);

  useEffect(() => {
    fetchDerivatives();
  }, [fetchDerivatives]);

  return {
    derivatives,
    isLoading,
    error,
    refetch: fetchDerivatives,
  };
}

/**
 * Hook to get lineage of a node (what it was derived from)
 */
export function useLineage(nodeId: string | null) {
  const api = useContentGraphAPI();
  const [lineage, setLineage] = useState<ContentNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLineage = useCallback(async () => {
    if (!nodeId) {
      setLineage([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await api.getLineage(nodeId);
      setLineage(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch lineage');
      setLineage([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId]);

  useEffect(() => {
    fetchLineage();
  }, [fetchLineage]);

  return {
    lineage,
    isLoading,
    error,
    refetch: fetchLineage,
  };
}

/**
 * Hook to get version history of a node
 */
export function useVersionHistory(nodeId: string | null) {
  const api = useContentGraphAPI();
  const [versions, setVersions] = useState<ContentNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!nodeId) {
      setVersions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await api.getVersionHistory(nodeId);
      setVersions(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch version history');
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const revert = useCallback(async (versionNumber: number) => {
    if (!nodeId) return null;

    try {
      const result = await api.revertToVersion(nodeId, versionNumber);
      await fetchVersions(); // Refresh after revert
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revert');
      return null;
    }
  }, [api, nodeId, fetchVersions]);

  return {
    versions,
    isLoading,
    error,
    refetch: fetchVersions,
    revert,
  };
}

/**
 * Hook to get related nodes
 */
export function useRelatedNodes(nodeId: string | null, depth: number = 2) {
  const api = useContentGraphAPI();
  const [related, setRelated] = useState<ContentNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRelated = useCallback(async () => {
    if (!nodeId) {
      setRelated([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const results = await api.getRelated(nodeId, depth);
      setRelated(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch related nodes');
      setRelated([]);
    } finally {
      setIsLoading(false);
    }
  }, [api, nodeId, depth]);

  useEffect(() => {
    fetchRelated();
  }, [fetchRelated]);

  return {
    related,
    isLoading,
    error,
    refetch: fetchRelated,
  };
}

/**
 * Hook to manage node creation
 */
export function useCreateNode() {
  const api = useContentGraphAPI();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createNode = useCallback(async (options: {
    text: string;
    format?: string;
    title?: string;
    author?: string;
    tags?: string[];
    sourceType: SourceType;
    sourceMetadata?: Record<string, unknown>;
  }) => {
    setIsCreating(true);
    setError(null);

    try {
      const node = await api.createNode(options);
      return node;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create node');
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [api]);

  return {
    createNode,
    isCreating,
    error,
  };
}

/**
 * Hook to manage link creation
 */
export function useCreateLink() {
  const api = useContentGraphAPI();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLink = useCallback(async (options: {
    sourceId: string;
    targetId: string;
    type: LinkType;
    strength?: number;
    metadata?: Record<string, unknown>;
  }) => {
    setIsCreating(true);
    setError(null);

    try {
      const link = await api.createLink(options);
      return link;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link');
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [api]);

  return {
    createLink,
    isCreating,
    error,
  };
}

/**
 * Hook to get nodes by source type
 */
export function useNodesBySource(sourceType: SourceType, limit: number = 50) {
  return useContentNodes({
    sourceType,
    limit,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  });
}
