/**
 * Facebook Feed View
 *
 * Displays posts and comments with filters.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SelectedFacebookContent } from '../types';
import type { FacebookContentItem, FilterType } from './shared';
import { normalizeMediaPath, getVideoThumbnailUrl, formatDate } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';
import { ImageWithFallback, MediaThumbnail } from '../../common';

const ITEMS_PER_PAGE = 50;

export interface FacebookFeedViewProps {
  selectedPeriod: string;
  onSelectContent?: (content: SelectedFacebookContent) => void;
}

export function FacebookFeedView({ selectedPeriod, onSelectContent }: FacebookFeedViewProps) {
  // Feed state
  const [items, setItems] = useState<FacebookContentItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedOffset, setFeedOffset] = useState(0);
  const [feedHasMore, setFeedHasMore] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [ownContentOnly, setOwnContentOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Archive server URL
  const [archiveServerUrl, setArchiveServerUrl] = useState<string | null>(null);

  // Ref for infinite scroll
  const feedObserverRef = useRef<HTMLDivElement>(null);

  // Initialize archive server URL
  useEffect(() => {
    getArchiveServerUrl().then(setArchiveServerUrl);
  }, []);

  // Load feed items
  const loadFeedItems = useCallback(async (reset = false) => {
    if (feedLoading) return;
    setFeedLoading(true);
    setError(null);

    try {
      const currentOffset = reset ? 0 : feedOffset;
      const params = new URLSearchParams({
        source: 'facebook',
        limit: ITEMS_PER_PAGE.toString(),
        offset: currentOffset.toString(),
      });

      if (filterType !== 'all' && filterType !== 'media') {
        params.append('type', filterType);
      }
      if (selectedPeriod) {
        params.append('period', selectedPeriod);
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/content/items?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.items) {
        console.warn('[FacebookFeedView.loadFeedItems] API response missing items field');
      }
      let filteredItems = data.items || [];

      // Client-side filters
      if (filterType === 'media') {
        filteredItems = filteredItems.filter((item: FacebookContentItem) => {
          try {
            const refs = item.media_refs ? JSON.parse(item.media_refs) : [];
            return refs.length > 0;
          } catch { return false; }
        });
      }
      if (ownContentOnly) {
        filteredItems = filteredItems.filter((item: FacebookContentItem) => item.is_own_content);
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredItems = filteredItems.filter((item: FacebookContentItem) =>
          item.text?.toLowerCase().includes(q) || item.title?.toLowerCase().includes(q)
        );
      }

      if (reset) {
        setItems(filteredItems);
        setFeedOffset(ITEMS_PER_PAGE);
      } else {
        setItems(prev => [...prev, ...filteredItems]);
        setFeedOffset(prev => prev + ITEMS_PER_PAGE);
      }

      setFeedHasMore(filteredItems.length === ITEMS_PER_PAGE);
    } catch (err) {
      console.error('Failed to load feed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setFeedLoading(false);
    }
  }, [feedOffset, feedLoading, filterType, selectedPeriod, ownContentOnly, searchQuery]);

  // Reload feed when filters change
  useEffect(() => {
    setItems([]);
    setFeedOffset(0);
    setFeedHasMore(true);
    loadFeedItems(true);
  }, [filterType, selectedPeriod, ownContentOnly]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && feedHasMore && !feedLoading) {
          loadFeedItems();
        }
      },
      { threshold: 0.1 }
    );

    const target = feedObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [feedHasMore, feedLoading, loadFeedItems]);

  // Handle feed content selection
  const handleSelectContent = async (item: FacebookContentItem) => {
    if (!onSelectContent) return;

    // Parse media refs if available
    let mediaItems: Array<{ id: string; file_path: string; media_type: 'image' | 'video' }> = [];
    if (item.media_refs) {
      try {
        const refs = JSON.parse(item.media_refs);
        if (refs.length > 0) {
          try {
            const archiveServer = await getArchiveServerUrl();
            const res = await fetch(`${archiveServer}/api/facebook/content/${item.id}/media`);
            if (res.ok) {
              const data = await res.json();
              if (!data.media) {
                console.warn('[FacebookFeedView.handleSelectContent] API response missing media field');
              }
              mediaItems = (data.media || []).map((m: { id: string; file_path: string; media_type: string }) => ({
                id: m.id,
                file_path: normalizeMediaPath(m.file_path, archiveServerUrl),
                media_type: m.media_type as 'image' | 'video',
              }));
            }
          } catch (err) {
            console.error('Failed to fetch content media:', err);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    onSelectContent({
      id: item.id,
      type: item.type,
      source: 'facebook',
      text: item.text,
      title: item.title,
      created_at: item.created_at,
      author_name: item.author_name,
      is_own_content: item.is_own_content,
      media: mediaItems.length > 0 ? mediaItems : undefined,
      context: item.context,
      metadata: item.metadata,
    });
  };

  return (
    <div className="facebook-view__feed">
      {/* Feed filters */}
      <div className="facebook-view__filters">
        <input
          type="text"
          className="facebook-view__search"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="facebook-view__filter-row">
          {(['all', 'post', 'comment', 'media'] as FilterType[]).map(t => (
            <button
              key={t}
              className={`facebook-view__filter-btn ${filterType === t ? 'facebook-view__filter-btn--active' : ''}`}
              onClick={() => setFilterType(t)}
            >
              {t === 'all' ? 'All' : t === 'post' ? 'Posts' : t === 'comment' ? 'Comments' : 'Media'}
            </button>
          ))}
          <label className="facebook-view__checkbox">
            <input
              type="checkbox"
              checked={ownContentOnly}
              onChange={(e) => setOwnContentOnly(e.target.checked)}
            />
            Mine
          </label>
        </div>
      </div>

      {/* Feed items */}
      <div className="facebook-view__feed-list">
        {error && <div className="facebook-view__error">{error}</div>}

        {items.length === 0 && !feedLoading && (
          <div className="facebook-view__empty">
            <p>No items found</p>
            <span>Try adjusting filters or import a Facebook archive</span>
          </div>
        )}

        {items.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            className="facebook-view__item"
            onClick={() => handleSelectContent(item)}
          >
            <div className="facebook-view__item-header">
              <span className={`facebook-view__item-type facebook-view__item-type--${item.type}`}>
                {item.type === 'post' ? 'Post' : 'Comment'}
              </span>
              <span className="facebook-view__item-date">{formatDate(item.created_at)}</span>
            </div>
            {item.title && <div className="facebook-view__item-title">{item.title}</div>}
            <div className="facebook-view__item-text">
              {item.text?.substring(0, 200) || '[No text]'}
              {item.text && item.text.length > 200 && '...'}
            </div>
            {(() => {
              try {
                const refs: string[] = item.media_refs ? JSON.parse(item.media_refs) : [];
                if (refs.length > 0) {
                  const displayRefs = refs.slice(0, 4);
                  const remaining = refs.length - 4;
                  return (
                    <div className="facebook-view__item-media-grid">
                      {displayRefs.map((ref, idx) => {
                        const ext = ref.toLowerCase().split('.').pop() || '';
                        const isVideo = ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext);
                        return (
                          <div key={idx} className="facebook-view__item-media-thumb">
                            {isVideo ? (
                              <>
                                <MediaThumbnail
                                  src={getVideoThumbnailUrl(ref, archiveServerUrl)}
                                  alt=""
                                  loading="lazy"
                                />
                                <div className="facebook-view__item-media-video-badge">Video</div>
                              </>
                            ) : (
                              <ImageWithFallback
                                src={normalizeMediaPath(ref, archiveServerUrl)}
                                alt=""
                                loading="lazy"
                              />
                            )}
                            {idx === 3 && remaining > 0 && (
                              <div className="facebook-view__item-media-more">+{remaining}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
          </div>
        ))}

        {feedLoading && <div className="facebook-view__loading">Loading...</div>}
        <div ref={feedObserverRef} className="facebook-view__observer-spacer" />
      </div>
    </div>
  );
}
