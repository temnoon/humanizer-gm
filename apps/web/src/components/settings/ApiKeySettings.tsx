/**
 * API Key Settings Component
 *
 * Manages API keys for cloud LLM providers.
 * Features:
 * - List all providers with status
 * - Add/update/remove API keys
 * - Validate keys with provider API
 * - Display usage statistics
 */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './ApiKeySettings.css';

// ═══════════════════════════════════════════════════════════════════
// TYPES (mirror of electron/preload/types/core.ts)
// ═══════════════════════════════════════════════════════════════════

interface ProviderStatus {
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

interface UsageStats {
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

interface AIConfigAPI {
  getProviders: () => Promise<ProviderStatus[]>;
  setApiKey: (provider: string, apiKey: string) => Promise<{ success: boolean; error?: string }>;
  removeKey: (provider: string) => Promise<{ success: boolean; error?: string }>;
  validateKey: (provider: string) => Promise<{ valid: boolean; error?: string }>;
  getUsage: () => Promise<UsageStats>;
}

/**
 * Get the AI config API from electron bridge
 */
function getAIConfigAPI(): AIConfigAPI | null {
  const electronAPI = (window as { electronAPI?: { aiConfig?: AIConfigAPI } }).electronAPI;
  return electronAPI?.aiConfig ?? null;
}

// Provider metadata
const PROVIDER_INFO: Record<string, { name: string; icon: string; description: string; docsUrl: string }> = {
  ollama: {
    name: 'Ollama',
    icon: '🦙',
    description: 'Local LLM inference (free)',
    docsUrl: 'https://ollama.ai/',
  },
  openai: {
    name: 'OpenAI',
    icon: '🤖',
    description: 'GPT-4, GPT-4o, o1',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    name: 'Anthropic',
    icon: '🧠',
    description: 'Claude 3.5, Claude 3',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  together: {
    name: 'Together',
    icon: '🤝',
    description: 'Open-source models, fast inference',
    docsUrl: 'https://api.together.ai/settings/api-keys',
  },
  openrouter: {
    name: 'OpenRouter',
    icon: '🔀',
    description: '100+ models, one API',
    docsUrl: 'https://openrouter.ai/keys',
  },
  cloudflare: {
    name: 'Cloudflare AI',
    icon: '☁️',
    description: 'Edge inference, free tier',
    docsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
  },
  groq: {
    name: 'Groq',
    icon: '⚡',
    description: 'Ultra-fast inference',
    docsUrl: 'https://console.groq.com/keys',
  },
  google: {
    name: 'Google AI',
    icon: '🔮',
    description: 'Gemini Pro, Gemini Flash',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  mistral: {
    name: 'Mistral',
    icon: '🌀',
    description: 'Mistral Large, Mistral Nemo',
    docsUrl: 'https://console.mistral.ai/api-keys/',
  },
  deepseek: {
    name: 'DeepSeek',
    icon: '🔍',
    description: 'DeepSeek V3, DeepSeek Coder',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
};

// Order providers display
const PROVIDER_ORDER = [
  'ollama',
  'openrouter',
  'together',
  'openai',
  'anthropic',
  'cloudflare',
  'groq',
  'google',
  'mistral',
  'deepseek',
];

interface ApiKeySettingsModalProps {
  onClose: () => void;
}

export function ApiKeySettingsModal({ onClose }: ApiKeySettingsModalProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);

  // Load providers and usage
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const api = getAIConfigAPI();
      if (!api) {
        setError('AI configuration not available');
        return;
      }

      const [providerData, usageData] = await Promise.all([
        api.getProviders(),
        api.getUsage(),
      ]);

      setProviders(providerData);
      setUsage(usageData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle save API key
  const handleSaveKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return;

    const api = getAIConfigAPI();
    if (!api) return;

    try {
      setValidating(true);
      const result = await api.setApiKey(editingProvider, apiKeyInput.trim());

      if (result.success) {
        setEditingProvider(null);
        setApiKeyInput('');
        setValidationResult(null);
        await loadData();
      } else {
        setValidationResult({ valid: false, error: result.error });
      }
    } catch (err) {
      setValidationResult({ valid: false, error: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setValidating(false);
    }
  };

  // Handle remove API key
  const handleRemoveKey = async (provider: string) => {
    const api = getAIConfigAPI();
    if (!api) return;

    if (!confirm(`Remove API key for ${PROVIDER_INFO[provider]?.name || provider}?`)) {
      return;
    }

    try {
      const result = await api.removeKey(provider);
      if (result.success) {
        await loadData();
      }
    } catch (err) {
      console.error('Failed to remove key:', err);
    }
  };

  // Handle validate API key
  const handleValidateKey = async () => {
    if (!editingProvider) return;

    const api = getAIConfigAPI();
    if (!api) return;

    try {
      setValidating(true);
      const result = await api.validateKey(editingProvider);
      setValidationResult(result);
    } catch (err) {
      setValidationResult({ valid: false, error: err instanceof Error ? err.message : 'Validation failed' });
    } finally {
      setValidating(false);
    }
  };

  // Sort providers
  const sortedProviders = [...providers].sort((a, b) => {
    const aIndex = PROVIDER_ORDER.indexOf(a.provider);
    const bIndex = PROVIDER_ORDER.indexOf(b.provider);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  const modalContent = (
    <div
      className="api-settings-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-settings-title"
    >
      <div className="api-settings-modal__content" onClick={e => e.stopPropagation()}>
        <div className="api-settings-modal__header">
          <h2 id="api-settings-title" className="api-settings-modal__title">AI Providers</h2>
          <button
            className="api-settings-modal__close"
            onClick={onClose}
            aria-label="Close settings"
            autoFocus
          >
            &times;
          </button>
        </div>

        {/* Usage Stats */}
        {usage && (
          <div className="api-settings__usage">
            <div className="api-settings__usage-card">
              <span className="api-settings__usage-label">Today</span>
              <span className="api-settings__usage-value">{usage.daily.formatted.tokens}</span>
              <span className="api-settings__usage-cost">{usage.daily.formatted.cost}</span>
            </div>
            <div className="api-settings__usage-card">
              <span className="api-settings__usage-label">This Month</span>
              <span className="api-settings__usage-value">{usage.monthly.formatted.tokens}</span>
              <span className="api-settings__usage-cost">{usage.monthly.formatted.cost}</span>
            </div>
            <div className="api-settings__usage-card">
              <span className="api-settings__usage-label">Projected</span>
              <span className="api-settings__usage-value">/mo</span>
              <span className="api-settings__usage-cost">{usage.projected.formatted}</span>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="api-settings__error">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="api-settings__loading">
            Loading providers...
          </div>
        )}

        {/* Provider list */}
        {!loading && (
          <div className="api-settings__providers">
            {sortedProviders.map(provider => {
              const info = PROVIDER_INFO[provider.provider];
              const isEditing = editingProvider === provider.provider;

              return (
                <div
                  key={provider.provider}
                  className={`api-settings__provider ${provider.configured ? 'api-settings__provider--configured' : ''}`}
                >
                  <div className="api-settings__provider-header">
                    <span className="api-settings__provider-icon">{info?.icon || '🔌'}</span>
                    <div className="api-settings__provider-info">
                      <span className="api-settings__provider-name">{info?.name || provider.provider}</span>
                      <span className="api-settings__provider-desc">{info?.description || ''}</span>
                    </div>
                    <div className="api-settings__provider-status">
                      {provider.configured ? (
                        <span className="api-settings__status api-settings__status--configured">
                          {provider.encrypted ? '🔒' : '⚠️'} Configured
                        </span>
                      ) : (
                        <span className="api-settings__status api-settings__status--not-configured">
                          Not configured
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Edit form */}
                  {isEditing ? (
                    <div className="api-settings__edit-form">
                      <input
                        type="password"
                        className="api-settings__input"
                        placeholder={`Enter ${info?.name || provider.provider} API key`}
                        value={apiKeyInput}
                        onChange={e => setApiKeyInput(e.target.value)}
                        autoFocus
                      />
                      {validationResult && (
                        <div className={`api-settings__validation ${validationResult.valid ? 'api-settings__validation--valid' : 'api-settings__validation--invalid'}`}>
                          {validationResult.valid ? 'Valid key' : validationResult.error || 'Invalid key'}
                        </div>
                      )}
                      <div className="api-settings__edit-actions">
                        <button
                          className="api-settings__btn api-settings__btn--secondary"
                          onClick={() => {
                            setEditingProvider(null);
                            setApiKeyInput('');
                            setValidationResult(null);
                          }}
                        >
                          Cancel
                        </button>
                        {info?.docsUrl && (
                          <a
                            href={info.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="api-settings__btn api-settings__btn--link"
                          >
                            Get key
                          </a>
                        )}
                        <button
                          className="api-settings__btn api-settings__btn--primary"
                          onClick={handleSaveKey}
                          disabled={!apiKeyInput.trim() || validating}
                        >
                          {validating ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="api-settings__provider-actions">
                      {provider.provider !== 'ollama' && (
                        <>
                          <button
                            className="api-settings__btn api-settings__btn--small"
                            onClick={() => {
                              setEditingProvider(provider.provider);
                              setApiKeyInput('');
                              setValidationResult(null);
                            }}
                          >
                            {provider.configured ? 'Update' : 'Add key'}
                          </button>
                          {provider.configured && (
                            <>
                              <button
                                className="api-settings__btn api-settings__btn--small"
                                onClick={() => {
                                  setEditingProvider(provider.provider);
                                  handleValidateKey();
                                }}
                              >
                                Test
                              </button>
                              <button
                                className="api-settings__btn api-settings__btn--small api-settings__btn--danger"
                                onClick={() => handleRemoveKey(provider.provider)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {provider.provider === 'ollama' && (
                        <span className="api-settings__local-badge">Local</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="api-settings__footer">
          <p className="api-settings__footer-text">
            API keys are encrypted and stored locally using your operating system's secure storage.
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

// Inline panel version (for embedding in settings page)
export function ApiKeySettingsPanel() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const api = getAIConfigAPI();
      if (!api) return;

      const [providerData, usageData] = await Promise.all([
        api.getProviders(),
        api.getUsage(),
      ]);

      setProviders(providerData);
      setUsage(usageData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveKey = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return;
    const api = getAIConfigAPI();
    if (!api) return;

    try {
      setValidating(true);
      const result = await api.setApiKey(editingProvider, apiKeyInput.trim());
      if (result.success) {
        setEditingProvider(null);
        setApiKeyInput('');
        setValidationResult(null);
        await loadData();
      } else {
        setValidationResult({ valid: false, error: result.error });
      }
    } finally {
      setValidating(false);
    }
  };

  const handleRemoveKey = async (provider: string) => {
    const api = getAIConfigAPI();
    if (!api) return;
    if (!confirm(`Remove API key for ${PROVIDER_INFO[provider]?.name || provider}?`)) return;

    const result = await api.removeKey(provider);
    if (result.success) {
      await loadData();
    }
  };

  const sortedProviders = [...providers].sort((a, b) => {
    const aIndex = PROVIDER_ORDER.indexOf(a.provider);
    const bIndex = PROVIDER_ORDER.indexOf(b.provider);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  if (loading) {
    return <div className="api-settings-panel__loading">Loading...</div>;
  }

  return (
    <div className="api-settings-panel">
      {/* Usage Stats */}
      {usage && (
        <div className="api-settings__usage">
          <div className="api-settings__usage-card">
            <span className="api-settings__usage-label">Today</span>
            <span className="api-settings__usage-value">{usage.daily.formatted.tokens}</span>
            <span className="api-settings__usage-cost">{usage.daily.formatted.cost}</span>
          </div>
          <div className="api-settings__usage-card">
            <span className="api-settings__usage-label">This Month</span>
            <span className="api-settings__usage-value">{usage.monthly.formatted.tokens}</span>
            <span className="api-settings__usage-cost">{usage.monthly.formatted.cost}</span>
          </div>
        </div>
      )}

      {/* Provider list */}
      <div className="api-settings__providers">
        {sortedProviders.map(provider => {
          const info = PROVIDER_INFO[provider.provider];
          const isEditing = editingProvider === provider.provider;

          return (
            <div
              key={provider.provider}
              className={`api-settings__provider ${provider.configured ? 'api-settings__provider--configured' : ''}`}
            >
              <div className="api-settings__provider-header">
                <span className="api-settings__provider-icon">{info?.icon || '🔌'}</span>
                <div className="api-settings__provider-info">
                  <span className="api-settings__provider-name">{info?.name || provider.provider}</span>
                  <span className="api-settings__provider-desc">{info?.description || ''}</span>
                </div>
                <div className="api-settings__provider-status">
                  {provider.configured ? (
                    <span className="api-settings__status api-settings__status--configured">
                      {provider.encrypted ? '🔒' : '⚠️'}
                    </span>
                  ) : (
                    <span className="api-settings__status api-settings__status--not-configured">
                      &mdash;
                    </span>
                  )}
                </div>
              </div>

              {isEditing ? (
                <div className="api-settings__edit-form">
                  <input
                    type="password"
                    className="api-settings__input"
                    placeholder={`Enter ${info?.name || provider.provider} API key`}
                    value={apiKeyInput}
                    onChange={e => setApiKeyInput(e.target.value)}
                    autoFocus
                  />
                  {validationResult && (
                    <div className={`api-settings__validation ${validationResult.valid ? 'api-settings__validation--valid' : 'api-settings__validation--invalid'}`}>
                      {validationResult.valid ? 'Valid' : validationResult.error || 'Invalid'}
                    </div>
                  )}
                  <div className="api-settings__edit-actions">
                    <button
                      className="api-settings__btn api-settings__btn--secondary"
                      onClick={() => {
                        setEditingProvider(null);
                        setApiKeyInput('');
                        setValidationResult(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="api-settings__btn api-settings__btn--primary"
                      onClick={handleSaveKey}
                      disabled={!apiKeyInput.trim() || validating}
                    >
                      {validating ? '...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="api-settings__provider-actions">
                  {provider.provider !== 'ollama' && (
                    <>
                      <button
                        className="api-settings__btn api-settings__btn--small"
                        onClick={() => {
                          setEditingProvider(provider.provider);
                          setApiKeyInput('');
                          setValidationResult(null);
                        }}
                      >
                        {provider.configured ? 'Edit' : 'Add'}
                      </button>
                      {provider.configured && (
                        <button
                          className="api-settings__btn api-settings__btn--small api-settings__btn--danger"
                          onClick={() => handleRemoveKey(provider.provider)}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                  {provider.provider === 'ollama' && (
                    <span className="api-settings__local-badge">Local</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
