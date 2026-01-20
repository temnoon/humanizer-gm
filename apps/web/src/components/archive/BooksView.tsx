/**
 * Books View - Simplified book project list
 *
 * Opens the Book Maker modal when a book is selected.
 * All book editing functionality is now in BookMakerModal.
 */

import { useState, useRef, useEffect } from 'react';
import { useBookshelf } from '../../lib/bookshelf';
import { useBookStudioOptional } from '../../lib/book-studio/BookStudioProvider';

interface BooksViewProps {
  /** Callback to open the Book Maker modal */
  onOpenBookMaker?: () => void;
}

export function BooksView({ onOpenBookMaker }: BooksViewProps) {
  const bookshelf = useBookshelf();
  const bookStudio = useBookStudioOptional();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('Untitled Book');
  const inputRef = useRef<HTMLInputElement>(null);

  // Use Book Studio books if available, otherwise fall back to bookshelf
  const books = bookStudio?.books ?? [];
  const isLoading = bookStudio?.isLoading ?? false;

  // Focus input when dialog opens
  useEffect(() => {
    if (showCreateDialog && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showCreateDialog]);

  // Handle book selection
  const handleSelectBook = async (bookId: string) => {
    if (bookStudio) {
      await bookStudio.actions.selectBook(bookId);
    }
    // Open the Book Maker modal
    onOpenBookMaker?.();
  };

  // Handle create new book - show dialog
  const handleCreateBook = () => {
    setNewBookTitle('Untitled Book');
    setShowCreateDialog(true);
  };

  // Submit new book creation
  const handleSubmitCreate = async () => {
    if (newBookTitle.trim()) {
      if (bookStudio) {
        const book = await bookStudio.actions.createBook(newBookTitle.trim());
        await bookStudio.actions.selectBook(book.id);
      }
      setShowCreateDialog(false);
      onOpenBookMaker?.();
    }
  };

  // Cancel dialog
  const handleCancelCreate = () => {
    setShowCreateDialog(false);
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  if (isLoading) {
    return (
      <div className="books-view">
        <div className="books-view__loading">Loading books...</div>
      </div>
    );
  }

  return (
    <div className="books-view">
      <div className="books-view__header">
        <h2 className="books-view__title">Books</h2>
        <button
          className="books-view__create-btn"
          onClick={handleCreateBook}
        >
          + New Book
        </button>
      </div>

      {books.length === 0 ? (
        <div className="books-view__empty">
          <div className="books-view__empty-icon">📚</div>
          <h3>No books yet</h3>
          <p>Create a book to start harvesting and organizing content.</p>
          <button
            className="books-view__create-btn books-view__create-btn--large"
            onClick={handleCreateBook}
          >
            Create Your First Book
          </button>
        </div>
      ) : (
        <div className="books-view__list">
          {books.map((book) => (
            <button
              key={book.id}
              className={`books-view__item ${bookStudio?.activeBookId === book.id ? 'books-view__item--active' : ''}`}
              onClick={() => handleSelectBook(book.id)}
            >
              <div className="books-view__item-icon">📖</div>
              <div className="books-view__item-content">
                <div className="books-view__item-title">{book.title}</div>
                {book.description && (
                  <div className="books-view__item-desc">{book.description}</div>
                )}
                <div className="books-view__item-meta">
                  {book.stagingCards?.length || 0} cards ·{' '}
                  {book.chapters?.length || 0} chapters
                  {book.updatedAt && ` · ${formatDate(book.updatedAt)}`}
                </div>
              </div>
              <div className="books-view__item-arrow">→</div>
            </button>
          ))}
        </div>
      )}

      <div className="books-view__hint">
        <kbd>⌘</kbd><kbd>⇧</kbd><kbd>B</kbd> to open Book Maker
      </div>

      {/* Create Book Dialog */}
      {showCreateDialog && (
        <div className="books-view__dialog-overlay" onClick={handleCancelCreate}>
          <div className="books-view__dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Book</h3>
            <input
              ref={inputRef}
              type="text"
              className="books-view__dialog-input"
              value={newBookTitle}
              onChange={(e) => setNewBookTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitCreate();
                if (e.key === 'Escape') handleCancelCreate();
              }}
              placeholder="Book title..."
            />
            <div className="books-view__dialog-actions">
              <button
                className="books-view__dialog-btn books-view__dialog-btn--cancel"
                onClick={handleCancelCreate}
              >
                Cancel
              </button>
              <button
                className="books-view__dialog-btn books-view__dialog-btn--create"
                onClick={handleSubmitCreate}
              >
                Create Book
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
