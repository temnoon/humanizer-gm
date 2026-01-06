import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

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

import {
  BufferProvider,
  useBuffers,
  type OperatorDefinition,
  type ArchiveSource,
  type ArchiveSourceType,
} from './lib/buffer';
import {
  fetchConversations,
  fetchConversation,
  getMessages,
  groupConversationsByMonth,
  checkArchiveHealth,
  getCurrentArchive,
  type ArchiveConversation,
  type FlatMessage,
} from './lib/archive';
import {
  humanize,
  transformPersona,
  transformStyle,
  analyzeSentences,
  getPersonas,
  getStyles,
  type HumanizationIntensity,
  type TransformResult,
  type PersonaDefinition,
  type StyleDefinition,
  type SentenceAnalysisResult,
} from './lib/transform';
import { useAuth } from './lib/auth';
import { LoginPage } from './components/auth/LoginPage';
// BookProvider removed - consolidated into BookshelfProvider (Phase 4.2)
import { BookshelfProvider, useBookshelf, type DraftChapter } from './lib/bookshelf';
import { executeAllTools, executeTool, buildAUIContext, AUI_BOOK_SYSTEM_PROMPT, AUIProvider, useAUI, subscribeToGUIActions, type AUIContext, type WorkspaceState } from './lib/aui';
import { ThemeProvider, useTheme } from './lib/theme/ThemeContext';
import { ThemeSettingsModal } from './components/theme/ThemeSettingsModal';
import { ArchiveTabs, type SelectedFacebookMedia, type SelectedFacebookContent, type ArchiveTabId, type SearchResult } from './components/archive';
import { BookContentView, ContainerWorkspace, AnalyzableMarkdown, WelcomeScreen, StructureInspector, HarvestWorkspaceView, type BookContent, type HarvestConversation, type StagedMessage } from './components/workspace';
import type { BookProject } from './components/archive/book-project/types';
import { ProfileCardsContainer } from './components/tools/ProfileCards';
import { HarvestQueuePanel } from './components/tools/HarvestQueuePanel';
import { SocialGraphView } from './components/graph';
import { useLayout, CornerAssistant, PanelResizer, usePanelState, useLayoutMode, useSplitScreen, SplitScreenWorkspace, useHighlights, useSplitMode, type SplitPaneContent } from './components/layout';
import { AddToBookDialog, type AddAction } from './components/dialogs/AddToBookDialog';
import type { SentenceAnalysis } from './lib/analysis';
import type { ArchiveContainer } from '@humanizer/core';
import {
  facebookMediaToContainer,
  facebookContentToContainer,
} from './lib/archive';
import { getArchiveServerUrlSync, initPlatformConfig, isElectron } from './lib/platform';

// ═══════════════════════════════════════════════════════════════════
// HOVER PANEL
// ═══════════════════════════════════════════════════════════════════

interface HoverPanelProps {
  side: 'left' | 'right';
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}

