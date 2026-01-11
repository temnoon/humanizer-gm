/**
 * Gallery View - Media browser with images from archive
 *
 * Features:
 * - Grid layout with adjustable thumbnail sizes
 * - Click to open in main workspace
 * - Source toggle: OpenAI / Facebook
 * - Batch AI analysis with queue system
 * - Search by AI-generated descriptions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueue } from '../../lib/queue';
import type { SelectedFacebookMedia } from './types';
import { getArchiveServerUrl, isElectron } from '../../lib/platform';
import { ImageWithFallback } from '../common';

interface ImageAnalysis {
  id: string;
  description: string | null;
  categories: string[];
  objects: string[];
  scene: string | null;
  mood: string | null;
  model_used: string | null;
  confidence: number | null;
  analyzed_at: number;
}

// Debounce utility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

interface GalleryImage {
  id: string;
  filename: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  createdAt?: string;
  source?: 'openai' | 'facebook';
  file_path?: string;
  // AI-generated metadata
  description?: string;
  categories?: string[];
  analyzed?: boolean;
}

type MediaSource = 'openai' | 'facebook';

export interface GalleryViewProps {
  /** Callback when an image is selected for display in main workspace */
  onSelectMedia?: (media: SelectedFacebookMedia) => void;
}

export function GalleryView({ onSelectMedia }: GalleryViewProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MediaSource>('openai');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
  const [thumbnailSize, setThumbnailSize] = useState(100);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GalleryImage[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Lightbox state
  const [imageAnalysis, setImageAnalysis] = useState<ImageAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // Queue integration
  const { isAvailable: queueAvailable, createJob, activeJobs } = useQueue();
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);

  // Find the active analysis job
  const activeAnalysisJob = activeJobs.find(j => j.id === analysisJobId);

  const loadImages = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    setError(null);

    try {
      const archiveApi = await getArchiveServerUrl();
      // OpenAI uses /api/gallery with offset pagination
      // Facebook uses /api/facebook/media with page pagination
      const endpoint = source === 'openai'
        ? `${archiveApi}/api/gallery?offset=${pageNum * 50}&limit=50`
        : `${archiveApi}/api/facebook/media?page=${pageNum}&limit=50`;

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error('Failed to load images');
      }

      const data = await response.json();
      // Validate API response (per FALLBACK POLICY: no silent fallbacks)
      if (!data.images && !data.media) {
        console.warn('[GalleryView.loadImages] API response missing images/media field');
      }
      const rawImages = data.images || data.media || [];

      // Normalize the image data to match GalleryImage interface
      const newImages: GalleryImage[] = rawImages.map((img: Record<string, unknown>, index: number) => {
        const rawUrl = (img.url || img.file_path) as string;
        // For Facebook, URLs are raw file paths - convert to serve-media endpoint or local-media://
        // For OpenAI, URLs are already proper HTTP URLs (or relative /api/ paths)
        let normalizedUrl = rawUrl;
        if (source === 'facebook' && rawUrl && !rawUrl.startsWith('http') && !rawUrl.startsWith('/api/')) {
          if (isElectron) {
            normalizedUrl = `local-media://serve${rawUrl}`;
          } else {
            // Use archiveApi which is already available from the async call above
            normalizedUrl = `${archiveApi}/api/facebook/serve-media?path=${encodeURIComponent(rawUrl)}`;
          }
        } else if (source === 'openai' && rawUrl && rawUrl.startsWith('/api/')) {
          // OpenAI gallery returns relative /api/ URLs - prepend server base
          normalizedUrl = `${archiveApi}${rawUrl}`;
        }

        return {
          id: (img.id as string) || `${source}-${pageNum}-${index}`,
          filename: img.filename as string || rawUrl?.split('/').pop() || 'image',
          url: normalizedUrl,
          thumbnail: img.thumbnail as string | undefined,
          width: img.width as number | undefined,
          height: img.height as number | undefined,
          createdAt: (img.createdAt || img.conversationCreatedAt || img.created_at) as string | undefined,
          source: source,
          file_path: rawUrl, // Keep original path for reference
        };
      });

      setImages(prev => append ? [...prev, ...newImages] : newImages);
      // Use API's hasMore if available, otherwise fall back to length check
      setHasMore(data.hasMore ?? newImages.length === 50);
    } catch (err) {
      setError('Could not load gallery');
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    setPage(0);
    setImages([]);
    loadImages(0);
  }, [source, loadImages]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadImages(nextPage, true);
  };

  const closeLightbox = () => {
    setSelectedImage(null);
    setImageAnalysis(null);
  };

  // Determine which images to display (must be before navigateLightbox)
  const displayImages = searchQuery.trim() ? searchResults : images;

  // Navigate to adjacent image in lightbox
  const navigateLightbox = useCallback((direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    const currentIndex = displayImages.findIndex(img => img.id === selectedImage.id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'prev'
      ? Math.max(0, currentIndex - 1)
      : Math.min(displayImages.length - 1, currentIndex + 1);

    if (newIndex !== currentIndex) {
      setSelectedImage(displayImages[newIndex]);
      setImageAnalysis(null); // Clear analysis for new image
    }
  }, [selectedImage, displayImages]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (!selectedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closeLightbox();
          break;
        case 'ArrowLeft':
          navigateLightbox('prev');
          break;
        case 'ArrowRight':
          navigateLightbox('next');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Focus the lightbox for screen readers
    lightboxRef.current?.focus();

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, navigateLightbox]);

  // Fetch analysis for selected image
  useEffect(() => {
    if (!selectedImage?.file_path) return;

    const fetchAnalysis = async () => {
      setLoadingAnalysis(true);
      try {
        const archiveApi = await getArchiveServerUrl();
        const res = await fetch(
          `${archiveApi}/api/gallery/analysis/by-path?path=${encodeURIComponent(selectedImage.file_path!)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            setImageAnalysis(data.data);
          }
        }
      } catch (err) {
        console.warn('Could not fetch image analysis:', err);
      } finally {
        setLoadingAnalysis(false);
      }
    };

    fetchAnalysis();
  }, [selectedImage?.file_path]);

  // Handle image selection - open in main workspace if callback provided
  const handleImageClick = (image: GalleryImage) => {
    if (onSelectMedia) {
      // Convert to SelectedFacebookMedia format for workspace display
      // Use the normalized URL (already converted for Facebook)
      onSelectMedia({
        id: image.id,
        file_path: image.url, // Use the normalized URL (HTTP URL for both sources)
        filename: image.filename,
        media_type: 'image',
        file_size: 0,
        width: image.width,
        height: image.height,
        created_at: image.createdAt ? Math.floor(new Date(image.createdAt).getTime() / 1000) : Date.now() / 1000,
        // Include all images as related for navigation
        relatedMedia: images.map(img => ({
          id: img.id,
          file_path: img.url, // Use normalized URLs
          media_type: 'image' as const,
        })),
      });
    } else {
      // Fall back to internal lightbox
      setSelectedImage(image);
    }
  };

  // Handle batch analysis of all displayed images
  const handleAnalyzeAll = async () => {
    if (!queueAvailable || images.length === 0) return;

    // Get file paths - for local files only (OpenAI dalle-generations, Facebook media)
    // For remote URLs, we'd need to download them first or use cloud queue
    const localImages = images.filter(img => {
      const path = img.file_path || img.url;
      // Only process local files (not http/https URLs)
      return path && !path.startsWith('http');
    });

    if (localImages.length === 0) {
      // All images are remote URLs - show message
      console.log('All images are remote URLs - local queue requires local files');
      return;
    }

    const { success, jobId, error: jobError } = await createJob({
      type: 'image-analysis',
      files: localImages.map(img => ({
        path: img.file_path || img.url,
        size: 0,
        id: img.id,
      })),
      options: { model: 'llava:13b' },
      concurrency: 2,
    });

    if (success && jobId) {
      setAnalysisJobId(jobId);
      console.log('Started analysis job:', jobId);
    } else {
      console.error('Failed to create job:', jobError);
    }
  };

  // Search handler with debounce
  const handleSearch = useMemo(() =>
    debounce(async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      try {
        const archiveApi = await getArchiveServerUrl();
        const res = await fetch(`${archiveApi}/api/images/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) {
          throw new Error('Search failed');
        }
        const data = await res.json();
        setSearchResults(data.results?.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          filename: (r.file_path as string)?.split('/').pop() || 'image',
          url: r.url as string || r.file_path as string,
          file_path: r.file_path as string,
          description: r.description as string,
          categories: typeof r.categories === 'string'
            ? JSON.parse(r.categories as string)
            : r.categories as string[],
          analyzed: true,
        })) || []);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300),
  []);

  // Calculate grid columns based on thumbnail size
  const gridColumns = Math.max(2, Math.floor(320 / (thumbnailSize + 4)));

  return (
    <div className="gallery-view">
      {/* Header */}
      <div className="gallery-view__header">
        <div className="gallery-view__tabs">
          <button
            className={`gallery-view__tab ${source === 'openai' ? 'gallery-view__tab--active' : ''}`}
            onClick={() => setSource('openai')}
          >
            OpenAI
          </button>
          <button
            className={`gallery-view__tab ${source === 'facebook' ? 'gallery-view__tab--active' : ''}`}
            onClick={() => setSource('facebook')}
          >
            Facebook
          </button>
        </div>
      </div>

      {/* Search input */}
      <div className="gallery-view__search-bar">
        <input
          type="text"
          className="gallery-view__search"
          placeholder="Search by description (e.g., 'sunset mountains')..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            handleSearch(e.target.value);
          }}
        />
        {isSearching && <span className="gallery-view__search-spinner" />}
      </div>

      {/* Progress indicator for active analysis */}
      {activeAnalysisJob && (
        <div className="gallery-view__progress">
          <div className="gallery-view__progress-bar">
            <div
              className="gallery-view__progress-fill"
              style={{ width: `${activeAnalysisJob.progress.percentComplete}%` }}
            />
          </div>
          <span className="gallery-view__progress-text">
            Analyzing: {activeAnalysisJob.progress.processed}/{activeAnalysisJob.progress.total} ({activeAnalysisJob.progress.percentComplete}%)
          </span>
        </div>
      )}

      {/* Controls row: count, size slider, analyze button */}
      <div className="gallery-view__controls">
        <span className="gallery-view__count">
          {searchQuery.trim() ? `${searchResults.length} results` : `${images.length} images`}
        </span>
        <div className="gallery-view__size-control">
          <span>Size:</span>
          <input
            type="range"
            min="60"
            max="180"
            value={thumbnailSize}
            onChange={(e) => setThumbnailSize(parseInt(e.target.value))}
          />
          <span>{thumbnailSize}px</span>
        </div>
        {queueAvailable && !searchQuery.trim() && (
          <button
            className="gallery-view__action"
            onClick={handleAnalyzeAll}
            disabled={images.length === 0 || !!activeAnalysisJob}
          >
            {activeAnalysisJob ? 'Analyzing...' : `Analyze All (${images.length})`}
          </button>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="gallery-view__error">
          <p>{error}</p>
          <button onClick={() => loadImages(0)}>Retry</button>
        </div>
      )}

      {/* Image Grid */}
      <div
        className="gallery-view__grid"
        style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
      >
        {displayImages.map(image => (
          <div
            key={image.id}
            className={`gallery-view__item ${image.analyzed ? 'gallery-view__item--analyzed' : ''}`}
            style={{ width: thumbnailSize, height: thumbnailSize }}
            onClick={() => handleImageClick(image)}
            title={image.description || image.filename}
          >
            <ImageWithFallback
              src={image.thumbnail || image.url}
              alt={image.filename}
              loading="lazy"
            />
            {image.categories && image.categories.length > 0 && (
              <div className="gallery-view__tags">
                {image.categories.slice(0, 2).map(cat => (
                  <span key={cat} className="gallery-view__tag">{cat}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="gallery-view__loading">Loading...</div>
      )}

      {/* Load more - only show when not searching */}
      {!loading && hasMore && images.length > 0 && !searchQuery.trim() && (
        <button className="gallery-view__load-more" onClick={handleLoadMore}>
          Load More
        </button>
      )}

      {/* Empty state */}
      {!loading && !error && displayImages.length === 0 && (
        <div className="gallery-view__empty">
          <p>{searchQuery.trim() ? 'No matching images found' : 'No images found'}</p>
        </div>
      )}

      {/* Lightbox - Enhanced with ARIA and description panel */}
      {selectedImage && (
        <div
          ref={lightboxRef}
          className="gallery-view__lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lightbox-title"
          tabIndex={-1}
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            className="gallery-view__lightbox-close"
            onClick={closeLightbox}
            aria-label="Close lightbox (Escape)"
          >
            ✕
          </button>

          {/* Navigation buttons */}
          <button
            className="gallery-view__lightbox-nav gallery-view__lightbox-nav--prev"
            onClick={(e) => { e.stopPropagation(); navigateLightbox('prev'); }}
            aria-label="Previous image (Left arrow)"
            disabled={displayImages.findIndex(img => img.id === selectedImage.id) === 0}
          >
            ‹
          </button>
          <button
            className="gallery-view__lightbox-nav gallery-view__lightbox-nav--next"
            onClick={(e) => { e.stopPropagation(); navigateLightbox('next'); }}
            aria-label="Next image (Right arrow)"
            disabled={displayImages.findIndex(img => img.id === selectedImage.id) === displayImages.length - 1}
          >
            ›
          </button>

          {/* Main content area */}
          <div className="gallery-view__lightbox-content" onClick={(e) => e.stopPropagation()}>
            {/* Image */}
            <ImageWithFallback
              src={selectedImage.url}
              alt={imageAnalysis?.description || selectedImage.filename}
              className="gallery-view__lightbox-image"
            />

            {/* Info panel */}
            <div className="gallery-view__lightbox-info">
              {/* Header: filename and date */}
              <div className="gallery-view__lightbox-header">
                <h3 id="lightbox-title" className="gallery-view__lightbox-title">
                  {selectedImage.filename}
                </h3>
                {selectedImage.createdAt && (
                  <span className="gallery-view__lightbox-date">
                    {new Date(selectedImage.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Description */}
              {loadingAnalysis ? (
                <p className="gallery-view__lightbox-loading">Loading analysis...</p>
              ) : imageAnalysis?.description ? (
                <div className="gallery-view__lightbox-description">
                  <p>{imageAnalysis.description}</p>
                </div>
              ) : (
                <p className="gallery-view__lightbox-no-analysis">
                  No AI analysis available
                </p>
              )}

              {/* Tags/Categories */}
              {imageAnalysis?.categories && imageAnalysis.categories.length > 0 && (
                <div className="gallery-view__lightbox-tags">
                  {imageAnalysis.categories.map(cat => (
                    <span key={cat} className="gallery-view__lightbox-tag">
                      {cat}
                    </span>
                  ))}
                </div>
              )}

              {/* Objects */}
              {imageAnalysis?.objects && imageAnalysis.objects.length > 0 && (
                <div className="gallery-view__lightbox-objects">
                  <span className="gallery-view__lightbox-label">Objects: </span>
                  {imageAnalysis.objects.join(', ')}
                </div>
              )}

              {/* Scene and Mood */}
              {(imageAnalysis?.scene || imageAnalysis?.mood) && (
                <div className="gallery-view__lightbox-meta">
                  {imageAnalysis.scene && (
                    <span className="gallery-view__lightbox-meta-item">
                      <span className="gallery-view__lightbox-label">Scene:</span> {imageAnalysis.scene}
                    </span>
                  )}
                  {imageAnalysis.mood && (
                    <span className="gallery-view__lightbox-meta-item">
                      <span className="gallery-view__lightbox-label">Mood:</span> {imageAnalysis.mood}
                    </span>
                  )}
                </div>
              )}

              {/* Keyboard hint */}
              <div className="gallery-view__lightbox-hint" aria-hidden="true">
                ← → to navigate • Esc to close
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
