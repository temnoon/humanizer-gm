/**
 * Storage Utilities
 *
 * Detects storage mode and provides typed access to storage APIs.
 * Extracted from BookshelfContext for modularization.
 */

/**
 * Check if Xanadu (Electron IPC) storage is available
 */
export function isXanaduAvailable(): boolean {
  return typeof window !== 'undefined' &&
    window.isElectron === true &&
    window.electronAPI?.xanadu !== undefined;
}

/**
 * Check if running in development mode with localStorage fallback
 */
export function isDevFallbackEnabled(): boolean {
  return import.meta.env.DEV;
}

/**
 * Get the storage mode description for logging
 */
export function getStorageMode(): 'xanadu' | 'localStorage' | 'unavailable' {
  if (isXanaduAvailable()) return 'xanadu';
  if (isDevFallbackEnabled()) return 'localStorage';
  return 'unavailable';
}

/**
 * Throw error if no storage is available
 */
export function assertStorageAvailable(): void {
  if (!isXanaduAvailable() && !isDevFallbackEnabled()) {
    throw new Error('Xanadu storage unavailable. Run in Electron app.');
  }
}
