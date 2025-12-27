/**
 * Filesystem Archive Module
 *
 * Index and browse local filesystem directories using the File System Access API.
 */

// Types
export type {
  FileCategory,
  DocumentFormat,
  IndexedFile,
  IndexedFolder,
  FilesystemIndex,
  IndexStats,
  IndexError,
  IndexOptions,
  IndexEvent,
  IndexEventType,
  IndexEventHandler,
  FileSearchOptions,
  FileSearchResult,
} from './types';

export { DEFAULT_INDEX_OPTIONS } from './types';

// Readers
export {
  classifyFile,
  isExtractable,
  extractContent,
  generatePreview,
  getFileMetadata,
  getMimeType,
  readFileAsText,
  readFileAsBuffer,
} from './readers';

// Indexer
export {
  FilesystemIndexer,
  pickAndIndexDirectory,
} from './indexer';

// Summarization
export {
  summarizeText,
  summarizeFiles,
  clearSummaryCache,
  shouldSummarize,
  estimateSummarizationTime,
  type SummarizationOptions,
  type SummarizationResult,
  type FileSummary,
} from './summarization';
