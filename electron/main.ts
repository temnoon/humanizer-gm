/**
 * Humanizer Desktop - Electron Main Process
 *
 * Features:
 * - macOS title bar with traffic lights
 * - Optional: Archive server for local archive browsing
 * - Optional: Ollama for local LLM transformations
 */

import { app, BrowserWindow, shell, ipcMain, dialog, protocol, net } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import { createServer } from 'net';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Store = require('electron-store');

// Chat service
import { closeChatService } from './chat';

// Embedded Archive Server
import {
  startArchiveServer as startEmbeddedArchiveServer,
  stopArchiveServer as stopEmbeddedArchiveServer,
  isArchiveServerRunning,
  getEmbeddingDatabase,
  areServicesInitialized,
  waitForServices,
  getArchiveRoot,
} from './archive-server';

// Embedded NPE-Local Server (AI Detection, Transformations)
import { startNpeLocalServer, stopNpeLocalServer, isNpeLocalServerRunning, getNpeLocalPort } from './npe-local';

// Embedded Book Studio Server (Books, Chapters, Cards)
import { startBookStudioServer, stopBookStudioServer, isBookStudioServerRunning, initBookStudioAuth } from './book-studio-server';
import * as crypto from 'crypto';

// Whisper (local speech-to-text)
import { initWhisper, registerWhisperHandlers } from './whisper/whisper-manager';

// IPC Handlers (modularized)
import { registerXanaduHandlers } from './ipc/xanadu';
import { registerAgentHandlers } from './ipc/agents';
import { registerChatHandlers } from './ipc/chat';
import { registerQueueHandlers } from './ipc/queue';
import { registerAgentMasterHandlers } from './ipc/agent-master';
import { registerAIConfigHandlers } from './ipc/ai-config';

// Usage tracking (persistence)
import { initUsageTracker, shutdownUsageTracker } from './services/usage-tracker';

// Set app name for macOS menu bar (development mode)
// In production, this comes from electron-builder.json productName
app.name = 'Humanizer';

// Paths
const RENDERER_DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '../apps/web/dist');

// Initialize store for persistent settings
const store = new Store({
  name: 'humanizer-desktop',
  defaults: {
    windowBounds: { width: 1400, height: 900, x: undefined, y: undefined },
    archiveServerEnabled: true,  // Auto-start for seamless local archives
    archivePath: null,
    ollamaEnabled: false,
    whisperEnabled: true,
    whisperModel: 'ggml-base.en.bin',
    ollamaModel: 'qwen3:14b',  // Larger model for better tool-following
    firstRunComplete: false,
  },
});

// Keep references to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let archiveServerPort: number | null = null;
let npeLocalPort: number | null = null;
let bookStudioPort: number | null = null;

// ============================================================
// WINDOW MANAGEMENT
// ============================================================

async function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 768,
    // macOS title bar - shows traffic lights, hides title
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#fafaf9',
  });

  // Save window bounds on resize/move
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

  // Show when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the app
  if (RENDERER_DEV_URL) {
    await mainWindow.loadURL(RENDERER_DEV_URL);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(DIST, 'index.html'));
  }
}

function saveBounds() {
  if (mainWindow) {
    store.set('windowBounds', mainWindow.getBounds());
  }
}

// ============================================================
// ARCHIVE SERVER (Optional)
// ============================================================

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error('Could not get port'));
      }
    });
    server.on('error', reject);
  });
}

async function checkServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startArchiveServer(): Promise<number | null> {
  if (!store.get('archiveServerEnabled')) {
    console.log('Archive server disabled');
    return null;
  }

  const devPort = 3002;

  // In development, check if external server is already running
  if (!app.isPackaged) {
    const externalRunning = await checkServerRunning(devPort);
    if (externalRunning) {
      console.log(`Using external archive server on port ${devPort}`);
      archiveServerPort = devPort;
      return devPort;
    }
  }

  // Use embedded archive server
  const port = app.isPackaged ? await findFreePort() : devPort;
  const archivePath = store.get('archivePath');

  // Set environment for archive path if configured
  if (archivePath) {
    process.env.ARCHIVE_PATH = archivePath;
  }
  process.env.ARCHIVE_SERVER_PORT = port.toString();

  console.log(`Starting embedded archive server on port ${port}...`);

  try {
    const serverUrl = await startEmbeddedArchiveServer(port);
    console.log('Archive server ready:', serverUrl);
    archiveServerPort = port;
    return port;
  } catch (err) {
    console.error('Failed to start embedded archive server:', err);
    return null;
  }
}

async function stopArchiveServer() {
  if (isArchiveServerRunning()) {
    await stopEmbeddedArchiveServer();
    archiveServerPort = null;
  }
}

