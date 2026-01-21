/**
 * Book Studio Server
 *
 * Embedded Express server for Book Studio API.
 * Provides REST endpoints and WebSocket for real-time events.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

// Dynamic import for ESM-only jose library
let joseModule: typeof import('jose') | null = null;
async function getJose(): Promise<typeof import('jose')> {
  if (!joseModule) {
    joseModule = await import('jose');
  }
  return joseModule;
}
import { initConfig, getConfig } from './config';
import { getDatabase, closeDatabase, DbBook } from './database';
import { initAuth, isAuthEnabled, getJwtSecret, AuthContext } from './middleware/auth';

// Route modules
import { createBooksRouter } from './routes/books';
import { createChaptersRouter } from './routes/chapters';
import { createCardsRouter } from './routes/cards';
import { createClustersRouter } from './routes/clusters';
import { createOutlinesRouter } from './routes/outlines';
import { createEventsRouter } from './routes/events';
import { createConfigRouter } from './routes/config';
import { createGradingRouter } from './routes/grading';
import { createOutlineComputationRouter } from './routes/outline-computation';
import { createMetricsRouter } from './routes/metrics';
import { createHarvestRouter } from './routes/harvest';
import { createDraftRouter } from './routes/draft';
import { createVoiceRouter } from './routes/voice';

// Middleware
import { errorHandler, notFoundHandler } from './middleware/error-handler';

// ============================================================================
// Server Instance
// ============================================================================

let app: Express | null = null;
let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;

// WebSocket connections by book ID
const subscriptions = new Map<string, Set<WebSocket>>();

// WebSocket auth context (stored per connection)
const wsAuthContexts = new WeakMap<WebSocket, AuthContext>();

// WebSocket close codes
const WS_CLOSE_NO_TOKEN = 4001;
const WS_CLOSE_INVALID_TOKEN = 4002;
const WS_CLOSE_ACCESS_DENIED = 4003;

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
 * Returns true if successful, false if access denied
 */
function subscribeToBook(ws: WebSocket, bookId: string): boolean {
  // Verify ownership before subscribing
  const authContext = wsAuthContexts.get(ws);
  if (!authContext) {
    console.log(`[book-studio-ws] No auth context for subscription`);
    return false;
  }

  // Check if user owns the book
  const db = getDatabase();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as DbBook | undefined;

  if (!book) {
    console.log(`[book-studio-ws] Book not found: ${bookId}`);
    return false;
  }

  // Allow if:
  // - Book has no owner (legacy data)
  // - User is the owner
  // - User is admin
  if (book.user_id && book.user_id !== authContext.userId && authContext.role !== 'admin') {
    console.log(`[book-studio-ws] Access denied to book ${bookId} for user ${authContext.userId}`);
    return false;
  }

  if (!subscriptions.has(bookId)) {
    subscriptions.set(bookId, new Set());
  }
  subscriptions.get(bookId)!.add(ws);
  console.log(`[book-studio-ws] Subscribed to book ${bookId}`);
  return true;
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
  expressApp.use('/api/outline-compute', createOutlineComputationRouter());
  expressApp.use('/api/events', createEventsRouter());
  expressApp.use('/api/config', createConfigRouter());
  expressApp.use('/api/grading', createGradingRouter());
  expressApp.use('/api/metrics', createMetricsRouter());

  // New consolidated API routes (Phase 3)
  expressApp.use('/api/harvest', createHarvestRouter());
  expressApp.use('/api/draft', createDraftRouter());
  expressApp.use('/api/voice', createVoiceRouter());

  // 404 handler for unmatched routes
  expressApp.use(notFoundHandler);

  // Error handler (must be last)
  expressApp.use(errorHandler);

  return expressApp;
}

// ============================================================================
// WebSocket Server Setup
// ============================================================================

/**
 * Validate JWT token from WebSocket connection query params
 */
async function validateWsToken(request: IncomingMessage): Promise<AuthContext | null> {
  // Skip auth if not enabled (development mode)
  if (!isAuthEnabled()) {
    return {
      userId: 'dev-user',
      email: 'dev@localhost',
      role: 'admin',
      tier: 'admin',
    };
  }

  try {
    // Parse URL to get token from query params
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      return null;
    }

    const jose = await getJose();
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    const userId = payload.sub as string;
    const email = (payload.email as string) || '';
    const role = (payload.role as AuthContext['role']) || 'free';
    const tier = (payload.tier as string) || role;

    if (!userId) {
      return null;
    }

    return { userId, email, role, tier };
  } catch (error) {
    console.warn('[book-studio-ws] Token validation error:', error);
    return null;
  }
}

function setupWebSocket(server: HttpServer): WebSocketServer {
  const wsServer = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: async ({ req }, callback) => {
      // Validate token before accepting connection
      const authContext = await validateWsToken(req);

      if (!authContext) {
        console.log('[book-studio-ws] Connection rejected: no valid token');
        callback(false, 401, 'Unauthorized');
        return;
      }

      // Store auth context temporarily for use in connection handler
      (req as IncomingMessage & { authContext?: AuthContext }).authContext = authContext;
      callback(true);
    },
  });

  wsServer.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    // Get auth context from request (set during verification)
    const authContext = (request as IncomingMessage & { authContext?: AuthContext }).authContext;

    if (!authContext) {
      // This shouldn't happen since verifyClient checks, but just in case
      ws.close(WS_CLOSE_NO_TOKEN, 'No auth context');
      return;
    }

    // Store auth context for this WebSocket
    wsAuthContexts.set(ws, authContext);
    console.log(`[book-studio-ws] Client connected: ${authContext.userId}`);

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'subscribe':
            if (message.bookId) {
              const success = subscribeToBook(ws, message.bookId);
              if (success) {
                ws.send(JSON.stringify({ type: 'subscribed', bookId: message.bookId }));
              } else {
                ws.send(JSON.stringify({ type: 'error', code: 'ACCESS_DENIED', message: 'Access denied to book' }));
              }
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

// Re-export config and auth
export { getConfig };
export { initAuth };
