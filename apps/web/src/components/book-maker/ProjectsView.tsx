/**
 * ProjectsView - Book project selection and creation
 *
 * Shows a grid of existing book projects with:
 * - Title, card count, chapter count
 * - Last modified date
 * - Quick actions (select, rename, delete)
 * - Create new project button
 */

import { useState, useCallback } from 'react'
import { useBookStudio } from '../../lib/book-studio/BookStudioProvider'
import { usePromptDialog, PromptDialog } from '../dialogs/PromptDialog'
import type { Book } from '../../lib/book-studio/types'

interface ProjectsViewProps {
  onSelectBook: (bookId: string) => void
}

export function ProjectsView({ onSelectBook }: ProjectsViewProps) {
  const bookStudio = useBookStudio()
  const [editingBookId, setEditingBookId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const { prompt, dialogProps } = usePromptDialog()

  const handleCreateBook = useCallback(async () => {
    const title = await prompt('New Book', {
      message: 'Enter a title for your book:',
      defaultValue: 'My Book',
      placeholder: 'Book title...',
    })
    if (title?.trim()) {
      bookStudio.actions.createBook(title.trim())
    }
  }, [bookStudio.actions, prompt])

  const handleSelectBook = useCallback((book: Book) => {
    bookStudio.actions.selectBook(book.id)
    onSelectBook(book.id)
  }, [bookStudio.actions, onSelectBook])

  const handleStartRename = useCallback((book: Book) => {
    setEditingBookId(book.id)
    setEditTitle(book.title)
  }, [])

  const handleSaveRename = useCallback((bookId: string) => {
    if (editTitle.trim()) {
      bookStudio.actions.updateBook(bookId, { title: editTitle.trim() })
    }
    setEditingBookId(null)
    setEditTitle('')
  }, [editTitle, bookStudio.actions])

  const handleCancelRename = useCallback(() => {
    setEditingBookId(null)
    setEditTitle('')
  }, [])

  const handleDeleteBook = useCallback((bookId: string) => {
    bookStudio.actions.deleteBook(bookId)
    setConfirmDelete(null)
  }, [bookStudio.actions])

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return 'Unknown'
    }
  }

  if (bookStudio.isLoading) {
    return (
      <div className="projects-view">
        <div className="projects-view__loading">
          <div className="projects-view__spinner" />
          <p>Loading books...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="projects-view">
      <header className="projects-view__header">
        <h2 className="projects-view__title">Book Projects</h2>
        <button
          className="projects-view__create-btn"
          onClick={handleCreateBook}
        >
          <span aria-hidden="true">+</span> New Book
        </button>
      </header>

      {bookStudio.books.length === 0 ? (
        <div className="projects-view__empty">
          <div className="projects-view__empty-icon">📚</div>
          <h3>No books yet</h3>
          <p>Create your first book to start harvesting content.</p>
          <button
            className="projects-view__create-btn projects-view__create-btn--large"
            onClick={handleCreateBook}
          >
            Create Your First Book
          </button>
        </div>
      ) : (
        <div className="projects-view__grid">
          {bookStudio.books.map((book) => (
            <article
              key={book.id}
              className={`projects-view__card ${book.id === bookStudio.activeBookId ? 'projects-view__card--active' : ''}`}
            >
              {editingBookId === book.id ? (
                <div className="projects-view__card-edit">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(book.id)
                      if (e.key === 'Escape') handleCancelRename()
                    }}
                    autoFocus
                    className="projects-view__edit-input"
                  />
                  <div className="projects-view__edit-actions">
                    <button
                      onClick={() => handleSaveRename(book.id)}
                      className="projects-view__edit-btn projects-view__edit-btn--save"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelRename}
                      className="projects-view__edit-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : confirmDelete === book.id ? (
                <div className="projects-view__card-confirm">
                  <p>Delete "{book.title}"?</p>
                  <div className="projects-view__confirm-actions">
                    <button
                      onClick={() => handleDeleteBook(book.id)}
                      className="projects-view__confirm-btn projects-view__confirm-btn--danger"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="projects-view__confirm-btn"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="projects-view__card-main"
                    onClick={() => handleSelectBook(book)}
                  >
                    <h3 className="projects-view__card-title">{book.title}</h3>
                    <div className="projects-view__card-stats">
                      <span className="projects-view__stat">
                        <span className="projects-view__stat-value">{book.cardCount ?? book.stagingCards?.length ?? 0}</span>
                        <span className="projects-view__stat-label">cards</span>
                      </span>
                      <span className="projects-view__stat">
                        <span className="projects-view__stat-value">{book.chapterCount ?? book.chapters?.length ?? 0}</span>
                        <span className="projects-view__stat-label">chapters</span>
                      </span>
                    </div>
                    <div className="projects-view__card-date">
                      Last modified: {formatDate(book.updatedAt)}
                    </div>
                  </button>
                  <div className="projects-view__card-actions">
                    <button
                      className="projects-view__action-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartRename(book)
                      }}
                      title="Rename book"
                    >
                      ✏️
                    </button>
                    <button
                      className="projects-view__action-btn projects-view__action-btn--danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(book.id)
                      }}
                      title="Delete book"
                    >
                      🗑️
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Prompt Dialog for creating books */}
      <PromptDialog {...dialogProps} />
    </div>
  )
}
