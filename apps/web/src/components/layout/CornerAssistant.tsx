/**
 * CornerAssistant - Floating AUI assistant
 *
 * A discrete "?" button in the lower right corner that opens
 * the AUI chat interface for natural language commands.
 *
 * Design principles:
 * - Book-safe: resembles a footnote marker or bookmark
 * - Non-intrusive: muted colors, minimal visual weight
 * - Generous padding from edges (24px)
 * - Optional: easy to ignore when focused on content
 * - Panel-aware: shifts left when Tools panel is open
 * - Action-driven: results display in Archive pane, not chat
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLayout, usePanelState, type PanelId } from './LayoutContext';
import { useAUIChat, useAUIAnimation, useAUISettingsContext, useCuratorPersona, recordInteraction } from '../../lib/aui';

interface CornerAssistantProps {
  className?: string;
}

export function CornerAssistant({ className = '' }: CornerAssistantProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { togglePanel, isPanelVisible } = useLayout();
  const toolsPanel = usePanelState('tools');

  // AUI Context
  const {
    messages,
    isLoading,
    sendMessage,
    clearConversation,
  } = useAUIChat();
  const animation = useAUIAnimation();
  const { settings } = useAUISettingsContext();

  // Curator Persona for identity display
  const { persona, isConfigured } = useCuratorPersona();
  const curatorName = persona.appearance.displayName || 'Guide';
  const curatorIcon = isConfigured ? '◈' : '?';

  // Chat input state
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // When Tools panel is open, shift left to stay visible
  const isToolsOpen = isPanelVisible('tools');
  const offsetStyle = isToolsOpen
    ? { right: `calc(${toolsPanel.width}px + var(--space-md, 1rem))` }
    : undefined;

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (chatOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [chatOpen]);

  // Keyboard shortcut: Cmd+/ to toggle chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setChatOpen(prev => !prev);
      }
      // Escape to close chat
      if (e.key === 'Escape' && chatOpen) {
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chatOpen]);

  const handleNavigation = (panel: PanelId) => {
    togglePanel(panel);
    setMenuOpen(false);
  };

  const handleOpenChat = () => {
    setChatOpen(true);
    setMenuOpen(false);
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = '40px';
    }
    // Record interaction for persona memory
    recordInteraction();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextareaHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* The floating button - shows curator icon or ? */}
      <button
        className={`corner-assistant ${menuOpen || chatOpen ? 'corner-assistant--open' : ''} ${isConfigured ? 'corner-assistant--configured' : ''} ${className}`}
        style={offsetStyle}
        onClick={() => chatOpen ? setChatOpen(false) : setMenuOpen(!menuOpen)}
        title={`${curatorName} (⌘/)`}
        aria-label={`Open ${curatorName} assistant`}
        aria-expanded={menuOpen || chatOpen}
        aria-haspopup="dialog"
      >
        <span className="corner-assistant__icon">
          {chatOpen ? '×' : menuOpen ? '×' : curatorIcon}
        </span>
      </button>

      {/* Quick navigation menu */}
      {menuOpen && !chatOpen && (
        <>
          <div
            className="corner-assistant__backdrop"
            onClick={() => setMenuOpen(false)}
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
              className="corner-assistant__item corner-assistant__item--chat"
              onClick={handleOpenChat}
              role="menuitem"
            >
              <span className="corner-assistant__item-icon">✦</span>
              <span>Ask AUI</span>
            </button>
            <div className="corner-assistant__divider" />
            <div className="corner-assistant__shortcuts">
              <span className="corner-assistant__shortcut">
                <kbd>⌘</kbd><kbd>/</kbd> AUI Chat
              </span>
            </div>
          </div>
        </>
      )}

      {/* Full AUI Chat Panel */}
      {chatOpen && (
        <div
          className="corner-assistant__chat"
          style={offsetStyle}
          role="dialog"
          aria-modal="false"
          aria-label="AUI Assistant"
        >
          {/* Header */}
          <div className="corner-assistant__chat-header">
            <div className="corner-assistant__chat-title">
              <span className="corner-assistant__chat-icon">{isConfigured ? '◈' : '✦'}</span>
              <span>{curatorName}</span>
              {animation.isPlaying && (
                <span className="corner-assistant__chat-status" title="Showing how...">
                  ◉
                </span>
              )}
            </div>
            <div className="corner-assistant__chat-actions">
              <button
                className="corner-assistant__chat-action"
                onClick={clearConversation}
                title="New conversation"
                aria-label="Start new conversation"
              >
                ↺
              </button>
              <button
                className="corner-assistant__chat-close"
                onClick={() => setChatOpen(false)}
                aria-label="Close chat (Escape)"
              >
                ×
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            className="corner-assistant__chat-messages"
            role="log"
            aria-live="polite"
            aria-label="Conversation messages"
          >
            {messages.length === 0 && (
              <div className="corner-assistant__chat-welcome">
                <p>Ask me to search, transform, or build. I'll show you how in the Archive.</p>
                <p className="corner-assistant__chat-hint">Try: "Find conversations about..."</p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`corner-assistant__chat-msg corner-assistant__chat-msg--${msg.role}`}
              >
                {msg.role === 'tool' ? (
                  <div className="corner-assistant__tool-results">
                    {msg.toolResults?.map((result, i) => (
                      <div
                        key={i}
                        className={`corner-assistant__tool-result ${result.success ? 'success' : 'error'}`}
                      >
                        <span className="corner-assistant__tool-status">
                          {result.success ? '✓' : '✗'}
                        </span>
                        <span className="corner-assistant__tool-message">
                          {result.success ? result.message : result.error}
                        </span>
                        {result.teaching && (
                          <details className="corner-assistant__teaching">
                            <summary>How?</summary>
                            {result.teaching.guiPath && (
                              <ol>
                                {result.teaching.guiPath.map((step, j) => (
                                  <li key={j}>{step}</li>
                                ))}
                              </ol>
                            )}
                            {result.teaching.shortcut && (
                              <div className="corner-assistant__teaching-shortcut">
                                ⌨️ {result.teaching.shortcut}
                              </div>
                            )}
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="corner-assistant__chat-msg corner-assistant__chat-msg--loading">
                <span className="corner-assistant__loading-dots">
                  <span>●</span><span>●</span><span>●</span>
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="corner-assistant__chat-input">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask AUI..."
              disabled={isLoading}
              rows={1}
              aria-label="Message input"
            />
            <button
              className="corner-assistant__chat-send"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>

          {/* Archive notice */}
          {settings.archive.archiveChats && (
            <div className="corner-assistant__chat-notice" aria-live="off">
              Saved to archive
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default CornerAssistant;
