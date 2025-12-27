/**
 * CornerAssistant - Subtle help button for book-like aesthetic
 *
 * A discrete "?" button in the lower right corner that provides
 * navigation and help without disrupting the reading/editing experience.
 *
 * Design principles:
 * - Book-safe: resembles a footnote marker or bookmark
 * - Non-intrusive: muted colors, minimal visual weight
 * - Generous padding from edges (24px)
 * - Optional: easy to ignore when focused on content
 * - Panel-aware: shifts left when Tools panel is open (doesn't get covered)
 */

import { useState } from 'react';
import { useLayout, usePanelState, type PanelId } from './LayoutContext';

interface CornerAssistantProps {
  className?: string;
  /** Callback when chat is requested (AUI) */
  onOpenChat?: () => void;
}

export function CornerAssistant({ className = '', onOpenChat }: CornerAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { togglePanel, isPanelVisible } = useLayout();
  const toolsPanel = usePanelState('tools');

  // When Tools panel is open, shift left to stay visible
  const isToolsOpen = isPanelVisible('tools');
  const offsetStyle = isToolsOpen
    ? { right: `calc(${toolsPanel.width}px + var(--space-md, 1rem))` }
    : undefined;

  const handleNavigation = (panel: PanelId) => {
    togglePanel(panel);
    setIsOpen(false);
  };

  const handleOpenChat = () => {
    setChatOpen(true);
    setIsOpen(false);
    onOpenChat?.();
  };

  return (
    <>
      {/* The subtle "?" button */}
      <button
        className={`corner-assistant ${isOpen ? 'corner-assistant--open' : ''} ${className}`}
        style={offsetStyle}
        onClick={() => setIsOpen(!isOpen)}
        title="Help & Navigation"
        aria-label="Open help and navigation"
        aria-expanded={isOpen}
      >
        <span className="corner-assistant__icon">{isOpen ? '×' : '?'}</span>
      </button>

      {/* Popover menu */}
      {isOpen && (
        <>
          <div
            className="corner-assistant__backdrop"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div
            className="corner-assistant__menu"
            style={offsetStyle}
            role="menu"
            aria-label="Navigation menu"
          >
            <button
              className={`corner-assistant__item ${isPanelVisible('archives') ? 'active' : ''}`}
              onClick={() => handleNavigation('archives')}
              role="menuitem"
            >
              <span className="corner-assistant__item-icon">◀</span>
              <span>Archives</span>
            </button>
            <button
              className={`corner-assistant__item ${isPanelVisible('tools') ? 'active' : ''}`}
              onClick={() => handleNavigation('tools')}
              role="menuitem"
            >
              <span className="corner-assistant__item-icon">▶</span>
              <span>Tools</span>
            </button>
            <div className="corner-assistant__divider" />
            <button
              className={`corner-assistant__item corner-assistant__item--chat ${chatOpen ? 'active' : ''}`}
              onClick={handleOpenChat}
              role="menuitem"
            >
              <span className="corner-assistant__item-icon">💬</span>
              <span>Chat with AUI</span>
            </button>
            <div className="corner-assistant__divider" />
            <div className="corner-assistant__shortcuts">
              <span className="corner-assistant__shortcut">
                <kbd>⌘</kbd><kbd>1</kbd> Archives
              </span>
              <span className="corner-assistant__shortcut">
                <kbd>⌘</kbd><kbd>2</kbd> Tools
              </span>
            </div>
          </div>
        </>
      )}

      {/* Chat Panel (inline for now, could be a separate component) */}
      {chatOpen && (
        <div className="corner-assistant__chat" style={offsetStyle}>
          <div className="corner-assistant__chat-header">
            <span>AUI Assistant</span>
            <button
              className="corner-assistant__chat-close"
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>
          <div className="corner-assistant__chat-body">
            <p className="corner-assistant__chat-placeholder">
              AUI chat is being integrated. For now, use the Tools panel for AI features.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default CornerAssistant;
