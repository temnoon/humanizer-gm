/**
 * SplitScreenWorkspace - Two-pane workspace for side-by-side content
 *
 * Used for viewing an archive item alongside the workspace editor,
 * or comparing two pieces of content.
 *
 * Desktop: Side-by-side with draggable divider
 * Mobile: Swipe/tab between panes
 */

import { type ReactNode, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLayout, useLayoutMode } from './LayoutContext';
import { SplitDivider } from './SplitDivider';
import { SplitModeToolbar } from './SplitModeToolbar';

// ============================================
// Types
// ============================================

export interface SplitPaneContent {
  /** Unique identifier for this pane */
  id: string;
  /** Display title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Whether content is read-only */
  readOnly?: boolean;
  /** The content to render */
  children: ReactNode;
}

interface SplitScreenWorkspaceProps {
  /** Left pane content */
  leftPane: SplitPaneContent;
  /** Right pane content */
  rightPane: SplitPaneContent;
  /** Currently active pane on mobile (for swipe/tab UI) */
  activeMobilePane?: 'left' | 'right';
  /** Callback when mobile pane changes */
  onMobilePaneChange?: (pane: 'left' | 'right') => void;
  /** Optional class name */
  className?: string;
}

// ============================================
// Component
// ============================================

export function SplitScreenWorkspace({
  leftPane,
  rightPane,
  activeMobilePane = 'left',
  onMobilePaneChange,
  className = '',
}: SplitScreenWorkspaceProps) {
  const { state, toggleSplitScreen } = useLayout();
  const layoutMode = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  // All hooks must be called before any early returns
  // Keyboard navigation for tabs (WAI-ARIA pattern)
  const handleTabKeyDown = useCallback(
    (e: ReactKeyboardEvent, currentPane: 'left' | 'right') => {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          onMobilePaneChange?.(currentPane === 'left' ? 'right' : 'left');
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          onMobilePaneChange?.(currentPane === 'left' ? 'right' : 'left');
          break;
        case 'Home':
          e.preventDefault();
          onMobilePaneChange?.('left');
          break;
        case 'End':
          e.preventDefault();
          onMobilePaneChange?.('right');
          break;
      }
    },
    [onMobilePaneChange]
  );

  // If split screen is off, just return null (after all hooks)
  if (!state.splitScreen) {
    return null;
  }

  // Mobile: Tab-based pane switching
  if (isMobile) {
    return (
      <div className={`split-workspace split-workspace--mobile ${className}`}>
        {/* Tab bar */}
        <nav className="split-workspace__tabs" role="tablist" aria-label="Split pane tabs">
          <button
            role="tab"
            id={`tab-${leftPane.id}`}
            aria-selected={activeMobilePane === 'left'}
            aria-controls={`panel-${leftPane.id}`}
            tabIndex={activeMobilePane === 'left' ? 0 : -1}
            className={`split-workspace__tab ${activeMobilePane === 'left' ? 'split-workspace__tab--active' : ''}`}
            onClick={() => onMobilePaneChange?.('left')}
            onKeyDown={(e) => handleTabKeyDown(e, 'left')}
          >
            <span className="split-workspace__tab-title">{leftPane.title}</span>
            {leftPane.readOnly && (
              <span className="split-workspace__tab-badge">View</span>
            )}
          </button>
          <button
            role="tab"
            id={`tab-${rightPane.id}`}
            aria-selected={activeMobilePane === 'right'}
            aria-controls={`panel-${rightPane.id}`}
            tabIndex={activeMobilePane === 'right' ? 0 : -1}
            className={`split-workspace__tab ${activeMobilePane === 'right' ? 'split-workspace__tab--active' : ''}`}
            onClick={() => onMobilePaneChange?.('right')}
            onKeyDown={(e) => handleTabKeyDown(e, 'right')}
          >
            <span className="split-workspace__tab-title">{rightPane.title}</span>
            {rightPane.readOnly && (
              <span className="split-workspace__tab-badge">View</span>
            )}
          </button>
        </nav>

        {/* Active pane */}
        <div
          role="tabpanel"
          id={`panel-${activeMobilePane === 'left' ? leftPane.id : rightPane.id}`}
          aria-labelledby={`tab-${activeMobilePane === 'left' ? leftPane.id : rightPane.id}`}
          className="split-workspace__mobile-content"
        >
          {activeMobilePane === 'left' ? (
            <SplitPane pane={leftPane} />
          ) : (
            <SplitPane pane={rightPane} />
          )}
        </div>

        {/* Exit split button */}
        <button
          className="split-workspace__exit-mobile"
          onClick={toggleSplitScreen}
          aria-label="Exit split view"
        >
          ×
        </button>
      </div>
    );
  }

  // Desktop/Tablet: Side-by-side with divider
  return (
    <div className={`split-workspace split-workspace--desktop ${className}`}>
      {/* Mode toolbar (floats at top center) */}
      <SplitModeToolbar />

      {/* Left pane */}
      <div
        className="split-workspace__pane split-workspace__pane--left"
        style={{ width: `${state.splitRatio}%` }}
      >
        <SplitPaneHeader
          pane={leftPane}
          position="left"
          onClose={toggleSplitScreen}
        />
        <div className="split-workspace__pane-content">
          {leftPane.children}
        </div>
      </div>

      {/* Draggable divider */}
      <SplitDivider />

      {/* Right pane */}
      <div
        className="split-workspace__pane split-workspace__pane--right"
        style={{ width: `${100 - state.splitRatio}%` }}
      >
        <SplitPaneHeader
          pane={rightPane}
          position="right"
          onClose={toggleSplitScreen}
        />
        <div className="split-workspace__pane-content">
          {rightPane.children}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

interface SplitPaneProps {
  pane: SplitPaneContent;
}

function SplitPane({ pane }: SplitPaneProps) {
  return (
    <div className="split-pane" data-readonly={pane.readOnly || undefined}>
      {pane.children}
    </div>
  );
}

interface SplitPaneHeaderProps {
  pane: SplitPaneContent;
  position: 'left' | 'right';
  onClose: () => void;
}

function SplitPaneHeader({ pane, position, onClose }: SplitPaneHeaderProps) {
  return (
    <header className={`split-workspace__header split-workspace__header--${position}`}>
      <div className="split-workspace__header-text">
        <h3 className="split-workspace__title">{pane.title}</h3>
        {pane.subtitle && (
          <span className="split-workspace__subtitle">{pane.subtitle}</span>
        )}
      </div>
      <div className="split-workspace__header-actions">
        {pane.readOnly && (
          <span className="split-workspace__badge">Read Only</span>
        )}
        <button
          className="split-workspace__close"
          onClick={onClose}
          aria-label="Exit split view"
        >
          ×
        </button>
      </div>
    </header>
  );
}

export default SplitScreenWorkspace;
