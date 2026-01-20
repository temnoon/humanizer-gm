/**
 * RelatedPassagesPanel - Shows passages related by a shared keyword
 *
 * Displays a list of passages where the keyword is central,
 * ranked by TF-IDF centrality score.
 */

import { useState, useEffect, useCallback } from 'react';
import { getArchiveServerUrl, getArchiveServerUrlSync } from '../../lib/platform';
import { useBuffers } from '../../lib/buffer';
import { sanitizeText } from '../../lib/book-studio/sanitize';
import './RelatedPassagesPanel.css';

// ============================================================================
// Types
// ============================================================================

interface KeywordScore {
  keyword: string;
  occurrences: number;
  tf: number;
  idf: number;
  tfidf: number;
  titleMatch: boolean;
  positionBonus: boolean;
  centrality: number;
}

interface ContentNode {
  id: string;
  content: {
    text: string;
    format: string;
  };
  metadata: {
    title?: string;
    createdAt: number;
    wordCount: number;
  };
  source: {
    type: string;
  };
}

interface RelatedResult {
  node: ContentNode;
  score: KeywordScore;
}

interface RelatedPassagesPanelProps {
  keyword: string;
  sourceNodeId?: string;
  onClose: () => void;
  onSelectPassage?: (node: ContentNode) => void;
}

// ============================================================================
// Component
// ============================================================================

export function RelatedPassagesPanel({
  keyword,
  sourceNodeId,
  onClose,
  onSelectPassage,
}: RelatedPassagesPanelProps) {
  const { importText } = useBuffers();
  const [results, setResults] = useState<RelatedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch related passages
  useEffect(() => {
    fetchRelated();
  }, [keyword, sourceNodeId]);

  const fetchRelated = async () => {
    try {
      setLoading(true);
      setError(null);

      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/ucg/nodes/by-keyword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          excludeNodeId: sourceNodeId,
          limit: 20,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch related passages');
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('Failed to fetch related passages:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  };

  // Format centrality as visual bar
  const formatCentrality = (score: KeywordScore) => {
    // Normalize to 0-100 scale (centrality values are typically 0-0.1)
    const normalized = Math.min(100, Math.round(score.centrality * 1000));
    return normalized;
  };

  // Format preview text with keyword highlighted
  const formatPreview = (text: string, maxLength: number = 150): string => {
    // Sanitize first to strip any HTML
    const cleanText = sanitizeText(text);
    // Find the keyword in the text and show context around it
    const keywordLower = keyword.toLowerCase();
    const textLower = cleanText.toLowerCase();
    const keywordIndex = textLower.indexOf(keywordLower);

    if (keywordIndex === -1) {
      return cleanText.length > maxLength ? cleanText.slice(0, maxLength) + '...' : cleanText;
    }

    // Show text centered around the keyword
    const start = Math.max(0, keywordIndex - 50);
    const end = Math.min(cleanText.length, keywordIndex + keyword.length + 100);
    let preview = cleanText.slice(start, end);

    if (start > 0) preview = '...' + preview;
    if (end < cleanText.length) preview = preview + '...';

    return preview;
  };

  // Handle opening a passage in workspace
  const handleOpenInWorkspace = useCallback((node: ContentNode) => {
    const title = node.metadata.title || 'Untitled';

    // Transform media URLs to include archive server prefix
    // This ensures images render correctly when workspace is on a different port
    const archiveServer = getArchiveServerUrlSync();
    let content = node.content.text;

    // Transform file-service:// URLs
    content = content.replace(/file-service:\/\/file-[a-zA-Z0-9_-]+/g, (match) => {
      return `${archiveServer || ''}/api/ucg/media/by-pointer?pointer=${encodeURIComponent(match)}`;
    });

    // Transform relative /api/ URLs to absolute URLs
    if (archiveServer) {
      content = content.replace(
        /(!\[[^\]]*\]|\[[^\]]*\])\(\/api\//g,
        `$1(${archiveServer}/api/`
      );
    }

    importText(content, title, {
      type: (node.source.type === 'facebook' ? 'facebook' : 'chatgpt') as 'chatgpt' | 'facebook',
      path: [node.source.type, title],
    });
    onClose();
  }, [importText, onClose]);

  // Get source icon
  const getSourceIcon = (type: string): string => {
    const icons: Record<string, string> = {
      'chatgpt': '💬',
      'claude': '🤖',
      'gemini': '✨',
      'facebook': '👤',
      'markdown': '📄',
    };
    return icons[type] || '📋';
  };

  return (
    <div className="related-passages-panel">
      <div className="related-passages-panel__backdrop" onClick={onClose} />

      <div className="related-passages-panel__content">
        <header className="related-passages-panel__header">
          <div className="related-passages-panel__title">
            <span className="related-passages-panel__keyword">{keyword}</span>
            <span className="related-passages-panel__subtitle">
              {loading ? 'Searching...' : `${results.length} related passages`}
            </span>
          </div>
          <button
            type="button"
            className="related-passages-panel__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="related-passages-panel__error">
            {error}
          </div>
        )}

        <div className="related-passages-panel__list">
          {loading ? (
            <div className="related-passages-panel__loading">
              <span className="related-passages-panel__spinner" />
              Finding passages where "{keyword}" is central...
            </div>
          ) : results.length === 0 ? (
            <div className="related-passages-panel__empty">
              No other passages found with "{keyword}" as a central keyword.
            </div>
          ) : (
            results.map(({ node, score }) => (
              <article
                key={node.id}
                className="related-passages-panel__item"
                onClick={() => onSelectPassage?.(node)}
              >
                <div className="related-passages-panel__item-header">
                  <span className="related-passages-panel__item-icon">
                    {getSourceIcon(node.source.type)}
                  </span>
                  <span className="related-passages-panel__item-title">
                    {node.metadata.title || 'Untitled'}
                  </span>
                  <button
                    type="button"
                    className="related-passages-panel__item-open"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenInWorkspace(node);
                    }}
                    title="Open in workspace"
                  >
                    Open
                  </button>
                </div>

                <p className="related-passages-panel__item-preview">
                  {formatPreview(node.content.text)}
                </p>

                <div className="related-passages-panel__item-meta">
                  <div className="related-passages-panel__centrality">
                    <span className="related-passages-panel__centrality-label">
                      Centrality
                    </span>
                    <div className="related-passages-panel__centrality-bar">
                      <div
                        className="related-passages-panel__centrality-fill"
                        style={{ width: `${formatCentrality(score)}%` }}
                      />
                    </div>
                    <span className="related-passages-panel__centrality-value">
                      {score.occurrences}×
                    </span>
                  </div>
                  <div className="related-passages-panel__badges">
                    {score.titleMatch && (
                      <span className="related-passages-panel__badge related-passages-panel__badge--title">
                        in title
                      </span>
                    )}
                    {score.positionBonus && (
                      <span className="related-passages-panel__badge related-passages-panel__badge--position">
                        early
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
