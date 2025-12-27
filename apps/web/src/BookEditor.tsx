/**
 * BookEditor - Integrated reader/editor with sentence analysis
 *
 * Features:
 * - Split view: Markdown editor (left) + rendered preview (right)
 * - ⌘E toggle between edit and preview modes
 * - Print to PDF
 * - Theme switching (sepia, light, dark)
 */

import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme, type ResolvedTheme } from './lib/theme';

type ViewMode = 'split' | 'preview' | 'analyze';
type ActivePane = 'editor' | 'preview';
type Theme = ResolvedTheme; // Use the global theme type

// Simplified SentenceMetrics type
interface SentenceMetrics {
  text: string;
  index: number;
  sicScore: number;
  sicLevel: 'low' | 'medium' | 'high';
}

// Simplified Selection Context (inline implementation)
interface SelectionContextValue {
  registerAction: (action: TransformAction) => void;
}

interface TransformAction {
  id: string;
  label: string;
  group?: string;
  shortcut?: string;
  handler: (selection: { text: string }) => Promise<void>;
}

const SelectionContext = createContext<SelectionContextValue>({
  registerAction: () => {},
});

function SelectionProvider({ children }: { children: ReactNode }) {
  const registerAction = useCallback(() => {
    // Placeholder - actions logged but not stored
  }, []);

  return (
    <SelectionContext.Provider value={{ registerAction }}>
      {children}
    </SelectionContext.Provider>
  );
}

function useSelection() {
  return useContext(SelectionContext);
}

// Simplified sentence analysis hook
function useSentenceAnalysis(content: string, _options?: { useLocal?: boolean; debounceMs?: number }) {
  const sentences: SentenceMetrics[] = content
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 10)
    .map((text, index) => ({
      text: text.trim(),
      index,
      sicScore: Math.floor(Math.random() * 100), // Placeholder
      sicLevel: 'medium' as const,
    }));

  return {
    sentences,
    overall: {
      totalSentences: sentences.length,
      avgSicScore: sentences.reduce((a, b) => a + b.sicScore, 0) / Math.max(sentences.length, 1),
    },
  };
}

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

// Transform actions for selection toolbar
const createTransformActions = (
  onTransform: (type: string, selection: string) => Promise<string>
): TransformAction[] => [
  {
    id: 'analyze',
    label: 'Analyze',
    group: 'analyze',
    handler: async (sel) => {
      console.log('Analyze:', sel.text);
    },
  },
  {
    id: 'transform-persona',
    label: 'Apply Persona',
    group: 'transform',
    handler: async (sel) => {
      await onTransform('persona', sel.text);
    },
  },
  {
    id: 'transform-style',
    label: 'Apply Style',
    group: 'transform',
    handler: async (sel) => {
      await onTransform('style', sel.text);
    },
  },
  {
    id: 'regenerate',
    label: 'Regenerate',
    group: 'generate',
    shortcut: '⌘R',
    handler: async (sel) => {
      await onTransform('regenerate', sel.text);
    },
  },
  {
    id: 'expand',
    label: 'Expand',
    group: 'generate',
    handler: async (sel) => {
      await onTransform('expand', sel.text);
    },
  },
  {
    id: 'compress',
    label: 'Compress',
    group: 'transform',
    handler: async (sel) => {
      await onTransform('compress', sel.text);
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

  // Register transform actions
  useEffect(() => {
    const handleTransform = async (type: string, text: string): Promise<string> => {
      setIsTransforming(true);
      try {
        // TODO: Call actual transform API
        console.log(`Transform ${type}:`, text.substring(0, 50));
        // Placeholder - in real implementation, call transform service
        return text;
      } finally {
        setIsTransforming(false);
      }
    };

    const actions = createTransformActions(handleTransform);
    actions.forEach((action) => registerAction(action));
  }, [registerAction]);

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

  // Handle content edit
  const handleContentChange = useCallback(
    (newContent: string) => {
      setEditableContent(newContent);
      onContentChange?.(newContent);
    },
    [onContentChange]
  );

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

        {/* Selection Toolbar - TODO: implement floating toolbar on text selection */}

        {/* Metrics Sidebar - TODO: implement slide-out panel for sentence details */}
        {sidebarOpen && selectedSentence && (
          <div className="book-editor__sidebar">
            <button
              className="book-editor__btn"
              onClick={() => setSidebarOpen(false)}
            >
              Close
            </button>
            <div className="book-editor__sidebar-content">
              <p><strong>Sentence:</strong> {selectedSentence.text.substring(0, 100)}...</p>
              <p><strong>SIC Score:</strong> {selectedSentence.sicScore}</p>
            </div>
          </div>
        )}
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
