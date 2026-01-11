/**
 * BookProjectDetail - Comprehensive view of a book project
 *
 * Provides access to:
 * - Sources: Raw conversations and passages from archives
 * - Thinking: Curator context, decisions, AUI notes
 * - Drafts: Chapter content in markdown with JSON metadata
 */

import { useState, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import type {
  BookProject,
  BookProjectTab,
  BookProjectViewState,
  SourcePassage,
  CurationStatus,
} from './types';
import type { PyramidStructure } from '@humanizer/core';
import { BookProfileView } from './BookProfileView';

// Configure DOMPurify for markdown HTML rendering
const sanitizeMarkdown = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'blockquote', 'hr', 'br', 'ul', 'ol', 'li', 'a', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'class', 'target', 'rel'],
  });

// PyramidViewer is used within BookProfileView for detailed pyramid navigation
export { PyramidViewer } from './PyramidViewer';

// ============================================
// Props & State
// ============================================

interface BookProjectDetailProps {
  project: BookProject;
  onBack: () => void;
  onPassageClick?: (passage: SourcePassage) => void;
  onPassageStatusChange?: (passageId: string, status: CurationStatus) => void;
  onDraftEdit?: (chapterId: string, content: string) => void;
  onAddAUINote?: (note: string, relatedTo?: { type: string; id: string }) => void;
  onPyramidUpdate?: (pyramid: PyramidStructure) => void;
}

const DEFAULT_VIEW_STATE: BookProjectViewState = {
  activeTab: 'sources',
  sourcesFilter: {
    thread: 'all',
    status: 'all',
    showConversations: true,
  },
  expandedConversations: new Set(),
  thinkingFilter: {
    decisionType: 'all',
  },
  editMode: false,
  showVersionHistory: false,
  pyramidView: {
    selectedLevel: 0,
    expandedNodes: new Set(),
  },
};

// ============================================
// Main Component
// ============================================

