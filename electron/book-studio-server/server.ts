/**
 * Book Studio Server
 *
 * Embedded Express server for Book Studio API.
 * Provides REST endpoints and WebSocket for real-time events.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initConfig, getConfig } from './config';
import { getDatabase, closeDatabase } from './database';

// Route modules
import { createBooksRouter } from './routes/books';
import { createChaptersRouter } from './routes/chapters';
import { createCardsRouter } from './routes/cards';
import { createClustersRouter } from './routes/clusters';
import { createOutlinesRouter } from './routes/outlines';
import { createEventsRouter } from './routes/events';

// ============================================================================
// Server Instance
// ============================================================================

let app: Express | null = null;
let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;

// WebSocket connections by book ID
const subscriptions = new Map<string, Set<WebSocket>>();

// ============================================================================
// WebSocket Event Broadcasting
// ============================================================================

export interface BookEvent {
  type: string;
  bookId: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
  timestamp: number;
}

/**
 * Broadcast an event to all subscribers of a book
 */
export function broadcastEvent(event: BookEvent): void {
  const subs = subscriptions.get(event.bookId);
  if (!subs || subs.size === 0) return;

  const message = JSON.stringify(event);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

/**
 * Subscribe a WebSocket to a book's events
 */
function subscribeToBook(ws: WebSocket, bookId: string): void {
  if (!subscriptions.has(bookId)) {
    subscriptions.set(bookId, new Set());
  }
  subscriptions.get(bookId)!.add(ws);
  console.log(`[book-studio-ws] Subscribed to book ${bookId}`);
}

/**
 * Unsubscribe a WebSocket from a book's events
 */
function unsubscribeFromBook(ws: WebSocket, bookId: string): void {
  const subs = subscriptions.get(bookId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) {
      subscriptions.delete(bookId);
    }
  }
}

/**
 * Remove a WebSocket from all subscriptions
 */
function removeFromAllSubscriptions(ws: WebSocket): void {
  for (const [bookId, subs] of subscriptions) {
    subs.delete(ws);
    if (subs.size === 0) {
      subscriptions.delete(bookId);
    }
  }
}

// ============================================================================
// Express App Setup
// ============================================================================

function createApp(): Express {
  const expressApp = express();

  // CORS - localhost only for security
  expressApp.use(cors({
    origin: (origin, callback) => {
      // Allow no origin (Electron, curl)
      if (!origin) return callback(null, true);

      // Only allow localhost
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Body parsing
  expressApp.use(express.json({ limit: '10mb' }));

  // Request logging
  if (process.env.NODE_ENV !== 'production') {
    expressApp.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[book-studio-server] ${req.method} ${req.path}`);
      next();
    });
  }

  // Health check
  expressApp.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  expressApp.get('/api/health', (_req: Request, res: Response) => {
    const config = getConfig();
    res.json({
      status: 'ok',
      port: config.port,
      dbPath: config.dbPath,
      wsEnabled: config.wsEnabled,
      timestamp: Date.now(),
    });
  });

  // Mount route modules
  expressApp.use('/api/books', createBooksRouter());
  expressApp.use('/api/chapters', createChaptersRouter());
  expressApp.use('/api/cards', createCardsRouter());
  expressApp.use('/api/clusters', createClustersRouter());
  expressApp.use('/api/outlines', createOutlinesRouter());
  expressApp.use('/api/events', createEventsRouter());

  // Error handler
  expressApp.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[book-studio-server] Error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return expressApp;
}

// ============================================================================
// WebSocket Server Setup
// ============================================================================

function setupWebSocket(server: HttpServer): WebSocketServer {
  const wsServer = new WebSocketServer({ server, path: '/ws' });

  wsServer.on('connection', (ws: WebSocket) => {
    console.log('[book-studio-ws] Client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'subscribe':
            if (message.bookId) {
              subscribeToBook(ws, message.bookId);
              ws.send(JSON.stringify({ type: 'subscribed', bookId: message.bookId }));
            }
            break;

          case 'unsubscribe':
            if (message.bookId) {
              unsubscribeFromBook(ws, message.bookId);
              ws.send(JSON.stringify({ type: 'unsubscribed', bookId: message.bookId }));
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          default:
            console.log('[book-studio-ws] Unknown message type:', message.type);
        }
      } catch (err) {
        console.error('[book-studio-ws] Failed to parse message:', err);
      }
    });

    ws.on('close', () => {
      console.log('[book-studio-ws] Client disconnected');
      removeFromAllSubscriptions(ws);
    });

    ws.on('error', (err: Error) => {
      console.error('[book-studio-ws] WebSocket error:', err);
      removeFromAllSubscriptions(ws);
    });
  });

  return wsServer;
}

// ============================================================================
// Server Lifecycle
// ============================================================================

/**
 * Start the Book Studio server
 */
export async function startServer(port?: number): Promise<string> {
  if (httpServer) {
    throw new Error('Server already running');
  }

  // Initialize configuration
  const config = await initConfig();
  const serverPort = port ?? config.port;

  // Initialize database
  getDatabase();
  console.log('[book-studio-server] Database initialized');

  // Create Express app
  app = createApp();

  // Create HTTP server
  httpServer = app.listen(serverPort, '127.0.0.1'); // Localhost only!

  // Set up WebSocket server
  if (config.wsEnabled) {
    wss = setupWebSocket(httpServer);
    console.log('[book-studio-server] WebSocket server enabled');
  }

  return new Promise((resolve, reject) => {
    httpServer!.on('listening', () => {
      const url = `http://127.0.0.1:${serverPort}`;
      console.log(`[book-studio-server] Started on ${url}`);
      resolve(url);
    });

    httpServer!.on('error', (err) => {
      console.error('[book-studio-server] Failed to start:', err);
      httpServer = null;
      app = null;
      reject(err);
    });
  });
}

/**
 * Stop the Book Studio server
 */
export async function stopServer(): Promise<void> {
  // Close WebSocket server
  if (wss) {
    wss.close();
    wss = null;
  }

  // Close HTTP server
  if (httpServer) {
    return new Promise((resolve, reject) => {
      httpServer!.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('[book-studio-server] Stopped');
          httpServer = null;
          app = null;
          closeDatabase();
          resolve();
        }
      });
    });
  }
}

/**
 * Check if server is running
 */
export function isServerRunning(): boolean {
  return httpServer !== null;
}

/**
 * Get the Express app instance
 */
export function getApp(): Express | null {
  return app;
}

/**
 * Get the WebSocket server instance
 */
export function getWss(): WebSocketServer | null {
  return wss;
}

// Re-export config
export { getConfig };
