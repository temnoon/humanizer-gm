/**
 * MediaLightbox Component
 *
 * Fullscreen lightbox for viewing images with navigation, download, and keyboard controls.
 * Used by both ContentViewer and MediaViewer.
 */

import { useEffect, useCallback } from 'react';

export interface LightboxMedia {
  id: string;
  file_path: string;
  media_type: 'image' | 'video';
}

export interface MediaLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  media: LightboxMedia[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  getMediaUrl: (filePath: string) => string;
  showToolbar?: boolean;
}

export function MediaLightbox({
  isOpen,
  onClose,
  media,
  currentIndex,
  onIndexChange,
  getMediaUrl,
  showToolbar = true,
}: MediaLightboxProps) {
  // Keyboard navigation
  useEffect(() => {
    if (!isOpen || media.length === 0) return;

    const maxIndex = media.length - 1;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        onIndexChange(Math.max(0, currentIndex - 1));
      } else if (e.key === 'ArrowRight') {
        onIndexChange(Math.min(maxIndex, currentIndex + 1));
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, media.length, currentIndex, onIndexChange, onClose]);

  // Navigate to previous/next
  const navigatePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onIndexChange(Math.max(0, currentIndex - 1));
  }, [currentIndex, onIndexChange]);

  const navigateNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onIndexChange(Math.min(media.length - 1, currentIndex + 1));
  }, [currentIndex, media.length, onIndexChange]);

  // Download current image
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentItem = media[currentIndex];
    if (!currentItem) return;

    try {
      const url = getMediaUrl(currentItem.file_path);
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const filename = currentItem.file_path.split('/').pop() || 'image';
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [media, currentIndex, getMediaUrl]);

  // Open full resolution in new tab
  const handleFullRes = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const currentItem = media[currentIndex];
    if (!currentItem) return;
    window.open(getMediaUrl(currentItem.file_path), '_blank');
  }, [media, currentIndex, getMediaUrl]);

  if (!isOpen || media.length === 0) return null;

  const currentItem = media[currentIndex];
  if (!currentItem) return null;

  const currentUrl = getMediaUrl(currentItem.file_path);
  const filename = currentItem.file_path.split('/').pop() || 'image';
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < media.length - 1;

  return (
    <div
      className="media-lightbox"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
    >
      <button
        className="media-lightbox__close"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close lightbox"
      >
        ×
      </button>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          className="media-lightbox__nav media-lightbox__nav--prev"
          onClick={navigatePrev}
          title="Previous (←)"
          aria-label="Previous image"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          className="media-lightbox__nav media-lightbox__nav--next"
          onClick={navigateNext}
          title="Next (→)"
          aria-label="Next image"
        >
          ›
        </button>
      )}

      {/* Image */}
      <img
        className="media-lightbox__image"
        src={currentUrl}
        alt={`Image ${currentIndex + 1} of ${media.length}`}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Bottom toolbar */}
      <div className="media-lightbox__toolbar">
        <span className="media-lightbox__counter">
          {currentIndex + 1} / {media.length}
        </span>
        {showToolbar && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
