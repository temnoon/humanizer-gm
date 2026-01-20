/**
 * ChaptersView - Manage chapter structure
 *
 * Features:
 * - List all chapters with word counts
 * - Create, rename, delete chapters
 * - Reorder chapters
 * - View cards assigned to each chapter
 * - Progress tracking toward target word count
 */

import { useState, useCallback } from 'react'
import { useBookStudio } from '../../../lib/book-studio/BookStudioProvider'

interface EditingState {
  chapterId: string
  title: string
}

export function ChaptersView() {
  const bookStudio = useBookStudio()
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(null)

  const book = bookStudio.activeBook
  const chapters = book?.chapters || []
  const cards = book?.stagingCards || []

  // Calculate totals
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0)
  const targetWords = book?.targetWordCount || 60000
  const progress = Math.min((totalWords / targetWords) * 100, 100)

  // Get cards for a chapter
  const getChapterCards = (chapterId: string) => {
    return cards.filter((card) => card.suggestedChapterId === chapterId)
  }

  // Create chapter
  const handleCreate = useCallback(() => {
    const title = prompt('Chapter title:', `Chapter ${chapters.length + 1}`)
    if (title?.trim()) {
      bookStudio.actions.createChapter(title.trim())
    }
  }, [chapters.length, bookStudio.actions])

  // Start rename
  const handleStartRename = useCallback((chapterId: string, currentTitle: string) => {
    setEditing({ chapterId, title: currentTitle })
  }, [])

  // Save rename
  const handleSaveRename = useCallback(() => {
    if (editing && editing.title.trim()) {
      bookStudio.actions.updateChapter(editing.chapterId, { title: editing.title.trim() })
    }
    setEditing(null)
  }, [editing, bookStudio.actions])

  // Delete chapter
  const handleDelete = useCallback((chapterId: string, title: string) => {
    if (confirm(`Delete chapter "${title}"? Cards will be moved back to staging.`)) {
      bookStudio.actions.deleteChapter(chapterId)
    }
  }, [bookStudio.actions])

  // Reorder chapter
  const handleReorder = useCallback((chapterId: string, direction: 'up' | 'down') => {
    const currentIndex = chapters.findIndex((ch) => ch.id === chapterId)
    if (currentIndex === -1) return

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= chapters.length) return

    // Swap orders
    const currentOrder = chapters[currentIndex].order
    const targetOrder = chapters[newIndex].order

    bookStudio.actions.updateChapter(chapterId, { order: targetOrder })
    bookStudio.actions.updateChapter(chapters[newIndex].id, { order: currentOrder })
  }, [chapters, bookStudio.actions])

  // Format word count
  const formatWordCount = (count: number) => {
    if (count === 0) return 'empty'
    if (count < 1000) return `${count}`
    return `${(count / 1000).toFixed(1)}K`
  }

  return (
    <div className="chapters-view">
      <div className="chapters-view__header">
        <h2 className="chapters-view__title">Chapters</h2>
        <button className="chapters-view__add-btn" onClick={handleCreate}>
          + New Chapter
        </button>
      </div>

      {/* Progress bar */}
      <div className="chapters-view__progress-section">
        <div className="chapters-view__progress-stats">
          <span>{totalWords.toLocaleString()} words</span>
          <span>Target: ~{targetWords.toLocaleString()}</span>
        </div>
        <div className="chapters-view__progress-bar">
          <div
            className="chapters-view__progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="chapters-view__progress-label">
          {Math.round(progress)}% complete
        </div>
      </div>

      {chapters.length === 0 ? (
        <div className="chapters-view__empty">
          <div className="chapters-view__empty-icon">📖</div>
          <h3>No chapters yet</h3>
          <p>Create chapters to organize your content.</p>
          <button className="chapters-view__add-btn--large" onClick={handleCreate}>
            Create First Chapter
          </button>
        </div>
      ) : (
        <div className="chapters-view__list">
          {chapters
            .sort((a, b) => a.order - b.order)
            .map((chapter, index) => {
              const chapterCards = getChapterCards(chapter.id)
              const isExpanded = expandedChapterId === chapter.id

              return (
                <div
                  key={chapter.id}
                  className={`chapters-view__chapter ${isExpanded ? 'chapters-view__chapter--expanded' : ''}`}
                >
                  <div className="chapters-view__chapter-header">
                    <div className="chapters-view__chapter-main">
                      <span className="chapters-view__chapter-number">{index + 1}.</span>

                      {editing?.chapterId === chapter.id ? (
                        <input
                          type="text"
                          className="chapters-view__edit-input"
                          value={editing.title}
                          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          onBlur={handleSaveRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename()
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="chapters-view__chapter-title"
                          onDoubleClick={() => handleStartRename(chapter.id, chapter.title)}
                        >
                          {chapter.title}
                        </span>
                      )}
                    </div>

                    <div className="chapters-view__chapter-meta">
                      <span className="chapters-view__chapter-cards">
                        {chapterCards.length} cards
                      </span>
                      <span className="chapters-view__chapter-words">
                        {formatWordCount(chapter.wordCount)} words
                      </span>
                    </div>

                    <div className="chapters-view__chapter-actions">
                      <button
                        className="chapters-view__action-btn"
                        onClick={() => setExpandedChapterId(isExpanded ? null : chapter.id)}
                        title={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                      <button
                        className="chapters-view__action-btn"
                        onClick={() => handleReorder(chapter.id, 'up')}
                        disabled={index === 0}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="chapters-view__action-btn"
                        onClick={() => handleReorder(chapter.id, 'down')}
                        disabled={index === chapters.length - 1}
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        className="chapters-view__action-btn chapters-view__action-btn--danger"
                        onClick={() => handleDelete(chapter.id, chapter.title)}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {/* Expanded view with cards */}
                  {isExpanded && (
                    <div className="chapters-view__chapter-content">
                      {chapterCards.length === 0 ? (
                        <div className="chapters-view__no-cards">
                          No cards assigned. Assign cards from Staging.
                        </div>
                      ) : (
                        <div className="chapters-view__cards-list">
                          {chapterCards.map((card) => (
                            <div key={card.id} className="chapters-view__card">
                              <div className="chapters-view__card-content">
                                {card.content.length > 100
                                  ? card.content.slice(0, 100) + '...'
                                  : card.content}
                              </div>
                              <div className="chapters-view__card-meta">
                                {card.source}
                                {card.userNotes && ` · ${card.userNotes.slice(0, 30)}...`}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {chapter.content && (
                        <div className="chapters-view__draft-preview">
                          <h4>Draft Preview</h4>
                          <div className="chapters-view__draft-text">
                            {chapter.content.slice(0, 300)}...
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
