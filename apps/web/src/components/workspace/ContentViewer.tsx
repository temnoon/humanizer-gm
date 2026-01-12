/**
 * ContentViewer Component
 *
 * Displays Facebook posts and comments with media attachments.
 * Includes lightbox for viewing attached images.
 */

import { useState, useMemo } from 'react';
import type { SelectedFacebookContent } from '../archive';
import { VideoPlayer } from '../media/VideoPlayer';
import { MediaLightbox, type LightboxMedia } from './MediaLightbox';
import { formatTextForDisplay } from '../../lib/utils/textCleaner';

export interface ContentViewerProps {
  content: SelectedFacebookContent;
  onClose?: () => void;
  getMediaUrl: (filePath: string) => string;
}

function formatContentDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ContentViewer({ content, onClose, getMediaUrl }: ContentViewerProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Clean text content (strip HTML, preserve paragraphs)
  const cleanedText = useMemo(
    () => formatTextForDisplay(content.text || ''),
    [content.text]
  );

  // Filter media by type
  const imageMedia = content.media?.filter(m => m.media_type === 'image') || [];
  const videoMedia = content.media?.filter(m => m.media_type === 'video') || [];

  // Convert to lightbox format
  const lightboxMedia: LightboxMedia[] = imageMedia.map(m => ({
    id: m.id,
    file_path: m.file_path,
    media_type: m.media_type,
  }));

  return (
    <div className="workspace workspace--content">
      <div className="content-viewer">
        {/* Header with back button and metadata */}
        <header className="content-viewer__header">
          <button
            className="content-viewer__close"
            onClick={onClose}
            title="Close content viewer"
          >
            ← Back
          </button>
          <div className="content-viewer__meta">
            <span className={`content-viewer__type content-viewer__type--${content.type}`}>
              {content.type === 'post' ? '📄 Post' : '💬 Comment'}
            </span>
            <span className="content-viewer__date">
              {formatContentDate(content.created_at)}
            </span>
            {content.author_name && (
              <span className="content-viewer__author">
                by {content.author_name}
              </span>
            )}
            {content.is_own_content && (
              <span className="content-viewer__badge">Your content</span>
            )}
          </div>
        </header>

        {/* Title if present */}
        {content.title && (
          <h1 className="content-viewer__title">{content.title}</h1>
        )}

        {/* Main content */}
        <div className="content-viewer__body">
          <div className="content-viewer__text">
            {cleanedText.split('\n').map((paragraph, i) => (
              <p key={i} className="content-viewer__paragraph">
                {paragraph || '\u00A0'}
              </p>
            ))}
          </div>
        </div>

        {/* Media attachments if present */}
        {content.media && content.media.length > 0 && (
          <div className="content-viewer__media">
            <h3 className="content-viewer__media-header">
              Attached Media ({content.media.length})
            </h3>

            {/* Images in 2-column grid */}
            {imageMedia.length > 0 && (
              <div
                className="content-viewer__media-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}
              >
                {imageMedia.map((item, idx) => (
                  <div
                    key={item.id}
                    className="content-viewer__media-thumb"
                    style={{
                      aspectRatio: '4/3',
                      cursor: 'pointer',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--color-bg-tertiary, #f0f0f0)'
                    }}
                    onClick={() => {
                      setLightboxIndex(idx);
                      setLightboxOpen(true);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setLightboxIndex(idx);
                        setLightboxOpen(true);
                      }
                    }}
                    aria-label={`View image ${idx + 1} of ${imageMedia.length}`}
                  >
                    <img
                      src={getMediaUrl(item.file_path)}
                      alt={`Attached media ${idx + 1}`}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Videos in 2-column grid like images */}
            {videoMedia.length > 0 && (
              <div
                className="content-viewer__media-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: imageMedia.length > 0 ? '16px' : '0' }}
              >
                {videoMedia.map(item => (
                  <div
                    key={item.id}
                    className="content-viewer__video-item"
                    style={{
                      aspectRatio: '16/9',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: '#000'
                    }}
                  >
                    <VideoPlayer
                      key={item.id}
                      src={getMediaUrl(item.file_path)}
                      filePath={item.file_path}
                      mediaId={item.id}
                      showTranscription={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lightbox */}
        <MediaLightbox
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          media={lightboxMedia}
          currentIndex={lightboxIndex}
          onIndexChange={setLightboxIndex}
          getMediaUrl={getMediaUrl}
          showToolbar={false}
        />

        {/* Context/thread info if present */}
        {content.context && (
          <div className="content-viewer__context">
            <h3 className="content-viewer__context-header">Thread Context</h3>
            <pre className="content-viewer__context-text">
              {content.context}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
