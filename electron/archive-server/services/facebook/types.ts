/**
 * TypeScript types for Facebook archive import
 */

// ============================================================
// Raw Facebook JSON Structures
// ============================================================

export interface FacebookPost {
  timestamp: number;
  data?: FacebookPostData[];
  attachments?: FacebookAttachment[];
  title?: string;
  tags?: FacebookTag[];
  event?: FacebookEvent;
}

export interface FacebookPostData {
  post?: string;
  update_timestamp?: number;
}

export interface FacebookAttachment {
  data?: FacebookAttachmentData[];
}

export interface FacebookAttachmentData {
  external_context?: {
    url?: string;
    name?: string;
  };
  media?: {
    uri?: string;
    description?: string;
    media_metadata?: {
      photo_metadata?: {
        exif_data?: any[];
      };
      video_metadata?: {
        exif_data?: any[];
      };
    };
    title?: string;
    creation_timestamp?: number;
  };
  place?: {
    name?: string;
    coordinate?: {
      latitude: number;
      longitude: number;
    };
  };
  text?: string;
  name?: string;
}

export interface FacebookTag {
  name: string;
}

export interface FacebookEvent {
  name?: string;
  start_timestamp?: number;
  end_timestamp?: number;
}

export interface FacebookComment {
  timestamp: number;
  data?: FacebookCommentData[];
  title?: string;
}

export interface FacebookCommentData {
  comment?: {
    comment?: string;
    author?: string;
    timestamp?: number;
  };
}

export interface FacebookReaction {
  timestamp: number;
  data?: FacebookReactionData[];
  title?: string;
}

export interface FacebookReactionData {
  reaction?: {
    reaction?: string;
    actor?: string;
  };
}

export interface FacebookPhoto {
  uri: string;
  creation_timestamp: number;
  media_metadata?: {
    photo_metadata?: {
      exif_data?: any[];
      camera_make?: string;
      camera_model?: string;
    };
  };
  title?: string;
  description?: string;
  comments?: FacebookComment[];
}

export interface FacebookVideo {
  uri: string;
  creation_timestamp: number;
  thumbnail?: {
    uri: string;
  };
  media_metadata?: {
    video_metadata?: {
      exif_data?: any[];
    };
  };
  title?: string;
  description?: string;
}

// ============================================================
// Unified Content Model
// ============================================================

export interface ContentItem {
  id: string;
  type: 'post' | 'comment' | 'photo' | 'video' | 'message' | 'document';
  source: 'facebook' | 'openai' | 'claude' | 'instagram' | 'local';

  // Content
  text?: string;
  title?: string;

  // Timestamps
  created_at: number;              // Unix timestamp
  updated_at?: number;

  // Author
  author_name?: string;
  author_id?: string;
  is_own_content: boolean;

  // Relationships
  parent_id?: string;
  thread_id?: string;
  context?: string;                // "commented on David Morris's post"

  // File system
  file_path?: string;              // Path to folder on disk

  // Media
  media_refs?: string[];           // Array of file paths
  media_count?: number;

  // Metadata
  metadata?: any;                  // Source-specific data
  tags?: string[];

  // Embeddings
  embedding?: Float32Array;
  embedding_model?: string;

  // Search
  search_text?: string;
}

export interface MediaFile {
  id: string;
  content_item_id?: string;

  file_path: string;
  file_name: string;
  file_size?: number;
  mime_type?: string;

  type: 'photo' | 'video' | 'audio' | 'document';
  width?: number;
  height?: number;
  duration?: number;

  taken_at?: number;
  uploaded_at?: number;

  caption?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
  };
  people_tagged?: string[];
  metadata?: any;

  embedding?: Float32Array;
  embedding_model?: string;
}

export interface Reaction {
  id: string;
  content_item_id: string;

  reaction_type: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';
  reactor_name?: string;
  reactor_id?: string;

  created_at: number;
}

// ============================================================
// Parsed Archive Structure
// ============================================================

export interface FacebookArchive {
  posts: FacebookPost[];
  comments: FacebookComment[];
  reactions: FacebookReaction[];
  photos: FacebookPhoto[];
  videos: FacebookVideo[];
  profile?: any;
}

// ============================================================
// Period Organization
// ============================================================

export interface PeriodSummary {
  period_folder: string;           // "Q1_2008-04-21_to_2008-07-19"
  start_date: number;              // Unix timestamp
  end_date: number;

