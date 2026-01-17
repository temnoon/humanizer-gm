/**
 * Book Studio Server Module
 *
 * Embedded Express server for Book Studio API.
 * Provides REST endpoints for books, chapters, cards, clusters, and outlines,
 * plus WebSocket for real-time events.
 *
 * Usage in Electron main:
 *   import { startBookStudioServer, stopBookStudioServer } from './book-studio-server';
 *
 *   app.whenReady().then(async () => {
 *     const serverUrl = await startBookStudioServer();
 *     console.log('Book Studio server:', serverUrl);
 *   });
 *
 *   app.on('will-quit', async () => {
 *     await stopBookStudioServer();
 *   });
 */

export {
  startServer as startBookStudioServer,
  stopServer as stopBookStudioServer,
  isServerRunning as isBookStudioServerRunning,
  getApp as getBookStudioApp,
  getWss as getBookStudioWss,
  broadcastEvent,
  getConfig,
  type BookEvent,
} from './server';

// Re-export database utilities
export {
  getDatabase,
  closeDatabase,
  generateId,
  now,
  type DbBook,
  type DbChapter,
  type DbCard,
  type DbCluster,
  type DbOutline,
  type DbEvent,
} from './database';

// Re-export config
export {
  initConfig,
  getDataPath,
  getDbPath,
  type BookStudioConfig,
} from './config';
