/**
 * HoverPanel - Slide-out panel for archives (left) and tools (right)
 *
 * Responsive behavior:
 * - Desktop/Tablet: Side panel with hover trigger and resize handle
 * - Mobile: Bottom sheet with swipe handle
 *
 * Extracted from Studio.tsx during modularization
 */

import type { ReactNode } from 'react';
import { usePanelState, useLayoutMode } from './LayoutContext';
import { PanelResizer } from './PanelResizer';

export interface HoverPanelProps {
  side: 'left' | 'right';
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}

export function HoverPanel({ side, isOpen, onToggle, title, children }: HoverPanelProps) {
  // Get panel width and layout mode from context
  const panelId = side === 'left' ? 'archives' : 'tools';
  const panelConfig = usePanelState(panelId);
  const layoutMode = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  // Dynamic style based on mode
  const panelStyle = isMobile
    ? undefined // Mobile uses CSS for bottom sheet behavior
    : isOpen
      ? { width: `${panelConfig.width}px` }
      : undefined;

  // Mobile: Render as bottom sheet
  if (isMobile) {
    return (
      <>
        <aside
          className={`studio-panel studio-panel--bottom-sheet studio-panel--${side} ${isOpen ? 'studio-panel--open' : ''}`}
          id={`${panelId}-panel`}
        >
          {/* Bottom sheet handle */}
          <button
            className="studio-panel__sheet-handle"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={`${panelId}-panel`}
          >
            <span className="studio-panel__sheet-bar" />
            <span className="studio-panel__sheet-label">{title}</span>
          </button>
          <div className="studio-panel__content">
            {children}
          </div>
        </aside>

        {isOpen && (
          <div className="studio-panel__backdrop studio-panel__backdrop--mobile" onClick={onToggle} />
        )}
      </>
    );
  }

  // Desktop/Tablet: Render as side panel
  return (
    <>
      <div
        className={`studio-panel__trigger studio-panel__trigger--${side}`}
        onMouseEnter={() => !isOpen && onToggle()}
      />

      <aside
        className={`studio-panel studio-panel--${side} ${isOpen ? 'studio-panel--open' : ''}`}
        style={panelStyle}
        id={`${panelId}-panel`}
      >
        <header className="studio-panel__header">
          <h2 className="studio-panel__title">{title}</h2>
          <button className="studio-panel__close" onClick={onToggle} aria-label={`Close ${title} panel`}>×</button>
        </header>
        <div className="studio-panel__content">
          {children}
        </div>
        {/* Resize handle */}
        <PanelResizer panel={panelId} side={side} />
      </aside>

      {isOpen && (
        <div className="studio-panel__backdrop" onClick={onToggle} />
      )}
    </>
  );
}