export function BookProjectDetail({
  project,
  onBack,
  onPassageClick,
  onPassageStatusChange,
  onDraftEdit,
  onAddAUINote,
  onPyramidUpdate,
}: BookProjectDetailProps) {
  const [viewState, setViewState] = useState<BookProjectViewState>(DEFAULT_VIEW_STATE);

  const setActiveTab = useCallback((tab: BookProjectTab) => {
    setViewState(prev => ({ ...prev, activeTab: tab }));
  }, []);

  const statusColors: Record<string, string> = {
    harvesting: 'var(--color-status-info, #3b82f6)',
    curating: 'var(--color-status-warning, #f59e0b)',
    drafting: 'var(--color-primary, #6366f1)',
    mastering: 'var(--color-status-success, #22c55e)',
    complete: 'var(--color-status-success, #22c55e)',
  };

  return (
    <div className="book-project">
      {/* Header */}
      <header className="book-project__header">
        <button className="book-project__back" onClick={onBack}>
          ← Back
        </button>
        <div className="book-project__title-group">
          <h1 className="book-project__title">{project.name}</h1>
          {project.subtitle && (
            <span className="book-project__subtitle">{project.subtitle}</span>
          )}
        </div>
        <span
          className="book-project__status"
          style={{ backgroundColor: statusColors[project.status] }}
        >
          {project.status}
        </span>
      </header>

      {/* Stats bar */}
      <div className="book-project__stats">
        <span>{project.stats.totalSources || project.stats.totalConversations || 0} sources</span>
        <span>{project.stats.totalPassages} passages</span>
        <span>{project.stats.gems} gems</span>
        <span>{project.stats.chapters} chapters</span>
        <span>{project.stats.wordCount.toLocaleString()} words</span>
      </div>

      {/* Tab navigation */}
      <nav className="book-project__tabs">
        <button
          className={`book-project__tab ${viewState.activeTab === 'sources' ? 'active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          <span className="tab-icon">📚</span>
          Sources
        </button>
        <button
          className={`book-project__tab ${viewState.activeTab === 'thinking' ? 'active' : ''}`}
          onClick={() => setActiveTab('thinking')}
        >
          <span className="tab-icon">🧠</span>
          Thinking
        </button>
        <button
          className={`book-project__tab ${viewState.activeTab === 'drafts' ? 'active' : ''}`}
          onClick={() => setActiveTab('drafts')}
        >
          <span className="tab-icon">📝</span>
          Drafts
        </button>
        <button
          className={`book-project__tab ${viewState.activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span className="tab-icon">📊</span>
          Profile
        </button>
      </nav>

      {/* Tab content */}
      <div className="book-project__content">
        {viewState.activeTab === 'sources' && (
          <SourcesTab
            project={project}
            viewState={viewState}
            setViewState={setViewState}
            onPassageClick={onPassageClick}
            onPassageStatusChange={onPassageStatusChange}
          />
        )}
        {viewState.activeTab === 'thinking' && (
          <ThinkingTab
            project={project}
            viewState={viewState}
            setViewState={setViewState}
            onAddAUINote={onAddAUINote}
          />
        )}
        {viewState.activeTab === 'drafts' && (
          <DraftsTab
            project={project}
            viewState={viewState}
            setViewState={setViewState}
            onDraftEdit={onDraftEdit}
          />
        )}
        {viewState.activeTab === 'profile' && (
          <BookProfileView
            project={project}
            viewState={viewState}
            setViewState={setViewState}
            onBuildPyramid={onPyramidUpdate}
          />
        )}
      </div>
    </div>
  );
}

// ============================================
// Sources Tab
// ============================================

interface SourcesTabProps {
  project: BookProject;
  viewState: BookProjectViewState;
  setViewState: React.Dispatch<React.SetStateAction<BookProjectViewState>>;
  onPassageClick?: (passage: SourcePassage) => void;
  onPassageStatusChange?: (passageId: string, status: CurationStatus) => void;
}

function SourcesTab({
  project,
  viewState,
  setViewState,
  onPassageClick,
  onPassageStatusChange,
}: SourcesTabProps) {
  // Use new flat structure with fallback to legacy
  const passages = project.passages || project.sources?.passages || [];
  const threads = project.threads || project.sources?.threads || [];
  const conversations = project.sources?.conversations || [];

  // Filter passages
  const filteredPassages = useMemo(() => {
    return passages.filter(p => {
      if (viewState.sourcesFilter.thread !== 'all') {
        const thread = threads.find(t => t.name === viewState.sourcesFilter.thread);
        const harvestedBy = p.harvestedBy || '';
        if (thread && !thread.queries.some(q => harvestedBy.includes(q))) {
          return false;
        }
      }
      const status = p.curation?.status || p.status;
      if (viewState.sourcesFilter.status !== 'all' && status !== viewState.sourcesFilter.status) {
        return false;
      }
      return true;
    });
  }, [passages, threads, viewState.sourcesFilter]);

  const toggleConversation = (convId: string) => {
    setViewState(prev => {
      const next = new Set(prev.expandedConversations);
      if (next.has(convId)) {
        next.delete(convId);
      } else {
        next.add(convId);
      }
      return { ...prev, expandedConversations: next };
    });
  };

  // Group passages by conversation
  const groupedPassages = useMemo(() => {
    const groups: Record<string, SourcePassage[]> = {};
    for (const p of filteredPassages) {
      const conversationId = p.sourceRef?.conversationId || p.conversationId || 'unknown';
      if (!groups[conversationId]) {
        groups[conversationId] = [];
      }
      groups[conversationId].push(p);
    }
    return groups;
  }, [filteredPassages]);

  return (
    <div className="sources-tab">
      {/* Filters */}
      <div className="sources-tab__filters">
        <div className="filter-group">
          <label>Thread:</label>
          <select
            value={viewState.sourcesFilter.thread}
            onChange={e => setViewState(prev => ({
              ...prev,
              sourcesFilter: { ...prev.sourcesFilter, thread: e.target.value },
            }))}
          >
            <option value="all">All Threads ({passages.length})</option>
            {threads.map(t => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.passageCount})
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Status:</label>
          <select
            value={viewState.sourcesFilter.status}
            onChange={e => setViewState(prev => ({
              ...prev,
              sourcesFilter: { ...prev.sourcesFilter, status: e.target.value as any },
            }))}
          >
            <option value="all">All</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="approved">Approved</option>
            <option value="gem">Gems</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <span className="filter-count">
          Showing {filteredPassages.length} passages
        </span>
      </div>

      {/* Thread legend */}
      <div className="sources-tab__threads">
        {threads.map(t => (
          <button
            key={t.name}
            className={`thread-badge ${viewState.sourcesFilter.thread === t.name ? 'active' : ''}`}
            style={{ borderColor: t.color }}
            onClick={() => setViewState(prev => ({
              ...prev,
              sourcesFilter: {
                ...prev.sourcesFilter,
                thread: prev.sourcesFilter.thread === t.name ? 'all' : t.name,
              },
            }))}
          >
            <span className="thread-dot" style={{ backgroundColor: t.color }} />
            {t.name}
          </button>
        ))}
      </div>

      {/* Conversation groups */}
      <div className="sources-tab__list">
        {viewState.sourcesFilter.showConversations ? (
          // Grouped by conversation
          conversations.map(conv => {
            const convPassages = groupedPassages[conv.conversationId] || [];
            if (convPassages.length === 0) return null;
            const isExpanded = viewState.expandedConversations.has(conv.conversationId);

            return (
              <div key={conv.conversationId} className="conversation-group">
                <button
                  className="conversation-group__header"
                  onClick={() => toggleConversation(conv.conversationId)}
                >
                  <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  <span className="conversation-title">{conv.title}</span>
                  <span className="conversation-meta">
                    {convPassages.length} passages · {conv.wordCount} words
                  </span>
                  <span className="conversation-source">{conv.source}</span>
                </button>
                {isExpanded && (
                  <div className="conversation-group__passages">
                    {convPassages.map(p => (
                      <PassageCard
                        key={p.id}
                        passage={p}
                        onClick={() => onPassageClick?.(p)}
                        onStatusChange={onPassageStatusChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          // Flat list
          filteredPassages.map(p => (
            <PassageCard
              key={p.id}
              passage={p}
              onClick={() => onPassageClick?.(p)}
              onStatusChange={onPassageStatusChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================
// Passage Card
// ============================================

function PassageCard({
  passage,
  onClick,
  onStatusChange,
}: {
  passage: SourcePassage;
  onClick?: () => void;
  onStatusChange?: (id: string, status: CurationStatus) => void;
}) {
  // Use new curation structure with fallback to legacy
  const status = passage.curation?.status || passage.status || 'candidate';
  const text = passage.text || passage.content || '';
  const curatorNotes = passage.curation?.notes || passage.curatorNotes;
  const harvestedBy = passage.harvestedBy || '';

  const statusColors: Record<string, string> = {
    candidate: 'var(--color-status-warning, #f59e0b)',
    unreviewed: 'var(--color-status-warning, #f59e0b)',
    approved: 'var(--color-status-success, #22c55e)',
    rejected: 'var(--color-text-tertiary, #6b7280)',
    gem: '#fbbf24',
  };

  return (
    <div
      className={`passage-card passage-card--${status}`}
      onClick={onClick}
    >
      <div className="passage-card__header">
        <span className={`role-badge role-badge--${passage.role}`}>
          {passage.role}
        </span>
        <span
          className="status-badge"
          style={{ backgroundColor: statusColors[status] || statusColors.candidate }}
        >
          {status === 'gem' ? '⭐ gem' : status}
        </span>
        {passage.similarity !== undefined && (
          <span className="similarity">
            {(passage.similarity * 100).toFixed(0)}% match
          </span>
        )}
      </div>
      <p className="passage-card__content">
        {text.slice(0, 200)}
        {text.length > 200 ? '...' : ''}
      </p>
      {passage.tags?.length > 0 && (
        <div className="passage-card__tags">
          {passage.tags.map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}
      {curatorNotes && (
        <div className="passage-card__notes">
          <span className="notes-icon">📝</span>
          {curatorNotes}
        </div>
      )}
      <div className="passage-card__actions">
        <button
          className="action-btn action-btn--approve"
          onClick={(e) => { e.stopPropagation(); onStatusChange?.(passage.id, 'approved'); }}
          title="Approve"
        >
          ✓
        </button>
        <button
          className="action-btn action-btn--reject"
          onClick={(e) => { e.stopPropagation(); onStatusChange?.(passage.id, 'rejected'); }}
          title="Reject"
        >
          ✗
        </button>
        <button
          className="action-btn action-btn--gem"
          onClick={(e) => { e.stopPropagation(); onStatusChange?.(passage.id, 'gem'); }}
          title="Mark as Gem"
        >
          ⭐
        </button>
      </div>
      <div className="passage-card__footer">
        {harvestedBy && <span className="query">"{harvestedBy}"</span>}
        <span className="words">{passage.wordCount} words</span>
      </div>
    </div>
  );
}

// ============================================
// Thinking Tab
// ============================================

interface ThinkingTabProps {
  project: BookProject;
  viewState: BookProjectViewState;
  setViewState: React.Dispatch<React.SetStateAction<BookProjectViewState>>;
  onAddAUINote?: (note: string, relatedTo?: { type: string; id: string }) => void;
}

function ThinkingTab({
  project,
  viewState,
  setViewState,
  onAddAUINote,
}: ThinkingTabProps) {
  // Use new flat structure with fallback to legacy
  const decisions = project.thinking?.decisions || [];
  const context = project.thinking?.context || {
    recentQueries: [],
    pinnedConcepts: [],
    auiNotes: [],
  };
  const [noteInput, setNoteInput] = useState('');

  const filteredDecisions = useMemo(() => {
    if (viewState.thinkingFilter.decisionType === 'all') return decisions;
    return decisions.filter(d => d.type === viewState.thinkingFilter.decisionType);
  }, [decisions, viewState.thinkingFilter]);

  const handleAddNote = () => {
    if (noteInput.trim() && onAddAUINote) {
      onAddAUINote(noteInput.trim());
      setNoteInput('');
    }
  };

  return (
    <div className="thinking-tab">
      {/* Context panel */}
      <section className="thinking-section">
        <h3>📍 Current Context</h3>
        <div className="context-panel">
          {context.activeThread && (
            <div className="context-item">
              <span className="label">Active Thread:</span>
              <span className="value">{context.activeThread}</span>
            </div>
          )}
          {context.currentChapter && (
            <div className="context-item">
              <span className="label">Current Chapter:</span>
              <span className="value">{context.currentChapter}</span>
            </div>
          )}
          <div className="context-item">
            <span className="label">Recent Queries:</span>
            <div className="query-list">
              {context.recentQueries.map((q, i) => (
                <span key={i} className="query-tag">{q}</span>
              ))}
            </div>
          </div>
          {context.pinnedConcepts.length > 0 && (
            <div className="context-item">
              <span className="label">Pinned Concepts:</span>
              <div className="concept-list">
                {context.pinnedConcepts.map((c, i) => (
                  <span key={i} className="concept-tag">📌 {c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* AUI Notes */}
      <section className="thinking-section">
        <h3>💡 AUI Notes</h3>
        <div className="aui-notes">
          {context.auiNotes.map(note => (
            <div key={note.id} className={`aui-note aui-note--${note.type}`}>
              <div className="aui-note__header">
                <span className="note-type">{note.type}</span>
                <span className="note-time">
                  {new Date(note.timestamp).toLocaleDateString()}
                </span>
                {note.resolved && <span className="resolved">✓ resolved</span>}
              </div>
              <p className="aui-note__content">{note.content}</p>
              {note.relatedTo && (
                <span className="note-relation">
                  → {note.relatedTo.type}: {note.relatedTo.id}
                </span>
              )}
            </div>
          ))}
          <div className="aui-note-input">
            <input
              type="text"
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              placeholder="Add a note..."
              onKeyDown={e => e.key === 'Enter' && handleAddNote()}
            />
            <button onClick={handleAddNote}>Add</button>
          </div>
        </div>
      </section>

      {/* Decision Timeline */}
      <section className="thinking-section">
        <h3>📊 Decision Timeline</h3>
        <div className="decision-filters">
          <select
            value={viewState.thinkingFilter.decisionType}
            onChange={e => setViewState(prev => ({
              ...prev,
              thinkingFilter: { decisionType: e.target.value as any },
            }))}
          >
            <option value="all">All Decisions</option>
            <option value="harvest">Harvest</option>
            <option value="cluster">Cluster</option>
            <option value="concept">Concept</option>
            <option value="order">Order</option>
            <option value="structure">Structure</option>
            <option value="edit">Edit</option>
          </select>
        </div>
        <div className="decision-timeline">
          {filteredDecisions.map(d => (
            <div key={d.id} className={`decision-item decision-item--${d.type}`}>
              <div className="decision-marker" />
              <div className="decision-content">
                <div className="decision-header">
                  <span className="decision-type">{d.type}</span>
                  <span className="decision-time">
                    {new Date(d.timestamp).toLocaleString()}
                  </span>
                  {d.triggeredBy && (
                    <span className="decision-trigger">by {d.triggeredBy}</span>
                  )}
                </div>
                <h4 className="decision-title">{d.title}</h4>
                <p className="decision-desc">{d.description}</p>
                {d.confidence !== undefined && (
                  <span className="decision-confidence">
                    {(d.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ============================================
// Drafts Tab
// ============================================

interface DraftsTabProps {
  project: BookProject;
  viewState: BookProjectViewState;
  setViewState: React.Dispatch<React.SetStateAction<BookProjectViewState>>;
  onDraftEdit?: (chapterId: string, content: string) => void;
}

function DraftsTab({
  project,
  viewState,
  setViewState,
  onDraftEdit,
}: DraftsTabProps) {
  // Use new flat structure with fallback to legacy
  const chapters = project.chapters || project.drafts?.chapters || [];
  const outline = project.drafts?.outline;
  const [editContent, setEditContent] = useState('');

  const selectedChapter = chapters.find(c => c.id === viewState.selectedChapter);

  const selectChapter = (chapterId: string) => {
    const chapter = chapters.find(c => c.id === chapterId);
    if (chapter) {
      setEditContent(chapter.content);
      setViewState(prev => ({
        ...prev,
        selectedChapter: chapterId,
        editMode: false,
      }));
    }
  };

  const toggleEditMode = () => {
    if (viewState.editMode && selectedChapter && editContent !== selectedChapter.content) {
      onDraftEdit?.(selectedChapter.id, editContent);
    }
    setViewState(prev => ({ ...prev, editMode: !prev.editMode }));
  };

  return (
    <div className="drafts-tab">
      {/* Chapter sidebar */}
      <aside className="drafts-tab__sidebar">
        <h3>Chapters</h3>
        <div className="chapter-list">
          {chapters.map(ch => (
            <button
              key={ch.id}
              className={`chapter-item ${viewState.selectedChapter === ch.id ? 'active' : ''}`}
              onClick={() => selectChapter(ch.id)}
            >
              <span className="chapter-number">{ch.number}.</span>
              <span className="chapter-title">{ch.title}</span>
              <span className={`chapter-status chapter-status--${ch.status}`}>
                {ch.status}
              </span>
            </button>
          ))}
        </div>
        {outline && (
          <details className="outline-section">
            <summary>📋 Outline</summary>
            <pre className="outline-content">{outline}</pre>
          </details>
        )}
      </aside>

      {/* Chapter content */}
      <main className="drafts-tab__main">
        {selectedChapter ? (
          <>
            <div className="chapter-header">
              <h2>
                Chapter {selectedChapter.number}: {selectedChapter.title}
              </h2>
              <div className="chapter-actions">
                <button
                  className={`edit-toggle ${viewState.editMode ? 'active' : ''}`}
                  onClick={toggleEditMode}
                >
                  {viewState.editMode ? '✓ Done' : '✎ Edit'}
                </button>
                <button
                  className={`version-toggle ${viewState.showVersionHistory ? 'active' : ''}`}
                  onClick={() => setViewState(prev => ({
                    ...prev,
                    showVersionHistory: !prev.showVersionHistory,
                  }))}
                >
                  v{selectedChapter.version}
                </button>
              </div>
            </div>

            {viewState.showVersionHistory && (
              <div className="version-history">
                <h4>Version History</h4>
                {selectedChapter.versions.map(v => (
                  <div key={v.version} className="version-item">
                    <span className="version-badge">v{v.version}</span>
                    <span className="version-date">
                      {new Date(v.timestamp).toLocaleString()}
                    </span>
                    <span className="version-words">{v.wordCount} words</span>
                    <span className="version-changes">{v.changes}</span>
                    <span className="version-by">by {v.createdBy}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="chapter-content">
              {viewState.editMode ? (
                <textarea
                  className="chapter-editor"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  placeholder="Write your chapter content in markdown..."
                />
              ) : (
                <div className="chapter-preview">
                  <MarkdownPreview content={selectedChapter.content} />
                </div>
              )}
            </div>

            {/* Marginalia */}
            {selectedChapter.marginalia.length > 0 && (
              <aside className="chapter-marginalia">
                <h4>Marginalia</h4>
                {selectedChapter.marginalia.map(m => (
                  <div key={m.id} className={`marginalia-item marginalia-item--${m.type}`}>
                    <span className="marginalia-type">{m.type}</span>
                    <p>{m.text}</p>
                  </div>
                ))}
              </aside>
            )}

            {/* Metadata panel */}
            <div className="chapter-metadata">
              <h4>📊 Chapter Info</h4>
              <div className="metadata-grid">
                <span>Words: {selectedChapter.wordCount}</span>
                <span>Sections: {selectedChapter.sections.length}</span>
                <span>Last edited: {new Date(selectedChapter.metadata.lastEditedAt).toLocaleDateString()}</span>
                <span>By: {selectedChapter.metadata.lastEditedBy}</span>
              </div>
              {selectedChapter.metadata.auiSuggestions && selectedChapter.metadata.auiSuggestions.length > 0 && (
                <div className="aui-suggestions">
                  <h5>AUI Suggestions</h5>
                  {selectedChapter.metadata.auiSuggestions.map(s => (
                    <div key={s.id} className={`suggestion ${s.applied ? 'applied' : ''}`}>
                      <span className="suggestion-type">{s.type}</span>
                      <span className="suggestion-text">{s.description}</span>
                      {s.applied && <span className="applied-badge">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="drafts-empty">
            <span className="empty-icon">📝</span>
            <p>Select a chapter to view or edit</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================
// Markdown Preview (simple)
// ============================================

function MarkdownPreview({ content }: { content: string }) {
  // Simple markdown-to-HTML conversion for preview
  // In production, use a proper markdown library
  const html = content
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    });

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(html) }}
    />
  );
}

export default BookProjectDetail;
