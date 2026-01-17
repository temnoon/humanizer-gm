/**
 * Tier Access Hook
 *
 * Checks user subscription tier and gates access to cloud LLM providers and features.
 * Uses the existing tier configuration from auth/types.ts
 */

import { useMemo } from 'react';
import { useAuth } from '../lib/auth';
import {
  type UserRole,
  TIER_FEATURES,
  TIER_QUOTAS,
  TIER_LABELS,
  TIER_PRICES,
  getRemainingQuota,
  isOverQuota,
} from '../lib/auth/types';

// ═══════════════════════════════════════════════════════════════════
// CLOUD LLM ACCESS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Cloud LLM provider access by tier
 * - free: No cloud providers (local Ollama only)
 * - member: Basic cloud providers (Together, Cloudflare free tier)
 * - pro: All cloud providers including premium (OpenAI, Anthropic)
 * - premium/admin: All providers + priority access
 */
export const CLOUD_LLM_ACCESS: Record<UserRole, {
  canUseCloudProviders: boolean;
  allowedProviders: string[];
  canUseFrontierModels: boolean;
  maxCostPerMonth: number; // USD
}> = {
  free: {
    canUseCloudProviders: false,
    allowedProviders: [],
    canUseFrontierModels: false,
    maxCostPerMonth: 0,
  },
  member: {
    canUseCloudProviders: true,
    allowedProviders: ['together', 'cloudflare', 'openrouter'],
    canUseFrontierModels: false,
    maxCostPerMonth: 5,
  },
  pro: {
    canUseCloudProviders: true,
    allowedProviders: ['together', 'cloudflare', 'openrouter', 'openai', 'anthropic', 'groq'],
    canUseFrontierModels: true,
    maxCostPerMonth: 50,
  },
  premium: {
    canUseCloudProviders: true,
    allowedProviders: ['together', 'cloudflare', 'openrouter', 'openai', 'anthropic', 'groq'],
    canUseFrontierModels: true,
    maxCostPerMonth: Infinity,
  },
  admin: {
    canUseCloudProviders: true,
    allowedProviders: ['together', 'cloudflare', 'openrouter', 'openai', 'anthropic', 'groq'],
    canUseFrontierModels: true,
    maxCostPerMonth: Infinity,
  },
};

/**
 * Frontier models that require pro+ tier
 */
export const FRONTIER_MODELS = new Set([
  // OpenAI
  'gpt-4o',
  'gpt-4-turbo',
  'o1',
  'o1-mini',
  // Anthropic
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  // Together.ai large models
  'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
  'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  // OpenRouter premium
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
]);

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export interface TierAccessInfo {
  // Current tier info
  tier: UserRole;
  tierLabel: string;
  isAuthenticated: boolean;

  // Existing feature access (from TIER_FEATURES)
  features: typeof TIER_FEATURES[UserRole];

  // Cloud LLM access
  canUseCloudProviders: boolean;
  allowedProviders: string[];
  canUseFrontierModels: boolean;
  maxCostPerMonth: number;

  // Quota info
  quota: {
    transformations: { limit: number; remaining: number };
    tokens: { limit: number; remaining: number };
  };
  isOverQuota: boolean;

  // Check functions
  canUseProvider: (provider: string) => boolean;
  canUseModel: (modelId: string) => boolean;
  canUseFeature: (feature: keyof typeof TIER_FEATURES.free) => boolean;

  // Upgrade helpers
  needsUpgradeFor: (feature: string) => string | null; // Returns suggested tier or null
  upgradePrice: typeof TIER_PRICES[keyof typeof TIER_PRICES] | null;
  nextTier: UserRole | null;
}

/**
 * Hook for checking tier-based access to features and cloud LLM providers
 */
