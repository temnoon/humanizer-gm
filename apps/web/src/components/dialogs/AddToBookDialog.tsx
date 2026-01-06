/**
 * AddToBookDialog - Dialog for adding workspace content to a book
 *
 * Allows user to:
 * - Select target book (or create new book/paper)
 * - Choose action: new chapter, append to existing, or replace
 * - Set chapter title for new chapters
 */

import { useState, useCallback, useEffect } from 'react';
import { useBookshelf } from '../../lib/bookshelf';
import type { BookProject, DraftChapter } from '../../lib/bookshelf/types';
import './AddToBookDialog.css';

export type AddAction = 'new' | 'append' | 'replace';

export interface AddToBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  title: string;
  onConfirm: (
    bookUri: string,
    action: AddAction,
    chapterTitle: string,
    chapterId?: string
  ) => void;
}

export function AddToBookDialog({
  isOpen,
  onClose,
  content,
  title,
  onConfirm,
}: AddToBookDialogProps) {
  const { books, createBook, activeBookUri } = useBookshelf();

  const [selectedBookUri, setSelectedBookUri] = useState<string>(activeBookUri || '');
  const [action, setAction] = useState<AddAction>('new');
  const [chapterTitle, setChapterTitle] = useState(title || 'Untitled Chapter');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookType, setNewBookType] = useState<'book' | 'paper'>('book');

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedBookUri(activeBookUri || '');
      setAction('new');
      setChapterTitle(title || 'Untitled Chapter');
      setSelectedChapterId('');
      setIsCreatingBook(false);
      setNewBookName('');
    }
  }, [isOpen, activeBookUri, title]);

  // Get selected book
  const selectedBook = books.find((b) => b.uri === selectedBookUri);
  const chapters = selectedBook?.chapters || [];

  // Handle book selection
  const handleBookSelect = useCallback((value: string) => {
    if (value === '__new_book__') {
      setIsCreatingBook(true);
      setNewBookType('book');
    } else if (value === '__new_paper__') {
      setIsCreatingBook(true);
      setNewBookType('paper');
    } else {
      setSelectedBookUri(value);
      setIsCreatingBook(false);
    }
  }, []);

  // Create new book
  const handleCreateBook = useCallback(async () => {
    if (!newBookName.trim()) return;

    const now = Date.now();
    const bookId = `book-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const newBook = await createBook({
      id: bookId,
      name: newBookName.trim(),
      createdAt: now,
      updatedAt: now,
      tags: [],
      bookType: newBookType,
      chapters: [],
      passages: [],
      threads: [],
      sourceRefs: [],
      personaRefs: [],
      styleRefs: [],
      stats: {
        totalSources: 0,
        totalPassages: 0,
        approvedPassages: 0,
        gems: 0,
        chapters: 0,
        wordCount: 0,
      },
      status: 'drafting',
    });

    setSelectedBookUri(newBook.uri);
    setIsCreatingBook(false);
    setNewBookName('');
  }, [newBookName, createBook]);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    if (!selectedBookUri) return;

    onConfirm(
      selectedBookUri,
      action,
      chapterTitle,
      action !== 'new' ? selectedChapterId : undefined
    );
    onClose();
  }, [selectedBookUri, action, chapterTitle, selectedChapterId, onConfirm, onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="add-to-book-dialog__overlay" onClick={onClose}>
      <div
        className="add-to-book-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-book-title"
      >
        <header className="add-to-book-dialog__header">
          <h2 id="add-to-book-title">Add to Book</h2>
          <button
            className="add-to-book-dialog__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>

        <div className="add-to-book-dialog__content">
          {/* Content preview */}
          <div className="add-to-book-dialog__preview">
            <span className="add-to-book-dialog__preview-label">Content:</span>
            <span className="add-to-book-dialog__preview-text">
              {content.slice(0, 100)}
              {content.length > 100 ? '...' : ''}
            </span>
            <span className="add-to-book-dialog__preview-stats">
              {wordCount.toLocaleString()} words
            </span>
          </div>

          {/* Book selector */}
          <div className="add-to-book-dialog__field">
            <label htmlFor="book-select">Target Book</label>
            {isCreatingBook ? (
              <div className="add-to-book-dialog__create-book">
                <input
                  type="text"
                  placeholder={newBookType === 'paper' ? 'Paper name...' : 'Book name...'}
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  autoFocus
                />
                <button
                  className="add-to-book-dialog__btn add-to-book-dialog__btn--primary"
                  onClick={handleCreateBook}
                  disabled={!newBookName.trim()}
                >
                  Create {newBookType === 'paper' ? 'Paper' : 'Book'}
                </button>
                <button
                  className="add-to-book-dialog__btn"
                  onClick={() => setIsCreatingBook(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <select
                id="book-select"
                value={selectedBookUri}
                onChange={(e) => handleBookSelect(e.target.value)}
              >
                <option value="">Select a book...</option>
                <optgroup label="Create New">
                  <option value="__new_book__">+ New Book</option>
                  <option value="__new_paper__">+ New Paper (single chapter)</option>
                </optgroup>
                {books.length > 0 && (
                  <optgroup label="Existing Books">
                    {books.map((book) => (
                      <option key={book.uri} value={book.uri}>
                        {book.name} ({book.chapters.length} chapters)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Action selector - only show when book is selected */}
          {selectedBookUri && !isCreatingBook && (
            <>
              <div className="add-to-book-dialog__field">
                <label>Action</label>
                <div className="add-to-book-dialog__actions">
                  <label className="add-to-book-dialog__action">
                    <input
                      type="radio"
                      name="action"
                      value="new"
                      checked={action === 'new'}
                      onChange={() => setAction('new')}
                    />
                    <span>Add as new chapter</span>
                  </label>
                  {chapters.length > 0 && (
                    <>
                      <label className="add-to-book-dialog__action">
                        <input
                          type="radio"
                          name="action"
                          value="append"
                          checked={action === 'append'}
                          onChange={() => setAction('append')}
                        />
                        <span>Append to existing chapter</span>
                      </label>
                      <label className="add-to-book-dialog__action">
                        <input
                          type="radio"
                          name="action"
                          value="replace"
                          checked={action === 'replace'}
                          onChange={() => setAction('replace')}
                        />
                        <span>Replace chapter content</span>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Chapter title - for new chapters */}
              {action === 'new' && (
                <div className="add-to-book-dialog__field">
                  <label htmlFor="chapter-title">Chapter Title</label>
                  <input
                    id="chapter-title"
                    type="text"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder="Enter chapter title..."
                  />
                </div>
              )}

              {/* Chapter selector - for append/replace */}
              {(action === 'append' || action === 'replace') && chapters.length > 0 && (
                <div className="add-to-book-dialog__field">
                  <label htmlFor="chapter-select">Select Chapter</label>
                  <select
                    id="chapter-select"
                    value={selectedChapterId}
                    onChange={(e) => setSelectedChapterId(e.target.value)}
                  >
                    <option value="">Select a chapter...</option>
                    {chapters.map((chapter: DraftChapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.number}. {chapter.title} ({chapter.wordCount} words)
                      </option>
                    ))}
                  </select>
                  {action === 'replace' && selectedChapterId && (
                    <p className="add-to-book-dialog__warning">
                      Warning: This will replace the existing chapter content.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="add-to-book-dialog__footer">
          <button className="add-to-book-dialog__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="add-to-book-dialog__btn add-to-book-dialog__btn--primary"
            onClick={handleConfirm}
            disabled={
              !selectedBookUri ||
              isCreatingBook ||
              (action === 'new' && !chapterTitle.trim()) ||
              ((action === 'append' || action === 'replace') && !selectedChapterId)
            }
          >
            Add to Book
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AddToBookDialog;
