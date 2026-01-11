/**
 * Queue System Types
 *
 * Types for batch processing job queue
 */

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

export interface QueueAPI {
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
