/**
 * Audit Log Viewer
 *
 * Component for viewing configuration change history.
 */

import { useState, useEffect } from 'react';
import { useAdminConfig, type AuditLogEntry, type ConfigCategory } from './useAdminConfig';
import './admin-config.css';

const CATEGORIES: { key: ConfigCategory | ''; label: string }[] = [
  { key: '', label: 'All Categories' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'features', label: 'Features' },
  { key: 'limits', label: 'Limits' },
  { key: 'ui', label: 'UI' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'secrets', label: 'Secrets' },
];

export function AuditLogViewer() {
  const { auditLog, loading, error, loadAuditLog } = useAdminConfig();
  const [categoryFilter, setCategoryFilter] = useState<ConfigCategory | ''>('');
  const [limit, setLimit] = useState(50);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  useEffect(() => {
    loadAuditLog({
      category: categoryFilter || undefined,
      limit,
    });
  }, [loadAuditLog, categoryFilter, limit]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatAction = (action: string) => {
    switch (action) {
      case 'create':
        return { label: 'Created', className: 'admin-config__action--create' };
      case 'update':
        return { label: 'Updated', className: 'admin-config__action--update' };
      case 'delete':
        return { label: 'Deleted', className: 'admin-config__action--delete' };
      default:
        return { label: action, className: '' };
    }
  };

  if (error) {
    return <div className="admin-config__error-inline">{error}</div>;
  }

  return (
    <div className="admin-config__audit-tab">
      <div className="admin-config__list-header">
        <h3>Configuration Audit Log</h3>
        <div className="admin-config__audit-filters">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value as ConfigCategory | '')}
            className="admin-config__select"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.key} value={cat.key}>
                {cat.label}
              </option>
            ))}
          </select>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="admin-config__select"
          >
            <option value={25}>Last 25</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={200}>Last 200</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="admin-config__loading">Loading audit log...</div>
      ) : auditLog.length === 0 ? (
        <div className="admin-config__empty">No audit entries found.</div>
      ) : (
        <div className="admin-config__audit-list">
          {auditLog.map(entry => (
            <AuditEntry
              key={entry.id}
              entry={entry}
              isExpanded={expandedEntry === entry.id}
              onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
              formatDate={formatDate}
              formatAction={formatAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Audit Entry Component
interface AuditEntryProps {
  entry: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  formatDate: (timestamp: number) => string;
  formatAction: (action: string) => { label: string; className: string };
}

function AuditEntry({ entry, isExpanded, onToggle, formatDate, formatAction }: AuditEntryProps) {
  const action = formatAction(entry.action);

  return (
    <div className={`admin-config__audit-entry ${isExpanded ? 'admin-config__audit-entry--expanded' : ''}`}>
      <div className="admin-config__audit-entry-header" onClick={onToggle}>
        <div className="admin-config__audit-entry-main">
          <span className={`admin-config__audit-action ${action.className}`}>
            {action.label}
          </span>
          <span className="admin-config__audit-key">
            {entry.category}/{entry.key}
          </span>
        </div>
        <div className="admin-config__audit-entry-meta">
          <span className="admin-config__audit-user">
            {entry.changedByEmail || entry.changedBy}
          </span>
          <span className="admin-config__audit-time">
            {formatDate(entry.createdAt)}
          </span>
          <span className="admin-config__audit-expand">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="admin-config__audit-entry-details">
          {entry.reason && (
            <div className="admin-config__audit-detail">
              <span className="admin-config__audit-detail-label">Reason:</span>
              <span className="admin-config__audit-detail-value">{entry.reason}</span>
            </div>
          )}

          {entry.oldValue !== undefined && entry.oldValue !== null && (
            <div className="admin-config__audit-detail">
              <span className="admin-config__audit-detail-label">Old Value:</span>
              <pre className="admin-config__audit-detail-code">
                {formatAuditValue(entry.oldValue)}
              </pre>
            </div>
          )}

          {entry.newValue !== undefined && entry.newValue !== null && (
            <div className="admin-config__audit-detail">
              <span className="admin-config__audit-detail-label">New Value:</span>
              <pre className="admin-config__audit-detail-code">
                {formatAuditValue(entry.newValue)}
              </pre>
            </div>
          )}

          {entry.ipAddress && (
            <div className="admin-config__audit-detail">
              <span className="admin-config__audit-detail-label">IP Address:</span>
              <span className="admin-config__audit-detail-value">{entry.ipAddress}</span>
            </div>
          )}

          <div className="admin-config__audit-detail">
            <span className="admin-config__audit-detail-label">User ID:</span>
            <span className="admin-config__audit-detail-value admin-config__audit-detail-value--mono">
              {entry.changedBy}
            </span>
          </div>

          <div className="admin-config__audit-detail">
            <span className="admin-config__audit-detail-label">Config ID:</span>
            <span className="admin-config__audit-detail-value admin-config__audit-detail-value--mono">
              {entry.configId}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function
function formatAuditValue(value: string): string {
  // Try to parse and pretty-print JSON
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export default AuditLogViewer;
