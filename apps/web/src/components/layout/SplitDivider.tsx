/**
 * SplitDivider - Draggable divider for split-screen workspace
 *
 * Positioned between left and right panes in split-screen mode.
 * Drag to adjust ratio, double-click to reset to 50/50.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLayout } from './LayoutContext';

// ============================================
// Types
// ============================================

interface SplitDividerProps {
  /** Additional class name */
  className?: string;
}

// ============================================
// Component
// ============================================

export function SplitDivider({ className = '' }: SplitDividerProps) {
  const { state, setSplitRatio } = useLayout();
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  // All hooks must be called before any early returns
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    // Get parent container for calculating ratio
    const target = e.currentTarget as HTMLElement;
    containerRef.current = target.parentElement;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleDoubleClick = useCallback(() => {
    // Reset to 50/50
    setSplitRatio(50);
  }, [setSplitRatio]);

  // Handle keyboard adjustments
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 10 : 5;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setSplitRatio(state.splitRatio - step);
          break;
        case 'ArrowRight':
          e.preventDefault();
          setSplitRatio(state.splitRatio + step);
          break;
        case 'Home':
          e.preventDefault();
          setSplitRatio(20); // Min
          break;
        case 'End':
          e.preventDefault();
          setSplitRatio(80); // Max
          break;
      }
    },
    [state.splitRatio, setSplitRatio]
  );

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = (x / rect.width) * 100;

      setSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, setSplitRatio]);

  // Don't render if split screen is off (after all hooks)
  if (!state.splitScreen) {
    return null;
  }

  return (
    <div
      className={`split-divider ${isDragging ? 'split-divider--dragging' : ''} ${className}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split panes. Use arrow keys to adjust, Home for 20%, End for 80%."
      aria-valuenow={Math.round(state.splitRatio)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
    >
      <div className="split-divider__handle">
        <div className="split-divider__grip" />
      </div>
    </div>
  );
}

export default SplitDivider;
