/**
 * MediaViewer Component
 *
 * Fullscreen media viewer for images and videos with related thumbnails strip,
 * navigation arrows, and lightbox support.
 */

import { useState, useCallback } from 'react';
import type { SelectedFacebookMedia } from '../archive';
import { VideoPlayer } from '../media/VideoPlayer';
import { MediaLightbox, type LightboxMedia } from './MediaLightbox';

export interface MediaViewerProps {
  media: SelectedFacebookMedia;
  onClose?: () => void;
  onUpdateMedia?: (media: SelectedFacebookMedia) => void;
  getMediaUrl: (filePath: string) => string;
}

function formatMediaDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function MediaViewer({ media, onClose, onUpdateMedia, getMediaUrl }: MediaViewerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Get current index in related media
  const getCurrentRelatedIndex = useCallback(() => {
    if (!media.relatedMedia) return -1;
    return media.relatedMedia.findIndex(m => m.id === media.id);
  }, [media]);

  // Handle clicking a related thumbnail - update main image
  const handleRelatedClick = useCallback((item: { id: string; file_path: string; media_type: 'image' | 'video' }) => {
    if (onUpdateMedia) {
      onUpdateMedia({
        ...media,
        id: item.id,
        file_path: item.file_path,
        media_type: item.media_type,
        filename: item.file_path.split('/').pop() || 'image',
      });
    }
  }, [media, onUpdateMedia]);

  // Open lightbox at current position
  const openLightbox = useCallback(() => {
    const idx = getCurrentRelatedIndex();
    setLightboxIndex(idx >= 0 ? idx : 0);
    setLightboxOpen(true);
  }, [getCurrentRelatedIndex]);

  // Convert related media to lightbox format
  const lightboxMedia: LightboxMedia[] = (media.relatedMedia || []).map(m => ({
    id: m.id,
    file_path: m.file_path,
    media_type: m.media_type,
  }));

  // Navigation for main viewer
  const currentIdx = media.relatedMedia?.findIndex(m => m.id === media.id) ?? -1;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < (media.relatedMedia?.length ?? 0) - 1;

  return (
    <div className="workspace workspace--media">
      <div className="media-viewer media-viewer--fullscreen">
        {/* Top bar with back button, info, and linked content */}
        <header className="media-viewer__header media-viewer__header--expanded">
          <div className="media-viewer__header-row">
            <button
              className="media-viewer__close"
              onClick={onClose}
              title="Close media viewer"
            >
              ← Back
            </button>
            <div className="media-viewer__info">
              <span className="media-viewer__filename">{media.filename}</span>
              <span className="media-viewer__meta">
                {formatMediaDate(media.created_at)}
                {media.width && media.height && (
                  <> · {media.width}×{media.height}</>
                )}
                {media.context?.album && (
                  <> · {media.context.album}</>
                )}
              </span>
            </div>
          </div>

          {/* Linked posts/comments */}
          {media.linkedContent && media.linkedContent.length > 0 && (
            <div className="media-viewer__linked">
              <span className="media-viewer__linked-label">Linked:</span>
              <div className="media-viewer__linked-items">
                {media.linkedContent.map((item, idx) => (
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

        {/* Main image/video area - fills most of viewport */}
        <div className="media-viewer__stage">
          {media.media_type === 'image' ? (
            <img
              src={getMediaUrl(media.file_path)}
              alt={media.filename}
              className="media-viewer__image media-viewer__image--clickable"
              onClick={openLightbox}
              title="Click to open lightbox"
            />
          ) : (
            <VideoPlayer
              src={getMediaUrl(media.file_path)}
              filePath={media.file_path}
              mediaId={media.id}
              showTranscription={true}
              className="media-viewer__video"
            />
          )}

          {/* Navigation arrows for main viewer */}
          {media.relatedMedia && media.relatedMedia.length > 1 && (
            <>
              {hasPrev && (
                <button
                  className="media-viewer__nav media-viewer__nav--prev"
                  onClick={() => handleRelatedClick(media.relatedMedia![currentIdx - 1])}
                  title="Previous image"
                  aria-label="Previous image"
                >
                  ‹
                </button>
              )}
              {hasNext && (
                <button
                  className="media-viewer__nav media-viewer__nav--next"
                  onClick={() => handleRelatedClick(media.relatedMedia![currentIdx + 1])}
                  title="Next image"
                  aria-label="Next image"
                >
                  ›
                </button>
              )}
            </>
          )}
        </div>

        {/* Related thumbnails strip at bottom */}
        {media.relatedMedia && media.relatedMedia.length > 1 && (
          <div className="media-viewer__strip">
            <span className="media-viewer__strip-label">
              Related ({media.relatedMedia.length})
            </span>
            <div className="media-viewer__strip-scroll">
              {media.relatedMedia.map(item => (
                <button
                  key={item.id}
                  className={`media-viewer__strip-thumb ${item.id === media.id ? 'media-viewer__strip-thumb--active' : ''}`}
                  onClick={() => handleRelatedClick(item)}
                  title="Click to view"
                  aria-label={`View ${item.id === media.id ? 'current' : 'related'} media`}
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
      <MediaLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        media={lightboxMedia}
        currentIndex={lightboxIndex}
        onIndexChange={setLightboxIndex}
        getMediaUrl={getMediaUrl}
        showToolbar={true}
      />
    </div>
  );
}
