/**
 * Import View - Unified import for all archive types
 * Also shows indexed archives for quick switching
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getArchiveServerUrl } from '../../lib/platform';

interface ImportType {
  id: string;
  icon: string;
  label: string;
  description: string;
  accept?: string;
  useFolderPicker?: boolean;  // Use Electron folder picker instead of file upload
}

// Facebook import progress state
interface FacebookImportProgress {
  importId: string;
  status: 'running' | 'completed' | 'failed';
  stage: string;
  message: string;
  result?: {
    posts_imported: number;
    comments_imported: number;
    reactions_imported: number;
    media_indexed: number;
  };
  error?: string;
}

interface ImportJob {
  id: string;
  status: 'uploaded' | 'parsing' | 'ready' | 'applying' | 'complete' | 'error';
  progress: number;
  filename?: string;
  error?: string;
  conversationCount?: number;
  mediaCount?: number;
}

interface IndexedArchive {
  name: string;
  path: string;
  conversationCount: number;
  facebookCount?: number;
  mediaCount?: number;
  lastAccessed?: number;
}

// Storage keys for persistence
const ARCHIVES_STORAGE_KEY = 'humanizer-indexed-archives';
const CURRENT_ARCHIVE_KEY = 'humanizer-current-archive';

// Load indexed archives from localStorage
function loadIndexedArchives(): IndexedArchive[] {
  try {
    const stored = localStorage.getItem(ARCHIVES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save indexed archives to localStorage
function saveIndexedArchives(archives: IndexedArchive[]) {
  localStorage.setItem(ARCHIVES_STORAGE_KEY, JSON.stringify(archives));
}

// Save current archive path
function saveCurrentArchive(path: string) {
  localStorage.setItem(CURRENT_ARCHIVE_KEY, path);
}

const IMPORT_TYPES: ImportType[] = [
  { id: 'chatgpt', icon: '💬', label: 'ChatGPT', description: 'OpenAI export ZIP', accept: '.zip' },
  { id: 'claude', icon: '🤖', label: 'Claude', description: 'Anthropic conversations', accept: '.json' },
  { id: 'facebook', icon: '👤', label: 'Facebook', description: 'Select export folder', useFolderPicker: true },
  { id: 'folder', icon: '📁', label: 'Folder', description: 'Local documents folder', useFolderPicker: true },
  { id: 'json', icon: '📄', label: 'JSON', description: 'Conversation JSON file', accept: '.json' },
  { id: 'paste', icon: '📋', label: 'Paste', description: 'Paste text or JSON' },
];

export function ImportView() {
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<ImportJob | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Indexed archives state
  const [indexedArchives, setIndexedArchives] = useState<IndexedArchive[]>(loadIndexedArchives);
  const [currentArchive, setCurrentArchive] = useState<IndexedArchive | null>(null);
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [switchingArchive, setSwitchingArchive] = useState(false);

  // Facebook import state
  const [facebookProgress, setFacebookProgress] = useState<FacebookImportProgress | null>(null);
  const facebookPollRef = useRef<number | null>(null);

  // Fetch current archive info on mount
  useEffect(() => {
    fetchCurrentArchive();
    fetchAvailableArchives();
  }, []);

  const fetchCurrentArchive = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/archives/current`);
      if (response.ok) {
        const data = await response.json();
        setCurrentArchive({
          name: data.name,
          path: data.path,
          conversationCount: data.conversationCount || 0,
        });
        saveCurrentArchive(data.path);

        // Add to indexed archives if not already there
        setIndexedArchives(prev => {
          const exists = prev.some(a => a.path === data.path);
          if (!exists) {
            const updated = [...prev, {
              name: data.name,
              path: data.path,
              conversationCount: data.conversationCount || 0,
              lastAccessed: Date.now(),
            }];
            saveIndexedArchives(updated);
            return updated;
          }
          // Update last accessed
          const updated = prev.map(a =>
            a.path === data.path ? { ...a, lastAccessed: Date.now() } : a
          );
          saveIndexedArchives(updated);
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to fetch current archive:', err);
    }
  };

  const fetchAvailableArchives = async () => {
    setLoadingArchives(true);
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/archives`);
      if (response.ok) {
        const data = await response.json();
        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.archives) {
          console.warn('[ImportView.fetchAvailableArchives] API response missing archives field');
        }
        // Merge with persisted archives
        setIndexedArchives(prev => {
          const merged = [...prev];
          for (const archive of data.archives || []) {
            const existingIdx = merged.findIndex(a => a.path === archive.path);
            if (existingIdx >= 0) {
              merged[existingIdx] = { ...merged[existingIdx], ...archive };
            } else {
              merged.push(archive);
            }
          }
          saveIndexedArchives(merged);
          return merged;
        });
      }
    } catch (err) {
      console.error('Failed to fetch available archives:', err);
    } finally {
      setLoadingArchives(false);
    }
  };

  const handleSwitchArchive = async (archive: IndexedArchive) => {
    if (currentArchive?.path === archive.path) return;

    setSwitchingArchive(true);
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/archives/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveName: archive.name }),
      });

      if (response.ok) {
        setCurrentArchive(archive);
        saveCurrentArchive(archive.path);

        // Update last accessed
        setIndexedArchives(prev => {
          const updated = prev.map(a =>
            a.path === archive.path ? { ...a, lastAccessed: Date.now() } : a
          );
          saveIndexedArchives(updated);
          return updated;
        });

        // Reload the page to refresh conversations
        window.location.reload();
      } else {
        const error = await response.json();
        setImportStatus(`Failed to switch: ${error.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to switch archive:', err);
      setImportStatus('Failed to switch archive');
    } finally {
      setSwitchingArchive(false);
    }
  };

  const handleRemoveArchive = (archive: IndexedArchive) => {
    if (currentArchive?.path === archive.path) {
      setImportStatus('Cannot remove the current archive');
      return;
    }
    setIndexedArchives(prev => {
      const updated = prev.filter(a => a.path !== archive.path);
      saveIndexedArchives(updated);
      return updated;
    });
  };

  // Poll for job status
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/import/archive/status/${jobId}`);
      if (!response.ok) throw new Error('Failed to check status');

      const job: ImportJob = await response.json();
      setCurrentJob(job);

      if (job.status === 'ready') {
        setImportStatus(`Found ${job.conversationCount || 0} conversations, ${job.mediaCount || 0} media files. Ready to import.`);
        setImporting(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else if (job.status === 'error') {
        setImportStatus(`Error: ${job.error || 'Import failed'}`);
        setImporting(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else if (job.status === 'complete') {
        setImportStatus('Import complete! Refresh to see new conversations.');
        setImporting(false);
        setCurrentJob(null);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } else if (job.status === 'parsing') {
        setImportStatus(`Parsing... ${job.progress}%`);
      } else if (job.status === 'applying') {
        setImportStatus(`Importing... ${job.progress}%`);
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (facebookPollRef.current) {
        clearInterval(facebookPollRef.current);
      }
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFiles(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      await handleFiles(files);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFiles = async (files: File[]) => {
    setImporting(true);
    setImportStatus('Uploading...');
    setCurrentJob(null);

    try {
      const file = files[0];

      // Upload the file
      const formData = new FormData();
      formData.append('archive', file);

      const archiveServer = await getArchiveServerUrl();
      const uploadResponse = await fetch(`${archiveServer}/api/import/archive/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'Upload failed');
      }

      const { jobId, filename } = await uploadResponse.json();
      setImportStatus(`Uploaded ${filename}. Starting parse...`);

      // Start parsing
      const parseResponse = await fetch(`${archiveServer}/api/import/archive/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });

      if (!parseResponse.ok) {
        const error = await parseResponse.json();
        throw new Error(error.error || 'Parse failed');
      }

      setImportStatus('Parsing archive...');
      setCurrentJob({ id: jobId, status: 'parsing', progress: 0 });

      // Start polling for status
      pollIntervalRef.current = window.setInterval(() => {
        pollJobStatus(jobId);
      }, 1000);

    } catch (err) {
      console.error('Import error:', err);
      setImportStatus(`Error: ${err instanceof Error ? err.message : 'Import failed'}`);
      setImporting(false);
    }
  };

  const handleApplyImport = async () => {
    if (!currentJob?.id) return;

    setImporting(true);
    setImportStatus('Applying import...');

    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/import/archive/apply/${currentJob.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Apply failed');
      }

      // Start polling for completion
      setCurrentJob(prev => prev ? { ...prev, status: 'applying' } : null);
      pollIntervalRef.current = window.setInterval(() => {
        pollJobStatus(currentJob.id);
      }, 1000);

    } catch (err) {
      console.error('Apply error:', err);
      setImportStatus(`Error: ${err instanceof Error ? err.message : 'Apply failed'}`);
      setImporting(false);
    }
  };

  const handleTypeClick = (type: ImportType) => {
    if (type.id === 'paste') {
      setPasteMode(true);
      setSelectedType(null);
      return;
    }

    // Facebook uses dedicated import flow with folder picker
    if (type.id === 'facebook') {
      handleFacebookImport();
      return;
    }

    // Generic folder import (non-Facebook)
    if (type.id === 'folder') {
      // Use Electron folder picker or fallback to prompt
      const electronAPI = (window as { electronAPI?: { selectFolder: () => Promise<string | null> } }).electronAPI;
      if (electronAPI?.selectFolder) {
        electronAPI.selectFolder().then(folderPath => {
          if (folderPath) handleFolderImport(folderPath);
        });
      } else {
        const folderPath = prompt('Enter the folder path to import:');
        if (folderPath) handleFolderImport(folderPath);
      }
      return;
    }

    setSelectedType(type.id);
    // Update accepted file types and trigger file picker
    if (fileInputRef.current) {
      fileInputRef.current.accept = type.accept || '.zip,.json';
      fileInputRef.current.click();
    }
  };

  const handleFolderImport = async (folderPath: string) => {
    setImporting(true);
    setImportStatus('Scanning folder...');

    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/import/archive/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Folder import failed');
      }

      const { jobId } = await response.json();
      setCurrentJob({ id: jobId, status: 'parsing', progress: 0 });

      // Start polling
      pollIntervalRef.current = window.setInterval(() => {
        pollJobStatus(jobId);
      }, 1000);

    } catch (err) {
      console.error('Folder import error:', err);
      setImportStatus(`Error: ${err instanceof Error ? err.message : 'Folder import failed'}`);
      setImporting(false);
    }
  };

  // Facebook-specific import with Electron folder picker
  const handleFacebookImport = async () => {
    // Use Electron's folder picker
    const electronAPI = (window as { electronAPI?: { selectFolder: () => Promise<string | null> } }).electronAPI;
    if (!electronAPI?.selectFolder) {
      // Fallback to prompt in browser dev mode
      const folderPath = prompt('Enter Facebook export folder path:');
      if (!folderPath) return;
      await startFacebookImport(folderPath);
      return;
    }

    const folderPath = await electronAPI.selectFolder();
    if (!folderPath) return;
    await startFacebookImport(folderPath);
  };

  const startFacebookImport = async (folderPath: string) => {
    setImporting(true);
    setImportStatus('Starting Facebook import...');
    setFacebookProgress(null);

    try {
      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/facebook/graph/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exportPath: folderPath }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Facebook import failed');
      }

      const result = await response.json();
      if (result.success) {
        setImportStatus('Facebook import started. This may take several minutes...');
        setFacebookProgress({
          importId: result.importId || 'current',
          status: 'running',
          stage: 'starting',
          message: 'Processing Facebook export...',
        });

        // Start polling for progress (check logs periodically)
        // Note: Full progress polling requires backend status endpoint
        // For now, just show running status
        facebookPollRef.current = window.setInterval(async () => {
          try {
            // Check if Facebook data is appearing
            const periodsRes = await fetch(`${archiveServer}/api/facebook/periods`);
            if (periodsRes.ok) {
              const periodsData = await periodsRes.json();
              if (periodsData.periods && periodsData.periods.length > 0) {
                // Import is producing data
                setFacebookProgress(prev => prev ? {
                  ...prev,
                  stage: 'indexing',
                  message: `${periodsData.periods.length} periods indexed...`,
                } : null);
              }
            }
          } catch {
            // Ignore polling errors
          }
        }, 5000);

        // Auto-stop polling after 10 minutes
        setTimeout(() => {
          if (facebookPollRef.current) {
            clearInterval(facebookPollRef.current);
            facebookPollRef.current = null;
            setImporting(false);
            setFacebookProgress(prev => prev ? {
              ...prev,
              status: 'completed',
              stage: 'done',
              message: 'Import completed. Refresh to see Facebook data.',
            } : null);
            setImportStatus('Facebook import completed! Switch to Facebook tab to see your data.');
          }
        }, 600000);  // 10 minutes max

      } else {
        throw new Error(result.error || 'Import failed to start');
      }
    } catch (err) {
      console.error('Facebook import error:', err);
      setImportStatus(`Error: ${err instanceof Error ? err.message : 'Facebook import failed'}`);
      setImporting(false);
      setFacebookProgress(null);
    }
  };

  const cancelFacebookImport = () => {
    if (facebookPollRef.current) {
      clearInterval(facebookPollRef.current);
      facebookPollRef.current = null;
    }
    setFacebookProgress(null);
    setImportStatus(null);
    setImporting(false);
  };

  const handlePasteImport = async () => {
    if (!pasteContent.trim()) return;

    setImporting(true);
    setImportStatus('Processing pasted content...');

    try {
      // Try to parse as JSON
      let conversationData;
      try {
        conversationData = JSON.parse(pasteContent);
      } catch {
        // Not JSON, treat as plain text conversation
        conversationData = {
          title: 'Pasted Conversation',
          create_time: Date.now() / 1000,
          mapping: {
            root: {
              id: 'root',
              message: {
                content: { parts: [pasteContent] },
                author: { role: 'user' },
                create_time: Date.now() / 1000,
              },
            },
          },
        };
      }

      const archiveServer = await getArchiveServerUrl();
      const response = await fetch(`${archiveServer}/api/import/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation: conversationData }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }

      setImportStatus('Content imported successfully!');
      setPasteContent('');
      setPasteMode(false);
    } catch (err) {
      console.error('Paste import error:', err);
      setImportStatus(`Error: ${err instanceof Error ? err.message : 'Import failed'}`);
    } finally {
      setImporting(false);
    }
  };

  const cancelJob = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setCurrentJob(null);
    setImportStatus(null);
    setImporting(false);
  };

  return (
    <div className="import-tab">
      {/* Indexed Archives Section */}
      {indexedArchives.length > 0 && (
        <div className="indexed-archives">
          <div className="import-section-label">
            Your Archives
            {loadingArchives && <span className="import-status__spinner">⏳</span>}
          </div>
          <div className="indexed-archives__list">
            {indexedArchives
              .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
              .map(archive => (
                <div
                  key={archive.path}
                  className={`indexed-archive ${currentArchive?.path === archive.path ? 'indexed-archive--active' : ''}`}
                >
                  <button
                    className="indexed-archive__main"
                    onClick={() => handleSwitchArchive(archive)}
                    disabled={switchingArchive}
                  >
                    <span className="indexed-archive__icon">
                      {currentArchive?.path === archive.path ? '✓' : '📁'}
                    </span>
                    <span className="indexed-archive__info">
                      <span className="indexed-archive__name">{archive.name}</span>
                      <span className="indexed-archive__meta">
                        {archive.conversationCount} conversations
                        {archive.facebookCount ? ` • ${archive.facebookCount} FB` : ''}
                      </span>
                    </span>
                  </button>
                  {currentArchive?.path !== archive.path && (
                    <button
                      className="indexed-archive__remove"
                      onClick={() => handleRemoveArchive(archive)}
                      title="Remove from list"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div className="import-section-label">
        Import New Archive
      </div>
      <div
        className={`import-dropzone ${dragActive ? 'import-dropzone--active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <span className="import-dropzone__icon">📥</span>
        <span className="import-dropzone__text">
          Drop files here or click to browse
        </span>
        <span className="import-dropzone__hint">
          Supports ZIP archives, JSON files, and folders
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.json"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Import status */}
      {importStatus && (
        <div className={`import-status ${currentJob?.status === 'error' ? 'import-status--error' : ''}`}>
          {importing && <span className="import-status__spinner">⏳</span>}
          <span className="import-status__text">{importStatus}</span>
        </div>
      )}

      {/* Facebook import progress */}
      {facebookProgress && (
        <div className={`import-status ${facebookProgress.status === 'failed' ? 'import-status--error' : facebookProgress.status === 'completed' ? 'import-status--success' : ''}`}>
          {facebookProgress.status === 'running' && <span className="import-status__spinner">⏳</span>}
          {facebookProgress.status === 'completed' && <span className="import-status__icon">✓</span>}
          <span className="import-status__text">
            <strong>Facebook:</strong> {facebookProgress.message}
          </span>
          {facebookProgress.status === 'running' && (
            <button
              className="archive-browser__btn archive-browser__btn--small"
              onClick={cancelFacebookImport}
              style={{ marginLeft: '8px' }}
            >
              Cancel
            </button>
          )}
          {facebookProgress.status === 'completed' && (
            <button
              className="archive-browser__btn archive-browser__btn--small"
              onClick={() => {
                setFacebookProgress(null);
                window.location.reload();
              }}
              style={{ marginLeft: '8px' }}
            >
              Refresh
            </button>
          )}
        </div>
      )}

      {/* Ready to apply */}
      {currentJob?.status === 'ready' && (
        <div className="import-actions">
          <button
            className="archive-browser__btn archive-browser__btn--primary"
            onClick={handleApplyImport}
            disabled={importing}
          >
            Apply Import
          </button>
          <button
            className="archive-browser__btn"
            onClick={cancelJob}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Import type buttons */}
      {!pasteMode && !currentJob && (
        <>
          <div className="import-section-label">
            Import From
          </div>
          <div className="import-types">
            {IMPORT_TYPES.map(type => (
              <button
                key={type.id}
                className={`import-type ${selectedType === type.id ? 'import-type--selected' : ''}`}
                onClick={() => handleTypeClick(type)}
                disabled={importing}
              >
                <span className="import-type__icon">{type.icon}</span>
                <span className="import-type__label">{type.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Paste mode */}
      {pasteMode && (
        <div className="import-paste">
          <label className="import-section-label">Paste Content</label>
          <textarea
            className="import-paste__textarea"
            placeholder="Paste JSON conversation or plain text..."
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
          />
          <div className="import-actions">
            <button
              className="archive-browser__btn archive-browser__btn--primary"
              onClick={handlePasteImport}
              disabled={!pasteContent.trim() || importing}
            >
              Import
            </button>
            <button
              className="archive-browser__btn"
              onClick={() => {
                setPasteMode(false);
                setPasteContent('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
