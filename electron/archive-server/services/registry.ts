/**
 * Service Registry - Singleton pattern for shared service instances
 *
 * Provides lazy initialization and centralized management of database
 * connections. Call resetServices() when switching archives.
 */

import { EmbeddingDatabase } from './embeddings/EmbeddingDatabase';
import { MediaItemsDatabase } from './facebook/MediaItemsDatabase';
import { getArchiveRoot } from '../config';

// Service instances (lazy-initialized)
let embeddingDb: EmbeddingDatabase | null = null;
let mediaDb: MediaItemsDatabase | null = null;

/**
 * Get the embedding database instance (creates if needed)
 */
export function getEmbeddingDatabase(): EmbeddingDatabase {
  if (!embeddingDb) {
    const root = getArchiveRoot();
    console.log('[service-registry] Creating EmbeddingDatabase for:', root);
    embeddingDb = new EmbeddingDatabase(root);
  }
  return embeddingDb;
}

/**
 * Get the media items database instance (creates if needed)
 */
export function getMediaItemsDatabase(): MediaItemsDatabase {
  if (!mediaDb) {
    const root = getArchiveRoot();
    console.log('[service-registry] Creating MediaItemsDatabase for:', root);
    mediaDb = new MediaItemsDatabase(root);
  }
  return mediaDb;
}

/**
 * Check if services are initialized
 */
export function areServicesInitialized(): boolean {
  return embeddingDb !== null || mediaDb !== null;
}

/**
 * Wait for services to be initialized (with timeout)
 * Useful for IPC handlers that may be called before archive server starts
 */
export async function waitForServices(timeoutMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100; // Check every 100ms

  while (Date.now() - startTime < timeoutMs) {
    if (areServicesInitialized()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return false; // Timed out
}

/**
 * Reset all service instances when archive switches
 * Call this before switching archive paths
 */
export function resetServices(): void {
  console.log('[service-registry] Resetting service instances');

  if (embeddingDb) {
    try {
      embeddingDb.close();
    } catch (err) {
      console.error('[service-registry] Error closing EmbeddingDatabase:', err);
    }
    embeddingDb = null;
  }

  if (mediaDb) {
    try {
      mediaDb.close();
    } catch (err) {
      console.error('[service-registry] Error closing MediaItemsDatabase:', err);
    }
    mediaDb = null;
  }
}

// Re-export service classes for convenience
export { EmbeddingDatabase, MediaItemsDatabase };
