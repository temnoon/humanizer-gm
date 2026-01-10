/**
 * VideoPlayer - Enhanced video player with thumbnail poster
 *
 * Features:
 * - Lazy-loaded thumbnail as poster
 * - HTML5 controls (play, pause, seek, volume, fullscreen)
 * - Error handling with fallback message
 * - Uses Range requests for smooth seeking
 */

import { useState, useRef, useEffect } from 'react';
import { getArchiveServerUrl } from '../../lib/platform';
import './VideoPlayer.css';

interface VideoPlayerProps {
  /** Video source URL */
  src: string;
  /** Original file path (for thumbnail generation) */
  filePath: string;
  /** Additional CSS class */
  className?: string;
  /** Auto-play video */
  autoPlay?: boolean;
  /** Start muted */
  muted?: boolean;
  /** Show loading state while fetching thumbnail */
  showLoading?: boolean;
}

export function VideoPlayer({
  src,
  filePath,
  className,
  autoPlay,
  muted,
  showLoading = true,
}: VideoPlayerProps) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterLoading, setPosterLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load thumbnail poster
  useEffect(() => {
    const loadThumbnail = async () => {
      try {
        setPosterLoading(true);
        const archiveServer = await getArchiveServerUrl();
        if (!archiveServer || !filePath) {
          setPosterLoading(false);
          return;
        }

        const url = `${archiveServer}/api/facebook/video-thumbnail?path=${encodeURIComponent(filePath)}`;

        // Verify thumbnail exists via HEAD request
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          setPosterUrl(url);
        }
      } catch (err) {
        // Thumbnail not available, video will show first frame
        console.warn('[VideoPlayer] Failed to load thumbnail:', err);
      } finally {
        setPosterLoading(false);
      }
    };

    loadThumbnail();
  }, [filePath]);

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const mediaError = video.error;

    let errorMessage = 'Video playback error';
    if (mediaError) {
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = 'Video playback was aborted';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error while loading video';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Video format not supported';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Video source not supported';
          break;
      }
    }

    setError(errorMessage);
  };

  if (error) {
    return (
      <div className={`video-player video-player--error ${className || ''}`}>
        <div className="video-player__error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="2" y1="4" x2="22" y2="20" />
          </svg>
        </div>
        <div className="video-player__error-message">{error}</div>
      </div>
    );
  }

  return (
    <div className={`video-player ${className || ''}`}>
      {showLoading && posterLoading && (
        <div className="video-player__loading">Loading...</div>
      )}
      <video
        ref={videoRef}
        className="video-player__video"
        src={src}
        poster={posterUrl || undefined}
        controls
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        preload="metadata"
        onError={handleError}
      />
    </div>
  );
}

export default VideoPlayer;
