/**
 * HighlightableText - Renders text with overlay highlights for analysis
 *
 * Supports multiple highlight layers that can be toggled independently:
 * - AI Detection (score-based gradient)
 * - GPTZero flagged sentences (premium)
 * - Tell-phrases (dotted underline)
 * - Diff (add/remove/change)
 * - Stylometry patterns
 */

import { useMemo, useCallback, type ReactNode, type MouseEvent } from 'react';
import type {
  HighlightRange,
  HighlightLayer,
  AIScoreLevel,
} from '../../lib/analysis';
import { getAIScoreLevel } from '../../lib/analysis';

// ============================================
// Types
// ============================================

interface HighlightableTextProps {
  /** Raw text content to render */
  content: string;
  /** Highlight ranges to apply (already filtered by active layers) */
  highlights: HighlightRange[];
  /** Active highlight layers (for CSS class selection) */
  activeLayers?: HighlightLayer[];
  /** Callback when a highlighted segment is clicked */
  onHighlightClick?: (highlight: HighlightRange, event: MouseEvent) => void;
  /** Callback when sentence is clicked (if using sentence-level analysis) */
  onSentenceClick?: (index: number, event: MouseEvent) => void;
  /** Additional className for wrapper */
  className?: string;
  /** Render content as HTML (careful with XSS) */
  renderAsHtml?: boolean;
}

interface TextSegment {
  start: number;
  end: number;
  text: string;
  highlights: HighlightRange[];
}

// ============================================
// Highlight Processing
// ============================================

/**
 * Flatten overlapping highlights into non-overlapping segments
 * Each segment has a list of all highlights that cover it
 */
function segmentText(content: string, highlights: HighlightRange[]): TextSegment[] {
  if (highlights.length === 0) {
    return [{ start: 0, end: content.length, text: content, highlights: [] }];
  }

  // Collect all boundary points
  const boundaries = new Set<number>([0, content.length]);
  for (const h of highlights) {
    boundaries.add(Math.max(0, h.start));
    boundaries.add(Math.min(content.length, h.end));
  }

  // Sort boundary points
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  // Create segments between each pair of boundaries
  const segments: TextSegment[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];

    // Find all highlights that cover this segment
    const coveringHighlights = highlights.filter(
      (h) => h.start <= start && h.end >= end
    );

    segments.push({
      start,
      end,
      text: content.slice(start, end),
      highlights: coveringHighlights,
    });
  }

  return segments;
}

/**
 * Get CSS classes for a highlight based on type and score
 */
function getHighlightClasses(highlight: HighlightRange): string {
  const classes = ['highlight'];

  switch (highlight.type) {
    case 'ai-detection': {
      const level: AIScoreLevel = getAIScoreLevel(highlight.score ?? 50);
      classes.push(`highlight--ai-${level}`);
      break;
    }
    case 'gptzero':
      classes.push('highlight--gptzero');
      break;
    case 'tell-phrases': {
      classes.push('highlight--tell-phrase');
      const direction = highlight.meta?.direction as string | undefined;
      if (direction === 'ai') {
        classes.push('highlight--tell-phrase-ai');
      } else if (direction === 'human') {
        classes.push('highlight--tell-phrase-human');
      }
      break;
    }
    case 'diff': {
      const changeType = highlight.meta?.changeType as string | undefined;
      if (changeType === 'add') {
        classes.push('highlight--diff-add');
      } else if (changeType === 'remove') {
        classes.push('highlight--diff-remove');
      } else {
        classes.push('highlight--diff-change');
      }
      break;
    }
    case 'stylometry':
      classes.push('highlight--stylometry');
      break;
  }

  return classes.join(' ');
}

/**
 * Merge CSS classes from multiple highlights
 */
function mergeHighlightClasses(highlights: HighlightRange[]): string {
  const allClasses = new Set<string>(['highlight']);

  for (const h of highlights) {
    const classes = getHighlightClasses(h).split(' ');
    classes.forEach((c) => allClasses.add(c));
  }

  return Array.from(allClasses).join(' ');
}

