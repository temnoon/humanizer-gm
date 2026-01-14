/**
 * DatabaseOperations - Base class for EmbeddingDatabase operation modules
 *
 * Provides common utilities and database access for all operation modules.
 */

import type Database from 'better-sqlite3';

/**
 * Base class for database operation modules
 * Each module receives the db instance and vecLoaded flag from EmbeddingDatabase
 */
export abstract class DatabaseOperations {
  protected db: Database.Database;
  protected vecLoaded: boolean;

  constructor(db: Database.Database, vecLoaded: boolean) {
    this.db = db;
    this.vecLoaded = vecLoaded;
  }

  /**
   * Convert embedding array to JSON string for storage
   */
  protected embeddingToJson(embedding: number[]): string {
    return JSON.stringify(embedding);
  }

  /**
   * Convert binary buffer or JSON string to embedding array
   */
  protected embeddingFromBinary(data: Buffer | string): number[] {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    // Binary format: Float32Array
    const floatArray = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
    return Array.from(floatArray);
  }

  /**
   * Parse JSON field safely, returning default if null/invalid
   */
  protected parseJsonField<T>(data: string | null, defaultValue: T): T {
    if (!data) return defaultValue;
    try {
      return JSON.parse(data) as T;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Stringify value for JSON storage, returns null if value is null/undefined
   */
  protected toJsonString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return JSON.stringify(value);
  }
}
