/**
 * Admin Config Panel
 *
 * Main component for managing admin configuration values.
 * Provides CRUD interface for config by category.
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../lib/auth';
import {
  useAdminConfig,
  type ConfigValue,
  type ConfigCategory,
  getEncryptionStatus,
  type EncryptionStatus,
} from './useAdminConfig';
import { PricingTierEditor } from './PricingTierEditor';
import { AuditLogViewer } from './AuditLogViewer';
import './admin-config.css';

const CATEGORIES: { key: ConfigCategory; label: string; icon: string }[] = [
  { key: 'pricing', label: 'Pricing', icon: '$' },
  { key: 'features', label: 'Features', icon: '⚡' },
  { key: 'limits', label: 'Limits', icon: '⊘' },
  { key: 'ui', label: 'UI', icon: '◫' },
  { key: 'stripe', label: 'Stripe', icon: '💳' },
  { key: 'secrets', label: 'Secrets', icon: '🔐' },
];

interface AdminConfigPanelProps {
  onClose: () => void;
}

type TabKey = 'config' | 'pricing' | 'audit';

export function AdminConfigPanel({ onClose }: AdminConfigPanelProps) {
  const { user } = useAuth();
  const {
    configs,
    loading,
    error,
    loadConfigs,
    updateConfig,
    removeConfig,
    clearError,
  } = useAdminConfig();

  const [activeTab, setActiveTab] = useState<TabKey>('config');
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('pricing');
  const [editingConfig, setEditingConfig] = useState<ConfigValue | null>(null);
  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus | null>(null);
  const [showNewConfig, setShowNewConfig] = useState(false);

  // Check admin access
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (isAdmin) {
      loadConfigs(activeCategory);
      getEncryptionStatus().then(setEncryptionStatus).catch(() => {});
    }
  }, [isAdmin, activeCategory, loadConfigs]);

  const handleSaveConfig = useCallback(async (
    category: ConfigCategory,
    key: string,
    value: unknown,
    description?: string
  ) => {
    try {
      await updateConfig(category, key, value, { description });
      setEditingConfig(null);
      setShowNewConfig(false);
    } catch {
      // Error is handled by hook
    }
  }, [updateConfig]);

  const handleDeleteConfig = useCallback(async (category: ConfigCategory, key: string) => {
    if (confirm(`Delete config "${category}/${key}"? This cannot be undone.`)) {
      try {
        await removeConfig(category, key, 'Deleted via admin panel');
      } catch {
        // Error is handled by hook
      }
    }
  }, [removeConfig]);

  if (!isAdmin) {
    return createPortal(
      <div className="admin-config-modal" onClick={onClose}>
        <div className="admin-config-modal__content admin-config-modal__content--small" onClick={e => e.stopPropagation()}>
          <div className="admin-config__error-state">
            <h2>Access Denied</h2>
            <p>You must be an admin to access this panel.</p>
            <button className="admin-config__btn admin-config__btn--primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const modalContent = (
    <div className="admin-config-modal" onClick={onClose}>
      <div className="admin-config-modal__content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="admin-config__header">
          <h2 className="admin-config__title">Admin Configuration</h2>
          <div className="admin-config__header-actions">
            {encryptionStatus && (
              <span className={`admin-config__encryption-badge ${encryptionStatus.configured ? 'admin-config__encryption-badge--ok' : 'admin-config__encryption-badge--error'}`}>
                {encryptionStatus.configured ? '🔒 Encrypted' : '⚠️ No Encryption'}
              </span>
            )}
            <button
              className="admin-config__close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="admin-config__tabs">
          <button
            className={`admin-config__tab ${activeTab === 'config' ? 'admin-config__tab--active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            Configuration
          </button>
          <button
            className={`admin-config__tab ${activeTab === 'pricing' ? 'admin-config__tab--active' : ''}`}
            onClick={() => setActiveTab('pricing')}
          >
            Pricing Tiers
          </button>
          <button
            className={`admin-config__tab ${activeTab === 'audit' ? 'admin-config__tab--active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit Log
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="admin-config__error">
            <span>{error}</span>
            <button onClick={clearError}>×</button>
          </div>
        )}

        {/* Tab Content */}
        <div className="admin-config__content">
          {activeTab === 'config' && (
            <ConfigTab
              configs={configs}
              loading={loading}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              onEdit={setEditingConfig}
              onDelete={handleDeleteConfig}
              onAdd={() => setShowNewConfig(true)}
            />
          )}

          {activeTab === 'pricing' && <PricingTierEditor />}

          {activeTab === 'audit' && <AuditLogViewer />}
        </div>

        {/* Edit Modal */}
        {editingConfig && (
          <ConfigEditModal
            config={editingConfig}
            onSave={(value, description) =>
              handleSaveConfig(editingConfig.category, editingConfig.key, value, description)
            }
            onClose={() => setEditingConfig(null)}
          />
        )}

        {/* New Config Modal */}
        {showNewConfig && (
          <NewConfigModal
            category={activeCategory}
            onSave={(key, value, description) =>
              handleSaveConfig(activeCategory, key, value, description)
            }
            onClose={() => setShowNewConfig(false)}
          />
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

// Config Tab Component
interface ConfigTabProps {
  configs: ConfigValue[];
  loading: boolean;
  activeCategory: ConfigCategory;
  onCategoryChange: (category: ConfigCategory) => void;
  onEdit: (config: ConfigValue) => void;
  onDelete: (category: ConfigCategory, key: string) => void;
  onAdd: () => void;
}

function ConfigTab({
  configs,
  loading,
  activeCategory,
  onCategoryChange,
  onEdit,
  onDelete,
  onAdd,
}: ConfigTabProps) {
  return (
    <div className="admin-config__config-tab">
      {/* Category Selector */}
      <div className="admin-config__categories">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`admin-config__category-btn ${activeCategory === cat.key ? 'admin-config__category-btn--active' : ''}`}
            onClick={() => onCategoryChange(cat.key)}
          >
            <span className="admin-config__category-icon">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* Config List */}
      <div className="admin-config__list-header">
        <h3>{CATEGORIES.find(c => c.key === activeCategory)?.label} Configuration</h3>
        <button className="admin-config__btn admin-config__btn--primary" onClick={onAdd}>
          + Add New
        </button>
      </div>

      {loading ? (
        <div className="admin-config__loading">Loading...</div>
      ) : configs.length === 0 ? (
        <div className="admin-config__empty">No configuration values in this category.</div>
      ) : (
        <div className="admin-config__list">
          {configs.map(config => (
            <div key={config.id} className="admin-config__item">
              <div className="admin-config__item-main">
                <div className="admin-config__item-key">
                  {config.key}
                  {config.isSecret && <span className="admin-config__badge admin-config__badge--secret">secret</span>}
                  {config.isEncrypted && <span className="admin-config__badge admin-config__badge--encrypted">encrypted</span>}
                </div>
                <div className="admin-config__item-value">
                  {config.isSecret ? '[REDACTED]' : formatValue(config.value)}
                </div>
                {config.description && (
                  <div className="admin-config__item-description">{config.description}</div>
                )}
              </div>
              <div className="admin-config__item-actions">
                <button
                  className="admin-config__btn admin-config__btn--small"
                  onClick={() => onEdit(config)}
                >
                  Edit
                </button>
                <button
                  className="admin-config__btn admin-config__btn--small admin-config__btn--danger"
                  onClick={() => onDelete(config.category, config.key)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Config Edit Modal
interface ConfigEditModalProps {
  config: ConfigValue;
  onSave: (value: unknown, description?: string) => void;
  onClose: () => void;
}

function ConfigEditModal({ config, onSave, onClose }: ConfigEditModalProps) {
  const [value, setValue] = useState(
    typeof config.value === 'object' ? JSON.stringify(config.value, null, 2) : String(config.value)
  );
  const [description, setDescription] = useState(config.description || '');
  const [valueType, setValueType] = useState<'string' | 'number' | 'boolean' | 'json'>(config.valueType);

  const handleSave = () => {
    let parsedValue: unknown = value;

    if (valueType === 'number') {
      parsedValue = Number(value);
      if (isNaN(parsedValue as number)) {
        alert('Invalid number');
        return;
      }
    } else if (valueType === 'boolean') {
      parsedValue = value === 'true';
    } else if (valueType === 'json') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        alert('Invalid JSON');
        return;
      }
    }

    onSave(parsedValue, description);
  };

  return (
    <div className="admin-config__edit-overlay" onClick={onClose}>
      <div className="admin-config__edit-modal" onClick={e => e.stopPropagation()}>
        <h3>Edit: {config.category}/{config.key}</h3>

        <div className="admin-config__form-group">
          <label>Value Type</label>
          <select
            value={valueType}
            onChange={e => setValueType(e.target.value as typeof valueType)}
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="json">JSON</option>
          </select>
        </div>

        <div className="admin-config__form-group">
          <label>Value</label>
          {valueType === 'boolean' ? (
            <select value={value} onChange={e => setValue(e.target.value)}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : valueType === 'json' ? (
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={6}
              className="admin-config__textarea--code"
            />
          ) : (
            <input
              type={valueType === 'number' ? 'number' : 'text'}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
          )}
        </div>

        <div className="admin-config__form-group">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="admin-config__edit-actions">
          <button className="admin-config__btn" onClick={onClose}>
            Cancel
          </button>
          <button className="admin-config__btn admin-config__btn--primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// New Config Modal
interface NewConfigModalProps {
  category: ConfigCategory;
  onSave: (key: string, value: unknown, description?: string) => void;
  onClose: () => void;
}

function NewConfigModal({ category, onSave, onClose }: NewConfigModalProps) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [valueType, setValueType] = useState<'string' | 'number' | 'boolean' | 'json'>('string');

  const handleSave = () => {
    if (!key.trim()) {
      alert('Key is required');
      return;
    }

    let parsedValue: unknown = value;

    if (valueType === 'number') {
      parsedValue = Number(value);
      if (isNaN(parsedValue as number)) {
        alert('Invalid number');
        return;
      }
    } else if (valueType === 'boolean') {
      parsedValue = value === 'true';
    } else if (valueType === 'json') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        alert('Invalid JSON');
        return;
      }
    }

    onSave(key, parsedValue, description);
  };

  return (
    <div className="admin-config__edit-overlay" onClick={onClose}>
      <div className="admin-config__edit-modal" onClick={e => e.stopPropagation()}>
        <h3>New Config: {category}</h3>

        <div className="admin-config__form-group">
          <label>Key</label>
          <input
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="config_key_name"
          />
        </div>

        <div className="admin-config__form-group">
          <label>Value Type</label>
          <select
            value={valueType}
            onChange={e => setValueType(e.target.value as typeof valueType)}
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="json">JSON</option>
          </select>
        </div>

        <div className="admin-config__form-group">
          <label>Value</label>
          {valueType === 'boolean' ? (
            <select value={value} onChange={e => setValue(e.target.value)}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : valueType === 'json' ? (
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={6}
              placeholder="{}"
              className="admin-config__textarea--code"
            />
          ) : (
            <input
              type={valueType === 'number' ? 'number' : 'text'}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
          )}
        </div>

        <div className="admin-config__form-group">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="admin-config__edit-actions">
          <button className="admin-config__btn" onClick={onClose}>
            Cancel
          </button>
          <button className="admin-config__btn admin-config__btn--primary" onClick={handleSave}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default AdminConfigPanel;
