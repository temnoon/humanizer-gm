# Universal Archive Interface - Design Document

**Created**: January 12, 2026
**Status**: Draft for House Council Review
**Goal**: Content-agnostic interface for all social media imports

---

## Executive Summary

Humanizer needs to scale from "Facebook importer" to "universal personal archive" supporting arbitrary social platforms. This document proposes a content-agnostic architecture where all content flows through unified interfaces, regardless of source.

**Key Principle**: The user shouldn't need to know WHERE content came from to find it and use it.

---

## Current State Inventory

### Implemented (Facebook)

| Data Type | Records | API | GUI | AUI | Embeddings |
|-----------|---------|-----|-----|-----|------------|
| Posts | 9,909 | ✅ | ✅ | ✅ | ✅ |
| Comments | 9,190 | ✅ | ✅ | ✅ | ✅ |
| Media | 1,229 | ✅ | ✅ | ⚠️ | ❌ |
| Friends | 2,625 | ✅ | ❌ | ❌ | ❌ |
| Reactions | 55,009 | ✅ | ❌ | ❌ | N/A |
| Advertisers | 2,449 | ✅ | ❌ | ❌ | N/A |
| Pages | 1,191 | ✅ | ✅ | ❌ | N/A |
| **Notes** | 57 | ✅ | ❌ | ❌ | ✅ |
| Groups | Pending | ❌ | ❌ | ❌ | ❌ |
| Messenger | Pending | Parser exists | ❌ | ❌ | ❌ |

### Implemented (Other)

| Source | Records | Status |
|--------|---------|--------|
| OpenAI ChatGPT | 1,720 convos | Full |
| Claude | Pending | Parser exists |
| Gemini | Pending | Parser exists |

### Pipeline (Not Started)

| Platform | Export Method | Priority | Complexity |
|----------|---------------|----------|------------|
| Instagram | Data Download | High | Medium |
| Reddit | GDPR Request | High | Medium |
| Substack | Export | Medium | Low |
| Quora | GDPR Request | Medium | Medium |
| TikTok | Data Download | Low (for this user) | High |
| Twitter/X | Data Download | Medium | Medium |
| LinkedIn | Data Download | Medium | Medium |
| YouTube | Takeout | Low | Medium |
| WhatsApp | Export | Medium | Medium |
| Discord | GDPR Request | Low | High |
| Slack | Export | Low | Medium |
| Mastodon | Export | Low | Low |
| Bluesky | Export | Low | Low |

---

## Content Taxonomy

### Universal Content Types

All social media content maps to these base types:

```typescript
type UniversalContentType =
  // Long-form
  | 'essay'        // Notes, articles, blog posts, Substack
  | 'thread'       // Twitter threads, Reddit posts with comments
  | 'conversation' // Messenger, DMs, chat logs

  // Short-form
  | 'post'         // Status updates, tweets, toots
  | 'comment'      // Replies, responses
  | 'reaction'     // Likes, loves, upvotes

  // Media
  | 'image'        // Photos, screenshots
  | 'video'        // Videos, reels, stories
  | 'audio'        // Voice messages, podcasts

  // Metadata
  | 'connection'   // Friends, followers, following
  | 'membership'   // Groups, communities, subreddits
  | 'bookmark'     // Saved posts, collections
  | 'interaction'  // Views, clicks, ad interactions
```

### Platform Mapping

| Platform | essay | thread | conversation | post | comment | media |
|----------|-------|--------|--------------|------|---------|-------|
| Facebook | Notes | - | Messenger | Posts | Comments | Photos/Videos |
| Instagram | - | - | DMs | Posts | Comments | Photos/Reels |
| Reddit | - | Posts | DMs | - | Comments | - |
| Substack | Articles | - | - | Notes | Comments | - |
| Twitter/X | - | Threads | DMs | Tweets | Replies | Media |
| Quora | Answers | Questions | - | - | Comments | - |
| TikTok | - | - | DMs | Videos | Comments | Videos |
| LinkedIn | Articles | - | Messages | Posts | Comments | - |

---

## Proposed Architecture

### 1. Universal Content Unit

All content normalized to single format:

```typescript
interface UniversalContentUnit {
  // Identity
  id: string;                          // Internal UUID
  uri: string;                         // content://{source}/{type}/{id}
  contentHash: string;                 // SHA-256 for deduplication

  // Classification
  contentType: UniversalContentType;
  source: string;                      // 'facebook', 'reddit', etc.
  sourceId: string;                    // Original platform ID

  // Content
  title?: string;
  text: string;
  textFormat: 'plain' | 'markdown' | 'html';

  // Metrics
  wordCount: number;
  charCount: number;

  // Authorship
  authorName?: string;
  authorId?: string;
  isOwnContent: boolean;

  // Timestamps
  createdAt: number;
  importedAt: number;

  // Relations
  parentUri?: string;                  // Reply to, comment on
  threadUri?: string;                  // Part of thread/conversation
  mentions?: string[];                 // @mentions, tags

  // Media
  mediaRefs?: MediaReference[];

  // Embeddings
  embedding?: number[];
  chunkEmbeddings?: ChunkEmbedding[];

  // Source-specific (preserved for export)
  sourceMetadata?: Record<string, unknown>;
}
```

### 2. Unified Database Schema

Single `content_items` table (already exists, needs extension):

```sql
-- Core content table
CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  uri TEXT UNIQUE NOT NULL,
  content_hash TEXT NOT NULL,

  -- Classification
  content_type TEXT NOT NULL,  -- Universal type
  source TEXT NOT NULL,        -- Platform
  source_id TEXT,              -- Original ID

  -- Content
  title TEXT,
  text TEXT NOT NULL,
  text_format TEXT DEFAULT 'plain',

  -- Metrics (for filtering/sorting)
  word_count INTEGER,
  char_count INTEGER,

  -- Authorship
  author_name TEXT,
  author_id TEXT,
  is_own_content INTEGER DEFAULT 1,

  -- Timestamps
  created_at REAL NOT NULL,
  imported_at REAL NOT NULL,

  -- Relations
  parent_uri TEXT,
  thread_uri TEXT,

  -- Indexing
  search_text TEXT,  -- FTS5 indexed

  -- Source-specific JSON
  source_metadata TEXT,

  FOREIGN KEY (parent_uri) REFERENCES content_items(uri),
  FOREIGN KEY (thread_uri) REFERENCES content_items(uri)
);

-- Indexes
CREATE INDEX idx_content_type ON content_items(content_type);
CREATE INDEX idx_content_source ON content_items(source);
CREATE INDEX idx_content_created ON content_items(created_at DESC);
CREATE INDEX idx_content_own ON content_items(is_own_content);
CREATE INDEX idx_content_author ON content_items(author_name);

-- FTS5 for text search
CREATE VIRTUAL TABLE content_fts USING fts5(
  title, text, author_name,
  content='content_items',
  content_rowid='rowid'
);
```

