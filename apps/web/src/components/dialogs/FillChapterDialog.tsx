/**
 * FillChapterDialog - Options dialog for filling a chapter with generated content
 *
 * Allows user to configure:
 * - Writing style (academic, narrative, conversational)
 * - Target word count
 * - Additional search queries
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './FillChapterDialog.css';

export interface FillChapterOptions {
  style: 'academic' | 'narrative' | 'conversational';
  targetWords: number;
  additionalQueries: string[];
}

export interface FillChapterDialogProps {
  isOpen: boolean;
  chapter: { id: string; title: string; bookId: string } | null;
  onClose: () => void;
  onFill: (options: FillChapterOptions) => Promise<void>;
}

export function FillChapterDialog({
  isOpen,
  chapter,
  onClose,
  onFill,
}: FillChapterDialogProps) {
  const [style, setStyle] = useState<FillChapterOptions['style']>('academic');
  const [targetWords, setTargetWords] = useState(500);
  const [queries, setQueries] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate suggested queries from title
  const suggestedQueries = useMemo(() => {
    if (!chapter) return [];
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'as']);
    return chapter.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w));
  }, [chapter]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStyle('academic');
      setTargetWords(500);
      setQueries('');
      setError(null);
      setIsGenerating(false);
    }
  }, [isOpen]);

  // Handle keyboard
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isGenerating) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isGenerating, onClose]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);

    try {
      await onFill({
        style,
        targetWords,
        additionalQueries: queries
          .split('\n')
          .map(q => q.trim())
          .filter(q => q.length > 0),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [style, targetWords, queries, onFill, onClose]);

  if (!isOpen || !chapter) return null;

  // Use portal to render at document.body level, bypassing any parent CSS containment
  return createPortal(
    <div className="fill-dialog__overlay" onClick={isGenerating ? undefined : onClose}>
      <div
        className="fill-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fill-dialog-title"
      >
        <header className="fill-dialog__header">
          <h3 id="fill-dialog-title">Fill Chapter</h3>
          <span className="fill-dialog__chapter-title">{chapter.title}</span>
        </header>

        <div className="fill-dialog__content">
          {error && (
            <div className="fill-dialog__error">
              {error}
            </div>
          )}

          <div className="fill-dialog__field">
            <label htmlFor="fill-style">Writing Style</label>
            <select
              id="fill-style"
              value={style}
              onChange={(e) => setStyle(e.target.value as FillChapterOptions['style'])}
              disabled={isGenerating}
            >
              <option value="academic">Academic - Clear definitions, structured arguments</option>
              <option value="narrative">Narrative - Story of intellectual discovery</option>
              <option value="conversational">Conversational - Approachable, friendly tone</option>
            </select>
          </div>

          <div className="fill-dialog__field">
            <label htmlFor="fill-words">
              Target Length: <strong>{targetWords}</strong> words
            </label>
            <input
              id="fill-words"
              type="range"
              min={300}
              max={1000}
              step={100}
              value={targetWords}
              onChange={(e) => setTargetWords(Number(e.target.value))}
              disabled={isGenerating}
            />
            <div className="fill-dialog__range-labels">
              <span>300</span>
              <span>1000</span>
            </div>
          </div>

          <div className="fill-dialog__field">
            <label htmlFor="fill-queries">
              Search Queries <span className="fill-dialog__optional">(optional)</span>
            </label>
            <textarea
              id="fill-queries"
              value={queries}
              onChange={(e) => setQueries(e.target.value)}
              placeholder={suggestedQueries.length > 0
                ? `Suggested:\n${suggestedQueries.join('\n')}`
                : 'One query per line...'
              }
              rows={4}
              disabled={isGenerating}
            />
            <small className="fill-dialog__help">
              Leave empty to auto-generate from chapter title
            </small>
          </div>
        </div>

        <footer className="fill-dialog__footer">
          <button
            type="button"
            className="fill-dialog__btn"
            onClick={onClose}
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fill-dialog__btn fill-dialog__btn--primary"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="fill-dialog__spinner" />
                Generating...
              </>
            ) : (
              'Generate Chapter'
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
