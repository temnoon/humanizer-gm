/**
 * WelcomeScreen - Landing view with drag & drop file indexing
 *
 * Displays when no content is selected. Accepts file/folder drops
 * to index into the workspace.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { FilesystemIndexer } from '../../lib/filesystem/indexer';
import type { IndexEvent, FilesystemIndex } from '../../lib/filesystem/types';
import type { ArchiveSource } from '../../lib/buffer/types';
import { useBuffers } from '../../lib/buffer';
import { isElectron, getElectronAPI } from '../../lib/platform';

// ═══════════════════════════════════════════════════════════════════
// TYPE DECLARATIONS
// ═══════════════════════════════════════════════════════════════════

// File System Access API (not in all TypeScript lib versions)
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface IndexingProgress {
  status: 'idle' | 'scanning' | 'extracting' | 'importing' | 'complete' | 'error';
  progress: number;
  currentFile?: string;
  filesFound?: number;
  foldersFound?: number;
  filesImported?: number;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function WelcomeScreen() {
  const { importText } = useBuffers();
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<IndexingProgress>({ status: 'idle', progress: 0 });
  const indexerRef = useRef<FilesystemIndexer | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      indexerRef.current?.abort?.();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Handle indexed files → import to workspace
  // ─────────────────────────────────────────────────────────────────
  const importIndexedFiles = useCallback(async (index: FilesystemIndex) => {
    setProgress(p => ({ ...p, status: 'importing', filesImported: 0 }));

    const files = Array.from(index.files.values());
    let imported = 0;

    for (const file of files) {
      if (!file.content && !file.preview) continue;

      const content = file.content || file.preview || '';
      const source: Partial<ArchiveSource> = {
        type: 'filesystem',
        path: file.path.split('/').filter(Boolean),
        name: file.name,
      };

      // Import to workspace
      importText(content, file.name, source);
      imported++;

      setProgress(p => ({
        ...p,
        filesImported: imported,
        progress: Math.round((imported / files.length) * 100),
      }));
    }

    setProgress({
      status: 'complete',
      progress: 100,
      filesImported: imported,
      filesFound: index.stats.totalFiles,
      foldersFound: index.stats.totalFolders,
    });

    // Reset after delay
    setTimeout(() => {
      setProgress({ status: 'idle', progress: 0 });
    }, 3000);
  }, [importText]);

  // ─────────────────────────────────────────────────────────────────
  // Index a folder via File System Access API
  // ─────────────────────────────────────────────────────────────────
  const indexFolder = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const indexer = new FilesystemIndexer({
      extractContent: true,
      maxDepth: 10,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      excludeFolders: ['node_modules', '.git', '__pycache__', '.next', 'dist'],
    });
    indexerRef.current = indexer;

    // Subscribe to events
    unsubscribeRef.current = indexer.onEvent((event: IndexEvent) => {
      // All event types have progress - use file/folder/extract events to update
      if (event.type === 'file' || event.type === 'folder' || event.type === 'extract') {
        setProgress({
          status: event.progress < 50 ? 'scanning' : 'extracting',
          progress: event.progress,
          currentFile: event.path,
          filesFound: event.stats?.totalFiles,
          foldersFound: event.stats?.totalFolders,
        });
      } else if (event.type === 'error') {
        setProgress({
          status: 'error',
          progress: 0,
          error: event.error,
        });
      }
    });

    try {
      const index = await indexer.indexDirectory(handle);
      await importIndexedFiles(index);
    } catch (error) {
      setProgress({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : 'Failed to index folder',
      });
    }
  }, [importIndexedFiles]);

  // ─────────────────────────────────────────────────────────────────
  // Handle individual file drops
  // ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    setProgress({
      status: 'importing',
      progress: 0,
      filesFound: files.length,
      filesImported: 0,
    });

    let imported = 0;
    for (const file of files) {
      // Skip non-text files
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const textExtensions = [
        'txt', 'md', 'markdown', 'json', 'csv', 'xml', 'html', 'htm',
        'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
        'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'less', 'yaml', 'yml',
        'toml', 'ini', 'cfg', 'conf', 'sh', 'bash', 'zsh', 'ps1',
        'sql', 'graphql', 'prisma', 'env', 'gitignore', 'dockerfile',
      ];

      if (!textExtensions.includes(ext) && !file.type.startsWith('text/')) {
        continue;
      }

      try {
        const content = await file.text();
        const source: Partial<ArchiveSource> = {
          type: 'filesystem',
          path: [file.name],
          name: file.name,
        };

        importText(content, file.name, source);
        imported++;

        setProgress(p => ({
          ...p,
          filesImported: imported,
          progress: Math.round((imported / files.length) * 100),
        }));
      } catch (error) {
        console.error(`Failed to read ${file.name}:`, error);
      }
    }

    setProgress({
      status: 'complete',
      progress: 100,
      filesFound: files.length,
      filesImported: imported,
    });

    setTimeout(() => {
      setProgress({ status: 'idle', progress: 0 });
    }, 3000);
  }, [importText]);

  // ─────────────────────────────────────────────────────────────────
  // Drag & Drop handlers
  // ─────────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving the container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const items = Array.from(e.dataTransfer.items);

    // Try to get FileSystemHandle for folder support
    const handles: FileSystemHandle[] = [];
    const files: File[] = [];

    for (const item of items) {
      if (item.kind === 'file') {
        // Try to get handle (for folders)
        if ('getAsFileSystemHandle' in item) {
          try {
            const handle = await (item as DataTransferItem & {
              getAsFileSystemHandle(): Promise<FileSystemHandle>
            }).getAsFileSystemHandle();
            if (handle) {
              handles.push(handle);
              continue;
            }
          } catch {
            // Fall back to File API
          }
        }

        // Fall back to File API
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    // Process handles (folders and files)
    for (const handle of handles) {
      if (handle.kind === 'directory') {
        await indexFolder(handle as FileSystemDirectoryHandle);
      } else if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        files.push(file);
      }
    }

    // Process regular files
    if (files.length > 0) {
      await handleFiles(files);
    }
  }, [indexFolder, handleFiles]);

  // ─────────────────────────────────────────────────────────────────
  // Folder picker (Electron or File System Access API)
  // ─────────────────────────────────────────────────────────────────
  const handlePickFolder = useCallback(async () => {
    if (isElectron) {
      const api = getElectronAPI();
      if (api) {
        const folderPath = await api.dialog.selectFolder();
        if (folderPath) {
          // In Electron, we'd need IPC to read folder contents
          // For now, prompt user to drag & drop
          console.log('Selected folder:', folderPath);
        }
      }
    } else if (window.showDirectoryPicker) {
      // Use File System Access API picker
      try {
        const handle = await window.showDirectoryPicker({
          mode: 'read',
        });
        await indexFolder(handle);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to pick directory:', error);
        }
      }
    }
  }, [indexFolder]);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  const isProcessing = progress.status !== 'idle' && progress.status !== 'complete';

  return (
    <div
      className={`workspace workspace--empty welcome-screen ${dragActive ? 'welcome-screen--drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="File drop zone. Drag files or folders here to index, or use the button to choose a folder."
    >
      <div className="workspace__placeholder">
        <h1>humanizer</h1>
        <p className="workspace__tagline">
          *Infrastructure for reclaiming subjective agency*
        </p>

        {progress.status === 'idle' && (
          <>
            <hr className="workspace__divider" aria-hidden="true" />
            <div className="welcome-screen__drop-hint">
              <p className="welcome-screen__instruction">
                Drop files or folders here to index
              </p>
              <p className="welcome-screen__alt">
                or <button
                  className="welcome-screen__picker-btn"
                  onClick={handlePickFolder}
                  type="button"
                  aria-label="Choose a folder to index"
                >
                  choose a folder
                </button>
              </p>
            </div>
            <p className="welcome-screen__nav-hint">
              Use Tab to access Archive panel (left) or Tools panel (right)
            </p>
          </>
        )}

        {isProcessing && (
          <div
            className="welcome-screen__progress"
            role="progressbar"
            aria-valuenow={progress.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`File indexing: ${progress.progress}% complete`}
          >
            <div
              className="welcome-screen__progress-status"
              aria-live="polite"
              aria-atomic="true"
            >
              {progress.status === 'scanning' && 'Scanning...'}
              {progress.status === 'extracting' && 'Extracting content...'}
              {progress.status === 'importing' && 'Importing to workspace...'}
            </div>
            <div className="welcome-screen__progress-bar">
              <div
                className="welcome-screen__progress-fill"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <div className="welcome-screen__progress-details">
              {progress.currentFile && (
                <span className="welcome-screen__current-file">
                  {progress.currentFile}
                </span>
              )}
              {progress.filesFound !== undefined && (
                <span className="welcome-screen__file-count">
                  {progress.filesImported ?? 0} / {progress.filesFound} files
                </span>
              )}
            </div>
          </div>
        )}

        {progress.status === 'complete' && (
          <div
            className="welcome-screen__complete"
            role="status"
            aria-live="polite"
          >
            <span className="welcome-screen__check" aria-hidden="true">✓</span>
            <span>
              Successfully imported {progress.filesImported} file{progress.filesImported !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {progress.status === 'error' && (
          <div
            className="welcome-screen__error"
            role="alert"
            aria-live="assertive"
          >
            <span className="welcome-screen__error-icon" aria-hidden="true">!</span>
            <span>Error: {progress.error || 'An error occurred. Please try again.'}</span>
          </div>
        )}
      </div>

      {/* Drag overlay - decorative visual feedback */}
      {dragActive && (
        <div className="welcome-screen__drag-overlay" aria-hidden="true" role="presentation">
          <div className="welcome-screen__drag-icon">↓</div>
          <div className="welcome-screen__drag-text">Drop to index</div>
        </div>
      )}
    </div>
  );
}
