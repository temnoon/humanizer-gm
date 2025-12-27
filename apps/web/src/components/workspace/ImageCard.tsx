/**
 * ImageCard - Display images with metadata and context
 *
 * Features:
 * - Constrained thumbnail (not full-page)
 * - Metadata panel (dimensions, date, source)
 * - Associated text (post text, DALL-E prompt, etc.)
 * - AI-generated description (when available)
 */

import { useState } from 'react';

export interface ImageCardProps {
  /** Image URL (HTTP) */
  url: string;
  /** Filename for display */
  filename: string;
  /** Image dimensions */
  width?: number;
  height?: number;
  /** File size in bytes */
  fileSize?: number;
  /** Creation date */
  createdAt?: Date | string | number;
  /** Source system */
  source?: 'openai' | 'facebook' | 'local';
  /** Associated text (post text, message context, etc.) */
  associatedText?: string;
  /** AI-generated description */
  aiDescription?: string;
  /** DALL-E prompt if applicable */
  dallePrompt?: string;
  /** Callback to close/go back */
  onClose?: () => void;
  /** Additional className */
  className?: string;
}

export function ImageCard({
  url,
  filename,
  width,
  height,
  fileSize,
  createdAt,
  source,
  associatedText,
  aiDescription,
  dallePrompt,
  onClose,
  className = '',
}: ImageCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Format file size
  const formatSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (date?: Date | string | number) => {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(typeof date === 'number' ? date * 1000 : date);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Source label
  const sourceLabels = {
    openai: 'OpenAI Archive',
    facebook: 'Facebook',
    local: 'Local File',
  };

  return (
    <article className={`image-card ${expanded ? 'image-card--expanded' : ''} ${className}`.trim()}>
      {/* Header */}
      <header className="image-card__header">
        {onClose && (
          <button className="image-card__back" onClick={onClose} aria-label="Close">
            ←
          </button>
        )}
        <div className="image-card__title-group">
          <span className="image-card__type-badge">🖼️ Image</span>
          <h2 className="image-card__title">{filename}</h2>
        </div>
        <div className="image-card__actions">
          <button
            className="image-card__action"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '⊖' : '⊕'}
          </button>
          <a
            href={url}
            download={filename}
            className="image-card__action"
            title="Download"
          >
            ↓
          </a>
        </div>
      </header>

      {/* Main content */}
      <div className="image-card__body">
        {/* Thumbnail container with constrained size */}
        <figure
          className="image-card__figure"
          onClick={() => setExpanded(!expanded)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
          aria-label={expanded ? 'Collapse image' : 'Expand image'}
        >
          <img
            src={url}
            alt={aiDescription || filename}
            className="image-card__image"
            loading="lazy"
          />
          {!expanded && (
            <figcaption className="image-card__caption">
              Click to expand
            </figcaption>
          )}
        </figure>

        {/* Metadata panel */}
        <aside className="image-card__metadata">
          <h3 className="image-card__section-title">Details</h3>
          <dl className="image-card__details">
            {width && height && (
              <>
                <dt>Dimensions</dt>
                <dd>{width} × {height}</dd>
              </>
            )}
            {fileSize && (
              <>
                <dt>Size</dt>
                <dd>{formatSize(fileSize)}</dd>
              </>
            )}
            {createdAt && (
              <>
                <dt>Date</dt>
                <dd>{formatDate(createdAt)}</dd>
              </>
            )}
            {source && (
              <>
                <dt>Source</dt>
                <dd>{sourceLabels[source] || source}</dd>
              </>
            )}
          </dl>

          {/* DALL-E prompt */}
          {dallePrompt && (
            <div className="image-card__context-section">
              <h4 className="image-card__context-title">🎨 Generation Prompt</h4>
              <blockquote className="image-card__quote">
                {dallePrompt}
              </blockquote>
            </div>
          )}

          {/* AI description */}
          {aiDescription && (
            <div className="image-card__context-section">
              <h4 className="image-card__context-title">🤖 AI Description</h4>
              <p className="image-card__description">{aiDescription}</p>
            </div>
          )}

          {/* Associated text */}
          {associatedText && (
            <div className="image-card__context-section">
              <h4 className="image-card__context-title">📝 Context</h4>
              <p className="image-card__associated-text">{associatedText}</p>
            </div>
          )}
        </aside>
      </div>
    </article>
  );
}

export default ImageCard;
