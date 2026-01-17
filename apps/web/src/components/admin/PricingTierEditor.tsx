/**
 * Pricing Tier Editor
 *
 * Component for viewing and editing subscription pricing tiers.
 */

import { useState, useEffect } from 'react';
import { useAdminConfig, type PricingTier } from './useAdminConfig';
import './admin-config.css';

export function PricingTierEditor() {
  const { tiers, loading, error, loadTiers, updateTier } = useAdminConfig();
  const [editingTier, setEditingTier] = useState<PricingTier | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    loadTiers(showInactive);
  }, [loadTiers, showInactive]);

  const handleSaveTier = async (tierKey: string, updates: Partial<PricingTier>) => {
    try {
      await updateTier(tierKey, updates);
      setEditingTier(null);
    } catch {
      // Error handled by hook
    }
  };

  if (loading) {
    return <div className="admin-config__loading">Loading pricing tiers...</div>;
  }

  if (error) {
    return <div className="admin-config__error-inline">{error}</div>;
  }

  return (
    <div className="admin-config__pricing-tab">
      <div className="admin-config__list-header">
        <h3>Subscription Tiers</h3>
        <label className="admin-config__checkbox-label">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
          />
          Show Inactive
        </label>
      </div>

      <div className="admin-config__tiers-grid">
        {tiers.map(tier => (
          <TierCard
            key={tier.tierKey}
            tier={tier}
            onEdit={() => setEditingTier(tier)}
          />
        ))}
      </div>

      {editingTier && (
        <TierEditModal
          tier={editingTier}
          onSave={updates => handleSaveTier(editingTier.tierKey, updates)}
          onClose={() => setEditingTier(null)}
        />
      )}
    </div>
  );
}

// Tier Card Component
interface TierCardProps {
  tier: PricingTier;
  onEdit: () => void;
}

function TierCard({ tier, onEdit }: TierCardProps) {
  const formatLimit = (value: number) => {
    if (value === -1) return 'Unlimited';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
    return String(value);
  };

  return (
    <div
      className={`admin-config__tier-card ${!tier.isActive ? 'admin-config__tier-card--inactive' : ''}`}
      style={tier.highlightColor ? { borderColor: tier.highlightColor } : undefined}
    >
      <div className="admin-config__tier-header">
        <h4 className="admin-config__tier-name">
          {tier.displayName}
          {tier.badgeText && (
            <span className="admin-config__tier-badge">{tier.badgeText}</span>
          )}
        </h4>
        <span className="admin-config__tier-key">{tier.tierKey}</span>
      </div>

      <div className="admin-config__tier-price">
        <span className="admin-config__tier-price-value">
          ${(tier.priceCentsMonthly / 100).toFixed(2)}
        </span>
        <span className="admin-config__tier-price-period">/month</span>
      </div>

      {tier.description && (
        <p className="admin-config__tier-description">{tier.description}</p>
      )}

      <div className="admin-config__tier-limits">
        <div className="admin-config__tier-limit">
          <span className="admin-config__tier-limit-label">Transforms</span>
          <span className="admin-config__tier-limit-value">
            {formatLimit(tier.transformationsPerMonth)}
          </span>
        </div>
        <div className="admin-config__tier-limit">
          <span className="admin-config__tier-limit-label">Tokens</span>
          <span className="admin-config__tier-limit-value">
            {formatLimit(tier.tokensPerMonth)}
          </span>
        </div>
      </div>

      <div className="admin-config__tier-features">
        {tier.canUseCloudProviders && (
          <span className="admin-config__tier-feature">☁️ Cloud</span>
        )}
        {tier.canUseFrontierModels && (
          <span className="admin-config__tier-feature">🚀 Frontier</span>
        )}
      </div>

      <div className="admin-config__tier-status">
        {tier.isDefault && <span className="admin-config__badge admin-config__badge--default">default</span>}
        {!tier.isActive && <span className="admin-config__badge admin-config__badge--inactive">inactive</span>}
      </div>

      <button className="admin-config__btn admin-config__btn--small admin-config__btn--full" onClick={onEdit}>
        Edit Tier
      </button>
    </div>
  );
}

// Tier Edit Modal
interface TierEditModalProps {
  tier: PricingTier;
  onSave: (updates: Partial<PricingTier>) => void;
  onClose: () => void;
}

