/**
 * Filesystem Indexer
 *
 * Walks a directory tree using File System Access API,
 * classifies files, and extracts text content.
 */

import type {
  FilesystemIndex,
  IndexedFile,
  IndexedFolder,
  IndexOptions,
  IndexEvent,
  IndexEventHandler,
  FileCategory,
  DocumentFormat,
  FileSearchOptions,
  FileSearchResult,
} from './types';

// Extend FileSystemDirectoryHandle to include async iterator
declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    keys(): AsyncIterableIterator<string>;
  }
}
import { DEFAULT_INDEX_OPTIONS } from './types';
import {
  classifyFile,
  isExtractable,
  extractContent,
  generatePreview,
  getFileMetadata,
  getMimeType,
} from './readers';

// ============================================
// Utilities
// ============================================

/**
 * Generate a simple hash from a string (for IDs)
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate unique ID for a path
 */
function generateId(path: string): string {
  return `fs_${hashString(path)}_${Date.now().toString(36).slice(-4)}`;
}

// ============================================
// Filesystem Indexer Class
// ============================================

export class FilesystemIndexer {
  private index: FilesystemIndex;
  private options: IndexOptions;
  private eventHandlers: IndexEventHandler[] = [];
  private abortController: AbortController | null = null;

  constructor(options: Partial<IndexOptions> = {}) {
    this.options = { ...DEFAULT_INDEX_OPTIONS, ...options };
    this.index = this.createEmptyIndex('');
  }

  /**
   * Create empty index structure
   */
  private createEmptyIndex(rootPath: string): FilesystemIndex {
    return {
      rootPath,
      indexedAt: Date.now(),
      status: 'idle',
      progress: 0,
      folders: new Map(),
      files: new Map(),
      rootFolderId: '',
      stats: {
        totalFiles: 0,
        totalFolders: 0,
        totalSize: 0,
        byCategory: {} as Record<FileCategory, number>,
        byFormat: {} as Record<DocumentFormat, number>,
        extractedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      },
      errors: [],
    };
  }

