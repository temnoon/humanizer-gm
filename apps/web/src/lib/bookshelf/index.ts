/**
 * Bookshelf Module
 *
 * Reference-based architecture for books, personas, and styles
 */

export * from './types';
export { bookshelfService } from './BookshelfService';
export { BookshelfProvider, useBookshelf } from './BookshelfContext';
