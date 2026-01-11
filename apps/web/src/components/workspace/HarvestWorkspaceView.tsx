/**
 * HarvestWorkspaceView - Workspace view for reviewing harvested conversations
 *
 * Displays full conversations in the main workspace with message-by-message
 * navigation and per-message curation actions (approve/skip/gem/stage).
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MathMarkdown } from '../markdown';

import type { SourcePassage, CurationStatus } from '@humanizer/core';

// ============================================
// Types
// ============================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
}

export interface HarvestConversation {
  conversationId: string;
  title: string;
  messages: ConversationMessage[];
  passage?: SourcePassage; // Original passage that led us here
}

export interface StagedMessage {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  content: string;
  role: 'user' | 'assistant';
  status: 'staged' | 'gem';
  stagedAt: number;
}

interface HarvestWorkspaceViewProps {
  conversation: HarvestConversation;
  stagedMessages: StagedMessage[];
  onStageMessage: (message: StagedMessage) => void;
  onUnstageMessage: (messageId: string) => void;
  onCommitStaged: () => void;
  onClose: () => void;
  /** Initial message index to focus */
  initialMessageIndex?: number;
}

// ============================================
// Main Component
// ============================================

export function HarvestWorkspaceView({
  conversation,
  stagedMessages,
  onStageMessage,
  onUnstageMessage,
  onCommitStaged,
  onClose,
  initialMessageIndex = 0,
}: HarvestWorkspaceViewProps) {
  const [currentIndex, setCurrentIndex] = useState(initialMessageIndex);
  const [viewMode, setViewMode] = useState<'single' | 'all'>('single');
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const messages = conversation.messages;
  const totalMessages = messages.length;
  const currentMessage = messages[currentIndex];

  // Check if current message is staged
  const isCurrentStaged = useMemo(() => {
    return stagedMessages.some(s => s.messageId === currentMessage?.id);
  }, [stagedMessages, currentMessage?.id]);

  const currentStagedStatus = useMemo(() => {
    const staged = stagedMessages.find(s => s.messageId === currentMessage?.id);
    return staged?.status;
  }, [stagedMessages, currentMessage?.id]);

  // Navigation
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < totalMessages - 1;

  const goToMessage = useCallback((index: number) => {
    if (index >= 0 && index < totalMessages) {
      setCurrentIndex(index);
      // Scroll into view in 'all' mode
      if (viewMode === 'all') {
        messageRefs.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [totalMessages, viewMode]);

  const goPrev = useCallback(() => goToMessage(currentIndex - 1), [currentIndex, goToMessage]);
  const goNext = useCallback(() => goToMessage(currentIndex + 1), [currentIndex, goToMessage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          goNext();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          goPrev();
          break;
        case 'g':
          if (e.shiftKey) {
            e.preventDefault();
            goToMessage(totalMessages - 1); // G = last
          } else {
            // Wait for second 'g'
          }
          break;
        case 'Home':
          e.preventDefault();
          goToMessage(0);
          break;
        case 'End':
          e.preventDefault();
          goToMessage(totalMessages - 1);
          break;
        case 's':
          e.preventDefault();
          handleStage();
          break;
        case 'x':
          e.preventDefault();
          handleSkip();
          break;
        case '*':
          e.preventDefault();
          handleGem();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goNext, goPrev, goToMessage, totalMessages, onClose]);

  // Curation actions
  const handleStage = useCallback(() => {
    if (!currentMessage || currentMessage.role === 'system') return;

    if (isCurrentStaged) {
      onUnstageMessage(currentMessage.id);
    } else {
      onStageMessage({
        messageId: currentMessage.id,
        conversationId: conversation.conversationId,
        conversationTitle: conversation.title,
        content: currentMessage.content,
        role: currentMessage.role,
        status: 'staged',
        stagedAt: Date.now(),
      });
    }
  }, [currentMessage, isCurrentStaged, onStageMessage, onUnstageMessage, conversation]);

  const handleGem = useCallback(() => {
    if (!currentMessage || currentMessage.role === 'system') return;

    onStageMessage({
      messageId: currentMessage.id,
      conversationId: conversation.conversationId,
      conversationTitle: conversation.title,
      content: currentMessage.content,
      role: currentMessage.role,
      status: 'gem',
      stagedAt: Date.now(),
    });
  }, [currentMessage, onStageMessage, conversation]);

  const handleSkip = useCallback(() => {
    // Just move to next message
    goNext();
  }, [goNext]);

  // Stats
  const stagedCount = stagedMessages.length;
  const gemCount = stagedMessages.filter(s => s.status === 'gem').length;

  return (
    <div className="harvest-workspace">
      {/* Header */}
      <header className="harvest-workspace__header">
        <div className="harvest-workspace__header-left">
          <button
            className="harvest-workspace__back"
            onClick={onClose}
            title="Back to harvest queue (Esc)"
          >
            ←
          </button>
          <div className="harvest-workspace__title-group">
            <h1 className="harvest-workspace__title">{conversation.title}</h1>
            <span className="harvest-workspace__meta">
              {totalMessages} messages
            </span>
          </div>
        </div>

        <div className="harvest-workspace__actions">
          {/* View mode toggle */}
          <div className="harvest-workspace__view-toggle">
            <button
              className={`harvest-workspace__view-btn ${viewMode === 'single' ? 'harvest-workspace__view-btn--active' : ''}`}
              onClick={() => setViewMode('single')}
            >
              Single
            </button>
            <button
              className={`harvest-workspace__view-btn ${viewMode === 'all' ? 'harvest-workspace__view-btn--active' : ''}`}
              onClick={() => setViewMode('all')}
            >
              All
            </button>
          </div>

          {/* Staged count */}
          {stagedCount > 0 && (
            <div className="harvest-workspace__staged-count">
              {stagedCount} staged {gemCount > 0 && <span className="harvest-workspace__gem-count">({gemCount} gems)</span>}
            </div>
          )}

          {/* Commit button */}
          <button
            className="harvest-workspace__commit"
            onClick={onCommitStaged}
            disabled={stagedCount === 0}
          >
            Commit Staged ({stagedCount})
          </button>
        </div>
      </header>

      {/* Message Navigation Stepper */}
      <nav className="harvest-workspace__stepper">
        <button
          className="harvest-workspace__step-btn"
          onClick={goPrev}
          disabled={!canGoPrev}
          title="Previous (k or ↑)"
        >
          ← Prev
        </button>
        <div className="harvest-workspace__step-position">
          <input
            type="number"
            className="harvest-workspace__step-input"
            value={currentIndex + 1}
            min={1}
            max={totalMessages}
            onChange={(e) => goToMessage(parseInt(e.target.value, 10) - 1)}
          />
          <span className="harvest-workspace__step-total">/ {totalMessages}</span>
        </div>
        <button
          className="harvest-workspace__step-btn"
          onClick={goNext}
          disabled={!canGoNext}
          title="Next (j or ↓)"
        >
          Next →
        </button>
      </nav>

      {/* Content Area */}
      <div className={`harvest-workspace__body harvest-workspace__body--${viewMode}`}>
        {viewMode === 'single' ? (
          /* Single message view */
          <div className="harvest-workspace__single">
            {currentMessage && (
              <MessageCard
                message={currentMessage}
                isStaged={isCurrentStaged}
                stagedStatus={currentStagedStatus}
                onStage={handleStage}
                onGem={handleGem}
                onSkip={handleSkip}
                isCurrent
              />
            )}
          </div>
        ) : (
          /* All messages view */
          <div className="harvest-workspace__all">
            {messages.map((message, index) => {
              const isStaged = stagedMessages.some(s => s.messageId === message.id);
              const stagedStatus = stagedMessages.find(s => s.messageId === message.id)?.status;

              return (
                <div
                  key={message.id}
                  ref={(el) => el && messageRefs.current.set(index, el)}
                >
                  <MessageCard
                    message={message}
                    isStaged={isStaged}
                    stagedStatus={stagedStatus}
                    onStage={() => {
                      if (isStaged) {
                        onUnstageMessage(message.id);
                      } else {
                        onStageMessage({
                          messageId: message.id,
                          conversationId: conversation.conversationId,
                          conversationTitle: conversation.title,
                          content: message.content,
                          role: message.role === 'system' ? 'assistant' : message.role,
                          status: 'staged',
                          stagedAt: Date.now(),
                        });
                      }
                    }}
                    onGem={() => {
                      onStageMessage({
                        messageId: message.id,
                        conversationId: conversation.conversationId,
                        conversationTitle: conversation.title,
                        content: message.content,
                        role: message.role === 'system' ? 'assistant' : message.role,
                        status: 'gem',
                        stagedAt: Date.now(),
                      });
                    }}
                    onSkip={() => {}}
                    onClick={() => {
                      setCurrentIndex(index);
                      if (viewMode === 'all') {
                        setViewMode('single');
                      }
                    }}
                    isCurrent={index === currentIndex}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Keyboard hints */}
      <footer className="harvest-workspace__hints">
        <span className="harvest-workspace__hint">
          <kbd>j</kbd>/<kbd>k</kbd> navigate
        </span>
        <span className="harvest-workspace__hint">
          <kbd>s</kbd> stage
        </span>
        <span className="harvest-workspace__hint">
          <kbd>*</kbd> gem
        </span>
        <span className="harvest-workspace__hint">
          <kbd>x</kbd> skip
        </span>
        <span className="harvest-workspace__hint">
          <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>
  );
}

// ============================================
// Message Card Component
// ============================================

interface MessageCardProps {
  message: ConversationMessage;
  isStaged: boolean;
  stagedStatus?: 'staged' | 'gem';
  onStage: () => void;
  onGem: () => void;
  onSkip: () => void;
  onClick?: () => void;
  isCurrent?: boolean;
}

function MessageCard({
  message,
  isStaged,
  stagedStatus,
  onStage,
  onGem,
  onSkip,
  onClick,
  isCurrent,
}: MessageCardProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <article
      className={`harvest-message harvest-message--${message.role} ${isCurrent ? 'harvest-message--current' : ''} ${isStaged ? `harvest-message--staged harvest-message--${stagedStatus}` : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Role indicator */}
      <div className="harvest-message__role">
        <span className="harvest-message__role-icon">
          {isUser ? '👤' : isSystem ? '⚙️' : '🤖'}
        </span>
        <span className="harvest-message__role-label">
          {isUser ? 'You' : isSystem ? 'System' : 'Assistant'}
        </span>
        {isStaged && (
          <span className={`harvest-message__staged-badge harvest-message__staged-badge--${stagedStatus}`}>
            {stagedStatus === 'gem' ? '⭐ Gem' : '✓ Staged'}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="harvest-message__content">
        <MathMarkdown>{message.content}</MathMarkdown>
      </div>

      {/* Actions - only for non-system messages */}
      {!isSystem && (
        <div className="harvest-message__actions">
          <button
            className={`harvest-message__action ${isStaged && stagedStatus === 'staged' ? 'harvest-message__action--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onStage(); }}
            title={isStaged ? 'Unstage (s)' : 'Stage (s)'}
          >
            {isStaged ? '✓ Staged' : '+ Stage'}
          </button>
          <button
            className={`harvest-message__action harvest-message__action--gem ${stagedStatus === 'gem' ? 'harvest-message__action--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onGem(); }}
            title="Mark as Gem (*)"
          >
            ⭐ Gem
          </button>
          <button
            className="harvest-message__action harvest-message__action--skip"
            onClick={(e) => { e.stopPropagation(); onSkip(); }}
            title="Skip (x)"
          >
            Skip →
          </button>
        </div>
      )}

      {/* Timestamp if available */}
      {message.timestamp && (
        <time className="harvest-message__time">
          {new Date(message.timestamp).toLocaleString()}
        </time>
      )}
    </article>
  );
}

export default HarvestWorkspaceView;