  posts_count: number;
  comments_count: number;
  photos_count: number;
  videos_count: number;
  reactions_count: number;

  total_characters: number;
  media_size_bytes: number;
}

// ============================================================
// Import Progress
// ============================================================

export interface FacebookImportProgress {
  stage: 'parsing' | 'media' | 'organizing' | 'generating-html' | 'indexing' | 'embeddings' | 'complete';
  current: number;
  total: number;
  message?: string;
}

export interface FacebookImportResult {
  archive_id: string;              // "facebook_import_2025-11-18"
  import_date: number;
  settings: any;                   // ArchiveOrganizationSettings

  periods: PeriodSummary[];
  total_items: number;

  posts_imported: number;
  comments_imported: number;
  photos_imported: number;
  videos_imported: number;
  reactions_imported: number;

  // Entity graph counts
  people_imported?: number;
  places_imported?: number;
  events_imported?: number;
  advertisers_imported?: number;
  off_facebook_imported?: number;

  errors?: string[];
}

// ============================================================
// Facebook Entity Graph Types
// ============================================================

export interface FbPerson {
  id: string;
  name: string;
  facebook_id?: string;
  profile_url?: string;

  is_friend: boolean;
  friend_since?: number;
  is_follower: boolean;
  is_following: boolean;

  interaction_count: number;
  tag_count: number;
  last_interaction?: number;
  first_interaction?: number;

  relationship_strength?: number;

  created_at: number;
  updated_at?: number;
}

export interface FbPlace {
  id: string;
  name: string;
  address?: string;
  city?: string;

  latitude?: number;
  longitude?: number;

  visit_count: number;
  first_visit?: number;
  last_visit?: number;

  place_type?: string;
  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FbEvent {
  id: string;
  name: string;

  start_timestamp?: number;
  end_timestamp?: number;

  place_id?: string;

  response_type?: 'joined' | 'interested' | 'hosted' | 'invited' | 'declined';
  response_timestamp?: number;

  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FbAdvertiser {
  id: string;
  name: string;

  targeting_type?: 'uploaded_list' | 'activity' | 'interest' | 'custom' | 'retargeting';

  interaction_count: number;
  first_seen?: number;
  last_seen?: number;

  is_data_broker: boolean;

  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FbOffFacebookActivity {
  id: string;
  app_name: string;

  event_type?: string;
  event_count: number;

  first_event?: number;
  last_event?: number;

  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FbPage {
  id: string;
  name: string;
  facebook_id?: string;
  url?: string;

  is_liked: boolean;
  liked_at?: number;
  is_following: boolean;
  followed_at?: number;

  page_type?: string;

  metadata?: Record<string, unknown>;
  created_at: number;
}

export interface FbRelationship {
  id: string;

  source_type: 'person' | 'place' | 'event' | 'page' | 'advertiser' | 'content';
  source_id: string;

  target_type: 'person' | 'place' | 'event' | 'page' | 'advertiser' | 'content';
  target_id: string;

  relationship_type: string;  // 'tagged_in', 'attended_with', 'checked_in_at', etc.

  context_type?: string;
  context_id?: string;

  timestamp?: number;
  weight: number;

  metadata?: Record<string, unknown>;
  created_at: number;
}

// ============================================================
// Raw Facebook JSON structures for entity parsing
// ============================================================

export interface RawFacebookFriend {
  name: string;
  timestamp: number;
}

export interface RawFacebookFollower {
  name: string;
  timestamp: number;
}

export interface RawFacebookCheckIn {
  timestamp: number;
  fbid?: string;
  media?: unknown[];
  label_values?: Array<{
    label: string;
    value?: string;
    dict?: Array<{
      label: string;
      value?: string;
    }>;
  }>;
}

export interface RawFacebookAdvertiser {
  label: string;
  vec?: Array<{ value: string }>;
}

export interface RawFacebookOffFacebookActivity {
  title: string;
  media?: unknown[];
  label_values?: Array<{
    label: string;
    vec?: Array<{
      dict?: Array<{
        label: string;
        value?: string;
        timestamp_value?: number;
      }>;
    }>;
  }>;
}

export interface RawFacebookEventInvitation {
  name: string;
  start_timestamp: number;
  end_timestamp?: number;
}