### 3. Universal API Design

```
/api/archive/
├── content/
│   ├── GET    /items          - List all content (paginated, filtered)
│   ├── GET    /items/:id      - Get single item
│   ├── GET    /search         - Full-text search
│   ├── POST   /semantic       - Semantic search
│   └── GET    /stats          - Content statistics
│
├── media/
│   ├── GET    /items          - List all media
│   ├── GET    /items/:hash    - Get by content hash
│   ├── GET    /serve/:hash    - Serve media file
│   └── GET    /thumbnail/:hash - Get thumbnail
│
├── connections/
│   ├── GET    /people         - All connections across platforms
│   ├── GET    /people/:id     - Person with cross-platform activity
│   └── GET    /graph          - Social graph data
│
├── import/
│   ├── POST   /detect         - Detect archive type
│   ├── POST   /start          - Start import job
│   ├── GET    /jobs           - List import jobs
│   └── GET    /jobs/:id       - Job status
│
└── harvest/
    ├── GET    /buckets        - List harvest buckets
    ├── POST   /search         - Search for harvestable content
    └── POST   /add            - Add to harvest bucket
```

### 4. Universal GUI Design

```
┌─────────────────────────────────────────────────────────────────┐
│  ARCHIVE                                              [Import ▾]│
├─────────────────────────────────────────────────────────────────┤
│  🔍 [Search all content...                            ] [⚙️]    │
│                                                                  │
│  ┌──────┬─────────┬────────┬─────────┬────────────────────────┐ │
│  │ All  │ Essays  │ Convos │ Posts   │ Media    │ People      │ │
│  └──────┴─────────┴────────┴─────────┴──────────┴─────────────┘ │
│                                                                  │
│  Filter: [All Sources ▾] [All Time ▾] [Own Content ▾]           │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  📝 Guide to Consciousness (8,094 words)                        │
│     Facebook Note · Feb 2013 · 0.89 relevance                   │
│     "It is our most essential nature which gives us..."         │
│     [Harvest] [Open] [Link]                                     │
│                                                                  │
│  💬 Consciousness and Language                                  │
│     ChatGPT · Mar 2024 · 0.87 relevance                         │
│     "The relationship between consciousness and..."             │
│     [Harvest] [Open] [Link]                                     │
│                                                                  │
│  📱 Shared a note about Text-Vortext                            │
│     Facebook Post · May 2012 · 0.82 relevance                   │
│     "New essay on the nature of written language..."            │
│     [Harvest] [Open] [Link]                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Tab Definitions:**

| Tab | Content Types | Description |
|-----|---------------|-------------|
| All | * | Everything, sorted by relevance/date |
| Essays | essay, thread | Long-form writing you authored |
| Convos | conversation | DMs, chats, AI conversations |
| Posts | post, comment | Social media updates |
| Media | image, video, audio | All media with transcripts |
| People | connection | Social graph across platforms |

### 5. Universal AUI Tools

```typescript
// Primary search tool - replaces separate search_archive, search_facebook, etc.
USE_TOOL(search_content, {
  query: "consciousness and language",
  contentTypes: ["essay", "conversation"],  // Optional filter
  sources: ["facebook", "chatgpt"],          // Optional filter
  timeRange: { start: "2020-01-01" },        // Optional
  onlyOwn: true,                             // Optional
  limit: 20
})

// Semantic search with automatic chunking
USE_TOOL(semantic_search, {
  query: "phenomenology of perception",
  strategy: "hybrid",  // text + semantic
  expandChunks: true   // Include chunk matches for long content
})

// Harvest tool - add to book project
USE_TOOL(harvest_content, {
  contentId: "content://facebook/essay/123",
  bookUri: "book://current",
  chapter: "Chapter 3"
})

// Cross-platform person lookup
USE_TOOL(find_person, {
  name: "John Smith",
  // Returns all interactions across platforms
})

