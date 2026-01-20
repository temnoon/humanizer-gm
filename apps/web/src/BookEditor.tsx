/**
 * BookEditor - Integrated reader/editor with sentence analysis
 *
 * Features:
 * - Split view: Markdown editor (left) + rendered preview (right)
 * - ⌘E toggle between edit and preview modes
 * - Print to PDF
 * - Theme switching (sepia, light, dark)
 * - Selection toolbar for text transformations
 * - Metrics sidebar for sentence analysis
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme, type ResolvedTheme } from './lib/theme';

// Import real UI components from packages/ui
import {
  // Selection system
  SelectionProvider,
  SelectionToolbar,
  useSelection,
  type TransformAction,
  // Sentence analysis
  useSentenceAnalysis,
  MetricsSidebar,
  type SentenceMetrics,
} from '@humanizer/ui';

// Import transform service for real API calls
import {
  transformPersona,
  transformStyle,
  humanize,
  analyzeSentences as analyzeWithApi,
} from './lib/transform/service';

type ViewMode = 'split' | 'preview' | 'analyze';
type ActivePane = 'editor' | 'preview';
type Theme = ResolvedTheme; // Use the global theme type

interface BookEditorProps {
  /** Initial content (markdown) */
  content?: string;
  /** Book title */
  title?: string;
  /** Called when content changes */
  onContentChange?: (content: string) => void;
  /** Called to close */
  onClose?: () => void;
  /** Enable editing */
  editable?: boolean;
}

/**
 * Transform handler type for updating content
 */
type TransformHandler = (
  type: 'persona' | 'style' | 'humanize' | 'analyze',
  originalText: string,
  transformedText: string
) => void;

/**
 * Create transform actions that call the real transform API
 */
const createTransformActions = (
  onTransformComplete: TransformHandler,
  onAnalyze: (text: string) => void,
  setTransforming: (isTransforming: boolean) => void
): TransformAction[] => [
  {
    id: 'analyze',
    label: 'Analyze',
    group: 'analyze',
    handler: async (sel) => {
      onAnalyze(sel.text);
    },
  },
  {
    id: 'transform-persona',
    label: 'Apply Persona',
    group: 'transform',
    handler: async (sel) => {
      setTransforming(true);
      try {
        // Use default persona for now - could show picker
        const result = await transformPersona(sel.text, 'Conversational');
        onTransformComplete('persona', sel.text, result.transformed);
      } catch (err) {
        console.error('[BookEditor] Persona transform failed:', err);
      } finally {
        setTransforming(false);
      }
    },
  },
  {
    id: 'transform-style',
    label: 'Apply Style',
    group: 'transform',
    handler: async (sel) => {
      setTransforming(true);
      try {
        // Use default style for now - could show picker
        const result = await transformStyle(sel.text, 'Concise');
        onTransformComplete('style', sel.text, result.transformed);
      } catch (err) {
        console.error('[BookEditor] Style transform failed:', err);
      } finally {
        setTransforming(false);
      }
    },
  },
  {
    id: 'humanize',
    label: 'Humanize',
    group: 'transform',
    shortcut: '⌘H',
    handler: async (sel) => {
      setTransforming(true);
      try {
        const result = await humanize(sel.text, { intensity: 'moderate' });
        onTransformComplete('humanize', sel.text, result.transformed);
      } catch (err) {
        console.error('[BookEditor] Humanize failed:', err);
      } finally {
        setTransforming(false);
      }
    },
  },
  {
    id: 'expand',
    label: 'Expand',
    group: 'generate',
    handler: async (sel) => {
      setTransforming(true);
      try {
        const result = await transformStyle(sel.text, 'Elaborate');
        onTransformComplete('style', sel.text, result.transformed);
      } catch (err) {
        console.error('[BookEditor] Expand failed:', err);
      } finally {
        setTransforming(false);
      }
    },
  },
  {
    id: 'compress',
    label: 'Compress',
    group: 'transform',
    handler: async (sel) => {
      setTransforming(true);
      try {
        const result = await transformStyle(sel.text, 'Concise');
        onTransformComplete('style', sel.text, result.transformed);
      } catch (err) {
        console.error('[BookEditor] Compress failed:', err);
      } finally {
        setTransforming(false);
      }
    },
  },
];

