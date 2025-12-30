/**
 * Import Routes - Universal Import Pipeline API
 *
 * Routes:
 * - POST /api/import/upload - Upload file for import (returns preview)
 * - POST /api/import/:id/start - Start import processing
 * - GET /api/import/:id/status - Get import job status
 * - GET /api/import/jobs - List recent import jobs
 * - DELETE /api/import/:id - Cancel/delete import job
 * - POST /api/import/detect - Detect file type without importing
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';

import { getArchiveRoot } from '../config';
import { getEmbeddingDatabase } from '../services/registry';
import {
  createImportPipeline,
  createOpenAIParser,
  createGeminiParser,
  createDocumentParser,
  createPdfParser,
  createFileTypeDetector,
} from '../services/import/index';

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(getArchiveRoot(), '_uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err as Error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max
  },
});

// Active pipelines for progress tracking
const activePipelines = new Map<string, {
  status: string;
  progress: number;
  currentPhase?: string;
  currentItem?: string;
}>();

export function createImportRouter(): Router {
  const router = Router();

  /**
   * POST /api/import/detect
   * Detect file type without importing
   */
  router.post('/detect', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const detector = createFileTypeDetector();
      const result = await detector.detect(req.file.path);

      // Clean up uploaded file after detection
      try {
        await fs.unlink(req.file.path);
      } catch {
        // Ignore cleanup errors
      }

      res.json({
        filename: req.file.originalname,
        size: req.file.size,
        ...result,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/upload
   * Upload file and get preview info
   */
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const detector = createFileTypeDetector();
      const detection = await detector.detect(req.file.path);

      // Create a pending import job
      const db = getEmbeddingDatabase();
      const jobId = uuidv4();

      db.createImportJob({
        id: jobId,
        sourceType: detection.sourceType,
        sourcePath: req.file.path,
        sourceName: req.file.originalname,
      });

      res.json({
        jobId,
        filename: req.file.originalname,
        size: req.file.size,
        path: req.file.path,
        detection,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/:id/start
   * Start processing an uploaded file
   */
  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { skipMedia, skipEmbeddings, dryRun } = req.body;

      const db = getEmbeddingDatabase();
      const job = db.getImportJob(id);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      if (job.status !== 'pending') {
        res.status(400).json({ error: `Job already ${job.status}` });
        return;
      }

      // Create pipeline with parsers
      const archiveRoot = getArchiveRoot();
      const pipeline = createImportPipeline(archiveRoot, db);

      // Register parsers
      pipeline.registerParser(createOpenAIParser({ verbose: true }));
      pipeline.registerParser(createGeminiParser({ verbose: true }));
      pipeline.registerParser(createDocumentParser({ verbose: true }));
      pipeline.registerParser(createPdfParser({ verbose: true }));

      // Initialize progress tracking
      activePipelines.set(id, {
        status: 'starting',
        progress: 0,
      });

      // Start import (async - don't await)
      pipeline.import(
        job.sourcePath!,
        {
          sourceType: job.sourceType as import('../services/embeddings/types').ImportSourceType,
          sourceName: job.sourceName ?? undefined,
          skipMedia,
          skipEmbeddings,
          dryRun,
        },
        (progress) => {
          activePipelines.set(id, {
            status: 'processing',
            progress: progress.progress,
            currentPhase: progress.phase,
            currentItem: progress.currentItem,
          });
        }
      ).then((result) => {
        activePipelines.set(id, {
          status: result.status,
          progress: 1.0,
        });

        // Clean up uploaded file on success
        if (result.status === 'completed') {
          fs.unlink(job.sourcePath!).catch(() => {});
        }
      }).catch((err) => {
        activePipelines.set(id, {
          status: 'failed',
          progress: 0,
          currentPhase: 'error',
          currentItem: (err as Error).message,
        });
      });

      res.json({
        jobId: id,
        status: 'started',
        message: 'Import started - poll /api/import/:id/status for progress',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/import/:id/status
   * Get import job status
   */
  router.get('/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Check active pipeline first (for real-time progress)
      const activeProgress = activePipelines.get(id);
      if (activeProgress) {
        res.json({
          jobId: id,
          ...activeProgress,
        });
        return;
      }

      // Fall back to database
      const db = getEmbeddingDatabase();
      const job = db.getImportJob(id);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      res.json({
        jobId: id,
        status: job.status,
        progress: job.progress,
        currentPhase: job.currentPhase,
        currentItem: job.currentItem,
        unitsTotal: job.unitsTotal,
        unitsProcessed: job.unitsProcessed,
        mediaTotal: job.mediaTotal,
        mediaProcessed: job.mediaProcessed,
        linksCreated: job.linksCreated,
        errorsCount: job.errorsCount,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/import/jobs
   * List recent import jobs
   */
  router.get('/jobs', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;

      const db = getEmbeddingDatabase();
      const jobs = db.getRecentImportJobs(limit);

      res.json({
        jobs: jobs.map(job => ({
          id: job.id,
          status: job.status,
          sourceType: job.sourceType,
          sourceName: job.sourceName,
          progress: job.progress,
          unitsProcessed: job.unitsProcessed,
          mediaProcessed: job.mediaProcessed,
          errorsCount: job.errorsCount,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        })),
        total: jobs.length,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * DELETE /api/import/:id
   * Cancel or delete an import job
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Remove from active pipelines
      activePipelines.delete(id);

      const db = getEmbeddingDatabase();
      const job = db.getImportJob(id);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      // Clean up uploaded file if it exists
      if (job.sourcePath) {
        try {
          await fs.unlink(job.sourcePath);
        } catch {
          // Ignore - file may already be deleted
        }
      }

      // Mark as failed/cancelled
      db.updateImportJob(id, {
        status: 'failed',
        completedAt: Date.now(),
        errorLog: ['Cancelled by user'],
      });

      res.json({
        success: true,
        jobId: id,
        message: 'Import job cancelled',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/file
   * Direct file import (for local files)
   */
  router.post('/file', async (req: Request, res: Response) => {
    try {
      const { filePath, sourceName, skipMedia, skipEmbeddings } = req.body;

      if (!filePath) {
        res.status(400).json({ error: 'filePath required' });
        return;
      }

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Detect file type
      const detector = createFileTypeDetector();
      const detection = await detector.detect(filePath);

      // Create import job
      const db = getEmbeddingDatabase();
      const jobId = uuidv4();

      db.createImportJob({
        id: jobId,
        sourceType: detection.sourceType,
        sourcePath: filePath,
        sourceName: sourceName ?? path.basename(filePath),
      });

      // Create pipeline
      const archiveRoot = getArchiveRoot();
      const pipeline = createImportPipeline(archiveRoot, db);
      pipeline.registerParser(createOpenAIParser({ verbose: true }));
      pipeline.registerParser(createGeminiParser({ verbose: true }));
      pipeline.registerParser(createDocumentParser({ verbose: true }));
      pipeline.registerParser(createPdfParser({ verbose: true }));

      // Initialize progress tracking
      activePipelines.set(jobId, {
        status: 'starting',
        progress: 0,
      });

      // Start import
      pipeline.import(
        filePath,
        {
          sourceType: detection.sourceType,
          sourceName: sourceName ?? path.basename(filePath),
          skipMedia,
          skipEmbeddings,
        },
        (progress) => {
          activePipelines.set(jobId, {
            status: 'processing',
            progress: progress.progress,
            currentPhase: progress.phase,
            currentItem: progress.currentItem,
          });
        }
      ).then((result) => {
        activePipelines.set(jobId, {
          status: result.status,
          progress: 1.0,
        });
      }).catch((err) => {
        activePipelines.set(jobId, {
          status: 'failed',
          progress: 0,
          currentPhase: 'error',
          currentItem: (err as Error).message,
        });
      });

      res.json({
        jobId,
        status: 'started',
        detection,
        message: 'Import started - poll /api/import/:id/status for progress',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // =========================================================================
  // Legacy Routes (for existing frontend compatibility)
  // =========================================================================

  /**
   * POST /api/import/archive/upload
   * Legacy upload endpoint for frontend
   */
  router.post('/archive/upload', upload.single('archive'), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const detector = createFileTypeDetector();
      const detection = await detector.detect(req.file.path);

      const db = getEmbeddingDatabase();
      const jobId = uuidv4();

      db.createImportJob({
        id: jobId,
        sourceType: detection.sourceType,
        sourcePath: req.file.path,
        sourceName: req.file.originalname,
      });

      res.json({
        jobId,
        filename: req.file.originalname,
        size: req.file.size,
        detection,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/archive/parse
   * Legacy parse/start endpoint for frontend
   */
  router.post('/archive/parse', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.body;
      if (!jobId) {
        res.status(400).json({ error: 'jobId required' });
        return;
      }

      const db = getEmbeddingDatabase();
      const job = db.getImportJob(jobId);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      if (job.status !== 'pending') {
        res.status(400).json({ error: `Job already ${job.status}` });
        return;
      }

      // Create pipeline
      const archiveRoot = getArchiveRoot();
      const pipeline = createImportPipeline(archiveRoot, db);
      pipeline.registerParser(createOpenAIParser({ verbose: true }));
      pipeline.registerParser(createGeminiParser({ verbose: true }));
      pipeline.registerParser(createDocumentParser({ verbose: true }));
      pipeline.registerParser(createPdfParser({ verbose: true }));

      activePipelines.set(jobId, { status: 'starting', progress: 0 });

      // Start import async
      pipeline.import(
        job.sourcePath!,
        {
          sourceType: job.sourceType as import('../services/embeddings/types').ImportSourceType,
          sourceName: job.sourceName ?? undefined,
          skipEmbeddings: true,
        },
        (progress) => {
          activePipelines.set(jobId, {
            status: 'processing',
            progress: progress.progress,
            currentPhase: progress.phase,
            currentItem: progress.currentItem,
          });
        }
      ).then((result) => {
        activePipelines.set(jobId, { status: result.status, progress: 1.0 });
        if (result.status === 'completed') {
          fs.unlink(job.sourcePath!).catch(() => {});
        }
      }).catch((err) => {
        activePipelines.set(jobId, {
          status: 'failed',
          progress: 0,
          currentPhase: 'error',
          currentItem: (err as Error).message,
        });
      });

      res.json({ success: true, jobId, status: 'parsing' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/import/archive/status/:id
   * Legacy status endpoint for frontend
   */
  router.get('/archive/status/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const activeProgress = activePipelines.get(id);
      if (activeProgress) {
        res.json({
          jobId: id,
          status: activeProgress.status,
          progress: activeProgress.progress,
          phase: activeProgress.currentPhase,
          currentItem: activeProgress.currentItem,
        });
        return;
      }

      const db = getEmbeddingDatabase();
      const job = db.getImportJob(id);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      res.json({
        jobId: id,
        status: job.status,
        progress: job.progress,
        phase: job.currentPhase,
        currentItem: job.currentItem,
        unitsProcessed: job.unitsProcessed,
        mediaProcessed: job.mediaProcessed,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/archive/apply/:id
   * Apply import results (for staged imports)
   */
  router.post('/archive/apply/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const db = getEmbeddingDatabase();
      const job = db.getImportJob(id);

      if (!job) {
        res.status(404).json({ error: 'Import job not found' });
        return;
      }

      // For now, imports are auto-applied, so just return success
      res.json({ success: true, jobId: id, message: 'Import applied' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/archive/folder
   * Import from local folder
   */
  router.post('/archive/folder', async (req: Request, res: Response) => {
    try {
      const { folderPath } = req.body;
      if (!folderPath) {
        res.status(400).json({ error: 'folderPath required' });
        return;
      }

      // Check if folder exists
      try {
        await fs.access(folderPath);
      } catch {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }

      const db = getEmbeddingDatabase();
      const jobId = uuidv4();

      db.createImportJob({
        id: jobId,
        sourceType: 'folder',
        sourcePath: folderPath,
        sourceName: path.basename(folderPath),
      });

      res.json({
        jobId,
        message: 'Folder import job created - use /archive/parse to start',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // =========================================================================
  // Explorer Routes (AUI Format Discovery)
  // =========================================================================

  /**
   * POST /api/import/discover
   * Start a format discovery session for unknown files/folders
   */
  router.post('/discover', async (req: Request, res: Response) => {
    try {
      const { path: sourcePath } = req.body;
      if (!sourcePath) {
        res.status(400).json({ error: 'path required' });
        return;
      }

      // Check if path exists
      try {
        await fs.access(sourcePath);
      } catch {
        res.status(404).json({ error: 'Path not found' });
        return;
      }

      // Import explorer agent dynamically to avoid circular deps
      const { getExplorerAgent } = await import('../../agents/houses/explorer.js');
      const explorer = getExplorerAgent();

      // Initialize if needed
      await explorer.initialize();

      // Start discovery session via handleMessage, extract data from response
      const response = await explorer.handleMessage({
        id: `msg-${Date.now()}`,
        type: 'start-discovery',
        from: 'api',
        to: 'explorer',
        payload: { path: sourcePath },
        timestamp: Date.now(),
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Discovery failed');
      }

      const session = response.data as import('../../agents/houses/explorer.js').DiscoverySession;

      res.json({
        sessionId: session.id,
        status: session.status,
        hypotheses: session.hypotheses.map(h => ({
          id: h.id,
          formatName: h.formatName,
          confidence: h.confidence,
          parser: h.parserRecommendation?.useExisting,
          evidence: h.evidence.length,
        })),
        query: session.queries[session.queries.length - 1],
        structure: session.structure ? {
          name: session.structure.name,
          fileCount: session.structure.fileCount,
          folderCount: session.structure.folderCount,
          topFolders: session.structure.children
            ?.filter(c => c.type === 'folder')
            .slice(0, 5)
            .map(c => c.name),
        } : null,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /api/import/discover/:sessionId
   * Get discovery session status
   */
  router.get('/discover/:sessionId', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const { getExplorerAgent } = await import('../../agents/houses/explorer.js');
      const explorer = getExplorerAgent();

      const response = await explorer.handleMessage({
        id: `msg-${Date.now()}`,
        type: 'get-session',
        from: 'api',
        to: 'explorer',
        payload: { sessionId },
        timestamp: Date.now(),
      });

      if (!response.success) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const session = response.data as import('../../agents/houses/explorer.js').DiscoverySession | undefined;

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({
        sessionId: session.id,
        status: session.status,
        hypotheses: session.hypotheses.map(h => ({
          id: h.id,
          formatName: h.formatName,
          confidence: h.confidence,
          parser: h.parserRecommendation?.useExisting,
        })),
        queries: session.queries,
        result: session.result,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/discover/:sessionId/respond
   * Respond to a user query in a discovery session
   */
  router.post('/discover/:sessionId/respond', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { queryId, response: userResponse } = req.body;

      if (!userResponse) {
        res.status(400).json({ error: 'response required' });
        return;
      }

      const { getExplorerAgent } = await import('../../agents/houses/explorer.js');
      const explorer = getExplorerAgent();

      const response = await explorer.handleMessage({
        id: `msg-${Date.now()}`,
        type: 'user-response',
        from: 'api',
        to: 'explorer',
        payload: {
          sessionId,
          queryId: queryId || `query-${Date.now()}`,
          response: userResponse,
        },
        timestamp: Date.now(),
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Response failed');
      }

      const session = response.data as import('../../agents/houses/explorer.js').DiscoverySession;

      res.json({
        sessionId: session.id,
        status: session.status,
        hypotheses: session.hypotheses.map(h => ({
          id: h.id,
          formatName: h.formatName,
          confidence: h.confidence,
          parser: h.parserRecommendation?.useExisting,
        })),
        queries: session.queries,
        result: session.result,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/discover/:sessionId/confirm
   * Confirm format and finalize discovery
   */
  router.post('/discover/:sessionId/confirm', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { formatName, parser, config } = req.body;

      if (!formatName || !parser) {
        res.status(400).json({ error: 'formatName and parser required' });
        return;
      }

      const { getExplorerAgent } = await import('../../agents/houses/explorer.js');
      const explorer = getExplorerAgent();

      const response = await explorer.handleMessage({
        id: `msg-${Date.now()}`,
        type: 'confirm-format',
        from: 'api',
        to: 'explorer',
        payload: { sessionId, formatName, parser, config },
        timestamp: Date.now(),
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Confirmation failed');
      }

      const session = response.data as import('../../agents/houses/explorer.js').DiscoverySession;

      res.json({
        sessionId: session.id,
        status: session.status,
        result: session.result,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/import/explore
   * Quick explore without starting a full session
   */
  router.post('/explore', async (req: Request, res: Response) => {
    try {
      const { path: sourcePath, maxDepth = 3 } = req.body;
      if (!sourcePath) {
        res.status(400).json({ error: 'path required' });
        return;
      }

      try {
        await fs.access(sourcePath);
      } catch {
        res.status(404).json({ error: 'Path not found' });
        return;
      }

      const { getExplorerAgent } = await import('../../agents/houses/explorer.js');
      const explorer = getExplorerAgent();
      await explorer.initialize();

      const response = await explorer.handleMessage({
        id: `msg-${Date.now()}`,
        type: 'explore-structure',
        from: 'api',
        to: 'explorer',
        payload: { path: sourcePath, maxDepth, maxFiles: 100 },
        timestamp: Date.now(),
      });

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Exploration failed');
      }

      const structure = response.data as import('../../agents/houses/explorer.js').StructureInsight;

      res.json({
        structure: {
          name: structure.name,
          path: structure.path,
          type: structure.type,
          fileCount: structure.fileCount,
          folderCount: structure.folderCount,
          patterns: structure.patterns,
          children: structure.children?.map(c => ({
            name: c.name,
            type: c.type,
            extension: c.extension,
            fileCount: c.fileCount,
            folderCount: c.folderCount,
          })),
        },
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
