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

// Queue system
import { initQueueManager, getQueueManager, type QueueJobSpec, type JobQueryOptions } from './queue';

// Chat service
import { getChatService, closeChatService, type ChatServiceConfig, type SendMessageOptions } from './chat';

// Agent Council
import { getCouncilOrchestrator, type CouncilOrchestrator, type ProposedAction, type TaskOptions } from './agents/council/orchestrator';
import { getAgentRegistry } from './agents/runtime/registry';

// Embedded Archive Server
import {
  startArchiveServer as startEmbeddedArchiveServer,
  stopArchiveServer as stopEmbeddedArchiveServer,
  isArchiveServerRunning,
  getEmbeddingDatabase,
  areServicesInitialized,
  waitForServices,
} from './archive-server';

// Embedded NPE-Local Server (AI Detection, Transformations)
import { startNpeLocalServer, stopNpeLocalServer, isNpeLocalServerRunning, getNpeLocalPort } from './npe-local';

// Whisper (local speech-to-text)
import { initWhisper, registerWhisperHandlers } from './whisper/whisper-manager';

// AgentMaster (unified LLM abstraction)
import {
  getAgentMasterService,
  setDeviceProfile,
  clearDeviceOverride,
  getDeviceProfile,
  getTierDescription,
  getRecommendedModels,
  type MemoryTier,
} from './agent-master';

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

  // ============================================================
  // QUEUE SYSTEM
  // ============================================================

  // Initialize queue manager with store for persistence
  const queueManager = initQueueManager({ store });

  // Forward queue events to renderer
  queueManager.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('queue:event', event);
    }
  });

  // Job lifecycle
  ipcMain.handle('queue:create-job', async (_e, spec: QueueJobSpec) => {
    return queueManager.createJob(spec);
  });

  ipcMain.handle('queue:get-job', (_e, jobId: string) => {
    return queueManager.getJob(jobId);
  });

  ipcMain.handle('queue:list-jobs', (_e, options?: JobQueryOptions) => {
    return queueManager.listJobs(options);
  });

  ipcMain.handle('queue:cancel-job', async (_e, jobId: string) => {
    return queueManager.cancelJob(jobId);
  });

  ipcMain.handle('queue:delete-job', (_e, jobId: string) => {
    return queueManager.deleteJob(jobId);
  });

  // Queue control
  ipcMain.handle('queue:pause', () => {
    queueManager.pauseQueue();
    return true;
  });

  ipcMain.handle('queue:resume', () => {
    queueManager.resumeQueue();
    return true;
  });

  ipcMain.handle('queue:state', () => {
    return queueManager.getState();
  });

  console.log('IPC handlers registered (including queue system)');

  // ============================================================
  // CHAT SERVICE
  // ============================================================

  // Initialize chat service
  const chatDbPath = path.join(app.getPath('userData'), 'chat.db');
  const chatConfig: ChatServiceConfig = {
    dbPath: chatDbPath,
    llm: {
      provider: 'ollama',
      model: store.get('ollamaModel') || 'qwen3:14b',
      baseUrl: 'http://localhost:11434',
    },
    archiveUrl: archiveServerPort ? `http://localhost:${archiveServerPort}` : undefined,
    autoArchive: true,
  };

  const chatService = getChatService(chatConfig);

  // Forward chat events to renderer
  chatService.on('message:created', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:message', event);
    }
  });

  chatService.on('tool:executed', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:tool-executed', event);
    }
  });

  chatService.on('error', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:error', event);
    }
  });

  // Chat IPC handlers
  ipcMain.handle('chat:start-conversation', (_e, options?: { projectId?: string; tags?: string[] }) => {
    return chatService.startConversation(options);
  });

  ipcMain.handle('chat:get-conversation', () => {
    return chatService.getCurrentConversation();
  });

  ipcMain.handle('chat:load-conversation', (_e, id: string) => {
    return chatService.loadConversation(id);
  });

  ipcMain.handle('chat:list-conversations', (_e, options?: { limit?: number; projectId?: string }) => {
    return chatService.listConversations(options);
  });

  ipcMain.handle('chat:get-messages', (_e, conversationId?: string) => {
    return chatService.getMessages(conversationId);
  });

  ipcMain.handle('chat:send-message', async (_e, content: string, options?: SendMessageOptions) => {
    return chatService.sendMessage(content, options);
  });

  ipcMain.handle('chat:end-conversation', () => {
    chatService.endConversation();
    return { success: true };
  });

  ipcMain.handle('chat:archive-conversation', async (_e, conversationId: string) => {
    await chatService.archiveConversation(conversationId);
    return { success: true };
  });

  ipcMain.handle('chat:search-messages', (_e, query: string) => {
    return chatService.searchMessages(query);
  });

  ipcMain.handle('chat:stats', () => {
    return chatService.getStats();
  });

  ipcMain.handle('chat:update-config', (_e, updates: Partial<ChatServiceConfig>) => {
    chatService.updateConfig(updates);
    return { success: true };
  });

  console.log('Chat service initialized');

  // ============================================================
  // AGENT COUNCIL
  // ============================================================

  // Initialize orchestrator
  const orchestrator = getCouncilOrchestrator();
  const agentRegistry = getAgentRegistry();

  // Initialize orchestrator (will start agents)
  orchestrator.initialize().catch((err) => {
    console.error('Failed to initialize agent orchestrator:', err);
  });

  // Forward orchestrator events to renderer
  orchestrator.onEvent((event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const timestamp = Date.now();

    switch (event.type) {
      case 'proposal:created':
        // Transform proposal to renderer format
        const proposal = (event as { proposal?: { id: string; agentId: string; actionType: string; title: string; description?: string; payload?: unknown; projectId?: string; urgency?: string; createdAt: number; expiresAt?: number; status: string } }).proposal;
        if (proposal) {
          const agent = agentRegistry.get(proposal.agentId);
          mainWindow.webContents.send('agents:proposal', {
            type: 'proposal:received',
            proposal: {
              id: proposal.id,
              agentId: proposal.agentId,
              agentName: agent?.name || proposal.agentId,
              actionType: proposal.actionType,
              title: proposal.title,
              description: proposal.description,
              payload: proposal.payload,
              urgency: proposal.urgency || 'normal',
              projectId: proposal.projectId,
              createdAt: proposal.createdAt,
              expiresAt: proposal.expiresAt,
              status: proposal.status,
            },
            timestamp,
          });
        }
        break;

      case 'proposal:approved':
      case 'proposal:rejected':
        mainWindow.webContents.send('agents:proposal', {
          type: event.type,
          proposalId: (event as { proposalId?: string }).proposalId,
          timestamp,
        });
        break;

      case 'session:started':
      case 'session:ended':
      case 'session:paused':
      case 'session:resumed':
        mainWindow.webContents.send('agents:session', {
          type: event.type,
          sessionId: (event as { sessionId?: string }).sessionId,
          projectId: (event as { projectId?: string }).projectId,
          timestamp,
        });
        break;
    }
  });

  // Agent IPC handlers
  ipcMain.handle('agents:list', () => {
    const agents = agentRegistry.list();
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      house: a.house,
      status: a.status,
      capabilities: a.capabilities || [],
    }));
  });

  ipcMain.handle('agents:get', (_e, agentId: string) => {
    const agent = agentRegistry.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      house: agent.house,
      status: agent.status,
      capabilities: agent.capabilities || [],
    };
  });

  // Proposal handlers
  ipcMain.handle('agents:proposals:pending', (_e, projectId?: string) => {
    const proposals = orchestrator.getPendingProposals(projectId);
    return proposals.map((p) => {
      const agent = agentRegistry.get(p.agentId);
      return {
        id: p.id,
        agentId: p.agentId,
        agentName: agent?.name || p.agentId,
        actionType: p.actionType,
        title: p.title,
        description: p.description,
        payload: p.payload,
        urgency: p.urgency || 'normal',
        projectId: p.projectId,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        status: p.status,
      };
    });
  });

  ipcMain.handle('agents:proposals:approve', async (_e, proposalId: string) => {
    try {
      await orchestrator.approveProposal(proposalId, 'user');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agents:proposals:reject', async (_e, proposalId: string, reason?: string) => {
    try {
      await orchestrator.rejectProposal(proposalId, 'user');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Task handlers
  ipcMain.handle('agents:task:request', async (_e, request: { agentId: string; taskType: string; payload: unknown; projectId?: string }) => {
    try {
      const taskId = await orchestrator.assignTask({
        targetAgent: request.agentId,
        type: request.taskType,
        payload: request.payload,
        projectId: request.projectId,
        priority: 5, // Default medium priority
      });
      return { taskId };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agents:task:status', (_e, taskId: string) => {
    const task = orchestrator.getTaskStatus(taskId);
    if (!task) return { status: 'not_found' };
    return {
      status: task.status,
      result: task.result,
      error: task.error,
    };
  });

  // Session handlers
  ipcMain.handle('agents:session:start', async (_e, projectId?: string) => {
    const session = await orchestrator.startSession(projectId);
    return { sessionId: session.id };
  });

  ipcMain.handle('agents:session:end', async (_e, sessionId: string, summary?: string) => {
    await orchestrator.endSession(sessionId, summary);
    return { success: true };
  });

  // Stats
  ipcMain.handle('agents:stats', () => {
    const stats = orchestrator.getStats();
    return {
      activeSessions: stats.activeSessions,
      pendingProposals: stats.pendingProposals,
      registeredAgents: stats.registeredAgents,
      activeAgents: stats.activeAgents,
    };
  });

  console.log('Agent council initialized');
}

// ============================================================
// AGENT MASTER IPC HANDLERS
// ============================================================

function registerAgentMasterHandlers() {
  // Get current device profile
  ipcMain.handle('agent-master:get-profile', () => {
    return getDeviceProfile();
  });

  // Set tier override (for testing different device tiers)
  ipcMain.handle('agent-master:set-tier', (_e, tier: MemoryTier) => {
    setDeviceProfile({ tier });
    const profile = getDeviceProfile();
    console.log(`[AgentMaster] Tier override set to: ${tier}`);
    return {
      tier,
      description: getTierDescription(tier),
      recommendedModels: getRecommendedModels(tier),
      profile,
    };
  });

  // Clear tier override (use auto-detection)
  ipcMain.handle('agent-master:clear-override', () => {
    clearDeviceOverride();
    const profile = getDeviceProfile();
    console.log('[AgentMaster] Tier override cleared, using auto-detection');
    return {
      tier: profile.tier,
      description: getTierDescription(profile.tier),
      recommendedModels: getRecommendedModels(profile.tier),
      profile,
    };
  });

  // Get tier info
  ipcMain.handle('agent-master:tier-info', (_e, tier: MemoryTier) => {
    return {
      tier,
      description: getTierDescription(tier),
      recommendedModels: getRecommendedModels(tier),
    };
  });

  // List available capabilities
  ipcMain.handle('agent-master:capabilities', () => {
    const agentMaster = getAgentMasterService();
    return agentMaster.listCapabilities();
  });

  console.log('AgentMaster IPC handlers registered');
}

// ============================================================
// XANADU UNIFIED STORAGE IPC HANDLERS
// ============================================================

function registerXanaduHandlers() {
  // Check if services are ready before any operation
  const ensureDb = () => {
    if (!areServicesInitialized()) {
      throw new Error('Archive services not initialized. Start archive server first.');
    }
    return getEmbeddingDatabase();
  };

  // ─────────────────────────────────────────────────────────────────
  // BOOK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:book:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllBooks(includeLibrary);
  });

  ipcMain.handle('xanadu:book:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getBook(idOrUri);
  });

  ipcMain.handle('xanadu:book:upsert', (_e, book: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBook(book as Parameters<typeof db.upsertBook>[0]);
    return { success: true, id: book.id };
  });

  ipcMain.handle('xanadu:book:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBook(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PERSONA OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:persona:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllPersonas(includeLibrary);
  });

  ipcMain.handle('xanadu:persona:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getPersona(idOrUri);
  });

  ipcMain.handle('xanadu:persona:upsert', (_e, persona: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertPersona(persona as Parameters<typeof db.upsertPersona>[0]);
    return { success: true, id: persona.id };
  });

  ipcMain.handle('xanadu:persona:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deletePersona(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // STYLE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:style:list', (_e, includeLibrary = true) => {
    const db = ensureDb();
    return db.getAllStyles(includeLibrary);
  });

  ipcMain.handle('xanadu:style:get', (_e, idOrUri: string) => {
    const db = ensureDb();
    return db.getStyle(idOrUri);
  });

  ipcMain.handle('xanadu:style:upsert', (_e, style: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertStyle(style as Parameters<typeof db.upsertStyle>[0]);
    return { success: true, id: style.id };
  });

  ipcMain.handle('xanadu:style:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteStyle(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:passage:list', (_e, bookId: string, curationStatus?: string) => {
    const db = ensureDb();
    return db.getBookPassages(bookId, curationStatus);
  });

  ipcMain.handle('xanadu:passage:upsert', (_e, passage: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBookPassage(passage as Parameters<typeof db.upsertBookPassage>[0]);
    return { success: true, id: passage.id };
  });

  ipcMain.handle('xanadu:passage:curate', (_e, id: string, status: string, note?: string) => {
    const db = ensureDb();
    db.updatePassageCuration(id, status, note);
    return { success: true };
  });

  ipcMain.handle('xanadu:passage:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBookPassage(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:chapter:list', (_e, bookId: string) => {
    const db = ensureDb();
    return db.getBookChapters(bookId);
  });

  ipcMain.handle('xanadu:chapter:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getBookChapter(id);
  });

  ipcMain.handle('xanadu:chapter:upsert', (_e, chapter: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertBookChapter(chapter as Parameters<typeof db.upsertBookChapter>[0]);
    return { success: true, id: chapter.id };
  });

  ipcMain.handle('xanadu:chapter:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteBookChapter(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // CHAPTER VERSION OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:version:list', (_e, chapterId: string) => {
    const db = ensureDb();
    return db.getChapterVersions(chapterId);
  });

  ipcMain.handle('xanadu:version:save', (
    _e,
    chapterId: string,
    version: number,
    content: string,
    changes?: string,
    createdBy?: string
  ) => {
    const db = ensureDb();
    db.saveChapterVersion(chapterId, version, content, changes, createdBy);
    return { success: true };
  });

  // Fill chapter with generated content
  ipcMain.handle(
    'xanadu:chapter:fill',
    async (_e, chapterId: string, bookId: string, options?: Record<string, unknown>) => {
      const archivePath = store.get('archivePath') as string | null;
      if (!archivePath) {
        return { success: false, error: 'Archive path not configured' };
      }
      const { fillChapter } = await import('./services/chapter-filler.js');
      return fillChapter(chapterId, bookId, archivePath, options);
    }
  );

  // ─────────────────────────────────────────────────────────────────
  // HARVEST BUCKET OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:harvest-bucket:list', (_e, bookUri?: string) => {
    const db = ensureDb();
    if (bookUri) {
      return db.getHarvestBucketsForBook(bookUri);
    }
    return db.getAllHarvestBuckets();
  });

  ipcMain.handle('xanadu:harvest-bucket:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getHarvestBucket(id);
  });

  ipcMain.handle('xanadu:harvest-bucket:upsert', (_e, bucket: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
    return { success: true, id: bucket.id };
  });

  ipcMain.handle('xanadu:harvest-bucket:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteHarvestBucket(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // HARVEST CURATION OPERATIONS (atomic passage moves + lifecycle)
  // ─────────────────────────────────────────────────────────────────

  // Helper: Find and remove a passage from any array, return it
  function findAndRemovePassage(
    bucket: Record<string, unknown>,
    passageId: string
  ): { passage: Record<string, unknown> | null; fromArray: string | null } {
    const arrays = ['candidates', 'approved', 'gems', 'rejected'] as const;
    for (const arrayName of arrays) {
      const arr = bucket[arrayName] as Record<string, unknown>[];
      if (!arr) continue;
      const index = arr.findIndex((p) => p.id === passageId);
      if (index !== -1) {
        const [passage] = arr.splice(index, 1);
        return { passage, fromArray: arrayName };
      }
    }
    return { passage: null, fromArray: null };
  }

  ipcMain.handle('xanadu:harvest:approve-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to approved array
      const approved = (bucket.approved as Record<string, unknown>[]) || [];
      passage.curation = { status: 'approved', timestamp: Date.now() };
      approved.push(passage);
      bucket.approved = approved;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] approve-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:reject-passage', (_e, bucketId: string, passageId: string, reason?: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to rejected array
      const rejected = (bucket.rejected as Record<string, unknown>[]) || [];
      passage.curation = { status: 'rejected', reason, timestamp: Date.now() };
      rejected.push(passage);
      bucket.rejected = rejected;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] reject-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:gem-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Add to gems array
      const gems = (bucket.gems as Record<string, unknown>[]) || [];
      passage.curation = { status: 'gem', timestamp: Date.now() };
      gems.push(passage);
      bucket.gems = gems;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] gem-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:undo-passage', (_e, bucketId: string, passageId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      const { passage, fromArray } = findAndRemovePassage(bucket, passageId);
      if (!passage) {
        return { success: false, error: `Passage not found in bucket: ${passageId}` };
      }

      // Move back to candidates
      const candidates = (bucket.candidates as Record<string, unknown>[]) || [];
      passage.curation = { status: 'candidate', timestamp: Date.now() };
      candidates.push(passage);
      bucket.candidates = candidates;

      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true, fromArray };
    } catch (err) {
      console.error('[Harvest] undo-passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:finish-collecting', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      if (bucket.status !== 'collecting') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'collecting'` };
      }

      bucket.status = 'reviewing';
      bucket.completedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true };
    } catch (err) {
      console.error('[Harvest] finish-collecting error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:stage-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      console.log(`[Harvest] Stage attempt for bucket ${bucketId}:`, {
        status: bucket.status,
        bookUri: bucket.bookUri,
        bookId: bucket.bookId,
        approvedCount: (bucket.approved as unknown[])?.length ?? 0,
        gemsCount: (bucket.gems as unknown[])?.length ?? 0,
      });

      if (bucket.status !== 'reviewing') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'reviewing'` };
      }

      const approved = (bucket.approved as unknown[]) || [];
      const gems = (bucket.gems as unknown[]) || [];
      if (approved.length === 0 && gems.length === 0) {
        return { success: false, error: 'No approved or gem passages to stage' };
      }

      bucket.status = 'staged';
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      console.log(`[Harvest] Staged bucket ${bucketId} with ${approved.length} approved, ${gems.length} gems`);
      return { success: true, approvedCount: approved.length, gemCount: gems.length };
    } catch (err) {
      console.error('[Harvest] stage-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:commit-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      console.log(`[Harvest] Commit attempt for bucket ${bucketId}:`, {
        status: bucket.status,
        bookUri: bucket.bookUri,
        bookId: bucket.bookId,
        approvedCount: (bucket.approved as unknown[])?.length ?? 0,
        gemsCount: (bucket.gems as unknown[])?.length ?? 0,
      });

      if (bucket.status !== 'staged') {
        return { success: false, error: `Bucket status is ${bucket.status}, expected 'staged'` };
      }

      // Get the book to find the bookId - try both bookUri and bookId
      console.log(`[Harvest] Looking up book by URI: ${bucket.bookUri}`);
      let book = db.getBook(bucket.bookUri as string);
      if (!book && bucket.bookId) {
        console.log(`[Harvest] URI lookup failed, trying ID: ${bucket.bookId}`);
        book = db.getBook(bucket.bookId as string);
      }
      if (!book) {
        console.error(`[Harvest] Book not found. Tried URI=${bucket.bookUri}, ID=${bucket.bookId}`);
        return { success: false, error: `Book not found: ${bucket.bookUri} (also tried ID: ${bucket.bookId})` };
      }
      console.log(`[Harvest] Found book: ${book.id} (${book.name})`)

      const approved = (bucket.approved as Record<string, unknown>[]) || [];
      const gems = (bucket.gems as Record<string, unknown>[]) || [];
      const allPassages = [...approved, ...gems];

      let passageCount = 0;
      for (const passage of allPassages) {
        const curationStatus = (gems.some(g => g.id === passage.id)) ? 'gem' : 'approved';
        db.upsertBookPassage({
          id: passage.id as string,
          bookId: book.id as string,
          sourceRef: passage.sourceRef,
          text: (passage.text || passage.content || '') as string,
          wordCount: passage.wordCount as number | undefined,
          role: passage.role as string | undefined,
          harvestedBy: passage.harvestedBy as string | undefined,
          threadId: passage.threadId as string | undefined,
          curationStatus,
          curationNote: (passage.curation as Record<string, unknown>)?.notes as string | undefined,
          tags: passage.tags as string[] | undefined,
        });
        passageCount++;
      }

      bucket.status = 'committed';
      bucket.finalizedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);

      console.log(`[Harvest] Committed ${passageCount} passages from bucket ${bucketId} to book ${book.id}`);
      return { success: true, passageCount };
    } catch (err) {
      console.error('[Harvest] commit-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:harvest:discard-bucket', (_e, bucketId: string) => {
    try {
      const db = ensureDb();
      const bucket = db.getHarvestBucket(bucketId);
      if (!bucket) {
        return { success: false, error: `Bucket not found: ${bucketId}` };
      }

      bucket.status = 'discarded';
      bucket.finalizedAt = Date.now();
      db.upsertHarvestBucket(bucket as Parameters<typeof db.upsertHarvestBucket>[0]);
      return { success: true };
    } catch (err) {
      console.error('[Harvest] discard-bucket error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // NARRATIVE ARC OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:narrative-arc:list', (_e, bookUri: string) => {
    const db = ensureDb();
    return db.getNarrativeArcsForBook(bookUri);
  });

  ipcMain.handle('xanadu:narrative-arc:get', (_e, id: string) => {
    const db = ensureDb();
    return db.getNarrativeArc(id);
  });

  ipcMain.handle('xanadu:narrative-arc:upsert', (_e, arc: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertNarrativeArc(arc as Parameters<typeof db.upsertNarrativeArc>[0]);
    return { success: true, id: arc.id };
  });

  ipcMain.handle('xanadu:narrative-arc:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deleteNarrativeArc(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE LINK OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:passage-link:list-by-chapter', (_e, chapterId: string) => {
    const db = ensureDb();
    return db.getPassageLinksForChapter(chapterId);
  });

  ipcMain.handle('xanadu:passage-link:list-by-passage', (_e, passageId: string) => {
    const db = ensureDb();
    return db.getPassageLinksForPassage(passageId);
  });

  ipcMain.handle('xanadu:passage-link:upsert', (_e, link: Record<string, unknown>) => {
    const db = ensureDb();
    db.upsertPassageLink(link as Parameters<typeof db.upsertPassageLink>[0]);
    return { success: true, id: link.id };
  });

  ipcMain.handle('xanadu:passage-link:delete', (_e, id: string) => {
    const db = ensureDb();
    db.deletePassageLink(id);
    return { success: true };
  });

  // ─────────────────────────────────────────────────────────────────
  // PASSAGE ANALYSIS (Composite analysis for curation)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:analyze:passage', async (
    _e,
    passageId: string,
    text: string,
    config?: {
      bookId?: string;
      bookTheme?: string;
      enableQuantum?: boolean;
      enableAiDetection?: boolean;
      enableResonance?: boolean;
      model?: 'local' | 'cloud';
    }
  ) => {
    try {
      // Dynamic import to avoid circular dependencies
      const { analyzePassage } = await import('./services/passage-analyzer');
      const db = ensureDb();

      // Get book theme if bookId provided
      let bookTheme = config?.bookTheme;
      if (!bookTheme && config?.bookId) {
        const book = db.getBook(config.bookId);
        if (book) {
          bookTheme = `${book.name} ${book.description || ''}`;
        }
      }

      const result = await analyzePassage(passageId, text, { ...config, bookTheme }, db);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Analysis] passage error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:analyze:passages', async (
    _e,
    passages: Array<{ id: string; text: string }>,
    config?: {
      bookId?: string;
      bookTheme?: string;
      enableQuantum?: boolean;
      enableAiDetection?: boolean;
      enableResonance?: boolean;
      model?: 'local' | 'cloud';
    }
  ) => {
    try {
      const { analyzePassages } = await import('./services/passage-analyzer');
      const db = ensureDb();

      // Get book theme if bookId provided
      let bookTheme = config?.bookTheme;
      if (!bookTheme && config?.bookId) {
        const book = db.getBook(config.bookId);
        if (book) {
          bookTheme = `${book.name} ${book.description || ''}`;
        }
      }

      const results = await analyzePassages(passages, { ...config, bookTheme }, db);
      return { success: true, analyses: results };
    } catch (err) {
      console.error('[Analysis] passages error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // CHEKHOV ANALYSIS (Narrative necessity)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:chekhov:analyze-document', async (_e, documentId: string, text: string) => {
    try {
      const { analyzeDocument } = await import('./services/chekhov-analyzer');
      const result = analyzeDocument(documentId, text);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Chekhov] analyze-document error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:chekhov:analyze-sentence', async (_e, sentenceId: string, sentence: string, context?: string[]) => {
    try {
      const { analyzeSentence } = await import('./services/chekhov-analyzer');
      const result = analyzeSentence(sentenceId, sentence, context);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Chekhov] analyze-sentence error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SENTIMENT TRACKING (Emotional trajectory)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:sentiment:analyze-trajectory', async (_e, documentId: string, text: string) => {
    try {
      const { analyzeTrajectory } = await import('./services/sentiment-tracker');
      const result = analyzeTrajectory(documentId, text);
      return { success: true, trajectory: result };
    } catch (err) {
      console.error('[Sentiment] analyze-trajectory error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:sentiment:analyze-sentence', async (_e, sentenceId: string, sentence: string) => {
    try {
      const { analyzeSentence } = await import('./services/sentiment-tracker');
      const result = analyzeSentence(sentenceId, sentence);
      return { success: true, analysis: result };
    } catch (err) {
      console.error('[Sentiment] analyze-sentence error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // MODEL ROUTER (Local/Cloud model selection)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:model:list-available', async () => {
    try {
      const { getModelRouter } = await import('./services/model-router');
      const router = getModelRouter();
      const models = await router.listAvailableModels();
      return { success: true, models };
    } catch (err) {
      console.error('[Model] list-available error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:model:generate', async (
    _e,
    request: {
      prompt: string;
      maxTokens?: number;
      temperature?: number;
      taskType?: 'quick-analysis' | 'deep-analysis' | 'draft' | 'final';
      systemPrompt?: string;
    }
  ) => {
    try {
      const { getModelRouter } = await import('./services/model-router');
      const router = getModelRouter();
      const result = await router.generate(request);
      return result;
    } catch (err) {
      console.error('[Model] generate error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: 0 };
    }
  });

  ipcMain.handle('xanadu:model:configure', async (
    _e,
    config: {
      preference: 'local-only' | 'cloud-when-needed' | 'cloud-preferred';
      anthropicApiKey?: string;
      cloudflareAccountId?: string;
      cloudflareApiToken?: string;
    }
  ) => {
    try {
      const { configureModelRouter } = await import('./services/model-router');
      configureModelRouter(config);
      return { success: true };
    } catch (err) {
      console.error('[Model] configure error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // BOOK PROPOSAL (Intelligent book assembly)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:book:generate-proposal', async (
    _e,
    sources: Array<{ id: string; text: string; metadata?: { sourceRef?: string; timestamp?: number; author?: string } }>,
    bookTheme?: string
  ) => {
    try {
      const { generateProposal } = await import('./services/book-proposal');
      const proposal = await generateProposal(sources, bookTheme);
      return { success: true, proposal };
    } catch (err) {
      console.error('[BookProposal] generate-proposal error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  ipcMain.handle('xanadu:book:generate-draft', async (
    _e,
    proposal: Record<string, unknown>,
    sources: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>,
    config: {
      selectedArcIndex: number;
      selectedStyleIndex: number;
      additionalGuidance?: string;
      modelTier?: 'local' | 'balanced' | 'quality';
    }
  ) => {
    try {
      const { generateDraft } = await import('./services/book-proposal');
      const result = await generateDraft(proposal as unknown as Parameters<typeof generateDraft>[0], sources, config);
      return result;
    } catch (err) {
      console.error('[BookProposal] generate-draft error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // SEED LIBRARY DATA (First Run)
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle('xanadu:seed-library', async () => {
    // Wait for services to be ready (handles race condition on startup)
    const ready = await waitForServices(15000); // 15 second timeout
    if (!ready) {
      console.warn('[Xanadu] Timed out waiting for services to initialize');
      return { success: false, error: 'Services not ready after 15s timeout' };
    }

    const db = ensureDb();

    // Check if library already seeded (look for a known library persona)
    const existingPersona = db.getPersona('persona://tem-noon/marginalia-voice');
    if (existingPersona) {
      console.log('[Xanadu] Library already seeded');
      return { success: true, alreadySeeded: true };
    }

    console.log('[Xanadu] Seeding library data...');

    // Import library data from BookshelfService pattern
    // NOTE: In production, this would read from the LIBRARY_* constants
    // For now we import them dynamically to avoid circular deps

    try {
      // Seed library personas (createdAt/updatedAt generated by upsert)
      const libraryPersonas = await import('./xanadu/library-seed').then(m => m.LIBRARY_PERSONAS);
      for (const persona of libraryPersonas) {
        db.upsertPersona({
          id: persona.id,
          uri: persona.uri,
          name: persona.name,
          description: persona.description,
          author: persona.author,
          voice: persona.voice,
          vocabulary: persona.vocabulary,
          derivedFrom: persona.derivedFrom,
          influences: persona.influences,
          exemplars: persona.exemplars,
          systemPrompt: persona.systemPrompt,
          tags: persona.tags,
          isLibrary: true,
        });
      }

      // Seed library styles (createdAt/updatedAt generated by upsert)
      const libraryStyles = await import('./xanadu/library-seed').then(m => m.LIBRARY_STYLES);
      for (const style of libraryStyles) {
        db.upsertStyle({
          id: style.id,
          uri: style.uri,
          name: style.name,
          description: style.description,
          author: style.author,
          characteristics: style.characteristics,
          structure: style.structure,
          stylePrompt: style.stylePrompt,
          derivedFrom: style.derivedFrom,
          tags: style.tags,
          isLibrary: true,
        });
      }

      // Seed library books (createdAt/updatedAt generated by upsert)
      const libraryBooks = await import('./xanadu/library-seed').then(m => m.LIBRARY_BOOKS);
      for (const book of libraryBooks) {
        db.upsertBook({
          id: book.id,
          uri: book.uri,
          name: book.name,
          subtitle: book.subtitle,
          description: book.description,
          author: book.author,
          status: book.status,
          personaRefs: book.personaRefs,
          styleRefs: book.styleRefs,
          sourceRefs: book.sourceRefs,
          threads: book.threads,
          harvestConfig: book.harvestConfig,
          editorial: book.editorial,
          stats: book.stats,
          tags: book.tags,
          isLibrary: true,
        });
      }

      console.log('[Xanadu] Library seed complete');
      return { success: true, alreadySeeded: false };
    } catch (err) {
      console.error('[Xanadu] Failed to seed library:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });

  console.log('Xanadu unified storage IPC handlers registered');
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
  registerXanaduHandlers();

  // Always start npe-local server for AI detection and transformations
  await startNpeLocal();

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
  stopArchiveServer();
  stopNpeLocal();
  closeChatService();
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