  /**
   * Subscribe to indexing events
   */
  onEvent(handler: IndexEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Emit an event
   */
  private emit(event: IndexEvent): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  /**
   * Start indexing from a directory handle
   */
  async indexDirectory(
    directoryHandle: FileSystemDirectoryHandle
  ): Promise<FilesystemIndex> {
    this.abortController = new AbortController();
    this.index = this.createEmptyIndex(directoryHandle.name);
    this.index.status = 'scanning';

    this.emit({
      type: 'start',
      path: directoryHandle.name,
      progress: 0,
    });

    try {
      // First pass: scan directory structure
      const rootFolder = await this.scanFolder(directoryHandle, null, 0);
      this.index.rootFolderId = rootFolder.id;

      // Second pass: extract content
      if (this.options.extractContent) {
        this.index.status = 'extracting';
        await this.extractAllContent(directoryHandle);
      }

      this.index.status = 'complete';
      this.index.completedAt = Date.now();
      this.index.progress = 100;

      this.emit({
        type: 'complete',
        path: directoryHandle.name,
        progress: 100,
        stats: this.index.stats,
      });

      return this.index;
    } catch (error) {
      this.index.status = 'error';
      this.index.errors.push({
        path: directoryHandle.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      });

      this.emit({
        type: 'error',
        path: directoryHandle.name,
        progress: this.index.progress,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  /**
   * Scan a folder and its contents
   */
  private async scanFolder(
    dirHandle: FileSystemDirectoryHandle,
    parentId: string | null,
    depth: number
  ): Promise<IndexedFolder> {
    // Check abort signal
    if (this.abortController?.signal.aborted) {
      throw new Error('Indexing aborted');
    }

    // Check depth limit
    if (this.options.maxDepth !== -1 && depth > this.options.maxDepth!) {
      return this.createSkippedFolder(dirHandle.name, parentId);
    }

    // Skip excluded folders
    if (this.options.excludeFolders?.includes(dirHandle.name)) {
      return this.createSkippedFolder(dirHandle.name, parentId);
    }

    // Skip hidden folders if configured
    if (!this.options.includeHidden && dirHandle.name.startsWith('.')) {
      return this.createSkippedFolder(dirHandle.name, parentId);
    }

    const folderId = generateId(dirHandle.name + (parentId || 'root'));
    const folder: IndexedFolder = {
      id: folderId,
      path: dirHandle.name, // Note: File System Access API doesn't expose full paths
      name: dirHandle.name,
      parentId,
      childFolderIds: [],
      childFileIds: [],
      totalFiles: 0,
      totalFolders: 0,
      totalSize: 0,
      categoryStats: {} as Record<FileCategory, number>,
      isRoot: parentId === null,
    };

    // Iterate through entries
    for await (const entry of dirHandle.values()) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      if (entry.kind === 'directory') {
        const childFolder = await this.scanFolder(
          entry as FileSystemDirectoryHandle,
          folderId,
          depth + 1
        );
        folder.childFolderIds.push(childFolder.id);
        folder.totalFolders += 1 + childFolder.totalFolders;
        folder.totalFiles += childFolder.totalFiles;
        folder.totalSize += childFolder.totalSize;

        // Merge category stats
        for (const [cat, count] of Object.entries(childFolder.categoryStats)) {
          folder.categoryStats[cat as FileCategory] =
            (folder.categoryStats[cat as FileCategory] || 0) + count;
        }
      } else {
        const fileHandle = entry as FileSystemFileHandle;
        const indexedFile = await this.indexFile(fileHandle, folderId);

        if (indexedFile) {
          folder.childFileIds.push(indexedFile.id);
          folder.totalFiles++;
          folder.totalSize += indexedFile.size;
          folder.categoryStats[indexedFile.category] =
            (folder.categoryStats[indexedFile.category] || 0) + 1;
        }
      }
    }

    this.index.folders.set(folderId, folder);
    this.index.stats.totalFolders++;

    this.emit({
      type: 'folder',
      path: folder.name,
      progress: this.calculateProgress(),
    });

    return folder;
  }

  /**
   * Create a placeholder for skipped folders
   */
  private createSkippedFolder(name: string, parentId: string | null): IndexedFolder {
    return {
      id: generateId(name + (parentId || 'skipped')),
      path: name,
      name,
      parentId,
      childFolderIds: [],
      childFileIds: [],
      totalFiles: 0,
      totalFolders: 0,
      totalSize: 0,
      categoryStats: {} as Record<FileCategory, number>,
      isRoot: false,
    };
  }

  /**
   * Index a single file
   */
  private async indexFile(
    fileHandle: FileSystemFileHandle,
    parentId: string
  ): Promise<IndexedFile | null> {
    const name = fileHandle.name;
    const extension = name.split('.').pop()?.toLowerCase() ?? '';

    // Skip excluded extensions
    if (this.options.excludeExtensions?.includes(extension)) {
      this.index.stats.skippedCount++;
      return null;
    }

    // Check include list if specified
    if (
      this.options.includeExtensions &&
      this.options.includeExtensions.length > 0 &&
      !this.options.includeExtensions.includes(extension)
    ) {
      this.index.stats.skippedCount++;
      return null;
    }

    // Skip hidden files if configured
    if (!this.options.includeHidden && name.startsWith('.')) {
      this.index.stats.skippedCount++;
      return null;
    }

    try {
      const metadata = await getFileMetadata(fileHandle);

      // Skip files over size limit
      if (
        this.options.maxFileSize &&
        metadata.size > this.options.maxFileSize
      ) {
        this.index.stats.skippedCount++;
        return null;
      }

      const { category, format } = classifyFile(name);
      const fileId = generateId(name + parentId);

      const indexedFile: IndexedFile = {
        id: fileId,
        path: name,
        name,
        extension,
        category,
        format,
        size: metadata.size,
        modified: metadata.lastModified,
        mimeType: getMimeType(extension),
        parentId,
      };

      this.index.files.set(fileId, indexedFile);
      this.index.stats.totalFiles++;
      this.index.stats.totalSize += metadata.size;
      this.index.stats.byCategory[category] =
        (this.index.stats.byCategory[category] || 0) + 1;
      if (format) {
        this.index.stats.byFormat[format] =
          (this.index.stats.byFormat[format] || 0) + 1;
      }

      this.emit({
        type: 'file',
        path: name,
        progress: this.calculateProgress(),
      });

      return indexedFile;
    } catch (error) {
      this.index.errors.push({
        path: name,
        error: error instanceof Error ? error.message : 'Failed to index file',
        timestamp: Date.now(),
      });
      this.index.stats.errorCount++;
      return null;
    }
  }

  /**
   * Extract content from all extractable files
   */
  private async extractAllContent(
    dirHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    const extractableFiles = Array.from(this.index.files.values()).filter(
      (file) => isExtractable(file.category, file.format)
    );

    let processed = 0;
    const total = extractableFiles.length;

    for (const file of extractableFiles) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      try {
        // Navigate to file
        const fileHandle = await this.findFileHandle(dirHandle, file);

        if (fileHandle && file.format) {
          const { content, wordCount, charCount } = await extractContent(
            fileHandle,
            file.format
          );

          file.content = content;
          file.wordCount = wordCount;
          file.charCount = charCount;
          file.preview = generatePreview(content, this.options.previewLength);

          this.index.stats.extractedCount++;

          this.emit({
            type: 'extract',
            path: file.name,
            progress: Math.round((processed / total) * 50) + 50, // 50-100%
          });
        }
      } catch (error) {
        file.errors = file.errors || [];
        file.errors.push(
          error instanceof Error ? error.message : 'Extraction failed'
        );
        this.index.stats.errorCount++;
      }

      processed++;
      this.index.currentFile = file.name;
    }
  }

  /**
   * Find a file handle by navigating the directory tree
   */
  private async findFileHandle(
    dirHandle: FileSystemDirectoryHandle,
    file: IndexedFile
  ): Promise<FileSystemFileHandle | null> {
    // For now, search through all entries
    // In a real implementation, we'd track the path hierarchy
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name === file.name) {
        return entry as FileSystemFileHandle;
      }
      if (entry.kind === 'directory') {
        const found = await this.findFileHandle(
          entry as FileSystemDirectoryHandle,
          file
        );
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Calculate progress percentage
   */
  private calculateProgress(): number {
    // Simple heuristic: folders give rough progress
    const folderProgress =
      this.index.stats.totalFolders > 0
        ? Math.min(50, this.index.stats.totalFolders)
        : 0;
    return Math.round(folderProgress);
  }

  /**
   * Abort ongoing indexing
   */
  abort(): void {
    this.abortController?.abort();
  }

  /**
   * Get current index state
   */
  getIndex(): FilesystemIndex {
    return this.index;
  }

  /**
   * Search indexed files
   */
  searchFiles(options: FileSearchOptions = {}): FileSearchResult {
    const startTime = Date.now();
    let results = Array.from(this.index.files.values());

    // Filter by query (name and content)
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(
        (file) =>
          file.name.toLowerCase().includes(query) ||
          file.preview?.toLowerCase().includes(query) ||
          file.content?.toLowerCase().includes(query)
      );
    }

    // Filter by categories
    if (options.categories && options.categories.length > 0) {
      results = results.filter((file) =>
        options.categories!.includes(file.category)
      );
    }

    // Filter by formats
    if (options.formats && options.formats.length > 0) {
      results = results.filter(
        (file) => file.format && options.formats!.includes(file.format)
      );
    }

    // Filter by extensions
    if (options.extensions && options.extensions.length > 0) {
      results = results.filter((file) =>
        options.extensions!.includes(file.extension)
      );
    }

    // Filter by size
    if (options.minSize !== undefined) {
      results = results.filter((file) => file.size >= options.minSize!);
    }
    if (options.maxSize !== undefined) {
      results = results.filter((file) => file.size <= options.maxSize!);
    }

    // Filter by modified date
    if (options.modifiedAfter !== undefined) {
      results = results.filter(
        (file) => file.modified >= options.modifiedAfter!
      );
    }
    if (options.modifiedBefore !== undefined) {
      results = results.filter(
        (file) => file.modified <= options.modifiedBefore!
      );
    }

    // Sort
    if (options.sortBy) {
      results.sort((a, b) => {
        let cmp = 0;
        switch (options.sortBy) {
          case 'name':
            cmp = a.name.localeCompare(b.name);
            break;
          case 'modified':
            cmp = a.modified - b.modified;
            break;
          case 'size':
            cmp = a.size - b.size;
            break;
          case 'path':
            cmp = a.path.localeCompare(b.path);
            break;
        }
        return options.sortDir === 'desc' ? -cmp : cmp;
      });
    }

    const total = results.length;

    // Pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return {
      files: results,
      total,
      query: options.query,
      took: Date.now() - startTime,
    };
  }
}

// ============================================
// Convenience Functions
// ============================================

/**
 * Open a directory picker and index it
 */
export async function pickAndIndexDirectory(
  options?: Partial<IndexOptions>
): Promise<FilesystemIndex | null> {
  // Check if File System Access API is available
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API not supported in this browser');
  }

  try {
    const dirHandle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    const indexer = new FilesystemIndexer(options);
    return indexer.indexDirectory(dirHandle);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return null; // User cancelled
    }
    throw error;
  }
}
