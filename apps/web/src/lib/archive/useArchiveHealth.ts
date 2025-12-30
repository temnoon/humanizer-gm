/**
 * useArchiveHealth - Check archive readiness and trigger setup
 *
 * Provides:
 * - Health status of the archive (embeddings, Ollama, etc.)
 * - Ability to trigger embedding builds
 * - Polling for indexing progress
 */

import { useState, useEffect, useCallback } from 'react';
import { getArchiveServerUrl } from '../platform';

export interface ArchiveHealthStats {
  conversations: number;
  messages: number;
  chunks: number;
  clusters: number;
  anchors: number;
}

export interface ArchiveHealthServices {
  ollama: boolean;
  modelLoaded: boolean;
  indexing: boolean;
}

export interface ArchiveHealthAction {
  action: string;
  endpoint: string;
  method: string;
}

export interface IndexingProgress {
  status: 'idle' | 'indexing' | 'complete' | 'error';
  phase: string;
  current: number;
  total: number;
  progress: number;
  currentItem?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ArchiveHealth {
  ready: boolean;
  archivePath: string;
  stats: ArchiveHealthStats;
  services: ArchiveHealthServices;
  issues: string[];
  actions: ArchiveHealthAction[];
  indexingProgress: IndexingProgress | null;
}

export interface UseArchiveHealthReturn {
  health: ArchiveHealth | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  buildEmbeddings: (options?: { includeParagraphs?: boolean }) => Promise<boolean>;
  isBuilding: boolean;
  buildProgress: IndexingProgress | null;
}

export function useArchiveHealth(pollInterval: number = 0): UseArchiveHealthReturn {
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<IndexingProgress | null>(null);

  const refresh = useCallback(async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/embeddings/health`);

      if (!response.ok) {
        throw new Error('Failed to fetch archive health');
      }

      const data = await response.json();
      setHealth(data);

      // Update building state from health
      if (data.indexingProgress?.status === 'indexing') {
        setIsBuilding(true);
        setBuildProgress(data.indexingProgress);
      } else if (isBuilding && data.indexingProgress?.status !== 'indexing') {
        // Build just completed
        setIsBuilding(false);
        setBuildProgress(data.indexingProgress);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  }, [isBuilding]);

  const buildEmbeddings = useCallback(async (options?: { includeParagraphs?: boolean }) => {
    try {
      setIsBuilding(true);
      setBuildProgress({
        status: 'indexing',
        phase: 'starting',
        current: 0,
        total: 0,
        progress: 0,
      });

      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/embeddings/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Build failed to start');
      }

      // Start polling for progress
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed');
      setIsBuilding(false);
      setBuildProgress(null);
      return false;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Polling when building or when pollInterval is set
  useEffect(() => {
    if (!pollInterval && !isBuilding) return;

    const interval = setInterval(refresh, isBuilding ? 2000 : pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, isBuilding, refresh]);

  return {
    health,
    loading,
    error,
    refresh,
    buildEmbeddings,
    isBuilding,
    buildProgress,
  };
}

/**
 * Check if embeddings need to be built
 */
export function needsEmbeddings(health: ArchiveHealth | null): boolean {
  if (!health) return false;
  return health.stats.conversations > 0 && health.stats.messages === 0;
}

/**
 * Check if Ollama is available
 */
export function isOllamaAvailable(health: ArchiveHealth | null): boolean {
  return health?.services.ollama ?? false;
}
