/**
 * Facebook Groups View
 *
 * Displays Facebook Groups with expandable content.
 * Extracted from FacebookView for modularization.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SelectedFacebookContent } from '../types';
import type { GroupItem, GroupContentItem } from './shared';
import { formatDate } from './shared';
import { getArchiveServerUrl } from '../../../lib/platform';

export interface FacebookGroupsViewProps {
  onSelectContent?: (content: SelectedFacebookContent) => void;
}

export function FacebookGroupsView({ onSelectContent }: FacebookGroupsViewProps) {
  // Groups state
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsOffset, setGroupsOffset] = useState(0);
  const [groupsHasMore, setGroupsHasMore] = useState(true);
  const [groupsSearch, setGroupsSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupContent, setGroupContent] = useState<GroupContentItem[]>([]);
  const [groupContentLoading, setGroupContentLoading] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Ref for infinite scroll
  const groupsObserverRef = useRef<HTMLDivElement>(null);

  // Load groups
  const loadGroups = useCallback(async (reset = false) => {
    if (groupsLoading) return;
    setGroupsLoading(true);

    try {
      const currentOffset = reset ? 0 : groupsOffset;
      const params = new URLSearchParams({
        limit: '50',
        offset: currentOffset.toString(),
        sortBy: 'activity',
      });

      if (groupsSearch.trim()) {
        params.append('search', groupsSearch.trim());
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/groups?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const loadedGroups: GroupItem[] = data.groups || [];

      if (reset) {
        setGroups(loadedGroups);
        setGroupsOffset(50);
      } else {
        setGroups(prev => [...prev, ...loadedGroups]);
        setGroupsOffset(prev => prev + 50);
      }

      setGroupsHasMore(loadedGroups.length === 50);
    } catch (err) {
      console.error('Failed to load groups:', err);
      setError(err instanceof Error ? err.message : 'Failed to load groups');
    } finally {
      setGroupsLoading(false);
    }
  }, [groupsOffset, groupsLoading, groupsSearch]);

  // Load group content
  const loadGroupContent = async (groupId: string) => {
    if (selectedGroupId === groupId) {
      setSelectedGroupId(null);
      setGroupContent([]);
      return;
    }

    setGroupContentLoading(true);
    setSelectedGroupId(groupId);
    setGroupContent([]);

    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/groups/${groupId}/content?limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setGroupContent(data.content || []);
    } catch (err) {
      console.error('Failed to load group content:', err);
    } finally {
      setGroupContentLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    loadGroups(true);
  }, []);

  // Reload groups when search changes
  useEffect(() => {
    const debounce = setTimeout(() => {
      setGroups([]);
      setGroupsOffset(0);
      setGroupsHasMore(true);
      loadGroups(true);
    }, 300);
    return () => clearTimeout(debounce);
  }, [groupsSearch]);

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && groupsHasMore && !groupsLoading) {
          loadGroups();
        }
      },
      { threshold: 0.1 }
    );

    const target = groupsObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [groupsHasMore, groupsLoading, loadGroups]);

  return (
    <div className="facebook-view__groups">
      {/* Groups search */}
      <div className="facebook-view__filters">
        <input
          type="text"
          className="facebook-view__search"
          placeholder="Search groups..."
          value={groupsSearch}
          onChange={(e) => setGroupsSearch(e.target.value)}
        />
      </div>

      {/* Groups list */}
      <div className="facebook-view__groups-list">
        {error && <div className="facebook-view__error">{error}</div>}

        {groups.length === 0 && !groupsLoading && (
          <div className="facebook-view__empty">
            <p>No groups found</p>
            <span>Import your Facebook archive to see your Groups activity</span>
          </div>
        )}

        {groups.map((group) => (
          <div
            key={group.id}
            className={`facebook-view__group ${selectedGroupId === group.id ? 'facebook-view__group--expanded' : ''}`}
          >
            <div
              className="facebook-view__group-header"
              onClick={() => loadGroupContent(group.id)}
            >
              <div className="facebook-view__group-name">
                {group.name || '[Unnamed Group]'}
              </div>
              <div className="facebook-view__group-stats">
                {group.post_count > 0 && (
                  <span className="facebook-view__group-posts">{group.post_count} posts</span>
                )}
                {group.comment_count > 0 && (
                  <span className="facebook-view__group-comments">{group.comment_count} comments</span>
                )}
                {group.joined_at && (
                  <span className="facebook-view__group-joined">
                    Joined {formatDate(group.joined_at)}
                  </span>
                )}
                {group.last_activity > 0 && (
                  <span className="facebook-view__group-activity">
                    Last: {formatDate(group.last_activity)}
                  </span>
                )}
              </div>
            </div>

            {/* Expanded group content */}
            {selectedGroupId === group.id && (
              <div className="facebook-view__group-content">
                {groupContentLoading && (
                  <div className="facebook-view__loading">Loading content...</div>
                )}

                {!groupContentLoading && groupContent.length === 0 && (
                  <div className="facebook-view__empty">
                    <p>No posts or comments found in this group</p>
                  </div>
                )}

                {!groupContentLoading && groupContent.map((content, idx) => (
                  <div
                    key={`${content.id}-${idx}`}
                    className={`facebook-view__group-item facebook-view__group-item--${content.type}`}
                    onClick={() => {
                      if (onSelectContent) {
                        onSelectContent({
                          id: content.id,
                          type: content.type,
                          source: 'facebook',
                          text: content.text,
                          title: content.title,
                          created_at: content.timestamp,
                          author_name: content.original_author,
                          is_own_content: true,
                        });
                      }
                    }}
                  >
                    <div className="facebook-view__group-item-header">
                      <span className={`facebook-view__item-type facebook-view__item-type--${content.type}`}>
                        {content.type === 'post' ? 'Post' : 'Comment'}
                      </span>
                      <span className="facebook-view__item-date">
                        {formatDate(content.timestamp)}
                      </span>
                      {content.original_author && (
                        <span className="facebook-view__group-item-author">
                          re: {content.original_author}
                        </span>
                      )}
                    </div>
                    <div className="facebook-view__group-item-text">
                      {content.text?.substring(0, 200) || '[No text]'}
                      {content.text && content.text.length > 200 && '...'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {groupsLoading && <div className="facebook-view__loading">Loading groups...</div>}
        <div ref={groupsObserverRef} className="facebook-view__observer-spacer" />
      </div>
    </div>
  );
}