export function useTierAccess(): TierAccessInfo {
  const { user, isAuthenticated } = useAuth();

  return useMemo(() => {
    const tier: UserRole = user?.role ?? 'free';
    const features = TIER_FEATURES[tier];
    const cloudAccess = CLOUD_LLM_ACCESS[tier];
    const quotaLimits = TIER_QUOTAS[tier];

    // Calculate remaining quota
    const remaining = user ? getRemainingQuota(user) : {
      transformations: quotaLimits.transformations,
      tokens: quotaLimits.tokens,
    };

    // Determine next tier for upgrade suggestions
    const tierOrder: UserRole[] = ['free', 'member', 'pro', 'premium'];
    const currentIndex = tierOrder.indexOf(tier);
    const nextTier = currentIndex < tierOrder.length - 1 && tier !== 'admin'
      ? tierOrder[currentIndex + 1]
      : null;

    // Check if a provider is allowed
    const canUseProvider = (provider: string): boolean => {
      if (!cloudAccess.canUseCloudProviders) return false;
      return cloudAccess.allowedProviders.includes(provider.toLowerCase());
    };

    // Check if a model is allowed
    const canUseModel = (modelId: string): boolean => {
      // Always allow local models
      if (!modelId.includes('/') && !modelId.startsWith('@cf/') && !modelId.startsWith('gpt-') && !modelId.startsWith('claude-') && !modelId.startsWith('o1')) {
        return true; // Ollama models
      }

      // Check if it's a frontier model
      if (FRONTIER_MODELS.has(modelId) && !cloudAccess.canUseFrontierModels) {
        return false;
      }

      // Determine provider from model ID
      let provider = 'ollama';
      if (modelId.startsWith('@cf/')) provider = 'cloudflare';
      else if (modelId.startsWith('gpt-') || modelId.startsWith('o1')) provider = 'openai';
      else if (modelId.startsWith('claude-')) provider = 'anthropic';
      else if (modelId.startsWith('together/')) provider = 'together';
      else if (modelId.includes('/')) provider = 'openrouter'; // Generic provider/model format

      return canUseProvider(provider);
    };

    // Check feature access
    const canUseFeature = (feature: keyof typeof TIER_FEATURES.free): boolean => {
      return features[feature] as boolean;
    };

    // Get upgrade suggestion for a feature
    const needsUpgradeFor = (feature: string): string | null => {
      // Check what tier is needed for this feature
      switch (feature) {
        case 'cloudProviders':
          if (!cloudAccess.canUseCloudProviders) return 'member';
          return null;

        case 'frontierModels':
          if (!cloudAccess.canUseFrontierModels) return 'pro';
          return null;

        case 'gptzero':
          if (!features.gptzero) return 'pro';
          return null;

        case 'personalizer':
          if (!features.personalizer) return 'pro';
          return null;

        case 'quantumAnalysis':
          if (!features.quantumAnalysis) return 'member';
          return null;

        case 'sicAnalysis':
          if (!features.sicAnalysis) return 'pro';
          return null;

        case '70BModels':
          if (features.modelTier !== '70B') return 'pro';
          return null;

        case 'openai':
        case 'anthropic':
          if (!canUseProvider(feature)) return 'pro';
          return null;

        case 'together':
        case 'cloudflare':
        case 'openrouter':
          if (!canUseProvider(feature)) return 'member';
          return null;

        default:
          return null;
      }
    };

    // Get price for next tier
    const upgradePrice = nextTier && nextTier !== 'admin'
      ? TIER_PRICES[nextTier as keyof typeof TIER_PRICES]
      : null;

    return {
      tier,
      tierLabel: TIER_LABELS[tier],
      isAuthenticated,
      features,
      canUseCloudProviders: cloudAccess.canUseCloudProviders,
      allowedProviders: cloudAccess.allowedProviders,
      canUseFrontierModels: cloudAccess.canUseFrontierModels,
      maxCostPerMonth: cloudAccess.maxCostPerMonth,
      quota: {
        transformations: {
          limit: quotaLimits.transformations,
          remaining: remaining.transformations,
        },
        tokens: {
          limit: quotaLimits.tokens,
          remaining: remaining.tokens,
        },
      },
      isOverQuota: user ? isOverQuota(user) : false,
      canUseProvider,
      canUseModel,
      canUseFeature,
      needsUpgradeFor,
      upgradePrice,
      nextTier,
    };
  }, [user, isAuthenticated]);
}

