/**
 * AnalyzableMarkdown - Markdown viewer with analysis overlay support
 *
 * Features:
 * - Normal markdown rendering (view/edit modes)
 * - Highlighted text with analysis overlays (analyze mode)
 * - XSS sanitization for all content
 * - JSON content extraction (DALL-E, Artifacts, Canvas)
 *
 * Uses LayoutContext for mode and highlight state.
 */

import { useMemo, type MouseEvent } from 'react';
import { MathMarkdown } from '../markdown';

import { HighlightableText } from './HighlightableText';
import { useHighlights, useSplitMode } from '../layout/LayoutContext';
import { mapAnalysisDataToHighlights } from '../../lib/analysis';
import type { HighlightRange } from '../../lib/analysis';
import { sanitizeMarkdown, processContent, looksLikeStructuredContent } from '../../lib/content';

// ============================================
// Types
// ============================================

interface AnalyzableMarkdownProps {
  /** Raw text content */
  content: string;
  /** Additional className */
  className?: string;
  /** Callback when a highlight is clicked */
  onHighlightClick?: (highlight: HighlightRange, event: MouseEvent) => void;
  /** Force a specific mode (overrides context) */
  forceMode?: 'markdown' | 'highlight';
}

// ============================================
// Component
// ============================================

export function AnalyzableMarkdown({
  content,
  className = '',
  onHighlightClick,
  forceMode,
}: AnalyzableMarkdownProps) {
  const { mode } = useSplitMode();
  const { activeHighlights, analysisData } = useHighlights();

  // Process content: extract from JSON structures and sanitize
  const processedContent = useMemo(() => {
    let processed = content;

    // If content looks like structured JSON (DALL-E, Artifacts, Canvas), extract it
    if (looksLikeStructuredContent(content)) {
      processed = processContent(content);
    }

    // Sanitize for XSS protection
    return sanitizeMarkdown(processed);
  }, [content]);

  // Compute highlights from analysis data
  const highlights = useMemo(() => {
    if (activeHighlights.length === 0 || Object.keys(analysisData).length === 0) {
      return [];
    }
    return mapAnalysisDataToHighlights(analysisData, processedContent, activeHighlights);
  }, [analysisData, processedContent, activeHighlights]);

  // Determine render mode
  // DISABLED: HighlightableText breaks images, LaTeX, and all markdown rendering
  // TODO: Reimplement highlighting that works WITH markdown, not instead of it
  const shouldShowHighlights = useMemo(() => {
    // Always use markdown rendering - highlighting is broken for MVP
    return false;
  }, [forceMode, mode, highlights.length]);

  // Render highlighted text for analysis
  if (shouldShowHighlights) {
    return (
      <div className={`analyzable-markdown analyzable-markdown--highlight ${className}`.trim()}>
        <HighlightableText
          content={processedContent}
          highlights={highlights}
          activeLayers={activeHighlights}
          onHighlightClick={onHighlightClick}
          className="highlightable-text--prose"
        />
      </div>
    );
  }

  // Render standard markdown
  return (
    <div className={`analyzable-markdown analyzable-markdown--markdown ${className}`.trim()}>
      <MathMarkdown>{processedContent}</MathMarkdown>
    </div>
  );
}

// ============================================
// Specialized: With Inline Metrics Toggle
// ============================================

interface AnalyzableMarkdownWithMetricsProps extends AnalyzableMarkdownProps {
  /** Whether to show the metrics sidebar */
  showMetrics?: boolean;
  /** Toggle metrics sidebar */
  onToggleMetrics?: () => void;
}

export function AnalyzableMarkdownWithMetrics({
  content,
  className = '',
  onHighlightClick,
  forceMode,
  showMetrics = false,
  onToggleMetrics,
}: AnalyzableMarkdownWithMetricsProps) {
  const { activeHighlights, analysisData } = useHighlights();

  // Quick summary metrics
  const metrics = useMemo(() => {
    if (!analysisData.sentences) return null;

    const total = analysisData.sentences.length;
    const suspect = analysisData.sentences.filter((s) => s.isSuspect).length;
    const avgScore =
      analysisData.sentences.reduce((sum, s) => sum + s.aiLikelihood, 0) / total;

    return { total, suspect, avgScore };
  }, [analysisData.sentences]);

  return (
    <div className={`analyzable-markdown-container ${className}`.trim()}>
      <AnalyzableMarkdown
        content={content}
        onHighlightClick={onHighlightClick}
        forceMode={forceMode}
        className="analyzable-markdown-container__content"
      />

      {/* Metrics sidebar (collapsible) */}
      <aside className={`metrics-sidebar ${showMetrics ? 'metrics-sidebar--open' : ''}`}>
        <header className="metrics-sidebar__header">
          <h3 className="metrics-sidebar__title">Analysis</h3>
          <button
            className="metrics-sidebar__close"
            onClick={onToggleMetrics}
            aria-label="Close metrics panel"
          >
            ✕
          </button>
        </header>

        <div className="metrics-sidebar__content">
          {metrics && (
            <div className="metrics-sidebar__section">
              <h4>Sentence Analysis</h4>
              <div className="metric-score">
                <span className="metric-score__label">Sentences</span>
                <span className="metric-score__value">{metrics.total}</span>
              </div>
              <div className="metric-score">
                <span className="metric-score__label">Flagged</span>
                <span className="metric-score__value metric-score__value--warning">
                  {metrics.suspect}
                </span>
              </div>
              <div className="metric-score">
                <span className="metric-score__label">Avg AI Score</span>
                <span className="metric-score__value">
                  {metrics.avgScore.toFixed(1)}%
                </span>
              </div>
              <div className="metric-bar">
                <div
                  className="metric-bar__fill"
                  style={{ width: `${metrics.avgScore}%` }}
                />
              </div>
            </div>
          )}

          {analysisData.gptzero && (
            <div className="metrics-sidebar__section">
              <h4>GPTZero</h4>
              <div className="metric-score">
                <span className="metric-score__label">Verdict</span>
                <span className="metric-score__value">
                  {analysisData.gptzero.verdict.toUpperCase()}
                </span>
              </div>
              <div className="metric-score">
                <span className="metric-score__label">Confidence</span>
                <span className="metric-score__value">
                  {(analysisData.gptzero.confidence * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {analysisData.tellPhrases && analysisData.tellPhrases.length > 0 && (
            <div className="metrics-sidebar__section">
              <h4>Tell Phrases</h4>
              <div className="metric-score">
                <span className="metric-score__label">Found</span>
                <span className="metric-score__value">
                  {analysisData.tellPhrases.length}
                </span>
              </div>
            </div>
          )}

          {activeHighlights.length > 0 && (
            <div className="metrics-sidebar__section">
              <h4>Active Layers</h4>
              <ul className="metrics-sidebar__layers">
                {activeHighlights.map((layer) => (
                  <li key={layer} className="metrics-sidebar__layer">
                    {layer.replace('-', ' ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default AnalyzableMarkdown;
