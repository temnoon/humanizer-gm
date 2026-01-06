/**
 * BookContentView - Main workspace view for book project content
 *
 * Displays book content (chapters, passages, thinking) in the main workspace pane
 * with full editing capabilities and marginalia support.
 */

import { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { useBookshelf } from '../../lib/bookshelf';
import type {
  BookProject,
  DraftChapter,
  DraftVersion,
  SourcePassage,
  Marginalia,
} from '../archive/book-project/types';

// ============================================
// Types
// ============================================

export type BookContentType = 'chapter' | 'passage' | 'thinking';

export interface BookContent {
  type: BookContentType;
  title: string;
  content: string;
  marginalia?: Marginalia[];
  source: {
    bookProjectId: string;
    projectName: string;
    itemId: string;
  };
  // Original data for editing
  chapter?: DraftChapter;
  passage?: SourcePassage;
}

interface BookContentViewProps {
  content: BookContent;
  project: BookProject;
  onEdit?: (content: string) => void;
  onBranch?: () => void;
  onAddPassage?: () => void;
  onClose: () => void;
}

// ============================================
// Main Component
// ============================================

export function BookContentView({
  content,
  project: _project,
  onEdit,
  onBranch,
  onAddPassage,
  onClose,
}: BookContentViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content.content);
  const [showMarginalia, setShowMarginalia] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  // Bookshelf context for persistence (unified storage)
  const bookshelf = useBookshelf();

  // Update editContent when content changes (e.g., from version revert)
  useEffect(() => {
    setEditContent(content.content);
  }, [content.content]);

  // Handle save with persistence
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');

    // Use bookshelf context to save if we have a chapter
    if (content.type === 'chapter' && content.source.itemId) {
      await bookshelf.updateChapterSimple(
        content.source.itemId,
        editContent,
        `Manual save`
      );
    }

    // Also call legacy onEdit callback
    onEdit?.(editContent);

    setIsEditing(false);
    setSaveStatus('saved');

    // Reset status after 2 seconds
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [editContent, onEdit, bookshelf, content.type, content.source.itemId]);

  const handleCancel = useCallback(() => {
    setEditContent(content.content);
    setIsEditing(false);
  }, [content.content]);

  // Handle version selection
  const handleVersionSelect = useCallback((version: DraftVersion) => {
    setSelectedVersion(version.version);
    setEditContent(version.content);
  }, []);

  // Revert to selected version
  const handleRevertToVersion = useCallback(async () => {
    if (selectedVersion && content.source.itemId) {
      await bookshelf.revertToVersionSimple(content.source.itemId, selectedVersion);
      setSelectedVersion(null);
    }
  }, [selectedVersion, content.source.itemId, bookshelf]);

  // Delete a version (not yet implemented in Xanadu - logs warning)
  const handleDeleteVersion = useCallback((version: number) => {
    if (content.source.itemId && window.confirm(`Delete version ${version}? This cannot be undone.`)) {
      // TODO: Add deleteVersion to BookshelfContext when Xanadu IPC supports it
      console.warn('[BookContentView] deleteVersion not yet implemented in unified storage');
      if (selectedVersion === version) {
        setSelectedVersion(null);
      }
    }
  }, [content.source.itemId, selectedVersion]);

  // Writer notes state
  const [writerNotes, setWriterNotes] = useState(content.chapter?.writerNotes || '');
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Save writer notes
  const handleSaveNotes = useCallback(async () => {
    if (content.source.itemId) {
      await bookshelf.updateWriterNotesSimple(content.source.itemId, writerNotes);
    }
  }, [content.source.itemId, writerNotes, bookshelf]);

  // Sync writerNotes state when content changes
  useEffect(() => {
    setWriterNotes(content.chapter?.writerNotes || '');
  }, [content.chapter?.writerNotes]);

  const typeIcons: Record<BookContentType, string> = {
    chapter: '📝',
    passage: '📄',
    thinking: '🧠',
  };

  return (
    <div className="book-content-view">
      {/* Header with actions */}
      <header className="book-content-view__header">
        <div className="book-content-view__header-left">
          <button
            className="book-content-view__back"
            onClick={onClose}
            title="Back to workspace"
          >
            ←
          </button>
          <div className="book-content-view__title-group">
            <span className="book-content-view__type-badge">
              {typeIcons[content.type]} {content.type}
            </span>
            <h1 className="book-content-view__title">{content.title}</h1>
            <span className="book-content-view__project">
              from {content.source.projectName}
            </span>
            {content.chapter && (
              <span className="book-content-view__version-badge">
                v{content.chapter.version}
              </span>
            )}
            {saveStatus === 'saving' && (
              <span className="book-content-view__save-status book-content-view__save-status--saving">
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="book-content-view__save-status book-content-view__save-status--saved">
                Saved
              </span>
            )}
          </div>
        </div>
        <div className="book-content-view__actions">
          {!isEditing ? (
            <>
              <button
                className="book-content-view__action"
                onClick={() => setIsEditing(true)}
              >
                ✏️ Edit
              </button>
              {onBranch && (
                <button
                  className="book-content-view__action"
                  onClick={onBranch}
                >
                  🔀 Branch
                </button>
              )}
              {onAddPassage && content.type === 'chapter' && (
                <button
                  className="book-content-view__action book-content-view__action--primary"
                  onClick={onAddPassage}
                >
                  + Add Passage
                </button>
              )}
              {content.marginalia && content.marginalia.length > 0 && (
                <button
                  className={`book-content-view__action ${showMarginalia ? 'book-content-view__action--active' : ''}`}
                  onClick={() => setShowMarginalia(!showMarginalia)}
                >
                  📝 Notes ({content.marginalia.length})
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="book-content-view__action book-content-view__action--primary"
                onClick={handleSave}
              >
                ✓ Save
              </button>
              <button
                className="book-content-view__action"
                onClick={handleCancel}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main content area */}
      <div className={`book-content-view__body ${showMarginalia && content.marginalia?.length ? 'book-content-view__body--with-marginalia' : ''}`}>
        {/* Content pane */}
        <div className="book-content-view__content">
          {isEditing ? (
            <textarea
              className="book-content-view__editor"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Write your content here..."
              autoFocus
            />
          ) : (
            <article className="book-content-view__article">
              {content.chapter?.epigraph && (
                <blockquote className="book-content-view__epigraph">
                  <p>{content.chapter.epigraph.text}</p>
                  {content.chapter.epigraph.source && (
                    <footer>— {content.chapter.epigraph.source}</footer>
                  )}
                </blockquote>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[[rehypeKatex, { strict: false, trust: true }]]}
              >
                {content.content}
              </ReactMarkdown>
            </article>
          )}
        </div>

        {/* Marginalia sidebar */}
        {showMarginalia && content.marginalia && content.marginalia.length > 0 && (
          <aside className="book-content-view__marginalia">
            <h3 className="book-content-view__marginalia-title">Marginalia</h3>
            {content.marginalia.map((note) => (
              <MarginaliaNote key={note.id} note={note} />
            ))}
          </aside>
        )}
      </div>

      {/* Metadata panel (collapsible) */}
      {content.chapter && (
        <details className="book-content-view__metadata">
          <summary>
            Chapter Metadata
            <span className="book-content-view__metadata-stats">
              v{content.chapter.version ?? 1} · {(content.chapter.wordCount ?? content.chapter.versions?.[0]?.content?.split(/\s+/).length ?? 0).toLocaleString()} words · {content.chapter.status ?? 'draft'}
            </span>
          </summary>
          <div className="book-content-view__metadata-content">
            <div className="book-content-view__metadata-section">
              <h4>Version History</h4>
              {(content.chapter.versions?.length ?? 0) > 0 ? (
                <ul className="book-content-view__version-list">
                  {content.chapter.versions.slice().reverse().map((v, idx) => {
                    const versionNum = v.version ?? idx + 1;
                    const versionId = v.version ?? idx;
                    const timestamp = v.timestamp ?? Date.now();
                    const author = v.createdBy ?? 'Unknown';
                    return (
                      <li
                        key={versionId}
                        className={`book-content-view__version-item ${selectedVersion === versionNum ? 'book-content-view__version-item--selected' : ''} ${versionNum === (content.chapter?.version ?? 1) ? 'book-content-view__version-item--current' : ''}`}
                        onClick={() => handleVersionSelect(v)}
                      >
                        <span className="book-content-view__version-number">
                          v{versionNum}
                          {versionNum === (content.chapter?.version ?? 1) && ' (current)'}
                        </span>
                        <span className="book-content-view__version-changes">{v.changes ?? 'No changes recorded'}</span>
                        <span className="book-content-view__version-meta">
                          {new Date(timestamp).toLocaleDateString()} · {author}
                        </span>
                        <div className="book-content-view__version-actions">
                          {selectedVersion === versionNum && versionNum !== (content.chapter?.version ?? 1) && (
                            <button
                              className="book-content-view__version-revert"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevertToVersion();
                              }}
                            >
                              Revert
                            </button>
                          )}
                          {versionNum !== (content.chapter?.version ?? 1) && (
                            <button
                              className="book-content-view__version-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteVersion(versionNum);
                              }}
                              title="Delete this version"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="book-content-view__metadata-empty">No version history yet</p>
              )}
            </div>
            {content.chapter.sections?.length > 0 && (
              <div className="book-content-view__metadata-section">
                <h4>Sections</h4>
                <ul className="book-content-view__section-list">
                  {content.chapter.sections.map((section) => (
                    <li key={section.id}>
                      {section.title || `Section (lines ${section.startLine}-${section.endLine})`}
                      {section.passageIds.length > 0 && (
                        <span className="book-content-view__section-passages">
                          ({section.passageIds.length} passages)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Writer Notes - production notes not included in final output */}
            <div className="book-content-view__metadata-section">
              <h4>
                Writer Notes
                <span className="book-content-view__notes-hint">(not included in output)</span>
              </h4>
              <textarea
                className="book-content-view__notes-input"
                placeholder="Add production notes here..."
                value={writerNotes}
                onChange={(e) => setWriterNotes(e.target.value)}
                onBlur={handleSaveNotes}
                rows={3}
              />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// ============================================
// Marginalia Note Component
// ============================================

interface MarginaliaNoteProp {
  note: Marginalia;
}

function MarginaliaNote({ note }: MarginaliaNoteProp) {
  const typeIcons: Record<string, string> = {
    commentary: '📝',
    reference: '📚',
    question: '❓',
    connection: '🔗',
    todo: '☐',
  };

  return (
    <div className={`marginalia-note marginalia-note--${note.type}`}>
      <div className="marginalia-note__header">
        <span className="marginalia-note__icon">{typeIcons[note.type] || '📝'}</span>
        <span className="marginalia-note__type">{note.type}</span>
      </div>
      <div className="marginalia-note__content">{note.text}</div>
      {note.passageId && (
        <div className="marginalia-note__source">
          From passage: {note.passageId}
        </div>
      )}
    </div>
  );
}

export default BookContentView;
