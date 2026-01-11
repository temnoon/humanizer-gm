# Handoff: Transcription & Media Improvements

**Date**: January 10, 2025 (late evening)
**Status**: Transcription working, UI/persistence improvements needed

---

## Completed This Session

### 1. Video Display in Posts (DONE)
- Videos now display inline in posts using `VideoPlayer` component
- Added `videoMedia` filtering alongside `imageMedia` in `ContentView`
- CSS styles for `.container-workspace__video-list`

**Commit**: `b01f496`

### 2. Whisper Transcription Fix (DONE)
- Fixed module loading: `whisperModule = imported.default || imported`
- Fixed transcribe function access: `whisperModule.transcribe || whisperModule.default?.transcribe`
- Copied model from `~/Library/Application Support/Humanizer/` to `humanizer-gm/`
- **Transcription verified working** via direct test

### 3. Audio-Only Detection (DONE)
- `ThumbnailService` now probes files with ffprobe before thumbnail generation
- Audio-only files get `.audio-only` marker file (skips re-probing)
- Route returns 404 (not 500) for audio-only files
- Cleaner logs: `[Thumbnail] Skipping audio-only file: ...`

### 4. Linked Content Panel (DONE)
- `MediaView` fetches posts/comments that reference the media
- Displays "Referenced In" sidebar when viewing media from gallery
- Fixed `/media/:mediaId/context` to search `facebook_media` table (was only `media_items`)

### 5. VideoPlayer FilePath Fix (DONE)
- Added `extractFilePath()` to strip `local-media://serve` prefix
- Thumbnail and transcription requests now use raw file paths

---

## NEXT PRIORITIES

### 1. Persist Transcriptions to Database
**Issue**: Transcripts display but aren't saved
**Location**: `electron/archive-server/routes/facebook.ts` (transcription route)

The route already has code to save transcripts:
```typescript
if (id) {
  mediaDb.updateTranscriptionStatus(id, 'completed');
  // Need to also save the transcript text
}
```

**Needs**:
- Save transcript text to `facebook_media` table (column exists: `transcript`)
- Load existing transcripts on VideoPlayer mount
- Show "Transcribed" status instead of "Transcribe" button when done

### 2. Transcript UI Improvements
**Issue**: Transcript text in small dialog, not selectable

**Needs**:
- Make transcript text selectable (CSS `user-select: text`)
- Add "Copy to Clipboard" button
- Add "Download .txt" button
- Consider expandable/collapsible transcript panel

### 3. Gallery Info Panel Enhancements
**Issue**: Shows import date, not upload date; no linked content

**Location**: `apps/web/src/components/workspace/ContainerWorkspace.tsx` (MediaView)

**Needs**:
- Use `created_at` from media item (upload date) not container
- Display linked posts/comments in info panel (already fetched via `/context`)
- Make linked items clickable to navigate

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `ContainerWorkspace.tsx` | MediaView, ContentView - workspace rendering |
| `VideoPlayer.tsx` | Video player with transcription UI |
| `facebook.ts` (routes) | Transcription endpoints, media context |
| `whisper-manager.ts` | Whisper module loading and transcription |
| `ThumbnailService.ts` | Thumbnail generation with audio-only detection |
| `MediaItemsDatabase.ts` | Media DB with transcript columns |

---

## Transcription API Endpoints

```
POST /api/facebook/transcription/transcribe
  Body: { mediaId?, path?, model? }
  Returns: { transcript, segments }

GET  /api/facebook/transcription/:mediaId
  Returns: { transcript, status }

GET  /api/facebook/media/:mediaId/context
  Returns: { media, relatedMedia, contentItems }
```

---

## Session Commits

| Commit | Description |
|--------|-------------|
| `b01f496` | fix: display videos in post workspace view |
| (uncommitted) | Whisper module loading fix |
| (uncommitted) | Audio-only detection in ThumbnailService |
| (uncommitted) | Linked content panel in MediaView |

---

## Known Issues

1. **Transcript not persisted** - displays but lost on refresh
2. **Transcript not selectable** - can't copy text
3. **Gallery info shows wrong date** - import date vs upload date
4. **Linked content not in info panel** - only in sidebar when viewing media

---

## Testing Notes

1. **Transcription**: Click video in gallery → Transcribe button → should work
2. **Audio-only**: MP4s with only audio track get 404 for thumbnails (expected)
3. **Linked content**: When viewing media, sidebar shows referencing posts

---

## ChromaDB Session Memory

**Tags**: `session-summary, jan-10-2025-late, transcription, whisper, media-view, handoff`

To retrieve:
```
mcp__chromadb-memory__search_by_tag(["session-summary", "jan-10-2025-late"])
```

---

## End of Context Best Practices

**ALWAYS at end of context:**
1. Create handoff document in `docs/HANDOFF_<DATE>_<TOPIC>.md`
2. Store summary in ChromaDB with tags: `session-summary, <date>, <topics>`
3. Commit and push both
4. Note the ChromaDB memory ID in the handoff for retrieval

---
