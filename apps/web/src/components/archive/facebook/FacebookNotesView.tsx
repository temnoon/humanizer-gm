/**
 * Facebook Notes View
 *
 * Displays Facebook Notes with expansion and search.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SelectedFacebookContent } from '../types';
import type { NoteItem } from './shared';
import { formatDate } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';
import { formatTextForDisplay } from '../../../lib/utils/textCleaner';

export interface FacebookNotesViewProps {
  onSelectContent?: (content: SelectedFacebookContent) => void;
}

export function FacebookNotesView({ onSelectContent }: FacebookNotesViewProps) {
  // Notes state
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesOffset, setNotesOffset] = useState(0);
  const [notesHasMore, setNotesHasMore] = useState(true);
  const [notesSearch, setNotesSearch] = useState('');
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [expandedNoteText, setExpandedNoteText] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Ref for infinite scroll
  const notesObserverRef = useRef<HTMLDivElement>(null);

  // Load notes
  const loadNotes = useCallback(async (reset = false) => {
    if (notesLoading) return;
    setNotesLoading(true);

    try {
      const currentOffset = reset ? 0 : notesOffset;
      const params = new URLSearchParams({
        limit: '50',
        offset: currentOffset.toString(),
      });

      if (notesSearch.trim()) {
        params.append('search', notesSearch.trim());
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/notes?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.notes) {
        console.warn('[FacebookNotesView.loadNotes] API response missing notes field');
      }

      const loadedNotes: NoteItem[] = (data.notes || []).map((n: {
        id: string;
        title: string;
        wordCount: number;
        charCount: number;
        createdTimestamp: number;
        updatedTimestamp?: number;
        hasMedia: boolean;
        mediaCount: number;
        tags?: string;
      }) => ({
        id: n.id,
        title: n.title,
        wordCount: n.wordCount,
        charCount: n.charCount,
        createdTimestamp: n.createdTimestamp,
        updatedTimestamp: n.updatedTimestamp,
        hasMedia: n.hasMedia,
        mediaCount: n.mediaCount,
        tags: n.tags ? (typeof n.tags === 'string' ? JSON.parse(n.tags) : n.tags) : [],
      }));

      if (reset) {
        setNotes(loadedNotes);
        setNotesOffset(50);
      } else {
        setNotes(prev => [...prev, ...loadedNotes]);
        setNotesOffset(prev => prev + 50);
      }

      setNotesHasMore(loadedNotes.length === 50);
    } catch (err) {
      console.error('Failed to load notes:', err);
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setNotesLoading(false);
    }
  }, [notesOffset, notesLoading, notesSearch]);

  // Load full note detail
  const loadNoteDetail = async (noteId: string) => {
    if (expandedNoteId === noteId) {
      setExpandedNoteId(null);
      setExpandedNoteText(null);
      return;
    }

    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/notes/${noteId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const note = await res.json();
      setExpandedNoteId(noteId);
      setExpandedNoteText(note.text || '');
    } catch (err) {
      console.error('Failed to load note detail:', err);
    }
  };

  // Load on mount
  useEffect(() => {
    loadNotes(true);
  }, []);

  // Reload notes when search changes
  useEffect(() => {
    const debounce = setTimeout(() => {
      setNotes([]);
      setNotesOffset(0);
      setNotesHasMore(true);
      loadNotes(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [notesSearch]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && notesHasMore && !notesLoading) {
          loadNotes();
        }
      },
      { threshold: 0.1 }
    );

    const target = notesObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [notesHasMore, notesLoading, loadNotes]);

  return (
    <div className="facebook-view__notes">
      {/* Notes search */}
      <div className="facebook-view__filters">
        <input
          type="text"
          className="facebook-view__search"
          placeholder="Search notes..."
          value={notesSearch}
          onChange={(e) => setNotesSearch(e.target.value)}
        />
      </div>

      {/* Notes list */}
      <div className="facebook-view__notes-list">
        {error && <div className="facebook-view__error">{error}</div>}

        {notes.length === 0 && !notesLoading && (
          <div className="facebook-view__empty">
            <p>No notes found</p>
            <span>Import your Facebook archive to see your Notes</span>
          </div>
        )}

        {notes.map((note) => (
          <div
            key={note.id}
            className={`facebook-view__note ${expandedNoteId === note.id ? 'facebook-view__note--expanded' : ''}`}
          >
            <div
              className="facebook-view__note-header"
              onClick={() => loadNoteDetail(note.id)}
            >
              <div className="facebook-view__note-title">{note.title}</div>
              <div className="facebook-view__note-meta">
                <span className="facebook-view__note-words">{note.wordCount.toLocaleString()} words</span>
                <span className="facebook-view__note-date">{formatDate(note.createdTimestamp)}</span>
                {note.hasMedia && (
                  <span className="facebook-view__note-media">{note.mediaCount} media</span>
                )}
              </div>
            </div>

            {expandedNoteId === note.id && expandedNoteText && (() => {
              const cleanedNoteText = formatTextForDisplay(expandedNoteText);
              return (
                <div className="facebook-view__note-content">
                  <div className="facebook-view__note-text">
                    {cleanedNoteText.split('\n').map((line, i) => (
                      <p key={i}>{line || '\u00A0'}</p>
                    ))}
                  </div>
                  <div className="facebook-view__note-actions">
                    <button
                      className="facebook-view__note-select"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSelectContent) {
                          onSelectContent({
                            id: note.id,
                            type: 'post',
                            source: 'facebook',
                            text: cleanedNoteText,
                            title: note.title,
                            created_at: note.createdTimestamp,
                            is_own_content: true,
                          });
                        }
                      }}
                    >
                      Open in Workspace
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        ))}

        {notesLoading && <div className="facebook-view__loading">Loading notes...</div>}
        <div ref={notesObserverRef} className="facebook-view__observer-spacer" />
      </div>
    </div>
  );
}
