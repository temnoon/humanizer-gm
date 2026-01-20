/**
 * Archive Server Configuration
 *
 * Manages archive paths, settings, and runtime state.
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface ArchiveConfig {
  archivePath: string;
  archiveName: string;
  isCustomPath: boolean;
}

export interface ServerConfig {
  port: number;
  archiveConfig: ArchiveConfig;
  sessionStorageDir: string;
  configFilePath: string;
}

// Default paths
const HUMANIZER_DIR = path.join(os.homedir(), '.humanizer');
const ARCHIVE_CONFIG_FILE = path.join(HUMANIZER_DIR, 'archive-config.json');
const SESSION_STORAGE_DIR = path.join(HUMANIZER_DIR, 'sessions');
const ARCHIVE_UPLOADS_DIR = path.join(os.tmpdir(), 'archive-uploads');
const MEDIA_STORAGE_DIR = path.join(HUMANIZER_DIR, 'media');

// Default archive settings (can be overridden by env or runtime)
// First check environment, then fall back to ~/.humanizer/archives
const DEFAULT_ARCHIVES_BASE = process.env.HUMANIZER_ARCHIVES_BASE || path.join(HUMANIZER_DIR, 'archives');
const DEFAULT_ARCHIVE_NAME = process.env.HUMANIZER_DEFAULT_ARCHIVE || 'default';

// Runtime state
let currentConfig: ServerConfig | null = null;

/**
 * Initialize configuration from environment and persisted settings
 */
export async function initConfig(): Promise<ServerConfig> {
  // Check for Electron/custom archive path (full path to specific archive)
  const customPath = process.env.ARCHIVE_PATH;
  const isCustomPath = !!customPath;

  let archivePath: string;
  let archiveName: string;

  if (isCustomPath) {
    archivePath = customPath;
    archiveName = path.basename(customPath);
    console.log(`[archive-server] Custom archive mode: ${archivePath}`);
  } else {
    // Load from persisted config or use defaults
    const persisted = await loadPersistedConfig();

    // Determine base path: env var > persisted > default
    const basePath = process.env.HUMANIZER_ARCHIVES_BASE ||
                     persisted?.archiveBasePath ||
                     DEFAULT_ARCHIVES_BASE;

    archiveName = persisted?.currentArchive || DEFAULT_ARCHIVE_NAME;
    archivePath = path.join(basePath, archiveName);

    // Verify path exists
    try {
      await fs.access(archivePath);
      console.log(`[archive-server] Using archive: ${archivePath}`);
    } catch {
      console.warn(`[archive-server] Archive "${archivePath}" not found`);
      // Try to find any archive in the base path
      try {
        const entries = await fs.readdir(basePath, { withFileTypes: true });
        const archives = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
        if (archives.length > 0) {
          archiveName = archives[0].name;
          archivePath = path.join(basePath, archiveName);
          console.log(`[archive-server] Auto-selected archive: ${archivePath}`);
        } else {
          // Create empty default archive
          archivePath = path.join(basePath, DEFAULT_ARCHIVE_NAME);
          await fs.mkdir(archivePath, { recursive: true });
          console.log(`[archive-server] Created empty archive: ${archivePath}`);
        }
      } catch (err) {
        // Base path doesn't exist, create it with empty archive
        archivePath = path.join(basePath, DEFAULT_ARCHIVE_NAME);
        await fs.mkdir(archivePath, { recursive: true });
        console.log(`[archive-server] Created archives directory: ${archivePath}`);
      }
    }
  }

  // Ensure directories exist
  await fs.mkdir(HUMANIZER_DIR, { recursive: true });
  await fs.mkdir(SESSION_STORAGE_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_UPLOADS_DIR, { recursive: true });
  await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });

  currentConfig = {
    port: parseInt(process.env.ARCHIVE_SERVER_PORT || '3002', 10),
    archiveConfig: {
      archivePath,
      archiveName,
      isCustomPath,
    },
    sessionStorageDir: SESSION_STORAGE_DIR,
    configFilePath: ARCHIVE_CONFIG_FILE,
  };

  return currentConfig;
}

/**
 * Get current configuration (must call initConfig first)
 */
export function getConfig(): ServerConfig {
  if (!currentConfig) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return currentConfig;
}

/**
 * Update archive path at runtime
 */
export async function setArchivePath(archiveName: string): Promise<void> {
  if (!currentConfig) {
    throw new Error('Config not initialized');
  }

  if (currentConfig.archiveConfig.isCustomPath) {
    throw new Error('Cannot change archive in custom path mode');
  }

  const newPath = path.join(DEFAULT_ARCHIVES_BASE, archiveName);

  // Verify path exists
  await fs.access(newPath);

  currentConfig.archiveConfig.archivePath = newPath;
  currentConfig.archiveConfig.archiveName = archiveName;

  // Persist to disk
  await savePersistedConfig({ currentArchive: archiveName });
}

/**
 * Get archive root path
 */
export function getArchiveRoot(): string {
  return getConfig().archiveConfig.archivePath;
}

/**
 * Get media storage path (managed folder for imported media blobs)
 */
export function getMediaStoragePath(): string {
  return MEDIA_STORAGE_DIR;
}

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE HELPERS
// ═══════════════════════════════════════════════════════════════════

interface PersistedConfig {
  currentArchive?: string;
  archiveBasePath?: string;
  lastSwitched?: string;
}

async function loadPersistedConfig(): Promise<PersistedConfig | null> {
  try {
    const data = await fs.readFile(ARCHIVE_CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function savePersistedConfig(config: PersistedConfig): Promise<void> {
  try {
    await fs.mkdir(path.dirname(ARCHIVE_CONFIG_FILE), { recursive: true });
    await fs.writeFile(ARCHIVE_CONFIG_FILE, JSON.stringify({
      ...config,
      lastSwitched: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    console.error('[archive-server] Failed to save config:', err);
  }
}

// Export constants
export const PATHS = {
  HUMANIZER_DIR,
  SESSION_STORAGE_DIR,
  ARCHIVE_UPLOADS_DIR,
  ARCHIVE_CONFIG_FILE,
  DEFAULT_ARCHIVES_BASE,
  MEDIA_STORAGE_DIR,
};
