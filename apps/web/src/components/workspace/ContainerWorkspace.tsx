/**
 * ContainerWorkspace - Unified workspace view for any ArchiveContainer
 *
 * Routes container types to appropriate view components:
 * - conversation/message → MarkdownView
 * - media → MediaView
 * - chapter/passage → BookContentView
 * - post/comment → ContentView
 * - document → DocumentView
 */

import React, { useState } from 'react';

import type { ArchiveContainer } from '@humanizer/core';
import { BookContentView, type BookContent } from './BookContentView';
import { AnalyzableMarkdownWithMetrics } from './AnalyzableMarkdown';
import { VideoPlayer } from '../media/VideoPlayer';
import type { BookProject } from '../archive/book-project/types';
import { getArchiveServerUrlSync, isElectron } from '../../lib/platform';

/**
 * Image component with fallback for missing/broken images
 */
function ImageWithFallback({
  src,
  alt,
  className,
  onClick,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error) {
    return (
      <div
        className={`container-workspace__media-unavailable ${className || ''}`}
        onClick={onClick}
      >
        <div className="container-workspace__media-unavailable-icon">🖼️</div>
        <div className="container-workspace__media-unavailable-text">
          Media not available
        </div>
        <div className="container-workspace__media-unavailable-path" title={src}>
          {src.split('/').pop() || 'Unknown file'}
        </div>
      </div>
    );
  }

  return (
    <>
      {loading && (
        <div className="container-workspace__media-loading">Loading...</div>
      )}
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={onClick}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        style={loading ? { display: 'none' } : undefined}
      />
    </>
  );
}

/**
 * Linkify URLs in text - makes URLs clickable
 */
