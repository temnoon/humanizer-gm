/**
 * Bookshelf Module
 *
 * Reference-based architecture for books, personas, and styles.
 * Includes HarvestBucket system for staging content before commit.
 */

export * from './types';
export { bookshelfService } from './BookshelfService';
export { BookshelfProvider, useBookshelf } from './BookshelfContext';
export { harvestBucketService } from './HarvestBucketService';