/**
 * Inner editor component (needs SelectionProvider context)
 */
function BookEditorInner({
  content,
  title,
  onContentChange,
  onClose,
  editable = true,
}: BookEditorProps & { content: string }) {
  const [editableContent, setEditableContent] = useState(content);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [activePane, setActivePane] = useState<ActivePane>('preview');

  // Integrate with global theme context
  const { resolved: globalTheme, setMode: setGlobalMode } = useTheme();
  const [localThemeOverride, setLocalThemeOverride] = useState<Theme | null>(null);

  // Use local override if set, otherwise follow global theme
  const theme = localThemeOverride ?? globalTheme;

  // When global theme changes and no local override, update display
  useEffect(() => {
    if (localThemeOverride === null) {
      // Auto-sync with global theme
    }
  }, [globalTheme, localThemeOverride]);

  // Theme setter that can propagate to global or stay local
  const setTheme = useCallback((newTheme: Theme) => {
    // Set local override and also update global theme
    setLocalThemeOverride(newTheme);
    setGlobalMode(newTheme);
  }, [setGlobalMode]);

  const [fontSize, setFontSize] = useState(18);
  const [showControls, setShowControls] = useState(true);
  const [selectedSentence, setSelectedSentence] = useState<SentenceMetrics | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isTransforming, setIsTransforming] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Sentence analysis
  const analysis = useSentenceAnalysis(editableContent, {
    useLocal: true,
    debounceMs: 500,
  });

  // Selection context
  const { registerAction } = useSelection();

  // Handle content edit
  const handleContentChange = useCallback(
    (newContent: string) => {
      setEditableContent(newContent);
      onContentChange?.(newContent);
    },
    [onContentChange]
  );

  // Handle transform completion - replace selected text with transformed text
  const handleTransformComplete: TransformHandler = useCallback(
    (type, originalText, transformedText) => {
      // Replace the original text in the content with the transformed text
      setEditableContent((currentContent) => {
        const newContent = currentContent.replace(originalText, transformedText);
        onContentChange?.(newContent);
        return newContent;
      });
      console.log(`[BookEditor] ${type} transform complete:`, transformedText.substring(0, 50));
    },
    [onContentChange]
  );

  // Handle analyze request - open sidebar with sentence analysis
  const handleAnalyzeRequest = useCallback((text: string) => {
    // Find the sentence in the analysis results
    const matchingSentence = analysis.sentences.find(s => s.text.includes(text) || text.includes(s.text));
    if (matchingSentence) {
      setSelectedSentence(matchingSentence);
      setSidebarOpen(true);
    } else {
      // If no exact match, switch to analyze mode
      console.log('[BookEditor] Analyzing selection:', text.substring(0, 50));
      setViewMode('analyze');
    }
  }, [analysis.sentences]);

  // Register transform actions
  useEffect(() => {
    const actions = createTransformActions(
      handleTransformComplete,
      handleAnalyzeRequest,
      setIsTransforming
    );
    actions.forEach((action) => registerAction(action));
  }, [registerAction, handleTransformComplete, handleAnalyzeRequest]);

  // ⌘E keyboard shortcut to toggle edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        toggleEditMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

  // Toggle between split and preview modes
  const toggleEditMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === 'analyze') return 'split'; // Exit analyze to split
      return prev === 'split' ? 'preview' : 'split';
    });
    if (viewMode === 'preview') {
      // Switching to split - focus editor
      setTimeout(() => editorRef.current?.focus(), 0);
      setActivePane('editor');
    } else {
      setActivePane('preview');
    }
  }, [viewMode]);

  // Auto-hide controls in preview mode
  useEffect(() => {
    if (viewMode !== 'preview') return;

    let timeout: ReturnType<typeof setTimeout>;
    const handleMove = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    window.addEventListener('mousemove', handleMove);
    handleMove();

    return () => {
      window.removeEventListener('mousemove', handleMove);
      clearTimeout(timeout);
    };
  }, [viewMode]);

  // Handle sentence click
  const handleSentenceClick = useCallback((sentence: SentenceMetrics) => {
    setSelectedSentence(sentence);
    setSidebarOpen(true);
  }, []);

  // Print to PDF - uses CSS variables resolved to current theme
  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // Get computed CSS variable values from current theme
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor = computedStyle.getPropertyValue('--color-text-primary').trim() || '#333';
    const accentColor = computedStyle.getPropertyValue('--color-primary').trim() || '#666';
    const borderColor = computedStyle.getPropertyValue('--color-border-subtle').trim() || '#ccc';
    const bgColor = computedStyle.getPropertyValue('--color-surface-primary').trim() || '#fff';

    const styles = `
      <style>
        @page { margin: 1in; }
        body {
          font-family: Georgia, serif;
          font-size: 12pt;
          line-height: 1.6;
          max-width: 6in;
          margin: 0 auto;
          color: ${textColor};
          background-color: ${bgColor};
        }
        h1 { font-size: 24pt; margin-top: 0; }
        h2 { font-size: 18pt; margin-top: 1.5em; }
        h3 { font-size: 14pt; margin-top: 1.2em; }
        blockquote {
          margin: 1em 0;
          padding-left: 1em;
          border-left: 3px solid ${accentColor};
          font-style: italic;
        }
        hr { border: none; border-top: 1px solid ${borderColor}; margin: 2em 0; }
        @media print {
          body {
            color: ${textColor};
            background-color: white; /* Force white background for print */
          }
        }
      </style>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title || 'Book'}</title>
          ${styles}
        </head>
        <body>
          ${contentRef.current?.innerHTML || ''}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  }, [title]);

  // Toggle analyze mode
  const toggleAnalyzeMode = useCallback(() => {
    setViewMode((prev) => (prev === 'analyze' ? 'preview' : 'analyze'));
  }, []);

  const controlsClass = `book-editor__controls ${
    showControls || viewMode !== 'preview' ? '' : 'book-editor__controls--hidden'
  }`;

  const splitViewClass = `book-editor__split-view ${
    viewMode === 'preview' ? 'book-editor__split-view--preview-only' : ''
  }`;

  return (
    <div className={`book-editor book-editor--${theme}`} data-mode={viewMode}>
      {/* Top Controls */}
      <div className={controlsClass}>
        <div className="book-editor__controls-left">
          {onClose && (
            <button className="book-editor__btn" onClick={onClose}>
              ← Back
            </button>
          )}
          {editable && (
            <div className="book-editor__mode-toggle">
              <button
                className={`book-editor__btn ${viewMode === 'preview' ? 'book-editor__btn--active' : ''}`}
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
              <button
                className={`book-editor__btn ${viewMode === 'split' ? 'book-editor__btn--active' : ''}`}
                onClick={() => {
                  setViewMode('split');
                  setTimeout(() => editorRef.current?.focus(), 0);
                }}
              >
                Split
              </button>
              <button
                className={`book-editor__btn ${viewMode === 'analyze' ? 'book-editor__btn--active' : ''}`}
                onClick={toggleAnalyzeMode}
              >
                Analyze
              </button>
            </div>
          )}
        </div>

        <div className="book-editor__controls-center">
          {title && <span className="book-editor__title">{title}</span>}
          {viewMode === 'analyze' && (
            <span className="book-editor__analysis-badge">
              {analysis.overall.totalSentences} sentences •
              Avg SIC: {analysis.overall.avgSicScore.toFixed(0)}
            </span>
          )}
        </div>

        <div className="book-editor__controls-right">
          <button className="book-editor__btn" onClick={handlePrint} title="Print / PDF">
            🖨️
          </button>
          <button
            className="book-editor__btn"
            onClick={() => setFontSize((f) => Math.max(14, f - 2))}
          >
            A−
          </button>
          <button
            className="book-editor__btn"
            onClick={() => setFontSize((f) => Math.min(28, f + 2))}
          >
            A+
          </button>
          <select
            className="book-editor__select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="sepia">Sepia</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      {/* Main Content Area - Split View */}
      <div className="book-editor__main">
        {viewMode === 'analyze' ? (
          // Analyze mode: sentence highlighting
          <div
            ref={contentRef}
            className="book-editor__content"
            style={{ fontSize: `${fontSize}px` }}
          >
            <article className="book-editor__article">
              <AnalyzableContent
                content={editableContent}
                sentences={analysis.sentences}
                onSentenceClick={handleSentenceClick}
              />
            </article>
          </div>
        ) : (
          // Split or Preview mode
          <div className={splitViewClass}>
            {/* Editor Pane (Left) */}
            <div
              className={`book-editor__editor-pane ${
                activePane === 'editor' ? 'book-editor__pane--active' : ''
              }`}
              onFocus={() => setActivePane('editor')}
            >
              <textarea
                ref={editorRef}
                className="book-editor__markdown-input"
                value={editableContent}
                onChange={(e) => handleContentChange(e.target.value)}
                style={{ fontSize: `${fontSize}px` }}
                placeholder="Write your markdown here..."
                aria-label="Markdown editor"
              />
            </div>

            {/* Divider */}
            <div
              className="book-editor__divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panes"
            />

            {/* Preview Pane (Right) */}
            <div
              ref={contentRef}
              className={`book-editor__preview-pane ${
                activePane === 'preview' ? 'book-editor__pane--active' : ''
              }`}
              onFocus={() => setActivePane('preview')}
              style={{ fontSize: `${fontSize}px` }}
            >
              <div className="book-editor__content">
                <article className="book-editor__article">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editableContent}
                  </ReactMarkdown>
                </article>
              </div>
            </div>
          </div>
        )}

        {/* Selection Toolbar - floating toolbar on text selection */}
        <SelectionToolbar showMenu={true} />

        {/* Metrics Sidebar - slide-out panel for sentence analysis */}
        <MetricsSidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          metrics={selectedSentence}
          showPosition={true}
          showCraft={true}
        />
      </div>

      {/* Floating Edit Toggle (⌘E) */}
      {editable && viewMode !== 'analyze' && (
        <button
          className="book-editor__mode-toggle-floating"
          onClick={toggleEditMode}
          aria-label={viewMode === 'split' ? 'Hide editor' : 'Show editor'}
        >
          <span>{viewMode === 'split' ? 'Preview' : 'Edit'}</span>
          <kbd>⌘E</kbd>
        </button>
      )}

      {/* Transform loading indicator */}
      {isTransforming && (
        <div className="book-editor__loading">
          <span>Transforming...</span>
        </div>
      )}
    </div>
  );
}

/**
 * Analyzable content renderer with sentence highlighting
 */
function AnalyzableContent({
  content,
  sentences,
  onSentenceClick,
}: {
  content: string;
  sentences: SentenceMetrics[];
  onSentenceClick: (sentence: SentenceMetrics) => void;
}) {
  // For now, render markdown with click handling on paragraphs
  // Full sentence-level highlighting would require custom markdown renderer
  return (
    <div className="book-editor__analyzable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children, ...props }) => (
            <p
              {...props}
              className="book-editor__paragraph book-editor__paragraph--analyzable"
              onClick={() => {
                // Find matching sentence
                const text = String(children);
                const match = sentences.find((s) => text.includes(s.text));
                if (match) onSentenceClick(match);
              }}
            >
              {children}
            </p>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              {...props}
              className="book-editor__blockquote book-editor__blockquote--analyzable"
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {/* Analysis summary */}
      <div className="book-editor__analysis-summary">
        <h4>Sentence Analysis</h4>
        <div className="book-editor__sentences-list">
          {sentences.slice(0, 20).map((s, i) => (
            <div
              key={i}
              className={`book-editor__sentence-item book-editor__sentence-item--${s.sicLevel}`}
              onClick={() => onSentenceClick(s)}
            >
              <span className="book-editor__sentence-index">#{i + 1}</span>
              <span className="book-editor__sentence-text">{s.text.substring(0, 80)}...</span>
              <span className="book-editor__sentence-score">{s.sicScore}</span>
            </div>
          ))}
          {sentences.length > 20 && (
            <div className="book-editor__sentences-more">
              +{sentences.length - 20} more sentences
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Main BookEditor with SelectionProvider wrapper
 */
export function BookEditor(props: BookEditorProps) {
  const content = props.content || '';

  return (
    <SelectionProvider>
      <BookEditorInner {...props} content={content} />
    </SelectionProvider>
  );
}

export default BookEditor;