/**
 * Get the best tooltip from multiple highlights
 */
function getTooltip(highlights: HighlightRange[]): string {
  const reasons = highlights
    .map((h) => h.reason)
    .filter(Boolean)
    .slice(0, 3); // Max 3 reasons

  return reasons.join(' | ');
}

// ============================================
// Component
// ============================================

export function HighlightableText({
  content,
  highlights,
  activeLayers: _activeLayers,
  onHighlightClick,
  onSentenceClick: _onSentenceClick,
  className = '',
  renderAsHtml = false,
}: HighlightableTextProps) {
  // Segment the text based on highlights
  const segments = useMemo(
    () => segmentText(content, highlights),
    [content, highlights]
  );

  // Handle click on a segment
  const handleClick = useCallback(
    (segment: TextSegment, event: MouseEvent) => {
      if (segment.highlights.length > 0 && onHighlightClick) {
        // Use the highest-priority highlight
        const primaryHighlight = segment.highlights[0];
        onHighlightClick(primaryHighlight, event);
      }
    },
    [onHighlightClick]
  );

  // Render segments
  const renderedContent = useMemo((): ReactNode[] => {
    return segments.map((segment, index) => {
      if (segment.highlights.length === 0) {
        // No highlights - plain text
        if (renderAsHtml) {
          return (
            <span
              key={index}
              dangerouslySetInnerHTML={{ __html: segment.text }}
            />
          );
        }
        return <span key={index}>{segment.text}</span>;
      }

      // Has highlights - apply classes
      const classes = mergeHighlightClasses(segment.highlights);
      const tooltip = getTooltip(segment.highlights);

      if (renderAsHtml) {
        return (
          <span
            key={index}
            className={classes}
            data-tooltip={tooltip || undefined}
            onClick={(e) => handleClick(segment, e)}
            dangerouslySetInnerHTML={{ __html: segment.text }}
          />
        );
      }

      return (
        <span
          key={index}
          className={classes}
          data-tooltip={tooltip || undefined}
          onClick={(e) => handleClick(segment, e)}
        >
          {segment.text}
        </span>
      );
    });
  }, [segments, handleClick, renderAsHtml]);

  return (
    <div className={`highlightable-text ${className}`.trim()}>
      {renderedContent}
    </div>
  );
}

// ============================================
// Specialized Variants
// ============================================

interface SentenceHighlightableTextProps {
  /** Array of sentence texts */
  sentences: string[];
  /** Highlight ranges for each sentence (indexed by sentence position) */
  sentenceHighlights: Map<number, HighlightRange[]>;
  /** Callback when sentence is clicked */
  onSentenceClick?: (index: number, event: MouseEvent) => void;
  /** Additional className */
  className?: string;
}

/**
 * Variant for sentence-level analysis where each sentence is independently highlightable
 */
export function SentenceHighlightableText({
  sentences,
  sentenceHighlights,
  onSentenceClick,
  className = '',
}: SentenceHighlightableTextProps) {
  return (
    <div className={`highlightable-text ${className}`.trim()}>
      {sentences.map((sentence, index) => {
        const highlights = sentenceHighlights.get(index) || [];
        const hasHighlights = highlights.length > 0;

        if (!hasHighlights) {
          return (
            <span key={index} className="sentence-highlight">
              {sentence}{' '}
            </span>
          );
        }

        const classes = `sentence-highlight ${mergeHighlightClasses(highlights)}`;
        const tooltip = getTooltip(highlights);

        return (
          <span
            key={index}
            className={classes}
            data-tooltip={tooltip || undefined}
            onClick={(e) => onSentenceClick?.(index, e)}
          >
            {sentence}{' '}
          </span>
        );
      })}
    </div>
  );
}

export default HighlightableText;