// ============================================================
// NPE-LOCAL SERVER (AI Detection, Transformations)
// ============================================================

async function startNpeLocal(): Promise<number | null> {
  const devPort = 3003;

  // In development, check if external server is already running
  if (!app.isPackaged) {
    const externalRunning = await checkServerRunning(devPort);
    if (externalRunning) {
      console.log(`Using external npe-local server on port ${devPort}`);
      npeLocalPort = devPort;
      return devPort;
    }
  }

  const port = app.isPackaged ? await findFreePort() : devPort;

  console.log(`Starting embedded npe-local server on port ${port}...`);

  try {
    const serverUrl = await startNpeLocalServer({ port });
    console.log('NPE-Local server ready:', serverUrl);
    npeLocalPort = port;
    return port;
  } catch (err) {
    console.error('Failed to start embedded npe-local server:', err);
    return null;
  }
}

async function stopNpeLocal() {
  if (isNpeLocalServerRunning()) {
    await stopNpeLocalServer();
    npeLocalPort = null;
  }
}

// ============================================================
// BOOK STUDIO SERVER (Books, Chapters, Cards)
// ============================================================

async function startBookStudio(): Promise<number | null> {
  const port = 3004;

  // In development, check if external server is already running
  if (!app.isPackaged) {
    const externalRunning = await checkServerRunning(port);
    if (externalRunning) {
      console.log(`Using external book-studio server on port ${port}`);
      bookStudioPort = port;
      return port;
    }
  }

  console.log(`Starting embedded book-studio server on port ${port}...`);

  try {
    // Initialize JWT auth for production builds
    // In development, auth is optional (dev mode with admin access)
    if (app.isPackaged) {
      // Get or generate JWT secret
      let jwtSecret = store.get('jwtSecret') as string | undefined;
      if (!jwtSecret) {
        // Generate a new 64-character hex secret (256 bits)
        jwtSecret = crypto.randomBytes(32).toString('hex');
        store.set('jwtSecret', jwtSecret);
        console.log('[book-studio] Generated new JWT secret');
      }
      initBookStudioAuth(jwtSecret);
      console.log('[book-studio] JWT auth enabled');
    } else if (process.env.JWT_SECRET) {
      // Dev mode with explicit JWT_SECRET env var
      initBookStudioAuth(process.env.JWT_SECRET);
      console.log('[book-studio] JWT auth enabled (from env)');
    } else {
      console.log('[book-studio] Dev mode - auth disabled (admin access)');
    }

    const serverUrl = await startBookStudioServer(port);
    console.log('Book Studio server ready:', serverUrl);
    bookStudioPort = port;
    return port;
  } catch (err) {
    console.error('Failed to start embedded book-studio server:', err);
    return null;
  }
}

async function stopBookStudio() {
  if (isBookStudioServerRunning()) {
    await stopBookStudioServer();
    bookStudioPort = null;
  }
}

// ============================================================
// IPC HANDLERS
// ============================================================

