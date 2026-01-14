/**
 * Facebook View - Social archive with feed and media gallery
 *
 * Features:
 * - Feed view: posts and comments with filters
 * - Media gallery: thumbnail grid with size control
 * - Selection: click media to open in main workspace
 * - Two-way linking: click media to see related posts, click posts to see media
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { SelectedFacebookMedia, SelectedFacebookContent } from './types';
import { getArchiveServerUrl } from '../../lib/platform';
import { ImageWithFallback, MediaThumbnail } from '../common';
import { formatTextForDisplay } from '../../lib/utils/textCleaner';

// Import shared types and utilities
import type {
  FacebookPeriod,
  FacebookContentItem,
  MediaItem,
  MediaStats,
  MediaContext,
  ViewMode,
  FilterType,
  NoteItem,
  GroupItem,
  GroupContentItem,
  MessengerThread,
  MessengerMessage,
  AdvertiserItem,
  AdvertiserStats,
} from './facebook/shared';
import { normalizeMediaPath, getVideoThumbnailUrl, formatDate, formatFileSize } from './facebook/shared';

const ITEMS_PER_PAGE = 50;

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export interface FacebookViewProps {
  /** Callback when a media item is selected for display in main workspace */
  onSelectMedia?: (media: SelectedFacebookMedia) => void;
  /** Callback when a content item (post/comment) is selected for display in main workspace */
  onSelectContent?: (content: SelectedFacebookContent) => void;
  /** Callback to open the social graph in main workspace */
  onOpenGraph?: () => void;
}

