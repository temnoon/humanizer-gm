/**
 * Usage Tracker Service
 *
 * Persists LLM usage data to disk and syncs with NPE-API for cloud billing.
 * Wraps the in-memory cost-tracker with disk persistence.
 */

import Store from 'electron-store';
import {
  getAllRecords,
  loadRecords,
  recordUsage as recordUsageInMemory,
  type UsageRecord,
  getDailyUsage,
  getMonthlyUsage,
  getProjectedMonthlyCost,
} from '../npe-local/services/llm/cost-tracker';
import type { ProviderType } from '../npe-local/services/llm/types';

// Store schema for usage data
interface UsageStore {
  records: UsageRecord[];
  lastSync: number | null;
  syncQueue: UsageRecord[];
}

const store = new Store<UsageStore>({
  name: 'usage-tracking',
  defaults: {
    records: [],
    lastSync: null,
    syncQueue: [],
  },
});

// NPE-API endpoint for usage sync
const NPE_API_URL = process.env.NPE_API_URL || 'https://npe-api.tem-527.workers.dev';

// Sync interval (every 5 minutes)
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Maximum records to sync in one batch
const SYNC_BATCH_SIZE = 100;

let syncIntervalId: NodeJS.Timeout | null = null;
let isInitialized = false;

/**
 * Initialize the usage tracker - load from disk and start sync timer
 */
export function initUsageTracker(): void {
  if (isInitialized) return;

  // Load records from disk
  const storedRecords = store.get('records', []);
  if (storedRecords.length > 0) {
    loadRecords(storedRecords);
    console.log(`[UsageTracker] Loaded ${storedRecords.length} records from disk`);
  }

  // Start sync timer
  syncIntervalId = setInterval(() => {
    syncWithAPI().catch(err => {
      console.error('[UsageTracker] Sync failed:', err);
    });
  }, SYNC_INTERVAL_MS);

  isInitialized = true;
  console.log('[UsageTracker] Initialized');
}

/**
 * Shutdown the usage tracker - save and stop timers
 */
export function shutdownUsageTracker(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  // Final save
  persistToDisk();

  // Try one last sync
  syncWithAPI().catch(() => {
    // Ignore errors on shutdown
  });

  isInitialized = false;
  console.log('[UsageTracker] Shutdown complete');
}

/**
 * Record usage - wraps in-memory tracker and persists
 */
export function recordUsage(
  provider: ProviderType,
  model: string,
  inputTokens: number,
  outputTokens: number,
  success: boolean = true
): UsageRecord {
  // Record in memory
  const record = recordUsageInMemory(provider, model, inputTokens, outputTokens, success);

  // Add to sync queue
  const syncQueue = store.get('syncQueue', []);
  syncQueue.push(record);
  store.set('syncQueue', syncQueue);

  // Persist all records to disk
  persistToDisk();

  return record;
}

/**
 * Persist current records to disk
 */
function persistToDisk(): void {
  const records = getAllRecords();
  store.set('records', records);
}

/**
 * Sync usage data with NPE-API
 */
export async function syncWithAPI(authToken?: string): Promise<{ synced: number; failed: number }> {
  const syncQueue = store.get('syncQueue', []);

  if (syncQueue.length === 0) {
    return { synced: 0, failed: 0 };
  }

  // Get token from argument or environment
  const token = authToken || process.env.NPE_AUTH_TOKEN;

  if (!token) {
    // No token, keep records in queue for later
    console.log('[UsageTracker] No auth token available, skipping sync');
    return { synced: 0, failed: syncQueue.length };
  }

  // Batch sync
  const batch = syncQueue.slice(0, SYNC_BATCH_SIZE);
  let synced = 0;
  let failed = 0;

  try {
    const response = await fetch(`${NPE_API_URL}/api/usage/record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        records: batch.map(r => ({
          timestamp: r.timestamp,
          provider: r.provider,
          model: r.model,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          estimatedCost: r.estimatedCost,
          success: r.success,
        })),
      }),
    });

    if (response.ok) {
      // Remove synced records from queue
      const remainingQueue = syncQueue.slice(batch.length);
      store.set('syncQueue', remainingQueue);
      store.set('lastSync', Date.now());
      synced = batch.length;
      console.log(`[UsageTracker] Synced ${synced} records to NPE-API`);
    } else {
      const error = await response.text();
      console.error(`[UsageTracker] Sync failed: ${response.status} - ${error}`);
      failed = batch.length;
    }
  } catch (err) {
    console.error('[UsageTracker] Sync error:', err);
    failed = batch.length;
  }

  return { synced, failed };
}

/**
 * Get current usage statistics
 */
export function getUsageStats(): {
  daily: ReturnType<typeof getDailyUsage>;
  monthly: ReturnType<typeof getMonthlyUsage>;
  projected: number;
  lastSync: number | null;
  pendingSync: number;
} {
  return {
    daily: getDailyUsage(),
    monthly: getMonthlyUsage(),
    projected: getProjectedMonthlyCost(),
    lastSync: store.get('lastSync', null),
    pendingSync: store.get('syncQueue', []).length,
  };
}

/**
 * Get remote usage metrics from NPE-API
 * (includes usage across all devices)
 */
export async function getRemoteUsageMetrics(authToken: string): Promise<{
  currentMonth: {
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    requests: number;
  };
  quota: {
    limit: number;
    used: number;
    remaining: number;
  };
  tier: string;
} | null> {
  try {
    const response = await fetch(`${NPE_API_URL}/api/usage/metrics`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error('[UsageTracker] Failed to fetch remote metrics:', err);
    return null;
  }
}

/**
 * Clear local usage data (for testing/reset)
 */
export function clearLocalUsage(): void {
  store.set('records', []);
  store.set('syncQueue', []);
  loadRecords([]);
  console.log('[UsageTracker] Local usage data cleared');
}

/**
 * Export usage data for backup
 */
export function exportUsageData(): {
  records: UsageRecord[];
  exportedAt: number;
  version: string;
} {
  return {
    records: getAllRecords(),
    exportedAt: Date.now(),
    version: '1.0.0',
  };
}

/**
 * Import usage data from backup
 */
export function importUsageData(data: { records: UsageRecord[] }): number {
  if (!Array.isArray(data.records)) {
    throw new Error('Invalid usage data format');
  }

  // Merge with existing records (dedupe by timestamp)
  const existing = getAllRecords();
  const existingTimestamps = new Set(existing.map(r => r.timestamp));

  const newRecords = data.records.filter(r => !existingTimestamps.has(r.timestamp));
  const merged = [...existing, ...newRecords].sort((a, b) => a.timestamp - b.timestamp);

  loadRecords(merged);
  persistToDisk();

  console.log(`[UsageTracker] Imported ${newRecords.length} new records`);
  return newRecords.length;
}