function registerIPCHandlers() {
  // Store
  ipcMain.handle('store:get', (_e, key: string) => store.get(key));
  ipcMain.handle('store:set', (_e, key: string, value: unknown) => {
    store.set(key, value);
    return true;
  });

  // App Info
  ipcMain.handle('app:paths', () => ({
    documents: app.getPath('documents'),
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    temp: app.getPath('temp'),
  }));

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('app:is-first-run', () => !store.get('firstRunComplete'));
  ipcMain.handle('app:complete-first-run', () => {
    store.set('firstRunComplete', true);
    return true;
  });

  // File Dialogs
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:select-file', async (_e, options?: { filters?: Electron.FileFilter[] }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Archive Server
  ipcMain.handle('archive:port', () => archiveServerPort);
  ipcMain.handle('archive:enabled', () => store.get('archiveServerEnabled'));

  ipcMain.handle('archive:enable', async (_e, archivePath?: string) => {
    store.set('archiveServerEnabled', true);
    if (archivePath) {
      store.set('archivePath', archivePath);
    }
    const port = await startArchiveServer();
    return { success: !!port, port };
  });

  ipcMain.handle('archive:disable', async () => {
    store.set('archiveServerEnabled', false);
    await stopArchiveServer();
    return { success: true };
  });

  ipcMain.handle('archive:restart', async (_e, newPath?: string) => {
    if (newPath) {
      store.set('archivePath', newPath);
    }
    await stopArchiveServer();
    const port = await startArchiveServer();
    return { success: !!port, port };
  });

  // NPE-Local (AI Detection, Transformations)
  ipcMain.handle('npe:port', () => npeLocalPort);

  // OAuth callback port (for development mode localhost server)
  ipcMain.handle('auth:callback-port', () => oauthCallbackPort);
  ipcMain.handle('npe:status', async () => {
    if (!npeLocalPort) {
      return { running: false, port: null };
    }
    try {
      const response = await fetch(`http://localhost:${npeLocalPort}/health`);
      if (response.ok) {
        const data = await response.json();
        return { running: true, port: npeLocalPort, ...data };
      }
    } catch {
      // Server not responding
    }
    return { running: false, port: npeLocalPort };
  });

  // Book Studio (Books, Chapters, Cards)
  ipcMain.handle('book-studio:port', () => bookStudioPort);
  ipcMain.handle('book-studio:status', async () => {
    if (!bookStudioPort) {
      return { running: false, port: null };
    }
    try {
      const response = await fetch(`http://localhost:${bookStudioPort}/health`);
      if (response.ok) {
        const data = await response.json();
        return { running: true, port: bookStudioPort, ...data };
      }
    } catch {
      // Server not responding
    }
    return { running: false, port: bookStudioPort };
  });

  // Ollama
  ipcMain.handle('ollama:enabled', () => store.get('ollamaEnabled'));
  ipcMain.handle('ollama:enable', () => {
    store.set('ollamaEnabled', true);
    return true;
  });
  ipcMain.handle('ollama:disable', () => {
    store.set('ollamaEnabled', false);
    return true;
  });

  ipcMain.handle('ollama:status', async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        return { installed: true, running: true };
      }
    } catch {
      // Not running
    }
    return { installed: false, running: false };
  });

  // Shell - open URLs in external browser
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    // Only allow http/https URLs for security
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Invalid URL protocol' };
  });

  // Cloud drives - stubs
  ipcMain.handle('cloud:list-drives', () => []);
  ipcMain.handle('cloud:google:connect', () => ({ success: false, error: 'Not implemented' }));
  ipcMain.handle('cloud:google:is-connected', () => false);
  ipcMain.handle('cloud:google:disconnect', () => ({ success: true }));
  ipcMain.handle('cloud:google:list', () => ({ success: false, error: 'Not implemented' }));
  ipcMain.handle('cloud:google:search', () => ({ success: false, error: 'Not implemented' }));
  ipcMain.handle('cloud:google:download', () => ({ success: false, error: 'Not implemented' }));

  console.log('IPC handlers registered');
}
// ============================================================
// CUSTOM PROTOCOL FOR LOCAL MEDIA
// ============================================================

// Register the scheme as privileged (must be before app ready)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerLocalMediaProtocol() {
  // Handle local-media:// URLs by serving files directly from disk
  // URL format: local-media://serve/<absolute-path-to-file>
  protocol.handle('local-media', async (request) => {
    try {
      // Parse the URL - format: local-media://serve/path/to/file.jpg
      const url = new URL(request.url);
      // The pathname will be like /serve/Users/tem/path/file.jpg
      // Remove the leading /serve/ to get the actual path
      let filePath = decodeURIComponent(url.pathname);

      // Remove leading /serve/ if present
      if (filePath.startsWith('/serve/')) {
        filePath = '/' + filePath.slice(7); // Keep the leading / for absolute path
      } else if (filePath.startsWith('/serve')) {
        filePath = '/' + filePath.slice(6);
      }

      // Security: only allow serving from known safe directories
      // For now, allow any absolute path (Electron app is trusted)
      // In production, you might want to restrict to specific directories

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return new Response('File not found', { status: 404 });
      }

      // Get MIME type based on extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Use net.fetch with file:// URL for efficient streaming
      const fileUrl = pathToFileURL(filePath).href;
      const response = await net.fetch(fileUrl);

      // Return with proper content type
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        },
      });
    } catch (error) {
      console.error('Error serving local media:', error);
      return new Response('Internal error', { status: 500 });
    }
  });

  console.log('Local media protocol registered');
}

// ============================================================
// OAUTH CALLBACK SERVER (Development Mode)
// ============================================================

import * as http from 'http';

let oauthCallbackServer: http.Server | null = null;
let oauthCallbackPort: number | null = null;

/**
 * Start a local HTTP server to receive OAuth callbacks in development mode.
 * In production, the custom protocol (humanizer://) works correctly.
 */