export function FacebookView({ onSelectMedia, onSelectContent, onOpenGraph }: FacebookViewProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      return (localStorage.getItem('fb_view_mode') as ViewMode) || 'feed';
    } catch { return 'feed'; }
  });

  // Feed state
  const [items, setItems] = useState<FacebookContentItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedOffset, setFeedOffset] = useState(0);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [_feedTotal, setFeedTotal] = useState(0);

  // Filters
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [ownContentOnly, setOwnContentOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Periods
  const [periods, setPeriods] = useState<FacebookPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  // Media gallery state
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaOffset, setMediaOffset] = useState(0);
  const [mediaHasMore, setMediaHasMore] = useState(true);
  const [mediaStats, setMediaStats] = useState<MediaStats | null>(null);
  const [thumbnailSize, setThumbnailSize] = useState(90);

  // Gallery media type filters
  const [showImages, setShowImages] = useState(true);
  const [showVideos, setShowVideos] = useState(true);
  const [showAudioOnly, setShowAudioOnly] = useState(true);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const [mediaContext, setMediaContext] = useState<MediaContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // Notes state
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesOffset, setNotesOffset] = useState(0);
  const [notesHasMore, setNotesHasMore] = useState(true);
  const [notesSearch, setNotesSearch] = useState('');
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [expandedNoteText, setExpandedNoteText] = useState<string | null>(null);

  // Groups state
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsOffset, setGroupsOffset] = useState(0);
  const [groupsHasMore, setGroupsHasMore] = useState(true);
  const [groupsSearch, setGroupsSearch] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupContent, setGroupContent] = useState<GroupContentItem[]>([]);
  const [groupContentLoading, setGroupContentLoading] = useState(false);

  // Messenger state
  const [messengerThreads, setMessengerThreads] = useState<MessengerThread[]>([]);
  const [messengerLoading, setMessengerLoading] = useState(false);
  const [messengerOffset, setMessengerOffset] = useState(0);
  const [messengerHasMore, setMessengerHasMore] = useState(true);
  const [messengerSearch, setMessengerSearch] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessengerMessage[]>([]);
  const [threadMessagesLoading, setThreadMessagesLoading] = useState(false);

  // Advertisers state
  const [advertisers, setAdvertisers] = useState<AdvertiserItem[]>([]);
  const [advertisersLoading, setAdvertisersLoading] = useState(false);
  const [advertisersOffset, setAdvertisersOffset] = useState(0);
  const [advertisersHasMore, setAdvertisersHasMore] = useState(true);
  const [advertisersSearch, setAdvertisersSearch] = useState('');
  const [advertiserStats, setAdvertiserStats] = useState<AdvertiserStats | null>(null);
  const [showDataBrokersOnly, setShowDataBrokersOnly] = useState(false);

  // Selected item for main display (kept for legacy/internal use)
  const [_selectedItem, _setSelectedItem] = useState<FacebookContentItem | MediaItem | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Archive server URL (initialized on mount)
  const [archiveServerUrl, setArchiveServerUrl] = useState<string | null>(null);

  // Refs
  const feedObserverRef = useRef<HTMLDivElement>(null);
  const mediaObserverRef = useRef<HTMLDivElement>(null);
  const notesObserverRef = useRef<HTMLDivElement>(null);
  const groupsObserverRef = useRef<HTMLDivElement>(null);
  const messengerObserverRef = useRef<HTMLDivElement>(null);
  const advertisersObserverRef = useRef<HTMLDivElement>(null);

  // ═══════════════════════════════════════════════════════════════════
  // DATA LOADING
  // ═══════════════════════════════════════════════════════════════════

  // Initialize archive server URL on mount
  useEffect(() => {
    getArchiveServerUrl().then(setArchiveServerUrl);
    loadPeriods();
    loadMediaStats();
  }, []);

  // Save view mode
  useEffect(() => {
    try {
      localStorage.setItem('fb_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  const loadPeriods = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/periods`);
      if (res.ok) {
        const data = await res.json();
        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.periods) {
          console.warn('[FacebookView.loadPeriods] API response missing periods field');
        }
        setPeriods(data.periods || []);
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    }
  };

  const loadMediaStats = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media-stats`);
      if (res.ok) {
        const data = await res.json();
        setMediaStats(data);
      }
    } catch (err) {
      console.error('Failed to load media stats:', err);
    }
  };

  // Load feed items
  const loadFeedItems = useCallback(async (reset = false) => {
    if (feedLoading) return;
    setFeedLoading(true);
    setError(null);

    try {
      const currentOffset = reset ? 0 : feedOffset;
      const params = new URLSearchParams({
        source: 'facebook',
        limit: ITEMS_PER_PAGE.toString(),
        offset: currentOffset.toString(),
      });

      if (filterType !== 'all' && filterType !== 'media') {
        params.append('type', filterType);
      }
      if (selectedPeriod) {
        params.append('period', selectedPeriod);
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/content/items?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      // Validate API response (per FALLBACK POLICY: no silent fallbacks)
      if (!data.items) {
        console.warn('[FacebookView.loadFeedItems] API response missing items field');
      }
      let filteredItems = data.items || [];

      // Client-side filters
      if (filterType === 'media') {
        filteredItems = filteredItems.filter((item: FacebookContentItem) => {
          try {
            const refs = item.media_refs ? JSON.parse(item.media_refs) : [];
            return refs.length > 0;
          } catch { return false; }
        });
      }
      if (ownContentOnly) {
        filteredItems = filteredItems.filter((item: FacebookContentItem) => item.is_own_content);
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredItems = filteredItems.filter((item: FacebookContentItem) =>
          item.text?.toLowerCase().includes(q) || item.title?.toLowerCase().includes(q)
        );
      }

      if (reset) {
        setItems(filteredItems);
        setFeedOffset(ITEMS_PER_PAGE);
      } else {
        setItems(prev => [...prev, ...filteredItems]);
        setFeedOffset(prev => prev + ITEMS_PER_PAGE);
      }

      setFeedTotal(data.total || 0);
      setFeedHasMore(filteredItems.length === ITEMS_PER_PAGE);
    } catch (err) {
      console.error('Failed to load feed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setFeedLoading(false);
    }
  }, [feedOffset, feedLoading, filterType, selectedPeriod, ownContentOnly, searchQuery]);

  // Load media items
  const loadMediaItems = useCallback(async (reset = false) => {
    if (mediaLoading) return;
    setMediaLoading(true);

    try {
      const currentOffset = reset ? 0 : mediaOffset;
      const params = new URLSearchParams({
        limit: '100',
        offset: currentOffset.toString(),
      });

      if (selectedPeriod) {
        params.append('period', selectedPeriod);
      }

      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media-gallery?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      // Validate API response (per FALLBACK POLICY: no silent fallbacks)
      if (!data.items) {
        console.warn('[FacebookView.loadMediaItems] API response missing items field');
      }

      if (reset) {
        setMedia(data.items || []);
        setMediaOffset(100);
      } else {
        setMedia(prev => [...prev, ...(data.items || [])]);
        setMediaOffset(prev => prev + 100);
      }

      setMediaHasMore(data.hasMore ?? false);
    } catch (err) {
      console.error('Failed to load media:', err);
    } finally {
      setMediaLoading(false);
    }
  }, [mediaOffset, mediaLoading, selectedPeriod]);

  // Load media context (related posts/albums)
  const loadMediaContext = async (mediaId: string) => {
    setLoadingContext(true);
    setMediaContext(null);

    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/media/${mediaId}/context`);
      if (res.ok) {
        const data = await res.json();
        // Validate API response (per FALLBACK POLICY: no silent fallbacks)
        if (!data.contentItems) {
          console.warn('[FacebookView.loadMediaContext] API response missing contentItems field');
        }
        // Transform API response to expected format
        const posts = data.contentItems || [];
        const albums: Array<{ name: string; photo_count: number }> = [];

        // Extract album info from media context if available
        if (data.media?.context) {
          try {
            const ctx = typeof data.media.context === 'string'
              ? JSON.parse(data.media.context)
              : data.media.context;
            if (ctx.album) {
              albums.push({ name: ctx.album, photo_count: 0 });
            }
          } catch {
            // Ignore parse errors
          }
        }

        setMediaContext({ posts, albums });
      }
    } catch (err) {
      console.error('Failed to load media context:', err);
    } finally {
      setLoadingContext(false);
    }
  };

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
      // Validate API response
      if (!data.notes) {
        console.warn('[FacebookView.loadNotes] API response missing notes field');
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
      // Collapse if already expanded
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

  // Load group content (posts and comments for a specific group)
  const loadGroupContent = async (groupId: string) => {
    if (selectedGroupId === groupId) {
      // Collapse if already expanded
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
      // Collapse if already expanded
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

  // Load advertisers stats
  const loadAdvertiserStats = async () => {
    try {
      const archiveServer = await getArchiveServerUrl();
      const res = await fetch(`${archiveServer}/api/facebook/advertisers/stats`);
      if (res.ok) {
        const data = await res.json();
        setAdvertiserStats(data);
      }
    } catch (err) {
      console.error('Failed to load advertiser stats:', err);
    }
  };

  // Load advertisers
  const loadAdvertisers = useCallback(async (reset = false) => {
    if (advertisersLoading) return;
    setAdvertisersLoading(true);

    try {
      const currentOffset = reset ? 0 : advertisersOffset;
      const archiveServer = await getArchiveServerUrl();

      const params = new URLSearchParams({
        limit: '50',
        offset: currentOffset.toString(),
      });

      if (showDataBrokersOnly) {
        params.append('dataBrokersOnly', 'true');
      }

      const res = await fetch(`${archiveServer}/api/facebook/advertisers?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      let loadedAdvertisers: AdvertiserItem[] = data.advertisers || [];

      // Client-side search filter
      if (advertisersSearch.trim()) {
        const q = advertisersSearch.toLowerCase();
        loadedAdvertisers = loadedAdvertisers.filter((a: AdvertiserItem) =>
          a.name?.toLowerCase().includes(q)
        );
      }

      if (reset) {
        setAdvertisers(loadedAdvertisers);
        setAdvertisersOffset(50);
      } else {
        setAdvertisers(prev => [...prev, ...loadedAdvertisers]);
        setAdvertisersOffset(prev => prev + 50);
      }

      setAdvertisersHasMore(data.advertisers?.length === 50);
    } catch (err) {
      console.error('Failed to load advertisers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load advertisers');
    } finally {
      setAdvertisersLoading(false);
    }
  }, [advertisersOffset, advertisersLoading, advertisersSearch, showDataBrokersOnly]);

  // Reload feed when filters change
  useEffect(() => {
    if (viewMode === 'feed') {
      setItems([]);
      setFeedOffset(0);
      setFeedHasMore(true);
      loadFeedItems(true);
    }
  }, [filterType, selectedPeriod, ownContentOnly]);

  // Reload media when period changes
  useEffect(() => {
    if (viewMode === 'gallery') {
      setMedia([]);
      setMediaOffset(0);
      setMediaHasMore(true);
      loadMediaItems(true);
    }
  }, [selectedPeriod, viewMode]);

  // Infinite scroll for feed
  useEffect(() => {
    if (viewMode !== 'feed') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && feedHasMore && !feedLoading) {
          loadFeedItems();
        }
      },
      { threshold: 0.1 }
    );

    const target = feedObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [feedHasMore, feedLoading, viewMode, loadFeedItems]);

  // Infinite scroll for media
  useEffect(() => {
    if (viewMode !== 'gallery') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && mediaHasMore && !mediaLoading) {
          loadMediaItems();
        }
      },
      { threshold: 0.1 }
    );

    const target = mediaObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [mediaHasMore, mediaLoading, viewMode, loadMediaItems]);

  // Load notes when switching to notes view
  useEffect(() => {
    if (viewMode === 'notes' && notes.length === 0) {
      loadNotes(true);
    }
  }, [viewMode]);

  // Reload notes when search changes
  useEffect(() => {
    if (viewMode === 'notes') {
      const debounce = setTimeout(() => {
        setNotes([]);
        setNotesOffset(0);
        setNotesHasMore(true);
        loadNotes(true);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [notesSearch]);

  // Infinite scroll for notes
  useEffect(() => {
    if (viewMode !== 'notes') return;
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
  }, [notesHasMore, notesLoading, viewMode, loadNotes]);

  // Load groups when switching to groups view
  useEffect(() => {
    if (viewMode === 'groups' && groups.length === 0) {
      loadGroups(true);
    }
  }, [viewMode]);

  // Reload groups when search changes
  useEffect(() => {
    if (viewMode === 'groups') {
      const debounce = setTimeout(() => {
        setGroups([]);
        setGroupsOffset(0);
        setGroupsHasMore(true);
        loadGroups(true);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [groupsSearch]);

  // Infinite scroll for groups
  useEffect(() => {
    if (viewMode !== 'groups') return;
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
  }, [groupsHasMore, groupsLoading, viewMode, loadGroups]);

  // Load messenger threads when switching to messenger view
  useEffect(() => {
    if (viewMode === 'messenger' && messengerThreads.length === 0) {
      loadMessengerThreads(true);
    }
  }, [viewMode]);

  // Reload messenger when search changes
  useEffect(() => {
    if (viewMode === 'messenger') {
      const debounce = setTimeout(() => {
        setMessengerThreads([]);
        setMessengerOffset(0);
        setMessengerHasMore(true);
        loadMessengerThreads(true);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [messengerSearch]);

  // Infinite scroll for messenger
  useEffect(() => {
    if (viewMode !== 'messenger') return;
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
  }, [messengerHasMore, messengerLoading, viewMode, loadMessengerThreads]);

  // Load advertisers when switching to advertisers view
  useEffect(() => {
    if (viewMode === 'advertisers') {
      if (advertisers.length === 0) {
        loadAdvertisers(true);
      }
      if (!advertiserStats) {
        loadAdvertiserStats();
      }
    }
  }, [viewMode]);

  // Reload advertisers when search or filter changes
  useEffect(() => {
    if (viewMode === 'advertisers') {
      const debounce = setTimeout(() => {
        setAdvertisers([]);
        setAdvertisersOffset(0);
        setAdvertisersHasMore(true);
        loadAdvertisers(true);
      }, 300);
      return () => clearTimeout(debounce);
    }
  }, [advertisersSearch, showDataBrokersOnly]);

  // Infinite scroll for advertisers
  useEffect(() => {
    if (viewMode !== 'advertisers') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && advertisersHasMore && !advertisersLoading) {
          loadAdvertisers();
        }
      },
      { threshold: 0.1 }
    );

    const target = advertisersObserverRef.current;
    if (target) observer.observe(target);
    return () => { if (target) observer.unobserve(target); };
  }, [advertisersHasMore, advertisersLoading, viewMode, loadAdvertisers]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxIndex(null);
        setLightboxZoomed(false);
        setMediaContext(null);
      } else if (e.key === 'ArrowLeft' && lightboxIndex > 0) {
        setLightboxIndex(lightboxIndex - 1);
        setLightboxZoomed(false);
      } else if (e.key === 'ArrowRight' && lightboxIndex < media.length - 1) {
        setLightboxIndex(lightboxIndex + 1);
        setLightboxZoomed(false);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, media.length]);

  // Load context when lightbox opens
  useEffect(() => {
    if (lightboxIndex !== null && media[lightboxIndex]) {
      loadMediaContext(media[lightboxIndex].id);
    }
  }, [lightboxIndex]);

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  const getImageUrl = (item: MediaItem) => {
    // In Electron, use the custom protocol for direct file serving
    if (typeof window !== 'undefined' && (window as unknown as { isElectron?: boolean }).isElectron) {
      return `local-media://serve${item.file_path}`;
    }
    // In browser, use serve-media with URL encoding (more efficient than base64)
    return normalizeMediaPath(item.file_path, archiveServerUrl);
  };

  // Note: formatDate and formatFileSize are imported from './facebook/shared'

  // Handle media selection for main workspace
  const handleSelectMedia = async (item: MediaItem, index: number) => {
    if (onSelectMedia) {
      // Parse context if available
      let context: { album?: string; post_title?: string } | undefined;
      if (item.context) {
        try {
          context = typeof item.context === 'string' ? JSON.parse(item.context) : item.context;
        } catch {
          // Ignore parse errors
        }
      }

      // Fetch contextual related media and linked content from API
      let relatedMedia: Array<{ id: string; file_path: string; media_type: 'image' | 'video'; created_at?: number }> = [];
      let linkedContent: Array<{ id: string; type: 'post' | 'comment'; title?: string; text?: string; created_at: number; author_name?: string }> = [];
      try {
        const archiveServer = await getArchiveServerUrl();
        const res = await fetch(`${archiveServer}/api/facebook/media/${item.id}/context`);
        if (res.ok) {
          const data = await res.json();
          // Get related media (already sorted by created_at ASC in API)
          // Normalize paths to HTTP URLs
          if (data.relatedMedia && data.relatedMedia.length > 0) {
            relatedMedia = data.relatedMedia.map((m: { id: string; file_path: string; media_type: string; created_at?: number }) => ({
              id: m.id,
              file_path: normalizeMediaPath(m.file_path, archiveServerUrl),
              media_type: m.media_type as 'image' | 'video',
              created_at: m.created_at,
            }));
          }
          // Get linked posts/comments that reference this media
          if (data.contentItems && data.contentItems.length > 0) {
            linkedContent = data.contentItems.map((c: { id: string; type: string; title?: string; text?: string; created_at: number; author_name?: string }) => ({
              id: c.id,
              type: c.type as 'post' | 'comment',
              title: c.title,
              text: c.text,
              created_at: c.created_at,
              author_name: c.author_name,
            }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch media context:', err);
      }

      // Fallback: if no related media found, just include the current item
      if (relatedMedia.length === 0) {
        relatedMedia = [{
          id: item.id,
          file_path: normalizeMediaPath(item.file_path, archiveServerUrl),
          media_type: item.media_type as 'image' | 'video',
          created_at: item.created_at,
        }];
      }

      onSelectMedia({
        id: item.id,
        file_path: normalizeMediaPath(item.file_path, archiveServerUrl),
        filename: item.filename,
        media_type: item.media_type as 'image' | 'video',
        file_size: item.file_size,
        width: item.width,
        height: item.height,
        created_at: item.created_at,
        description: item.description,
        context,
        related_post_id: item.related_post_id,
        linkedContent,
        relatedMedia,
      });
    } else {
      // Fallback to lightbox if no callback provided
      setLightboxIndex(index);
    }
  };

  // Handle feed content selection for main workspace
  const handleSelectContent = async (item: FacebookContentItem) => {
    if (onSelectContent) {
      // Parse media refs if available
      let mediaItems: Array<{ id: string; file_path: string; media_type: 'image' | 'video' }> = [];
      if (item.media_refs) {
        try {
          const refs = JSON.parse(item.media_refs);
          // Fetch media details if we have refs
          if (refs.length > 0) {
            try {
              const archiveServer = await getArchiveServerUrl();
              const res = await fetch(`${archiveServer}/api/facebook/content/${item.id}/media`);
              if (res.ok) {
                const data = await res.json();
                // Validate API response (per FALLBACK POLICY: no silent fallbacks)
                if (!data.media) {
                  console.warn('[FacebookView.handleSelectContent] API response missing media field');
                }
                mediaItems = (data.media || []).map((m: { id: string; file_path: string; media_type: string }) => ({
                  id: m.id,
                  file_path: normalizeMediaPath(m.file_path, archiveServerUrl),
                  media_type: m.media_type as 'image' | 'video',
                }));
              }
            } catch (err) {
              console.error('Failed to fetch content media:', err);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      onSelectContent({
        id: item.id,
        type: item.type,
        source: 'facebook',
        text: item.text,
        title: item.title,
        created_at: item.created_at,
        author_name: item.author_name,
        is_own_content: item.is_own_content,
        media: mediaItems.length > 0 ? mediaItems : undefined,
        context: item.context,
        metadata: item.metadata,
      });
    }
  };

  const totalPeriodCount = periods.reduce((sum, p) => sum + p.count, 0);
  const gridColumns = Math.max(2, Math.floor(300 / (thumbnailSize + 4)));

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="facebook-view">
      {/* Header with view tabs */}
      <div className="facebook-view__header">
        <div className="facebook-view__tabs">
          <button
            className={`facebook-view__tab ${viewMode === 'feed' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('feed')}
          >
            Feed
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'gallery' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('gallery')}
          >
            Gallery
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'notes' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('notes')}
          >
            Notes
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'groups' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('groups')}
          >
            Groups
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'messenger' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('messenger')}
          >
            Messenger
          </button>
          <button
            className={`facebook-view__tab ${viewMode === 'advertisers' ? 'facebook-view__tab--active' : ''}`}
            onClick={() => setViewMode('advertisers')}
          >
            Advertisers
          </button>
          {onOpenGraph && (
            <button
              className="facebook-view__tab facebook-view__tab--graph"
              onClick={onOpenGraph}
              title="Open Social Graph in workspace"
            >
              Graph
            </button>
          )}
        </div>

        {/* Period selector */}
        <button
          className="facebook-view__period-btn"
          onClick={() => setShowPeriodPicker(!showPeriodPicker)}
        >
          {selectedPeriod ? selectedPeriod.replace('_', ' ') : 'All Time'}
          <span className="facebook-view__period-count">
            ({selectedPeriod
              ? periods.find(p => p.period === selectedPeriod)?.count || 0
              : totalPeriodCount})
          </span>
        </button>
      </div>

      {/* Period picker dropdown */}
      {showPeriodPicker && (
        <div className="facebook-view__period-picker">
          <button
            className={`facebook-view__period-option ${!selectedPeriod ? 'facebook-view__period-option--active' : ''}`}
            onClick={() => { setSelectedPeriod(''); setShowPeriodPicker(false); }}
          >
            All Time ({totalPeriodCount})
          </button>
          {periods.map(p => (
            <button
              key={p.period}
              className={`facebook-view__period-option ${selectedPeriod === p.period ? 'facebook-view__period-option--active' : ''}`}
              onClick={() => { setSelectedPeriod(p.period); setShowPeriodPicker(false); }}
            >
              {p.period.replace('_', ' ')} ({p.count})
            </button>
          ))}
        </div>
      )}

      {/* Feed View */}
      {viewMode === 'feed' && (
        <div className="facebook-view__feed">
          {/* Feed filters */}
          <div className="facebook-view__filters">
            <input
              type="text"
              className="facebook-view__search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="facebook-view__filter-row">
              {(['all', 'post', 'comment', 'media'] as FilterType[]).map(t => (
                <button
                  key={t}
                  className={`facebook-view__filter-btn ${filterType === t ? 'facebook-view__filter-btn--active' : ''}`}
                  onClick={() => setFilterType(t)}
                >
                  {t === 'all' ? 'All' : t === 'post' ? 'Posts' : t === 'comment' ? 'Comments' : 'Media'}
                </button>
              ))}
              <label className="facebook-view__checkbox">
                <input
                  type="checkbox"
                  checked={ownContentOnly}
                  onChange={(e) => setOwnContentOnly(e.target.checked)}
                />
                Mine
              </label>
            </div>
          </div>

          {/* Feed items */}
          <div className="facebook-view__feed-list">
            {error && <div className="facebook-view__error">{error}</div>}

            {items.length === 0 && !feedLoading && (
              <div className="facebook-view__empty">
                <p>No items found</p>
                <span>Try adjusting filters or import a Facebook archive</span>
              </div>
            )}

            {items.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className="facebook-view__item"
                onClick={() => handleSelectContent(item)}
              >
                <div className="facebook-view__item-header">
                  <span className={`facebook-view__item-type facebook-view__item-type--${item.type}`}>
                    {item.type === 'post' ? 'Post' : 'Comment'}
                  </span>
                  <span className="facebook-view__item-date">{formatDate(item.created_at)}</span>
                </div>
                {item.title && <div className="facebook-view__item-title">{item.title}</div>}
                <div className="facebook-view__item-text">
                  {item.text?.substring(0, 200) || '[No text]'}
                  {item.text && item.text.length > 200 && '...'}
                </div>
                {(() => {
                  try {
                    const refs: string[] = item.media_refs ? JSON.parse(item.media_refs) : [];
                    if (refs.length > 0) {
                      // Show up to 4 thumbnails inline
                      const displayRefs = refs.slice(0, 4);
                      const remaining = refs.length - 4;
                      return (
                        <div className="facebook-view__item-media-grid">
                          {displayRefs.map((ref, idx) => {
                            const ext = ref.toLowerCase().split('.').pop() || '';
                            const isVideo = ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext);
                            return (
                              <div key={idx} className="facebook-view__item-media-thumb">
                                {isVideo ? (
                                  <>
                                    <MediaThumbnail
                                      src={getVideoThumbnailUrl(ref, archiveServerUrl)}
                                      alt=""
                                      loading="lazy"
                                    />
                                    <div className="facebook-view__item-media-video-badge">Video</div>
                                  </>
                                ) : (
                                  <ImageWithFallback
                                    src={normalizeMediaPath(ref, archiveServerUrl)}
                                    alt=""
                                    loading="lazy"
                                  />
                                )}
                                {idx === 3 && remaining > 0 && (
                                  <div className="facebook-view__item-media-more">+{remaining}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}
              </div>
            ))}

            {feedLoading && <div className="facebook-view__loading">Loading...</div>}
            <div ref={feedObserverRef} style={{ height: 20 }} />
          </div>
        </div>
      )}

      {/* Gallery View */}
      {viewMode === 'gallery' && (
        <div className="facebook-view__gallery">
          {/* Stats bar */}
          {mediaStats && (
            <div className="facebook-view__stats">
              <strong>{mediaStats.total.toLocaleString()}</strong> items
              <span className="facebook-view__stats-sep">|</span>
              <strong>{formatFileSize(mediaStats.totalSizeBytes)}</strong>
            </div>
          )}

          {/* Media type filters */}
          <div className="facebook-view__media-filters">
            <label className="facebook-view__filter-checkbox">
              <input
                type="checkbox"
                checked={showImages}
                onChange={(e) => setShowImages(e.target.checked)}
              />
              <span>Images</span>
            </label>
            <label className="facebook-view__filter-checkbox">
              <input
                type="checkbox"
                checked={showVideos}
                onChange={(e) => setShowVideos(e.target.checked)}
              />
              <span>Videos</span>
            </label>
            <label className="facebook-view__filter-checkbox">
              <input
                type="checkbox"
                checked={showAudioOnly}
                onChange={(e) => setShowAudioOnly(e.target.checked)}
              />
              <span>Audio-only</span>
            </label>
          </div>

          {/* Size slider */}
          <div className="facebook-view__size-slider">
            <span>Size:</span>
            <input
              type="range"
              min="50"
              max="150"
              value={thumbnailSize}
              onChange={(e) => setThumbnailSize(parseInt(e.target.value))}
            />
            <span>{thumbnailSize}px</span>
          </div>

          {/* Thumbnail grid */}
          <div
            className="facebook-view__grid"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }}
          >
            {media.filter(item => {
              // Filter by media type checkboxes
              if (item.media_type === 'image') return showImages;
              if (item.media_type === 'video') {
                // has_video_track: true = video, false = audio-only, undefined = assume video
                const hasVideo = item.has_video_track !== false;
                if (hasVideo) return showVideos;
                return showAudioOnly;
              }
              return true; // Unknown type, show
            }).map((item, index) => (
              <div
                key={item.id}
                className="facebook-view__thumb"
                style={{ width: thumbnailSize, height: thumbnailSize }}
                onClick={() => handleSelectMedia(item, index)}
              >
                {item.media_type === 'image' ? (
                  <ImageWithFallback
                    src={getImageUrl(item)}
                    alt={item.filename}
                    loading="lazy"
                  />
                ) : (
                  <div className="facebook-view__thumb-video-wrapper">
                    <MediaThumbnail
                      src={getVideoThumbnailUrl(item.file_path, archiveServerUrl)}
                      alt={item.filename}
                      loading="lazy"
                      className="facebook-view__thumb-video-img"
                    />
                    <div className="facebook-view__thumb-play-icon">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {mediaLoading && <div className="facebook-view__loading">Loading...</div>}
          <div ref={mediaObserverRef} style={{ height: 20 }} />
        </div>
      )}

      {/* Notes View */}
      {viewMode === 'notes' && (
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
                  // Clean HTML/XML from note text
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
                                type: 'post', // Notes map to 'post' type for now
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
            <div ref={notesObserverRef} style={{ height: 20 }} />
          </div>
        </div>
      )}

      {/* Groups View */}
      {viewMode === 'groups' && (
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
            <div ref={groupsObserverRef} style={{ height: 20 }} />
          </div>
        </div>
      )}

      {/* Messenger View */}
      {viewMode === 'messenger' && (
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
            <div ref={messengerObserverRef} style={{ height: 20 }} />
          </div>
        </div>
      )}

      {/* Advertisers View */}
      {viewMode === 'advertisers' && (
        <div className="facebook-view__advertisers">
          {/* Stats bar */}
          {advertiserStats && (
            <div className="facebook-view__advertiser-stats">
              <div className="facebook-view__advertiser-stat">
                <span className="facebook-view__advertiser-stat-value">{advertiserStats.total.toLocaleString()}</span>
                <span className="facebook-view__advertiser-stat-label">Total</span>
              </div>
              <div className="facebook-view__advertiser-stat facebook-view__advertiser-stat--broker">
                <span className="facebook-view__advertiser-stat-value">{advertiserStats.dataBrokers}</span>
                <span className="facebook-view__advertiser-stat-label">Data Brokers</span>
              </div>
              <div className="facebook-view__advertiser-stat">
                <span className="facebook-view__advertiser-stat-value">
                  {((advertiserStats.dataBrokers / advertiserStats.total) * 100).toFixed(1)}%
                </span>
                <span className="facebook-view__advertiser-stat-label">Broker %</span>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="facebook-view__filters">
            <input
              type="text"
              className="facebook-view__search"
              placeholder="Search advertisers..."
              value={advertisersSearch}
              onChange={(e) => setAdvertisersSearch(e.target.value)}
            />
            <label className="facebook-view__checkbox facebook-view__checkbox--broker">
              <input
                type="checkbox"
                checked={showDataBrokersOnly}
                onChange={(e) => setShowDataBrokersOnly(e.target.checked)}
              />
              Data Brokers Only
            </label>
          </div>

          {/* Advertisers list */}
          <div className="facebook-view__advertisers-list">
            {error && <div className="facebook-view__error">{error}</div>}

            {advertisers.length === 0 && !advertisersLoading && (
              <div className="facebook-view__empty">
                <p>No advertisers found</p>
                <span>{showDataBrokersOnly ? 'No data brokers in your archive' : 'Import your Facebook archive to see who tracks you'}</span>
              </div>
            )}

            {advertisers.map((advertiser) => (
              <div
                key={advertiser.id}
                className={`facebook-view__advertiser ${advertiser.isDataBroker ? 'facebook-view__advertiser--broker' : ''}`}
              >
                <div className="facebook-view__advertiser-header">
                  <div className="facebook-view__advertiser-name">
                    {advertiser.name}
                    {advertiser.isDataBroker && (
                      <span className="facebook-view__advertiser-broker-badge">Data Broker</span>
                    )}
                  </div>
                  <div className="facebook-view__advertiser-type">
                    {advertiser.targetingType === 'uploaded_list' ? 'Has Your Data' : 'You Interacted'}
                  </div>
                </div>
                <div className="facebook-view__advertiser-meta">
                  <span className="facebook-view__advertiser-interactions">
                    {advertiser.interactionCount} interaction{advertiser.interactionCount !== 1 ? 's' : ''}
                  </span>
                  <span className="facebook-view__advertiser-timeline">
                    {formatDate(advertiser.firstSeen)} — {formatDate(advertiser.lastSeen)}
                  </span>
                </div>
              </div>
            ))}

            {advertisersLoading && <div className="facebook-view__loading">Loading advertisers...</div>}
            <div ref={advertisersObserverRef} style={{ height: 20 }} />
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && media[lightboxIndex] && (
        <div
          className="facebook-lightbox"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setLightboxIndex(null);
              setLightboxZoomed(false);
              setMediaContext(null);
            }
          }}
        >
          {/* Close button */}
          <button
            className="facebook-lightbox__close"
            onClick={() => {
              setLightboxIndex(null);
              setLightboxZoomed(false);
              setMediaContext(null);
            }}
          >
            Close (Esc)
          </button>

          {/* Navigation arrows */}
          {lightboxIndex > 0 && (
            <button
              className="facebook-lightbox__nav facebook-lightbox__nav--prev"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
                setLightboxZoomed(false);
              }}
            >
              ‹
            </button>
          )}
          {lightboxIndex < media.length - 1 && (
            <button
              className="facebook-lightbox__nav facebook-lightbox__nav--next"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
                setLightboxZoomed(false);
              }}
            >
              ›
            </button>
          )}

          {/* Image */}
          <ImageWithFallback
            className={`facebook-lightbox__image ${lightboxZoomed ? 'facebook-lightbox__image--zoomed' : ''}`}
            src={getImageUrl(media[lightboxIndex])}
            alt={media[lightboxIndex].filename}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxZoomed(!lightboxZoomed);
            }}
          />

          {/* Info panel */}
          <div className="facebook-lightbox__info">
            <div className="facebook-lightbox__counter">
              {lightboxIndex + 1} / {media.length}
            </div>
            <div className="facebook-lightbox__filename">
              {media[lightboxIndex].filename}
            </div>
            <div className="facebook-lightbox__meta">
              {formatDate(media[lightboxIndex].created_at)}
              {media[lightboxIndex].width && media[lightboxIndex].height && (
                <> | {media[lightboxIndex].width} x {media[lightboxIndex].height}</>
              )}
              {media[lightboxIndex].file_size && (
                <> | {formatFileSize(media[lightboxIndex].file_size)}</>
              )}
            </div>

            {/* Related posts/albums */}
            {loadingContext && <div className="facebook-lightbox__context-loading">Loading context...</div>}
            {mediaContext && (
              <div className="facebook-lightbox__context">
                {mediaContext.posts?.length > 0 && (
                  <div className="facebook-lightbox__related">
                    <strong>Related Posts:</strong>
                    {mediaContext.posts.slice(0, 3).map(post => (
                      <button
                        key={post.id}
                        className="facebook-lightbox__related-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Open post in main workspace
                          if (onSelectContent) {
                            onSelectContent({
                              id: post.id,
                              type: post.type as 'post' | 'comment',
                              source: 'facebook',
                              text: post.text || '',
                              created_at: post.created_at,
                              is_own_content: true, // Assume own content for lightbox context
                            });
                            // Close lightbox after selecting
                            setLightboxIndex(null);
                            setLightboxZoomed(false);
                            setMediaContext(null);
                          }
                        }}
                      >
                        {post.text?.substring(0, 50) || '[No text]'}...
                      </button>
                    ))}
                  </div>
                )}
                {mediaContext.albums?.length > 0 && (
                  <div className="facebook-lightbox__albums">
                    <strong>Albums:</strong> {mediaContext.albums.map(a => a.name).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
