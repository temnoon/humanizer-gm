/**
 * Main Workspace Component
 *
 * The primary content editing panel for the Studio. Handles:
 * - Read/Edit mode toggle with split view editor
 * - Facebook media and content viewing (via ContentViewer, MediaViewer)
 * - ChatGPT conversation navigation
 * - Book content with save functionality
 * - Keyboard shortcuts (Cmd+E, Cmd+S, Cmd+B, Cmd+1/2/3)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { useBuffers } from '../../lib/buffer';
import {
  fetchConversation,
  getMessages,
} from '../../lib/archive';
import { useTheme } from '../../lib/theme/ThemeContext';
import { useBookshelf, type DraftChapter } from '../../lib/bookshelf';
import type { SelectedFacebookMedia, SelectedFacebookContent } from '../archive';
import { WelcomeScreen } from './WelcomeScreen';
import { AnalyzableMarkdown } from './AnalyzableMarkdown';
import { AddToBookDialog, type AddAction } from '../dialogs/AddToBookDialog';
import { getArchiveServerUrlSync, isElectron } from '../../lib/platform';
import { ContentViewer } from './ContentViewer';
import { MediaViewer } from './MediaViewer';

/**
 * Convert ChatGPT-style LaTeX delimiters to standard $ delimiters
 * ChatGPT uses \(...\) for inline and \[...\] for display
 * remarkMath expects $...$ for inline and $$...$$ for display
 */
function processLatex(content: string): string {
  return content
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
}

export interface MainWorkspaceProps {
  selectedMedia?: SelectedFacebookMedia | null;
  selectedContent?: SelectedFacebookContent | null;
  onClearMedia?: () => void;
  onClearContent?: () => void;
  onUpdateMedia?: (media: SelectedFacebookMedia) => void;
  onGoToBook?: () => void;
}

export type WorkspaceViewMode = 'read' | 'edit';

/**
 * Media URL helper - handles both full URLs and file paths
 * Uses Electron's custom protocol for direct file serving, or falls back to archive server
 */
function getMediaUrl(filePath: string): string {
  // If it's already a full URL, use it directly
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  // If it's already a local-media URL, use it directly
  if (filePath.startsWith('local-media://')) {
    return filePath;
  }
  // In Electron, use the custom protocol for direct file serving
  if (isElectron) {
    // URL format: local-media://serve/<absolute-path>
    return `local-media://serve${filePath}`;
  }
  // In browser, use archive server with URL encoding (dynamic port from platform config)
  const archiveServer = getArchiveServerUrlSync();
  if (!archiveServer) {
    console.warn('Archive server URL not initialized, media may not load');
    return filePath; // Return raw path as fallback
  }
  return `${archiveServer}/api/facebook/serve-media?path=${encodeURIComponent(filePath)}`;
}

