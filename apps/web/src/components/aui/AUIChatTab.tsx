/**
 * AUI Chat Tab - Integrated chat component for Tools panel
 *
 * Features:
 * - Theme-aware styling (no more blue!)
 * - Shows that conversations are archived
 * - Animation indicator when "show don't tell" is active
 * - Settings quick access
 */

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAUIChat, useAUIAnimation, useAUISettingsContext } from '../../lib/aui/AUIContext';

export function AUIChatTab() {
  const {
    messages,
    isLoading,
    isOpen,
    sendMessage,
    clearConversation,
  } = useAUIChat();

  const animation = useAUIAnimation();
  const { settings, update: updateSettings } = useAUISettingsContext();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when tab opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="aui-chat-tab">
      {/* Header with status indicators */}
      <div className="aui-chat-tab__header">
        <div className="aui-chat-tab__title">
          <span className="aui-chat-tab__icon">✦</span>
          <span>AUI Assistant</span>
          {settings.archive.archiveChats && (
            <span className="aui-chat-tab__archive-badge" title="Conversations are archived">
              ●
            </span>
          )}
        </div>
        <div className="aui-chat-tab__actions">
          {animation.isPlaying && (
            <button
              className="aui-chat-tab__stop-btn"
              onClick={animation.stop}
              title="Stop animation"
            >
              ◼
            </button>
          )}
          <button
            className={`aui-chat-tab__settings-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙
          </button>
          <button
            className="aui-chat-tab__clear-btn"
            onClick={clearConversation}
            title="Clear conversation"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Settings panel (collapsible) */}
      {showSettings && (
        <div className="aui-chat-tab__settings">
          <label className="aui-chat-tab__setting">
            <input
              type="checkbox"
              checked={settings.animation.enabled}
              onChange={(e) =>
                updateSettings('animation', { enabled: e.target.checked })
              }
            />
            <span>Show "how to" animations</span>
          </label>
          <label className="aui-chat-tab__setting">
            <input
              type="checkbox"
              checked={settings.animation.showShortcuts}
              onChange={(e) =>
                updateSettings('animation', { showShortcuts: e.target.checked })
              }
            />
            <span>Show keyboard shortcuts</span>
          </label>
          <label className="aui-chat-tab__setting">
            <input
              type="checkbox"
              checked={settings.archive.archiveChats}
              onChange={(e) =>
                updateSettings('archive', { archiveChats: e.target.checked })
              }
            />
            <span>Archive conversations</span>
          </label>
          <div className="aui-chat-tab__setting-row">
            <span>Animation speed:</span>
            <select
              value={settings.animation.speed}
              onChange={(e) =>
                updateSettings('animation', { speed: parseFloat(e.target.value) })
              }
            >
              <option value="0.5">Slow</option>
              <option value="1">Normal</option>
              <option value="2">Fast</option>
            </select>
          </div>
        </div>
      )}

      {/* Animation indicator */}
      {animation.isPlaying && (
        <div className="aui-chat-tab__animation-bar">
          <div className="aui-chat-tab__animation-progress">
            <div
              className="aui-chat-tab__animation-fill"
              style={{
                width: `${(animation.currentStep / animation.totalSteps) * 100}%`,
              }}
            />
          </div>
          <span className="aui-chat-tab__animation-text">
            Showing how... ({animation.currentStep}/{animation.totalSteps})
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="aui-chat-tab__messages">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`aui-chat-tab__message aui-chat-tab__message--${msg.role}`}
          >
            {msg.role === 'tool' ? (
              <div className="aui-chat-tab__tool-results">
                {msg.toolResults?.map((result, i) => (
                  <div
                    key={i}
                    className={`aui-chat-tab__tool-result ${
                      result.success ? 'success' : 'error'
                    }`}
                  >
                    <div className="aui-chat-tab__tool-status">
                      {result.success ? '✓' : '✗'}
                    </div>
                    <div className="aui-chat-tab__tool-content">
                      <div className="aui-chat-tab__tool-message">
                        {result.success ? result.message : result.error}
                      </div>
                      {result.teaching && (
                        <div className="aui-chat-tab__teaching">
                          <div className="aui-chat-tab__teaching-header">
                            How to do this yourself:
                          </div>
                          {result.teaching.guiPath && (
                            <ol className="aui-chat-tab__teaching-steps">
                              {result.teaching.guiPath.map((step, j) => (
                                <li key={j}>{step}</li>
                              ))}
                            </ol>
                          )}
                          {result.teaching.shortcut && (
                            <div className="aui-chat-tab__teaching-shortcut">
                              ⌨️ {result.teaching.shortcut}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
          <div className="aui-chat-tab__message aui-chat-tab__message--assistant aui-chat-tab__message--loading">
            <span className="aui-chat-tab__loading-dots">
              <span>●</span>
              <span>●</span>
              <span>●</span>
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="aui-chat-tab__input-area">
        <input
          ref={inputRef}
          type="text"
          className="aui-chat-tab__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AUI anything..."
          disabled={isLoading}
        />
        <button
          className="aui-chat-tab__send"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
        >
          ↑
        </button>
      </div>

      {/* Archive notice */}
      {settings.archive.archiveChats && (
        <div className="aui-chat-tab__archive-notice">
          Conversations are saved to your archive
        </div>
      )}
    </div>
  );
}

export default AUIChatTab;
