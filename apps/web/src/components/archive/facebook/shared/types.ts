/**
 * Facebook View Types
 * Shared type definitions for Facebook archive components
 */

// ═══════════════════════════════════════════════════════════════════
// Feed Types
// ═══════════════════════════════════════════════════════════════════

export interface FacebookPeriod {
  period: string;
  count: number;
  start_date: number;
  end_date: number;
  quarter: number;
  year: number;
}

export interface FacebookContentItem {
  id: string;
  type: 'post' | 'comment';
  source: 'facebook';
  text: string;
  title?: string;
  created_at: number;
  author_name?: string;
  is_own_content: boolean;
  file_path?: string;
  media_refs?: string;
  context?: string;
  metadata?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Media Types
// ═══════════════════════════════════════════════════════════════════

export interface MediaItem {
  id: string;
  source_type: string;
  media_type: string;
  file_path: string;
  filename: string;
  file_size: number;
  width?: number;
  height?: number;
  created_at: number;
  description?: string;
  context?: string;
  related_post_id?: string;
  album_name?: string;
  has_video_track?: boolean; // false = audio-only MP4
}

export interface MediaStats {
  total: number;
  totalSizeBytes: number;
  bySourceType?: Record<string, number>;
  byMediaType?: Record<string, number>;
}

export interface MediaContext {
  posts: Array<{
    id: string;
    text: string;
    created_at: number;
    type: string;
  }>;
  albums: Array<{
    name: string;
    photo_count: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// Notes Types
// ═══════════════════════════════════════════════════════════════════

export interface NoteItem {
  id: string;
  title: string;
  wordCount: number;
  charCount: number;
  createdTimestamp: number;
  updatedTimestamp?: number;
  hasMedia: boolean;
  mediaCount: number;
  tags?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Groups Types
// ═══════════════════════════════════════════════════════════════════

export interface GroupItem {
  id: string;
  name: string;
  joined_at: number | null;
  post_count: number;
  comment_count: number;
  last_activity: number;
}

export interface GroupContentItem {
  id: string;
  group_id: string;
  type: 'post' | 'comment';
  text: string;
  timestamp: number;
  original_author?: string;
  external_urls?: string;
  title?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Messenger Types
// ═══════════════════════════════════════════════════════════════════

export interface MessengerThread {
  thread_id: string;
  title: string;
  message_count: number;
  last_message: number;
  first_message: number;
}

export interface MessengerMessage {
  id: string;
  text: string;
  author_name: string;
  is_own_content: boolean;
  created_at: number;
  thread_id: string;
}

// ═══════════════════════════════════════════════════════════════════
// Advertisers Types
// ═══════════════════════════════════════════════════════════════════

export interface AdvertiserItem {
  id: string;
  name: string;
  targetingType: 'uploaded_list' | 'interacted';
  interactionCount: number;
  isDataBroker: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface AdvertiserStats {
  total: number;
  dataBrokers: number;
  byTargetingType: Array<{ targeting_type: string; count: number }>;
}

// ═══════════════════════════════════════════════════════════════════
// View State Types
// ═══════════════════════════════════════════════════════════════════

export type ViewMode = 'feed' | 'gallery' | 'notes' | 'groups' | 'messenger' | 'advertisers';
export type FilterType = 'all' | 'post' | 'comment' | 'media';
