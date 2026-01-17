/**
 * Book Studio Server Configuration
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// ============================================================================
// Configuration Types
// ============================================================================

export interface BookStudioConfig {
  port: number;
  dataPath: string;
  dbPath: string;
  wsEnabled: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_PORT = 3004;

let config: BookStudioConfig | null = null;

/**
 * Initialize configuration
 */
export async function initConfig(): Promise<BookStudioConfig> {
  if (config) return config;

  // Get user data directory (Electron app data location)
  const userDataPath = app?.getPath?.('userData') || process.cwd();
  const dataPath = path.join(userDataPath, 'book-studio');
  const dbPath = path.join(dataPath, 'books.db');

  // Ensure data directory exists
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }

  config = {
    port: DEFAULT_PORT,
    dataPath,
    dbPath,
    wsEnabled: true,
  };

  console.log(`[book-studio-server] Config initialized:`);
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Data: ${config.dataPath}`);
  console.log(`  - DB: ${config.dbPath}`);

  return config;
}

/**
 * Get current configuration (must call initConfig first)
 */
export function getConfig(): BookStudioConfig {
  if (!config) {
    throw new Error('Config not initialized. Call initConfig() first.');
  }
  return config;
}

/**
 * Get data path
 */
export function getDataPath(): string {
  return getConfig().dataPath;
}

/**
 * Get database path
 */
export function getDbPath(): string {
  return getConfig().dbPath;
}
