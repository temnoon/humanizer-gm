/**
 * Archive Server - Embedded Express Server for Electron
 *
 * This server runs in-process with Electron's main process,
 * providing local API access for archive browsing, embeddings,
 * and all archive-related functionality.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server } from 'http';
import { initConfig, getConfig, getArchiveRoot, setArchivePath, PATHS } from './config';

// Route modules
import { createArchivesRouter } from './routes/archives';
import { createConversationsRouter } from './routes/conversations';
import { createEmbeddingsRouter } from './routes/embeddings';
import { createFacebookRouter } from './routes/facebook';
import { createContentRouter } from './routes/content';
import { createGalleryRouter } from './routes/gallery';
import { createImportRouter } from './routes/import';
import { createLinksRouter } from './routes/links';
import { createDraftRouter } from './routes/draft';

// Service registry for cleanup on archive switch
import { resetServices, getEmbeddingDatabase } from './services/registry';

// ═══════════════════════════════════════════════════════════════════
// SERVER INSTANCE
// ═══════════════════════════════════════════════════════════════════

let app: Express | null = null;
let server: Server | null = null;

/**
 * Create and configure the Express application
 */
function createApp(): Express {
  const app = express();

  // CORS - Allow Electron and development access
  app.use(cors({
    origin: (origin, callback) => {
      // Allow no origin (Electron, curl, etc.)
      if (!origin) return callback(null, true);

      // Allow localhost for development
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }

      // Allow production domains
      if (
        origin === 'https://studio.humanizer.com' ||
        origin === 'https://humanizer.com' ||
        origin.endsWith('.pages.dev')
      ) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));

  // Request logging (development)
  if (process.env.NODE_ENV !== 'production') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[archive-server] ${req.method} ${req.path}`);
      next();
    });
  }

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      archive: getArchiveRoot(),
      timestamp: Date.now(),
    });
  });

  // Mount route modules
  app.use('/api/archives', createArchivesRouter());
  app.use('/api/conversations', createConversationsRouter());
  app.use('/api/embeddings', createEmbeddingsRouter());
  app.use('/api/facebook', createFacebookRouter());
  app.use('/api/content', createContentRouter());
  app.use('/api/gallery', createGalleryRouter());
  app.use('/api/import', createImportRouter());
  app.use('/api/links', createLinksRouter());
  app.use('/api/draft', createDraftRouter());

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[archive-server] Error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ═══════════════════════════════════════════════════════════════════
// SERVER LIFECYCLE
// ═══════════════════════════════════════════════════════════════════

/**
 * Start the archive server
 * @param port - Port to listen on (default from config)
 * @returns Promise resolving to the server URL
 */
export async function startServer(port?: number): Promise<string> {
  if (server) {
    throw new Error('Server already running');
  }

  // Initialize configuration
  const config = await initConfig();
  const serverPort = port ?? config.port;

  // Create and start server
  app = createApp();
  server = app.listen(serverPort);

  return new Promise((resolve, reject) => {
    server!.on('listening', () => {
      const url = `http://localhost:${serverPort}`;
      console.log(`[archive-server] Started on ${url}`);
      console.log(`[archive-server] Archive: ${config.archiveConfig.archivePath}`);

      // Initialize EmbeddingDatabase eagerly to ensure Xanadu IPC handlers work
      // This runs migrations and makes areServicesInitialized() return true
      try {
        getEmbeddingDatabase();
        console.log(`[archive-server] EmbeddingDatabase initialized`);
      } catch (err) {
        console.error(`[archive-server] Failed to initialize EmbeddingDatabase:`, err);
      }

      resolve(url);
    });

    server!.on('error', (err) => {
      console.error('[archive-server] Failed to start:', err);
      server = null;
      app = null;
      reject(err);
    });
  });
}

/**
 * Stop the archive server
 */
export async function stopServer(): Promise<void> {
  if (!server) {
    return;
  }

  return new Promise((resolve, reject) => {
    server!.close((err) => {
      if (err) {
        reject(err);
      } else {
        console.log('[archive-server] Stopped');
        server = null;
        app = null;
        resolve();
      }
    });
  });
}

/**
 * Check if server is running
 */
export function isServerRunning(): boolean {
  return server !== null;
}

/**
 * Get the Express app instance (for testing or middleware injection)
 */
export function getApp(): Express | null {
  return app;
}

// Re-export config utilities
export { getConfig, getArchiveRoot, setArchivePath, PATHS };
