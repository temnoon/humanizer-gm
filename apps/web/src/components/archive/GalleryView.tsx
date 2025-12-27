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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueue } from '../../lib/queue';
import type { SelectedFacebookMedia } from './types';

const ARCHIVE_API = import.meta.env.VITE_ARCHIVE_API_URL || 'http://localhost:3002';

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

  // Queue integration
  const { isAvailable: queueAvailable, createJob, activeJobs } = useQueue();
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);

  // Find the active analysis job
  const activeAnalysisJob = activeJobs.find(j => j.id === analysisJobId);

  const loadImages = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    setError(null);

    try {
      // OpenAI uses /api/gallery with offset pagination
      // Facebook uses /api/facebook/media with page pagination
      const endpoint = source === 'openai'
        ? `${ARCHIVE_API}/api/gallery?offset=${pageNum * 50}&limit=50`
        : `${ARCHIVE_API}/api/facebook/media?page=${pageNum}&limit=50`;

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error('Failed to load images');
      }

      const data = await response.json();
      const rawImages = data.images || data.media || [];

      // Normalize the image data to match GalleryImage interface
      const newImages: GalleryImage[] = rawImages.map((img: Record<string, unknown>, index: number) => {
        const rawUrl = img.url as string;
        // For Facebook, URLs are raw file paths - convert to serve-media endpoint
        // For OpenAI, URLs are already proper HTTP URLs
        const normalizedUrl = source === 'facebook' && rawUrl && !rawUrl.startsWith('http')
          ? `${ARCHIVE_API}/api/facebook/serve-media?path=${encodeURIComponent(rawUrl)}`
          : rawUrl;

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

  const closeLightbox = () => setSelectedImage(null);

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
        const res = await fetch(`${ARCHIVE_API}/api/images/search?q=${encodeURIComponent(query)}`);
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

  // Determine which images to display
  const displayImages = searchQuery.trim() ? searchResults : images;

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
            <img
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

      {/* Lightbox */}
      {selectedImage && (
        <div className="gallery-view__lightbox" onClick={closeLightbox}>
          <button className="gallery-view__lightbox-close" onClick={closeLightbox}>
            ✕
          </button>
          <img
            src={selectedImage.url}
            alt={selectedImage.filename}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="gallery-view__lightbox-info">
            <p>{selectedImage.filename}</p>
            {selectedImage.createdAt && (
              <p className="gallery-view__lightbox-date">
                {new Date(selectedImage.createdAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
