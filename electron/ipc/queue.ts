/**
 * Queue System IPC Handlers
 *
 * Handles job queue management, job lifecycle, and queue control.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { initQueueManager, type QueueJobSpec, type JobQueryOptions } from '../queue';

/**
 * Initialize and register all Queue System IPC handlers
 * @param config - Configuration options
 */
export function registerQueueHandlers(config: {
  getMainWindow: () => BrowserWindow | null;
  store: unknown; // ElectronStore instance - passed directly for type compatibility
}) {
  const { getMainWindow, store } = config;

  // Initialize queue manager with store for persistence
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queueManager = initQueueManager({ store: store as any });

  // Forward queue events to renderer
  queueManager.onEvent((event) => {
    const mainWindow = getMainWindow();
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

  console.log('Queue system IPC handlers registered');
}
