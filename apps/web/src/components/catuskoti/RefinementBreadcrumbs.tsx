/**
 * RefinementBreadcrumbs - Visual breadcrumb navigation for filter drill-down
 *
 * Shows the refinement path with clickable steps to revert:
 * [All: 36,177] → [+chatgpt: 12,000] → [/conscious/: 450] → [words:>200: 89]
 */

import { useCallback } from 'react';
import type { RefinementStep, RefinementHistory } from '../../lib/query';
import './refinement-breadcrumbs.css';

export interface RefinementBreadcrumbsProps {
  /** All visible steps */
  steps: RefinementStep[];
  /** Index of the current step */
  currentIndex: number;
  /** Called when a step is clicked */
  onStepClick: (index: number) => void;
  /** Called when undo is clicked */
  onUndo?: () => void;
  /** Called when redo is clicked */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

export function RefinementBreadcrumbs({
  steps,
  currentIndex,
  onStepClick,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  compact = false,
  className = '',
}: RefinementBreadcrumbsProps) {
  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' && canUndo) {
      e.preventDefault();
      onUndo?.();
    } else if (e.key === 'ArrowRight' && canRedo) {
      e.preventDefault();
      onRedo?.();
    }
  }, [canUndo, canRedo, onUndo, onRedo]);

  if (steps.length <= 1) {
    return null; // Don't show breadcrumbs with only root
  }

  return (
    <nav
      className={`refinement-breadcrumbs ${compact ? 'refinement-breadcrumbs--compact' : ''} ${className}`}
      aria-label="Refinement history"
      onKeyDown={handleKeyDown}
    >
      {/* Undo/Redo buttons */}
      <div className="refinement-breadcrumbs__controls">
        <button
          className="refinement-breadcrumbs__nav-btn"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo last refinement (Ctrl+Z)"
          title="Undo (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 10h10a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H3" />
            <path d="M7 6l-4 4 4 4" />
          </svg>
        </button>
        <button
          className="refinement-breadcrumbs__nav-btn"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo refinement (Ctrl+Shift+Z)"
          title="Redo (Ctrl+Shift+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10H11a5 5 0 0 0-5 5v2a5 5 0 0 0 5 5h10" />
            <path d="M17 6l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* Breadcrumb trail */}
      <div className="refinement-breadcrumbs__trail" role="list">
        {steps.map((step, index) => (
          <div key={step.id} className="refinement-breadcrumbs__item" role="listitem">
            {index > 0 && (
              <span className="refinement-breadcrumbs__arrow" aria-hidden="true">
                →
              </span>
            )}
            <button
              className={`refinement-breadcrumbs__step ${index === currentIndex ? 'refinement-breadcrumbs__step--current' : ''} ${index < currentIndex ? 'refinement-breadcrumbs__step--past' : ''}`}
              onClick={() => onStepClick(index)}
              aria-current={index === currentIndex ? 'step' : undefined}
              title={`Click to revert to: ${step.label}`}
            >
              <span className="refinement-breadcrumbs__label">{step.label}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Clear refinements link */}
      {currentIndex > 0 && (
        <button
          className="refinement-breadcrumbs__clear"
          onClick={() => onStepClick(0)}
          aria-label="Clear all refinements"
        >
          Clear
        </button>
      )}
    </nav>
  );
}

/**
 * Compact inline version showing just the current path summary
 */
export function RefinementBreadcrumbsInline({
  steps,
  currentIndex,
  onStepClick,
  className = '',
}: Pick<RefinementBreadcrumbsProps, 'steps' | 'currentIndex' | 'onStepClick' | 'className'>) {
  if (steps.length <= 1) {
    return null;
  }

  const path = steps.slice(0, currentIndex + 1);

  return (
    <div className={`refinement-breadcrumbs-inline ${className}`}>
      <span className="refinement-breadcrumbs-inline__path">
        {path.map((step, i) => (
          <span key={step.id}>
            {i > 0 && <span className="refinement-breadcrumbs-inline__sep"> → </span>}
            <button
              className={`refinement-breadcrumbs-inline__step ${i === currentIndex ? 'refinement-breadcrumbs-inline__step--current' : ''}`}
              onClick={() => onStepClick(i)}
            >
              {step.label}
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Format a timestamp for display
 */
export function formatStepTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return 'just now';
  } else if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}
