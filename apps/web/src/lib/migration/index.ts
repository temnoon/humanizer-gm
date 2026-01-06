/**
 * Migration Module
 *
 * Handles migration from localStorage to Xanadu unified storage.
 */

export {
  migrateToUnifiedStorage,
  isMigrationComplete,
  markMigrationComplete,
  hasDataToMigrate,
  type MigrationResult,
} from './LocalStorageMigration';
