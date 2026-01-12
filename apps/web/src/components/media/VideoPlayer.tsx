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
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Extract raw file path (strip URL prefixes if present)
  const rawFilePath = extractFilePath(filePath);

  // Check if this is an audio-only file (no video track)
  const isAudioFile = rawFilePath.includes('/audio/') || rawFilePath.includes('\\audio\\');

  // Load thumbnail poster (skip for audio files - they have no video track)
  useEffect(() => {
    if (isAudioFile) {
      setPosterLoading(false);
      return;
    }

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
        // Don't log 404s - just silently use first frame
      } catch {
        // Thumbnail not available, video will show first frame
      } finally {
        setPosterLoading(false);
      }
    };

    loadThumbnail();
  }, [rawFilePath, isAudioFile]);

  // Load existing transcript if mediaId provided
  useEffect(() => {
    // Reset transcript state immediately when video changes
    setTranscript(null);
    setTranscriptError(null);
    setTranscriptStatus('idle');

    // Abort controller for cancelling requests when video changes
    const abortController = new AbortController();

    const loadTranscript = async () => {
      if (!mediaId) {
        return;
      }

      try {
        setTranscriptStatus('loading');
        const archiveServer = await getArchiveServerUrl();
        if (!archiveServer || abortController.signal.aborted) {
          setTranscriptStatus('idle');
          return;
        }

        const res = await fetch(
          `${archiveServer}/api/facebook/transcription/${mediaId}`,
          { signal: abortController.signal }
        );

        // Check if aborted before processing response
        if (abortController.signal.aborted) return;

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
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('[VideoPlayer] Failed to load transcript:', err);
        setTranscriptStatus('idle');
      }
    };

    loadTranscript();

    // Cleanup: abort pending request when mediaId changes or component unmounts
    return () => {
      abortController.abort();
    };
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
        const errorMsg = data.error || 'Transcription failed';
        // Check for no-audio error cases
        if (errorMsg.includes('convert audio') || errorMsg.includes('no audio') || errorMsg.includes('No audio')) {
          throw new Error('NO_AUDIO');
        }
        throw new Error(errorMsg);
      }

      setTranscript(data.transcript || '');
      setTranscriptStatus('done');
    } catch (err) {
      const errorMsg = (err as Error).message;
      // Special handling for no-audio case
      if (errorMsg === 'NO_AUDIO') {
        setTranscriptError('No audio track in this video');
        setTranscriptStatus('done'); // Use 'done' to hide retry button
        setTranscript(null);
      } else {
        console.error('[VideoPlayer] Transcription error:', err);
        setTranscriptError(errorMsg);
        setTranscriptStatus('error');
      }
    }
  };

  // Copy transcript to clipboard
  const handleCopy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[VideoPlayer] Failed to copy:', err);
    }
  };

  // Download transcript as .txt file
  const handleDownload = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${mediaId || 'video'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

          {/* No audio track message */}
          {transcriptStatus === 'done' && !transcript && transcriptError && (
            <div className="video-player__transcribe-status video-player__transcribe-status--no-audio">
              {transcriptError}
            </div>
          )}

          {transcriptStatus === 'done' && transcript && (
            <div className="video-player__transcript">
              <div className="video-player__transcript-header">
                <div className="video-player__transcript-label">Transcript:</div>
                <div className="video-player__transcript-actions">
                  <button
                    className={`video-player__action-btn ${copied ? 'video-player__action-btn--success' : ''}`}
                    onClick={handleCopy}
                    title="Copy to clipboard"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {copied ? (
                        <polyline points="20 6 9 17 4 12" />
                      ) : (
                        <>
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </>
                      )}
                    </svg>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    className="video-player__action-btn"
                    onClick={handleDownload}
                    title="Download as .txt"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </button>
                </div>
              </div>
              <div className="video-player__transcript-text">{transcript}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
