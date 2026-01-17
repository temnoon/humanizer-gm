/**
 * Admin Config Hook
 *
 * API hooks for managing admin configuration from the database.
 * All operations require admin role authentication.
 */

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '../../lib/auth/api';

// Types
export type ConfigCategory = 'pricing' | 'stripe' | 'features' | 'limits' | 'secrets' | 'ui';

export interface ConfigValue {
  id: string;
  category: ConfigCategory;
  key: string;
  value: unknown;
  rawValue: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  isSecret: boolean;
  isEncrypted: boolean;
  description?: string;
  updatedBy?: string;
  updatedAt: number;
  createdAt: number;
}

export interface PricingTier {
  id: string;
  tierKey: string;
  displayName: string;
  description?: string;
  badgeText?: string;
  priceCentsMonthly: number;
  priceCentsAnnual: number;
  stripePriceIdMonthly?: string;
  stripePriceIdAnnual?: string;
  transformationsPerMonth: number;
  tokensPerMonth: number;
  maxCostPerMonthCents: number;
  canUseCloudProviders: boolean;
  canUseFrontierModels: boolean;
  allowedProviders?: string[];
  features: Record<string, boolean>;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  highlightColor?: string;
  updatedBy?: string;
  updatedAt: number;
  createdAt: number;
}

export interface AuditLogEntry {
  id: string;
  configId: string;
  category: string;
  key: string;
  action: 'create' | 'update' | 'delete';
  oldValue?: string;
  newValue?: string;
  changedBy: string;
  changedByEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  createdAt: number;
}

export interface EncryptionStatus {
  configured: boolean;
  error?: string;
  message: string;
}

// API Functions
export async function getAllConfig(): Promise<ConfigValue[]> {
  const response = await authenticatedFetch<{ configs: ConfigValue[] }>('/admin/config');
  return response.configs;
}

export async function getConfigByCategory(category: ConfigCategory): Promise<ConfigValue[]> {
  const response = await authenticatedFetch<{ configs: ConfigValue[] }>(`/admin/config/${category}`);
  return response.configs;
}

export async function getConfig(category: ConfigCategory, key: string): Promise<ConfigValue | null> {
  try {
    return await authenticatedFetch<ConfigValue>(`/admin/config/${category}/${key}`);
  } catch {
    return null;
  }
}

export async function setConfig(
  category: ConfigCategory,
  key: string,
  value: unknown,
  options?: {
    description?: string;
    isSecret?: boolean;
    encrypt?: boolean;
    reason?: string;
  }
): Promise<ConfigValue> {
  const response = await authenticatedFetch<{ success: boolean; config: ConfigValue }>(
    `/admin/config/${category}/${key}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        value,
        ...options,
      }),
    }
  );
  return response.config;
}

export async function deleteConfig(
  category: ConfigCategory,
  key: string,
  reason?: string
): Promise<boolean> {
  const response = await authenticatedFetch<{ success: boolean }>(
    `/admin/config/${category}/${key}`,
    {
      method: 'DELETE',
      body: reason ? JSON.stringify({ reason }) : undefined,
    }
  );
  return response.success;
}

export async function getPricingTiers(includeInactive = false): Promise<PricingTier[]> {
  const url = includeInactive ? '/admin/pricing?includeInactive=true' : '/admin/pricing';
  const response = await authenticatedFetch<{ tiers: PricingTier[] }>(url);
  return response.tiers;
}

export async function getPricingTier(tierKey: string): Promise<PricingTier | null> {
  try {
    return await authenticatedFetch<PricingTier>(`/admin/pricing/${tierKey}`);
  } catch {
    return null;
  }
}

export async function updatePricingTier(
  tierKey: string,
  updates: Partial<PricingTier>
): Promise<PricingTier> {
  const response = await authenticatedFetch<{ success: boolean; tier: PricingTier }>(
    `/admin/pricing/${tierKey}`,
    {
      method: 'PUT',
      body: JSON.stringify(updates),
    }
  );
  return response.tier;
}

export async function getAuditLog(options?: {
  configId?: string;
  category?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (options?.configId) params.append('configId', options.configId);
  if (options?.category) params.append('category', options.category);
  if (options?.userId) params.append('userId', options.userId);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const url = `/admin/audit${params.toString() ? `?${params}` : ''}`;
  const response = await authenticatedFetch<{ entries: AuditLogEntry[] }>(url);
  return response.entries;
}

export async function getEncryptionStatus(): Promise<EncryptionStatus> {
  return authenticatedFetch<EncryptionStatus>('/admin/encryption/status');
}

export async function seedConfig(): Promise<{ seeded: string[]; message: string }> {
  return authenticatedFetch<{ seeded: string[]; message: string }>('/admin/config/seed', {
    method: 'POST',
  });
}

// Hook for managing config state
export function useAdminConfig() {
  const [configs, setConfigs] = useState<ConfigValue[]>([]);
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfigs = useCallback(async (category?: ConfigCategory) => {
    setLoading(true);
    setError(null);
    try {
      const data = category ? await getConfigByCategory(category) : await getAllConfig();
      setConfigs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTiers = useCallback(async (includeInactive = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPricingTiers(includeInactive);
      setTiers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pricing tiers');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAuditLog = useCallback(async (options?: Parameters<typeof getAuditLog>[0]) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditLog(options);
      setAuditLog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (
    category: ConfigCategory,
    key: string,
    value: unknown,
    options?: Parameters<typeof setConfig>[3]
  ) => {
    setError(null);
    try {
      const updated = await setConfig(category, key, value, options);
      setConfigs(prev => {
        const index = prev.findIndex(c => c.category === category && c.key === key);
        if (index >= 0) {
          const newConfigs = [...prev];
          newConfigs[index] = updated;
          return newConfigs;
        }
        return [...prev, updated];
      });
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
      throw err;
    }
  }, []);

  const updateTier = useCallback(async (tierKey: string, updates: Partial<PricingTier>) => {
    setError(null);
    try {
      const updated = await updatePricingTier(tierKey, updates);
      setTiers(prev => prev.map(t => t.tierKey === tierKey ? updated : t));
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tier');
      throw err;
    }
  }, []);

  const removeConfig = useCallback(async (category: ConfigCategory, key: string, reason?: string) => {
    setError(null);
    try {
      await deleteConfig(category, key, reason);
      setConfigs(prev => prev.filter(c => !(c.category === category && c.key === key)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete config');
      throw err;
    }
  }, []);

  return {
    configs,
    tiers,
    auditLog,
    loading,
    error,
    loadConfigs,
    loadTiers,
    loadAuditLog,
    updateConfig,
    updateTier,
    removeConfig,
    clearError: () => setError(null),
  };
}
