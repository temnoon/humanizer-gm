/**
 * Platform Detection
 *
 * Detects whether running in Electron, web browser, mobile, etc.
 */

// Check if running in Electron
export const isElectron = typeof window !== 'undefined' && !!(window as any).isElectron;

// Check if electronAPI is available
export const hasElectronAPI = typeof window !== 'undefined' && !!(window as any).electronAPI;

// Get the Electron API (typed)
export function getElectronAPI() {
  if (!hasElectronAPI) return null;
  return (window as any).electronAPI as ElectronAPI;
}

// Platform type
export type Platform = 'electron-mac' | 'electron-win' | 'electron-linux' | 'web' | 'mobile';

export function getPlatform(): Platform {
  if (!isElectron) {
    // Check for mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    return isMobile ? 'mobile' : 'web';
  }

  // In Electron, check process.platform via API
  const api = getElectronAPI();
  if (api) {
    // This would need to be called async, so for sync check:
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('mac')) return 'electron-mac';
    if (platform.includes('win')) return 'electron-win';
    return 'electron-linux';
  }

  return 'web';
}

// Type definitions for Electron API
export interface ElectronAPI {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
  };
  app: {
    paths: () => Promise<{ documents: string; userData: string; home: string; temp: string }>;
    info: () => Promise<{ platform: string; arch: string; version: string; isPackaged: boolean }>;
    isFirstRun: () => Promise<boolean>;
    completeFirstRun: () => Promise<boolean>;
  };
  dialog: {
    selectFolder: () => Promise<string | null>;
    selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
  };
  archive: {
    port: () => Promise<number | null>;
    enabled: () => Promise<boolean>;
    enable: (archivePath?: string) => Promise<{ success: boolean; port?: number }>;
    disable: () => Promise<{ success: boolean }>;
    restart: (newPath?: string) => Promise<{ success: boolean; port?: number }>;
  };
  ollama: {
    enabled: () => Promise<boolean>;
    enable: () => Promise<boolean>;
    disable: () => Promise<boolean>;
    status: () => Promise<{ installed: boolean; running: boolean }>;
  };
  npe: {
    port: () => Promise<number | null>;
    status: () => Promise<NpeStatus>;
  };
  cloudDrives: CloudDrivesAPI;
}

export interface NpeStatus {
  running: boolean;
  port: number | null;
  service?: string;
  version?: string;
  ollama?: { available: boolean; url: string };
}

/**
 * Get NPE-Local API base URL (when in Electron)
 */
export async function getNpeLocalUrl(): Promise<string | null> {
  const api = getElectronAPI();
  if (!api) return null;

  const port = await api.npe.port();
  if (!port) return null;

  return `http://localhost:${port}`;
}

/**
 * Check if NPE-Local is available
 */
export async function isNpeLocalAvailable(): Promise<boolean> {
  const api = getElectronAPI();
  if (!api) return false;

  const status = await api.npe.status();
  return status.running;
}

export interface CloudDrivesAPI {
  listDrives: () => Promise<CloudDrive[]>;
  google: {
    connect: () => Promise<{ success: boolean; error?: string }>;
    isConnected: () => Promise<boolean>;
    disconnect: () => Promise<{ success: boolean }>;
    list: (folderId?: string, pageToken?: string) => Promise<CloudListResult>;
    search: (query: string, pageToken?: string) => Promise<CloudListResult>;
    download: (fileId: string) => Promise<{ success: boolean; content?: ArrayBuffer; error?: string }>;
  };
}

export interface CloudDrive {
  id: string;
  provider: 'google' | 'dropbox' | 'onedrive' | 's3';
  name: string;
  icon: string;
}

export interface CloudFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  isFolder: boolean;
}

export interface CloudListResult {
  success: boolean;
  files?: CloudFile[];
  nextPageToken?: string;
  error?: string;
}
