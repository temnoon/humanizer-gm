/**
 * TranscriptPanel - Floating draggable panel for video transcription
 *
 * Features:
 * - Draggable positioning
 * - Minimize/expand
 * - Copy/download transcript
 * - Transcribe button with loading state
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { getArchiveServerUrl } from '../../lib/platform';
import './TranscriptPanel.css';

interface TranscriptPanelProps {
  /** Media ID for the video */
  mediaId: string;
  /** File path for transcription (fallback if no mediaId) */
  filePath: string;
  /** Callback when panel is closed */
  onClose?: () => void;
}

type TranscriptStatus = 'idle' | 'loading' | 'transcribing' | 'done' | 'error';

export function TranscriptPanel({ mediaId, filePath, onClose }: TranscriptPanelProps) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [status, setStatus] = useState<TranscriptStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Dragging state
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Load existing transcript on mount or when mediaId changes
  useEffect(() => {
    setTranscript(null);
    setError(null);
    setStatus('idle');

    const abortController = new AbortController();

    const loadTranscript = async () => {
      if (!mediaId) return;

      try {
        setStatus('loading');
        const archiveServer = await getArchiveServerUrl();
        if (!archiveServer || abortController.signal.aborted) {
          setStatus('idle');
          return;
        }

        const res = await fetch(
          `${archiveServer}/api/facebook/transcription/${mediaId}`,
          { signal: abortController.signal }
        );

        if (abortController.signal.aborted) return;

        if (res.ok) {
          const data = await res.json();
          if (data.transcript) {
            setTranscript(data.transcript);
            setStatus('done');
          } else {
            setStatus('idle');
          }
        } else {
          setStatus('idle');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('[TranscriptPanel] Failed to load transcript:', err);
        setStatus('idle');
      }
    };

    loadTranscript();

    return () => {
      abortController.abort();
    };
  }, [mediaId]);

  // Transcribe video
  const handleTranscribe = async () => {
    try {
      setStatus('transcribing');
      setError(null);

      const archiveServer = await getArchiveServerUrl();
      if (!archiveServer) {
        throw new Error('Archive server not available');
      }

      const body = mediaId
        ? { mediaId, model: 'ggml-tiny.en.bin' }
        : { path: filePath, model: 'ggml-tiny.en.bin' };

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
      setStatus('done');
    } catch (err) {
      const errorMsg = (err as Error).message;
      // Special handling for no-audio case
      if (errorMsg === 'NO_AUDIO') {
        setError('No audio track in this video');
        setStatus('done'); // Use 'done' to hide retry button
        setTranscript(null);
      } else {
        console.error('[TranscriptPanel] Transcription error:', err);
        setError(errorMsg);
        setStatus('error');
      }
    }
  };

  // Copy transcript
  const handleCopy = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[TranscriptPanel] Failed to copy:', err);
    }
  };

  // Download transcript
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

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={panelRef}
      className={`transcript-panel ${minimized ? 'transcript-panel--minimized' : ''} ${isDragging ? 'transcript-panel--dragging' : ''}`}
      style={{ right: position.x, top: position.y }}
    >
      {/* Header - draggable */}
      <div
        className="transcript-panel__header"
        onMouseDown={handleDragStart}
      >
        <span className="transcript-panel__title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          Transcript
        </span>
        <div className="transcript-panel__controls">
          <button
            className="transcript-panel__btn"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▢' : '—'}
          </button>
          {onClose && (
            <button
              className="transcript-panel__btn transcript-panel__btn--close"
              onClick={onClose}
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {!minimized && (
        <div className="transcript-panel__content">
          {status === 'idle' && (
            <button
              className="transcript-panel__transcribe"
              onClick={handleTranscribe}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Transcribe Audio
            </button>
          )}

          {status === 'loading' && (
            <div className="transcript-panel__status">
              Loading transcript...
            </div>
          )}

          {status === 'transcribing' && (
            <div className="transcript-panel__status transcript-panel__status--processing">
              <span className="transcript-panel__spinner" />
              Transcribing audio...
            </div>
          )}

          {status === 'error' && (
            <div className="transcript-panel__error">
              <span>{error}</span>
              <button onClick={handleTranscribe}>Retry</button>
            </div>
          )}

          {/* No audio track message */}
          {status === 'done' && !transcript && error && (
            <div className="transcript-panel__status transcript-panel__status--no-audio">
              {error}
            </div>
          )}

          {status === 'done' && transcript && (
            <>
              <div className="transcript-panel__actions">
                <button
                  className={copied ? 'transcript-panel__action--success' : ''}
                  onClick={handleCopy}
                  title="Copy to clipboard"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
                <button onClick={handleDownload} title="Download as .txt">
                  Download
                </button>
              </div>
              <div className="transcript-panel__text">
                {transcript}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TranscriptPanel;
