/**
 * SymmetricMenubar - Floating bottom menubar for panel navigation
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  ◀ Archives     [workspace title]  [⫿]      Tools ▶     │
 *   └─────────────────────────────────────────────────────────┘
 *
 * On mobile, tapping opens the respective panel as a bottom sheet.
 * On desktop, clicking toggles the side panel visibility.
 */

import { useLayout, useSplitScreen, type PanelId } from './LayoutContext';

// ============================================
// Types
// ============================================

interface SymmetricMenubarProps {
  /** Title to display in the center */
  title?: string;
  /** Subtitle or metadata */
  subtitle?: string;
  /** Show/hide the menubar */
  visible?: boolean;
  /** Whether split-screen is available (has content to split with) */
  splitAvailable?: boolean;
  /** Callback when split toggle is clicked */
  onSplitToggle?: () => void;
  /** Additional class name */
  className?: string;
}

// ============================================
// Component
// ============================================

export function SymmetricMenubar({
  title = 'Workspace',
  subtitle,
  visible = true,
  splitAvailable = false,
  onSplitToggle,
  className = '',
}: SymmetricMenubarProps) {
  const { state, togglePanel, isPanelVisible } = useLayout();
  const splitScreen = useSplitScreen();

  if (!visible) return null;

  const isArchivesOpen = isPanelVisible('archives');
  const isToolsOpen = isPanelVisible('tools');

  const handlePanelClick = (panel: PanelId) => {
    togglePanel(panel);
  };

  const handleSplitClick = () => {
    if (onSplitToggle) {
      onSplitToggle();
    } else {
      splitScreen.toggle();
    }
  };

  return (
    <nav
      className={`symmetric-menubar ${className}`}
      role="navigation"
      aria-label="Panel navigation"
    >
      {/* Left: Archives button */}
      <button
        className={`symmetric-menubar__button symmetric-menubar__button--left ${
          isArchivesOpen ? 'symmetric-menubar__button--active' : ''
        }`}
        onClick={() => handlePanelClick('archives')}
        aria-expanded={isArchivesOpen}
        aria-controls="archives-panel"
        title={isArchivesOpen ? 'Hide Archives' : 'Show Archives'}
      >
        <span className="symmetric-menubar__icon">
          {isArchivesOpen ? '◀' : '▶'}
        </span>
        <span className="symmetric-menubar__label">Archives</span>
      </button>

      {/* Center: Title + Split toggle */}
      <div className="symmetric-menubar__center">
        <div className="symmetric-menubar__title-group">
          <h1 className="symmetric-menubar__title">{title}</h1>
          {subtitle && (
            <span className="symmetric-menubar__subtitle">{subtitle}</span>
          )}
        </div>
        {/* Split-screen toggle */}
        {(splitAvailable || splitScreen.isActive) && (
          <button
            className={`symmetric-menubar__split-btn ${
              splitScreen.isActive ? 'symmetric-menubar__split-btn--active' : ''
            }`}
            onClick={handleSplitClick}
            aria-label={splitScreen.isActive ? 'Exit split view' : 'Enter split view'}
            title={splitScreen.isActive ? 'Exit split view' : 'Enter split view'}
            aria-pressed={splitScreen.isActive}
          >
            <span className="symmetric-menubar__split-icon" aria-hidden="true">
              {splitScreen.isActive ? '⊟' : '⊞'}
            </span>
          </button>
        )}
      </div>

      {/* Right: Tools button */}
      <button
        className={`symmetric-menubar__button symmetric-menubar__button--right ${
          isToolsOpen ? 'symmetric-menubar__button--active' : ''
        }`}
        onClick={() => handlePanelClick('tools')}
        aria-expanded={isToolsOpen}
        aria-controls="tools-panel"
        title={isToolsOpen ? 'Hide Tools' : 'Show Tools'}
      >
        <span className="symmetric-menubar__label">Tools</span>
        <span className="symmetric-menubar__icon">
          {isToolsOpen ? '▶' : '◀'}
        </span>
      </button>

    </nav>
  );
}

// ============================================
// Mobile Bottom Sheet Handle
// ============================================

interface BottomSheetHandleProps {
  panel: PanelId;
  label: string;
}

export function BottomSheetHandle({ panel, label }: BottomSheetHandleProps) {
  const { togglePanel, isPanelVisible } = useLayout();
  const isOpen = isPanelVisible(panel);

  return (
    <button
      className={`bottom-sheet-handle ${
        isOpen ? 'bottom-sheet-handle--open' : ''
      }`}
      onClick={() => togglePanel(panel)}
      aria-expanded={isOpen}
    >
      <span className="bottom-sheet-handle__bar" />
      <span className="bottom-sheet-handle__label">{label}</span>
    </button>
  );
}

export default SymmetricMenubar;