function TierEditModal({ tier, onSave, onClose }: TierEditModalProps) {
  const [form, setForm] = useState({
    displayName: tier.displayName,
    description: tier.description || '',
    badgeText: tier.badgeText || '',
    priceCentsMonthly: tier.priceCentsMonthly,
    priceCentsAnnual: tier.priceCentsAnnual,
    transformationsPerMonth: tier.transformationsPerMonth,
    tokensPerMonth: tier.tokensPerMonth,
    maxCostPerMonthCents: tier.maxCostPerMonthCents,
    canUseCloudProviders: tier.canUseCloudProviders,
    canUseFrontierModels: tier.canUseFrontierModels,
    isActive: tier.isActive,
    isDefault: tier.isDefault,
    sortOrder: tier.sortOrder,
    highlightColor: tier.highlightColor || '',
    stripePriceIdMonthly: tier.stripePriceIdMonthly || '',
    stripePriceIdAnnual: tier.stripePriceIdAnnual || '',
  });

  const handleChange = (field: keyof typeof form, value: unknown) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave({
      displayName: form.displayName,
      description: form.description || undefined,
      badgeText: form.badgeText || undefined,
      priceCentsMonthly: form.priceCentsMonthly,
      priceCentsAnnual: form.priceCentsAnnual,
      transformationsPerMonth: form.transformationsPerMonth,
      tokensPerMonth: form.tokensPerMonth,
      maxCostPerMonthCents: form.maxCostPerMonthCents,
      canUseCloudProviders: form.canUseCloudProviders,
      canUseFrontierModels: form.canUseFrontierModels,
      isActive: form.isActive,
      isDefault: form.isDefault,
      sortOrder: form.sortOrder,
      highlightColor: form.highlightColor || undefined,
      stripePriceIdMonthly: form.stripePriceIdMonthly || undefined,
      stripePriceIdAnnual: form.stripePriceIdAnnual || undefined,
    });
  };

  return (
    <div className="admin-config__edit-overlay" onClick={onClose}>
      <div className="admin-config__edit-modal admin-config__edit-modal--wide" onClick={e => e.stopPropagation()}>
        <h3>Edit Tier: {tier.tierKey}</h3>

        <div className="admin-config__form-grid">
          <div className="admin-config__form-group">
            <label>Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={e => handleChange('displayName', e.target.value)}
            />
          </div>

          <div className="admin-config__form-group">
            <label>Badge Text</label>
            <input
              type="text"
              value={form.badgeText}
              onChange={e => handleChange('badgeText', e.target.value)}
              placeholder="e.g., Popular, Best Value"
            />
          </div>

          <div className="admin-config__form-group">
            <label>Monthly Price (cents)</label>
            <input
              type="number"
              value={form.priceCentsMonthly}
              onChange={e => handleChange('priceCentsMonthly', Number(e.target.value))}
            />
            <span className="admin-config__form-hint">
              = ${(form.priceCentsMonthly / 100).toFixed(2)}/mo
            </span>
          </div>

          <div className="admin-config__form-group">
            <label>Annual Price (cents)</label>
            <input
              type="number"
              value={form.priceCentsAnnual}
              onChange={e => handleChange('priceCentsAnnual', Number(e.target.value))}
            />
            <span className="admin-config__form-hint">
              = ${(form.priceCentsAnnual / 100).toFixed(2)}/yr
            </span>
          </div>

          <div className="admin-config__form-group">
            <label>Transforms/Month (-1 = unlimited)</label>
            <input
              type="number"
              value={form.transformationsPerMonth}
              onChange={e => handleChange('transformationsPerMonth', Number(e.target.value))}
            />
          </div>

          <div className="admin-config__form-group">
            <label>Tokens/Month (-1 = unlimited)</label>
            <input
              type="number"
              value={form.tokensPerMonth}
              onChange={e => handleChange('tokensPerMonth', Number(e.target.value))}
            />
          </div>

          <div className="admin-config__form-group">
            <label>Max Cost/Month (cents)</label>
            <input
              type="number"
              value={form.maxCostPerMonthCents}
              onChange={e => handleChange('maxCostPerMonthCents', Number(e.target.value))}
            />
          </div>

          <div className="admin-config__form-group">
            <label>Sort Order</label>
            <input
              type="number"
              value={form.sortOrder}
              onChange={e => handleChange('sortOrder', Number(e.target.value))}
            />
          </div>

          <div className="admin-config__form-group admin-config__form-group--full">
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={e => handleChange('description', e.target.value)}
              rows={2}
            />
          </div>

          <div className="admin-config__form-group admin-config__form-group--full">
            <label>Stripe Price ID (Monthly)</label>
            <input
              type="text"
              value={form.stripePriceIdMonthly}
              onChange={e => handleChange('stripePriceIdMonthly', e.target.value)}
              placeholder="price_xxxx"
            />
          </div>

          <div className="admin-config__form-group admin-config__form-group--full">
            <label>Stripe Price ID (Annual)</label>
            <input
              type="text"
              value={form.stripePriceIdAnnual}
              onChange={e => handleChange('stripePriceIdAnnual', e.target.value)}
              placeholder="price_xxxx"
            />
          </div>

          <div className="admin-config__form-group">
            <label>Highlight Color</label>
            <input
              type="color"
              value={form.highlightColor || '#8b6914'}
              onChange={e => handleChange('highlightColor', e.target.value)}
            />
          </div>

          <div className="admin-config__form-group admin-config__form-group--checkboxes">
            <label className="admin-config__checkbox-label">
              <input
                type="checkbox"
                checked={form.canUseCloudProviders}
                onChange={e => handleChange('canUseCloudProviders', e.target.checked)}
              />
              Cloud Providers
            </label>
            <label className="admin-config__checkbox-label">
              <input
                type="checkbox"
                checked={form.canUseFrontierModels}
                onChange={e => handleChange('canUseFrontierModels', e.target.checked)}
              />
              Frontier Models
            </label>
            <label className="admin-config__checkbox-label">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={e => handleChange('isActive', e.target.checked)}
              />
              Active
            </label>
            <label className="admin-config__checkbox-label">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={e => handleChange('isDefault', e.target.checked)}
              />
              Default Tier
            </label>
          </div>
        </div>

        <div className="admin-config__edit-actions">
          <button className="admin-config__btn" onClick={onClose}>
            Cancel
          </button>
          <button className="admin-config__btn admin-config__btn--primary" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default PricingTierEditor;
