/**
 * FilesView - Local folder browser using File System Access API
 *
 * Allows users to browse and index local folders for text extraction.
 * Double-click or press Enter on a file to load it into the workspace.
 */

import { useState, useCallback } from 'react';
import type { IndexedFile, IndexedFolder, FilesystemIndex, IndexEvent } from '../../lib/filesystem';
import { FilesystemIndexer, pickAndIndexDirectory } from '../../lib/filesystem';
import { useBuffers } from '../../lib/buffer';

// ============================================
// Types
// ============================================

type ViewMode = 'empty' | 'indexing' | 'browsing';

interface FilesViewState {
  mode: ViewMode;
  index: FilesystemIndex | null;
  currentFolderId: string | null;
  selectedFileId: string | null;
  searchQuery: string;
  progress: number;
  currentFile: string;
  error: string | null;
}

// ============================================
// Helper Components
// ============================================

function FileIcon({ category }: { category: string }) {
  const icons: Record<string, string> = {
    document: '📄',
    code: '💻',
    data: '📊',
    image: '🖼️',
    video: '🎬',
    audio: '🎵',
    archive: '📦',
    unknown: '📎',
  };
  return <span className="files-view__icon">{icons[category] || '📎'}</span>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS when displaying file content
 * Necessary since files may contain malicious HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// Main Component
// ============================================

export function FilesView() {
  const { importText } = useBuffers();
  const [state, setState] = useState<FilesViewState>({
    mode: 'empty',
    index: null,
    currentFolderId: null,
    selectedFileId: null,
    searchQuery: '',
    progress: 0,
    currentFile: '',
    error: null,
  });
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);

  const handleOpenFolder = useCallback(async () => {
    // Check browser support
    if (!('showDirectoryPicker' in window)) {
      setState(prev => ({
        ...prev,
        error: 'File System Access API not supported. Please use Chrome, Edge, or another Chromium-based browser.',
      }));
      return;
    }

    setState(prev => ({ ...prev, mode: 'indexing', progress: 0, error: null }));

    const indexer = new FilesystemIndexer({
      maxDepth: -1,
      extractContent: true,
      previewLength: 500,
    });

    // Subscribe to progress events
    indexer.onEvent((event: IndexEvent) => {
      setState(prev => ({
        ...prev,
        progress: event.progress,
        currentFile: event.path,
      }));
    });

    try {
      const index = await pickAndIndexDirectory();

      if (index) {
        setState(prev => ({
          ...prev,
          mode: 'browsing',
          index,
          currentFolderId: index.rootFolderId,
          progress: 100,
        }));
      } else {
        // User cancelled
        setState(prev => ({ ...prev, mode: 'empty' }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        mode: 'empty',
        error: error instanceof Error ? error.message : 'Failed to index folder',
      }));
    }
  }, []);

  const navigateToFolder = useCallback((folderId: string) => {
    setState(prev => ({ ...prev, currentFolderId: folderId, selectedFileId: null }));
  }, []);

  const navigateUp = useCallback(() => {
    if (!state.index || !state.currentFolderId) return;

    const currentFolder = state.index.folders.get(state.currentFolderId);
    if (currentFolder?.parentId) {
      navigateToFolder(currentFolder.parentId);
    }
  }, [state.index, state.currentFolderId, navigateToFolder]);

  const selectFile = useCallback((fileId: string) => {
    setState(prev => ({ ...prev, selectedFileId: fileId }));
  }, []);

  // Load file content into workspace
  const loadFileToWorkspace = useCallback((file: IndexedFile) => {
    // Use full content if available, otherwise preview
    const content = file.content || file.preview;

    if (!content) {
      // No extractable content
      setState(prev => ({
        ...prev,
        error: `Cannot load ${file.name}: No text content extracted. File type: ${file.category}`
      }));
      return;
    }

    // Import to workspace via buffer system
    // Use 'manual' type for local files (closest match to user-imported content)
    importText(content, file.name, {
      type: 'manual',
      path: ['Local Files', file.path],  // Breadcrumb trail
    });
  }, [importText]);

  const handleSearch = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  // Get current folder and its contents
  const currentFolder = state.index?.folders.get(state.currentFolderId || '');
  const childFolders: IndexedFolder[] = currentFolder?.childFolderIds
    .map(id => state.index?.folders.get(id))
    .filter((f): f is IndexedFolder => !!f) || [];
  const childFiles: IndexedFile[] = currentFolder?.childFileIds
    .map(id => state.index?.files.get(id))
    .filter((f): f is IndexedFile => !!f) || [];

  // Filter by search if active
  const filteredFiles = state.searchQuery
    ? childFiles.filter(f =>
        f.name.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        f.preview?.toLowerCase().includes(state.searchQuery.toLowerCase())
      )
    : childFiles;

  // Note: selectedFile var removed - preview is now tooltip-only

  // ============================================
  // Render
  // ============================================

  // Empty state
  if (state.mode === 'empty') {
    return (
      <div className="files-view files-view--empty">
        <div className="files-view__empty-state">
          <span className="files-view__empty-icon">📁</span>
          <h3 className="files-view__empty-title">Local Files</h3>
          <p className="files-view__empty-text">
            Browse and index local folders. Text content will be extracted from documents.
          </p>
          {state.error && (
            <p className="files-view__error">{state.error}</p>
          )}
          <button
            className="files-view__open-button"
            onClick={handleOpenFolder}
          >
            Open Folder
          </button>
          <p className="files-view__privacy-note">
            Files are processed locally. Nothing is uploaded.
          </p>
        </div>
      </div>
    );
  }

  // Indexing state
  if (state.mode === 'indexing') {
    return (
      <div className="files-view files-view--indexing">
        <div className="files-view__indexing-state">
          <span className="files-view__indexing-icon">🔄</span>
          <h3 className="files-view__indexing-title">Indexing...</h3>
          <div className="files-view__progress-bar">
            <div
              className="files-view__progress-fill"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <p className="files-view__progress-text">
            {state.progress}% - {state.currentFile || 'Scanning...'}
          </p>
        </div>
      </div>
    );
  }

  // Get hovered file for tooltip
  const hoveredFile = hoveredFileId ? state.index?.files.get(hoveredFileId) : null;

  // Browsing state
  return (
    <div className="files-view files-view--browsing">
      {/* Header */}
      <header className="files-view__header">
        <div className="files-view__breadcrumb">
          {currentFolder && !currentFolder.isRoot && (
            <button
              className="files-view__back-button"
              onClick={navigateUp}
              title="Go up"
            >
              ← Up
            </button>
          )}
          <span className="files-view__folder-name">
            {currentFolder?.name || 'Root'}
          </span>
        </div>
        <div className="files-view__actions">
          <input
            type="text"
            className="files-view__search"
            placeholder="Search files..."
            value={state.searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <button
            className="files-view__refresh-button"
            onClick={handleOpenFolder}
            title="Open different folder"
          >
            📁
          </button>
        </div>
      </header>

      {/* Stats bar */}
      {state.index && (
        <div className="files-view__stats">
          <span>{state.index.stats.totalFiles} files</span>
          <span>{state.index.stats.totalFolders} folders</span>
          <span>{formatSize(state.index.stats.totalSize)}</span>
          {state.index.stats.extractedCount > 0 && (
            <span>{state.index.stats.extractedCount} with text</span>
          )}
        </div>
      )}

      {/* Error display */}
      {state.error && (
        <div className="files-view__error-banner">
          {state.error}
          <button onClick={() => setState(prev => ({ ...prev, error: null }))}>×</button>
        </div>
      )}

      {/* File list (single column) */}
      <div className="files-view__list">
        {/* Folders */}
        {childFolders.map(folder => (
          <button
            key={folder.id}
            className="files-view__item files-view__item--folder"
            onClick={() => navigateToFolder(folder.id)}
          >
            <span className="files-view__icon">📁</span>
            <span className="files-view__name">{folder.name}</span>
            <span className="files-view__meta">
              {folder.totalFiles} files
            </span>
          </button>
        ))}

        {/* Files - double-click to load into workspace */}
        {filteredFiles.map(file => (
          <button
            key={file.id}
            className={`files-view__item files-view__item--file ${
              state.selectedFileId === file.id ? 'files-view__item--selected' : ''
            } ${file.content || file.preview ? 'files-view__item--has-content' : ''}`}
            onClick={() => selectFile(file.id)}
            onDoubleClick={() => loadFileToWorkspace(file)}
            onMouseEnter={() => setHoveredFileId(file.id)}
            onMouseLeave={() => setHoveredFileId(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                loadFileToWorkspace(file);
              }
            }}
            title={file.content || file.preview ? 'Double-click to open in workspace' : `No text content (${file.category})`}
          >
            <FileIcon category={file.category} />
            <span className="files-view__name">{file.name}</span>
            <span className="files-view__meta">
              {formatSize(file.size)}
              {file.wordCount && ` · ${file.wordCount.toLocaleString()} words`}
            </span>
          </button>
        ))}

        {childFolders.length === 0 && filteredFiles.length === 0 && (
          <p className="files-view__empty-folder">
            {state.searchQuery ? 'No matching files' : 'Empty folder'}
          </p>
        )}
      </div>

      {/* Hover tooltip for file details */}
      {hoveredFile && (
        <div className="files-view__tooltip">
          <div className="files-view__tooltip-header">
            <FileIcon category={hoveredFile.category} />
            <strong>{hoveredFile.name}</strong>
          </div>
          <div className="files-view__tooltip-meta">
            <span>{formatSize(hoveredFile.size)}</span>
            <span>{formatDate(hoveredFile.modified)}</span>
            {hoveredFile.wordCount && <span>{hoveredFile.wordCount.toLocaleString()} words</span>}
            <span>{hoveredFile.format || hoveredFile.category}</span>
          </div>
          {hoveredFile.preview && (
            <pre className="files-view__tooltip-preview">
              {escapeHtml(hoveredFile.preview.substring(0, 200))}
              {hoveredFile.preview.length > 200 ? '...' : ''}
            </pre>
          )}
          {(hoveredFile.content || hoveredFile.preview) && (
            <p className="files-view__tooltip-hint">Double-click to open</p>
          )}
        </div>
      )}
    </div>
  );
}
