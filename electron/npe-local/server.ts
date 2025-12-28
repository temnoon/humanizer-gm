/**
 * NPE-Local Server
 *
 * Embedded Express server for local NPE API operations.
 * Provides AI detection, humanization, and LLM chat endpoints.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server } from 'http';

import { createDetectionRouter } from './routes/detection';
import { createTransformationsRouter } from './routes/transformations';
import { createBooksRouter } from './routes/books';
import { createSessionsRouter } from './routes/sessions';
import { createQuantumRouter } from './routes/quantum';
import { createConfigRouter } from './routes/config';
import { setModelConfig, setAPIKeys, isOllamaAvailable, type APIKeyConfig } from './services/llm';
import { initDatabase } from './services/database';

let app: Express | null = null;
let server: Server | null = null;
let currentPort: number | null = null;

export interface NpeLocalConfig {
  port?: number;
  ollamaUrl?: string;
  apiKeys?: APIKeyConfig;
}

const DEFAULT_PORT = 3003;

/**
 * Create the Express app
 */
function createApp(): Express {
  const expressApp = express();

  // Middleware
  expressApp.use(cors());
  expressApp.use(express.json({ limit: '10mb' }));

  // Health check
  expressApp.get('/health', async (_req: Request, res: Response) => {
    const ollamaAvailable = await isOllamaAvailable();

    res.json({
      status: 'ok',
      service: 'npe-local',
      version: '1.0.0',
      ollama: {
        available: ollamaAvailable,
        url: 'http://localhost:11434',
      },
    });
  });

  // Initialize database
  initDatabase();

  // Routes
  expressApp.use('/ai-detection', createDetectionRouter());
  expressApp.use('/transformations', createTransformationsRouter());
  expressApp.use('/books', createBooksRouter());
  expressApp.use('/sessions', createSessionsRouter());
  expressApp.use('/quantum-analysis', createQuantumRouter());
  expressApp.use('/config', createConfigRouter());

  // Error handler
  expressApp.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[NPE-Local] Error:', err);
    res.status(500).json({
      error: err.message || 'Internal server error',
    });
  });

  // 404 handler
  expressApp.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Endpoint not found',
    });
  });

  return expressApp;
}

/**
 * Start the NPE-Local server
 */
export async function startServer(config: NpeLocalConfig = {}): Promise<string> {
  if (server) {
    throw new Error('Server is already running');
  }

  const port = config.port || DEFAULT_PORT;

  // Configure LLM providers
  setModelConfig({
    ollamaUrl: config.ollamaUrl || 'http://localhost:11434',
    preferLocal: true,
  });

  if (config.apiKeys) {
    setAPIKeys(config.apiKeys);
  }

  app = createApp();

  return new Promise((resolve, reject) => {
    server = app!.listen(port, () => {
      currentPort = port;
      console.log(`[NPE-Local] Server running on http://localhost:${port}`);
      resolve(`http://localhost:${port}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Stop the NPE-Local server
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
        server = null;
        app = null;
        currentPort = null;
        console.log('[NPE-Local] Server stopped');
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
 * Get current port
 */
export function getPort(): number | null {
  return currentPort;
}

/**
 * Get Express app (for testing)
 */
export function getApp(): Express | null {
  return app;
}
