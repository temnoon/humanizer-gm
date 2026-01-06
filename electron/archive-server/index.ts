/**
 * Archive Server Module
 *
 * Embedded Express server for archive browsing, embeddings,
 * and all local archive functionality.
 *
 * Usage in Electron main:
 *   import { startArchiveServer, stopArchiveServer } from './archive-server';
 *
 *   app.whenReady().then(async () => {
 *     const serverUrl = await startArchiveServer();
 *     console.log('Archive server:', serverUrl);
 *   });
 */

export {
  startServer as startArchiveServer,
  stopServer as stopArchiveServer,
  isServerRunning as isArchiveServerRunning,
  getApp as getArchiveApp,
  getConfig,
  getArchiveRoot,
  setArchivePath,
  PATHS,
} from './server';

// Re-export route utilities
export { buildConversationIndex, getConversationsFromIndex } from './routes/archives';

// Re-export service registry for unified storage access (Xanadu)
export {
  getEmbeddingDatabase,
  resetServices,
  areServicesInitialized,
  waitForServices,
} from './services/registry';
