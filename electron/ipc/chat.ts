/**
 * Chat Service IPC Handlers
 *
 * Handles conversation management, message sending, and chat history.
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { getChatService, type ChatServiceConfig, type SendMessageOptions } from '../chat';

// Store reference for the chat service (singleton within this module)
let chatService: ReturnType<typeof getChatService> | null = null;

/**
 * Initialize and register all Chat Service IPC handlers
 * @param config - Configuration options
 */
export function registerChatHandlers(config: {
  getMainWindow: () => BrowserWindow | null;
  getStore: () => { get: (key: string) => unknown };
  getArchiveServerPort: () => number | null;
}) {
  const { getMainWindow, getStore, getArchiveServerPort } = config;
  const store = getStore();

  // Initialize chat service
  const chatDbPath = path.join(app.getPath('userData'), 'chat.db');
  const archiveServerPort = getArchiveServerPort();
  const chatConfig: ChatServiceConfig = {
    dbPath: chatDbPath,
    llm: {
      provider: 'ollama',
      model: (store.get('ollamaModel') as string) || 'qwen3:14b',
      baseUrl: 'http://localhost:11434',
    },
    archiveUrl: archiveServerPort ? `http://localhost:${archiveServerPort}` : undefined,
    autoArchive: true,
  };

  chatService = getChatService(chatConfig);

  // Forward chat events to renderer
  chatService.on('message:created', (event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:message', event);
    }
  });

  chatService.on('tool:executed', (event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:tool-executed', event);
    }
  });

  chatService.on('error', (event) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:error', event);
    }
  });

  // Chat IPC handlers
  ipcMain.handle('chat:start-conversation', (_e, options?: { projectId?: string; tags?: string[] }) => {
    return chatService!.startConversation(options);
  });

  ipcMain.handle('chat:get-conversation', () => {
    return chatService!.getCurrentConversation();
  });

  ipcMain.handle('chat:load-conversation', (_e, id: string) => {
    return chatService!.loadConversation(id);
  });

  ipcMain.handle('chat:list-conversations', (_e, options?: { limit?: number; projectId?: string }) => {
    return chatService!.listConversations(options);
  });

  ipcMain.handle('chat:get-messages', (_e, conversationId?: string) => {
    return chatService!.getMessages(conversationId);
  });

  ipcMain.handle('chat:send-message', async (_e, content: string, options?: SendMessageOptions) => {
    return chatService!.sendMessage(content, options);
  });

  ipcMain.handle('chat:end-conversation', () => {
    chatService!.endConversation();
    return { success: true };
  });

  ipcMain.handle('chat:archive-conversation', async (_e, conversationId: string) => {
    await chatService!.archiveConversation(conversationId);
    return { success: true };
  });

  ipcMain.handle('chat:search-messages', (_e, query: string) => {
    return chatService!.searchMessages(query);
  });

  ipcMain.handle('chat:stats', () => {
    return chatService!.getStats();
  });

  ipcMain.handle('chat:update-config', (_e, updates: Partial<ChatServiceConfig>) => {
    chatService!.updateConfig(updates);
    return { success: true };
  });

  console.log('Chat service initialized');
}
