/**
 * DiffView - Shows original vs transformed text with diff highlights
 *
 * Modes:
 * - Inline: Single pane with additions/deletions marked
 * - Side-by-side: Two panes with synchronized scroll
 */

import { useCallback, useRef, useMemo, useState, type UIEvent } from 'react';
import type { DiffResult, TransformationChange } from '../../lib/analysis';

// ============================================
// Types
// ============================================

interface DiffViewProps {
  /** Diff result from transformation */
  diff: DiffResult;
  /** Display mode */
  mode?: 'inline' | 'side-by-side';
  /** Additional className */
  className?: string;
  /** Callback when a change is clicked */
  onChangeClick?: (change: TransformationChange) => void;
}

interface InlineDiffSegment {
  type: 'unchanged' | 'removed' | 'added' | 'changed';
  text: string;
  change?: TransformationChange;
}

// ============================================
// Diff Processing
// ============================================

/**
 * Process changes into inline diff segments
 */
function buildInlineSegments(
  original: string,
  changes: TransformationChange[]
): InlineDiffSegment[] {
  if (changes.length === 0) {
    return [{ type: 'unchanged', text: original }];
  }

  // Sort changes by position
  const sortedChanges = [...changes].sort((a, b) => a.position - b.position);

  const segments: InlineDiffSegment[] = [];
  let currentPos = 0;

  for (const change of sortedChanges) {
    // Add unchanged text before this change
    if (change.position > currentPos) {
      segments.push({
        type: 'unchanged',
        text: original.slice(currentPos, change.position),
      });
    }

    // Add the change segment
    if (change.type === 'remove') {
      segments.push({
        type: 'removed',
        text: change.original,
        change,
      });
    } else if (change.type === 'add') {
      segments.push({
        type: 'added',
        text: change.replacement,
        change,
      });
    } else {
      // modify or other types - show both removed and added
      if (change.original) {
        segments.push({
          type: 'removed',
          text: change.original,
          change,
        });
      }
      if (change.replacement) {
        segments.push({
          type: 'added',
          text: change.replacement,
          change,
        });
      }
    }

    currentPos = change.position + (change.original?.length || 0);
  }

  // Add remaining unchanged text
  if (currentPos < original.length) {
    segments.push({
      type: 'unchanged',
      text: original.slice(currentPos),
    });
  }

  return segments;
}

// ============================================
// Inline Diff Component
// ============================================

interface InlineDiffProps {
  segments: InlineDiffSegment[];
  onChangeClick?: (change: TransformationChange) => void;
}

function InlineDiff({ segments, onChangeClick }: InlineDiffProps) {
  return (
    <div className="diff-view__inline">
      {segments.map((segment, index) => {
        const classes = `diff-segment diff-segment--${segment.type}`;

        if (segment.type === 'unchanged') {
          return (
            <span key={index} className={classes}>
              {segment.text}
            </span>
          );
        }

        return (
          <span
            key={index}
            className={classes}
            onClick={() => segment.change && onChangeClick?.(segment.change)}
            title={segment.change?.reason}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                segment.change && onChangeClick?.(segment.change);
              }
            }}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}

// ============================================
// Side-by-Side Component
// ============================================

interface SideBySideProps {
  original: string;
  transformed: string;
  changes: TransformationChange[];
  onChangeClick?: (change: TransformationChange) => void;
}

function SideBySide({ original, transformed, changes, onChangeClick }: SideBySideProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Synchronized scroll
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>, source: 'left' | 'right') => {
      if (isSyncing) return;

      const target = event.currentTarget;
      const other = source === 'left' ? rightRef.current : leftRef.current;

      if (other) {
        setIsSyncing(true);
        other.scrollTop = target.scrollTop;
        requestAnimationFrame(() => setIsSyncing(false));
      }
    },
    [isSyncing]
  );

  return (
    <div className="diff-view__side-by-side">
      {/* Original (left) */}
      <div className="diff-view__pane diff-view__pane--original">
        <header className="diff-view__pane-header">
          <span className="diff-view__pane-title">Original</span>
          <span className="diff-view__score">
            AI: {(diff as DiffResult).aiLikelihoodBefore?.toFixed(0) || '?'}%
          </span>
        </header>
        <div
          ref={leftRef}
          className="diff-view__pane-content"
          onScroll={(e) => handleScroll(e, 'left')}
        >
          <HighlightedText
            text={original}
            changes={changes}
            side="original"
            onChangeClick={onChangeClick}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="diff-view__divider" aria-hidden="true" />

      {/* Transformed (right) */}
      <div className="diff-view__pane diff-view__pane--transformed">
        <header className="diff-view__pane-header">
          <span className="diff-view__pane-title">Transformed</span>
          <span className="diff-view__score diff-view__score--improved">
            AI: {(diff as DiffResult).aiLikelihoodAfter?.toFixed(0) || '?'}%
          </span>
        </header>
        <div
          ref={rightRef}
          className="diff-view__pane-content"
          onScroll={(e) => handleScroll(e, 'right')}
        >
          <HighlightedText
            text={transformed}
            changes={changes}
            side="transformed"
            onChangeClick={onChangeClick}
          />
        </div>
      </div>
    </div>
  );
}