async function startOAuthCallbackServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (url.pathname === '/auth/callback') {
        const token = url.searchParams.get('token');
        const isNewUser = url.searchParams.get('isNewUser') === 'true';

        if (token && mainWindow) {
          console.log('[OAuth] Token received via localhost callback');
          mainWindow.webContents.send('auth:oauth-callback', { token, isNewUser });

          // Focus the app window
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();

          // Send success page to browser
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Successful</title></head>
            <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1918; color: #fff;">
              <div style="text-align: center;">
                <h1 style="color: #4a90d9;">Login Successful!</h1>
                <p>You can close this tab and return to Humanizer.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </div>
            </body>
            </html>
          `);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Login failed</h1><p>No token received or app window not ready.</p>');
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Find a free port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        oauthCallbackPort = addr.port;
        oauthCallbackServer = server;
        console.log(`[OAuth] Callback server listening on http://127.0.0.1:${oauthCallbackPort}`);
        resolve(addr.port);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

function stopOAuthCallbackServer() {
  if (oauthCallbackServer) {
    oauthCallbackServer.close();
    oauthCallbackServer = null;
    oauthCallbackPort = null;
  }
}

// ============================================================
// APP LIFECYCLE - SINGLE INSTANCE LOCK
// ============================================================

// Store deep link URL to process after window is ready
let pendingDeepLinkUrl: string | null = null;

// Helper to handle deep link URL (OAuth callback - for production)
function handleDeepLinkUrl(url: string) {
  console.log('[OAuth] Processing deep link:', url);

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'humanizer:' && parsedUrl.host === 'auth' && parsedUrl.pathname === '/callback') {
      const token = parsedUrl.searchParams.get('token');
      const isNewUser = parsedUrl.searchParams.get('isNewUser') === 'true';

      if (token && mainWindow) {
        console.log('[OAuth] Token received, sending to renderer');
        mainWindow.webContents.send('auth:oauth-callback', { token, isNewUser });
        // Focus the app window
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      } else if (token && !mainWindow) {
        // Window not ready yet, store for later
        pendingDeepLinkUrl = url;
        console.log('[OAuth] Window not ready, storing URL for later');
      } else if (!token) {
        console.error('[OAuth] No token in callback URL');
      }
    }
  } catch (err) {
    console.error('[OAuth] Failed to parse deep link:', err);
  }
}

// Request single instance lock - ensures only one instance runs
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is running, quitting...');
  app.quit();
} else {
  // Handle second instance (receives deep link URL on Windows/Linux)
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    console.log('[OAuth] Second instance detected');
    const deepLinkUrl = commandLine.find(arg => arg.startsWith('humanizer://'));
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Register custom protocol (works in production, fallback in development)
  if (!app.isPackaged) {
    // Development: rely on localhost callback server instead
    console.log('[OAuth] Development mode - will use localhost callback server');
  } else {
    // Production: register custom protocol
    app.setAsDefaultProtocolClient('humanizer');
    console.log('[OAuth] Production mode - registered humanizer:// protocol');
  }
}

// ============================================================
// APP LIFECYCLE - READY
// ============================================================

app.whenReady().then(async () => {
  console.log('Humanizer Desktop starting...');

  // Register custom protocol for local file serving
  registerLocalMediaProtocol();

  registerIPCHandlers();
  registerAgentMasterHandlers();
  registerAgentHandlers(() => mainWindow);
  registerAIConfigHandlers();
  registerChatHandlers({
    getMainWindow: () => mainWindow,
    getStore: () => store,
    getArchiveServerPort: () => archiveServerPort,
  });
  registerQueueHandlers({
    getMainWindow: () => mainWindow,
    store,
  });

  // Start OAuth callback server in development mode
  if (!app.isPackaged) {
    try {
      await startOAuthCallbackServer();
    } catch (err) {
      console.error('[OAuth] Failed to start callback server:', err);
    }
  }

  // Initialize whisper for speech-to-text
  if (store.get('whisperEnabled')) {
    const whisperAvailable = await initWhisper();
    if (whisperAvailable) {
      registerWhisperHandlers();
      console.log('Whisper speech-to-text initialized');
    } else {
      console.log('Whisper module not available - install @kutalia/whisper-node-addon');
    }
  }

  // Always start archive server for local archive access
  // Set flag BEFORE calling startArchiveServer since it checks this
  store.set('archiveServerEnabled', true);
  await startArchiveServer();

  // Register Xanadu handlers (after archive server to ensure DB is ready)
  registerXanaduHandlers(() => mainWindow);

  // Always start npe-local server for AI detection and transformations
  await startNpeLocal();

  // Initialize usage tracker (persist LLM usage to disk)
  initUsageTracker();

  // Start Book Studio server for books, chapters, cards
  await startBookStudio();

  await createWindow();

  // Process any pending deep link URL that arrived before window was ready
  if (pendingDeepLinkUrl) {
    console.log('[OAuth] Processing pending deep link URL');
    handleDeepLinkUrl(pendingDeepLinkUrl);
    pendingDeepLinkUrl = null;
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Handle OAuth deep link callback (macOS - when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('Shutting down...');
  shutdownUsageTracker();
  stopArchiveServer();
  stopNpeLocal();
  stopBookStudio();
  closeChatService();
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
