/**
 * AI Config IPC Handlers
 *
 * Provides secure IPC handlers for API key management and AI configuration.
 * All handlers use secure storage for API keys.
 */

import { ipcMain } from 'electron';
import {
  getSecureStorage,
  initSecureStorage,
  getAdminConfig,
} from '../ai-control';
import type { AIProviderType } from '../ai-control';
import {
  setAPIKeys,
  getModelConfig,
  setModelConfig,
  getDailyUsage,
  getMonthlyUsage,
  getProjectedMonthlyCost,
  formatCost,
  formatTokens,
  getProviderHealth,
} from '../npe-local/services/llm';
import {
  getUsageStats,
  syncWithAPI,
  getRemoteUsageMetrics,
  clearLocalUsage,
  exportUsageData,
  importUsageData,
} from '../services/usage-tracker';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  encrypted: boolean;
  enabled: boolean;
  endpoint?: string;
  health?: {
    available: boolean;
    failCount: number;
    cooldownRemaining: number;
  };
}

export interface UsageStats {
  daily: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    successRate: number;
    formatted: {
      tokens: string;
      cost: string;
    };
  };
  monthly: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
    successRate: number;
    formatted: {
      tokens: string;
      cost: string;
    };
  };
  projected: {
    monthlyCost: number;
    formatted: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Register AI config IPC handlers
 */
export function registerAIConfigHandlers(): void {
  console.log('[ai-config] Registering IPC handlers');

  // Initialize secure storage when registering handlers
  initSecureStorage().catch(console.error);

  // ─────────────────────────────────────────────────────────────────
  // API Key Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get status of all providers
   */
  ipcMain.handle('ai-config:get-providers', async (): Promise<ProviderStatus[]> => {
    try {
      const secureStorage = getSecureStorage();
      const adminConfig = getAdminConfig();
      const config = await adminConfig.getConfig();
      const keyStatus = await secureStorage.getProviderStatus();
      const healthStatus = getProviderHealth();

      const providers: ProviderStatus[] = [];

      for (const [provider, status] of Object.entries(keyStatus)) {
        const providerConfig = config.providers[provider as AIProviderType];
        const health = healthStatus.get(provider as AIProviderType);

        providers.push({
          provider,
          configured: status.configured,
          encrypted: status.encrypted,
          enabled: providerConfig?.enabled ?? false,
          endpoint: providerConfig?.endpoint,
          health: health ? {
            available: health.available,
            failCount: health.failCount,
            cooldownRemaining: health.cooldownRemaining,
          } : undefined,
        });
      }

      return providers;
    } catch (error) {
      console.error('[ai-config] Failed to get providers:', error);
      throw error;
    }
  });

  /**
   * Set API key for a provider
   */
  ipcMain.handle('ai-config:set-api-key', async (
    _event,
    provider: AIProviderType,
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const secureStorage = getSecureStorage();

      // Validate key format
      const validation = secureStorage.validateKeyFormat(provider, apiKey);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Store securely
      await secureStorage.setKey(provider, apiKey);

      // Update admin config to enable provider
      const adminConfig = getAdminConfig();
      await adminConfig.setProviderEnabled(provider, true);

      // Update LLM config
      const currentKeys = getModelConfig().apiKeys;
      setAPIKeys({
        ...currentKeys,
        [provider]: apiKey,
      });

      return { success: true };
    } catch (error) {
      console.error(`[ai-config] Failed to set API key for ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Remove API key for a provider
   */
  ipcMain.handle('ai-config:remove-key', async (
    _event,
    provider: AIProviderType
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const secureStorage = getSecureStorage();
      await secureStorage.removeKey(provider);

      // Update admin config to disable provider
      const adminConfig = getAdminConfig();
      await adminConfig.setProviderEnabled(provider, false);

      // Update LLM config
      const currentKeys = getModelConfig().apiKeys;
      const newKeys = { ...currentKeys };
      delete newKeys[provider as keyof typeof newKeys];
      setAPIKeys(newKeys);

      return { success: true };
    } catch (error) {
      console.error(`[ai-config] Failed to remove API key for ${provider}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Validate an API key by making a test request
   */
  ipcMain.handle('ai-config:validate-key', async (
    _event,
    provider: AIProviderType
  ): Promise<{ valid: boolean; error?: string }> => {
    try {
      const secureStorage = getSecureStorage();
      const apiKey = await secureStorage.getKey(provider);

      if (!apiKey) {
        return { valid: false, error: 'No API key configured' };
      }

      // Provider-specific validation
      switch (provider) {
        case 'openai': {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (response.ok) {
            return { valid: true };
          }
          const error = await response.text();
          return { valid: false, error: `API error: ${error}` };
        }

        case 'anthropic': {
          // Anthropic doesn't have a simple validate endpoint, so we check header format
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
          });
          // Even 400 means key is valid, 401 means invalid
          if (response.status !== 401) {
            return { valid: true };
          }
          return { valid: false, error: 'Invalid API key' };
        }

        case 'together': {
          const response = await fetch('https://api.together.xyz/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (response.ok) {
            return { valid: true };
          }
          return { valid: false, error: 'Invalid API key' };
        }

        case 'groq': {
          const response = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (response.ok) {
            return { valid: true };
          }
          return { valid: false, error: 'Invalid API key' };
        }

        default:
          // For providers without validation endpoints, assume valid if format is ok
          const formatCheck = secureStorage.validateKeyFormat(provider, apiKey);
          return { valid: formatCheck.valid, error: formatCheck.error };
      }
    } catch (error) {
      console.error(`[ai-config] Failed to validate key for ${provider}:`, error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Usage Statistics
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get usage statistics
   */
  ipcMain.handle('ai-config:get-usage', async (): Promise<UsageStats> => {
    try {
      const daily = getDailyUsage();
      const monthly = getMonthlyUsage();
      const projected = getProjectedMonthlyCost();

      return {
        daily: {
          totalTokens: daily.totalInputTokens + daily.totalOutputTokens,
          totalCost: daily.totalCost,
          requestCount: daily.requestCount,
          successRate: daily.successRate,
          formatted: {
            tokens: formatTokens(daily.totalInputTokens + daily.totalOutputTokens),
            cost: formatCost(daily.totalCost),
          },
        },
        monthly: {
          totalTokens: monthly.totalInputTokens + monthly.totalOutputTokens,
          totalCost: monthly.totalCost,
          requestCount: monthly.requestCount,
          successRate: monthly.successRate,
          formatted: {
            tokens: formatTokens(monthly.totalInputTokens + monthly.totalOutputTokens),
            cost: formatCost(monthly.totalCost),
          },
        },
        projected: {
          monthlyCost: projected,
          formatted: formatCost(projected),
        },
      };
    } catch (error) {
      console.error('[ai-config] Failed to get usage:', error);
      throw error;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Model Configuration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get current model configuration
   */
  ipcMain.handle('ai-config:get-model-config', async () => {
    try {
      const config = getModelConfig();
      // Don't return API keys to renderer
      return {
        defaultModel: config.defaultModel,
        ollamaUrl: config.ollamaUrl,
        preferLocal: config.preferLocal,
        cloudflareAccountId: config.cloudflareAccountId,
      };
    } catch (error) {
      console.error('[ai-config] Failed to get model config:', error);
      throw error;
    }
  });

  /**
   * Update model configuration
   */
  ipcMain.handle('ai-config:set-model-config', async (
    _event,
    updates: Partial<{
      defaultModel: string;
      ollamaUrl: string;
      preferLocal: boolean;
      cloudflareAccountId: string;
    }>
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setModelConfig(updates);
      return { success: true };
    } catch (error) {
      console.error('[ai-config] Failed to set model config:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Provider Health
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get provider health status
   */
  ipcMain.handle('ai-config:get-health', async () => {
    try {
      const health = getProviderHealth();
      const result: Record<string, { available: boolean; failCount: number; cooldownRemaining: number }> = {};

      for (const [provider, status] of health) {
        result[provider] = {
          available: status.available,
          failCount: status.failCount,
          cooldownRemaining: status.cooldownRemaining,
        };
      }

      return result;
    } catch (error) {
      console.error('[ai-config] Failed to get health:', error);
      throw error;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Usage Tracking (Persistence & Sync)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get full usage stats including sync status
   */
  ipcMain.handle('ai-config:get-usage-stats', async () => {
    try {
      return getUsageStats();
    } catch (error) {
      console.error('[ai-config] Failed to get usage stats:', error);
      throw error;
    }
  });

  /**
   * Sync usage data with NPE-API
   */
  ipcMain.handle('ai-config:sync-usage', async (
    _event,
    authToken: string
  ): Promise<{ success: boolean; synced: number; failed: number; error?: string }> => {
    try {
      const result = await syncWithAPI(authToken);
      return { success: true, ...result };
    } catch (error) {
      console.error('[ai-config] Failed to sync usage:', error);
      return {
        success: false,
        synced: 0,
        failed: 0,
        error: error instanceof Error ? error.message : 'Sync failed',
      };
    }
  });

  /**
   * Get remote usage metrics from NPE-API (cross-device totals)
   */
  ipcMain.handle('ai-config:get-remote-metrics', async (
    _event,
    authToken: string
  ) => {
    try {
      return await getRemoteUsageMetrics(authToken);
    } catch (error) {
      console.error('[ai-config] Failed to get remote metrics:', error);
      return null;
    }
  });

  /**
   * Clear local usage data
   */
  ipcMain.handle('ai-config:clear-local-usage', async (): Promise<{ success: boolean }> => {
    try {
      clearLocalUsage();
      return { success: true };
    } catch (error) {
      console.error('[ai-config] Failed to clear local usage:', error);
      return { success: false };
    }
  });

  /**
   * Export usage data for backup
   */
  ipcMain.handle('ai-config:export-usage', async () => {
    try {
      return exportUsageData();
    } catch (error) {
      console.error('[ai-config] Failed to export usage:', error);
      throw error;
    }
  });

  /**
   * Import usage data from backup
   */
  ipcMain.handle('ai-config:import-usage', async (
    _event,
    data: { records: unknown[] }
  ): Promise<{ success: boolean; imported: number; error?: string }> => {
    try {
      const imported = importUsageData(data as Parameters<typeof importUsageData>[0]);
      return { success: true, imported };
    } catch (error) {
      console.error('[ai-config] Failed to import usage:', error);
      return {
        success: false,
        imported: 0,
        error: error instanceof Error ? error.message : 'Import failed',
      };
    }
  });

  console.log('[ai-config] IPC handlers registered');
}
