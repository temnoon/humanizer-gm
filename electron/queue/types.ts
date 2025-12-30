/**
 * Queue System Types
 *
 * Shared types for the batch processing queue system.
 * Used by both main process (QueueManager) and renderer (useQueue hook).
 */

// ═══════════════════════════════════════════════════════════════════
// JOB STATUS & TYPES
// ═══════════════════════════════════════════════════════════════════

export type QueueJobStatus =
  | 'pending'      // Waiting in queue
  | 'processing'   // Currently being processed
  | 'completed'    // Successfully finished
  | 'failed'       // Failed with errors
  | 'cancelled'    // User cancelled
  | 'paused';      // Paused mid-processing

export type QueueJobType =
  | 'image-analysis'   // Vision model analysis (description, categories)
  | 'image-embedding'  // Generate CLIP embeddings
  | 'summarize'        // Text summarization
  | 'extract'          // Content extraction
  | 'transform'        // Text transformation
  | 'index'            // File indexing
  | 'batch-read';      // Batch file reading

// ═══════════════════════════════════════════════════════════════════
// JOB SPECIFICATION
// ═══════════════════════════════════════════════════════════════════

export interface QueueFileItem {
  /** Absolute file path or URL */
  path: string;
  /** File size in bytes (0 if unknown) */
  size: number;
  /** Optional file ID for tracking */
  id?: string;
  /** Source type (local, r2, gdrive) */
  source?: 'local' | 'r2' | 'gdrive' | 'url';
}

export interface QueueJobSpec {
  /** Type of processing to perform */
  type: QueueJobType;
  /** Priority (0-100, higher = sooner) */
  priority?: number;
  /** Files to process */
  files: QueueFileItem[];
  /** Job-specific options */
  options?: {
    // Image analysis options
    model?: string;
    includeEmbeddings?: boolean;

    // Summarization options
    length?: 'brief' | 'detailed';

    // Generic options
    [key: string]: unknown;
  };
  /** Timeout per file in ms (default: 60000) */
  timeoutPerFile?: number;
  /** Max retries per file (default: 2) */
  maxRetries?: number;
  /** Concurrency limit (default: 2) */
  concurrency?: number;
  /** Optional callback URL for completion notification */
  webhookUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ═══════════════════════════════════════════════════════════════════

export interface QueueProgress {
  /** Job ID */
  jobId: string;
  /** Number of files processed */
  processed: number;
  /** Total files in job */
  total: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
  /** Elapsed time in ms */
  elapsedMs: number;
  /** Estimated remaining time in ms */
  estimatedRemainingMs: number;
  /** Currently processing file path */
  currentFile?: string;
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total bytes to process */
  totalBytes: number;
  /** Number of successful files */
  successCount: number;
  /** Number of failed files */
  errorCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// FILE RESULT
// ═══════════════════════════════════════════════════════════════════

export interface QueueFileResult {
  /** Original file path */
  filePath: string;
  /** File ID if provided */
  fileId?: string;
  /** Whether processing succeeded */
  success: boolean;
  /** Result data (type depends on job type) */
  data?: ImageAnalysisResult | SummarizationResult | PdfExtractionResult | AudioTranscriptionResult | HumanizationResult | unknown;
  /** Error message if failed */
  error?: string;
  /** Processing time for this file */
  processingTimeMs: number;
  /** Number of retry attempts */
  retryCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// JOB OBJECT
// ═══════════════════════════════════════════════════════════════════

export interface QueueJob {
  /** Unique job ID (UUID) */
  id: string;
  /** Job specification */
  spec: QueueJobSpec;
  /** Current status */
  status: QueueJobStatus;
  /** Progress information */
  progress: QueueProgress;
  /** When job was created */
  createdAt: number;
  /** When processing started */
  startedAt?: number;
  /** When job completed/failed/cancelled */
  completedAt?: number;
  /** Individual file results */
  results: QueueFileResult[];
  /** Error message if job-level failure */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// RESULT TYPES (Job-specific)
// ═══════════════════════════════════════════════════════════════════

export interface ImageAnalysisResult {
  /** Natural language description */
  description: string;
  /** Category tags */
  categories: string[];
  /** Detected objects */
  objects: string[];
  /** Scene type */
  scene: 'indoor' | 'outdoor' | 'studio' | 'nature' | 'urban' | 'abstract' | 'unknown';
  /** Emotional mood */
  mood?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Model used */
  model: string;
  /** Optional CLIP embedding */
  embedding?: number[];
}

export interface SummarizationResult {
  /** Summary text */
  summary: string;
  /** Key points extracted */
  keyPoints?: string[];
  /** Word count of original */
  originalWordCount: number;
  /** Word count of summary */
  summaryWordCount: number;
}

export interface PdfExtractionResult {
  /** Extracted text content */
  text: string;
  /** Number of pages */
  pageCount: number;
  /** PDF metadata */
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    creationDate?: string;
  };
  /** Word count */
  wordCount: number;
}

export interface AudioTranscriptionResult {
  /** Transcribed text */
  text: string;
  /** Segments with timestamps */
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  /** Detected language */
  language?: string;
  /** Audio duration in seconds */
  duration?: number;
  /** Model used */
  model: string;
}

export interface HumanizationResult {
  /** Original text */
  original: string;
  /** Humanized text */
  humanized: string;
  /** Model used */
  model: string;
  /** Processing time in ms */
  processingTimeMs?: number;
  /** Improvement metrics */
  improvement?: {
    baseline?: number;
    final?: number;
    delta?: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// QUEUE STATE
// ═══════════════════════════════════════════════════════════════════

export interface QueueState {
  /** Whether queue is paused */
  isPaused: boolean;
  /** Number of pending jobs */
  pendingCount: number;
  /** Number of processing jobs */
  processingCount: number;
  /** Total jobs (all statuses) */
  totalJobs: number;
  /** Current concurrency in use */
  activeConcurrency: number;
  /** Max allowed concurrency */
  maxConcurrency: number;
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════

export type QueueEventType =
  | 'job:created'
  | 'job:started'
  | 'job:progress'
  | 'job:completed'
  | 'job:failed'
  | 'job:cancelled'
  | 'queue:paused'
  | 'queue:resumed';

export interface QueueEvent {
  type: QueueEventType;
  jobId?: string;
  job?: QueueJob;
  progress?: QueueProgress;
  timestamp: number;
}

export type QueueEventHandler = (event: QueueEvent) => void;

// ═══════════════════════════════════════════════════════════════════
// API TYPES (for IPC)
// ═══════════════════════════════════════════════════════════════════

export interface CreateJobResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface JobQueryOptions {
  status?: QueueJobStatus | QueueJobStatus[];
  type?: QueueJobType;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'priority' | 'status';
  sortOrder?: 'asc' | 'desc';
}
