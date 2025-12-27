/**
 * useQueue - React hook for queue operations
 *
 * Provides access to the batch processing queue in Electron.
 * Falls back gracefully in browser mode.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════
// TYPES (matching preload.ts)
// ═══════════════════════════════════════════════════════════════════

export type QueueJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type QueueJobType = 'image-analysis' | 'image-embedding' | 'summarize' | 'extract' | 'transform' | 'index' | 'batch-read';

export interface QueueFileItem {
  path: string;
  size: number;
  id?: string;
  source?: 'local' | 'r2' | 'gdrive' | 'url';
}

export interface QueueJobSpec {
  type: QueueJobType;
  priority?: number;
  files: QueueFileItem[];
  options?: Record<string, unknown>;
  timeoutPerFile?: number;
  maxRetries?: number;
  concurrency?: number;
}

export interface QueueProgress {
  jobId: string;
  processed: number;
  total: number;
  percentComplete: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  currentFile?: string;
  bytesProcessed: number;
  totalBytes: number;
  successCount: number;
  errorCount: number;
}

export interface QueueJob {
  id: string;
  spec: QueueJobSpec;
  status: QueueJobStatus;
  progress: QueueProgress;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  results: Array<{
    filePath: string;
    success: boolean;
    data?: unknown;
    error?: string;
    processingTimeMs: number;
  }>;
  error?: string;
}

export interface QueueState {
  isPaused: boolean;
  pendingCount: number;
  processingCount: number;
  totalJobs: number;
  activeConcurrency: number;
  maxConcurrency: number;
}

export interface QueueEvent {
  type: string;
  jobId?: string;
  job?: QueueJob;
  progress?: QueueProgress;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════
// ELECTRON API TYPE
// ═══════════════════════════════════════════════════════════════════

interface QueueAPI {
  createJob: (spec: QueueJobSpec) => Promise<{ success: boolean; jobId?: string; error?: string }>;
  getJob: (jobId: string) => Promise<QueueJob | null>;
  listJobs: (options?: { status?: QueueJobStatus | QueueJobStatus[]; type?: QueueJobType; limit?: number }) => Promise<QueueJob[]>;
  cancelJob: (jobId: string) => Promise<boolean>;
  deleteJob: (jobId: string) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  getState: () => Promise<QueueState>;
  onEvent: (callback: (event: QueueEvent) => void) => () => void;
}

interface ElectronWindow extends Window {
  electronAPI?: {
    queue: QueueAPI;
  };
  isElectron?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export interface UseQueueResult {
  /** Whether running in Electron with queue support */
  isAvailable: boolean;

  /** Current queue state */
  state: QueueState | null;

  /** Active jobs being tracked */
  activeJobs: QueueJob[];

  /** Create a new batch job */
  createJob: (spec: QueueJobSpec) => Promise<{ success: boolean; jobId?: string; error?: string }>;

  /** Get a specific job */
  getJob: (jobId: string) => Promise<QueueJob | null>;

  /** List jobs with optional filtering */
  listJobs: (options?: { status?: QueueJobStatus | QueueJobStatus[]; type?: QueueJobType; limit?: number }) => Promise<QueueJob[]>;

  /** Cancel a job */
  cancelJob: (jobId: string) => Promise<boolean>;

  /** Delete a completed/failed job */
  deleteJob: (jobId: string) => Promise<boolean>;

  /** Pause the queue */
  pauseQueue: () => Promise<boolean>;

  /** Resume the queue */
  resumeQueue: () => Promise<boolean>;

  /** Refresh state and jobs */
  refresh: () => Promise<void>;

  /** Subscribe to events for a specific job */
  subscribeToJob: (jobId: string, callback: (event: QueueEvent) => void) => () => void;
}

