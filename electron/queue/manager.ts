/**
 * QueueManager - Main process queue management
 *
 * Handles batch job processing with:
 * - Priority-based scheduling
 * - Concurrency control
 * - Progress tracking
 * - Persistence across restarts
 * - Event emission for renderer updates
 * - Multi-provider vision analysis (Ollama, OpenAI, Anthropic, Cloudflare)
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import type Store from 'electron-store';
import type {
  QueueJob,
  QueueJobSpec,
  QueueJobStatus,
  QueueProgress,
  QueueFileResult,
  QueueState,
  QueueEvent,
  QueueEventHandler,
  CreateJobResult,
  JobQueryOptions,
  ImageAnalysisResult,
  PdfExtractionResult,
  AudioTranscriptionResult,
  HumanizationResult,
} from './types';
import { extractPdf } from './handlers/pdf';
import { transcribeAudio } from './handlers/audio';
import { humanizeText } from './handlers/humanize';
import {
  VisionProviderFactory,
  initVisionProviders,
  type VisionProvider,
  type VisionProviderConfig,
  type VisionProviderType,
} from '../vision';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_PER_FILE = 60000; // 60s
const DEFAULT_MAX_RETRIES = 2;
const STORE_KEY = 'queue:jobs';
const ARCHIVE_API = 'http://localhost:3002';

// ═══════════════════════════════════════════════════════════════════
// QUEUE MANAGER OPTIONS
// ═══════════════════════════════════════════════════════════════════

export interface QueueManagerOptions {
  store?: Store;
  maxConcurrency?: number;

  // Vision provider configuration
  visionProviders?: Partial<Record<VisionProviderType, VisionProviderConfig>>;

  // Legacy options (still supported for backwards compatibility)
  visionEndpoint?: string;
  visionModel?: string;
}

// ═══════════════════════════════════════════════════════════════════
// QUEUE MANAGER
// ═══════════════════════════════════════════════════════════════════

export class QueueManager {
  private jobs: Map<string, QueueJob> = new Map();
  private eventHandlers: Set<QueueEventHandler> = new Set();
  private isPaused = false;
  private activeWorkers = 0;
  private maxConcurrency = DEFAULT_CONCURRENCY;
  private store: Store | null = null;
  private processingPromises: Map<string, Promise<void>> = new Map();

  // Vision providers
  private visionFactory: VisionProviderFactory;
  private defaultVisionModel = 'llava:13b';

  constructor(options?: QueueManagerOptions) {
    this.store = options?.store || null;
    this.maxConcurrency = options?.maxConcurrency || DEFAULT_CONCURRENCY;

    // Initialize vision providers
    const providerConfigs: Partial<Record<VisionProviderType, VisionProviderConfig>> = {
      // Default Ollama configuration
      ollama: {
        type: 'ollama',
        endpoint: options?.visionEndpoint || 'http://localhost:11434',
        model: options?.visionModel || this.defaultVisionModel,
      },
      // Merge any custom provider configs
      ...options?.visionProviders,
    };

    this.visionFactory = initVisionProviders(providerConfigs);

    // Override default model if specified
    if (options?.visionModel) {
      this.defaultVisionModel = options.visionModel;
    }

    // Restore persisted jobs on startup
    this.restoreJobs();
  }

  /**
   * Configure a vision provider at runtime
   */
  configureVisionProvider(config: VisionProviderConfig): void {
    this.visionFactory.configure(config);
  }

  /**
   * Get available vision providers
   */
  async getAvailableVisionProviders(): Promise<VisionProviderType[]> {
    return this.visionFactory.listAvailableProviders();
  }

  // ═══════════════════════════════════════════════════════════════════
  // JOB LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a new job and add to queue
   */
  async createJob(spec: QueueJobSpec): Promise<CreateJobResult> {
    try {
      const jobId = randomUUID();
      const totalBytes = spec.files.reduce((sum, f) => sum + (f.size || 0), 0);

      const job: QueueJob = {
        id: jobId,
        spec: {
          ...spec,
          priority: spec.priority ?? 50,
          timeoutPerFile: spec.timeoutPerFile ?? DEFAULT_TIMEOUT_PER_FILE,
          maxRetries: spec.maxRetries ?? DEFAULT_MAX_RETRIES,
          concurrency: spec.concurrency ?? DEFAULT_CONCURRENCY,
        },
        status: 'pending',
        progress: {
          jobId,
          processed: 0,
          total: spec.files.length,
          percentComplete: 0,
          elapsedMs: 0,
          estimatedRemainingMs: 0,
          bytesProcessed: 0,
          totalBytes,
          successCount: 0,
          errorCount: 0,
        },
        createdAt: Date.now(),
        results: [],
      };

      this.jobs.set(jobId, job);
      this.persistJobs();
      this.emit({ type: 'job:created', jobId, job, timestamp: Date.now() });

      // Start processing if not paused
      this.processQueue();

      return { success: true, jobId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create job',
      };
    }
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): QueueJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * List jobs with optional filtering
   */
  listJobs(options?: JobQueryOptions): QueueJob[] {
    let jobs = Array.from(this.jobs.values());

    // Filter by status
    if (options?.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      jobs = jobs.filter(j => statuses.includes(j.status));
    }

    // Filter by type
    if (options?.type) {
      jobs = jobs.filter(j => j.spec.type === options.type);
    }

    // Sort
    const sortBy = options?.sortBy || 'createdAt';
    const sortOrder = options?.sortOrder || 'desc';
    jobs.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortBy) {
        case 'priority':
          aVal = a.spec.priority || 50;
          bVal = b.spec.priority || 50;
          break;
        case 'status':
          aVal = this.statusOrder(a.status);
          bVal = this.statusOrder(b.status);
          break;
        default:
          aVal = a.createdAt;
          bVal = b.createdAt;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    return jobs.slice(offset, offset + limit);
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'pending' || job.status === 'processing' || job.status === 'paused') {
      job.status = 'cancelled';
      job.completedAt = Date.now();
      this.persistJobs();
      this.emit({ type: 'job:cancelled', jobId, job, timestamp: Date.now() });
      return true;
    }
    return false;
  }

  /**
   * Delete a completed/failed/cancelled job
   */
  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      this.jobs.delete(jobId);
      this.persistJobs();
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUEUE CONTROL
  // ═══════════════════════════════════════════════════════════════════

  pauseQueue(): void {
    this.isPaused = true;
    this.emit({ type: 'queue:paused', timestamp: Date.now() });
  }

  resumeQueue(): void {
    this.isPaused = false;
    this.emit({ type: 'queue:resumed', timestamp: Date.now() });
    this.processQueue();
  }

  getState(): QueueState {
    const jobs = Array.from(this.jobs.values());
    return {
      isPaused: this.isPaused,
      pendingCount: jobs.filter(j => j.status === 'pending').length,
      processingCount: jobs.filter(j => j.status === 'processing').length,
      totalJobs: jobs.length,
      activeConcurrency: this.activeWorkers,
      maxConcurrency: this.maxConcurrency,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════════

  onEvent(handler: QueueEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: QueueEvent): void {
    this.eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        console.error('[QueueManager] Event handler error:', err);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROCESSING
  // ═══════════════════════════════════════════════════════════════════

  private async processQueue(): Promise<void> {
    if (this.isPaused) return;

    // Find pending jobs sorted by priority
    const pendingJobs = this.listJobs({
      status: 'pending',
      sortBy: 'priority',
      sortOrder: 'desc',
    });

    // Start processing up to max concurrency
    for (const job of pendingJobs) {
      if (this.activeWorkers >= this.maxConcurrency) break;
      if (this.processingPromises.has(job.id)) continue;

      const promise = this.processJob(job);
      this.processingPromises.set(job.id, promise);
      promise.finally(() => this.processingPromises.delete(job.id));
    }
  }

  private async processJob(job: QueueJob): Promise<void> {
    this.activeWorkers++;
    job.status = 'processing';
    job.startedAt = Date.now();
    this.persistJobs();
    this.emit({ type: 'job:started', jobId: job.id, job, timestamp: Date.now() });

    const startTime = Date.now();
    const concurrency = job.spec.concurrency || DEFAULT_CONCURRENCY;

    try {
      // Process files with controlled concurrency
      const results = await this.processFilesWithConcurrency(
        job,
        concurrency,
        (progress) => {
          job.progress = {
            ...job.progress,
            ...progress,
            elapsedMs: Date.now() - startTime,
          };
          this.emit({ type: 'job:progress', jobId: job.id, progress: job.progress, timestamp: Date.now() });
        }
      );

      job.results = results;
      job.status = job.progress.errorCount === job.progress.total ? 'failed' : 'completed';
      job.completedAt = Date.now();
      job.progress.elapsedMs = job.completedAt - startTime;

      // Sync successful results to archive server for searchability
      if (job.spec.type === 'image-analysis') {
        await this.syncResultsToArchive(results);
      }

      this.persistJobs();
      this.emit({
        type: job.status === 'completed' ? 'job:completed' : 'job:failed',
        jobId: job.id,
        job,
        timestamp: Date.now(),
      });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = Date.now();
      this.persistJobs();
      this.emit({ type: 'job:failed', jobId: job.id, job, timestamp: Date.now() });
    } finally {
      this.activeWorkers--;
      // Continue processing queue
      this.processQueue();
    }
  }

  private async processFilesWithConcurrency(
    job: QueueJob,
    concurrency: number,
    onProgress: (progress: Partial<QueueProgress>) => void
  ): Promise<QueueFileResult[]> {
    const results: QueueFileResult[] = [];
    const files = [...job.spec.files];
    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    let bytesProcessed = 0;

    const processNext = async (): Promise<void> => {
      while (files.length > 0 && job.status === 'processing') {
        const file = files.shift();
        if (!file) break;

        const result = await this.processFile(job, file);
        results.push(result);

        processed++;
        bytesProcessed += file.size || 0;
        if (result.success) successCount++;
        else errorCount++;

        const avgTimePerFile = (Date.now() - (job.startedAt || Date.now())) / processed;
        const remaining = job.spec.files.length - processed;

        onProgress({
          processed,
          total: job.spec.files.length,
          percentComplete: Math.round((processed / job.spec.files.length) * 100),
          currentFile: file.path,
          bytesProcessed,
          totalBytes: job.progress.totalBytes,
          successCount,
          errorCount,
          estimatedRemainingMs: Math.round(avgTimePerFile * remaining),
        });
      }
    };

    // Start concurrent workers
    const workers = Array(Math.min(concurrency, files.length))
      .fill(null)
      .map(() => processNext());

    await Promise.all(workers);
    return results;
  }

  private async processFile(job: QueueJob, file: { path: string; size: number; id?: string }): Promise<QueueFileResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = job.spec.maxRetries || DEFAULT_MAX_RETRIES;

    while (retryCount <= maxRetries) {
      try {
        let data: unknown;

        switch (job.spec.type) {
          case 'image-analysis':
            data = await this.analyzeImage(file.path, job.spec.options);
            break;
          case 'image-embedding':
            data = await this.generateEmbedding(file.path);
            break;
          case 'extract':
            data = await extractPdf(file.path, job.spec.options);
            break;
          case 'transform':
            data = await humanizeText(file.path, {
              intensity: (job.spec.options?.intensity as 'light' | 'moderate' | 'aggressive') || 'moderate',
              model: job.spec.options?.model as string | undefined,
              voiceSamples: job.spec.options?.voiceSamples as string[] | undefined,
            });
            break;
          case 'summarize':
            // Audio transcription (repurposing summarize for now, could add dedicated type)
            data = await transcribeAudio(file.path, {
              model: job.spec.options?.model as string | undefined,
              language: job.spec.options?.language as string | undefined,
            });
            break;
          default:
            throw new Error(`Unsupported job type: ${job.spec.type}`);
        }

        return {
          filePath: file.path,
          fileId: file.id,
          success: true,
          data,
          processingTimeMs: Date.now() - startTime,
          retryCount,
        };
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          return {
            filePath: file.path,
            fileId: file.id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            processingTimeMs: Date.now() - startTime,
            retryCount: retryCount - 1,
          };
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // Should never reach here
    return {
      filePath: file.path,
      fileId: file.id,
      success: false,
      error: 'Max retries exceeded',
      processingTimeMs: Date.now() - startTime,
      retryCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // IMAGE PROCESSING (Multi-Provider Vision)
  // ═══════════════════════════════════════════════════════════════════

  private async analyzeImage(filePath: string, options?: Record<string, unknown>): Promise<ImageAnalysisResult> {
    // Get the requested model and provider
    const model = (options?.model as string) || this.defaultVisionModel;
    const providerType = (options?.provider as VisionProviderType) || this.detectProviderFromModel(model);

    // Get the provider
    let provider = this.visionFactory.get(providerType);

    // Fallback to best available if requested provider not available
    if (!provider) {
      provider = await this.visionFactory.getBestProvider();
    }

    if (!provider) {
      throw new Error('No vision provider available. Ensure Ollama is running or configure cloud providers.');
    }

    // Read image
    const imageBuffer = await fs.promises.readFile(filePath);

    // Analyze using provider
    const result = await provider.analyze(
      {
        imageBuffer,
        temperature: (options?.temperature as number) || 0.3,
      },
      model,
    );

    // Cast scene to the expected union type
    const validScenes = ['indoor', 'outdoor', 'studio', 'nature', 'urban', 'abstract', 'unknown'] as const;
    type SceneType = typeof validScenes[number];
    const scene: SceneType = validScenes.includes(result.scene as SceneType)
      ? (result.scene as SceneType)
      : 'unknown';

    return {
      description: result.description,
      categories: result.categories,
      objects: result.objects,
      scene,
      mood: result.mood,
      confidence: result.confidence,
      model: result.model,
    };
  }

  /**
   * Detect provider type from model ID
   */
  private detectProviderFromModel(model: string): VisionProviderType {
    if (model.startsWith('@cf/')) {
      return 'cloudflare';
    }
    if (model.startsWith('gpt-')) {
      return 'openai';
    }
    if (model.startsWith('claude-')) {
      return 'anthropic';
    }
    // Default to Ollama for local models
    return 'ollama';
  }

  private async generateEmbedding(filePath: string): Promise<{ embedding: number[]; model: string }> {
    // For embeddings, we'd use CLIP or similar
    // This is a placeholder - actual implementation would use a proper embedding model
    throw new Error('Embedding generation not yet implemented');
  }

  /**
   * Sync successful analysis results to archive server for searchability
   */
  private async syncResultsToArchive(results: QueueFileResult[]): Promise<void> {
    const successfulResults = results.filter(r => r.success && r.data);
    if (successfulResults.length === 0) return;

    try {
      const response = await fetch(`${ARCHIVE_API}/api/gallery/analysis/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          results: successfulResults.map(r => ({
            filePath: r.filePath,
            fileId: r.fileId,
            data: r.data,
          })),
        }),
      });

      if (!response.ok) {
        console.error('[QueueManager] Failed to sync results to archive:', response.status);
      } else {
        const data = await response.json();
        console.log(`[QueueManager] Synced ${data.added} new, ${data.updated} updated analyses to archive`);
      }
    } catch (error) {
      // Non-fatal - archive server might not be running
      console.warn('[QueueManager] Could not sync to archive server:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════

  private persistJobs(): void {
    if (!this.store) return;

    const serialized = Array.from(this.jobs.entries()).map(([id, job]) => ({
      id,
      job: {
        ...job,
        // Don't persist large result data
        results: job.results.map(r => ({
          ...r,
          data: r.success ? { persisted: true } : undefined,
        })),
      },
    }));

    this.store.set(STORE_KEY, serialized);
  }

  private restoreJobs(): void {
    if (!this.store) return;

    try {
      const serialized = this.store.get(STORE_KEY) as Array<{ id: string; job: QueueJob }> | undefined;
      if (!serialized) return;

      for (const { id, job } of serialized) {
        // Reset processing jobs to pending on restart
        if (job.status === 'processing') {
          job.status = 'pending';
        }
        this.jobs.set(id, job);
      }

      console.log(`[QueueManager] Restored ${this.jobs.size} jobs from storage`);
    } catch (err) {
      console.error('[QueueManager] Failed to restore jobs:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private statusOrder(status: QueueJobStatus): number {
    const order: Record<QueueJobStatus, number> = {
      processing: 0,
      pending: 1,
      paused: 2,
      completed: 3,
      failed: 4,
      cancelled: 5,
    };
    return order[status] ?? 99;
  }
}

// Singleton instance
let queueManager: QueueManager | null = null;

export function getQueueManager(options?: ConstructorParameters<typeof QueueManager>[0]): QueueManager {
  if (!queueManager) {
    queueManager = new QueueManager(options);
  }
  return queueManager;
}

export function initQueueManager(options: ConstructorParameters<typeof QueueManager>[0]): QueueManager {
  queueManager = new QueueManager(options);
  return queueManager;
}
