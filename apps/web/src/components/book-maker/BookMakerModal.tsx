/**
 * BookMakerModal - Full-screen modal for book creation workflow
 *
 * Six views: Projects, Harvest, Staging, Outline, Chapters, Writing
 * Accessible via Cmd+Shift+B from Studio
 *
 * Uses React Portal to render at document.body level.
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useBookStudio } from '../../lib/book-studio/BookStudioProvider'
import { ProjectsView } from './ProjectsView'
import { HarvestView, StagingView, OutlineView, ChaptersView, WritingView } from './views'
import './BookMakerModal.css'

export type BookMakerView = 'projects' | 'harvest' | 'staging' | 'outline' | 'chapters' | 'writing'

interface BookMakerModalProps {
  isOpen: boolean
  onClose: () => void
  initialView?: BookMakerView
}

const VIEW_LABELS: Record<BookMakerView, string> = {
  projects: 'Projects',
  harvest: 'Harvest',
  staging: 'Staging',
  outline: 'Outline',
  chapters: 'Chapters',
  writing: 'Writing',
}

const VIEW_SHORTCUTS: Record<BookMakerView, string> = {
  projects: '1',
  harvest: '2',
  staging: '3',
  outline: '4',
  chapters: '5',
  writing: '6',
}

export function BookMakerModal({
  isOpen,
  onClose,
  initialView = 'projects',
}: BookMakerModalProps) {
  const [view, setView] = useState<BookMakerView>(initialView)
  const bookStudio = useBookStudio()

  // Reset view when modal opens
  useEffect(() => {
    if (isOpen) {
      // If there's an active book, go to staging; otherwise show projects
      if (bookStudio.activeBookId) {
        setView('staging')
      } else {
        setView('projects')
      }
    }
  }, [isOpen, bookStudio.activeBookId])

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      // Cmd/Ctrl + number to switch views
      if (e.metaKey || e.ctrlKey) {
        const viewByNumber: Record<string, BookMakerView> = {
          '1': 'projects',
          '2': 'harvest',
          '3': 'staging',
          '4': 'outline',
          '5': 'chapters',
          '6': 'writing',
        }
        if (viewByNumber[e.key]) {
          e.preventDefault()
          setView(viewByNumber[e.key])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Navigate to view (with validation)
  const navigateToView = useCallback((targetView: BookMakerView) => {
    // Some views require an active book
    const requiresBook: BookMakerView[] = ['harvest', 'staging', 'outline', 'chapters', 'writing']
    if (requiresBook.includes(targetView) && !bookStudio.activeBookId) {
      // Stay on projects if no book selected
      setView('projects')
      return
    }
    setView(targetView)
  }, [bookStudio.activeBookId])

  // Render the current view content
  const renderViewContent = () => {
    switch (view) {
      case 'projects':
        return (
          <ProjectsView
            onSelectBook={() => setView('staging')}
          />
        )

      case 'harvest':
        return (
          <div className="book-maker__view book-maker__view--harvest">
            <HarvestView />
          </div>
        )

      case 'staging':
        return (
          <div className="book-maker__view book-maker__view--staging">
            <StagingView />
          </div>
        )

      case 'outline':
        return (
          <div className="book-maker__view book-maker__view--outline">
            <OutlineView />
          </div>
        )

      case 'chapters':
        return (
          <div className="book-maker__view book-maker__view--chapters">
            <ChaptersView />
          </div>
        )

      case 'writing':
        return (
          <div className="book-maker__view book-maker__view--writing">
            <WritingView />
          </div>
        )

      default:
        return null
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className="book-maker__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Book Maker"
    >
      <div className="book-maker">
        {/* Header with navigation */}
        <header className="book-maker__header">
          <div className="book-maker__header-left">
            <h1 className="book-maker__title">Book Maker</h1>
            {bookStudio.activeBook && (
              <span className="book-maker__active-book">
                {bookStudio.activeBook.title}
              </span>
            )}
          </div>

          <nav className="book-maker__nav" role="tablist">
            {(Object.keys(VIEW_LABELS) as BookMakerView[]).map((v) => {
              const disabled = v !== 'projects' && !bookStudio.activeBookId
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  aria-disabled={disabled}
                  className={`book-maker__nav-btn ${view === v ? 'book-maker__nav-btn--active' : ''} ${disabled ? 'book-maker__nav-btn--disabled' : ''}`}
                  onClick={() => navigateToView(v)}
                  disabled={disabled}
                >
                  <span className="book-maker__nav-label">{VIEW_LABELS[v]}</span>
                  <kbd className="book-maker__nav-shortcut">⌘{VIEW_SHORTCUTS[v]}</kbd>
                </button>
              )
            })}
          </nav>

          <button
            className="book-maker__close"
            onClick={onClose}
            aria-label="Close Book Maker (Escape)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {/* Main content area */}
        <main className="book-maker__content">
          {renderViewContent()}
        </main>

        {/* Status bar */}
        <footer className="book-maker__footer">
          <span className="book-maker__status">
            Press <kbd>Esc</kbd> to close
          </span>
          {bookStudio.activeBook && (
            <span className="book-maker__status">
              {bookStudio.activeBook.stagingCards?.length || 0} cards ·{' '}
              {bookStudio.activeBook.chapters?.length || 0} chapters
            </span>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}