export function useQueue(): UseQueueResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [state, setState] = useState<QueueState | null>(null);
  const [activeJobs, setActiveJobs] = useState<QueueJob[]>([]);

  // Track job-specific subscribers
  const jobSubscribers = useRef<Map<string, Set<(event: QueueEvent) => void>>>(new Map());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Get queue API
  const getQueueAPI = useCallback((): QueueAPI | null => {
    const win = window as ElectronWindow;
    if (win.isElectron && win.electronAPI?.queue) {
      return win.electronAPI.queue;
    }
    return null;
  }, []);

  // Initialize
  useEffect(() => {
    const api = getQueueAPI();
    if (api) {
      setIsAvailable(true);

      // Subscribe to queue events
      unsubscribeRef.current = api.onEvent((event) => {
        // Update state on queue-level events
        if (event.type === 'queue:paused' || event.type === 'queue:resumed') {
          api.getState().then(setState);
        }

        // Update active jobs on job events
        if (event.job) {
          setActiveJobs(prev => {
            const idx = prev.findIndex(j => j.id === event.job!.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = event.job!;
              return updated;
            }
            // Add new job if processing
            if (event.job!.status === 'processing' || event.job!.status === 'pending') {
              return [...prev, event.job!];
            }
            return prev;
          });
        }

        // Notify job-specific subscribers
        if (event.jobId) {
          const subscribers = jobSubscribers.current.get(event.jobId);
          if (subscribers) {
            subscribers.forEach(cb => cb(event));
          }
        }

        // Remove completed/failed/cancelled jobs from active list after a delay
        if (event.job && ['completed', 'failed', 'cancelled'].includes(event.job.status)) {
          setTimeout(() => {
            setActiveJobs(prev => prev.filter(j => j.id !== event.job!.id));
          }, 5000);
        }
      });

      // Initial state fetch
      api.getState().then(setState);
      api.listJobs({ status: ['pending', 'processing'] }).then(setActiveJobs);

      return () => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
        }
      };
    }
  }, [getQueueAPI]);

  // Create job
  const createJob = useCallback(async (spec: QueueJobSpec) => {
    const api = getQueueAPI();
    if (!api) {
      return { success: false, error: 'Queue not available (not in Electron)' };
    }
    return api.createJob(spec);
  }, [getQueueAPI]);

  // Get job
  const getJob = useCallback(async (jobId: string) => {
    const api = getQueueAPI();
    if (!api) return null;
    return api.getJob(jobId);
  }, [getQueueAPI]);

  // List jobs
  const listJobs = useCallback(async (options?: { status?: QueueJobStatus | QueueJobStatus[]; type?: QueueJobType; limit?: number }) => {
    const api = getQueueAPI();
    if (!api) return [];
    return api.listJobs(options);
  }, [getQueueAPI]);

  // Cancel job
  const cancelJob = useCallback(async (jobId: string) => {
    const api = getQueueAPI();
    if (!api) return false;
    return api.cancelJob(jobId);
  }, [getQueueAPI]);

  // Delete job
  const deleteJob = useCallback(async (jobId: string) => {
    const api = getQueueAPI();
    if (!api) return false;
    return api.deleteJob(jobId);
  }, [getQueueAPI]);

  // Pause queue
  const pauseQueue = useCallback(async () => {
    const api = getQueueAPI();
    if (!api) return false;
    const result = await api.pause();
    if (result) {
      setState(prev => prev ? { ...prev, isPaused: true } : null);
    }
    return result;
  }, [getQueueAPI]);

  // Resume queue
  const resumeQueue = useCallback(async () => {
    const api = getQueueAPI();
    if (!api) return false;
    const result = await api.resume();
    if (result) {
      setState(prev => prev ? { ...prev, isPaused: false } : null);
    }
    return result;
  }, [getQueueAPI]);

  // Refresh
  const refresh = useCallback(async () => {
    const api = getQueueAPI();
    if (!api) return;
    const [newState, jobs] = await Promise.all([
      api.getState(),
      api.listJobs({ status: ['pending', 'processing'] }),
    ]);
    setState(newState);
    setActiveJobs(jobs);
  }, [getQueueAPI]);

  // Subscribe to job
  const subscribeToJob = useCallback((jobId: string, callback: (event: QueueEvent) => void) => {
    if (!jobSubscribers.current.has(jobId)) {
      jobSubscribers.current.set(jobId, new Set());
    }
    jobSubscribers.current.get(jobId)!.add(callback);

    return () => {
      const subscribers = jobSubscribers.current.get(jobId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          jobSubscribers.current.delete(jobId);
        }
      }
    };
  }, []);

  return {
    isAvailable,
    state,
    activeJobs,
    createJob,
    getJob,
    listJobs,
    cancelJob,
    deleteJob,
    pauseQueue,
    resumeQueue,
    refresh,
    subscribeToJob,
  };
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY: Wait for job completion
// ═══════════════════════════════════════════════════════════════════

export async function waitForJobCompletion(
  getJob: (jobId: string) => Promise<QueueJob | null>,
  jobId: string,
  options?: {
    pollInterval?: number;
    timeout?: number;
    onProgress?: (progress: QueueProgress) => void;
  }
): Promise<QueueJob> {
  const { pollInterval = 1000, timeout = 300000, onProgress } = options || {};
  const startTime = Date.now();

  while (true) {
    const job = await getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (onProgress) {
      onProgress(job.progress);
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(`Timeout waiting for job ${jobId}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