function linkifyText(text: string): React.ReactNode {
  // URL regex pattern
  const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  const parts = text.split(urlPattern);

  return parts.map((part, index) => {
    if (urlPattern.test(part)) {
      // Reset lastIndex since we're reusing the regex
      urlPattern.lastIndex = 0;
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="container-workspace__link"
          onClick={(e) => {
            e.stopPropagation();
            // In Electron, use shell.openExternal
            if (isElectron && window.electronAPI?.openExternal) {
              e.preventDefault();
              window.electronAPI.openExternal(part);
            }
          }}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

/**
 * Get media URL from file path - handles Electron vs browser
 */
function getMediaUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('local-media://')) {
    return filePath;
  }
  if (isElectron) {
    return `local-media://serve${filePath}`;
  }
  const archiveServer = getArchiveServerUrlSync();
  if (!archiveServer) {
    console.warn('Archive server URL not initialized');
    return filePath;
  }
  return `${archiveServer}/media/${filePath}`;
}

// ============================================
// Types
// ============================================

interface ContainerWorkspaceProps {
  container: ArchiveContainer;
  bookProject?: BookProject;
  onEdit?: (content: string) => void;
  onClose?: () => void;
  onUpdateContainer?: (container: ArchiveContainer) => void;
}

// ============================================
// Subcomponents
// ============================================

/**
 * Markdown content viewer with LaTeX support and analysis overlay
 */
function MarkdownView({
  container,
  onClose,
}: {
  container: ArchiveContainer;
  onClose?: () => void;
}) {
  const content = container.content.rendered || container.content.raw;
  const hasArtifacts = (container.content.artifacts?.length ?? 0) > 0;
  const hasThinking = (container.content.thinking?.length ?? 0) > 0;
  const [showMetrics, setShowMetrics] = useState(false);

  return (
    <div className="container-workspace container-workspace--markdown">
      <header className="container-workspace__header">
        <div className="container-workspace__header-left">
          {onClose && (
            <button
              className="container-workspace__back"
              onClick={onClose}
              title="Close"
            >
              ←
            </button>
          )}
          <div className="container-workspace__title-group">
            <span className="container-workspace__type-badge">
              {container.type === 'conversation' ? '💬' : '📝'} {container.type}
            </span>
            <h1 className="container-workspace__title">{container.meta.title}</h1>
            {container.meta.messageCount && (
              <span className="container-workspace__meta">
                {container.meta.messageCount} messages
              </span>
            )}
            {container.meta.wordCount && (
              <span className="container-workspace__meta">
                {container.meta.wordCount.toLocaleString()} words
              </span>
            )}
          </div>
        </div>
        <div className="container-workspace__actions">
          {hasArtifacts && (
            <span className="container-workspace__badge">
              📦 {container.content.artifacts!.length} artifacts
            </span>
          )}
          {hasThinking && (
            <span className="container-workspace__badge">
              🧠 {container.content.thinking!.length} reasoning blocks
            </span>
          )}
          {/* Quick action buttons */}
          <div className="container-workspace__quick-actions">
            <button
              className="container-workspace__quick-btn"
              onClick={() => {
                const blob = new Blob([content], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${container.meta.title || 'content'}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              title="Download as markdown"
            >
              ↓
            </button>
            <button
              className="container-workspace__quick-btn"
              onClick={async () => {
                await navigator.clipboard.writeText(content);
              }}
              title="Copy to clipboard"
            >
              ⎘
            </button>
            <button
              className="container-workspace__quick-btn container-workspace__quick-btn--md"
              onClick={async () => {
                await navigator.clipboard.writeText(content);
              }}
              title="Copy as markdown"
            >
              MD
            </button>
          </div>
        </div>
      </header>

      <article className="container-workspace__content container-workspace__content--markdown">
        <AnalyzableMarkdownWithMetrics
          content={content}
          showMetrics={showMetrics}
          onToggleMetrics={() => setShowMetrics(!showMetrics)}
        />
      </article>

      {/* Show extracted artifacts if any */}
      {hasArtifacts && (
        <aside className="container-workspace__artifacts">
          <h3>Extracted Artifacts</h3>
          {container.content.artifacts!.map((artifact) => (
            <details key={artifact.id} className="container-workspace__artifact">
              <summary>
                {artifact.type === 'code' ? '💻' : artifact.type === 'image-prompt' ? '🎨' : '📄'}{' '}
                {artifact.title}
              </summary>
              <pre className="container-workspace__artifact-content">
                <code>{artifact.content}</code>
              </pre>
            </details>
          ))}
        </aside>
      )}
    </div>
  );
}

/**
 * Linked content item type for media references
 */
interface LinkedContent {
  id: string;
  type: string;
  title: string;
  text: string;
  created_at: string;
  author_name?: string;
}

/**
 * Media viewer for images/video/audio with linked content
 */
function MediaView({
  container,
  onClose,
  onSelectContent,
}: {
  container: ArchiveContainer;
  onClose?: () => void;
  onSelectContent?: (contentId: string) => void;
}) {
  const media = container.media?.[0];
  const [showMetadata, setShowMetadata] = useState(false);
  const [linkedContent, setLinkedContent] = useState<LinkedContent[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Fetch linked content (posts/comments that reference this media)
  React.useEffect(() => {
    const fetchLinkedContent = async () => {
      if (!media?.id) return;

      setLoadingLinks(true);
      try {
        const archiveServer = getArchiveServerUrlSync();
        if (!archiveServer) return;

        const res = await fetch(`${archiveServer}/api/facebook/media/${media.id}/context`);
        if (res.ok) {
          const data = await res.json();
          setLinkedContent(data.contentItems || []);
        }
      } catch (err) {
        console.warn('[MediaView] Failed to load linked content:', err);
      } finally {
        setLoadingLinks(false);
      }
    };

    fetchLinkedContent();
  }, [media?.id]);

  if (!media) {
    return (
      <div className="container-workspace container-workspace--media">
        <p>No media content available</p>
      </div>
    );
  }

  // Handle both relative paths and full URLs
  const mediaUrl = media.url || (media.filePath ? getMediaUrl(media.filePath) : '');

  return (
    <div className="container-workspace container-workspace--media">
      <header className="container-workspace__header">
        <div className="container-workspace__header-left">
          {onClose && (
            <button className="container-workspace__back" onClick={onClose}>
              ←
            </button>
          )}
          <div className="container-workspace__title-group">
            <span className="container-workspace__type-badge">
              {media.mediaType === 'image' ? '🖼️' : media.mediaType === 'video' ? '🎬' : '🎵'}{' '}
              {media.mediaType}
            </span>
            <h1 className="container-workspace__title">{container.meta.title}</h1>
          </div>
        </div>
        <div className="container-workspace__actions">
          <button
            className={`container-workspace__action ${showMetadata ? 'container-workspace__action--active' : ''}`}
            onClick={() => setShowMetadata(!showMetadata)}
          >
            ℹ️ Info
          </button>
        </div>
      </header>

      <div className="container-workspace__media-main">
        <div className="container-workspace__media-container">
          {media.mediaType === 'image' && (
            <img
              src={mediaUrl}
              alt={media.description || container.meta.title}
              className="container-workspace__image"
            />
          )}
          {media.mediaType === 'video' && (
            <VideoPlayer
              src={mediaUrl}
              filePath={media.filePath || ''}
              mediaId={media.id}
              showTranscription={true}
              className="container-workspace__video-player"
            />
          )}
          {media.mediaType === 'audio' && (
            <audio
              src={mediaUrl}
              controls
              className="container-workspace__audio"
            />
          )}
        </div>

        {/* Linked content panel */}
        {(linkedContent.length > 0 || loadingLinks) && (
          <aside className="container-workspace__linked-content">
            <h3>Referenced In</h3>
            {loadingLinks ? (
              <div className="container-workspace__linked-loading">Loading...</div>
            ) : (
              <ul className="container-workspace__linked-list">
                {linkedContent.map((item) => (
                  <li
                    key={item.id}
                    className="container-workspace__linked-item"
                    onClick={() => onSelectContent?.(item.id)}
                    role={onSelectContent ? 'button' : undefined}
                    tabIndex={onSelectContent ? 0 : undefined}
                  >
                    <span className="container-workspace__linked-type">
                      {item.type === 'post' ? '📮' : '💬'}
                    </span>
                    <div className="container-workspace__linked-info">
                      <div className="container-workspace__linked-title">
                        {item.title || item.text?.slice(0, 60) || 'Untitled'}
                        {item.text && item.text.length > 60 ? '...' : ''}
                      </div>
                      <div className="container-workspace__linked-meta">
                        {item.author_name && <span>{item.author_name}</span>}
                        {item.created_at && (
                          <span>{new Date(item.created_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      {showMetadata && (
        <aside className="container-workspace__metadata-panel">
          <h3>Details</h3>
          <dl className="container-workspace__metadata-list">
            <dt>Filename</dt>
            <dd>{media.filename}</dd>
            {media.width && media.height && (
              <>
                <dt>Dimensions</dt>
                <dd>{media.width} × {media.height}</dd>
              </>
            )}
            {media.fileSize && (
              <>
                <dt>Size</dt>
                <dd>{(media.fileSize / 1024).toFixed(1)} KB</dd>
              </>
            )}
            {media.description && (
              <>
                <dt>Description</dt>
                <dd>{media.description}</dd>
              </>
            )}
            <dt>Uploaded</dt>
            <dd>
              {media.created_at
                ? new Date(
                    typeof media.created_at === 'number' && media.created_at < 10000000000
                      ? media.created_at * 1000 // Unix seconds to ms
                      : media.created_at
                  ).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : new Date(container.meta.created).toLocaleDateString()}
            </dd>
          </dl>

          {/* Linked content in info panel */}
          {linkedContent.length > 0 && (
            <div className="container-workspace__info-linked">
              <h4>Referenced In</h4>
              <ul className="container-workspace__info-linked-list">
                {linkedContent.map((item) => (
                  <li
                    key={item.id}
                    className="container-workspace__info-linked-item"
                    onClick={() => onSelectContent?.(item.id)}
                    role={onSelectContent ? 'button' : undefined}
                    tabIndex={onSelectContent ? 0 : undefined}
                  >
                    <span className="container-workspace__info-linked-icon">
                      {item.type === 'post' ? '📮' : '💬'}
                    </span>
                    <span className="container-workspace__info-linked-text">
                      {item.title || item.text?.slice(0, 40) || 'Untitled'}
                      {item.text && item.text.length > 40 ? '...' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * Simple text/post content viewer with image lightbox
 */
function ContentView({
  container,
  onClose,
}: {
  container: ArchiveContainer;
  onClose?: () => void;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // Filter media by type
  const imageMedia = container.media?.filter(m => m.mediaType === 'image') || [];
  const videoMedia = container.media?.filter(m => m.mediaType === 'video') || [];

  return (
    <div className="container-workspace container-workspace--content">
      <header className="container-workspace__header">
        <div className="container-workspace__header-left">
          {onClose && (
            <button className="container-workspace__back" onClick={onClose}>
              ←
            </button>
          )}
          <div className="container-workspace__title-group">
            <span className="container-workspace__type-badge">
              {container.type === 'post' ? '📮' : '💬'} {container.type}
            </span>
            <h1 className="container-workspace__title">{container.meta.title}</h1>
            {container.meta.author && (
              <span className="container-workspace__meta">
                by {container.meta.author}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable content area containing text AND media */}
      <div className="container-workspace__scrollable">
        <article className="container-workspace__content container-workspace__content--text">
          {linkifyText(container.content.raw)}
        </article>

        {/* Show linked media if any - masonry 2 column grid for images */}
        {imageMedia.length > 0 && (
          <div className="container-workspace__media-grid">
            {imageMedia.map((m, i) => (
              <div
                key={i}
                className="container-workspace__media-thumb container-workspace__media-thumb--clickable"
              >
                <ImageWithFallback
                  src={m.url || getMediaUrl(m.filePath || '')}
                  alt={m.description || `Media ${i + 1}`}
                  onClick={() => {
                    setLightboxIndex(i);
                    setLightboxOpen(true);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Show videos with VideoPlayer */}
        {videoMedia.length > 0 && (
          <div className="container-workspace__video-list">
            {videoMedia.map((m, i) => (
              <div key={i} className="container-workspace__video-item">
                <VideoPlayer
                  src={m.url || getMediaUrl(m.filePath || '')}
                  filePath={m.filePath || ''}
                  mediaId={m.id}
                  showTranscription={true}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && imageMedia[lightboxIndex] && (
        <div
          className="container-workspace__lightbox"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="container-workspace__lightbox-close"
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </button>

          {lightboxIndex > 0 && (
            <button
              className="container-workspace__lightbox-nav container-workspace__lightbox-nav--prev"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i - 1); }}
            >
              ‹
            </button>
          )}

          {lightboxIndex < imageMedia.length - 1 && (
            <button
              className="container-workspace__lightbox-nav container-workspace__lightbox-nav--next"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i + 1); }}
            >
              ›
            </button>
          )}

          <ImageWithFallback
            src={imageMedia[lightboxIndex].url || getMediaUrl(imageMedia[lightboxIndex].filePath || '')}
            alt="Full size"
            className="container-workspace__lightbox-image"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="container-workspace__lightbox-counter">
            {lightboxIndex + 1} / {imageMedia.length}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function ContainerWorkspace({
  container,
  bookProject,
  onEdit,
  onClose,
  onUpdateContainer: _onUpdateContainer,
}: ContainerWorkspaceProps) {
  // Route to appropriate view based on container type
  switch (container.type) {
    case 'chapter':
    case 'passage':
    case 'thinking':
      // Convert to BookContent format for BookContentView
      if (bookProject) {
        const bookContent: BookContent = {
          type: container.type as 'chapter' | 'passage' | 'thinking',
          title: container.meta.title,
          content: container.content.raw,
          source: {
            bookProjectId: bookProject.id,
            projectName: bookProject.name,
            itemId: container.id,
          },
        };

        return (
          <BookContentView
            content={bookContent}
            project={bookProject}
            onEdit={onEdit}
            onClose={onClose || (() => {})}
          />
        );
      }
      // Fall through to markdown view if no project context
      return <MarkdownView container={container} onClose={onClose} />;

    case 'media':
      return <MediaView container={container} onClose={onClose} />;

    case 'post':
    case 'comment':
      return <ContentView container={container} onClose={onClose} />;

    case 'conversation':
    case 'message':
    case 'document':
    default:
      return <MarkdownView container={container} onClose={onClose} />;
  }
}

export default ContainerWorkspace;
