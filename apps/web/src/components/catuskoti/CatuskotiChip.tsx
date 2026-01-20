/**
 * CatuskotiChip - Four-state filter chip based on Buddhist tetralemma
 *
 * Click cycles through: Neutral -> Is -> Is Not -> Both -> Neither -> Neutral
 * Most common action (include) is first click.
 */

import { useCallback, useRef } from 'react';
import {
  CatuskotiChipProps,
  CatuskotiState,
  nextCatuskotiState,
  getCatuskotiIcon,
  getCatuskotiAriaLabel,
} from './types';
import './catuskoti.css';

export function CatuskotiChip({
  filter,
  onStateChange,
  onDismiss,
  dismissible = false,
  compact = false,
}: CatuskotiChipProps) {
  const announceRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(() => {
    const newState = nextCatuskotiState(filter.state);
    onStateChange(filter.id, newState);

    // Announce to screen readers
    if (announceRef.current) {
      const stateNames: Record<CatuskotiState, string> = {
        'neutral': 'cleared',
        'is': 'including',
        'is-not': 'excluding',
        'both': 'spanning',
        'neither': 'uncategorized',
      };
      announceRef.current.textContent = `${filter.label}: now ${stateNames[newState]}`;
    }
  }, [filter, onStateChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Direct state selection with number keys
      const keyMap: Record<string, CatuskotiState> = {
        '1': 'is',
        '2': 'is-not',
        '3': 'both',
        '4': 'neither',
        '0': 'neutral',
        'Delete': 'neutral',
        'Backspace': 'neutral',
      };

      if (keyMap[e.key]) {
        e.preventDefault();
        onStateChange(filter.id, keyMap[e.key]);
      }
    },
    [filter.id, onStateChange]
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss?.(filter.id);
    },
    [filter.id, onDismiss]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Could show a context menu here for direct state selection
      // For now, just cycle backwards
      const reverseOrder: CatuskotiState[] = ['neutral', 'neither', 'both', 'is-not', 'is'];
      const currentIndex = reverseOrder.indexOf(filter.state);
      const newState = reverseOrder[(currentIndex + 1) % reverseOrder.length];
      onStateChange(filter.id, newState);
    },
    [filter, onStateChange]
  );

  return (
    <>
      <button
        className={`catuskoti-chip ${compact ? 'catuskoti-chip--compact' : ''} ${dismissible ? 'catuskoti-chip--dismissible' : ''}`}
        data-state={filter.state}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        aria-label={getCatuskotiAriaLabel(filter.state, filter.label)}
        title={`${filter.label}: ${filter.state}. Click to cycle, right-click to reverse.`}
      >
        <span className="catuskoti-chip__icon" aria-hidden="true">
          {getCatuskotiIcon(filter.state)}
        </span>
        <span className="catuskoti-chip__label">{filter.label}</span>
        {filter.count > 0 && (
          <span className="catuskoti-chip__count" aria-label={`${filter.count} items`}>
            ({filter.count.toLocaleString()})
          </span>
        )}
        {dismissible && onDismiss && (
          <span
            role="button"
            tabIndex={0}
            className="catuskoti-chip__dismiss"
            onClick={handleDismiss}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onDismiss(filter.id);
              }
            }}
            aria-label={`Remove ${filter.label} filter`}
          >
            ×
          </span>
        )}
      </button>
      {/* Screen reader announcer */}
      <div
        ref={announceRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      />
    </>
  );
}
