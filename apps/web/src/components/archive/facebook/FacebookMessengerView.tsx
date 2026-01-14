/**
 * Facebook Messenger View
 *
 * Displays Messenger threads with expandable messages.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MessengerThread, MessengerMessage } from './shared';
import { formatDate } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';

export interface FacebookMessengerViewProps {
  // Currently no callbacks needed, but kept for future use
}

export function FacebookMessengerView(_props: FacebookMessengerViewProps) {
  // Messenger state
  const [messengerThreads, setMessengerThreads] = useState<MessengerThread[]>([]);
  const [messengerLoading, setMessengerLoading] = useState(false);
  const [messengerOffset, setMessengerOffset] = useState(0);
  const [messengerHasMore, setMessengerHasMore] = useState(true);
  const [messengerSearch, setMessengerSearch] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessengerMessage[]>([]);
  const [threadMessagesLoading, setThreadMessagesLoading] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Ref for infinite scroll
  const messengerObserverRef = useRef<HTMLDivElement>(null);

  // Load messenger threads
  const loadMessengerThreads = useCallback(async (reset = false) => {
    if (messengerLoading) return;
    setMessengerLoading(true);

    try {
      const currentOffset = reset ? 0 : messengerOffset;
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/messenger/threads?limit=50&offset=${currentOffset}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      let threads: MessengerThread[] = data.threads || [];

      // Client-side search filter
      if (messengerSearch.trim()) {
        const q = messengerSearch.toLowerCase();
        threads = threads.filter((t: MessengerThread) =>
          t.title?.toLowerCase().includes(q)
        );
      }

      if (reset) {
        setMessengerThreads(threads);
        setMessengerOffset(50);
      } else {
        setMessengerThreads(prev => [...prev, ...threads]);
        setMessengerOffset(prev => prev + 50);
      }

      setMessengerHasMore(data.threads?.length === 50);
    } catch (err) {
      console.error('Failed to load messenger threads:', err);
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setMessengerLoading(false);
    }
  }, [messengerOffset, messengerLoading, messengerSearch]);

  // Load thread messages
  const loadThreadMessages = async (threadId: string) => {
    if (selectedThreadId === threadId) {
      setSelectedThreadId(null);
      setThreadMessages([]);
      return;
    }

    setThreadMessagesLoading(true);
    setSelectedThreadId(threadId);
    setThreadMessages([]);

    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/messenger/thread/${encodeURIComponent(threadId)}?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setThreadMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load thread messages:', err);
    } finally {
      setThreadMessagesLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    loadMessengerThreads(true);
  }, []);

  // Reload messenger when search changes
  useEffect(() => {
    const debounce = setTimeout(() => {
      setMessengerThreads([]);
      setMessengerOffset(0);
      setMessengerHasMore(true);
      loadMessengerThreads(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [messengerSearch]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && messengerHasMore && !messengerLoading) {
          loadMessengerThreads();
        }
      },
      { threshold: 0.1 }
    );

    const target = messengerObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [messengerHasMore, messengerLoading, loadMessengerThreads]);

  return (
    <div className="facebook-view__messenger">
      {/* Messenger search */}
      <div className="facebook-view__filters">
        <input
          type="text"
          className="facebook-view__search"
          placeholder="Search conversations..."
          value={messengerSearch}
          onChange={(e) => setMessengerSearch(e.target.value)}
        />
      </div>

      {/* Threads list */}
      <div className="facebook-view__threads-list">
        {error && <div className="facebook-view__error">{error}</div>}

        {messengerThreads.length === 0 && !messengerLoading && (
          <div className="facebook-view__empty">
            <p>No messenger threads found</p>
            <span>Import your Facebook archive to see your Messenger conversations</span>
          </div>
        )}

        {messengerThreads.map((thread) => (
          <div
            key={thread.thread_id}
            className={`facebook-view__thread ${selectedThreadId === thread.thread_id ? 'facebook-view__thread--expanded' : ''}`}
          >
            <div
              className="facebook-view__thread-header"
              onClick={() => loadThreadMessages(thread.thread_id)}
            >
              <div className="facebook-view__thread-title">
                {thread.title || '[Unknown Thread]'}
              </div>
              <div className="facebook-view__thread-stats">
                <span className="facebook-view__thread-count">
                  {thread.message_count.toLocaleString()} messages
                </span>
                <span className="facebook-view__thread-date">
                  Last: {formatDate(thread.last_message)}
                </span>
              </div>
            </div>

            {/* Expanded thread messages */}
            {selectedThreadId === thread.thread_id && (
              <div className="facebook-view__thread-messages">
                {threadMessagesLoading && (
                  <div className="facebook-view__loading">Loading messages...</div>
                )}

                {!threadMessagesLoading && threadMessages.length === 0 && (
                  <div className="facebook-view__empty">
                    <p>No messages in this thread</p>
                  </div>
                )}

                {!threadMessagesLoading && threadMessages.map((msg, idx) => (
                  <div
                    key={`${msg.id}-${idx}`}
                    className={`facebook-view__message ${msg.is_own_content ? 'facebook-view__message--own' : 'facebook-view__message--other'}`}
                  >
                    <div className="facebook-view__message-header">
                      <span className="facebook-view__message-author">
                        {msg.author_name}
                      </span>
                      <span className="facebook-view__message-time">
                        {formatDate(msg.created_at)}
                      </span>
                    </div>
                    <div className="facebook-view__message-text">
                      {msg.text || '[Media/Call]'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {messengerLoading && <div className="facebook-view__loading">Loading threads...</div>}
        <div ref={messengerObserverRef} className="facebook-view__observer-spacer" />
      </div>
    </div>
  );
}