function HoverPanel({ side, isOpen, onToggle, title, children }: HoverPanelProps) {
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

// ═══════════════════════════════════════════════════════════════════
// ARCHIVE PANEL
// ═══════════════════════════════════════════════════════════════════

interface ArchivePanelProps {
  onClose: () => void;
  onSelectMedia: (media: SelectedFacebookMedia) => void;
  onSelectContent: (content: SelectedFacebookContent) => void;
  onOpenGraph: () => void;
  onSelectBookContent?: (content: BookContent, project: BookProject) => void;
  /** Callback when semantic search result is selected */
  onSelectSearchResult?: (result: SearchResult) => void;
  /** External tab navigation command */
  navigateToTab?: ArchiveTabId;
  /** Callback when tab changes */
  onTabChange?: (tab: ArchiveTabId) => void;
}

function ArchivePanel({ onClose, onSelectMedia, onSelectContent, onOpenGraph, onSelectBookContent, onSelectSearchResult, navigateToTab, onTabChange }: ArchivePanelProps) {
  const { importText, buffers, activeNode } = useBuffers();

  // Get the currently selected conversation folder from workspace
  const selectedConversationFolder = activeNode?.metadata?.source?.conversationFolder;

  // Auto-scroll to selected conversation when it changes
  useEffect(() => {
    if (!selectedConversationFolder) return;

    // Wait a tick for DOM to update
    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-conversation-folder="${selectedConversationFolder}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedConversationFolder]);

  // Archive state
  const [allConversations, setAllConversations] = useState<ArchiveConversation[]>([]); // Full index for search
  const [conversations, setConversations] = useState<ArchiveConversation[]>([]); // Current page
  const [loading, setLoading] = useState(true);
  const [_indexLoading, setIndexLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<FlatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [archiveInfo, setArchiveInfo] = useState<{ name: string; conversationCount: number } | null>(null);

  // Pagination, sorting, search, and filters
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'messages-desc' | 'length-desc' | 'length-asc' | 'words-desc' | 'words-asc'>('messages-desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [hideTrivial, setHideTrivial] = useState(false); // Hide ≤5 word conversations
  const [mediaFilter, setMediaFilter] = useState<'all' | 'images' | 'audio' | 'any' | 'code'>('all');
  const [minWords, setMinWords] = useState<number | null>(null);
  const [maxWords, setMaxWords] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(50); // Virtual scroll: items to render
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 50;

  // Estimate word count from text_length (avg ~5 chars per word)
  const estimateWords = (textLength: number) => Math.round(textLength / 5);

  // Filter ALL conversations by search query and additional filters
  const filteredConversations = useMemo(() => {
    let result = searchQuery.trim()
      ? allConversations.filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : conversations;

    // Apply word count filters
    if (hideTrivial) {
      result = result.filter(c => estimateWords(c.text_length) > 5);
    }
    if (minWords !== null) {
      result = result.filter(c => estimateWords(c.text_length) >= minWords);
    }
    if (maxWords !== null) {
      result = result.filter(c => estimateWords(c.text_length) <= maxWords);
    }

    // Sort by words if selected
    if (sortBy === 'words-desc') {
      result = [...result].sort((a, b) => b.text_length - a.text_length);
    } else if (sortBy === 'words-asc') {
      result = [...result].sort((a, b) => a.text_length - b.text_length);
    }

    return result;
  }, [searchQuery, allConversations, conversations, hideTrivial, minWords, maxWords, sortBy]);

  // Virtual scroll: Only render visible items
  const visibleConversations = useMemo(() => {
    const allFiltered = filteredConversations;
    return allFiltered.slice(0, visibleCount);
  }, [filteredConversations, visibleCount]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, hideTrivial, minWords, maxWords, sortBy, mediaFilter]);

  // IntersectionObserver to load more as user scrolls
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < filteredConversations.length) {
          setVisibleCount(prev => Math.min(prev + 50, filteredConversations.length));
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [visibleCount, filteredConversations.length]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
    loadArchiveInfo();
    loadSearchIndex();
  }, []);

  const loadArchiveInfo = async () => {
    const info = await getCurrentArchive();
    setArchiveInfo(info);
  };

  // Load ALL conversations for title search (just metadata, no messages)
  const loadSearchIndex = async () => {
    setIndexLoading(true);
    try {
      // Load all conversations (no limit) for search index, with filters
      const result = await fetchConversations({
        sortBy: 'recent',
        minMessages: hideEmpty ? 1 : undefined,
        hasImages: mediaFilter === 'images' ? true : undefined,
        hasAudio: mediaFilter === 'audio' ? true : undefined,
        hasMedia: mediaFilter === 'any' ? true : undefined,
      });
      setAllConversations(result.conversations);
    } catch (err) {
      console.error('Failed to load search index:', err);
    } finally {
      setIndexLoading(false);
    }
  };

  const loadConversations = async (
    newOffset = 0,
    newSortBy = sortBy,
    newHideEmpty = hideEmpty,
    newMediaFilter = mediaFilter
  ) => {
    setLoading(true);
    setError(null);

    try {
      // Check if archive server is available
      const healthy = await checkArchiveHealth();
      if (!healthy) {
        setError('Archive server not available. The embedded server may still be starting...');
        setLoading(false);
        return;
      }

      // Map words-* sort options to length-* for server-side sorting
      const serverSortBy = newSortBy === 'words-desc' ? 'length-desc'
        : newSortBy === 'words-asc' ? 'length-asc'
        : newSortBy;

      const result = await fetchConversations({
        limit: PAGE_SIZE,
        offset: newOffset,
        sortBy: serverSortBy,
        minMessages: newHideEmpty ? 1 : undefined,
        hasImages: newMediaFilter === 'images' ? true : undefined,
        hasAudio: newMediaFilter === 'audio' ? true : undefined,
        hasMedia: newMediaFilter === 'any' ? true : undefined,
      });

      setConversations(result.conversations);
      setTotal(result.total);
      setOffset(newOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  const handleSortChange = (newSort: typeof sortBy) => {
    setSortBy(newSort);
    loadConversations(0, newSort, hideEmpty, mediaFilter);
  };

  const handleHideEmptyChange = (hide: boolean) => {
    setHideEmpty(hide);
    loadConversations(0, sortBy, hide, mediaFilter);
    // Reload search index with new filter
    loadSearchIndex();
  };

  const handleMediaFilterChange = (filter: typeof mediaFilter) => {
    setMediaFilter(filter);
    loadConversations(0, sortBy, hideEmpty, filter);
    // Reload search index with new filter
    loadSearchIndex();
  };

  const handleExpandConversation = async (conv: ArchiveConversation) => {
    if (expandedConv === conv.folder) {
      setExpandedConv(null);
      setExpandedMessages([]);
      return;
    }

    setExpandedConv(conv.folder);
    setLoadingMessages(true);

    try {
      const fullConv = await fetchConversation(conv.folder);
      // Limit to first 20 messages for quick loading
      const archiveServer = getArchiveServerUrlSync() || '';
      const messages = getMessages(fullConv, 20, archiveServer);
      setExpandedMessages(messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setExpandedMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSelectMessage = (conv: ArchiveConversation, msg: FlatMessage, totalMessages: number) => {
    importText(msg.content, `${conv.title} [${msg.role}]`, {
      type: 'chatgpt',
      conversationId: conv.id,
      conversationFolder: conv.folder,
      messageId: msg.id,
      messageIndex: msg.index,
      totalMessages,
      path: [conv.title, `Message ${(msg.index ?? 0) + 1}`],
    });
    onClose();
  };

  // Handle Gutenberg text selection
  const handleSelectGutenbergText = (text: string, title: string) => {
    importText(text, title, {
      type: 'gutenberg',
      path: ['gutenberg', title],
    });
    onClose();
  };

  const handleImportFullConversation = (conv: ArchiveConversation) => {
    const allContent = expandedMessages
      .map(m => `**[${m.role.toUpperCase()}]**\n\n${m.content}`)
      .join('\n\n---\n\n');
    importText(allContent, conv.title);
    onClose();
  };

  // Group filtered conversations by month
  // Group only visible conversations for rendering (virtual scroll)
  const groupedConversations = groupConversationsByMonth(visibleConversations);

  // Show buffer list
  const allBuffers = buffers.getAllBuffers();

  // Render the conversation browser content
  const renderConversationsBrowser = () => (
    <div className="archive-browser">
      {/* Archive Info */}
      {archiveInfo && (
        <div className="archive-browser__info">
          <span className="archive-browser__info-name">{archiveInfo.name}</span>
          <span className="archive-browser__info-count">{archiveInfo.conversationCount.toLocaleString()} conversations</span>
        </div>
      )}

      {/* Search */}
      <div className="archive-browser__search">
        <input
          type="text"
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="archive-browser__search-input"
        />
        {searchQuery && (
          <button
            className="archive-browser__search-clear"
            onClick={() => setSearchQuery('')}
          >
            ×
          </button>
        )}
      </div>

      {/* Buffer List */}
      {allBuffers.length > 0 && (
        <div className="archive-browser__section">
          <h3 className="archive-browser__section-title">Buffers</h3>
          <div className="archive-browser__list">
            {allBuffers.map(buffer => (
              <button
                key={buffer.id}
                className={`archive-item__header ${buffers.getActiveBufferId() === buffer.id ? 'archive-item__header--expanded' : ''}`}
                onClick={() => buffers.setActiveBuffer(buffer.id)}
              >
                <span className="archive-item__icon">◉</span>
                <span className="archive-item__title">{buffer.name}</span>
                {buffer.pinned && <span className="archive-item__date">📌</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="archive-browser__error">
          <p>{error}</p>
          <button onClick={() => loadConversations()} className="archive-browser__retry">
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="archive-browser__loading">
          Loading conversations...
        </div>
      )}

      {/* Conversations grouped by month */}
      {!loading && !error && (
        <div className="archive-browser__section">
          <div className="archive-browser__header">
            <h3 className="archive-browser__section-title">
              {searchQuery ? 'Results' : 'Archive'}
              <span className="archive-browser__total">
                {searchQuery
                  ? ` (${filteredConversations.length} of ${total.toLocaleString()})`
                  : total > 0 ? ` (${total.toLocaleString()})` : ''
                }
              </span>
            </h3>
            <div className="archive-browser__filters">
              {/* Sort options */}
              <select
                className="archive-browser__filter"
                value={sortBy}
                onChange={(e) => handleSortChange(e.target.value as typeof sortBy)}
                title="Sort by"
              >
                <optgroup label="By Messages">
                  <option value="messages-desc">Most messages</option>
                </optgroup>
                <optgroup label="By Length">
                  <option value="length-desc">Longest first</option>
                  <option value="length-asc">Shortest first</option>
                  <option value="words-desc">Most words</option>
                  <option value="words-asc">Fewest words</option>
                </optgroup>
                <optgroup label="By Date">
                  <option value="recent">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </optgroup>
              </select>

              {/* Content type filter */}
              <select
                className="archive-browser__filter"
                value={mediaFilter}
                onChange={(e) => handleMediaFilterChange(e.target.value as typeof mediaFilter)}
                title="Filter by content"
              >
                <option value="all">All types</option>
                <option value="images">Has images</option>
                <option value="audio">Has audio</option>
                <option value="any">Has media</option>
                <option value="code">Has code</option>
              </select>

              {/* Word count range */}
              <div className="archive-browser__filter-group" title="Filter by word count">
                <input
                  type="number"
                  className="archive-browser__filter-input"
                  placeholder="Min words"
                  min={0}
                  value={minWords ?? ''}
                  onChange={(e) => setMinWords(e.target.value ? parseInt(e.target.value) : null)}
                />
                <span className="archive-browser__filter-sep">–</span>
                <input
                  type="number"
                  className="archive-browser__filter-input"
                  placeholder="Max"
                  min={0}
                  value={maxWords ?? ''}
                  onChange={(e) => setMaxWords(e.target.value ? parseInt(e.target.value) : null)}
                />
              </div>

              {/* Quick filters */}
              <div className="archive-browser__checkboxes">
                <label className="archive-browser__checkbox" title="Hide empty conversations">
                  <input
                    type="checkbox"
                    checked={hideEmpty}
                    onChange={(e) => handleHideEmptyChange(e.target.checked)}
                  />
                  <span>Hide empty</span>
                </label>
                <label className="archive-browser__checkbox" title="Hide trivial (≤5 words)">
                  <input
                    type="checkbox"
                    checked={hideTrivial}
                    onChange={(e) => setHideTrivial(e.target.checked)}
                  />
                  <span>Hide trivial</span>
                </label>
              </div>
            </div>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="archive-browser__pagination">
              <button
                disabled={offset === 0}
                onClick={() => loadConversations(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Prev
              </button>
              <span>{offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => loadConversations(offset + PAGE_SIZE)}
              >
                Next →
              </button>
            </div>
          )}

          {/* Empty state when no conversations */}
          {groupedConversations.size === 0 && !loading && (
            <div className="archive-browser__empty">
              <p className="archive-browser__empty-text">No conversations found</p>
              <p className="archive-browser__empty-hint">
                Switch to the <strong>Import</strong> tab to add archives
              </p>
            </div>
          )}

          {/* Grouped by month */}
          {Array.from(groupedConversations.entries()).map(([month, convs]) => (
            <div key={month} className="archive-browser__month">
              <div className="archive-browser__month-header">{month}</div>
              <div className="archive-browser__list">
                {convs.map(conv => {
                  const isSelected = conv.folder === selectedConversationFolder;
                  return (
                  <div
                    key={conv.folder}
                    className={`archive-item ${isSelected ? 'archive-item--selected' : ''}`}
                    data-conversation-folder={conv.folder}
                  >
                    <button
                      className={`archive-item__header ${expandedConv === conv.folder ? 'archive-item__header--expanded' : ''} ${isSelected ? 'archive-item__header--selected' : ''}`}
                      onClick={() => handleExpandConversation(conv)}
                    >
                      <span className="archive-item__icon">{expandedConv === conv.folder ? '▼' : '▶'}</span>
                      <span className="archive-item__title">{conv.title}</span>
                      <span className="archive-item__meta">
                        {conv.message_count} msgs · {estimateWords(conv.text_length).toLocaleString()} words
                        {conv.has_media && ' 📎'}
                        {isSelected && ' ●'}
                      </span>
                    </button>

                    {expandedConv === conv.folder && (
                      <div className="archive-item__messages">
                        {loadingMessages ? (
                          <div className="archive-item__loading">Loading...</div>
                        ) : (
                          <>
                            {/* Action buttons */}
                            <div className="archive-item__actions">
                              {expandedMessages.length > 1 && (
                                <button
                                  className="archive-message archive-message--full"
                                  onClick={() => handleImportFullConversation(conv)}
                                >
                                  Import all ({expandedMessages.length} msgs)
                                </button>
                              )}
                              <button
                                className="archive-browser__similar-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Navigate to explore tab with conversation content as query
                                  const searchText = expandedMessages.slice(0, 3).map(m => m.content.slice(0, 200)).join(' ');
                                  onTabChange?.('explore');
                                  // Dispatch custom event to set search query in ExploreView
                                  window.dispatchEvent(new CustomEvent('explore-search', { detail: { query: searchText.slice(0, 500) } }));
                                }}
                                title="Find similar conversations using semantic search"
                              >
                                Find Similar
                              </button>
                            </div>

                            {/* Individual messages */}
                            {expandedMessages.map(msg => (
                              <button
                                key={msg.id}
                                className={`archive-message archive-message--${msg.role}`}
                                onClick={() => handleSelectMessage(conv, msg, conv.message_count)}
                              >
                                <span className="archive-message__role">{msg.role}</span>
                                <span className="archive-message__preview">
                                  {msg.content.substring(0, 100)}
                                  {msg.content.length > 100 ? '...' : ''}
                                </span>
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Virtual scroll: Load more sentinel */}
          {visibleCount < filteredConversations.length && (
            <div
              ref={loadMoreRef}
              className="archive-browser__load-more"
            >
              Loading more... ({visibleCount} of {filteredConversations.length})
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Return the tabbed archive interface
  return (
    <ArchiveTabs
      renderConversations={renderConversationsBrowser}
      onSelectMedia={onSelectMedia}
      onSelectContent={onSelectContent}
      onOpenGraph={onOpenGraph}
      onSelectBookContent={onSelectBookContent}
      onSelectSearchResult={onSelectSearchResult}
      onSelectGutenbergText={handleSelectGutenbergText}
      controlledTab={navigateToTab}
      onTabChange={onTabChange}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOOL REGISTRY - Configurable tools with visibility settings
// ═══════════════════════════════════════════════════════════════════

interface ToolDefinition {
  id: string;
  icon: string;
  label: string;
  description: string;
  category: 'transform' | 'analyze' | 'edit' | 'book' | 'advanced' | 'settings';
  defaultVisible: boolean;
}

const TOOL_REGISTRY: ToolDefinition[] = [
  // Transform tools - the main humanizer features
  { id: 'humanizer', icon: '✦', label: 'Humanize', description: 'Computer humanizer - make AI text human', category: 'transform', defaultVisible: true },
  { id: 'persona', icon: '◐', label: 'Persona', description: 'Apply persona transformation', category: 'transform', defaultVisible: true },
  { id: 'style', icon: '❧', label: 'Style', description: 'Style transformation', category: 'transform', defaultVisible: true },

  // Analyze tools
  { id: 'sentencing', icon: '◈', label: 'Sentencing', description: 'Narrative sentencing - quantum density analysis', category: 'analyze', defaultVisible: true },
  { id: 'profile', icon: '◑', label: 'Profile', description: 'Profile factory - create personas', category: 'analyze', defaultVisible: true },

  // Edit tools
  { id: 'editor', icon: '¶', label: 'Editor', description: 'Markdown editor', category: 'edit', defaultVisible: true },
  { id: 'harvest', icon: '🌾', label: 'Harvest', description: 'Passage curation queue', category: 'edit', defaultVisible: true },

  // Book tools
  { id: 'arc', icon: '◠', label: 'Arc', description: 'Trace narrative arcs through your archive', category: 'book', defaultVisible: true },
  { id: 'threads', icon: '⚯', label: 'Threads', description: 'Discover thematic threads', category: 'book', defaultVisible: true },
  { id: 'chapters', icon: '❡', label: 'Chapters', description: 'Manage book chapters', category: 'book', defaultVisible: true },

  // Advanced tools (hidden by default)
  { id: 'pipelines', icon: '⚡', label: 'Pipelines', description: 'Preset workflows', category: 'advanced', defaultVisible: false },
  { id: 'split', icon: '✂', label: 'Split', description: 'Split content into parts', category: 'advanced', defaultVisible: false },
  { id: 'filter', icon: '◇', label: 'Filter', description: 'Filter by criteria', category: 'advanced', defaultVisible: false },
  { id: 'order', icon: '≡', label: 'Order', description: 'Arrange content', category: 'advanced', defaultVisible: false },
  { id: 'buffer', icon: '◎', label: 'Buffer', description: 'Buffer operations', category: 'advanced', defaultVisible: false },

  // Settings - always last
  { id: 'settings', icon: '⚙', label: 'Settings', description: 'Tool visibility settings', category: 'settings', defaultVisible: true },
];

// Load/save tool visibility from localStorage
const STORAGE_KEY = 'humanizer-tool-visibility';

function loadToolVisibility(): Record<string, boolean> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load tool visibility:', e);
  }
  // Return defaults
  return TOOL_REGISTRY.reduce((acc, tool) => {
    acc[tool.id] = tool.defaultVisible;
    return acc;
  }, {} as Record<string, boolean>);
}

function saveToolVisibility(visibility: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch (e) {
    console.error('Failed to save tool visibility:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// TOOLS PANEL - Photoshop-style tabbed interface
// ═══════════════════════════════════════════════════════════════════

interface ToolsPanelProps {
  onClose: () => void;
  onTransformComplete?: (original: string, transformed: string, transformType: string) => void;
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => void;
}

function ToolsPanel({ onClose: _onClose, onTransformComplete, onReviewInWorkspace }: ToolsPanelProps) {
  const {
    activeContent,
    applyOperator,
    applyPipeline,
    getOperators,
    getPipelines,
    forkBuffer,
    activeBuffer,
    activeNode,
    importText,
  } = useBuffers();

  const operators = getOperators();
  const pipelines = getPipelines();

  // Highlight and split mode hooks for analysis integration
  const { setData: setAnalysisData, setActive: setActiveHighlights, analysisData } = useHighlights();
  const { mode: splitMode, setMode: setSplitMode } = useSplitMode();

  // Bookshelf hook for harvest panel
  const bookshelf = useBookshelf();

  // Tool visibility state
  const [toolVisibility, setToolVisibility] = useState<Record<string, boolean>>(loadToolVisibility);
  const [activeTab, setActiveTab] = useState<string>('humanizer');
  const [filterParams, setFilterParams] = useState({ threshold: 70, comparison: '>' as '>' | '<' | '=' });
  const [_selectParams, _setSelectParams] = useState({ count: 10 });

  // Transform state
  const [isTransforming, setIsTransforming] = useState(false);
  const [transformResult, setTransformResult] = useState<TransformResult | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Humanizer settings
  const [humanizeIntensity, setHumanizeIntensity] = useState<HumanizationIntensity>('moderate');
  const [enableSicAnalysis, setEnableSicAnalysis] = useState(false);

  // Persona settings
  const [selectedPersona, setSelectedPersona] = useState('');
  const [customPersona, setCustomPersona] = useState('');
  const [availablePersonas, setAvailablePersonas] = useState<PersonaDefinition[]>([
    { name: 'Academic', description: 'Scholarly, precise, citation-aware', icon: '📚' },
    { name: 'Conversational', description: 'Friendly, accessible, warm', icon: '💬' },
    { name: 'Technical', description: 'Detailed, systematic, thorough', icon: '⚙️' },
  ]);

  // Style settings
  const [selectedStyle, setSelectedStyle] = useState('');
  const [availableStyles, setAvailableStyles] = useState<StyleDefinition[]>([
    { name: 'Formal', description: 'Professional, polished', icon: '📝' },
    { name: 'Casual', description: 'Relaxed, natural', icon: '✏️' },
    { name: 'Concise', description: 'Tighten, remove fluff', icon: '✂️' },
    { name: 'Elaborate', description: 'Expand, add detail', icon: '📖' },
  ]);

  // Profile visibility (for showing all vs common profiles)
  const [showAllPersonas, setShowAllPersonas] = useState(true);
  const [showAllStyles, setShowAllStyles] = useState(true);

  // Sentencing analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [sentenceResults, setSentenceResults] = useState<SentenceAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Load available personas and styles on mount
  useEffect(() => {
    getPersonas().then(setAvailablePersonas).catch(() => {});
    getStyles().then(setAvailableStyles).catch(() => {});
  }, []);

  // Reset transform/analysis state when content changes
  useEffect(() => {
    setTransformResult(null);
    setTransformError(null);
    setSentenceResults(null);
    setAnalysisError(null);
    setAnalysisProgress(null);
  }, [activeContent]);

  // Cancel transform on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Get visible tools (settings is always visible)
  const visibleTools = TOOL_REGISTRY.filter(tool =>
    tool.id === 'settings' || toolVisibility[tool.id]
  );

  // Toggle tool visibility
  const toggleToolVisibility = (toolId: string) => {
    const newVisibility = { ...toolVisibility, [toolId]: !toolVisibility[toolId] };
    setToolVisibility(newVisibility);
    saveToolVisibility(newVisibility);
  };

  // Group operators by type
  const operatorsByType = operators.reduce((acc, op) => {
    if (!acc[op.type]) acc[op.type] = [];
    acc[op.type].push(op);
    return acc;
  }, {} as Record<string, OperatorDefinition[]>);

  const handleApplyOperator = async (operatorId: string, params?: Record<string, unknown>) => {
    await applyOperator(operatorId, params);
  };

  const handleApplyPipeline = async (pipelineId: string) => {
    await applyPipeline(pipelineId);
  };

  // Content stats
  const items = activeContent
    ? (Array.isArray(activeContent) ? activeContent : [activeContent])
    : [];
  const totalChars = items.reduce((sum, item) => sum + item.text.length, 0);
  const contentText = items.map(i => i.text).join('\n\n');

  // Transform handlers
  const cancelTransform = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsTransforming(false);
    }
  }, []);

  const handleHumanize = useCallback(async () => {
    if (!contentText.trim()) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await humanize(
        contentText,
        {
          intensity: humanizeIntensity,
          enableSicAnalysis,
          enableLLMPolish: true,
        },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      // Import the transformed text to buffer
      importText(result.transformed, `Humanized (${humanizeIntensity})`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Humanized (${humanizeIntensity})`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled, don't show error
      } else {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, humanizeIntensity, enableSicAnalysis, importText, onTransformComplete]);

  const handlePersonaTransform = useCallback(async () => {
    const persona = customPersona.trim() || selectedPersona;
    if (!contentText.trim() || !persona) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await transformPersona(
        contentText,
        persona,
        { preserveLength: true, enableValidation: true },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      importText(result.transformed, `Persona: ${persona}`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Persona: ${persona}`);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, selectedPersona, customPersona, importText, onTransformComplete]);

  const handleStyleTransform = useCallback(async () => {
    if (!contentText.trim() || !selectedStyle) return;

    setIsTransforming(true);
    setTransformError(null);
    setTransformResult(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await transformStyle(
        contentText,
        selectedStyle,
        { preserveLength: true, enableValidation: true },
        abortControllerRef.current.signal
      );

      setTransformResult(result);
      importText(result.transformed, `Style: ${selectedStyle}`);
      // Trigger split-screen mode to show before/after
      onTransformComplete?.(contentText, result.transformed, `Style: ${selectedStyle}`);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setTransformError(error instanceof Error ? error.message : 'Transformation failed');
      }
    } finally {
      setIsTransforming(false);
      abortControllerRef.current = null;
    }
  }, [contentText, selectedStyle, importText, onTransformComplete]);

  const handleSentenceAnalysis = useCallback(async () => {
    if (!contentText.trim()) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSentenceResults(null);
    setAnalysisProgress(null);

    abortControllerRef.current = new AbortController();

    try {
      const result = await analyzeSentences(
        contentText,
        (current, total) => {
          setAnalysisProgress({ current, total });
        },
        abortControllerRef.current.signal
      );

      setSentenceResults(result);

      // Convert to SentenceAnalysis format for highlighting
      // Map entropy to AI likelihood (higher entropy = more uncertain = higher likelihood)
      let currentOffset = 0;
      const sentences: SentenceAnalysis[] = result.sentences.map((s) => {
        const startOffset = contentText.indexOf(s.text, currentOffset);
        currentOffset = startOffset >= 0 ? startOffset + s.text.length : currentOffset;

        // Convert entropy (0-2) to aiLikelihood (0-100)
        // Max entropy for 4 outcomes is log2(4) = 2
        const aiLikelihood = Math.min(100, (s.entropy / 2) * 100);

        // Flag as suspect if high entropy or 'neither' dominant
        const isSuspect = s.entropy > 1.5 || s.dominant === 'neither';

        // Generate flags based on analysis
        const flags: string[] = [];
        if (s.dominant === 'neither') flags.push('ambiguous');
        if (s.dominant === 'both') flags.push('paradoxical');
        if (s.entropy > 1.5) flags.push('high-entropy');
        if (s.purity < 0.3) flags.push('low-purity');

        return {
          text: s.text,
          startOffset: startOffset >= 0 ? startOffset : 0,
          endOffset: startOffset >= 0 ? startOffset + s.text.length : s.text.length,
          wordCount: s.text.split(/\s+/).length,
          aiLikelihood,
          flags,
          isSuspect,
        };
      });

      // Store in layout context for workspace highlighting
      setAnalysisData({ sentences });

      // Enable AI detection highlight layer and switch to analyze mode
      setActiveHighlights(['ai-detection']);
      setSplitMode('analyze');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
      }
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
      abortControllerRef.current = null;
    }
  }, [contentText, setAnalysisData, setActiveHighlights, setSplitMode]);

  const cancelAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, []);

  // Auto-trigger analysis when toolbar mode changes to 'analyze'
  useEffect(() => {
    // Only trigger when mode is 'analyze', there's content, we're not already analyzing,
    // and we don't already have analysis data
    if (
      splitMode === 'analyze' &&
      contentText.trim() &&
      !isAnalyzing &&
      !analysisData?.sentences?.length
    ) {
      handleSentenceAnalysis();
    }
  }, [splitMode, contentText, isAnalyzing, analysisData?.sentences?.length, handleSentenceAnalysis]);

  // Ensure active tab is visible
  useEffect(() => {
    if (!visibleTools.find(t => t.id === activeTab)) {
      const firstVisible = visibleTools.find(t => t.id !== 'settings');
      if (firstVisible) setActiveTab(firstVisible.id);
    }
  }, [toolVisibility, activeTab, visibleTools]);

  return (
    <div className="tool-tabs">
      {/* Tab bar - horizontal scroll */}
      <nav className="tool-tabs__nav">
        {visibleTools.map(tool => (
          <button
            key={tool.id}
            className={`tool-tabs__tab ${activeTab === tool.id ? 'tool-tabs__tab--active' : ''}`}
            onClick={() => setActiveTab(tool.id)}
            title={tool.description}
          >
            <span className="tool-tabs__tab-icon">{tool.icon}</span>
            <span className="tool-tabs__tab-label">{tool.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="tool-tabs__content">
        {/* ═══════════════════════════════════════════════════════════════
            HUMANIZER - Core transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'humanizer' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Humanize</h3>
              <span className="tool-panel__subtitle">Transform AI text to human voice</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to humanize</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Intensity selector */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Intensity</label>
                  <select
                    className="tool-control__select"
                    value={humanizeIntensity}
                    onChange={(e) => setHumanizeIntensity(e.target.value as HumanizationIntensity)}
                    disabled={isTransforming}
                  >
                    <option value="light">Light (50%) - Minimal changes</option>
                    <option value="moderate">Moderate (70%) - Balanced</option>
                    <option value="aggressive">Aggressive (95%) - Maximum</option>
                  </select>
                </div>

                {/* SIC Analysis toggle */}
                <div className="tool-panel__section">
                  <label className="tool-check">
                    <input
                      type="checkbox"
                      checked={enableSicAnalysis}
                      onChange={(e) => setEnableSicAnalysis(e.target.checked)}
                      disabled={isTransforming}
                    />
                    Enable SIC Analysis (Paid feature)
                  </label>
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleHumanize}
                      disabled={!contentText.trim()}
                    >
                      <span className="tool-card__name">
                        {isTransforming ? '⏳ Processing...' : '✦ Humanize Text'}
                      </span>
                      <span className="tool-card__desc">Apply SIC-optimized transformation</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && (
                  <div className="tool-panel__error">
                    {transformError}
                  </div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                    {transformResult.metadata?.modelUsed && (
                      <span className="tool-panel__result-meta">
                        via {transformResult.metadata.modelUsed.split('/').pop()}
                      </span>
                    )}
                    {transformResult.metadata?.processingTimeMs && (
                      <span className="tool-panel__result-meta">
                        {(transformResult.metadata.processingTimeMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PERSONA - Apply persona transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'persona' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Persona</h3>
              <span className="tool-panel__subtitle">Transform voice and perspective</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to transform</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Persona selector - Horizontal scroll cards */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Select Persona</label>
                  <ProfileCardsContainer
                    profiles={availablePersonas}
                    selectedName={selectedPersona}
                    onSelect={(p) => {
                      setSelectedPersona(p.name);
                      setCustomPersona('');
                    }}
                    disabled={isTransforming}
                    showAllProfiles={showAllPersonas}
                    onToggleShowAll={() => setShowAllPersonas(!showAllPersonas)}
                    type="persona"
                  />
                </div>

                {/* Custom persona input */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Or Custom Persona</label>
                  <input
                    type="text"
                    className="tool-control__input tool-control__input--full"
                    placeholder="e.g., Victorian scholar, enthusiastic chef..."
                    value={customPersona}
                    onChange={(e) => {
                      setCustomPersona(e.target.value);
                      if (e.target.value) setSelectedPersona('');
                    }}
                    disabled={isTransforming}
                  />
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handlePersonaTransform}
                      disabled={!contentText.trim() || (!selectedPersona && !customPersona.trim())}
                    >
                      <span className="tool-card__name">
                        {availablePersonas.find(p => p.name === selectedPersona)?.icon || '◐'} Apply {customPersona.trim() || selectedPersona || 'Persona'}
                      </span>
                      <span className="tool-card__desc">Transform to selected voice</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && activeTab === 'persona' && (
                  <div className="tool-panel__error">{transformError}</div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            STYLE - Style transformation
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'style' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Style</h3>
              <span className="tool-panel__subtitle">Adjust tone and register</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content from the Archive to transform</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Style selector - Horizontal scroll cards */}
                <div className="tool-panel__section">
                  <label className="tool-panel__label">Select Style</label>
                  <ProfileCardsContainer
                    profiles={availableStyles}
                    selectedName={selectedStyle}
                    onSelect={(s) => setSelectedStyle(s.name)}
                    disabled={isTransforming}
                    showAllProfiles={showAllStyles}
                    onToggleShowAll={() => setShowAllStyles(!showAllStyles)}
                    type="style"
                  />
                </div>

                {/* Transform button */}
                <div className="tool-panel__actions">
                  {isTransforming ? (
                    <button
                      className="tool-card tool-card--cancel"
                      onClick={cancelTransform}
                    >
                      <span className="tool-card__name">Cancel</span>
                    </button>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleStyleTransform}
                      disabled={!contentText.trim() || !selectedStyle}
                    >
                      <span className="tool-card__name">
                        {availableStyles.find(s => s.name === selectedStyle)?.icon || '❧'} Apply {selectedStyle || 'Style'}
                      </span>
                      <span className="tool-card__desc">Transform writing style</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {transformError && activeTab === 'style' && (
                  <div className="tool-panel__error">{transformError}</div>
                )}

                {/* Result summary */}
                {transformResult && !transformError && (
                  <div className="tool-panel__result">
                    <span className="tool-panel__result-success">✓ Transformed</span>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SENTENCING - Narrative Sentencing / Quantum Reading
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'sentencing' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Narrative Sentencing</h3>
              <span className="tool-panel__subtitle">Tetralemma density analysis per sentence</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content to analyze</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                {/* Action buttons */}
                <div className="tool-panel__actions">
                  {isAnalyzing ? (
                    <>
                      <div className="tool-panel__progress">
                        <div className="tool-panel__progress-bar">
                          <div
                            className="tool-panel__progress-fill"
                            style={{
                              width: analysisProgress
                                ? `${(analysisProgress.current / analysisProgress.total) * 100}%`
                                : '0%'
                            }}
                          />
                        </div>
                        <span className="tool-panel__progress-text">
                          {analysisProgress
                            ? `Analyzing sentence ${analysisProgress.current}/${analysisProgress.total}`
                            : 'Starting...'}
                        </span>
                      </div>
                      <button
                        className="tool-card tool-card--cancel"
                        onClick={cancelAnalysis}
                      >
                        <span className="tool-card__name">Cancel</span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="tool-card tool-card--primary"
                      onClick={handleSentenceAnalysis}
                      disabled={!contentText.trim()}
                    >
                      <span className="tool-card__name">◈ Analyze Sentences</span>
                      <span className="tool-card__desc">Tetralemma measurement + entropy tracking</span>
                    </button>
                  )}
                </div>

                {/* Error display */}
                {analysisError && (
                  <div className="tool-panel__error">{analysisError}</div>
                )}

                {/* Results summary */}
                {sentenceResults && !analysisError && (
                  <div className="sentencing-results">
                    {/* Overall stats */}
                    <div className="sentencing-results__summary">
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value">{sentenceResults.overall.totalSentences}</span>
                        <span className="sentencing-stat__label">Sentences</span>
                      </div>
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value">{sentenceResults.overall.avgEntropy.toFixed(2)}</span>
                        <span className="sentencing-stat__label">Avg Entropy</span>
                      </div>
                      <div className="sentencing-stat">
                        <span className="sentencing-stat__value sentencing-stat__value--stance">
                          {sentenceResults.overall.dominantStance}
                        </span>
                        <span className="sentencing-stat__label">Dominant</span>
                      </div>
                    </div>

                    {/* Per-sentence results */}
                    <div className="sentencing-results__sentences">
                      {sentenceResults.sentences.map((s) => (
                        <div key={s.index} className="sentencing-sentence">
                          <div className="sentencing-sentence__header">
                            <span className="sentencing-sentence__index">#{s.index + 1}</span>
                            <span className={`sentencing-sentence__stance sentencing-sentence__stance--${s.dominant}`}>
                              {s.dominant}
                            </span>
                          </div>
                          <div className="sentencing-sentence__text">{s.text}</div>
                          <div className="sentencing-sentence__probs">
                            <div className="sentencing-prob" style={{ width: `${s.tetralemma.literal * 100}%` }}>
                              <span title={`Literal: ${(s.tetralemma.literal * 100).toFixed(1)}%`}>L</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--meta" style={{ width: `${s.tetralemma.metaphorical * 100}%` }}>
                              <span title={`Metaphorical: ${(s.tetralemma.metaphorical * 100).toFixed(1)}%`}>M</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--both" style={{ width: `${s.tetralemma.both * 100}%` }}>
                              <span title={`Both: ${(s.tetralemma.both * 100).toFixed(1)}%`}>B</span>
                            </div>
                            <div className="sentencing-prob sentencing-prob--neither" style={{ width: `${s.tetralemma.neither * 100}%` }}>
                              <span title={`Neither: ${(s.tetralemma.neither * 100).toFixed(1)}%`}>N</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content info */}
                <div className="tool-panel__info">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  <span>{totalChars.toLocaleString()} chars</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PROFILE - Profile Factory
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'profile' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Profile Factory</h3>
              <span className="tool-panel__subtitle">Create and manage personas</span>
            </div>
            <div className="tool-panel__body">
              <button className="tool-card tool-card--primary">
                <span className="tool-card__name">New Profile</span>
                <span className="tool-card__desc">Create from selected text</span>
              </button>
              <div className="tool-panel__divider" />
              <div className="tool-panel__section">
                <label className="tool-panel__label">Saved Profiles</label>
                <p className="tool-panel__muted">No profiles yet</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            EDITOR - Markdown Editor
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'editor' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Editor</h3>
              <span className="tool-panel__subtitle">Direct markdown editing</span>
            </div>
            {!activeContent ? (
              <div className="tool-panel__empty">
                <p>Select content to edit</p>
              </div>
            ) : (
              <div className="tool-panel__body">
                <textarea
                  className="tool-editor"
                  defaultValue={items.map(i => i.text).join('\n\n---\n\n')}
                  placeholder="Edit content here..."
                />
                <button className="tool-card tool-card--primary">
                  <span className="tool-card__name">Save Changes</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            BOOK - Book Environment (stub)
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'book' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Book</h3>
              <span className="tool-panel__subtitle">Book composition environment</span>
            </div>
            <div className="tool-panel__empty">
              <p>Book environment coming soon</p>
              <span className="tool-panel__muted">Chapter organization, export, formatting</span>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            HARVEST - Passage curation queue
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'harvest' && (
          <HarvestQueuePanel
            bookUri={bookshelf.activeBookUri}
            onSelectPassage={(passage) => {
              // Load passage into buffer for viewing
              importText(passage.text || '', passage.sourceRef?.conversationTitle || 'Passage', {
                type: 'passage',
              });
            }}
            onOpenSource={(conversationId) => {
              // Dispatch event to open conversation in Archive
              window.dispatchEvent(
                new CustomEvent('open-conversation', {
                  detail: { conversationId, folder: conversationId },
                })
              );
            }}
            onReviewInWorkspace={onReviewInWorkspace}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            ARC - Trace narrative arcs
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'arc' && (
          <ArcToolPanel
            activeContent={getContentText(activeContent)}
            bookUri={bookshelf.activeBookUri}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            THREADS - Discover thematic threads
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'threads' && (
          <ThreadsToolPanel
            bookUri={bookshelf.activeBookUri}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            CHAPTERS - Book chapter management
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'chapters' && (
          <ChaptersToolPanel
            bookUri={bookshelf.activeBookUri}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PERSONA - Voice creation and management
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'persona' && (
          <PersonaToolPanel
            bookUri={bookshelf.activeBookUri}
            activeContent={getContentText(activeContent)}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════════
            PIPELINES - Advanced workflows
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'pipelines' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Pipelines</h3>
              <span className="tool-panel__subtitle">Preset workflows</span>
            </div>
            <div className="tool-panel__body">
              {pipelines.map(p => (
                <button
                  key={p.id}
                  className="tool-card"
                  onClick={() => handleApplyPipeline(p.id)}
                >
                  <span className="tool-card__name">{p.name}</span>
                  <span className="tool-card__desc">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SPLIT - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'split' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Split</h3>
              <span className="tool-panel__subtitle">Break content apart</span>
            </div>
            <div className="tool-panel__body">
              {operatorsByType['split']?.map(op => (
                <button
                  key={op.id}
                  className="tool-card"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                  <span className="tool-card__desc">{op.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            FILTER - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'filter' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Filter</h3>
              <span className="tool-panel__subtitle">Select by criteria</span>
            </div>
            <div className="tool-panel__section">
              <label className="tool-panel__label">SIC Score Filter</label>
              <div className="tool-control">
                <select
                  className="tool-control__select"
                  value={filterParams.comparison}
                  onChange={(e) => setFilterParams(p => ({ ...p, comparison: e.target.value as '>' | '<' | '=' }))}
                >
                  <option value=">">&gt; greater than</option>
                  <option value="<">&lt; less than</option>
                  <option value="=">=  equal to</option>
                </select>
                <input
                  type="number"
                  className="tool-control__input"
                  value={filterParams.threshold}
                  onChange={(e) => setFilterParams(p => ({ ...p, threshold: Number(e.target.value) }))}
                  min={0}
                  max={100}
                />
                <button
                  className="tool-control__apply"
                  onClick={() => handleApplyOperator('filter:sic', filterParams)}
                >
                  Apply
                </button>
              </div>
            </div>
            <div className="tool-panel__divider" />
            <div className="tool-panel__body">
              {operatorsByType['filter']?.filter(op => op.id !== 'filter:sic').map(op => (
                <button
                  key={op.id}
                  className="tool-card tool-card--compact"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            ORDER - Advanced operator
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'order' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Order</h3>
              <span className="tool-panel__subtitle">Arrange content</span>
            </div>
            <div className="tool-panel__body">
              {operatorsByType['order']?.map(op => (
                <button
                  key={op.id}
                  className="tool-card"
                  onClick={() => handleApplyOperator(op.id)}
                >
                  <span className="tool-card__name">{op.name}</span>
                  <span className="tool-card__desc">{op.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            BUFFER - Document operations
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'buffer' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Buffer</h3>
              <span className="tool-panel__subtitle">Current document</span>
            </div>
            <div className="tool-panel__stats">
              <div className="tool-stat">
                <span className="tool-stat__value">{items.length}</span>
                <span className="tool-stat__label">items</span>
              </div>
              <div className="tool-stat">
                <span className="tool-stat__value">{totalChars.toLocaleString()}</span>
                <span className="tool-stat__label">chars</span>
              </div>
              {activeNode?.metadata.avgSicScore !== undefined && (
                <div className="tool-stat">
                  <span className="tool-stat__value">{activeNode.metadata.avgSicScore.toFixed(0)}</span>
                  <span className="tool-stat__label">avg SIC</span>
                </div>
              )}
            </div>
            <div className="tool-panel__divider" />
            <div className="tool-panel__body">
              <button
                className="tool-card"
                onClick={() => activeBuffer && forkBuffer(activeBuffer.id)}
              >
                <span className="tool-card__name">Fork Buffer</span>
                <span className="tool-card__desc">Create a copy to experiment with</span>
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            SETTINGS - Tool visibility
            ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="tool-panel">
            <div className="tool-panel__header">
              <h3>Settings</h3>
              <span className="tool-panel__subtitle">Show or hide tools</span>
            </div>
            <div className="tool-panel__body">
              {(['transform', 'analyze', 'edit', 'book', 'advanced'] as const).map(category => (
                <div key={category} className="tool-panel__section">
                  <label className="tool-panel__label">{category}</label>
                  {TOOL_REGISTRY.filter(t => t.category === category).map(tool => (
                    <label key={tool.id} className="tool-toggle">
                      <input
                        type="checkbox"
                        checked={toolVisibility[tool.id] ?? tool.defaultVisible}
                        onChange={() => toggleToolVisibility(tool.id)}
                      />
                      <span className="tool-toggle__icon">{tool.icon}</span>
                      <span className="tool-toggle__label">{tool.label}</span>
                      <span className="tool-toggle__desc">{tool.description}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOOK TOOL PANELS
// ═══════════════════════════════════════════════════════════════════

// Helper to extract text from ContentItem | ContentItem[] | null
function getContentText(content: { text: string } | { text: string }[] | null): string | null {
  if (!content) return null;
  if (Array.isArray(content)) {
    return content.map(c => c.text).join('\n\n');
  }
  return content.text;
}

interface ArcToolPanelProps {
  activeContent: string | null;
  bookUri: string | null;
}

function ArcToolPanel({ activeContent, bookUri }: ArcToolPanelProps) {
  const [theme, setTheme] = useState('');
  const [arcType, setArcType] = useState<'progressive' | 'chronological' | 'thematic' | 'dialectic'>('progressive');
  const [isTracing, setIsTracing] = useState(false);
  const [saveToHarvest, setSaveToHarvest] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    phases?: Array<{ phase: string; count: number; samples?: Array<{ preview: string; source?: string }> }>;
    teaching?: { whatHappened: string; why?: string };
  } | null>(null);

  // Get contexts for tool execution
  const bookshelf = useBookshelf();

  const handleTrace = async () => {
    if (!theme.trim()) return;

    setIsTracing(true);
    setResult(null);

    try {
      // Build AUI context from bookshelf (BookContext deprecated)
      const context = buildAUIContext(null, bookshelf);

      // Execute the trace_arc tool
      const toolResult = await executeTool(
        {
          name: 'trace_arc',
          params: {
            theme,
            arc_type: arcType,
            save_to_harvest: saveToHarvest,
            limit: 20,
          },
          raw: '',
        },
        context
      );

      if (toolResult.success && toolResult.data) {
        const data = toolResult.data as { phases?: { phase: string; count: number; samples?: { preview: string; source?: string }[] }[] };
        setResult({
          message: toolResult.message || `Traced "${theme}" arc`,
          phases: data.phases,
          teaching: toolResult.teaching,
        });
      } else {
        setResult({
          message: toolResult.error || 'Failed to trace arc',
        });
      }
    } catch (e) {
      setResult({ message: `Error: ${e instanceof Error ? e.message : 'Failed to trace arc'}` });
    } finally {
      setIsTracing(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Trace Arc</h3>
        <span className="tool-panel__subtitle">Find how a theme evolved through your archive</span>
      </div>
      <div className="tool-panel__body">
        <div className="tool-panel__field">
          <label className="tool-panel__label">Theme to trace</label>
          <input
            type="text"
            className="tool-panel__input"
            placeholder="e.g., consciousness, meditation, writing..."
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </div>

        <div className="tool-panel__field">
          <label className="tool-panel__label">Arc type</label>
          <div className="tool-panel__radio-group">
            {[
              { value: 'progressive', label: 'Progressive', desc: 'Beginning → Middle → End' },
              { value: 'chronological', label: 'Chronological', desc: 'Ordered by date' },
              { value: 'dialectic', label: 'Dialectic', desc: 'Thesis → Antithesis → Synthesis' },
              { value: 'thematic', label: 'Thematic', desc: 'Variations on theme' },
            ].map(opt => (
              <label key={opt.value} className="tool-panel__radio">
                <input
                  type="radio"
                  name="arcType"
                  value={opt.value}
                  checked={arcType === opt.value}
                  onChange={() => setArcType(opt.value as typeof arcType)}
                />
                <span className="tool-panel__radio-label">{opt.label}</span>
                <span className="tool-panel__radio-desc">{opt.desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Save to Harvest checkbox */}
        <div className="tool-panel__field tool-panel__field--inline">
          <label className="tool-panel__checkbox">
            <input
              type="checkbox"
              checked={saveToHarvest}
              onChange={(e) => setSaveToHarvest(e.target.checked)}
            />
            <span>Save results to Harvest bucket</span>
          </label>
        </div>

        <button
          className="tool-panel__button tool-panel__button--primary"
          onClick={handleTrace}
          disabled={isTracing || !theme.trim()}
        >
          {isTracing ? 'Tracing...' : 'Trace Arc'}
        </button>

        {result && (
          <div className="tool-panel__result">
            <p className="tool-panel__result-message">{result.message}</p>

            {result.phases && (
              <div className="tool-panel__phases">
                {result.phases.map((p, i) => (
                  <div key={i} className="tool-panel__phase">
                    <div className="tool-panel__phase-header">
                      <span className="tool-panel__phase-name">{p.phase}</span>
                      <span className="tool-panel__phase-count">{p.count} passages</span>
                    </div>
                    {p.samples && p.samples.length > 0 && (
                      <div className="tool-panel__phase-samples">
                        {p.samples.map((s, j) => (
                          <div key={j} className="tool-panel__phase-sample">
                            <span className="tool-panel__sample-preview">{s.preview}</span>
                            {s.source && <span className="tool-panel__sample-source">— {s.source}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.teaching && (
              <div className="tool-panel__teaching">
                <p className="tool-panel__teaching-what">{result.teaching.whatHappened}</p>
                {result.teaching.why && (
                  <p className="tool-panel__teaching-why">{result.teaching.why}</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeContent && (
          <div className="tool-panel__hint">
            <p>Tip: Use the current content as a starting point</p>
            <button
              className="tool-panel__button tool-panel__button--secondary"
              onClick={() => {
                const words = activeContent.split(/\s+/).slice(0, 5).join(' ');
                setTheme(words);
              }}
            >
              Use current text
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ThreadsToolPanelProps {
  bookUri: string | null;
}

function ThreadsToolPanel({ bookUri }: ThreadsToolPanelProps) {
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [threads, setThreads] = useState<Array<{ theme: string; count: number; coherence: number }>>([]);
  const bookshelf = useBookshelf();

  const handleDiscover = async () => {
    if (!bookUri) return;

    setIsDiscovering(true);

    try {
      // Get passages from active book
      const passages = bookshelf.getPassages(bookUri);

      if (passages.length < 3) {
        setThreads([]);
        return;
      }

      // Simple keyword clustering
      const keywordCounts = new Map<string, number>();
      const commonWords = new Set(['about', 'which', 'their', 'there', 'would', 'could', 'should', 'being', 'having', 'through', 'because', 'while', 'something', 'anything']);

      for (const p of passages) {
        const text = p.text || '';
        const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5 && !commonWords.has(w));
        const seen = new Set<string>();
        for (const w of words) {
          if (!seen.has(w)) {
            keywordCounts.set(w, (keywordCounts.get(w) || 0) + 1);
            seen.add(w);
          }
        }
      }

      // Find themes (keywords in multiple passages)
      const themes = Array.from(keywordCounts.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([word, count]) => ({
          theme: word,
          count,
          coherence: Math.min(1, count / passages.length),
        }));

      setThreads(themes);
    } catch (e) {
      console.error('Thread discovery failed:', e);
    } finally {
      setIsDiscovering(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Discover Threads</h3>
        <span className="tool-panel__subtitle">Find thematic patterns in your passages</span>
      </div>
      <div className="tool-panel__body">
        {!bookUri ? (
          <div className="tool-panel__empty">
            <p>No book project active</p>
            <span className="tool-panel__muted">Open a book project in Archive → Books</span>
          </div>
        ) : (
          <>
            <button
              className="tool-panel__button tool-panel__button--primary"
              onClick={handleDiscover}
              disabled={isDiscovering}
            >
              {isDiscovering ? 'Discovering...' : 'Discover Threads'}
            </button>

            {threads.length > 0 && (
              <div className="tool-panel__threads">
                {threads.map((t, i) => (
                  <div key={i} className="tool-panel__thread">
                    <span className="tool-panel__thread-theme">{t.theme}</span>
                    <span className="tool-panel__thread-count">{t.count} passages</span>
                    <div
                      className="tool-panel__thread-bar"
                      style={{ width: `${t.coherence * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            )}

            {threads.length === 0 && !isDiscovering && (
              <div className="tool-panel__empty">
                <p>No threads discovered yet</p>
                <span className="tool-panel__muted">Add passages to your book, then discover patterns</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface ChaptersToolPanelProps {
  bookUri: string | null;
}

function ChaptersToolPanel({ bookUri }: ChaptersToolPanelProps) {
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ message: string; success: boolean } | null>(null);
  const bookshelf = useBookshelf();
  const book = bookUri ? bookshelf.getBook(bookUri) : null;

  // Active persona for draft generation
  const { activePersona, activePersonaUri } = bookshelf;

  // Count approved passages
  const approvedCount = (book?.passages || []).filter(
    p => p.curation?.status === 'approved' || p.curation?.status === 'gem'
  ).length;

  const handleAddChapter = () => {
    if (!bookUri || !newChapterTitle.trim()) return;

    const existingChapters = book?.chapters || [];
    const chapter: DraftChapter = {
      id: `chapter-${Date.now()}`,
      number: existingChapters.length + 1,
      title: newChapterTitle,
      content: '',
      status: 'drafting',
      version: 1,
      versions: [],
      wordCount: 0,
      sections: [],
      marginalia: [],
      metadata: {
        lastEditedBy: 'user',
        lastEditedAt: Date.now(),
      },
      passageRefs: [],
    };

    bookshelf.addChapter(bookUri, chapter);
    setNewChapterTitle('');
  };

  const handleGenerateDraft = async () => {
    if (!bookUri || approvedCount === 0) return;

    setIsGenerating(true);
    setGenerateResult(null);

    try {
      // Build context (BookContext deprecated - passing null)
      const context = buildAUIContext(null, bookshelf);

      // Execute generate_first_draft tool
      // Pass persona's systemPrompt or description as style
      const personaStyle = activePersona
        ? (activePersona.systemPrompt || activePersona.description || `Write in the voice of ${activePersona.name}`)
        : undefined;

      const result = await executeTool(
        {
          name: 'generate_first_draft',
          params: {
            chapterTitle: newChapterTitle || 'Untitled Chapter',
            use_approved: true,
            style: personaStyle,
          },
          raw: '',
        },
        context
      );

      setGenerateResult({
        message: result.message || (result.success ? 'Draft generated!' : 'Generation failed'),
        success: result.success,
      });

      // Clear title input on success
      if (result.success) {
        setNewChapterTitle('');
      }
    } catch (e) {
      setGenerateResult({
        message: e instanceof Error ? e.message : 'Failed to generate draft',
        success: false,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Chapters</h3>
        <span className="tool-panel__subtitle">Manage book chapters</span>
      </div>
      <div className="tool-panel__body">
        {!bookUri ? (
          <div className="tool-panel__empty">
            <p>No book project active</p>
            <span className="tool-panel__muted">Open a book project in Archive → Books</span>
          </div>
        ) : (
          <>
            <div className="tool-panel__field">
              <label className="tool-panel__label">Add chapter</label>
              <div className="tool-panel__input-group">
                <input
                  type="text"
                  className="tool-panel__input"
                  placeholder="Chapter title..."
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddChapter()}
                />
                <button
                  className="tool-panel__button"
                  onClick={handleAddChapter}
                  disabled={!newChapterTitle.trim()}
                >
                  Add
                </button>
              </div>
            </div>

            {book?.chapters && book.chapters.length > 0 ? (
              <div className="tool-panel__chapters">
                {book.chapters.map((ch, i) => (
                  <div key={ch.id} className="tool-panel__chapter">
                    <span className="tool-panel__chapter-num">{i + 1}</span>
                    <span className="tool-panel__chapter-title">{ch.title}</span>
                    <span className="tool-panel__chapter-words">{ch.wordCount || 0} words</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tool-panel__empty">
                <p>No chapters yet</p>
                <span className="tool-panel__muted">Add your first chapter above</span>
              </div>
            )}

            <div className="tool-panel__stats">
              <div className="tool-panel__stat">
                <span className="tool-panel__stat-value">{book?.chapters?.length || 0}</span>
                <span className="tool-panel__stat-label">chapters</span>
              </div>
              <div className="tool-panel__stat">
                <span className="tool-panel__stat-value">{approvedCount}</span>
                <span className="tool-panel__stat-label">approved</span>
              </div>
            </div>

            {/* Generate Draft Section */}
            <div className="tool-panel__section">
              <h4 className="tool-panel__section-title">Generate First Draft</h4>
              <p className="tool-panel__muted">
                Use approved passages to generate a chapter draft with AI
              </p>
              {activePersona && (
                <p className="tool-panel__persona-active">
                  Voice: <strong>{activePersona.name}</strong>
                </p>
              )}
              {!activePersona && (
                <p className="tool-panel__hint-text">
                  Select a persona in the Persona panel for voice styling
                </p>
              )}
              <button
                className="tool-panel__button tool-panel__button--primary"
                onClick={handleGenerateDraft}
                disabled={isGenerating || approvedCount === 0}
              >
                {isGenerating ? 'Generating...' : `Generate Draft (${approvedCount} passages)`}
              </button>
              {approvedCount === 0 && (
                <p className="tool-panel__hint-text">
                  Approve some passages first in the Harvest panel
                </p>
              )}
              {generateResult && (
                <div className={`tool-panel__result ${generateResult.success ? '' : 'tool-panel__result--error'}`}>
                  <p>{generateResult.message}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PersonaToolPanelProps {
  bookUri: string | null;
  activeContent: string | null;
}

function PersonaToolPanel({ bookUri, activeContent }: PersonaToolPanelProps) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [result, setResult] = useState<{ message: string; success: boolean; persona?: unknown } | null>(null);
  const bookshelf = useBookshelf();

  // Get personas from bookshelf
  const personas = bookshelf.personas || [];

  // Active persona from bookshelf context (shared state)
  const { activePersonaUri, setActivePersonaUri } = bookshelf;

  const handleExtractFromContent = async () => {
    if (!activeContent || activeContent.length < 200) {
      setResult({
        success: false,
        message: 'Need at least 200 characters in workspace to extract persona',
      });
      return;
    }

    setIsExtracting(true);
    setResult(null);

    try {
      const context = buildAUIContext(null, bookshelf);

      const toolResult = await executeTool(
        {
          name: 'extract_persona',
          params: {
            text: activeContent,
            name: manualName || undefined,
          },
          raw: '',
        },
        context
      );

      if (toolResult.success) {
        const data = toolResult.data as { unified?: Parameters<typeof bookshelf.createPersona>[0] } | undefined;
        setResult({
          success: true,
          message: toolResult.message || 'Persona extracted!',
          persona: toolResult.data,
        });

        // Store the persona if unified format available
        if (data?.unified) {
          await bookshelf.createPersona(data.unified);
        }
      } else {
        setResult({
          success: false,
          message: toolResult.error || 'Failed to extract persona',
        });
      }
    } catch (e) {
      setResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to extract persona',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleCreateManual = async () => {
    if (!manualName.trim()) return;

    setIsCreating(true);

    try {
      const now = Date.now();
      const persona = await bookshelf.createPersona({
        id: `persona-${now}`,
        name: manualName,
        author: 'user',
        description: manualDescription || `Custom persona: ${manualName}`,
        createdAt: now,
        updatedAt: now,
        tags: ['custom'],
        voice: {
          selfDescription: manualDescription || '',
          styleNotes: [],
          register: 'conversational',
          emotionalRange: 'neutral',
        },
        vocabulary: {
          preferred: [],
          avoided: [],
        },
        influences: [],
        exemplars: [],
        derivedFrom: [],
      });

      setResult({
        success: true,
        message: `Created persona "${persona.name}"`,
        persona,
      });

      setManualName('');
      setManualDescription('');
    } catch (e) {
      setResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to create persona',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="tool-panel">
      <div className="tool-panel__header">
        <h3>Persona / Voice</h3>
        <span className="tool-panel__subtitle">Create and manage writing voices</span>
      </div>
      <div className="tool-panel__body">
        {/* Existing Personas */}
        <div className="tool-panel__field">
          <label className="tool-panel__label">Available Personas</label>
          {personas.length > 0 ? (
            <div className="tool-panel__persona-list">
              {personas.map(p => (
                <button
                  key={p.uri}
                  className={`tool-panel__persona-item ${activePersonaUri === p.uri ? 'tool-panel__persona-item--active' : ''}`}
                  onClick={() => setActivePersonaUri(p.uri)}
                >
                  <span className="tool-panel__persona-name">{p.name}</span>
                  <span className="tool-panel__persona-desc">{p.description?.slice(0, 50)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="tool-panel__muted">No personas yet. Create one below.</p>
          )}
        </div>

        {/* Extract from content */}
        <div className="tool-panel__section">
          <h4 className="tool-panel__section-title">Extract from Text</h4>
          <p className="tool-panel__muted">
            Analyze text in the workspace to extract voice characteristics
          </p>
          <div className="tool-panel__field">
            <input
              type="text"
              className="tool-panel__input"
              placeholder="Optional name for persona..."
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <button
            className="tool-panel__button tool-panel__button--primary"
            onClick={handleExtractFromContent}
            disabled={isExtracting || !activeContent || activeContent.length < 200}
          >
            {isExtracting ? 'Extracting...' : 'Extract Persona from Workspace'}
          </button>
          {!activeContent && (
            <p className="tool-panel__hint-text">
              Load some text into the workspace first
            </p>
          )}
        </div>

        {/* Manual creation */}
        <div className="tool-panel__section">
          <h4 className="tool-panel__section-title">Create Manually</h4>
          <div className="tool-panel__field">
            <input
              type="text"
              className="tool-panel__input"
              placeholder="Persona name..."
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>
          <div className="tool-panel__field">
            <textarea
              className="tool-panel__textarea"
              placeholder="Description of voice, tone, perspective..."
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
              rows={3}
            />
          </div>
          <button
            className="tool-panel__button"
            onClick={handleCreateManual}
            disabled={isCreating || !manualName.trim()}
          >
            {isCreating ? 'Creating...' : 'Create Persona'}
          </button>
        </div>

        {/* Result display */}
        {result && (
          <div className={`tool-panel__result ${result.success ? '' : 'tool-panel__result--error'}`}>
            <p>{result.message}</p>
            {!!result.persona && (
              <p className="tool-panel__teaching-why">
                Persona ready for use in draft generation
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// WORKSPACE
// ═══════════════════════════════════════════════════════════════════

interface WorkspaceProps {
  selectedMedia?: SelectedFacebookMedia | null;
  selectedContent?: SelectedFacebookContent | null;
  onClearMedia?: () => void;
  onClearContent?: () => void;
  onUpdateMedia?: (media: SelectedFacebookMedia) => void;
  onGoToBook?: () => void;
}

type WorkspaceViewMode = 'read' | 'edit';

function Workspace({ selectedMedia, selectedContent, onClearMedia, onClearContent, onUpdateMedia, onGoToBook }: WorkspaceProps) {
  const { activeContent, activeNode, activeBuffer, getNodeHistory, importText, graph: _graph, buffers: _buffers } = useBuffers();
  const { setEditorWidth } = useTheme();
  const bookshelf = useBookshelf();
  const [navLoading, setNavLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
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
        number: (bookshelf.getBook(targetBookUri)?.chapters.length ?? 0) + 1,
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

  // Media viewer helper - handles both full URLs and file paths
  // Uses Electron's custom protocol for direct file serving, or falls back to archive server
  const getMediaUrl = (filePath: string) => {
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
  };

  const formatMediaDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Get current index in related media
  const getCurrentRelatedIndex = () => {
    if (!selectedMedia?.relatedMedia) return -1;
    return selectedMedia.relatedMedia.findIndex(m => m.id === selectedMedia.id);
  };

  // Handle clicking a related thumbnail - update main image
  const handleRelatedClick = (item: { id: string; file_path: string; media_type: 'image' | 'video' }) => {
    if (onUpdateMedia && selectedMedia) {
      onUpdateMedia({
        ...selectedMedia,
        id: item.id,
        file_path: item.file_path,
        media_type: item.media_type,
        filename: item.file_path.split('/').pop() || 'image',
      });
    }
  };

  // Open lightbox at current position
  const openLightbox = () => {
    const idx = getCurrentRelatedIndex();
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxOpen(true);
  };

  // Navigate lightbox using functional update to avoid stale closure
  const navigateLightbox = (delta: number) => {
    if (!selectedMedia?.relatedMedia) return;
    setLightboxIndex(current => {
      const newIndex = current + delta;
      if (newIndex >= 0 && newIndex < (selectedMedia.relatedMedia?.length || 0)) {
        return newIndex;
      }
      return current;
    });
  };

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!lightboxOpen || !selectedMedia?.relatedMedia) return;

    const maxIndex = selectedMedia.relatedMedia.length - 1;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxOpen(false);
      } else if (e.key === 'ArrowLeft') {
        setLightboxIndex(current => Math.max(0, current - 1));
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex(current => Math.min(maxIndex, current + 1));
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, selectedMedia?.relatedMedia?.length]);

  // Render content viewer if selectedContent is set (Facebook posts/comments)
  if (selectedContent) {
    const formatContentDate = (ts: number) => {
      return new Date(ts * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return (
      <div className="workspace workspace--content">
        <div className="content-viewer">
          {/* Header with back button and metadata */}
          <header className="content-viewer__header">
            <button
              className="content-viewer__close"
              onClick={onClearContent}
              title="Close content viewer"
            >
              ← Back
            </button>
            <div className="content-viewer__meta">
              <span className={`content-viewer__type content-viewer__type--${selectedContent.type}`}>
                {selectedContent.type === 'post' ? '📄 Post' : '💬 Comment'}
              </span>
              <span className="content-viewer__date">
                {formatContentDate(selectedContent.created_at)}
              </span>
              {selectedContent.author_name && (
                <span className="content-viewer__author">
                  by {selectedContent.author_name}
                </span>
              )}
              {selectedContent.is_own_content && (
                <span className="content-viewer__badge">Your content</span>
              )}
            </div>
          </header>

          {/* Title if present */}
          {selectedContent.title && (
            <h1 className="content-viewer__title">{selectedContent.title}</h1>
          )}

          {/* Main content */}
          <div className="content-viewer__body">
            <div className="content-viewer__text">
              {selectedContent.text}
            </div>
          </div>

          {/* Media attachments if present */}
          {selectedContent.media && selectedContent.media.length > 0 && (
            <div className="content-viewer__media">
              <h3 className="content-viewer__media-header">
                Attached Media ({selectedContent.media.length})
              </h3>
              <div className="content-viewer__media-grid">
                {selectedContent.media.map(item => (
                  <div key={item.id} className="content-viewer__media-thumb">
                    {item.media_type === 'image' ? (
                      <img
                        src={getMediaUrl(item.file_path)}
                        alt="Attached media"
                        loading="lazy"
                      />
                    ) : (
                      <div className="content-viewer__media-video">Video</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Context/thread info if present */}
          {selectedContent.context && (
            <div className="content-viewer__context">
              <h3 className="content-viewer__context-header">Thread Context</h3>
              <pre className="content-viewer__context-text">
                {selectedContent.context}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render media viewer if selectedMedia is set
  if (selectedMedia) {
    return (
      <div className="workspace workspace--media">
        <div className="media-viewer media-viewer--fullscreen">
          {/* Top bar with back button, info, and linked content */}
          <header className="media-viewer__header media-viewer__header--expanded">
            <div className="media-viewer__header-row">
              <button
                className="media-viewer__close"
                onClick={onClearMedia}
                title="Close media viewer"
              >
                ← Back
              </button>
              <div className="media-viewer__info">
                <span className="media-viewer__filename">{selectedMedia.filename}</span>
                <span className="media-viewer__meta">
                  {formatMediaDate(selectedMedia.created_at)}
                  {selectedMedia.width && selectedMedia.height && (
                    <> · {selectedMedia.width}×{selectedMedia.height}</>
                  )}
                  {selectedMedia.context?.album && (
                    <> · {selectedMedia.context.album}</>
                  )}
                </span>
              </div>
            </div>
            {/* Linked posts/comments */}
            {selectedMedia.linkedContent && selectedMedia.linkedContent.length > 0 && (
              <div className="media-viewer__linked">
                <span className="media-viewer__linked-label">Linked:</span>
                <div className="media-viewer__linked-items">
                  {selectedMedia.linkedContent.map((item, idx) => (
                    <span key={item.id} className="media-viewer__linked-item">
                      {idx > 0 && <span className="media-viewer__linked-sep">·</span>}
                      <span className={`media-viewer__linked-type media-viewer__linked-type--${item.type}`}>
                        {item.type === 'post' ? '📄' : '💬'}
                      </span>
                      <span className="media-viewer__linked-text">
                        {item.title || (item.text ? item.text.slice(0, 60) + (item.text.length > 60 ? '...' : '') : `${item.type} from ${formatMediaDate(item.created_at)}`)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </header>

          {/* Main image area - fills most of viewport */}
          <div className="media-viewer__stage">
            {selectedMedia.media_type === 'image' ? (
              <img
                src={getMediaUrl(selectedMedia.file_path)}
                alt={selectedMedia.filename}
                className="media-viewer__image media-viewer__image--clickable"
                onClick={openLightbox}
                title="Click to open lightbox"
              />
            ) : (
              <video
                src={getMediaUrl(selectedMedia.file_path)}
                controls
                className="media-viewer__video"
              />
            )}
            {/* Navigation arrows for main viewer */}
            {selectedMedia.relatedMedia && selectedMedia.relatedMedia.length > 1 && (() => {
              const currentIdx = selectedMedia.relatedMedia.findIndex(m => m.id === selectedMedia.id);
              const hasPrev = currentIdx > 0;
              const hasNext = currentIdx < selectedMedia.relatedMedia.length - 1;

              return (
                <>
                  {hasPrev && (
                    <button
                      className="media-viewer__nav media-viewer__nav--prev"
                      onClick={() => handleRelatedClick(selectedMedia.relatedMedia![currentIdx - 1])}
                      title="Previous image"
                    >
                      ‹
                    </button>
                  )}
                  {hasNext && (
                    <button
                      className="media-viewer__nav media-viewer__nav--next"
                      onClick={() => handleRelatedClick(selectedMedia.relatedMedia![currentIdx + 1])}
                      title="Next image"
                    >
                      ›
                    </button>
                  )}
                </>
              );
            })()}
          </div>

          {/* Related thumbnails strip at bottom */}
          {selectedMedia.relatedMedia && selectedMedia.relatedMedia.length > 1 && (
            <div className="media-viewer__strip">
              <span className="media-viewer__strip-label">
                Related ({selectedMedia.relatedMedia.length})
              </span>
              <div className="media-viewer__strip-scroll">
                {selectedMedia.relatedMedia.map(item => (
                  <button
                    key={item.id}
                    className={`media-viewer__strip-thumb ${item.id === selectedMedia.id ? 'media-viewer__strip-thumb--active' : ''}`}
                    onClick={() => handleRelatedClick(item)}
                    title="Click to view"
                  >
                    <img
                      src={getMediaUrl(item.file_path)}
                      alt=""
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Lightbox Modal */}
        {lightboxOpen && selectedMedia.relatedMedia && selectedMedia.relatedMedia[lightboxIndex] && (() => {
          const currentItem = selectedMedia.relatedMedia[lightboxIndex];
          const currentUrl = getMediaUrl(currentItem.file_path);
          const filename = currentItem.file_path.split('/').pop() || 'image';

          const handleDownload = async (e: React.MouseEvent) => {
            e.stopPropagation();
            try {
              const response = await fetch(currentUrl);
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error('Download failed:', err);
            }
          };

          const handleFullRes = (e: React.MouseEvent) => {
            e.stopPropagation();
            window.open(currentUrl, '_blank');
          };

          return (
            <div
              className="media-lightbox"
              onClick={() => setLightboxOpen(false)}
            >
              <button
                className="media-lightbox__close"
                onClick={() => setLightboxOpen(false)}
                title="Close (Esc)"
              >
                ✕
              </button>

              {/* Navigation arrows */}
              {lightboxIndex > 0 && (
                <button
                  className="media-lightbox__nav media-lightbox__nav--prev"
                  onClick={(e) => { e.stopPropagation(); navigateLightbox(-1); }}
                  title="Previous (←)"
                >
                  ‹
                </button>
              )}
              {lightboxIndex < selectedMedia.relatedMedia.length - 1 && (
                <button
                  className="media-lightbox__nav media-lightbox__nav--next"
                  onClick={(e) => { e.stopPropagation(); navigateLightbox(1); }}
                  title="Next (→)"
                >
                  ›
                </button>
              )}

              {/* Image */}
              <img
                className="media-lightbox__image"
                src={currentUrl}
                alt=""
                onClick={(e) => e.stopPropagation()}
              />

              {/* Bottom toolbar */}
              <div className="media-lightbox__toolbar">
                <span className="media-lightbox__counter">
                  {lightboxIndex + 1} / {selectedMedia.relatedMedia.length}
                </span>
                <span className="media-lightbox__filename">{filename}</span>
                <div className="media-lightbox__actions">
                  <button
                    className="media-lightbox__action"
                    onClick={handleFullRes}
                    title="View full resolution"
                  >
                    Full Size
                  </button>
                  <button
                    className="media-lightbox__action"
                    onClick={handleDownload}
                    title="Download image"
                  >
                    Download
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
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

// ═══════════════════════════════════════════════════════════════════
// USER DROPDOWN
// ═══════════════════════════════════════════════════════════════════

interface UserDropdownProps {
  user: { email?: string; name?: string } | null;
  onSignOut: () => void;
}

function UserDropdown({ user, onSignOut }: UserDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const displayName = user?.name || user?.email?.split('@')[0] || 'User';

  return (
    <div className="user-dropdown" ref={dropdownRef}>
      <button
        className="studio-topbar__btn studio-topbar__btn--user"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {displayName}
      </button>

      {isOpen && (
        <div className="user-dropdown__menu" role="menu">
          <div className="user-dropdown__header">
            <span className="user-dropdown__email">{user?.email || 'User'}</span>
          </div>
          <button
            className="user-dropdown__item"
            onClick={() => {
              setShowSettings(true);
              setIsOpen(false);
            }}
            role="menuitem"
          >
            Settings
          </button>
          <button
            className="user-dropdown__item user-dropdown__item--danger"
            onClick={() => {
              onSignOut();
              setIsOpen(false);
            }}
            role="menuitem"
          >
            Sign Out
          </button>
        </div>
      )}

      {showSettings && (
        <ThemeSettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════════

interface TopBarProps {
  onSelectMedia: (media: SelectedFacebookMedia) => void;
  onSelectContent: (content: SelectedFacebookContent) => void;
  onOpenGraph: () => void;
  onSelectBookContent?: (content: BookContent, project: BookProject) => void;
  onTransformComplete?: (original: string, transformed: string, transformType: string) => void;
  onBreadcrumbClick?: (index: number, path: string[], archiveSource: ArchiveSource) => void;
  onSelectSearchResult?: (result: SearchResult) => void;
  archiveTab?: ArchiveTabId;
  onArchiveTabChange?: (tab: ArchiveTabId | undefined) => void;
  onReviewInWorkspace?: (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => void;
}

function TopBar({ onSelectMedia, onSelectContent, onOpenGraph, onSelectBookContent, onTransformComplete, onBreadcrumbClick, onSelectSearchResult, archiveTab, onArchiveTabChange, onReviewInWorkspace }: TopBarProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { isPanelVisible, togglePanel } = useLayout();
  const { activeBuffer, activeNode, canUndo, canRedo, undo, redo } = useBuffers();
  const [visible, setVisible] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const setArchiveTab = onArchiveTabChange || (() => {});

  // Map archive source type to tab ID
  const mapSourceTypeToTab = (type: string): ArchiveTabId => {
    switch (type) {
      case 'chatgpt':
        return 'conversations';
      case 'facebook':
        return 'facebook';
      case 'book':
      case 'book-chapter':
      case 'book-passage':
      case 'book-thinking':
        return 'books';
      case 'filesystem':
        return 'files';
      default:
        return 'conversations';
    }
  };

  // Panel state from layout context - must be defined before callbacks that use them
  const leftOpen = isPanelVisible('archives');
  const rightOpen = isPanelVisible('tools');
  const setLeftOpen = (open: boolean) => {
    if (open !== leftOpen) togglePanel('archives');
  };
  const setRightOpen = (open: boolean) => {
    if (open !== rightOpen) togglePanel('tools');
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = useCallback((index: number, path: string[], archiveSource: ArchiveSource) => {
    // Navigate to the appropriate tab based on archive source type
    const targetTab = mapSourceTypeToTab(archiveSource.type);
    setArchiveTab(targetTab);

    // Open the archive panel if not already open
    if (!leftOpen) {
      togglePanel('archives');
    }

    // Call the external handler if provided
    onBreadcrumbClick?.(index, path, archiveSource);
  }, [onBreadcrumbClick, leftOpen, togglePanel]);

  // Subscribe to GUI actions from AUI tools (e.g., open_panel)
  useEffect(() => {
    const unsubscribe = subscribeToGUIActions((action) => {
      if (action.type === 'open_panel') {
        const data = action.data as { panel?: string } | undefined;
        const panel = data?.panel as 'archives' | 'tools' | undefined;
        if (panel === 'archives' && !leftOpen) {
          togglePanel('archives');
        } else if (panel === 'tools' && !rightOpen) {
          togglePanel('tools');
        }
        // TODO: Handle tab switching if action.data.tab is provided
      }
    });
    return unsubscribe;
  }, [leftOpen, rightOpen, togglePanel]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMove = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 3000);
    };
    window.addEventListener('mousemove', handleMove);
    handleMove();
    return () => {
      window.removeEventListener('mousemove', handleMove);
      clearTimeout(timeout);
    };
  }, []);

  // Build breadcrumb from archive source
  const breadcrumbs = useMemo(() => {
    if (!activeNode?.metadata?.source?.path) return [];
    return activeNode.metadata.source.path;
  }, [activeNode]);

  // Document title for display
  const documentTitle = activeBuffer?.name || 'humanizer';

  return (
    <>
      <header className={`studio-topbar ${visible ? '' : 'studio-topbar--hidden'}`}>
        <div className="studio-topbar__left">
          <button
            className="studio-topbar__btn"
            onClick={() => setLeftOpen(!leftOpen)}
            aria-expanded={leftOpen}
          >
            ☰ Archive
          </button>
        </div>

        <div className="studio-topbar__center studio-topbar__center--nav">
          {/* Left arrow */}
          <button
            className="studio-topbar__nav"
            onClick={undo}
            disabled={!canUndo}
            title="Go back"
            aria-label="Go back"
          >
            ←
          </button>

          {/* Centered title/breadcrumbs */}
          <div className="studio-topbar__title-wrapper">
            {breadcrumbs.length > 0 && activeNode?.metadata?.source ? (
              <div className="studio-topbar__breadcrumb">
                {breadcrumbs.map((crumb: string, i: number) => (
                  <span key={i} className="studio-topbar__breadcrumb-item">
                    {i > 0 && <span className="studio-topbar__breadcrumb-sep">›</span>}
                    <button
                      className="studio-topbar__breadcrumb-link"
                      onClick={() => {
                        // Open archive panel and navigate to this level
                        if (!leftOpen) togglePanel('archives');
                        if (activeNode?.metadata?.source) {
                          handleBreadcrumbClick(i, breadcrumbs, activeNode.metadata.source);
                        }
                      }}
                      title={`Navigate to ${crumb}`}
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="studio-topbar__title">{documentTitle}</span>
            )}
          </div>

          {/* Right arrow */}
          <button
            className="studio-topbar__nav"
            onClick={redo}
            disabled={!canRedo}
            title="Go forward"
            aria-label="Go forward"
          >
            →
          </button>
        </div>

        <div className="studio-topbar__right">
          {/* User dropdown */}
          {isAuthenticated ? (
            <UserDropdown
              user={user}
              onSignOut={logout}
            />
          ) : (
            <button
              className="studio-topbar__btn studio-topbar__btn--signin"
              onClick={() => setShowLogin(true)}
            >
              Sign In
            </button>
          )}

          {/* Tools - far right */}
          <button
            className="studio-topbar__btn"
            onClick={() => setRightOpen(!rightOpen)}
            aria-expanded={rightOpen}
          >
            Tools
          </button>
        </div>
      </header>

      {/* Login modal */}
      {showLogin && (
        <LoginPage
          onSuccess={() => setShowLogin(false)}
          onClose={() => setShowLogin(false)}
        />
      )}

      <HoverPanel
        side="left"
        isOpen={leftOpen}
        onToggle={() => setLeftOpen(!leftOpen)}
        title="Archive"
      >
        <ArchivePanel
          onClose={() => setLeftOpen(false)}
          onSelectMedia={onSelectMedia}
          onSelectContent={onSelectContent}
          onOpenGraph={onOpenGraph}
          onSelectBookContent={onSelectBookContent}
          onSelectSearchResult={onSelectSearchResult}
          navigateToTab={archiveTab}
          onTabChange={setArchiveTab}
        />
      </HoverPanel>

      <HoverPanel
        side="right"
        isOpen={rightOpen}
        onToggle={() => setRightOpen(!rightOpen)}
        title="Tools"
      >
        <ToolsPanel
          onClose={() => setRightOpen(false)}
          onTransformComplete={onTransformComplete}
          onReviewInWorkspace={onReviewInWorkspace}
        />
      </HoverPanel>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AUI CHAT - AI Assistant Interface
// ═══════════════════════════════════════════════════════════════════

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const AUI_SYSTEM_PROMPT = `You are AUI, the AI assistant for humanizer.com Studio.

Your role is to help users understand and use the Studio interface effectively.

Key features of the Studio:
- **Archive Panel** (left): Browse 1,800+ ChatGPT conversations, search by title, filter by media
- **Workspace** (center): View and edit imported content, with LaTeX rendering
- **Tools Panel** (right): Transform content with Humanize, Persona, Style, and analysis tools
- **Navigation**: When viewing a conversation message, use ⇤←→⇥ to navigate between messages
- **Books Tab**: Create and manage book projects with chapters and version control

Quick tips:
- Hover left edge or click "Archive" to browse conversations
- Hover right edge or click "Tools" to access transformation tools
- Use the search bar to find conversations by title
- "Hide empty" filter removes conversations with no messages
- Settings tab lets you show/hide tools you don't use

Be concise and helpful. Use markdown formatting.

${AUI_BOOK_SYSTEM_PROMPT}`;

interface AUIChatProps {
  workspace?: WorkspaceState;
}

function AUIChat({ workspace }: AUIChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! I\'m AUI, your Studio assistant. I can help you navigate the interface and manage your book projects. How can I help?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Bookshelf context for tool execution (BookContext deprecated)
  const bookshelf = useBookshelf();

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!chatRef.current) return;
    e.preventDefault();

    const rect = chatRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  }, []);

  // Handle drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Keep within viewport bounds
      const maxX = window.innerWidth - 360; // 360 = chat width
      const maxY = window.innerHeight - (isMinimized ? 48 : 500); // height depends on state

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, dragOffset, isMinimized]);

  // Reset position when closed
  useEffect(() => {
    if (!isOpen) {
      setPosition({ x: 0, y: 0 });
      setIsMinimized(false);
    }
  }, [isOpen]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      // Try local Ollama first, then fall back to cloud API
      const apiUrl = import.meta.env.VITE_CHAT_API_URL || 'http://localhost:11434/api/chat';
      const isOllama = apiUrl.includes('11434');

      // Create AUI context for tool execution (using bookshelf simple methods)
      const auiContext: AUIContext = {
        activeProject: bookshelf.activeBook,
        updateChapter: (chapterId, content, changes) => {
          void bookshelf.updateChapterSimple(chapterId, content, changes);
        },
        createChapter: (title, content) => {
          void bookshelf.createChapterSimple(title, content);
          // Return placeholder for sync interface
          return { id: `ch-${Date.now()}`, number: 1, title, content: content || '', wordCount: 0, version: 1, versions: [], status: 'outline' as const };
        },
        deleteChapter: (chapterId) => {
          void bookshelf.deleteChapterSimple(chapterId);
        },
        renderBook: () => bookshelf.renderActiveBook(),
        getChapter: (chapterId) => bookshelf.getChapterSimple(chapterId) || null,
        // Passage operations
        addPassage: (passage) => {
          void bookshelf.addPassageSimple(passage);
          return { id: `p-${Date.now()}`, text: passage.content, wordCount: passage.content.split(/\s+/).length } as ReturnType<AUIContext['addPassage']>;
        },
        updatePassage: (passageId, updates) => {
          void bookshelf.updatePassageSimple(passageId, updates);
        },
        getPassages: () => bookshelf.getPassagesSimple(),
        // Workspace state for context-aware tools
        workspace,
      };

      let assistantContent: string;

      if (isOllama) {
        // Ollama API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2',
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
            stream: false,
          }),
        });

        if (!response.ok) throw new Error('Ollama not available');
        const data = await response.json();
        assistantContent = data.message?.content || 'Sorry, I couldn\'t process that.';
      } else {
        // Cloud API format
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: AUI_SYSTEM_PROMPT },
              ...messages.map(m => ({ role: m.role, content: m.content })),
              { role: 'user', content: userMessage }
            ],
          }),
        });

        if (!response.ok) throw new Error('Chat API not available');
        const data = await response.json();
        assistantContent = data.response || 'Sorry, I couldn\'t process that.';
      }

      // Display the response
      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent }]);

      // Execute any tools found in the response
      const { results, hasTools } = await executeAllTools(assistantContent, auiContext);

      if (hasTools && results.length > 0) {
        // Add tool execution results with teaching info to the chat
        const toolResults = results.map(r => {
          if (r.success) {
            let result = `✓ ${r.message || 'Action completed'}`;

            // Add teaching information if available (Teach By Doing pattern)
            if (r.teaching) {
              result += `\n\n📖 **What happened:** ${r.teaching.whatHappened}`;

              if (r.teaching.guiPath && r.teaching.guiPath.length > 0) {
                result += `\n\n**To do this yourself:**\n${r.teaching.guiPath.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
              }

              if (r.teaching.shortcut) {
                result += `\n\n⌨️ **Shortcut:** ${r.teaching.shortcut}`;
              }

              if (r.teaching.why) {
                result += `\n\n💡 **Why:** ${r.teaching.why}`;
              }
            }

            return result;
          } else {
            return `✗ ${r.error || 'Action failed'}`;
          }
        }).join('\n\n---\n\n');

        setMessages(prev => [...prev, { role: 'assistant', content: `**Tool Results:**\n\n${toolResults}` }]);
      }
    } catch (err) {
      // Fallback to static responses
      const fallbackResponses: Record<string, string> = {
        'archive': 'The **Archive panel** is on the left side. Hover over the left edge or click "Archive" in the top bar to open it. You can search conversations by title and filter by media type.',
        'tools': 'The **Tools panel** is on the right side. Hover over the right edge or click "Tools ⚙" to open it. You\'ll find transformation tools like Humanize, Persona, and Style.',
        'navigate': 'When viewing a message from a conversation, use the navigation bar: **⇤** (first), **←** (previous), **→** (next), **⇥** (last) to move through messages.',
        'search': 'Use the **search bar** at the top of the Archive panel to filter conversations by title. The search works across all 1,800+ conversations.',
        'filter': 'Use the **filter dropdowns** to sort by message count, length, or date. The "Hide empty" checkbox filters out conversations with no messages.',
      };

      const lowerInput = userMessage.toLowerCase();
      let response = 'I\'m having trouble connecting to my backend. Here\'s what I can tell you:\n\n';

      if (lowerInput.includes('archive') || lowerInput.includes('conversation')) {
        response += fallbackResponses['archive'];
      } else if (lowerInput.includes('tool')) {
        response += fallbackResponses['tools'];
      } else if (lowerInput.includes('navigate') || lowerInput.includes('arrow') || lowerInput.includes('message')) {
        response += fallbackResponses['navigate'];
      } else if (lowerInput.includes('search') || lowerInput.includes('find')) {
        response += fallbackResponses['search'];
      } else if (lowerInput.includes('filter') || lowerInput.includes('sort')) {
        response += fallbackResponses['filter'];
      } else {
        response = 'I can help you with:\n- **Archive**: Browse and search conversations\n- **Tools**: Transform content\n- **Navigation**: Move between messages\n- **Filters**: Sort and filter the archive\n\nWhat would you like to know more about?';
      }

      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Compute style for positioning
  const chatStyle: React.CSSProperties = position.x !== 0 || position.y !== 0
    ? {
        position: 'fixed',
        left: position.x,
        top: position.y,
        right: 'auto',
        bottom: 'auto',
      }
    : {};

  return (
    <>
      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={chatRef}
          className={`aui-chat ${isMinimized ? 'aui-chat--minimized' : ''} ${isDragging ? 'aui-chat--dragging' : ''}`}
          style={chatStyle}
        >
          <div
            className="aui-chat__header"
            onMouseDown={handleDragStart}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <span className="aui-chat__title">AUI Assistant</span>
            <div className="aui-chat__header-actions">
              <button
                className="aui-chat__minimize"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? '□' : '−'}
              </button>
              <button className="aui-chat__close" onClick={() => setIsOpen(false)}>×</button>
            </div>
          </div>
          {!isMinimized && (
            <>
              <div className="aui-chat__messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`aui-chat__message aui-chat__message--${msg.role}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ))}
                {loading && (
                  <div className="aui-chat__message aui-chat__message--assistant aui-chat__message--loading">
                    <span>···</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="aui-chat__input-area">
                <input
                  type="text"
                  className="aui-chat__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about the Studio..."
                  disabled={loading}
                />
                <button
                  className="aui-chat__send"
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                >
                  →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Floating Chat Button */}
      <button
        className={`aui-fab ${isOpen ? 'aui-fab--open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="AUI Assistant"
      >
        {isOpen ? '×' : '?'}
      </button>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STUDIO
// ═══════════════════════════════════════════════════════════════════

interface BookContentMode {
  content: BookContent;
  project: BookProject;
}

// Inner component that has access to BufferContext
function StudioContent() {
  const { importText, activeContent, activeBuffer } = useBuffers();

  // Unified container selection (new)
  const [selectedContainer, setSelectedContainer] = useState<ArchiveContainer | null>(null);
  const [_bookProject, setBookProject] = useState<BookProject | null>(null);

  // Legacy states (kept for backward compatibility during transition)
  const [selectedMedia, setSelectedMedia] = useState<SelectedFacebookMedia | null>(null);
  const [selectedFacebookContent, setSelectedFacebookContent] = useState<SelectedFacebookContent | null>(null);
  const [showSocialGraph, setShowSocialGraph] = useState(false);
  const [bookContentMode, setBookContentMode] = useState<BookContentMode | null>(null);

  // Harvest workspace review state
  const [harvestReview, setHarvestReview] = useState<{
    conversation: HarvestConversation;
    stagedMessages: StagedMessage[];
  } | null>(null);

  // Split-screen state
  const splitScreen = useSplitScreen();
  const { setMode: setSplitMode } = useSplitMode();
  const [splitPaneContent, setSplitPaneContent] = useState<{
    id: string;
    title: string;
    subtitle?: string;
    text: string;
    type: 'archive' | 'conversation' | 'transform';
    transformedText?: string;
  } | null>(null);
  const [mobileSplitPane, setMobileSplitPane] = useState<'left' | 'right'>('left');

  // Archive tab state (lifted up so both TopBar and Workspace can access)
  const [archiveTab, setArchiveTab] = useState<ArchiveTabId | undefined>(undefined);

  // Structure inspector state (peek behind the curtain)
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Handle transformation completion - load into regular workspace
  // User can use "Read | Edit" toggle to compare/modify
  const handleTransformComplete = useCallback((original: string, transformed: string, transformType: string) => {
    // Load transformed content into the buffer
    // The user can then use the workspace's "Read | Edit" toggle
    importText(transformed, `${transformType} transformation`, {
      type: 'transform',
      original: original,
      transformType: transformType,
    });

    // Clear any split pane content - use regular workspace edit mode
    setSplitPaneContent(null);

    // Disable split screen if active
    if (splitScreen.isActive) {
      splitScreen.toggle();
    }
  }, [importText, splitScreen]);

  // Compute workspace state for AUI context
  const workspaceState = useMemo((): WorkspaceState => {
    // Determine view mode
    let viewMode: WorkspaceState['viewMode'] = 'text';
    if (bookContentMode) viewMode = 'book';
    else if (showSocialGraph) viewMode = 'graph';
    else if (selectedMedia) viewMode = 'media';
    else if (selectedFacebookContent) viewMode = 'content';

    // Extract buffer content
    let bufferContent: string | null = null;
    if (activeContent) {
      if (Array.isArray(activeContent)) {
        bufferContent = activeContent.map(item => item.text).join('\n\n');
      } else {
        bufferContent = activeContent.text;
      }
    }

    return {
      bufferContent,
      bufferName: activeBuffer?.name || null,
      selectedMedia,
      selectedContent: selectedFacebookContent,
      viewMode,
      selectedContainer,
    };
  }, [activeContent, activeBuffer, selectedMedia, selectedFacebookContent, bookContentMode, showSocialGraph, selectedContainer]);

  // Sync workspace state with AUI context
  const { setWorkspace } = useAUI();
  useEffect(() => {
    setWorkspace(workspaceState);
  }, [workspaceState, setWorkspace]);

  // Handle Facebook content selection from archive panel
  const handleSelectFacebookContent = useCallback((content: SelectedFacebookContent) => {
    setSelectedFacebookContent(content);
    // Clear other modes when viewing Facebook content
    setSelectedMedia(null);
    setShowSocialGraph(false);
    setBookContentMode(null);

    // Also set unified container
    const container = facebookContentToContainer(content);
    setSelectedContainer(container);
    setBookProject(null);

    // Also load into buffer so tools panel can work with it
    importText(content.text, content.title || `Facebook ${content.type}`, {
      type: 'facebook',
      path: ['facebook', content.type, content.id],
    });
  }, [importText]);

  // Handle book content selection from archive panel
  // Loads content into the regular Workspace for clean "Read | Edit" mode
  const handleSelectBookContent = useCallback((content: BookContent, project: BookProject) => {
    // Clear other modes when selecting book content
    setSelectedMedia(null);
    setSelectedFacebookContent(null);
    setShowSocialGraph(false);
    setBookContentMode(null); // Don't use bookContentMode - use regular workspace

    // Set book project for reference
    setBookProject(project);

    // Load content into buffer - this will display in the regular Workspace
    // with the clean "Read | Edit" toggle the user prefers
    importText(content.content, content.title, {
      type: `book-${content.type}` as ArchiveSourceType,
      bookProjectId: content.source.bookProjectId,
      itemId: content.source.itemId,
      path: [project.name || 'Book', content.type, content.title],
    });

    // Clear split pane content if any
    setSplitPaneContent(null);
  }, [importText]);

  // Handle book content edit - sync with buffer
  const handleBookEdit = useCallback((newContent: string) => {
    if (!bookContentMode) return;
    // Update local state
    setBookContentMode({
      ...bookContentMode,
      content: {
        ...bookContentMode.content,
        content: newContent,
      },
    });
    // Also update buffer
    importText(newContent, bookContentMode.content.title, {
      type: `book-${bookContentMode.content.type}`,
      bookProjectId: bookContentMode.content.source.bookProjectId,
      itemId: bookContentMode.content.source.itemId,
    });
  }, [bookContentMode, importText]);

  // Sync book content when buffer content changes from tools
  useEffect(() => {
    if (!bookContentMode || !activeContent) return;

    // Extract text from ContentItem (activeContent can be ContentItem | ContentItem[] | null)
    const newText = Array.isArray(activeContent)
      ? activeContent.map(item => item.text).join('\n\n')
      : activeContent.text;

    if (newText && newText !== bookContentMode.content.content) {
      setBookContentMode(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          content: {
            ...prev.content,
            content: newText,
          },
        };
      });
    }
  }, [activeContent, bookContentMode]);

  // Handle close book content mode
  const handleCloseBookContent = useCallback(() => {
    setBookContentMode(null);
    setSelectedContainer(null);
    setBookProject(null);
  }, []);

  // Handle semantic search result selection
  const handleSelectSearchResult = useCallback(async (result: SearchResult) => {
    if (!result.conversationFolder) {
      console.warn('Search result missing conversationFolder');
      return;
    }

    try {
      // Fetch the full conversation
      const conv = await fetchConversation(result.conversationFolder);
      const archiveServer = getArchiveServerUrlSync() || '';
      const messages = getMessages(conv, conv.messages.length, archiveServer);

      // Find the specific message if we have a messageId
      const messageId = result.metadata?.messageId;
      const targetMsg = messageId
        ? messages.find(m => m.id === messageId)
        : messages[0];

      if (targetMsg) {
        const messageIndex = messages.findIndex(m => m.id === targetMsg.id);

        // Import the message into the buffer
        importText(targetMsg.content, `${conv.title} [${targetMsg.role}]`, {
          type: 'chatgpt',
          conversationId: conv.id,
          conversationFolder: result.conversationFolder,
          messageId: targetMsg.id,
          messageIndex,
          totalMessages: messages.length,
          path: [conv.title, `Message ${messageIndex + 1}`],
        });

        // Clear other view modes
        setSelectedMedia(null);
        setSelectedFacebookContent(null);
        setShowSocialGraph(false);
        setBookContentMode(null);
        setSelectedContainer(null);
        setBookProject(null);
      }
    } catch (err) {
      console.error('Failed to load conversation from search result:', err);
    }
  }, [importText]);

  // Handle clearing container (unified close)
  const handleClearContainer = useCallback(() => {
    setSelectedContainer(null);
    setBookProject(null);
    setSelectedMedia(null);
    setSelectedFacebookContent(null);
    setBookContentMode(null);
  }, []);

  // Handle media selection with container
  const handleSelectMedia = useCallback((media: SelectedFacebookMedia) => {
    setSelectedMedia(media);
    setSelectedFacebookContent(null);
    setShowSocialGraph(false);
    setBookContentMode(null);

    // Also set unified container
    const container = facebookMediaToContainer(media);
    setSelectedContainer(container);
    setBookProject(null);
  }, []);

  // Handle harvest review - load full conversation into workspace
  const handleReviewInWorkspace = useCallback(async (conversationId: string, conversationTitle: string, passage: import('@humanizer/core').SourcePassage) => {
    try {
      const { getArchiveServerUrl } = await import('./lib/platform');
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/conversations/${encodeURIComponent(conversationId)}`);

      if (response.ok) {
        const data = await response.json();

        // DEBUG: Trace message extraction
        console.log('[Review] Raw API data keys:', Object.keys(data));
        console.log('[Review] Messages count:', data.messages?.length);
        console.log('[Review] First message:', JSON.stringify(data.messages?.[0], null, 2)?.slice(0, 500));
        console.log('[Review] First message content type:', typeof data.messages?.[0]?.content);
        console.log('[Review] First message content sample:',
          Array.isArray(data.messages?.[0]?.content)
            ? JSON.stringify(data.messages[0].content[0], null, 2)
            : data.messages?.[0]?.content?.slice?.(0, 200)
        );

        // Extract text from content array - API returns [{type: 'text', content: '...'}, ...]
        const extractContent = (content: unknown): string => {
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .filter((part: { type?: string }) => part?.type === 'text')
              .map((part: { content?: string }) => part?.content || '')
              .join('\n');
          }
          return '';
        };

        const messages = (data.messages || []).map((m: { id?: string; role: string; content: unknown }, idx: number) => ({
          id: m.id || `msg-${idx}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: extractContent(m.content),
        }));

        // DEBUG: Log extracted messages
        console.log('[Review] Extracted messages count:', messages.length);
        console.log('[Review] First extracted message:', messages[0]);
        console.log('[Review] Messages with content:', messages.filter((m: { content: string }) => m.content.length > 0).length);

        setHarvestReview({
          conversation: {
            conversationId,
            title: conversationTitle,
            messages,
            passage,
          },
          stagedMessages: [],
        });

        // Clear other views
        setShowSocialGraph(false);
        setSelectedContainer(null);
        setSelectedMedia(null);
        setSelectedFacebookContent(null);
      }
    } catch (err) {
      console.error('[StudioContent] Failed to load conversation for review:', err);
    }
  }, []);

  // Get the current workspace content as a ReactNode
  const renderWorkspaceContent = () => {
    // Harvest review takes priority - full conversation review in workspace
    if (harvestReview) {
      return (
        <HarvestWorkspaceView
          conversation={harvestReview.conversation}
          stagedMessages={harvestReview.stagedMessages}
          onStageMessage={(msg) => {
            setHarvestReview(prev => {
              if (!prev) return null;
              // Replace if already staged, otherwise add
              const existing = prev.stagedMessages.findIndex(s => s.messageId === msg.messageId);
              const newStaged = existing >= 0
                ? [...prev.stagedMessages.slice(0, existing), msg, ...prev.stagedMessages.slice(existing + 1)]
                : [...prev.stagedMessages, msg];
              return { ...prev, stagedMessages: newStaged };
            });
          }}
          onUnstageMessage={(messageId) => {
            setHarvestReview(prev => {
              if (!prev) return null;
              return {
                ...prev,
                stagedMessages: prev.stagedMessages.filter(s => s.messageId !== messageId),
              };
            });
          }}
          onCommitStaged={() => {
            // TODO: Commit staged messages to book chapter
            if (harvestReview?.stagedMessages.length) {
              const combined = harvestReview.stagedMessages
                .map(s => s.content)
                .join('\n\n---\n\n');
              importText(combined, `From: ${harvestReview.conversation.title}`, {
                type: 'chatgpt',
                conversationId: harvestReview.conversation.conversationId,
              });
              setHarvestReview(null);
            }
          }}
          onClose={() => setHarvestReview(null)}
        />
      );
    }

    // Book content now loads directly into the regular Workspace via importText
    // so it gets the clean "Read | Edit" toggle that the user prefers
    if (showSocialGraph) {
      return (
        <div className="workspace workspace--graph">
          <SocialGraphView onClose={() => setShowSocialGraph(false)} />
        </div>
      );
    }
    if (selectedContainer && selectedContainer.type === 'media') {
      return (
        <ContainerWorkspace
          container={selectedContainer}
          onClose={handleClearContainer}
        />
      );
    }
    if (selectedContainer && (selectedContainer.type === 'post' || selectedContainer.type === 'comment')) {
      return (
        <ContainerWorkspace
          container={selectedContainer}
          onClose={handleClearContainer}
        />
      );
    }
    return (
      <Workspace
        selectedMedia={selectedMedia}
        selectedContent={selectedFacebookContent}
        onClearMedia={() => { setSelectedMedia(null); setSelectedContainer(null); }}
        onClearContent={() => { setSelectedFacebookContent(null); setSelectedContainer(null); }}
        onUpdateMedia={handleSelectMedia}
        onGoToBook={() => setArchiveTab('books')}
      />
    );
  };

  // Create split pane content objects (for conversation transforms, etc.)
  const leftPaneContent: SplitPaneContent | null = splitPaneContent ? {
    id: splitPaneContent.id,
    title: splitPaneContent.title,
    subtitle: splitPaneContent.subtitle,
    readOnly: true,
    children: (
      <article className="split-pane__content">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[[rehypeKatex, { strict: false }]]}
        >
          {splitPaneContent.text}
        </ReactMarkdown>
      </article>
    ),
  } : null;

  const rightPaneContent: SplitPaneContent = {
    id: 'workspace',
    title: activeBuffer?.name || 'Workspace',
    subtitle: selectedContainer?.type,
    readOnly: false,
    children: renderWorkspaceContent(),
  };

  return (
    <div className="studio">
      <TopBar
        onSelectMedia={handleSelectMedia}
        onSelectContent={handleSelectFacebookContent}
        onOpenGraph={() => setShowSocialGraph(true)}
        onSelectBookContent={handleSelectBookContent}
        onTransformComplete={handleTransformComplete}
        onSelectSearchResult={handleSelectSearchResult}
        archiveTab={archiveTab}
        onArchiveTabChange={setArchiveTab}
        onReviewInWorkspace={handleReviewInWorkspace}
      />
      <main className="studio__main">
        {/* Split-screen mode */}
        {splitScreen.isActive && leftPaneContent ? (
          <SplitScreenWorkspace
            leftPane={leftPaneContent}
            rightPane={rightPaneContent}
            activeMobilePane={mobileSplitPane}
            onMobilePaneChange={setMobileSplitPane}
          />
        ) : (
          /* Normal single-pane mode */
          renderWorkspaceContent()
        )}
      </main>
      {/* AUI Chat disabled - will be integrated into Tools panel with proper styling */}
      {/* <AUIChat workspace={workspaceState} /> */}

      {/* Structure Inspector - peek behind the curtain at data structure */}
      <StructureInspector
        container={selectedContainer}
        isOpen={inspectorOpen}
        onToggle={() => setInspectorOpen(!inspectorOpen)}
      />

      {/* Subtle corner assistant - replaces intrusive bottom menubar */}
      <CornerAssistant />
    </div>
  );
}

export function Studio() {
  return (
    <ThemeProvider>
      <BufferProvider>
        <BookshelfProvider>
          {/* BookProvider removed - consolidated into BookshelfProvider (Phase 4.2) */}
          <AUIProvider>
            <StudioContent />
          </AUIProvider>
        </BookshelfProvider>
      </BufferProvider>
    </ThemeProvider>
  );
}