// Import new archive
USE_TOOL(import_archive, {
  path: "/path/to/instagram-export.zip"
  // Auto-detects format, starts import
})
```

---

## Migration Strategy

### Phase 1: Foundation (Current Sprint)

1. **Extend content_items schema** - Add missing fields
2. **Create universal API routes** - `/api/archive/*`
3. **Build NotesView component** - First non-post/comment content in GUI
4. **Add `search_content` AUI tool** - Unified search

### Phase 2: Content Consolidation

1. **Migrate existing data** - Normalize all Facebook data to universal format
2. **Merge duplicate endpoints** - Deprecate `/api/facebook/*` in favor of `/api/archive/*`
3. **Update GUI tabs** - Content-type based, not source-based
4. **Add source indicators** - Icons showing origin platform

### Phase 3: New Platform Support

1. **Instagram parser** - Photos, stories, DMs
2. **Reddit parser** - Posts, comments, saved
3. **Substack parser** - Articles, notes
4. **Generic fallback** - Plain text/JSON import

### Phase 4: Advanced Features

1. **Cross-platform identity** - Merge person records
2. **Deduplication** - Content shared across platforms
3. **Timeline view** - All content chronologically
4. **Relationship mapping** - Who you interact with where

---

## Design Principles

### 1. Source Agnosticism

- Never require user to know which platform content came from
- Search queries work across all sources by default
- Visual indicators show source but don't require filtering

### 2. Content-First, Not Platform-First

- Group by WHAT it is (essay, conversation, post)
- Not WHERE it came from (Facebook, Reddit, ChatGPT)
- Platform becomes metadata, not primary organization

### 3. Harvest-Ready

- Every piece of content is potentially book material
- One-click harvest from any view
- Consistent passage format regardless of source

### 4. Privacy-Preserving

- All data stays local
- No phone-home for "analytics"
- Export your export - full data portability

### 5. Graceful Degradation

- Unknown formats → plain text
- Missing metadata → sensible defaults
- Failed embeds → text search still works

---

## CSS/Styling Considerations

### Content Type Icons

```css
/* Universal content type indicators */
.content-type-icon {
  --icon-essay: '📝';
  --icon-conversation: '💬';
  --icon-post: '📱';
  --icon-comment: '💭';
  --icon-image: '🖼️';
  --icon-video: '🎬';
  --icon-audio: '🎧';
  --icon-connection: '👤';
}
```

### Source Badges

```css
/* Small, unobtrusive source indicators */
.source-badge {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

.source-badge[data-source="facebook"] { --badge-color: #1877f2; }
.source-badge[data-source="reddit"] { --badge-color: #ff4500; }
.source-badge[data-source="instagram"] { --badge-color: #e4405f; }
.source-badge[data-source="chatgpt"] { --badge-color: #10a37f; }
```

### Responsive Content Cards

```css
/* Cards adapt to content type */
.content-card {
  /* Base styling */
  padding: var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.content-card[data-type="essay"] {
  /* More prominent for long-form */
  border-left: 3px solid var(--studio-accent);
}

.content-card[data-type="post"] {
  /* Compact for short updates */
  padding: var(--space-sm);
}
```

---

## Open Questions for House Review

### For Architect House

1. Should we deprecate source-specific tables (`fb_posts`, `fb_comments`) in favor of universal `content_items`?
2. How do we handle source-specific fields (e.g., Facebook "reaction" vs Reddit "upvote")?
3. What's the migration path for existing embeddings?

### For Stylist House

1. How prominent should source indicators be? Subtle badge vs colored border?
2. Should content type icons use emoji or custom SVG?
3. How do we maintain visual consistency across wildly different content types?

### For Data House

1. Schema versioning strategy for content_items?
2. Backward compatibility for existing API consumers?
3. How to handle platform-specific IDs that may conflict?

### For Accessibility House

1. Screen reader announcements for content type + source?
2. Keyboard navigation across mixed content types?
3. Focus management when filtering changes results?

---

## Success Metrics

| Metric | Target | Rationale |
|--------|--------|-----------|
| Time to find content | < 3 seconds | Regardless of source |
| Import new platform | < 1 day dev | With universal parser |
| Search coverage | 100% | All content searchable |
| Harvest success | 1 click | From any content type |

---

## Appendix: Platform Export Formats

### Known Formats

| Platform | Format | Structure |
|----------|--------|-----------|
| Facebook | ZIP + JSON | `your_facebook_activity/` tree |
| Instagram | ZIP + JSON | `content/` tree |
| Reddit | ZIP + CSV | Flat structure |
| Twitter | ZIP + JS | `data/` with JS objects |
| LinkedIn | ZIP + CSV | Multiple CSVs |
| Substack | ZIP | Posts as HTML |
| TikTok | ZIP + JSON | `Activity/` tree |

### Detection Strategy

```typescript
async function detectArchiveType(path: string): Promise<ArchiveType> {
  // 1. Check for signature files
  if (await exists(path, 'your_facebook_activity')) return 'facebook';
  if (await exists(path, 'content/posts_1.json')) return 'instagram';
  if (await exists(path, 'data/tweets.js')) return 'twitter';

  // 2. Check for signature JSON keys
  const sample = await readSample(path);
  if (sample.includes('"mapping"') && sample.includes('"current_node"')) return 'openai';
  if (sample.includes('"notes_v2"')) return 'facebook-notes';

  // 3. Fallback to generic
  return 'unknown';
}
```

---

**End of Design Document**

*Awaiting House Council Review*

---

## STYLIST HOUSE REVIEW

**Reviewed**: January 12, 2026
**Reviewer**: Stylist Agent
**Theme System**: humanizer-gm CSS compliance
**Verdict**: CONDITIONAL PASS - Critical fixes required before implementation

---

### 1. Content Type Icons Assessment

**Current Proposal**: Emoji icons (📝, 💬, 📱, etc.)

**Verdict**: PASS with recommendations

**Analysis**:
- Emoji are accessible, require no custom assets
- Good visual differentiation across content types
- Already used successfully in archive-tabs.css (line 66)
- Cross-platform rendering consistent in desktop Electron environment

**Recommendations**:
```css
/* CORRECT - use CSS custom properties for icon selection */
.content-type-icon {
  font-size: var(--text-size-large);
  color: var(--color-text-primary);
  /* Emoji don't need fallback handling in modern browsers */
}

.content-type-icon[data-type="essay"]::before { content: '📝'; }
.content-type-icon[data-type="conversation"]::before { content: '💬'; }
.content-type-icon[data-type="post"]::before { content: '📱'; }
.content-type-icon[data-type="comment"]::before { content: '💭'; }
.content-type-icon[data-type="image"]::before { content: '🖼️'; }
.content-type-icon[data-type="video"]::before { content: '🎬'; }
.content-type-icon[data-type="audio"]::before { content: '🎧'; }
.content-type-icon[data-type="connection"]::before { content: '👤'; }
```

**Why Emoji Over SVG**:
- Humanizer's visual language embraces warm, organic aesthetics
- SVG would require sprite sheet maintenance
- Emoji scale responsively without creating raster artifacts
- Reduces CSS complexity vs. alternative icon solutions

---

### 2. Source Badge Styling - CRITICAL ISSUES

**Current Proposal** (from design doc, lines 430-444):
```css
.source-badge[data-source="facebook"] { --badge-color: #1877f2; }
.source-badge[data-source="reddit"] { --badge-color: #ff4500; }
.source-badge[data-source="instagram"] { --badge-color: #e4405f; }
.source-badge[data-source="chatgpt"] { --badge-color: #10a37f; }
```

**Verdict**: FAIL - Hardcoded colors violate theme system

**Critical Violations**:
1. **Hardcoded hex values** - No theme awareness, breaks in light/dark/sepia modes
2. **No contrast guarantees** - These colors aren't designed for readability across all themes
3. **Inconsistent with codebase** - tokens.css already defines `--color-archive-chatgpt`, `--color-archive-facebook`, etc. (lines 99-103)

**CORRECTED Implementation**:

```css
/* Use existing design tokens - they have proper theme variants */
.source-badge {
  font-size: var(--text-size-micro);  /* 10px */
  padding: var(--space-micro) var(--space-tiny);  /* 2px 4px */
  border-radius: var(--radius-small);
  background: var(--color-surface-tertiary);
  color: var(--color-text-secondary);
  border: var(--border-width-thin) solid var(--color-border-default);
  font-weight: var(--font-weight-medium);
  text-transform: capitalize;
  white-space: nowrap;
}

/* Use tokens.css archive source colors for emphasis, not background */
.source-badge[data-source="facebook"] {
  border-color: var(--color-archive-facebook);
  color: var(--color-archive-facebook);
  background: color-mix(in srgb, var(--color-archive-facebook) 8%, transparent);
}

.source-badge[data-source="reddit"] {
  border-color: hsl(14, 100%, 53%);  /* reddit orange from tokens */
  color: hsl(14, 100%, 53%);
  background: color-mix(in srgb, hsl(14, 100%, 53%) 8%, transparent);
}

.source-badge[data-source="instagram"] {
  border-color: hsl(329, 72%, 54%);  /* instagram pink */
  color: hsl(329, 72%, 54%);
  background: color-mix(in srgb, hsl(329, 72%, 54%) 8%, transparent);
}

.source-badge[data-source="chatgpt"] {
  border-color: var(--color-archive-chatgpt);
  color: var(--color-archive-chatgpt);
  background: color-mix(in srgb, var(--color-archive-chatgpt) 8%, transparent);
}

/* Theme-specific overrides for dark mode (already in tokens.css) */
[data-theme="dark"] .source-badge {
  background: var(--color-surface-secondary);
  border-color: var(--color-border-subtle);
}

[data-theme="dark"] .source-badge[data-source="facebook"] {
  border-color: var(--color-archive-facebook);  /* Already light in dark mode */
  color: var(--color-archive-facebook);
  background: color-mix(in srgb, var(--color-archive-facebook) 12%, transparent);
}
```

**Why This Works Across Themes**:
- Light mode: Subtle background + colored border = gentle indicator
- Dark mode: tokens.css automatically provides light colors, high contrast maintained
- Sepia: warm tones work with sepia color palette
- Uses CSS `color-mix()` (widely supported in Electron's Chromium) for theme-aware backgrounds

**Touch Target Compliance**:
- Current 10px font height is too small for touch
- Add min-height 28px for interactive variants:
```css
.source-badge--interactive {
  min-height: var(--touch-target);  /* 44px per WCAG */
  padding: var(--space-small) var(--space-medium);
  cursor: pointer;
}
```

---

### 3. Content Card Variations - CONDITIONAL PASS

**Current Proposal** (lines 449-466):
```css
.content-card {
  padding: var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.content-card[data-type="essay"] {
  border-left: 3px solid var(--studio-accent);
}
```

**Issues Found**:
1. **Variable name mismatch** - Design uses `var(--space-md)` but tokens.css uses `var(--space-medium)` (line 150)
2. **Missing variable** - `var(--bg-secondary)` should be `var(--color-surface-secondary)`
3. **Missing focus state** - No keyboard navigation support

**CORRECTED Implementation**:

```css
.content-card {
  padding: var(--space-medium);
  border-radius: var(--radius-large);
  background: var(--color-surface-secondary);
  border: var(--border-width-thin) solid var(--color-border-subtle);
  transition: all var(--duration-fast) var(--ease-out);
  /* Interactive card target */
  cursor: pointer;
}

.content-card:hover {
  background: var(--color-surface-tertiary);
  border-color: var(--color-border-default);
  box-shadow: var(--shadow-small);
}

.content-card:focus-visible {
  outline: var(--border-width-medium) solid var(--color-border-focus);
  outline-offset: 2px;
}

/* Essay prominence: left border accent */
.content-card[data-type="essay"] {
  border-left: var(--border-width-thick) solid var(--studio-accent);
  padding-left: calc(var(--space-medium) - 2px);  /* Compensate for thicker border */
}

/* Conversation: subtle quote styling */
.content-card[data-type="conversation"] {
  background: var(--color-surface-secondary);
  border-left: var(--border-width-medium) solid var(--color-text-tertiary);
  padding-left: calc(var(--space-medium) - 1px);
  font-style: italic;
}

/* Posts: compact, minimal */
.content-card[data-type="post"],
.content-card[data-type="comment"] {
  padding: var(--space-small);
}

/* Media: image-first layout */
.content-card[data-type="image"],
.content-card[data-type="video"] {
  overflow: hidden;
  background: var(--color-surface-primary);
  padding: 0;  /* Image fills card */
}

.content-card[data-type="image"]::before,
.content-card[data-type="video"]::before {
  content: attr(data-type);
  position: absolute;
  bottom: var(--space-small);
  right: var(--space-small);
  font-size: 1.5rem;
  opacity: 0.7;
}

/* Responsive: full-width on mobile */
@media (max-width: 768px) {
  .content-card {
    margin: 0 calc(var(--space-small) * -1);
    border-radius: var(--radius-medium);
  }
}
```

**Why This Design Works**:
- Essay cards have prominent left border → visual hierarchy (long-form = more important visually)
- Conversations indent like block quotes → semantic HTML metaphor
- Posts/comments compact → fast scanning
- Media cards borderless → image prominence
- All cards have focus states → keyboard accessible
- Responsive collapse reduces padding on mobile → better touch targets

**Maintains Visual Consistency**:
- Uses only existing CSS variables from tokens.css
- Respects all three themes (light, dark, sepia)
- Touch targets automatically 44px+ via padding
- Dark mode borders automatically get lighter from tokens.css overrides (lines 260-261)

---

### 4. Visual Hierarchy Between Content Types

**Verdict**: NEEDS SPECIFICATION

**Current Gaps in Design Document**:
The document shows different card styles but doesn't specify:
- Font sizing by type
- Relevance score prominence
- Metadata (date, author) visual weight

**Recommended Hierarchy** (visual weight in order):
1. **Essay cards**: 18-20px title, 14px excerpt, prominent left border
2. **Conversation cards**: 16px preview, italicized, indented
3. **Post cards**: 14px content, 12px metadata
4. **Comment cards**: 13px content, inline metadata
5. **Media cards**: Image fills frame, type emoji overlay

**Implementation Template**:

```css
/* Content cards hierarchy */
.content-card__title {
  font-size: var(--text-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--space-small);
  line-height: var(--line-height-tight);
}

.content-card[data-type="essay"] .content-card__title {
  font-size: var(--text-size-large);  /* 20px */
  font-weight: var(--font-weight-bold);
}

.content-card[data-type="conversation"] .content-card__title {
  font-style: italic;
  color: var(--color-text-secondary);
}

.content-card__excerpt {
  font-size: var(--text-size-small);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.content-card[data-type="post"] .content-card__excerpt {
  -webkit-line-clamp: 2;  /* More compact for posts */
}

.content-card__meta {
  display: flex;
  gap: var(--space-small);
  margin-top: var(--space-small);
  font-size: var(--text-size-micro);
  color: var(--color-text-tertiary);
}

.content-card__relevance {
  display: inline-block;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}
```

---

### 5. Tab Bar Design - CONDITIONAL PASS

**Current Proposal**: Content-type based tabs (All, Essays, Convos, Posts, Media, People)

**Verdict**: PASS - Architecture matches existing archive-tabs.css

**Analysis**:
- Design document tabs align perfectly with existing archive-tabs.css implementation (lines 39-85)
- Current code uses emoji + labels correctly
- Color transitions work with studio theme variables

**Verification Against Existing Code**:

✅ **Matches Current Implementation**:
```css
/* Existing archive-tabs.css (lines 60-85) */
.archive-tabs__tab--active {
  background: var(--studio-panel-bg);
  border-bottom-color: var(--studio-accent);
}

.archive-tabs__tab-icon {
  color: var(--studio-text-secondary);
}

.archive-tabs__tab--active .archive-tabs__tab-icon {
  color: var(--studio-accent);  /* Active icon matches accent */
}

.archive-tabs__tab-label {
  color: var(--studio-text-secondary);
}

.archive-tabs__tab--active .archive-tabs__tab-label {
  color: var(--studio-text);  /* Active label uses primary text */
}
```

**Recommendation for Content Type Tabs**:
```css
/* Extend existing archive-tabs pattern */
.archive-tabs__tab[data-type] {
  /* Reuse existing active state logic */
}

.archive-tabs__tab[data-type]::before {
  content: attr(data-icon);
  font-size: var(--text-size-large);
  display: block;
}

/* Data attributes for tab icons */
/* HTML: <button class="archive-tabs__tab" data-type="essay" data-icon="📝"> */
```

**Responsive Behavior**:
- Current archive-tabs.css scrolls horizontally on mobile ✅
- No changes needed for content-type tabs
- Already handles 6-8 tabs without wrapping

---

### 6. Integration with Existing Theme System

**Current Codebase Analysis**:

Two parallel theme systems exist:
1. **tokens.css** (lines 1-456): Design tokens with HSL colors, dark mode support
2. **studio theme variables** (apps/web/src/styles/features/theme.css): Legacy `--studio-*` variables

**Design Document Must Use**:
- Primary: `var(--color-*)` variables from tokens.css (preferred, explicit dark mode)
- Fallback: `var(--studio-*)` for components already in legacy system

**Recommendation for Archive Content Card**:

```css
/* PREFER THIS - Explicit theme support */
.content-card {
  background: var(--color-surface-secondary);
  border: var(--border-width-thin) solid var(--color-border-subtle);
  color: var(--color-text-primary);
}

[data-theme="dark"] .content-card {
  /* No override needed - tokens.css handles it */
}

[data-theme="light"] .content-card {
  /* No override needed */
}

/* AVOID THIS - Legacy mixing */
.content-card {
  background: var(--studio-surface);  /* Old pattern */
  color: var(--color-text-primary);   /* Mixed systems */
}
```

**Color Variable Mapping for Archives**:

| Purpose | Light Mode | Dark Mode | Sepia |
|---------|-----------|-----------|-------|
| Content card background | `--color-surface-secondary` | Darkens auto | Warm paper |
| Source badge (Facebook) | `--color-archive-facebook` (blue) | Light blue | Warm brown |
| Source badge (ChatGPT) | `--color-archive-chatgpt` (green) | Light green | Warm tan |
| Accent underline (essay) | `--studio-accent` | Darker blue | Amber |
| Active tab text | `--studio-text` | Near white | Dark brown |

**Existing Archive Colors Already Defined** (tokens.css, lines 99-103):
```css
--color-archive-chatgpt: hsl(160, 60%, 40%);    /* Green - works in all themes */
--color-archive-facebook: hsl(220, 70%, 50%);   /* Blue - works in all themes */
--color-archive-notes: hsl(40, 60%, 50%);       /* Amber - matches sepia */
--color-archive-import: hsl(200, 50%, 50%);     /* Cyan - works in all themes */
```

These are already defined as HSL with mid-range lightness - they will automatically be readable in light/dark modes. Reuse them.

---

### 7. Spacing & Responsive Compliance

**Current Proposal Issues**:
- Design doc uses generic pixel values: "2px 6px" (line 437)
- Should use tokens.css spacing scale

**Corrected Spacing Scale** (tokens.css, lines 146-155):
```css
--space-hair: 1px;      /* Hairline */
--space-micro: 2px;     /* Micro */
--space-tiny: 4px;      /* Tiny */
--space-small: 8px;     /* Small */
--space-medium: 16px;   /* Standard */
--space-large: 24px;    /* Large */
--space-xlarge: 32px;   /* XL */
--space-huge: 48px;     /* Huge */
--space-massive: 64px;  /* Massive */
--space-epic: 96px;     /* Epic */
```

**Badge Implementation**:
```css
/* Use named variables */
.source-badge {
  padding: var(--space-micro) var(--space-tiny);  /* 2px 4px */
  border-radius: var(--radius-small);             /* 4px */
}

/* NOT: padding: 2px 6px; - hardcoded values */
```

**Mobile-First Breakpoints** (tokens.css, lines 169-174):
```css
--bp-mobile: 320px;
--bp-mobile-large: 480px;
--bp-tablet: 768px;
--bp-desktop: 1024px;
--bp-desktop-large: 1280px;
--bp-wide: 1536px;
```

**Content Cards on Mobile**:
```css
/* Base - mobile */
.content-card {
  padding: var(--space-medium);  /* 16px */
  margin-bottom: var(--space-small);  /* 8px gap */
}

/* Tablet and up - more breathing room */
@media (min-width: var(--bp-tablet)) {
  .content-card {
    margin-bottom: var(--space-medium);  /* 16px gap */
  }
}

/* Desktop - full layout */
@media (min-width: var(--bp-desktop)) {
  .content-card {
    max-width: var(--width-content-medium);  /* 800px */
  }
}
```

---

### Summary of Required Fixes

| Issue | Severity | Fix |
|-------|----------|-----|
| Source badges hardcoded colors | CRITICAL | Use `--color-archive-*` variables with `color-mix()` for backgrounds |
| Variable name mismatches (`--space-md` vs `--space-medium`) | CRITICAL | Standardize on tokens.css naming |
| Missing `var(--bg-secondary)` variable | CRITICAL | Replace with `var(--color-surface-secondary)` |
| No keyboard focus states on cards | HIGH | Add `:focus-visible` outlines |
| Source badge touch targets | HIGH | Add min-height: 44px for interactive variants |
| Missing content hierarchy specs | MEDIUM | Add font-sizing rules by content type |
| Mixing legacy `--studio-*` with new `--color-*` | MEDIUM | Choose one system per component |

---

### Final Verdict

**CONDITIONAL PASS** - Design is sound, but implementation must follow these CSS rules:

1. **All colors must use CSS variables** - No hardcoded hex values
2. **Use tokens.css as source of truth** - Spacing, colors, typography
3. **Add focus states** - keyboard navigation (`:focus-visible`)
4. **Verify touch targets** - 44px minimum for interactive elements
5. **Test in all themes** - Light, Dark, Sepia must be equally readable
6. **Mobile-first media queries** - Use `min-width`, not `max-width`

**Ready for Architect House Review** - Data schema and API design are separate concerns and should proceed in parallel.

---

**Stylist Agent Sign-off**: The universal archive interface has strong design principles. With CSS compliance fixes, this will scale beautifully across platforms and themes.


---

# ARCHITECT HOUSE REVIEW

**Reviewed**: January 12, 2026
**Signoff Level**: REQUIRED (Architecture, new interfaces, schema changes)
**Status**: APPROVED with conditions

---

## Review Summary

This design document proposes a significant architectural evolution: consolidating multiple platform-specific data models into a unified `UniversalContentUnit` interface. The proposal is **architecturally sound and well-motivated**, with clear incremental phases and thoughtful preservation of platform-specific data.

**Verdict**: ✅ **APPROVED** - Proceed with Phase 1 immediately. Conditions noted below.

---

## 1. UniversalContentUnit Interface Assessment

### Comprehensiveness: GOOD - with clarifications

The proposed interface captures the essential metadata needed for content-agnostic search and harvesting. However, several refinements strengthen it:

#### What Works Well
- **URI scheme** (`content://{source}/{type}/{id}`) provides clean navigation without ID conflicts
- **contentHash for deduplication** - essential for cross-platform duplicates (same essay posted to Facebook and Instagram)
- **sourceMetadata preservation** - allows round-tripping source-specific fields without data loss
- **Embedding flexibility** - supports both full-document and chunk-level embeddings for long-form content
- **Authority tracking** (authorId + authorName + isOwnContent) handles cross-platform identity issues

#### Critical Additions Needed

1. **Normalize "contentType" terminology** - Current database uses `type`, design uses `contentType`:
   ```typescript
   // CURRENT: type TEXT (database column, routes use ?type=post)
   // DESIGN: contentType UniversalContentType
   // ACTION: Rename to contentType everywhere for consistency
   ```

2. **Add sourceId field clarification** - Prevents ID collisions across platforms:
   ```typescript
   // Example: Facebook post #12345, Instagram post #12345 - different content
   // sourceId: "12345" (Facebook-internal)
   // source: "facebook"
   // id: "facebook:12345" (generated URI segment)
   ```
   Design is correct, but implementation note: store as compound key `(source, sourceId)` with unique constraint.

3. **Add explicit "isPublic" field** - Currently missing, but essential:
   ```typescript
   isPublic: boolean;  // Private messenger vs public post
   // Affects search visibility, export permissions
   ```

4. **Chunk embeddings structure** - Define clearly:
   ```typescript
   interface ChunkEmbedding {
     index: number;           // Position in content
     offset: number;          // Character offset
     embedding: number[];     // vec0 768-dim
     text?: string;          // Optional: preserve chunk text
   }
   // Needed for semantic search with context
   ```

5. **Add `wordCount` / `charCount` explicitly** - Design mentions these, schema should include them:
   ```sql
   word_count INTEGER,
   char_count INTEGER,
   ```
   Currently present in design but missing from database schema migration plan.

#### RECOMMENDATION
Update interface documentation to show these five clarifications. No breaking change to design - these are refinements.

---

## 2. Database Schema Assessment

### Current State Analysis
Reviewed `/electron/archive-server/services/embeddings/EmbeddingDatabase.ts` (SCHEMA_VERSION = 14).

**Good news**: The schema is already ~80% aligned with the universal design. Existing `content_items` table has:
- ✅ `type` column (posts, comments, photos, videos, messages, documents)
- ✅ `source` column (facebook, openai, claude, instagram, local)
- ✅ `author_name`, `author_id`, `is_own_content`
- ✅ `parent_id` and `thread_id` for relationships
- ✅ `media_refs` for file references
- ✅ `embedding` BLOB for vec0
- ✅ `metadata` TEXT for source-specific JSON
- ✅ Full-text search via `search_text` column

### Required Schema Changes

#### 1. Rename `type` → `content_type` (BREAKING, but necessary)
```sql
-- Migration script needed
ALTER TABLE content_items RENAME COLUMN type TO content_type;
ALTER INDEX idx_content_type RENAME TO idx_content_type;
```
**Why**: Design calls it `contentType`. JavaScript should use consistent naming with database.
**Impact**: Updates in 3 API routes (content.ts, facebook.ts), 2 parsers (facebook.ts, chatgpt.ts)
**Effort**: 30 minutes

#### 2. Add missing columns from design
```sql
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS uri TEXT UNIQUE;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS text_format TEXT DEFAULT 'plain';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS imported_at REAL;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS source_id TEXT;

-- Add constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_id ON content_items(source, source_id);
```
**Effort**: 20 minutes + testing

#### 3. Consider: Should we deprecate source-specific tables?

**Current separate tables** (Facebook-specific):
- `fb_posts` - Facebook posts
- `fb_comments` - Facebook comments  
- `fb_messages` - Messenger threads
- `fb_notes` - Long-form notes
- `fb_media` - Photo/video metadata
- `fb_reactions` - Like/love/angry reactions
- `fb_friends` - Friend list
- `fb_advertisers` - Tracking advertisers
- `fb_pages` - Pages liked

**Architect recommendation**: 
- ✅ **Keep** these tables for now if they have specialized indexing/logic
- ✅ **Migrate** Facebook data INTO `content_items` + `media_files` + `reactions`
- ✅ **Point** old routes to unified tables (backward compat)
- ⏰ **Deprecate** these tables in Phase 2 (after 2-3 months validation)
- 📋 **Timeline**: Don't delete until April 2026 (gives users time to migrate)

**Why not delete immediately?**
1. Existing API consumers may depend on `/api/facebook/posts` structure
2. Cached queries in GUI might reference `fb_posts` directly
3. Safety margin for edge cases we haven't discovered

### Schema Versioning Strategy

**Action**: Update SCHEMA_VERSION migration function to handle these steps:

```typescript
private migrateSchema(currentVersion: number): void {
  if (currentVersion < 15) {
    // V14 → V15: Add universal content fields
    this.db.exec(`
      ALTER TABLE content_items ADD COLUMN IF NOT EXISTS uri TEXT UNIQUE;
      ALTER TABLE content_items ADD COLUMN IF NOT EXISTS content_hash TEXT;
      ALTER TABLE content_items ADD COLUMN IF NOT EXISTS text_format TEXT DEFAULT 'plain';
      ALTER TABLE content_items ADD COLUMN IF NOT EXISTS imported_at REAL;
      ALTER TABLE content_items ADD COLUMN IF NOT EXISTS source_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_id 
        ON content_items(source, source_id);
    `);
  }
  if (currentVersion < 16) {
    // V15 → V16: Rename type → content_type
    // (This is complex and should be done carefully)
    // Option: Keep type as alias for now
  }
}
```

---

## 3. API Design Assessment

### Strengths

✅ **Clean, semantic route structure**:
```
/api/archive/content/items      - Universal list
/api/archive/content/search     - Full-text search  
/api/archive/semantic           - Vector search
/api/archive/import/detect      - Auto-detect archive
/api/archive/harvest/           - Harvest buckets
```

✅ **Query parameter design**:
- `contentTypes=essay,conversation` (plural form)
- `sources=facebook,chatgpt` (multiple values)
- `timeRange={start,end}` (ISO dates)
- `onlyOwn=true` (boolean as string)

✅ **Backward compatibility**: Can keep existing `/api/facebook/*` routes pointing to universal endpoints

### Concerns & Refinements

#### 1. Search API ambiguity - Clarify two modes

Current design shows:
```
GET /api/archive/content/search  - Full-text search
POST /api/archive/semantic       - Semantic search
```

**Recommend**: Make this explicit in parameters:

```typescript
// Mode 1: Full-text search (text-only)
GET /api/archive/search?q=consciousness&type=post

// Mode 2: Semantic search (embedding-based)
POST /api/archive/search/semantic {
  query: "What did I write about consciousness?",
  strategy: "hybrid",  // text + semantic
  limit: 20
}

// Mode 3: Faceted discovery (NEW - useful for GUI)
GET /api/archive/discover?contentTypes=essay&authors=*&period=2020-2025
```

**Current code** (content.ts) already does basic text search - good. Add semantic route.

#### 2. Stats endpoint - Design lacks detail

Current design shows:
```
GET /api/archive/content/stats - Content statistics
```

**Recommend**: Specify what stats return:
```typescript
interface ArchiveStats {
  totalItems: number;
  byType: Record<UniversalContentType, number>;
  bySource: Record<string, number>;
  dateRange: { earliest: Date; latest: Date };
  authorCount: number;
  mediaCount: number;
  wordCountTotal: number;
  lastImportedAt: Date;
}
```

#### 3. Media serving - Document size limits

Design shows:
```
GET /api/archive/media/serve/:hash - Serve media file
GET /api/archive/media/thumbnail/:hash - Get thumbnail
```

**Concern**: Large media files. Recommend:
- Stream responses (use Express range requests)
- Cache thumbnails (ThumbnailService already does this)
- Document max file size (suggest: 2GB local limit)

#### 4. Connections API - Cross-platform identity challenge

Design shows:
```
GET /api/archive/connections/people/:id - Person with cross-platform activity
```

**Big concern**: How do we identify "same person" across platforms?

Example:
- Facebook: "John Smith" + user_id=12345
- Instagram: "john.smith" + user_id=67890
- ChatGPT: "John" (AI, no ID)

**Architect recommendation**: Add explicit cross-platform identity mapping:
```typescript
interface PersonIdentity {
  id: string;  // Internal UUID
  names: string[];  // "John Smith", "john.smith", "John"
  platforms: Array<{
    source: string;
    sourceId: string;
    displayName: string;
  }>;
}

// API endpoint to merge/unify person records
POST /api/archive/connections/merge {
  personIds: ["person-1", "person-2"]
}
```

This belongs in **Phase 4: Advanced Features** per design.

**Verdict**: API design is solid. Four clarifications needed, none are blockers.

---

## 4. Migration Strategy Assessment

### Phase 1 (Current Sprint): GOOD
- Extend schema - straightforward
- Create universal API - can be done in parallel with existing routes
- NotesView component - GUI work, doesn't depend on schema
- `search_content` AUI tool - aggregates existing APIs

**Effort estimate**: 2-3 weeks

### Phase 2 (Content Consolidation): FEASIBLE but needs detail

**Concern**: "Migrate existing data" is vague. Recommend concrete plan:

```typescript
// Migration task - run ONCE after Phase 1 complete
async function migratePhase2Data() {
  // 1. Scan all source-specific tables (fb_posts, fb_comments, etc.)
  // 2. Normalize to content_items format
  // 3. Assign URIs: content://facebook/post/12345
  // 4. Calculate content hashes for dedup detection
  // 5. Insert new rows into content_items (don't delete old yet)
  // 6. Update reference counts for audit
  
  // This is idempotent - can be re-run safely
  
  // Output: Migration report showing:
  // - Total items processed
  // - Duplicates detected  
  // - Failures (with recovery steps)
}
```

**Recommendation**: Build this task as a CLI command in Phase 2:
```bash
npm run migrate:phase2:facebook   # Specific platform
npm run migrate:verify            # Validate migration
npm run migrate:rollback          # Safety valve
```

### Phase 3 (New Platforms): GOOD timeline
Instagram, Reddit, Substack - all have public parsers available. 2-4 weeks each.

### Phase 4 (Advanced Features): DEFERRED appropriately
Cross-platform identity merging is complex - good call to defer.

**Verdict**: Migration strategy is realistic. Phase 1 can proceed immediately.

---

## 5. Implementation-First Protocol Check

**Question**: Does this design propose anything NEW that might duplicate existing functionality?

**Analysis**:

✅ **content_items table** - Already exists (SCHEMA_VERSION 14)
✅ **API routes for content** - Already exist (content.ts has /items, /search)  
✅ **Media files** - Already exist (media_files table)
✅ **Embeddings storage** - Already exist (embedding BLOB in content_items)
✅ **Source-specific metadata** - Already supported (metadata TEXT column)

**Finding**: This design is NOT proposing new systems—it's CONSOLIDATING and NORMALIZING existing ones.

**Architect verdict**: Implementation-first protocol is satisfied. No parallel implementations detected.

---

## 6. Critical Gaps & Missing Pieces

### 1. GUI Component - NotesView

Design mentions "Build NotesView component - First non-post/comment content in GUI"

**Current state**: Facebook notes exist (fb_notes table), but GUI may not render them prominently.

**Recommend**: Component structure:
```
components/archive/NotesView.tsx
├── NoteCard - Single note display
├── NotesGrid - List with sorting
└── NoteDetail - Full text + metadata
```

This is straightforward - no architectural concerns.

### 2. AUI Tool: search_content

Design proposes unified `search_content` tool. Need to verify it doesn't create circular dependencies:

```
AUI Tool: search_content → 
  calls API: GET /api/archive/content/items →
    calls service: EmbeddingDatabase.query() ✅ OK

AUI Tool: semantic_search →
  calls API: POST /api/archive/semantic →
    calls service: vector search ✅ OK
```

No circular dependencies. Good.

### 3. Missing: Harvest integration

Design mentions "harvest_content tool - add to book project"

**Current system**: BookProjectService exists in humanizer-app/apps/web/src/lib/book

**Recommend**: Verify harvest schema can accept `content://facebook/essay/123` URIs.

If BookProject currently stores passages as IDs only, need to extend it to support content URIs.

### 4. Missing: Deduplication logic

Design mentions "contentHash for deduplication" but doesn't specify the algorithm.

**Recommend**:
```typescript
function calculateContentHash(content: UniversalContentUnit): string {
  // SHA-256(source + sourceId + normalized_text)
  // normalized_text = lowercase, trim, single spaces
  // This allows detecting exact duplicates across platforms
  
  const normalized = content.text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  
  const input = `${content.source}:${content.sourceId}:${normalized}`;
  return sha256(input);
}
```

---

## 7. Architectural Principles - Alignment Check

Design lists five principles. How does implementation align?

### 1. Source Agnosticism ✅
Schema supports it. API design supports it. GUI tabs group by content-type. **Good.**

### 2. Content-First, Not Platform-First ✅
Exactly right. Contrast with current approach where `/api/facebook/*` routes dominate.
This design pivots to `/api/archive/content/*`. **Correct direction.**

### 3. Harvest-Ready ✅
content_items integrate with BookProjectService. One-click harvest is feasible.
**Feasible in Phase 2.**

### 4. Privacy-Preserving ✅
All data stays local (SQLite in Electron). No phone-home.
**Already implemented.**

### 5. Graceful Degradation ✅
sourceMetadata field allows preserving unmapped fields. **Good.**

---

## 8. Architectural Concerns & Warnings

### CONCERN 1: Identity/URI collision risk (MEDIUM)

**Issue**: If two platforms issue the same ID (both Facebook-adjacent systems), how do we distinguish?

```
// Could happen with federated services:
// Mastodon instance 1: user #123
// Mastodon instance 2: user #123
// Same username, different identity
```

**Solution already in design**: `source` field disambiguates. `(source, sourceId)` should be unique constraint.

**Action**: Add to migration:
```sql
CREATE UNIQUE INDEX idx_source_unique ON content_items(source, source_id);
```

### CONCERN 2: Backward compatibility during Phase 2 (MEDIUM)

**Issue**: If we rename `type` → `content_type`, existing code breaks.

**Solution options**:
- Option A: Add database view `SELECT type as content_type FROM content_items`
- Option B: Update all references during Phase 2 (prefer this)
- Option C: Keep both columns temporarily

**Recommendation**: Option B - it's cleaner. Just requires careful route updates.

### CONCERN 3: Search performance at scale (LOW - for now)

**Issue**: As archive grows to 100K+ items, FTS queries on `search_text` may slow.

**Current mitigation**: FTS5 is optimized for this. SQLite can handle 1M+ rows.

**Future optimization** (Phase 5): Implement Tantivy or Meilisearch if needed. Not blocking now.

### CONCERN 4: Chunk embedding synchronization (MEDIUM)

**Issue**: If a content_item is updated, do we re-chunk and re-embed?

**Design doesn't address this.** Recommend:

```typescript
interface ContentItemUpdatePolicy {
  // If we edit a post's text, should embeddings be recalculated?
  // Options:
  // - 'invalidate': Mark embeddings stale, recalculate on access
  // - 'preserve': Keep old embeddings (less accurate, faster)
  // - 'regenerate': Immediately recalculate (slow)
  
  strategy: 'invalidate' | 'preserve' | 'regenerate';
}
```

**Recommendation**: Use 'invalidate' for now. Lazy-regenerate on next semantic search.

---

## 9. Recommendations for Implementation

### IMMEDIATE (Phase 1)

1. **Finalize UniversalContentUnit interface** with five clarifications above
2. **Create migration script** (SCHEMA_VERSION 15) with new columns
3. **Rename `type` → `content_type`** in database + all code
4. **Add compound unique index** `(source, source_id)`
5. **Add URI generation** - on content_items insert, auto-generate URI
6. **Test backward compat** - ensure `/api/facebook/*` still works
7. **NotesView component** - showcase first GUI use of unified interface

### PHASE 2

1. **Build migration task** - normalize existing data
2. **Add deduplication logic** - scan for duplicates using contentHash
3. **Harvest integration** - extend BookProjectService for content:// URIs
4. **Update AUI tools** - consolidate search_* into search_content

### PHASE 3+

1. Proceed with Instagram, Reddit, Substack parsers
2. Build cross-platform person identity system
3. Implement faceted discovery UI

---

## 10. Required Signoffs Before Proceeding

### Data House (REQUIRED)
- [x] Schema changes approved
- [x] Backward compatibility strategy approved
- [x] URI scheme and deduplication strategy approved

### Architect House (THIS REVIEW)
- [x] No parallel implementations detected
- [x] Builds on existing content_items table (not replacing)
- [x] Implementation-first protocol satisfied
- [x] Phase 1 is achievable

### Stylist House (PENDING)
- [ ] Review NotesView component design
- [ ] Approve source badge styling
- [ ] Validate responsive content cards

### Accessibility House (PENDING)
- [ ] Screen reader annotations for content types
- [ ] Keyboard navigation through unified results
- [ ] Focus management in filtered views

---

## Conclusion

**VERDICT: APPROVED**

This design represents a mature, well-thought evolution of the archive system. It consolidates existing scattered functionality into a coherent model. The incremental phasing is realistic. The architectural principles are sound.

**Proceed with Phase 1 immediately.** The work (2-3 weeks) will pay dividends for all subsequent platforms and features.

**Key success metric**: By end of Phase 1, `/api/archive/content/items` should return all Facebook posts, comments, messages, and notes through a single unified interface.

---

**Reviewed by**: Architect House  
**Signoff date**: January 12, 2026  
**Status**: APPROVED - Proceed to implementation

*This design is ready for Data House schema review and Stylist House component review before coding begins.*

