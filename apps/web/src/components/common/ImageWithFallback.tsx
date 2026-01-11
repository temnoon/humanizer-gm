/**
 * ImageWithFallback - Image component with graceful error handling
 *
 * Displays a placeholder when the image fails to load (404, network error, etc.)
 * Prevents broken image icons in the UI.
 */

import { useState, useCallback, type ImgHTMLAttributes } from 'react';

// ============================================
// Types
// ============================================

export interface ImageWithFallbackProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  /** Primary image source */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Custom fallback image URL */
  fallbackSrc?: string;
  /** Custom fallback component (overrides fallbackSrc) */
  fallbackComponent?: React.ReactNode;
  /** Callback when image fails to load */
  onLoadError?: (src: string) => void;
}

// ============================================
// Default Placeholder SVG
// ============================================

const PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect width="100" height="100" fill="#e5e7eb"/>
  <path d="M35 65l15-20 10 13 20-26" stroke="#9ca3af" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="35" cy="38" r="6" fill="#9ca3af"/>
</svg>
`)}`;

// ============================================
// Component
// ============================================

export function ImageWithFallback({
  src,
  alt,
  fallbackSrc = PLACEHOLDER_SVG,
  fallbackComponent,
  onLoadError,
  className,
  ...props
}: ImageWithFallbackProps) {
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  const handleError = useCallback(() => {
    if (!hasError) {
      setHasError(true);
      setCurrentSrc(fallbackSrc);
      onLoadError?.(src);
    }
  }, [hasError, fallbackSrc, onLoadError, src]);

  // Reset error state when src changes
  if (src !== currentSrc && !hasError) {
    setCurrentSrc(src);
  }

  // If custom fallback component provided and error occurred, render it
  if (hasError && fallbackComponent) {
    return <>{fallbackComponent}</>;
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`${className || ''} ${hasError ? 'image-fallback' : ''}`.trim()}
      onError={handleError}
      {...props}
    />
  );
}

// ============================================
// Profile Image Variant
// ============================================

/**
 * ProfileImage - Circular image with person silhouette fallback
 */
const PROFILE_PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect width="100" height="100" fill="#e5e7eb"/>
  <circle cx="50" cy="38" r="18" fill="#9ca3af"/>
  <path d="M20 90c0-20 13-32 30-32s30 12 30 32" fill="#9ca3af"/>
</svg>
`)}`;

export function ProfileImage({
  src,
  alt,
  className,
  ...props
}: Omit<ImageWithFallbackProps, 'fallbackSrc'>) {
  return (
    <ImageWithFallback
      src={src}
      alt={alt}
      fallbackSrc={PROFILE_PLACEHOLDER_SVG}
      className={`profile-image ${className || ''}`.trim()}
      {...props}
    />
  );
}

// ============================================
// Media Thumbnail Variant
// ============================================

/**
 * MediaThumbnail - For video/audio thumbnails with play icon fallback
 */
const MEDIA_PLACEHOLDER_SVG = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect width="100" height="100" fill="#1f2937"/>
  <polygon points="40,30 40,70 70,50" fill="#4b5563"/>
</svg>
`)}`;

export function MediaThumbnail({
  src,
  alt,
  className,
  ...props
}: Omit<ImageWithFallbackProps, 'fallbackSrc'>) {
  return (
    <ImageWithFallback
      src={src}
      alt={alt}
      fallbackSrc={MEDIA_PLACEHOLDER_SVG}
      className={`media-thumbnail ${className || ''}`.trim()}
      {...props}
    />
  );
}

export default ImageWithFallback;
