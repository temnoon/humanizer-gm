/**
 * Book Module - DEPRECATED
 *
 * This module has been consolidated into BookshelfContext.
 * See Phase 4.2 of Xanadu unified storage migration.
 *
 * Use imports from '../bookshelf' instead:
 *   import { useBookshelf, BookshelfProvider } from '../bookshelf';
 *
 * Migration completed: January 5, 2026
 */

// Re-export from bookshelf for backwards compatibility during transition
export {
  useBookshelf as useBook,
  useBookshelf as useBookOptional,
  BookshelfProvider as BookProvider,
} from '../bookshelf';

console.warn(
  '[DEPRECATED] lib/book module is deprecated. ' +
  'Import from lib/bookshelf instead. ' +
  'See Phase 4.2 Xanadu migration.'
);
