/**
 * PanelResizer - Draggable handle for resizing side panels
 *
 * Positioned between the panel edge and the workspace.
 * Drag to resize, double-click to reset to default width.
 */

import { useState, useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLayout, type PanelId } from './LayoutContext';

// ============================================
// Types
// ============================================

interface PanelResizerProps {
  /** Which panel this resizer controls */
  panel: PanelId;
  /** Position of the resizer */
  side: 'left' | 'right';
  /** Additional class name */
  className?: string;
}

// ============================================
// Component
// ============================================

export function PanelResizer({ panel, side, className = '' }: PanelResizerProps) {
  const { state, setPanelWidth, isPanelVisible } = useLayout();
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const panelConfig = state.panels[panel];
  const isVisible = isPanelVisible(panel);

  // All hooks must be called before any early returns
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = panelConfig.width;

      // Add cursor style to body during drag
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [panelConfig.width]
  );

  const handleDoubleClick = useCallback(() => {
    // Reset to default width
    const defaultWidth = panel === 'archives' ? 320 : 300;
    setPanelWidth(panel, defaultWidth);
  }, [panel, setPanelWidth]);

  // Handle keyboard adjustments
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const step = e.shiftKey ? 50 : 20;
      const currentWidth = panelConfig.width;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setPanelWidth(panel, side === 'left' ? currentWidth - step : currentWidth + step);
          break;
        case 'ArrowRight':
          e.preventDefault();
          setPanelWidth(panel, side === 'left' ? currentWidth + step : currentWidth - step);
          break;
        case 'Home':
          e.preventDefault();
          setPanelWidth(panel, panelConfig.minWidth);
          break;
        case 'End':
          e.preventDefault();
          setPanelWidth(panel, panelConfig.maxWidth);
          break;
      }
    },
    [panel, side, panelConfig.width, panelConfig.minWidth, panelConfig.maxWidth, setPanelWidth]
  );

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;

      // For left panel, positive delta = wider
      // For right panel, negative delta = wider
      const newWidth =
        side === 'left'
          ? startWidthRef.current + deltaX
          : startWidthRef.current - deltaX;

      setPanelWidth(panel, newWidth);
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
  }, [isDragging, panel, side, setPanelWidth]);

  // Don't render if panel is hidden or on mobile (after all hooks)
  if (!isVisible || state.mode === 'mobile') {
    return null;
  }

  return (
    <div
      className={`panel-resizer panel-resizer--${side} ${
        isDragging ? 'panel-resizer--dragging' : ''
      } ${className}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panel} panel. Use arrow keys to resize, Home for minimum, End for maximum width.`}
      aria-valuenow={panelConfig.width}
      aria-valuemin={panelConfig.minWidth}
      aria-valuemax={panelConfig.maxWidth}
      tabIndex={0}
    >
      <div className="panel-resizer__handle" />
    </div>
  );
}

export default PanelResizer;
