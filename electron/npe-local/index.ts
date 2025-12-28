/**
 * NPE-Local Module
 *
 * Embedded server for local NPE API operations.
 * Provides AI detection, humanization, and LLM chat endpoints.
 *
 * Usage in Electron main:
 *   import { startNpeLocalServer, stopNpeLocalServer } from './npe-local';
 *
 *   app.whenReady().then(async () => {
 *     const serverUrl = await startNpeLocalServer();
 *     console.log('NPE-Local server:', serverUrl);
 *   });
 */

export {
  startServer as startNpeLocalServer,
  stopServer as stopNpeLocalServer,
  isServerRunning as isNpeLocalServerRunning,
  getPort as getNpeLocalPort,
  getApp as getNpeLocalApp,
  type NpeLocalConfig,
} from './server';

// Re-export services for direct use
export * from './services/llm';
export * from './services/detection';
export { humanizeText, analyzeForHumanization } from './services/transformation/humanizer';
