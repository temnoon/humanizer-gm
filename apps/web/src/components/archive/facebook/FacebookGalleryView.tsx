/**
 * Facebook Gallery View
 *
 * Displays media thumbnails with size control and type filters.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SelectedFacebookMedia } from '../types';
import type { MediaItem, MediaStats } from './shared';
import { normalizeMediaPath, getVideoThumbnailUrl, formatFileSize } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';
import { ImageWithFallback, MediaThumbnail } from '../../common';

export interface FacebookGalleryViewProps {
  selectedPeriod: string;
  onSelectMedia?: (media: SelectedFacebookMedia) => void;
}

export function FacebookGalleryView({ selectedPeriod, onSelectMedia }: FacebookGalleryViewProps) {
  // Media gallery state
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaOffset, setMediaOffset] = useState(0);
  const [mediaHasMore, setMediaHasMore] = useState(true);
  const [mediaStats, setMediaStats] = useState<MediaStats | null>(null);
  const [thumbnailSize, setThumbnailSize] = useState(90);

  // Gallery media type filters
  const [showImages, setShowImages] = useState(true);
  const [showVideos, setShowVideos] = useState(true);
  const [showAudioOnly, setShowAudioOnly] = useState(true);

  // Archive server URL
  const [archiveServerUrl, setArchiveServerUrl] = useState<string | null>(null);

  // Ref for infinite scroll
  const mediaObserverRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    getArchiveServerUrl().then(setArchiveServerUrl);
    loadMediaStats();
  }, []);

  // Load media stats
  const loadMediaStats = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media-stats`);
      if (res.ok) {
        const data = await res.json();
        setMediaStats(data);
      }
    } catch (err) {
      console.error('Failed to load media stats:', err);
    }
  };

  // Load media items
  const loadMediaItems = useCallback(async (reset = false) => {
    if (mediaLoading) return;
    setMediaLoading(true);

    try {
      const currentOffset = reset ? 0 : mediaOffset;
      const params = new URLSearchParams({
        limit: '100',
        offset: currentOffset.toString(),
      });

      if (selectedPeriod) {
        params.append('period', selectedPeriod);
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media-gallery?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.items) {
        console.warn('[FacebookGalleryView.loadMediaItems] API response missing items field');
      }

      if (reset) {
        setMedia(data.items || []);
        setMediaOffset(100);
      } else {
        setMedia(prev => [...prev, ...(data.items || [])]);
        setMediaOffset(prev => prev + 100);
      }

      setMediaHasMore(data.hasMore ?? false);
    } catch (err) {
      console.error('Failed to load media:', err);
    } finally {
      setMediaLoading(false);
    }
  }, [mediaOffset, mediaLoading, selectedPeriod]);

  // Reload media when period changes
  useEffect(() => {
    setMedia([]);
    setMediaOffset(0);
    setMediaHasMore(true);
    loadMediaItems(true);
  }, [selectedPeriod]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && mediaHasMore && !mediaLoading) {
          loadMediaItems();
        }
      },
      { threshold: 0.1 }
    );

    const target = mediaObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [mediaHasMore, mediaLoading, loadMediaItems]);

  // Get image URL
  const getImageUrl = (item: MediaItem) => {
    if (typeof window !== 'undefined' && (window as unknown as { isElectron?: boolean }).isElectron) {
      return `local-media://serve${item.file_path}`;
    }
    return normalizeMediaPath(item.file_path, archiveServerUrl);
  };

  // Handle media selection
  const handleSelectMedia = async (item: MediaItem, _index: number) => {
    if (!onSelectMedia) return;

    // Parse context if available
    let context: { album?: string; post_title?: string } | undefined;
    if (item.context) {
      try {
        context = typeof item.context === 'string' ? JSON.parse(item.context) : item.context;
      } catch {
        // Ignore parse errors
      }
    }

    // Fetch contextual related media and linked content from API
    let relatedMedia: Array<{ id: string; file_path: string; media_type: 'image' | 'video'; created_at?: number }> = [];
    let linkedContent: Array<{ id: string; type: 'post' | 'comment'; title?: string; text?: string; created_at: number; author_name?: string }> = [];

    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media/${item.id}/context`);
      if (res.ok) {
        const data = await res.json();
        if (data.relatedMedia && data.relatedMedia.length > 0) {
          relatedMedia = data.relatedMedia.map((m: { id: string; file_path: string; media_type: string; created_at?: number }) => ({
            id: m.id,
            file_path: normalizeMediaPath(m.file_path, archiveServerUrl),
            media_type: m.media_type as 'image' | 'video',
            created_at: m.created_at,
          }));
        }
        if (data.contentItems && data.contentItems.length > 0) {
          linkedContent = data.contentItems.map((c: { id: string; type: string; title?: string; text?: string; created_at: number; author_name?: string }) => ({
            id: c.id,
            type: c.type as 'post' | 'comment',
            title: c.title,
            text: c.text,
            created_at: c.created_at,
            author_name: c.author_name,
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch media context:', err);
    }

    // Fallback: if no related media found, just include the current item
    if (relatedMedia.length === 0) {
      relatedMedia = [{
        id: item.id,
        file_path: normalizeMediaPath(item.file_path, archiveServerUrl),
        media_type: item.media_type as 'image' | 'video',
        created_at: item.created_at,
      }];
    }

    onSelectMedia({
      id: item.id,
      file_path: normalizeMediaPath(item.file_path, archiveServerUrl),
      filename: item.filename,
      media_type: item.media_type as 'image' | 'video',
      file_size: item.file_size,
      width: item.width,
      height: item.height,
      created_at: item.created_at,
      description: item.description,
      context,
      related_post_id: item.related_post_id,
      linkedContent,
      relatedMedia,
    });
  };

  const gridColumns = Math.max(2, Math.floor(300 / (thumbnailSize + 4)));

  return (
    <div className="facebook-view__gallery">
      {/* Stats bar */}
      {mediaStats && (
        <div className="facebook-view__stats">
          <strong>{mediaStats.total.toLocaleString()}</strong> items
          <span className="facebook-view__stats-sep">|</span>
          <strong>{formatFileSize(mediaStats.totalSizeBytes)}</strong>
        </div>
      )}

      {/* Media type filters */}
      <div className="facebook-view__media-filters">
        <label className="facebook-view__filter-checkbox">
          <input
            type="checkbox"
            checked={showImages}
            onChange={(e) => setShowImages(e.target.checked)}
          />
          <span>Images</span>
        </label>
        <label className="facebook-view__filter-checkbox">
          <input
            type="checkbox"
            checked={showVideos}
            onChange={(e) => setShowVideos(e.target.checked)}
          />
          <span>Videos</span>
        </label>
        <label className="facebook-view__filter-checkbox">
          <input
            type="checkbox"
            checked={showAudioOnly}
            onChange={(e) => setShowAudioOnly(e.target.checked)}
          />
          <span>Audio-only</span>
        </label>
      </div>

      {/* Size slider */}
      <div className="facebook-view__size-slider">
        <span>Size:</span>
        <input
          type="range"
          min="50"
          max="150"
          value={thumbnailSize}
          onChange={(e) => setThumbnailSize(parseInt(e.target.value))}
        />
        <span>{thumbnailSize}px</span>
      </div>

      {/* Thumbnail grid */}
      <div
        className="facebook-view__grid"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
      >
        {media.filter(item => {
          if (item.media_type === 'image') return showImages;
          if (item.media_type === 'video') {
            const hasVideo = item.has_video_track !== false;
            if (hasVideo) return showVideos;
            return showAudioOnly;
          }
          return true;
        }).map((item, index) => (
          <div
            key={item.id}
            className="facebook-view__thumb"
            style={{ width: thumbnailSize, height: thumbnailSize }}
            onClick={() => handleSelectMedia(item, index)}
          >
            {item.media_type === 'image' ? (
              <ImageWithFallback
                src={getImageUrl(item)}
                alt={item.filename}
                loading="lazy"
              />
            ) : (
              <div className="facebook-view__thumb-video-wrapper">
                <MediaThumbnail
                  src={getVideoThumbnailUrl(item.file_path, archiveServerUrl)}
                  alt={item.filename}
                  loading="lazy"
                  className="facebook-view__thumb-video-img"
                />
                <div className="facebook-view__thumb-play-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {mediaLoading && <div className="facebook-view__loading">Loading...</div>}
      <div ref={mediaObserverRef} className="facebook-view__observer-spacer" />
    </div>
  );
}
