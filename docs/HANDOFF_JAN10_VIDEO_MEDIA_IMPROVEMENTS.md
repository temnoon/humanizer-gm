# Handoff: Video & Media Improvements

**Date**: January 10, 2025
**Status**: Partial implementation - needs commit and continuation

---

## Completed This Session

### 1. Unified Search API (COMMITTED)
- `6212c2c` - feat(search): add unified search API for all content types
- `82a2c8a` - feat(harvest): update harvest_archive to use unified search
- Facebook's 16,048 embeddings now searchable alongside AI conversations

### 2. Video Thumbnails & Player (COMMITTED)
- `77e3508` - feat(video): add video thumbnails, inline media, and enhanced player
- ThumbnailService with lazy generation
- ffmpeg-static bundled (~70MB)
- HTTP Range request support for video seeking
- VideoPlayer component with poster thumbnails

### 3. Gallery Filters & Video Probing (UNCOMMITTED)
Files modified but NOT committed:
- `apps/web/src/components/archive/FacebookView.tsx` - Gallery filter checkboxes
- `apps/web/src/styles/features/views.css` - Filter checkbox CSS
- `electron/archive-server/services/video/ffmpeg-path.ts` - Added getFfprobePath()
- `electron/archive-server/services/video/VideoProbeService.ts` - NEW: Detects audio-only MP4s
- `electron/archive-server/services/video/index.ts` - Exports probe service
- `electron/archive-server/services/facebook/MediaItemsDatabase.ts` - Added has_video_track column
- `electron/archive-server/routes/facebook.ts` - Added /video-probe/stats and /video-probe/run endpoints

---

## To Commit

```bash
git add -A
git commit -m "feat(media): add gallery filters and video track detection

- Add filter checkboxes in gallery (Images/Videos/Audio-only)
- Add has_video_track column to facebook_media table
- Add VideoProbeService using ffprobe to detect audio-only MP4s
- Add /api/facebook/video-probe/stats endpoint
- Add /api/facebook/video-probe/run endpoint for batch probing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

git push
```

---

## Remaining Work

### 1. Date Fix (NOT STARTED)
**Problem**: Some media uses file mtime instead of Facebook's original timestamp
**Location**: `electron/archive-server/services/facebook/MediaParser.ts` lines 212, 274
**Fix**: Use `creation_timestamp` from Facebook JSON instead of `stats.mtimeMs`

### 2. Whisper Bundling Research (NOT STARTED)
**Current state**:
- Whisper integration exists: `electron/whisper/whisper-manager.ts`
- Uses `@kutalia/whisper-node-addon` (NOT installed)
- Models directory exists but empty: `~/Library/Application Support/Humanizer/whisper-models/`

**For Electron bundling**:
- Need native binaries like ffmpeg-static
- Options: whisper.cpp binaries, or whisper-node-addon
- Would need to add to electron-builder.json asarUnpack

---

## API Endpoints Added

```
GET  /api/facebook/video-thumbnail?path=...   # Generate/return video thumbnail
GET  /api/facebook/video-probe/stats          # Get probe statistics
POST /api/facebook/video-probe/run            # Probe batch of videos
POST /api/embeddings/search/unified           # Search all content types
```

---

## Testing Commands

```bash
# Check video probe stats
curl http://localhost:3002/api/facebook/video-probe/stats

# Run video probing (detects audio-only MP4s)
curl -X POST http://localhost:3002/api/facebook/video-probe/run \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'

# Test unified search
curl -X POST http://localhost:3002/api/embeddings/search/unified \
  -H "Content-Type: application/json" \
  -d '{"query": "music", "limit": 10}'
```

---

## Key Files

| File | Purpose |
|------|---------|
| `electron/archive-server/services/video/VideoProbeService.ts` | Detects video vs audio-only |
| `electron/archive-server/services/video/ThumbnailService.ts` | Generates video thumbnails |
| `electron/archive-server/services/facebook/MediaItemsDatabase.ts` | has_video_track column |
| `apps/web/src/components/archive/FacebookView.tsx` | Gallery filters UI |
| `electron/whisper/whisper-manager.ts` | Existing whisper integration |

---

## Best Practices Learned

1. **ffmpeg-static bundling**: Add to both `files` and `asarUnpack` in electron-builder.json
2. **Database migrations**: Use try/catch around ALTER TABLE for idempotent migrations
3. **Lazy services**: Initialize on first use, not at module load
4. **HTTP Range requests**: Essential for video seeking - return 206 with Content-Range header

---

## Next Session Priority

1. **Commit uncommitted work** (see command above)
2. **Test video probing** - run probe on all videos
3. **Fix dates** - MediaParser.ts timestamp fallback
4. **Whisper research** - determine best bundling approach
