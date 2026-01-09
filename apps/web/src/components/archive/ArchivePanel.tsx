/**
 * ArchivePanel - Archive browser panel with conversation list, search, and filters
 *
 * Features:
 * - Conversation list with virtual scrolling
 * - Search/filter by title, word count, media type
 * - Expand to view messages
 * - Integration with ArchiveTabs for different views
 *
 * Extracted from Studio.tsx during modularization
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useBuffers } from '../../lib/buffer';
import {
  fetchConversations,
  fetchConversation,
  getMessages,
  groupConversationsByMonth,
  checkArchiveHealth,
  getCurrentArchive,
  type ArchiveConversation,
  type FlatMessage,
} from '../../lib/archive';
import { getArchiveServerUrlSync } from '../../lib/platform';
import { ArchiveTabs } from './ArchiveTabs';
import type { BookProject } from './book-project/types';
import type { SearchResult } from './ExploreView';
import type { SelectedFacebookMedia, SelectedFacebookContent, ArchiveTabId } from './types';
import type { BookContent } from '../workspace';

export interface ArchivePanelProps {
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

export function ArchivePanel({ onClose, onSelectMedia, onSelectContent, onOpenGraph, onSelectBookContent, onSelectSearchResult, navigateToTab, onTabChange }: ArchivePanelProps) {
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
