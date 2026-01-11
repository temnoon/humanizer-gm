/**
 * VideoPlayer - Enhanced video player with thumbnail poster
 *
 * Features:
 * - Lazy-loaded thumbnail as poster
 * - HTML5 controls (play, pause, seek, volume, fullscreen)
 * - Error handling with fallback message
 * - Uses Range requests for smooth seeking
 * - Transcription support with whisper
 */

import { useState, useRef, useEffect } from 'react';
import { getArchiveServerUrl } from '../../lib/platform';
import './VideoPlayer.css';

/**
 * Extract raw file path from URL or return as-is if already a raw path
 */
function extractFilePath(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  // Strip local-media://serve prefix if present
  if (pathOrUrl.startsWith('local-media://serve')) {
    return pathOrUrl.replace('local-media://serve', '');
  }
  // Strip http(s) archive server prefix if present
  const httpMatch = pathOrUrl.match(/https?:\/\/[^/]+\/media\/(.+)/);
  if (httpMatch) {
    return decodeURIComponent(httpMatch[1]);
  }
  return pathOrUrl;
}

interface VideoPlayerProps {
  /** Video source URL */
  src: string;
  /** Original file path (for thumbnail generation) */
  filePath: string;
  /** Media ID for transcription lookup */
  mediaId?: string;
  /** Additional CSS class */
  className?: string;
  /** Auto-play video */
  autoPlay?: boolean;
  /** Start muted */
  muted?: boolean;
  /** Show loading state while fetching thumbnail */
  showLoading?: boolean;
  /** Show transcription controls */
  showTranscription?: boolean;
}

export function VideoPlayer({
  src,
  filePath,
  mediaId,
  className,
  autoPlay,
  muted,
  showLoading = true,
  showTranscription = true,
}: VideoPlayerProps) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [posterLoading, setPosterLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'loading' | 'transcribing' | 'done' | 'error'>('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Extract raw file path (strip URL prefixes if present)
  const rawFilePath = extractFilePath(filePath);

  // Load thumbnail poster
  useEffect(() => {
    const loadThumbnail = async () => {
      try {
        setPosterLoading(true);
        const archiveServer = await getArchiveServerUrl();
        if (!archiveServer || !rawFilePath) {
          setPosterLoading(false);
          return;
        }

        const url = `${archiveServer}/api/facebook/video-thumbnail?path=${encodeURIComponent(rawFilePath)}`;

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
  }, [rawFilePath]);

  // Load existing transcript if mediaId provided
  useEffect(() => {
    const loadTranscript = async () => {
      if (!mediaId) return;

      try {
        setTranscriptStatus('loading');
        const archiveServer = await getArchiveServerUrl();
        if (!archiveServer) {
          setTranscriptStatus('idle');
          return;
        }

        const res = await fetch(`${archiveServer}/api/facebook/transcription/${mediaId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.transcript) {
            setTranscript(data.transcript);
            setTranscriptStatus('done');
          } else {
            setTranscriptStatus('idle');
          }
        } else {
          setTranscriptStatus('idle');
        }
      } catch (err) {
        console.warn('[VideoPlayer] Failed to load transcript:', err);
        setTranscriptStatus('idle');
      }
    };

    loadTranscript();
  }, [mediaId]);

  // Transcribe video
  const handleTranscribe = async () => {
    try {
      setTranscriptStatus('transcribing');
      setTranscriptError(null);

      const archiveServer = await getArchiveServerUrl();
      if (!archiveServer) {
        throw new Error('Archive server not available');
      }

      const body = mediaId
        ? { mediaId, model: 'ggml-tiny.en.bin' }
        : { path: rawFilePath, model: 'ggml-tiny.en.bin' };

      const res = await fetch(`${archiveServer}/api/facebook/transcription/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Transcription failed');
      }

      setTranscript(data.transcript || '');
      setTranscriptStatus('done');
    } catch (err) {
      console.error('[VideoPlayer] Transcription error:', err);
      setTranscriptError((err as Error).message);
      setTranscriptStatus('error');
    }
  };

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

      {/* Transcription UI */}
      {showTranscription && (
        <div className="video-player__transcription">
          {transcriptStatus === 'idle' && (
            <button
              className="video-player__transcribe-btn"
              onClick={handleTranscribe}
              title="Transcribe audio"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Transcribe
            </button>
          )}

          {transcriptStatus === 'loading' && (
            <div className="video-player__transcribe-status">
              Loading transcript...
            </div>
          )}

          {transcriptStatus === 'transcribing' && (
            <div className="video-player__transcribe-status video-player__transcribe-status--processing">
              <span className="video-player__spinner" />
              Transcribing audio...
            </div>
          )}

          {transcriptStatus === 'error' && (
            <div className="video-player__transcribe-error">
              <span>{transcriptError}</span>
              <button
                className="video-player__retry-btn"
                onClick={handleTranscribe}
              >
                Retry
              </button>
            </div>
          )}

          {transcriptStatus === 'done' && transcript && (
            <div className="video-player__transcript">
              <div className="video-player__transcript-label">Transcript:</div>
              <div className="video-player__transcript-text">{transcript}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
