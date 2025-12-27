/**
 * SplitModeToolbar - Mode and highlight layer controls
 *
 * Features:
 * - Mode buttons: View | Analyze | Transform | Compare
 * - Highlight toggles: AI | GPTZero | Tell | Diff
 * - Auto-hides in view mode, appears on hover
 * - Keyboard shortcuts support
 */

import { useCallback, useState, useRef, useEffect, type KeyboardEvent, type MouseEvent, type TouchEvent } from 'react';
import { useSplitMode, useHighlights } from './LayoutContext';
import type { SplitMode, HighlightLayer } from '../../lib/analysis';

// ============================================
// Types
// ============================================

interface SplitModeToolbarProps {
  /** Show GPTZero option (premium only) */
  showGPTZero?: boolean;
  /** Additional className */
  className?: string;
  /** Callback when mode changes */
  onModeChange?: (mode: SplitMode) => void;
}

// ============================================
// Mode Configuration
// ============================================

const MODES: { value: SplitMode; label: string; icon: string; shortcut: string }[] = [
  { value: 'view', label: 'View', icon: '👁', shortcut: '1' },
  { value: 'analyze', label: 'Analyze', icon: '🔍', shortcut: '2' },
  { value: 'transform', label: 'Transform', icon: '✨', shortcut: '3' },
  { value: 'compare', label: 'Compare', icon: '⚖', shortcut: '4' },
];

const HIGHLIGHT_LAYERS: {
  value: HighlightLayer;
  label: string;
  icon: string;
  premium?: boolean;
}[] = [
  { value: 'ai-detection', label: 'AI', icon: '🤖' },
  { value: 'gptzero', label: 'GPT', icon: '🔬', premium: true },
  { value: 'tell-phrases', label: 'Tell', icon: '💬' },
  { value: 'diff', label: 'Diff', icon: '±' },
  { value: 'stylometry', label: 'Style', icon: '📊' },
];

// ============================================
// Component
// ============================================

export function SplitModeToolbar({
  showGPTZero = false,
  className = '',
  onModeChange,
}: SplitModeToolbarProps) {
  const { mode, setMode } = useSplitMode();
  const { activeHighlights, toggle: toggleHighlight, isLayerActive } = useHighlights();
  const [isHovered, setIsHovered] = useState(false);

  // Drag state
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  // Handle drag start (mouse and touch)
  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    if (!toolbarRef.current) return;

    const rect = toolbarRef.current.getBoundingClientRect();
    const currentX = position?.x ?? rect.left + rect.width / 2;
    const currentY = position?.y ?? rect.top;

    dragStartRef.current = {
      x: clientX,
      y: clientY,
      posX: currentX,
      posY: currentY,
    };
    setIsDragging(true);
  }, [position]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    // Only drag on left click and not on buttons
    if (e.button !== 0 || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  }, [handleDragStart]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  }, [handleDragStart]);

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return;

      const deltaX = clientX - dragStartRef.current.x;
      const deltaY = clientY - dragStartRef.current.y;

      // Constrain to viewport
      const newX = Math.max(100, Math.min(window.innerWidth - 100, dragStartRef.current.posX + deltaX));
      const newY = Math.max(50, Math.min(window.innerHeight - 50, dragStartRef.current.posY + deltaY));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      e.preventDefault();
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: globalThis.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  // Reset position on double-click
  const handleDoubleClick = useCallback(() => {
    setPosition(null);
  }, []);

  // Filter layers based on premium status
  const availableLayers = HIGHLIGHT_LAYERS.filter(
    (layer) => !layer.premium || showGPTZero
  );

  // Handle mode button click
  const handleModeClick = useCallback(
    (newMode: SplitMode) => {
      setMode(newMode);
      onModeChange?.(newMode);
    },
    [setMode, onModeChange]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Check for Cmd/Ctrl + number shortcuts
      if (event.metaKey || event.ctrlKey) {
        const num = parseInt(event.key, 10);
        if (num >= 1 && num <= MODES.length) {
          event.preventDefault();
          handleModeClick(MODES[num - 1].value);
        }
      }
    },
    [handleModeClick]
  );

  // Determine visibility
  const isVisible = mode !== 'view' || isHovered;

  // Calculate style for custom position
  const positionStyle = position
    ? {
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, 0)',
      }
    : undefined;

  return (
    <div
      ref={toolbarRef}
      className={`split-mode-toolbar ${isVisible ? 'split-mode-toolbar--visible' : ''} ${isDragging ? 'split-mode-toolbar--dragging' : ''} ${position ? 'split-mode-toolbar--custom-position' : ''} ${className}`.trim()}
      style={positionStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="toolbar"
      aria-label="Split mode controls (drag to reposition, double-click to reset)"
    >
      {/* Mode buttons */}
      <div className="split-mode-toolbar__section" role="group" aria-label="View modes">
        {MODES.map((modeConfig) => (
          <button
            key={modeConfig.value}
            className={`split-mode-toolbar__button ${
              mode === modeConfig.value ? 'split-mode-toolbar__button--active' : ''
            }`}
            onClick={() => handleModeClick(modeConfig.value)}
            title={`${modeConfig.label} (⌘${modeConfig.shortcut})`}
            aria-pressed={mode === modeConfig.value}
          >
            <span className="split-mode-toolbar__icon" aria-hidden="true">
              {modeConfig.icon}
            </span>
            <span className="split-mode-toolbar__label">{modeConfig.label}</span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="split-mode-toolbar__divider" aria-hidden="true" />

      {/* Highlight toggles - only show when not in view mode */}
      {mode !== 'view' && (
        <div
          className="split-mode-toolbar__section"
          role="group"
          aria-label="Highlight layers"
        >
          <span className="split-mode-toolbar__section-label">Highlights:</span>
          {availableLayers.map((layer) => (
            <button
              key={layer.value}
              className={`split-mode-toolbar__toggle ${
                isLayerActive(layer.value) ? 'split-mode-toolbar__toggle--active' : ''
              }`}
              onClick={() => toggleHighlight(layer.value)}
              title={`Toggle ${layer.label} highlights`}
              aria-pressed={isLayerActive(layer.value)}
            >
              <span className="split-mode-toolbar__icon" aria-hidden="true">
                {layer.icon}
              </span>
              <span className="split-mode-toolbar__label">{layer.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Active layer count badge */}
      {activeHighlights.length > 0 && (
        <span className="split-mode-toolbar__badge" aria-live="polite">
          {activeHighlights.length} active
        </span>
      )}
    </div>
  );
}

export default SplitModeToolbar;
