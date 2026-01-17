/**
 * Upgrade Prompt Modal
 *
 * Shown when users hit quota or tier limits.
 * Provides upgrade options with pricing and links to Stripe checkout.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../lib/auth';
import { createCheckoutSession } from '../../lib/auth/api';
import { useTierAccess, CLOUD_LLM_ACCESS } from '../../hooks';
import {
  type UserRole,
  TIER_LABELS,
  TIER_PRICES,
  TIER_QUOTAS,
  TIER_FEATURES,
} from '../../lib/auth/types';
import './UpgradePrompt.css';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export type UpgradeReason =
  | 'quota_exceeded'
  | 'feature_locked'
  | 'provider_locked'
  | 'model_locked'
  | 'cost_limit';

export interface UpgradePromptProps {
  isOpen: boolean;
  onClose: () => void;
  reason: UpgradeReason;
  featureName?: string;
  suggestedTier?: UserRole;
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE DESCRIPTIONS
// ═══════════════════════════════════════════════════════════════════

const FEATURE_DESCRIPTIONS: Record<string, string> = {
  cloudProviders: 'Cloud AI providers for faster transformations',
  frontierModels: 'Access to GPT-4, Claude 3.5 Sonnet, and other frontier models',
  gptzero: 'GPTZero AI detection integration',
  personalizer: 'Personalized writing style adaptation',
  quantumAnalysis: 'Quantum text analysis and metrics',
  sicAnalysis: 'Subjective Intentional Constraint analysis',
  '70BModels': 'Large 70B parameter models for higher quality',
  openai: 'OpenAI models (GPT-4, GPT-4o)',
  anthropic: 'Anthropic models (Claude 3.5, Claude 3)',
  together: 'Together.ai open-source models',
  cloudflare: 'Cloudflare Workers AI',
  openrouter: 'OpenRouter model aggregator',
};

const REASON_TITLES: Record<UpgradeReason, string> = {
  quota_exceeded: 'Monthly Quota Exceeded',
  feature_locked: 'Feature Requires Upgrade',
  provider_locked: 'Provider Requires Upgrade',
  model_locked: 'Model Requires Upgrade',
  cost_limit: 'Cost Limit Reached',
};

const REASON_DESCRIPTIONS: Record<UpgradeReason, string> = {
  quota_exceeded: "You've used all your transformations or tokens for this month.",
  feature_locked: 'This feature is available on higher tiers.',
  provider_locked: 'This AI provider is available on higher tiers.',
  model_locked: 'This model is available on higher tiers.',
  cost_limit: "You've reached your monthly cost limit for cloud AI.",
};

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function UpgradePromptModal({
  isOpen,
  onClose,
  reason,
  featureName,
  suggestedTier,
}: UpgradePromptProps) {
  const { isAuthenticated } = useAuth();
  const { tier, quota } = useTierAccess();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine which tier to suggest
  const targetTier = suggestedTier || (tier === 'free' ? 'member' : 'pro');

  // Handle upgrade click
  const handleUpgrade = useCallback(async (selectedTier: 'member' | 'pro' | 'premium') => {
    if (!isAuthenticated) {
      setError('Please log in to upgrade');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { url } = await createCheckoutSession(selectedTier);
      // Redirect to Stripe checkout
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Handle escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div className="upgrade-modal" onClick={onClose}>
      <div className="upgrade-modal__content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="upgrade-modal__header">
          <h2 className="upgrade-modal__title">{REASON_TITLES[reason]}</h2>
          <button className="upgrade-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* Description */}
        <div className="upgrade-modal__description">
          <p>{REASON_DESCRIPTIONS[reason]}</p>
          {featureName && FEATURE_DESCRIPTIONS[featureName] && (
            <p className="upgrade-modal__feature-desc">
              <strong>{featureName}:</strong> {FEATURE_DESCRIPTIONS[featureName]}
            </p>
          )}
        </div>

        {/* Current usage (for quota exceeded) */}
        {reason === 'quota_exceeded' && (
          <div className="upgrade-modal__usage">
            <div className="upgrade-modal__usage-stat">
              <span className="upgrade-modal__usage-label">Transformations</span>
              <span className="upgrade-modal__usage-value">
                {quota.transformations.limit - quota.transformations.remaining} / {quota.transformations.limit === Infinity ? '∞' : quota.transformations.limit}
              </span>
            </div>
            <div className="upgrade-modal__usage-stat">
              <span className="upgrade-modal__usage-label">Tokens</span>
              <span className="upgrade-modal__usage-value">
                {formatNumber(quota.tokens.limit - quota.tokens.remaining)} / {quota.tokens.limit === Infinity ? '∞' : formatNumber(quota.tokens.limit)}
              </span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="upgrade-modal__error">{error}</div>
        )}

        {/* Tier options */}
        <div className="upgrade-modal__tiers">
          {(['member', 'pro', 'premium'] as const).map((t) => {
            // Only show tiers higher than current
            const tierOrder: UserRole[] = ['free', 'member', 'pro', 'premium', 'admin'];
            if (tierOrder.indexOf(t) <= tierOrder.indexOf(tier)) return null;

            const price = TIER_PRICES[t];
            const features = TIER_FEATURES[t];
            const cloud = CLOUD_LLM_ACCESS[t];
            const quotas = TIER_QUOTAS[t];
            const isRecommended = t === targetTier;

            return (
              <div
                key={t}
                className={`upgrade-modal__tier ${isRecommended ? 'upgrade-modal__tier--recommended' : ''}`}
              >
                {isRecommended && <span className="upgrade-modal__tier-badge">Recommended</span>}
                <h3 className="upgrade-modal__tier-name">{TIER_LABELS[t]}</h3>
                <div className="upgrade-modal__tier-price">
                  <span className="upgrade-modal__tier-amount">${price.monthly}</span>
                  <span className="upgrade-modal__tier-period">/month</span>
                </div>
                <ul className="upgrade-modal__tier-features">
                  <li>{quotas.transformations === Infinity ? 'Unlimited' : quotas.transformations} transformations/mo</li>
                  <li>{quotas.tokens === Infinity ? 'Unlimited' : formatNumber(quotas.tokens)} tokens/mo</li>
                  {cloud.canUseCloudProviders && <li>Cloud AI providers</li>}
                  {cloud.canUseFrontierModels && <li>Frontier models (GPT-4, Claude 3.5)</li>}
                  {features.modelTier === '70B' && <li>70B parameter models</li>}
                  {features.quantumAnalysis && <li>Quantum analysis</li>}
                  {features.sicAnalysis && <li>SIC analysis</li>}
                  {features.gptzero && <li>GPTZero integration</li>}
                  {features.personalizer && <li>Writing personalizer</li>}
                </ul>
                <button
                  className={`upgrade-modal__tier-btn ${isRecommended ? 'upgrade-modal__tier-btn--primary' : ''}`}
                  onClick={() => handleUpgrade(t)}
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : `Upgrade to ${TIER_LABELS[t]}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="upgrade-modal__footer">
          <p className="upgrade-modal__footer-text">
            All plans include a 7-day money-back guarantee
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT PROVIDER (for global upgrade prompts)
// ═══════════════════════════════════════════════════════════════════

import { createContext, useContext, type ReactNode } from 'react';

interface UpgradePromptContextType {
  showUpgradePrompt: (reason: UpgradeReason, featureName?: string, suggestedTier?: UserRole) => void;
}

const UpgradePromptContext = createContext<UpgradePromptContextType | null>(null);

export function UpgradePromptProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [promptState, setPromptState] = useState<{
    reason: UpgradeReason;
    featureName?: string;
    suggestedTier?: UserRole;
  }>({
    reason: 'feature_locked',
  });

  const showUpgradePrompt = useCallback(
    (reason: UpgradeReason, featureName?: string, suggestedTier?: UserRole) => {
      setPromptState({ reason, featureName, suggestedTier });
      setIsOpen(true);
    },
    []
  );

  return (
    <UpgradePromptContext.Provider value={{ showUpgradePrompt }}>
      {children}
      <UpgradePromptModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        reason={promptState.reason}
        featureName={promptState.featureName}
        suggestedTier={promptState.suggestedTier}
      />
    </UpgradePromptContext.Provider>
  );
}

export function useUpgradePrompt(): UpgradePromptContextType {
  const context = useContext(UpgradePromptContext);
  if (!context) {
    throw new Error('useUpgradePrompt must be used within UpgradePromptProvider');
  }
  return context;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(0)}K`;
  }
  return num.toString();
}

export default UpgradePromptModal;