// Need to capture diff in closure for score display
let diff: DiffResult;

// ============================================
// Highlighted Text (for side-by-side)
// ============================================

interface HighlightedTextProps {
  text: string;
  changes: TransformationChange[];
  side: 'original' | 'transformed';
  onChangeClick?: (change: TransformationChange) => void;
}

function HighlightedText({ text, changes, side, onChangeClick }: HighlightedTextProps) {
  // Simple highlighting - mark positions where changes occurred
  const segments = useMemo(() => {
    if (changes.length === 0) {
      return [{ text, highlighted: false }];
    }

    // Sort changes by position
    const sortedChanges = [...changes].sort((a, b) => a.position - b.position);

    const result: { text: string; highlighted: boolean; change?: TransformationChange }[] = [];
    let currentPos = 0;

    for (const change of sortedChanges) {
      // Use position for original, need to track offset for transformed
      const pos = change.position;

      // Add text before change
      if (pos > currentPos && currentPos < text.length) {
        result.push({
          text: text.slice(currentPos, Math.min(pos, text.length)),
          highlighted: false,
        });
      }

      // Highlight the change area
      if (side === 'original' && change.original) {
        const end = Math.min(pos + change.original.length, text.length);
        if (pos < text.length) {
          result.push({
            text: text.slice(pos, end),
            highlighted: true,
            change,
          });
          currentPos = end;
        }
      } else if (side === 'transformed' && change.replacement) {
        // For transformed, the position still marks where the change was
        const end = Math.min(pos + (change.replacement?.length || 0), text.length);
        if (pos < text.length) {
          result.push({
            text: text.slice(pos, end),
            highlighted: true,
            change,
          });
          currentPos = end;
        }
      } else {
        currentPos = pos + (change.original?.length || 0);
      }
    }

    // Add remaining text
    if (currentPos < text.length) {
      result.push({
        text: text.slice(currentPos),
        highlighted: false,
      });
    }

    return result;
  }, [text, changes, side]);

  return (
    <div className="diff-view__text">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={segment.highlighted ? 'diff-view__change' : ''}
          onClick={() => segment.change && onChangeClick?.(segment.change)}
          title={segment.change?.reason}
        >
          {segment.text}
        </span>
      ))}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function DiffView({
  diff: diffProp,
  mode = 'inline',
  className = '',
  onChangeClick,
}: DiffViewProps) {
  // Store diff for closure access
  diff = diffProp;

  // Build segments for inline mode
  const inlineSegments = useMemo(
    () => buildInlineSegments(diffProp.original, diffProp.changes),
    [diffProp.original, diffProp.changes]
  );

  // Score improvement
  const improvement = diffProp.aiLikelihoodBefore - diffProp.aiLikelihoodAfter;
  const isImproved = improvement > 0;

  return (
    <div className={`diff-view diff-view--${mode} ${className}`.trim()}>
      {/* Header with score summary */}
      <header className="diff-view__header">
        <div className="diff-view__stats">
          <span className="diff-view__stat">
            {diffProp.changes.length} changes
          </span>
          <span className={`diff-view__stat diff-view__stat--${isImproved ? 'improved' : 'worse'}`}>
            {isImproved ? '↓' : '↑'} {Math.abs(improvement).toFixed(1)}% AI
          </span>
        </div>
      </header>

      {/* Content */}
      {mode === 'inline' ? (
        <InlineDiff segments={inlineSegments} onChangeClick={onChangeClick} />
      ) : (
        <SideBySide
          original={diffProp.original}
          transformed={diffProp.transformed}
          changes={diffProp.changes}
          onChangeClick={onChangeClick}
        />
      )}
    </div>
  );
}

export default DiffView;
