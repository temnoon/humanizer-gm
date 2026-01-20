# Handoff: Media Indexing for ALL Archive View

**Date**: January 19, 2026
**Status**: Backend complete, needs testing after server restart

---

## Summary

This session addressed the issue where the ALL archive view couldn't display images. The root cause was that the `media_items` and `media_references` database tables were empty - media files existed in conversation folders but weren't indexed.

---

## Problem Analysis

### Why Chat/Gallery worked but ALL didn't:
- **Chat tab**: Uses `/api/conversations/:folder` endpoint which reads directly from folder structure + `assetPointerMap`
- **Gallery tab**: Same - reads media files from conversation folders
- **ALL tab**: Uses UCG content from `content_items` table, which stores text with `[image]` placeholders, not actual URLs

### Root cause:
- ChatGPT adapter's `extractMessageText()` drops image parts (returns empty string for non-text)
- Media files exist in `{conversation}/media/` folders
- But `media_items` table: 0 rows
- And `media_references` table: 0 rows

---

## Solution Implemented

### 1. Backend Endpoints (`content-graph.ts`)

| Endpoint | Purpose |
|----------|---------|
| `GET /nodes/:id/media` | Get media linked to a content node |
| `GET /media/by-hash/:hash` | Serve media file by content hash |
| `GET /media/by-pointer?pointer=...` | Resolve file-service:// URLs |
| `GET /media/folder/:folderName` | Get media for a conversation folder |
| `GET /media/stats` | Media indexing statistics |
| `POST /media/index` | Trigger full media indexing job |

### 2. MediaIndexer Service (NEW)

**File**: `electron/archive-server/services/MediaIndexer.ts`

Functions:
- `indexAllMedia()` - Scans all conversation folders, indexes media to database
- `getMediaForFolder(folderName)` - Query media by folder
- `getMediaStats()` - Get indexing statistics
- `getFoldersWithMedia()` - List folders containing media

### 3. Frontend Changes (`UnifiedArchiveView.tsx`)

- Added `selectedNodeMedia` state
- Added `useEffect` to fetch media when node is selected
- Added media grid display with:
  - Images (`<img>`)
  - Audio (`<audio controls>`)
  - Download links for other files
- CSS styles for media grid

---

## Archive Structure

```
{archive_root}/
├── 2025-10-04_Language_as_a_sense_00002/
│   ├── conversation.html      # Contains assetPointerMap (may be empty)
│   ├── conversation.json      # Has asset_pointer refs like "sediment://file_XXX"
│   ├── media_manifest.json    # Maps file_XXX -> actual filename
│   └── media/
│       ├── 044fa2b1b483_file_00000000f69861f894eaf5fca85ae5cf-...png
│       └── ...
```

---

## Testing Steps

1. **Start the Electron app**:
   ```bash
   cd /Users/tem/humanizer_root/humanizer-gm
   npm run electron:dev
   ```

2. **Check media stats** (should show 0 before indexing):
   ```bash
   curl http://localhost:3002/api/ucg/media/stats
   ```

3. **Run media indexing**:
   ```bash
   curl -X POST http://localhost:3002/api/ucg/media/index
   ```

4. **Verify indexing**:
   ```bash
   curl http://localhost:3002/api/ucg/media/stats
   # Should show mediaItems > 0
   ```

5. **Test in UI**:
   - Go to Archive → ALL tab
   - Search for "Language as a sense"
   - Click on a result
   - Media section should appear below content

---

## Files Modified

| File | Changes |
|------|---------|
| `content-graph.ts` | Added 6 media endpoints |
| `MediaIndexer.ts` | NEW - Media indexing service |
| `UnifiedArchiveView.tsx` | Media state, fetch, display |
| `UnifiedArchiveView.css` | Media grid styles |

---

## Known Limitations

1. **No automatic linking**: Media is indexed but not automatically linked to content nodes via `media_references`. The frontend queries media by folder instead.

2. **Folder matching**: To show media for a UCG node, we need to extract the conversation folder from the node's metadata or URI. This isn't implemented yet.

3. **ChatGPT adapter**: Still strips images during import. Future work: modify adapter to include `![image](url)` in text or create media_references.

---

## Future Improvements

1. Modify ChatGPT adapter to create `media_references` during import
2. Add folder path to content node metadata for easy media lookup
3. Consider running media indexing automatically on import
4. Add image thumbnails to card view in ALL tab

---

## Quick Reference

```typescript
// MediaIndexer usage
import { indexAllMedia, getMediaForFolder, getMediaStats } from './services/MediaIndexer.js';

// Index all media
const result = await indexAllMedia();
console.log(`Indexed ${result.indexedMedia} files`);

// Get media for a conversation
const media = getMediaForFolder('2025-10-04_Language_as_a_sense_00002');
// Returns: [{ hash, url, mimeType, filename, fileSize }]
```