export function MainWorkspace({ selectedMedia, selectedContent, onClearMedia, onClearContent, onUpdateMedia, onGoToBook }: MainWorkspaceProps) {
  const { activeContent, activeNode, activeBuffer, getNodeHistory, importText, graph: _graph, buffers: _buffers } = useBuffers();
  const { setEditorWidth } = useTheme();
  const bookshelf = useBookshelf();
  const [navLoading, setNavLoading] = useState(false);
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('read');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editContent, setEditContent] = useState('');
  const [splitPosition, setSplitPosition] = useState(50); // Percentage for editor pane
  const [isDragging, setIsDragging] = useState(false);
  const [mobileActivePane, setMobileActivePane] = useState<'editor' | 'preview'>('editor');
  const [showAddToBookDialog, setShowAddToBookDialog] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const splitViewRef = useRef<HTMLDivElement>(null);

  // Sync editContent when activeContent changes
  useEffect(() => {
    if (activeContent) {
      const text = Array.isArray(activeContent)
        ? activeContent.map(i => i.text).join('\n\n')
        : activeContent.text;
      setEditContent(text);
    }
  }, [activeContent]);

  // Handle edit content change
  const handleEditChange = (newContent: string) => {
    setEditContent(newContent);
  };

  // Apply edits to buffer (creates new node)
  const applyEdits = useCallback(() => {
    if (!activeNode || !activeBuffer) return;
    // Import the edited text as a new node
    const title = activeNode.metadata.title || 'Edited Content';
    importText(editContent, title, activeNode.metadata.source);
    setViewMode('read');
  }, [activeNode, activeBuffer, editContent, importText]);

  // Check if current content is from a book project
  const isBookContent = activeNode?.metadata?.type?.startsWith('book-') ?? false;
  const bookProjectId = activeNode?.metadata?.bookProjectId as string | undefined;
  const chapterId = activeNode?.metadata?.itemId as string | undefined;
  const canSaveToBook = isBookContent && bookProjectId && chapterId;

  // Save workspace content to book draft
  const handleSaveToBook = useCallback(async () => {
    if (!canSaveToBook || !bookProjectId || !chapterId) return;

    setSaveStatus('saving');

    try {
      const content = editContent || (Array.isArray(activeContent)
        ? activeContent.map((i) => i.text).join('\n\n')
        : activeContent?.text || '');

      const result = await bookshelf.saveDraftVersion(
        bookProjectId,
        chapterId,
        content,
        { changes: 'Saved from workspace', createdBy: 'user' }
      );

      if (result) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (err) {
      console.error('[Workspace] Save to book failed:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [canSaveToBook, bookProjectId, chapterId, editContent, activeContent, bookshelf]);

  // Handle Add to Book dialog confirm
  const handleAddToBook = useCallback((
    targetBookUri: string,
    action: AddAction,
    chapterTitle: string,
    targetChapterId?: string
  ) => {
    const content = editContent || (Array.isArray(activeContent)
      ? activeContent.map((i) => i.text).join('\n\n')
      : activeContent?.text || '');

    if (action === 'new') {
      // Create new chapter
      const newChapter: DraftChapter = {
        id: `chapter-${Date.now()}`,
        number: (bookshelf.getBook(targetBookUri)?.chapters?.length ?? 0) + 1,
        title: chapterTitle,
        content,
        wordCount: content.trim().split(/\s+/).filter(Boolean).length,
        version: 1,
        versions: [{
          version: 1,
          timestamp: Date.now(),
          content,
          wordCount: content.trim().split(/\s+/).filter(Boolean).length,
          changes: 'Initial version from workspace',
          createdBy: 'user',
        }],
        status: 'drafting',
        sections: [],
        marginalia: [],
        metadata: {
          lastEditedBy: 'user',
          lastEditedAt: Date.now(),
        },
        passageRefs: [],
      };
      bookshelf.addChapter(targetBookUri, newChapter);
      console.log(`[Workspace] Added new chapter "${chapterTitle}" to book`);
    } else if (action === 'append' && targetChapterId) {
      // Append to existing chapter
      const book = bookshelf.getBook(targetBookUri);
      const chapter = book?.chapters.find((c) => c.id === targetChapterId);
      if (chapter) {
        const newContent = chapter.content + '\n\n' + content;
        bookshelf.saveDraftVersion(targetBookUri, targetChapterId, newContent, {
          changes: 'Appended content from workspace',
          createdBy: 'user',
        });
        console.log(`[Workspace] Appended to chapter "${chapter.title}"`);
      }
    } else if (action === 'replace' && targetChapterId) {
      // Replace chapter content
      bookshelf.saveDraftVersion(targetBookUri, targetChapterId, content, {
        changes: 'Replaced content from workspace',
        createdBy: 'user',
      });
      console.log(`[Workspace] Replaced chapter content`);
    }

    setShowAddToBookDialog(false);
  }, [editContent, activeContent, bookshelf]);

  // Keyboard shortcuts:
  // ⌘E - Toggle edit mode
  // ⌘S - Save to book (when book content is active)
  // ⌘B - Add to book dialog
  // ⌘1/2/3 - Set editor width (Narrow/Medium/Wide)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'e':
            e.preventDefault();
            setViewMode(prev => prev === 'read' ? 'edit' : 'read');
            if (viewMode === 'read') {
              setTimeout(() => editorRef.current?.focus(), 0);
            }
            break;
          case 's':
            // Save to book if book content is active
            if (canSaveToBook) {
              e.preventDefault();
              handleSaveToBook();
            }
            break;
          case 'b':
            // Open Add to Book dialog
            if (activeContent) {
              e.preventDefault();
              setShowAddToBookDialog(true);
            }
            break;
          case '1':
            e.preventDefault();
            setEditorWidth('narrow');
            break;
          case '2':
            e.preventDefault();
            setEditorWidth('medium');
            break;
          case '3':
            e.preventDefault();
            setEditorWidth('wide');
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, setEditorWidth, canSaveToBook, handleSaveToBook, activeContent]);

  // Resizable divider handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!splitViewRef.current) return;
      const rect = splitViewRef.current.getBoundingClientRect();
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp between 20% and 80%
      setSplitPosition(Math.min(80, Math.max(20, newPosition)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // Get source info for navigation
  const source = activeNode?.metadata?.source;
  const hasConversationNav = source?.type === 'chatgpt' &&
    source.conversationFolder &&
    source.messageIndex !== undefined &&
    source.totalMessages !== undefined;

  const currentIndex = source?.messageIndex ?? 0;
  const totalMessages = source?.totalMessages ?? 0;
  const canGoPrev = hasConversationNav && currentIndex > 0;
  const canGoNext = hasConversationNav && currentIndex < totalMessages - 1;

  // Navigate to a different message in the same conversation
  const navigateToMessage = async (targetIndex: number) => {
    if (!source?.conversationFolder || navLoading) return;

    setNavLoading(true);
    try {
      const conv = await fetchConversation(source.conversationFolder);
      const archiveServer = getArchiveServerUrlSync() || '';
      const messages = getMessages(conv, conv.messages.length, archiveServer); // Get all messages
      const targetMsg = messages[targetIndex];

      if (targetMsg) {
        importText(targetMsg.content, `${conv.title} [${targetMsg.role}]`, {
          type: 'chatgpt',
          conversationId: conv.id,
          conversationFolder: source.conversationFolder,
          messageId: targetMsg.id,
          messageIndex: targetIndex,
          totalMessages: messages.length,
          path: [conv.title, `Message ${targetIndex + 1}`],
        });
      }
    } catch (err) {
      console.error('Failed to navigate:', err);
    } finally {
      setNavLoading(false);
    }
  };

  // Render content viewer if selectedContent is set (Facebook posts/comments)
  if (selectedContent) {
    return (
      <ContentViewer
        content={selectedContent}
        onClose={onClearContent}
        getMediaUrl={getMediaUrl}
      />
    );
  }

  // Render media viewer if selectedMedia is set
  if (selectedMedia) {
    return (
      <MediaViewer
        media={selectedMedia}
        onClose={onClearMedia}
        onUpdateMedia={onUpdateMedia}
        getMediaUrl={getMediaUrl}
      />
    );
  }

  if (!activeContent || !activeNode) {
    return <WelcomeScreen />;
  }

  const items = Array.isArray(activeContent) ? activeContent : [activeContent];
  const isArray = Array.isArray(activeContent);

  // Get operation history
  const history = getNodeHistory();

  return (
    <div className="workspace">
      {/* Breadcrumb / Path */}
      {activeNode.metadata.source && (
        <nav className="workspace__breadcrumb">
          {activeNode.metadata.source.path.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="workspace__breadcrumb-sep">›</span>}
              {p}
            </span>
          ))}
        </nav>
      )}

      {/* Conversation Navigation - Title centered with arrows on sides */}
      {hasConversationNav && (
        <div className="workspace__nav workspace__nav--centered">
          <div className="workspace__nav-left">
            <button
              className="workspace__nav-btn"
              onClick={() => navigateToMessage(currentIndex - 1)}
              disabled={!canGoPrev || navLoading}
              title="Previous message"
            >
              ←
            </button>
          </div>
          <div className="workspace__nav-center">
            <span className="workspace__nav-title">
              {/* Show beginning of content as title, truncated */}
              {(() => {
                const firstItem = Array.isArray(activeContent) ? activeContent[0] : activeContent;
                const text = firstItem?.text || '';
                return (text.slice(0, 80).replace(/\n/g, ' ').trim()) || activeNode.metadata.title || 'Untitled';
              })()}
            </span>
            <span className="workspace__nav-position">
              {currentIndex + 1} / {totalMessages}
            </span>
          </div>
          <div className="workspace__nav-right">
            <button
              className="workspace__nav-btn"
              onClick={() => navigateToMessage(currentIndex + 1)}
              disabled={!canGoNext || navLoading}
              title="Next message"
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* Stats bar */}
      {isArray && (
        <div className="workspace__stats">
          <span className="workspace__stat">{items.length} items</span>
          {activeNode.metadata.avgSicScore !== undefined && (
            <span className="workspace__stat">
              SIC: {activeNode.metadata.avgSicScore.toFixed(0)} avg
            </span>
          )}
          {history.length > 1 && (
            <span className="workspace__stat">
              {history.length - 1} operations
            </span>
          )}
        </div>
      )}

      {/* Workspace Header: View Toggle + Actions */}
      <div className="workspace__header">
        <div className="workspace__view-toggle">
          <button
            className={`workspace__view-btn ${viewMode === 'read' ? 'workspace__view-btn--active' : ''}`}
            onClick={() => setViewMode('read')}
          >
            Read
          </button>
          <button
            className={`workspace__view-btn ${viewMode === 'edit' ? 'workspace__view-btn--active' : ''}`}
            onClick={() => {
              setViewMode('edit');
              setTimeout(() => editorRef.current?.focus(), 0);
            }}
          >
            Edit
          </button>
          <span className="workspace__view-hint">⌘E</span>
        </div>

        {/* Book Selector Dropdown */}
        <div className="workspace__book-selector">
          <select
            value={bookshelf.activeBookUri || ''}
            onChange={(e) => {
              const uri = e.target.value;
              bookshelf.setActiveBookUri(uri ? (uri as `${string}://${string}`) : null);
            }}
            className="workspace__book-select"
            title="Active book for Add to Book"
          >
            <option value="">No book selected</option>
            {bookshelf.books.map(book => (
              <option key={book.uri} value={book.uri}>
                {book.name}
              </option>
            ))}
          </select>
          {bookshelf.activeBookUri && onGoToBook && (
            <button
              className="workspace__go-to-book-btn"
              onClick={onGoToBook}
              title="Go to this book in Archive"
            >
              →
            </button>
          )}
        </div>

        <div className="workspace__actions">
          {/* Save to Book - only shown when editing book content */}
          {canSaveToBook && (
            <>
              <button
                className={`workspace__action-btn workspace__action-btn--save ${saveStatus === 'saving' ? 'workspace__action-btn--saving' : ''} ${saveStatus === 'saved' ? 'workspace__action-btn--saved' : ''} ${saveStatus === 'error' ? 'workspace__action-btn--error' : ''}`}
                onClick={handleSaveToBook}
                disabled={saveStatus === 'saving'}
                aria-label="Save content to book chapter"
                title="Save to Book (⌘S)"
              >
                {saveStatus === 'idle' && '💾 Save'}
                {saveStatus === 'saving' && '...'}
                {saveStatus === 'saved' && '✓ Saved'}
                {saveStatus === 'error' && '✗ Error'}
              </button>
              <span className="workspace__action-divider" />
            </>
          )}
          {/* Save status announcement for screen readers */}
          <span
            role="status"
            aria-live="polite"
            className="sr-only"
          >
            {saveStatus === 'saved' && 'Draft saved successfully'}
            {saveStatus === 'error' && 'Failed to save draft'}
          </span>
          {/* Add to Book button - always visible */}
          <button
            className="workspace__action-btn workspace__action-btn--add-to-book"
            onClick={() => setShowAddToBookDialog(true)}
            aria-label="Add content to a book"
            title="Add to Book (⌘B)"
          >
            📚
          </button>
          <span className="workspace__action-divider" />
          <button
            className="workspace__action-btn"
            onClick={() => {
              const text = items.map(i => i.text).join('\n\n');
              const blob = new Blob([text], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${activeNode.metadata.title || 'content'}.md`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            title="Download as markdown file"
          >
            ↓
          </button>
          <button
            className="workspace__action-btn"
            onClick={async () => {
              const text = items.map(i => i.text).join('\n\n');
              await navigator.clipboard.writeText(text);
            }}
            title="Copy as plain text"
          >
            ⎘
          </button>
          <button
            className="workspace__action-btn workspace__action-btn--md"
            onClick={async () => {
              const text = items.map(i => i.text).join('\n\n');
              await navigator.clipboard.writeText(text);
            }}
            title="Copy as markdown"
          >
            MD
          </button>
        </div>
      </div>

      {/* Content - Read or Edit Mode */}
      {viewMode === 'read' ? (
        <article className="workspace__article">
          {items.map((item, i) => (
            <div key={item.id} className={isArray ? 'workspace__item' : ''}>
              {isArray && items.length > 1 && (
                <div className="workspace__item-index">{i + 1}</div>
              )}
              <AnalyzableMarkdown
                content={processLatex(item.text)}
                className="workspace__markdown"
              />
              {item.metadata?.sicScore !== undefined && (
                <div className="workspace__item-sic">
                  SIC: {item.metadata.sicScore.toFixed(0)}
                </div>
              )}
            </div>
          ))}
        </article>
      ) : (
        <div
          ref={splitViewRef}
          className="workspace__split-view"
          data-active-pane={mobileActivePane}
          style={{
            gridTemplateColumns: `${splitPosition}% 8px ${100 - splitPosition}%`,
          }}
        >
          {/* Mobile pane toggle (portrait only) */}
          <div className="workspace__mobile-tabs">
            <button
              className={`workspace__mobile-tab ${mobileActivePane === 'editor' ? 'workspace__mobile-tab--active' : ''}`}
              onClick={() => setMobileActivePane('editor')}
            >
              Editor
            </button>
            <button
              className={`workspace__mobile-tab ${mobileActivePane === 'preview' ? 'workspace__mobile-tab--active' : ''}`}
              onClick={() => setMobileActivePane('preview')}
            >
              Preview
            </button>
          </div>

          {/* Editor Pane */}
          <div className="workspace__editor-pane">
            <textarea
              ref={editorRef}
              className="workspace__editor"
              value={editContent}
              onChange={(e) => handleEditChange(e.target.value)}
              placeholder="Edit markdown content..."
            />
            <div className="workspace__editor-actions">
              <button
                className="workspace__editor-btn workspace__editor-btn--primary"
                onClick={applyEdits}
              >
                Apply Changes
              </button>
              <button
                className="workspace__editor-btn workspace__editor-btn--secondary"
                onClick={() => setViewMode('read')}
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Resizable Divider */}
          <div
            className={`workspace__split-divider ${isDragging ? 'workspace__split-divider--dragging' : ''}`}
            onMouseDown={handleDividerMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and preview panes"
          />

          {/* Preview Pane */}
          <div className="workspace__preview-pane">
            <article className="workspace__article">
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[[rehypeKatex, { strict: false, trust: true }]]}
              >
                {processLatex(editContent)}
              </ReactMarkdown>
            </article>
          </div>
        </div>
      )}

      {/* Add to Book Dialog */}
      <AddToBookDialog
        isOpen={showAddToBookDialog}
        onClose={() => setShowAddToBookDialog(false)}
        content={editContent || (Array.isArray(activeContent)
          ? activeContent.map((i) => i.text).join('\n\n')
          : activeContent?.text || '')}
        title={activeNode?.metadata?.title || 'Untitled'}
        onConfirm={handleAddToBook}
      />
    </div>
  );
}
