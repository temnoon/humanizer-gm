/**
 * Books View - Book projects with Sources, Thinking, and Drafts
 *
 * Features:
 * - List view: Browse all book projects
 * - Navigation view: Browse project structure (Sources/Thinking/Drafts)
 * - Click content to open in main workspace pane
 * - Integration with AUI for collecting and curating material
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useBuffers } from '../../lib/buffer/BufferContext';
import { useAuthenticatedFetch } from '../../lib/auth';
import { useBook } from '../../lib/book';
import { useBookshelf, type BookProject as BookshelfBookProject } from '../../lib/bookshelf';
import {
  type BookProject,
  type SourcePassage,
  type DraftChapter,
  DEMO_BOOK_PROJECT,
} from './book-project/types';
import type { BookContent } from '../workspace/BookContentView';

// Legacy Book interface for API compatibility
interface Book {
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  status: 'draft' | 'building' | 'complete';
  content?: string;
  wordCount?: number;
  chapterCount?: number;
  pageCount?: number;
  updatedAt?: string;
}

// Demo book for local development (legacy format)
const DEMO_BOOK: Book = {
  id: 'demo-local',
  title: 'Three Threads',
  subtitle: 'A Phenomenological Weave',
  status: 'draft',
  content: `# Three Threads: A Phenomenological Weave

*On the Lifeworld, the Body, and the Letter*

---

## Opening: The Compulsion to Write

I have resorted to a compulsion to write
When no words are of any value
The write a compulsion although
When no thought has any relevance to reality

---

I must remember, at all times, that I am one of many, and many of one.

I am the unity of my experiences, all the experience of my unity.

I am the diversity of my memory, the memory of my diversity.

---

## Part I: The Lifeworld

### The Crisis We Forgot

Husserl saw it coming. Before the world wars, before the atomic bomb, before the smartphone colonized every waking moment—he saw that science had a problem. Not in its methods, but in its forgetting.

> The Physical world, which is the world of all experience and all measurement—Husserl's Lifeworld—must always be understood as being corporeal in a way that the Objective world cannot be.

Science arose *from* the lifeworld. From bodies in space, hands on instruments, eyes reading dials. Then it forgot.

---

*Composed from the archive of T.E.M.*
*Three threads: Lifeworld, Body, Letter*
`,
  wordCount: 180,
  chapterCount: 2,
};

type ViewMode = 'list' | 'navigation';
type ProjectTab = 'sources' | 'thinking' | 'drafts';

interface BooksViewProps {
  onSelectBookContent?: (content: BookContent, project: BookProject) => void;
}

export function BooksView({ onSelectBookContent }: BooksViewProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>('sources');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Buffer system - for loading content to workspace
  const { importText } = useBuffers();

  // Authenticated fetch - handles 401 gracefully with login prompt
  const { authGet, isAuthenticated } = useAuthenticatedFetch();

  // Book context - for persistence and active project
  const book = useBook();

  // Bookshelf context - library books, personas, styles
  const bookshelf = useBookshelf();

  // Convert bookshelf book to internal BookProject format
  // Note: Types don't fully align, so we cast through unknown where needed
  const convertBookshelfBook = useCallback((bsBook: BookshelfBookProject): BookProject => {
    // Map status to valid BookProject status
    const mapStatus = (s: string): BookProject['status'] => {
      if (s === 'planning' || s === 'harvesting') return 'harvesting';
      if (s === 'drafting') return 'drafting';
      if (s === 'revising') return 'curating';
      if (s === 'complete') return 'complete';
      return 'harvesting';
    };

    const converted = {
      id: bsBook.id,
      name: bsBook.name,
      subtitle: bsBook.subtitle,
      description: bsBook.description,
      createdAt: bsBook.createdAt,
      updatedAt: bsBook.updatedAt,
      status: mapStatus(bsBook.status),
      sources: {
        conversations: bsBook.sourceRefs.map((ref) => ({
          id: ref.uri,
          title: ref.label || ref.uri,
          source: 'archive',
          addedAt: bsBook.createdAt,
          status: 'active',
        })),
        passages: bsBook.passages.map(p => ({
          id: p.id,
          conversationId: p.sourceRef.uri,
          text: p.text,
          source: p.sourceRef.label || 'Unknown',
          timestamp: p.curation.curatedAt || Date.now(),
          status: p.curation.status,
        })),
        threads: bsBook.threads.map(t => ({
          id: t.id,
          name: t.name,
          color: t.color,
          conversationIds: [] as string[],
        })),
      },
      thinking: {
        decisions: [],
        context: {
          recentQueries: bsBook.threads.flatMap(t => t.queries),
          pinnedConcepts: bsBook.editorial?.principles || [],
          auiNotes: [],
        },
      },
      drafts: {
        chapters: bsBook.chapters as unknown as DraftChapter[],
      },
      stats: {
        totalConversations: bsBook.stats.totalSources,
        totalPassages: bsBook.stats.totalPassages,
        approvedPassages: bsBook.stats.approvedPassages,
        gems: bsBook.stats.gems,
        chapters: bsBook.stats.chapters,
        wordCount: bsBook.stats.wordCount,
      },
      // Library metadata
      _isLibrary: true,
      _personaRefs: bsBook.personaRefs,
      _styleRefs: bsBook.styleRefs,
    } as unknown as BookProject;

    return converted;
  }, []);

  // Combine localStorage projects with bookshelf library books
  const bookProjects = useMemo(() => {
    // Convert bookshelf books to internal format
    const libraryBooks = bookshelf.books.map(convertBookshelfBook);

    // Get user projects from BookContext
    const userProjects = book.projects;

    // Merge: library books first, then user projects (deduplicated by id)
    const allProjects = [...libraryBooks];
    for (const proj of userProjects) {
      if (!allProjects.some(p => p.id === proj.id)) {
        allProjects.push(proj);
      }
    }

    // Add demo if not present
    if (!allProjects.some(p => p.id === DEMO_BOOK_PROJECT.id)) {
      allProjects.unshift(DEMO_BOOK_PROJECT);
    }

    return allProjects;
  }, [book.projects, bookshelf.books, convertBookshelfBook]);

  // Load books when authenticated or on mount
  useEffect(() => {
    loadBooks();
  }, [isAuthenticated]); // Re-fetch when auth state changes

  const loadBooks = async () => {
    setLoading(true);
    setError(null);

    // Always show demo book first
    setBooks([DEMO_BOOK]);

    // Try to fetch user's books from API
    const result = await authGet<{ books: Book[] }>('/books', {
      timeout: 5000,
      authMessage: 'Sign in to access your saved books',
      fallback: { books: [] },
    });

    if (result.status === 'success' && result.data?.books) {
      setBooks([DEMO_BOOK, ...result.data.books]);
    } else if (result.status === 'auth_required') {
      // User not authenticated - just show demo, no error
      setError(null);
    } else if (result.error) {
      // API error but not auth - show demo with subtle error
      console.warn('Failed to load books:', result.error);
      setError(null); // Don't show error to user, just use demo
    }

    setLoading(false);
  };

  const handleNewBook = () => {
    const newContent = `# Untitled Book

Start writing here...
`;
    importText(newContent, 'Untitled Book', { type: 'book' });
  };

  // Create a new book project with persistence
  const handleNewProject = useCallback(() => {
    const project = book.createProject('Untitled Project', 'A new book project');
    setSelectedProjectId(project.id);
    setViewMode('navigation');
  }, [book]);

  // Open book project in navigation view
  const handleOpenProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setViewMode('navigation');

    // Set active project in book context for persistence
    const project = bookProjects.find(p => p.id === projectId);
    if (project) {
      book.setActiveProject(project);
    }
  }, [bookProjects, book]);

  // Go back to list view
  const handleBackToList = useCallback(() => {
    setSelectedProjectId(null);
    setViewMode('list');
    setExpandedItems(new Set());
    book.setActiveProject(null);
  }, [book]);

  // Handle legacy book selection (load into buffer)
  const handleSelectLegacyBook = useCallback((book: Book) => {
    if (book.content) {
      importText(book.content, book.title, { type: 'book' });
    }
  }, [importText]);

  // Toggle expanded state for a conversation or section
  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Handle passage click - send to main workspace
  const handlePassageClick = useCallback((passage: SourcePassage) => {
    const project = bookProjects.find(p => p.id === selectedProjectId);
    if (!project) return;

    // Use new field names with fallback to legacy
    const text = passage.text || passage.content || '';
    const title = passage.sourceRef?.conversationTitle || passage.conversationTitle || 'Unknown';
    const conversationId = passage.sourceRef?.conversationId || passage.conversationId;

    if (onSelectBookContent) {
      onSelectBookContent({
        type: 'passage',
        title,
        content: text,
        source: {
          bookProjectId: project.id,
          projectName: project.name,
          itemId: passage.id,
        },
        passage,
      }, project);
    } else {
      // Fallback to buffer system
      importText(text, title, {
        type: 'passage',
        conversationId,
      });
    }
  }, [bookProjects, selectedProjectId, onSelectBookContent, importText]);

  // Handle chapter click - send to main workspace
  const handleChapterClick = useCallback((chapter: DraftChapter) => {
    const project = bookProjects.find(p => p.id === selectedProjectId);
    if (!project) return;

    if (onSelectBookContent) {
      onSelectBookContent({
        type: 'chapter',
        title: `Chapter ${chapter.number}: ${chapter.title}`,
        content: chapter.content,
        marginalia: chapter.marginalia,
        source: {
          bookProjectId: project.id,
          projectName: project.name,
          itemId: chapter.id,
        },
        chapter,
      }, project);
    } else {
      // Fallback to buffer system
      importText(chapter.content, `Ch${chapter.number}: ${chapter.title}`, {
        type: 'book-chapter',
        bookProjectId: project.id,
        itemId: chapter.id,
      });
    }
  }, [bookProjects, selectedProjectId, onSelectBookContent, importText]);

  // Create a new chapter
  const handleNewChapter = useCallback(() => {
    const title = window.prompt('Chapter title:');
    if (!title) return;

    const chapter = book.createChapter(title);
    if (chapter && onSelectBookContent) {
      const project = bookProjects.find(p => p.id === selectedProjectId);
      if (project) {
        onSelectBookContent({
          type: 'chapter',
          title: `Chapter ${chapter.number}: ${chapter.title}`,
          content: chapter.content,
          marginalia: chapter.marginalia,
          source: {
            bookProjectId: project.id,
            projectName: project.name,
            itemId: chapter.id,
          },
          chapter,
        }, project);
      }
    }
  }, [book, bookProjects, selectedProjectId, onSelectBookContent]);

  // Handle thinking click - send to main workspace
  const handleThinkingClick = useCallback(() => {
    const project = bookProjects.find(p => p.id === selectedProjectId);
    if (!project) return;

    // Use optional chaining for thinking access
    const context = project.thinking?.context || { activeThread: undefined, currentChapter: undefined, auiNotes: [] };
    const decisions = project.thinking?.decisions || [];

    const thinkingContent = [
      '# Thinking Context\n',
      `## Active Thread: ${context.activeThread || 'None'}\n`,
      `## Current Chapter: ${context.currentChapter || 'None'}\n`,
      '\n## Recent Decisions\n',
      ...decisions.slice(0, 10).map(d =>
        `- **${d.type}**: ${d.title}\n  ${d.description}\n`
      ),
      '\n## AUI Notes\n',
      ...(context.auiNotes || []).map(n =>
        `- [${n.type}] ${n.content}${n.resolved ? ' ✓' : ''}\n`
      ),
    ].join('\n');

    if (onSelectBookContent) {
      onSelectBookContent({
        type: 'thinking',
        title: `Thinking: ${project.name}`,
        content: thinkingContent,
        source: {
          bookProjectId: project.id,
          projectName: project.name,
          itemId: 'thinking',
        },
      }, project);
    } else {
      importText(thinkingContent, `Thinking: ${project.name}`, {
        type: 'book-thinking',
        bookProjectId: project.id,
      });
    }
  }, [bookProjects, selectedProjectId, onSelectBookContent, importText]);

  // Get selected project
  const selectedProject = bookProjects.find(p => p.id === selectedProjectId);

  // Filter passages by status
  const passagesByStatus = useMemo(() => {
    if (!selectedProject) return { gems: [], approved: [], unreviewed: [], rejected: [] };
    // Use new flat structure with fallback to legacy
    const passages = selectedProject.passages || selectedProject.sources?.passages || [];
    return {
      gems: passages.filter(p => (p.curation?.status || p.status) === 'gem'),
      approved: passages.filter(p => (p.curation?.status || p.status) === 'approved'),
      unreviewed: passages.filter(p => {
        const status = p.curation?.status || p.status;
        return status === 'unreviewed' || status === 'candidate';
      }),
      rejected: passages.filter(p => (p.curation?.status || p.status) === 'rejected'),
    };
  }, [selectedProject]);

  // Loading state
  if (loading) {
    return (
      <div className="archive-browser__loading">
        Loading books...
      </div>
    );
  }

  // Navigation view for selected project
  if (viewMode === 'navigation' && selectedProject) {
    return (
      <div className="book-nav">
        {/* Header */}
        <header className="book-nav__header">
          <button className="book-nav__back" onClick={handleBackToList}>
            ← Projects
          </button>
          <div className="book-nav__title">
            <h2>{selectedProject.name}</h2>
            <span className={`book-nav__status book-nav__status--${selectedProject.status}`}>
              {selectedProject.status}
            </span>
          </div>
        </header>

        {/* Quick stats */}
        <div className="book-nav__stats">
          <span>{selectedProject.stats.totalPassages} passages</span>
          <span>{selectedProject.stats.gems} gems</span>
          <span>{selectedProject.stats.chapters} chapters</span>
        </div>

        {/* Tab navigation */}
        <nav className="book-nav__tabs">
          <button
            className={`book-nav__tab ${activeTab === 'sources' ? 'book-nav__tab--active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            📚 Sources
          </button>
          <button
            className={`book-nav__tab ${activeTab === 'thinking' ? 'book-nav__tab--active' : ''}`}
            onClick={() => setActiveTab('thinking')}
          >
            🧠 Thinking
          </button>
          <button
            className={`book-nav__tab ${activeTab === 'drafts' ? 'book-nav__tab--active' : ''}`}
            onClick={() => setActiveTab('drafts')}
          >
            📝 Drafts
          </button>
        </nav>

        {/* Tab content */}
        <div className="book-nav__content">
          {activeTab === 'sources' && (
            <div className="book-nav__sources">
              {/* Gems */}
              {passagesByStatus.gems.length > 0 && (
                <div className="book-nav__group">
                  <button
                    className="book-nav__group-header"
                    onClick={() => toggleExpanded('gems')}
                  >
                    <span className="book-nav__group-icon">
                      {expandedItems.has('gems') ? '▼' : '▶'}
                    </span>
                    <span className="book-nav__group-title">💎 Gems</span>
                    <span className="book-nav__group-count">{passagesByStatus.gems.length}</span>
                  </button>
                  {expandedItems.has('gems') && (
                    <div className="book-nav__group-items">
                      {passagesByStatus.gems.map(p => (
                        <button
                          key={p.id}
                          className="book-nav__item"
                          onClick={() => handlePassageClick(p)}
                        >
                          <span className="book-nav__item-title">{p.sourceRef?.conversationTitle || p.conversationTitle || 'Unknown'}</span>
                          <span className="book-nav__item-preview">
                            {(p.text || p.content || '').slice(0, 60)}...
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Approved */}
              {passagesByStatus.approved.length > 0 && (
                <div className="book-nav__group">
                  <button
                    className="book-nav__group-header"
                    onClick={() => toggleExpanded('approved')}
                  >
                    <span className="book-nav__group-icon">
                      {expandedItems.has('approved') ? '▼' : '▶'}
                    </span>
                    <span className="book-nav__group-title">✓ Approved</span>
                    <span className="book-nav__group-count">{passagesByStatus.approved.length}</span>
                  </button>
                  {expandedItems.has('approved') && (
                    <div className="book-nav__group-items">
                      {passagesByStatus.approved.map(p => (
                        <button
                          key={p.id}
                          className="book-nav__item"
                          onClick={() => handlePassageClick(p)}
                        >
                          <span className="book-nav__item-title">{p.sourceRef?.conversationTitle || p.conversationTitle || 'Unknown'}</span>
                          <span className="book-nav__item-preview">
                            {(p.text || p.content || '').slice(0, 60)}...
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Unreviewed */}
              {passagesByStatus.unreviewed.length > 0 && (
                <div className="book-nav__group">
                  <button
                    className="book-nav__group-header"
                    onClick={() => toggleExpanded('unreviewed')}
                  >
                    <span className="book-nav__group-icon">
                      {expandedItems.has('unreviewed') ? '▼' : '▶'}
                    </span>
                    <span className="book-nav__group-title">○ Unreviewed</span>
                    <span className="book-nav__group-count">{passagesByStatus.unreviewed.length}</span>
                  </button>
                  {expandedItems.has('unreviewed') && (
                    <div className="book-nav__group-items">
                      {passagesByStatus.unreviewed.map(p => (
                        <button
                          key={p.id}
                          className="book-nav__item"
                          onClick={() => handlePassageClick(p)}
                        >
                          <span className="book-nav__item-title">{p.sourceRef?.conversationTitle || p.conversationTitle || 'Unknown'}</span>
                          <span className="book-nav__item-preview">
                            {(p.text || p.content || '').slice(0, 60)}...
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Threads */}
              {((selectedProject.threads || selectedProject.sources?.threads || []).length > 0) && (
                <div className="book-nav__section">
                  <h4 className="book-nav__section-title">Threads</h4>
                  {(selectedProject.threads || selectedProject.sources?.threads || []).map(thread => (
                    <div
                      key={thread.name}
                      className="book-nav__thread"
                      style={{ borderLeftColor: thread.color }}
                    >
                      <span className="book-nav__thread-name">{thread.name}</span>
                      <span className="book-nav__thread-count">{thread.passageCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'thinking' && (
            <div className="book-nav__thinking">
              <button
                className="book-nav__thinking-btn"
                onClick={handleThinkingClick}
              >
                <span className="book-nav__thinking-icon">🧠</span>
                <span className="book-nav__thinking-label">Open Thinking Context</span>
              </button>

              {/* Recent decisions preview */}
              <div className="book-nav__section">
                <h4 className="book-nav__section-title">Recent Decisions</h4>
                {(selectedProject.thinking?.decisions || []).slice(0, 5).map(d => (
                  <div key={d.id} className="book-nav__decision">
                    <span className="book-nav__decision-type">{d.type}</span>
                    <span className="book-nav__decision-title">{d.title}</span>
                  </div>
                ))}
              </div>

              {/* AUI Notes preview */}
              {(selectedProject.thinking?.context?.auiNotes || []).length > 0 && (
                <div className="book-nav__section">
                  <h4 className="book-nav__section-title">AUI Notes</h4>
                  {(selectedProject.thinking?.context?.auiNotes || []).slice(0, 5).map(n => (
                    <div key={n.id} className={`book-nav__note book-nav__note--${n.type}`}>
                      <span className="book-nav__note-content">{n.content}</span>
                      {n.resolved && <span className="book-nav__note-resolved">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'drafts' && (
            <div className="book-nav__drafts">
              {/* New Chapter button */}
              <button
                className="book-nav__new-chapter"
                onClick={handleNewChapter}
              >
                + New Chapter
              </button>

              {(() => {
                const chapters = selectedProject.chapters || selectedProject.drafts?.chapters || [];
                return chapters.length > 0 ? (
                  <div className="book-nav__chapters">
                    {chapters.map(chapter => (
                      <button
                        key={chapter.id}
                        className="book-nav__chapter"
                        onClick={() => handleChapterClick(chapter)}
                      >
                        <span className="book-nav__chapter-number">Ch {chapter.number}</span>
                        <div className="book-nav__chapter-info">
                          <span className="book-nav__chapter-title">{chapter.title}</span>
                          <span className="book-nav__chapter-meta">
                            {chapter.wordCount.toLocaleString()} words · {chapter.status}
                            {chapter.marginalia?.length > 0 && (
                              <> · {chapter.marginalia.length} notes</>
                            )}
                          </span>
                        </div>
                        <span className={`book-nav__chapter-status book-nav__chapter-status--${chapter.status}`}>
                          {chapter.status === 'complete' ? '✓' : '○'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="book-nav__empty">
                    <p>No chapters yet</p>
                    <span>Start drafting to add chapters</span>
                  </div>
                );
              })()}

              {/* Outline preview */}
              {selectedProject.drafts?.outline && (
                <div className="book-nav__section">
                  <h4 className="book-nav__section-title">Outline</h4>
                  <p className="book-nav__outline-preview">
                    {selectedProject.drafts.outline.slice(0, 200)}...
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="books-list">
      {/* Create new book button */}
      <button className="tool-card tool-card--subtle" onClick={handleNewProject}>
        <span className="tool-card__name">+ New Project</span>
        <span className="tool-card__desc">Create a new book project with chapters</span>
      </button>

      <button className="tool-card tool-card--subtle" onClick={handleNewBook}>
        <span className="tool-card__name">+ Quick Book</span>
        <span className="tool-card__desc">Start a simple single-document book</span>
      </button>

      {/* Error state */}
      {error && (
        <div className="tool-panel__empty">
          <p>{error}</p>
        </div>
      )}

      {/* Book Projects (new format with sources/thinking/drafts) */}
      {bookProjects.length > 0 && (
        <div className="books-section">
          <h3 className="books-section__title">📚 Book Projects</h3>
          {bookProjects.map(project => (
            <div
              key={project.id}
              className="book-card book-card--project"
              onClick={() => handleOpenProject(project.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleOpenProject(project.id)}
            >
              <div className="book-card__cover">📖</div>
              <div className="book-card__info">
                <div className="book-card__title">{project.name}</div>
                {project.subtitle && (
                  <div className="book-card__meta">{project.subtitle}</div>
                )}
                <div className="book-card__meta">
                  {project.stats.totalPassages} passages ·{' '}
                  {project.stats.gems} gems ·{' '}
                  {project.stats.chapters} chapters
                </div>
                <div className="book-card__pipeline">
                  <span className="pipeline-step" title="Sources">📚 {project.stats.totalSources || project.stats.totalConversations || 0}</span>
                  <span className="pipeline-arrow">→</span>
                  <span className="pipeline-step" title="Approved">✓ {project.stats.approvedPassages}</span>
                  <span className="pipeline-arrow">→</span>
                  <span className="pipeline-step" title="Words">{project.stats.wordCount}</span>
                </div>
              </div>
              <span className={`book-card__status book-card__status--${project.status}`}>
                {project.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Legacy Books (simple format) */}
      {books.length > 0 && (
        <div className="books-section">
          <h3 className="books-section__title">📄 Quick Books</h3>
          {books.map(book => (
            <div
              key={book.id}
              className="book-card"
              onClick={() => handleSelectLegacyBook(book)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleSelectLegacyBook(book)}
            >
              <div className="book-card__cover">📖</div>
              <div className="book-card__info">
                <div className="book-card__title">{book.title}</div>
                {book.subtitle && (
                  <div className="book-card__meta">{book.subtitle}</div>
                )}
                <div className="book-card__meta">
                  {book.chapterCount && `${book.chapterCount} chapters`}
                  {book.wordCount && ` · ${book.wordCount.toLocaleString()} words`}
                </div>
              </div>
              <span className={`book-card__status book-card__status--${book.status}`}>
                {book.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {bookProjects.length === 0 && books.length === 0 && !error && (
        <div className="tool-panel__empty">
          <p>No books yet</p>
          <span className="tool-panel__muted">Create your first book to get started</span>
        </div>
      )}
    </div>
  );
}
