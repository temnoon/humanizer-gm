/**
 * Filesystem Archive Types
 *
 * Types for indexing and browsing local filesystem archives
 */

// ============================================
// File Classification
// ============================================

export type FileCategory =
  | 'document'      // txt, md, doc, docx, pdf
  | 'code'          // js, ts, py, etc.
  | 'data'          // json, csv, xml
  | 'image'         // jpg, png, gif, webp
  | 'video'         // mp4, mov, webm
  | 'audio'         // mp3, wav, m4a
  | 'archive'       // zip, tar, gz
  | 'unknown';

export type DocumentFormat =
  | 'plaintext'     // .txt
  | 'markdown'      // .md, .mdx
  | 'word'          // .doc, .docx
  | 'pdf'           // .pdf
  | 'rtf'           // .rtf
  | 'html'          // .html, .htm
  | 'json'          // .json (for data documents)
  | 'unknown';

// ============================================
// Indexed Items
// ============================================

export interface IndexedFile {
  /** Unique identifier (content hash or path hash) */
  id: string;
  /** Absolute file path */
  path: string;
  /** File name with extension */
  name: string;
  /** File extension (lowercase, without dot) */
  extension: string;
  /** File category */
  category: FileCategory;
  /** Document format (for documents) */
  format?: DocumentFormat;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: number;
  /** Created timestamp (if available) */
  created?: number;
  /** Extracted text preview (first ~500 chars) */
  preview?: string;
  /** Full extracted text (lazy loaded) */
  content?: string;
  /** Word count (for text files) */
  wordCount?: number;
  /** Character count */
  charCount?: number;
  /** MIME type */
  mimeType?: string;
  /** Parent folder ID */
  parentId: string;
  /** Indexing errors if any */
  errors?: string[];
}

export interface IndexedFolder {
  /** Unique identifier (path hash) */
  id: string;
  /** Absolute folder path */
  path: string;
  /** Folder name */
  name: string;
  /** Parent folder ID (null for root) */
  parentId: string | null;
  /** Direct child folder IDs */
  childFolderIds: string[];
  /** Direct child file IDs */
  childFileIds: string[];
  /** Total file count (recursive) */
  totalFiles: number;
  /** Total folder count (recursive) */
  totalFolders: number;
  /** Total size in bytes (recursive) */
  totalSize: number;
  /** Category breakdown */
  categoryStats: Record<FileCategory, number>;
  /** Is this the root folder? */
  isRoot: boolean;
}

// ============================================
// Index State
// ============================================

export interface FilesystemIndex {
  /** Root folder being indexed */
  rootPath: string;
  /** When indexing started */
  indexedAt: number;
  /** When indexing completed */
  completedAt?: number;
  /** Indexing status */
  status: 'idle' | 'scanning' | 'extracting' | 'complete' | 'error';
  /** Progress percentage (0-100) */
  progress: number;
  /** Current file being processed */
  currentFile?: string;
  /** All indexed folders by ID */
  folders: Map<string, IndexedFolder>;
  /** All indexed files by ID */
  files: Map<string, IndexedFile>;
  /** Root folder ID */
  rootFolderId: string;
  /** Total stats */
  stats: IndexStats;
  /** Any errors encountered */
  errors: IndexError[];
}

export interface IndexStats {
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  byCategory: Record<FileCategory, number>;
  byFormat: Record<DocumentFormat, number>;
  extractedCount: number;
  skippedCount: number;
  errorCount: number;
}

export interface IndexError {
  path: string;
  error: string;
  timestamp: number;
}

// ============================================
// Options
// ============================================

export interface IndexOptions {
  /** Maximum depth to traverse (0 = root only, -1 = unlimited) */
  maxDepth?: number;
  /** File extensions to include (empty = all) */
  includeExtensions?: string[];
  /** File extensions to exclude */
  excludeExtensions?: string[];
  /** Folder names to exclude */
  excludeFolders?: string[];
  /** Maximum file size to index (bytes) */
  maxFileSize?: number;
  /** Extract text content from documents */
  extractContent?: boolean;
  /** Preview length (chars) */
  previewLength?: number;
  /** Follow symlinks */
  followSymlinks?: boolean;
  /** Include hidden files/folders (starting with .) */
  includeHidden?: boolean;
}

export const DEFAULT_INDEX_OPTIONS: IndexOptions = {
  maxDepth: -1, // Unlimited
  excludeExtensions: ['exe', 'dll', 'so', 'dylib', 'bin'],
  excludeFolders: ['node_modules', '.git', '__pycache__', '.DS_Store', 'dist', 'build'],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  extractContent: true,
  previewLength: 500,
  followSymlinks: false,
  includeHidden: false,
};

// ============================================
// Events
// ============================================

export type IndexEventType =
  | 'start'
  | 'folder'
  | 'file'
  | 'extract'
  | 'error'
  | 'complete';

export interface IndexEvent {
  type: IndexEventType;
  path: string;
  progress: number;
  stats?: Partial<IndexStats>;
  error?: string;
}

export type IndexEventHandler = (event: IndexEvent) => void;

// ============================================
// Search/Filter
// ============================================

export interface FileSearchOptions {
  /** Text query (searches name and content) */
  query?: string;
  /** Filter by category */
  categories?: FileCategory[];
  /** Filter by format */
  formats?: DocumentFormat[];
  /** Filter by extension */
  extensions?: string[];
  /** Minimum file size */
  minSize?: number;
  /** Maximum file size */
  maxSize?: number;
  /** Modified after date */
  modifiedAfter?: number;
  /** Modified before date */
  modifiedBefore?: number;
  /** Filter by folder path prefix */
  pathPrefix?: string;
  /** Sort field */
  sortBy?: 'name' | 'modified' | 'size' | 'path';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface FileSearchResult {
  files: IndexedFile[];
  total: number;
  query?: string;
  took: number; // milliseconds
}