/**
 * Get tier access info for a specific role (without hook)
 * Useful for server-side checks
 */
export function getTierAccess(role: UserRole): Omit<TierAccessInfo, 'isAuthenticated' | 'quota' | 'isOverQuota'> {
  const features = TIER_FEATURES[role];
  const cloudAccess = CLOUD_LLM_ACCESS[role];

  const tierOrder: UserRole[] = ['free', 'member', 'pro', 'premium'];
  const currentIndex = tierOrder.indexOf(role);
  const nextTier = currentIndex < tierOrder.length - 1 && role !== 'admin'
    ? tierOrder[currentIndex + 1]
    : null;

  const canUseProvider = (provider: string): boolean => {
    if (!cloudAccess.canUseCloudProviders) return false;
    return cloudAccess.allowedProviders.includes(provider.toLowerCase());
  };

  const canUseModel = (modelId: string): boolean => {
    if (!modelId.includes('/') && !modelId.startsWith('@cf/') && !modelId.startsWith('gpt-') && !modelId.startsWith('claude-') && !modelId.startsWith('o1')) {
      return true;
    }
    if (FRONTIER_MODELS.has(modelId) && !cloudAccess.canUseFrontierModels) {
      return false;
    }
    let provider = 'ollama';
    if (modelId.startsWith('@cf/')) provider = 'cloudflare';
    else if (modelId.startsWith('gpt-') || modelId.startsWith('o1')) provider = 'openai';
    else if (modelId.startsWith('claude-')) provider = 'anthropic';
    else if (modelId.startsWith('together/')) provider = 'together';
    else if (modelId.includes('/')) provider = 'openrouter';
    return canUseProvider(provider);
  };

  const canUseFeature = (feature: keyof typeof TIER_FEATURES.free): boolean => {
    return features[feature] as boolean;
  };

  const needsUpgradeFor = (feature: string): string | null => {
    switch (feature) {
      case 'cloudProviders':
        return !cloudAccess.canUseCloudProviders ? 'member' : null;
      case 'frontierModels':
        return !cloudAccess.canUseFrontierModels ? 'pro' : null;
      case 'gptzero':
        return !features.gptzero ? 'pro' : null;
      case 'personalizer':
        return !features.personalizer ? 'pro' : null;
      case 'quantumAnalysis':
        return !features.quantumAnalysis ? 'member' : null;
      case 'sicAnalysis':
        return !features.sicAnalysis ? 'pro' : null;
      case '70BModels':
        return features.modelTier !== '70B' ? 'pro' : null;
      case 'openai':
      case 'anthropic':
        return !canUseProvider(feature) ? 'pro' : null;
      case 'together':
      case 'cloudflare':
      case 'openrouter':
        return !canUseProvider(feature) ? 'member' : null;
      default:
        return null;
    }
  };

  const upgradePrice = nextTier && nextTier !== 'admin'
    ? TIER_PRICES[nextTier as keyof typeof TIER_PRICES]
    : null;

  return {
    tier: role,
    tierLabel: TIER_LABELS[role],
    features,
    canUseCloudProviders: cloudAccess.canUseCloudProviders,
    allowedProviders: cloudAccess.allowedProviders,
    canUseFrontierModels: cloudAccess.canUseFrontierModels,
    maxCostPerMonth: cloudAccess.maxCostPerMonth,
    canUseProvider,
    canUseModel,
    canUseFeature,
    needsUpgradeFor,
    upgradePrice,
    nextTier,
  };
}

export default useTierAccess;
