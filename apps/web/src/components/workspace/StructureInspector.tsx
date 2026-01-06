/**
 * StructureInspector - Peek behind the curtain at archive data structure
 *
 * Design philosophy:
 * - Doesn't break the "almost a book" illusion
 * - Toggleable with subtle control (like developer tools)
 * - Shows where data lives without overwhelming
 * - Teaches users the data model by exploration
 */

import { useState, useMemo } from 'react';
import type { ArchiveContainer } from '@humanizer/core';
import { getArchiveServerUrlSync, isElectron } from '../../lib/platform';

/**
 * Get media URL from file path - handles Electron vs browser
 */
function getMediaUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('local-media://')) {
    return filePath;
  }
  if (isElectron) {
    return `local-media://serve${filePath}`;
  }
  const archiveServer = getArchiveServerUrlSync();
  if (!archiveServer) {
    console.warn('Archive server URL not initialized');
    return filePath;
  }
  return `${archiveServer}/media/${filePath}`;
}

interface StructureInspectorProps {
  container: ArchiveContainer | null;
  isOpen: boolean;
  onToggle: () => void;
  onNavigate?: (uri: string) => void;
}

/**
 * Compact structure view - the "peek" mode
 */
export function StructureInspector({
  container,
  isOpen,
  onToggle,
  onNavigate
}: StructureInspectorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['content']));

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Compute structure summary
  const structure = useMemo(() => {
    if (!container) return null;

    const contentSize = {
      raw: container.content.raw?.length ?? 0,
      rendered: container.content.rendered?.length ?? 0,
      messages: container.content.messages?.length ?? 0,
      artifacts: container.content.artifacts?.length ?? 0,
      thinking: container.content.thinking?.length ?? 0,
    };

    const totalSize = contentSize.raw + contentSize.rendered;
    const hasNested = contentSize.messages > 0 || contentSize.artifacts > 0;

    return {
      uri: container.uri || `archive://${container.source?.type}/${container.id}`,
      type: container.type,
      source: container.source?.type || 'unknown',
      contentSize,
      totalSize,
      hasNested,
      meta: container.meta,
      mediaCount: container.media?.length ?? 0,
    };
  }, [container]);

  if (!container) {
    return null;
  }

  // Toggle button (always visible)
  const toggleButton = (
    <button
      className="structure-inspector__toggle"
      onClick={onToggle}
      title={isOpen ? 'Hide structure' : 'Inspect structure'}
      aria-expanded={isOpen}
    >
      <span className="structure-inspector__toggle-icon">
        {isOpen ? '⌄' : '{ }'}
      </span>
    </button>
  );

  if (!isOpen) {
    return toggleButton;
  }

  return (
    <aside className="structure-inspector" role="complementary" aria-label="Data structure inspector">
      <header className="structure-inspector__header">
        <h3 className="structure-inspector__title">Structure</h3>
        {toggleButton}
      </header>

      <div className="structure-inspector__content">
        {/* Identity */}
        <section className="structure-inspector__section">
          <div className="structure-inspector__identity">
            <span className="structure-inspector__type-badge">{structure?.type}</span>
            <span className="structure-inspector__source-badge">{structure?.source}</span>
          </div>
          <code className="structure-inspector__uri" title="Click to copy">
            {structure?.uri}
          </code>
        </section>

        {/* Content Paths - Collapsible */}
        <section className="structure-inspector__section">
          <button
            className="structure-inspector__section-header"
            onClick={() => toggleSection('content')}
            aria-expanded={expandedSections.has('content')}
          >
            <span>Content</span>
            <span className="structure-inspector__size">
              {formatBytes(structure?.totalSize ?? 0)}
            </span>
            <span className="structure-inspector__chevron">
              {expandedSections.has('content') ? '▾' : '▸'}
            </span>
          </button>

          {expandedSections.has('content') && (
            <div className="structure-inspector__tree">
              <TreeItem
                label="raw"
                value={`string (${formatBytes(structure?.contentSize.raw ?? 0)})`}
                highlight={structure?.contentSize.raw ? structure.contentSize.raw > 0 : false}
              />
              <TreeItem
                label="rendered"
                value={structure?.contentSize.rendered ? `string (${formatBytes(structure.contentSize.rendered)})` : '—'}
                highlight={false}
              />
              {structure?.contentSize.messages ? (
                <TreeItem
                  label="messages"
                  value={`Array[${structure.contentSize.messages}]`}
                  highlight
                />
              ) : null}
              {structure?.contentSize.artifacts ? (
                <TreeItem
                  label="artifacts"
                  value={`Array[${structure.contentSize.artifacts}]`}
                  highlight
                />
              ) : null}
              {structure?.contentSize.thinking ? (
                <TreeItem
                  label="thinking"
                  value={`Array[${structure.contentSize.thinking}]`}
                  highlight
                />
              ) : null}
            </div>
          )}
        </section>

        {/* Metadata - Collapsible */}
        <section className="structure-inspector__section">
          <button
            className="structure-inspector__section-header"
            onClick={() => toggleSection('meta')}
            aria-expanded={expandedSections.has('meta')}
          >
            <span>Metadata</span>
            <span className="structure-inspector__chevron">
              {expandedSections.has('meta') ? '▾' : '▸'}
            </span>
          </button>

          {expandedSections.has('meta') && structure?.meta && (
            <div className="structure-inspector__tree">
              {structure.meta.title && (
                <TreeItem label="title" value={truncate(structure.meta.title, 40)} />
              )}
              {structure.meta.author && (
                <TreeItem label="author" value={structure.meta.author} />
              )}
              {structure.meta.wordCount !== undefined && (
                <TreeItem label="wordCount" value={structure.meta.wordCount.toLocaleString()} />
              )}
              {structure.meta.messageCount !== undefined && (
                <TreeItem label="messageCount" value={structure.meta.messageCount.toString()} />
              )}
              {structure.meta.created && (
                <TreeItem
                  label="created"
                  value={new Date(structure.meta.created).toLocaleDateString()}
                />
              )}
            </div>
          )}
        </section>

        {/* Media - if present */}
        {structure?.mediaCount ? (
          <section className="structure-inspector__section">
            <button
              className="structure-inspector__section-header"
              onClick={() => toggleSection('media')}
              aria-expanded={expandedSections.has('media')}
            >
              <span>Media</span>
              <span className="structure-inspector__count">{structure.mediaCount}</span>
              <span className="structure-inspector__chevron">
                {expandedSections.has('media') ? '▾' : '▸'}
              </span>
            </button>

            {expandedSections.has('media') && container.media && (
              <div className="structure-inspector__media-grid">
                {container.media.slice(0, 4).map((m, i) => (
                  <div key={i} className="structure-inspector__media-thumb">
                    {m.mediaType === 'image' && m.filePath && (
                      <img
                        src={getMediaUrl(m.filePath)}
                        alt={m.description || `Media ${i + 1}`}
                      />
                    )}
                    <span className="structure-inspector__media-type">{m.mediaType}</span>
                  </div>
                ))}
                {structure.mediaCount > 4 && (
                  <div className="structure-inspector__media-more">
                    +{structure.mediaCount - 4}
                  </div>
                )}
              </div>
            )}
          </section>
        ) : null}

        {/* Source tracking */}
        {container.source && (
          <section className="structure-inspector__section structure-inspector__section--muted">
            <div className="structure-inspector__source-info">
              <span>Source: {container.source.type}</span>
              {container.source.originalId && (
                <code className="structure-inspector__original-id">
                  {truncate(container.source.originalId, 20)}
                </code>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

/**
 * Tree item for displaying nested structure
 */
function TreeItem({
  label,
  value,
  highlight = false
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`structure-inspector__tree-item ${highlight ? 'structure-inspector__tree-item--highlight' : ''}`}>
      <span className="structure-inspector__tree-label">{label}:</span>
      <span className="structure-inspector__tree-value">{value}</span>
    </div>
  );
}

/**
 * Format bytes to human-readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

export default StructureInspector;
