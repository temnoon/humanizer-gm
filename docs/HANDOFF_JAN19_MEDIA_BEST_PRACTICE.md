# Handoff: UCG Media Import Best Practice

**Date**: January 19, 2026
**Status**: Pattern established, Instagram complete, Facebook/Reddit need finishing

---

## Summary

This session established the **UCG Media Import Best Practice** - a standardized pattern for handling media files during content imports from any platform.

---

## The Problem

When importing from Instagram, Reddit, Facebook, etc.:
- Each platform stores media differently
- Renderers need a standard format: `![image](/api/ucg/media/by-hash/{hash})`
- Without standardization, images don't render in cards, previews, workspace

---

## The Solution: Two Representations

| Layer | Example | Purpose |
|-------|---------|---------|
| **Archive Canonical** | `your_instagram_activity/messages/inbox/user/photos/1234.jpg` | Preserves original structure, audit trail |
| **Working Copy** | `![photo](/api/ucg/media/by-hash/abc123)` | Standard markdown, renderers resolve it |

---

## MediaImportService

**New file**: `electron/archive-server/services/content-graph/MediaImportService.ts`

```typescript
// Usage in adapters:
const mediaService = new MediaImportService(exportBasePath);

// For each media reference found in content:
const indexed = mediaService.indexMediaFile('relative/path/to/image.jpg');
if (indexed) {
  text += `![image](${indexed.url})`;  // URL: /api/ucg/media/by-hash/{hash}
}

// Store original refs in sourceMetadata:
sourceMetadata: {
  originalMediaRefs: [...],      // Archive canonical paths
  indexedMediaHashes: [...],     // UCG hashes for lookup
}
```

---

## Completed Work

### 1. MediaImportService (NEW)
- `electron/archive-server/services/content-graph/MediaImportService.ts`
- Hashes files, indexes in `media_items` table, returns UCG URLs
- Provides `indexMediaFile()`, `toMarkdownImage()`, `rewriteMediaReferences()`

### 2. Instagram Adapter (COMPLETE)
- Fully updated with MediaImportService integration
- Posts, messages index media and use UCG URLs
- `sourceMetadata.originalMediaRefs` preserves canonical paths
- `sourceMetadata.indexedMediaHashes` for lookup

### 3. Facebook Adapter (PARTIAL)
- Import added: `import { MediaImportService } from '../MediaImportService.js'`
- Property added: `private mediaService: MediaImportService | null = null;`
- Initialization added in `parse()` method
- **TODO**: Update `parseMessages()` and `parsePosts()` to use mediaService

### 4. Reddit Adapter (NOT STARTED)
- Needs same pattern applied
- Reddit has `media` field in comments CSV

### 5. Adapter Registration (COMPLETE)
- Added Reddit and Instagram to `registerBuiltinAdapters()` in `content-graph/index.ts`

---

## Next Steps

### 1. Finish Facebook Adapter
Update these methods to use `this.mediaService`:
- `parseMessages()` - for photos, videos, audio_files, stickers
- `parsePosts()` - for attachments with media

### 2. Update Reddit Adapter
- Add MediaImportService import
- Update comment/post parsing if they have media refs

### 3. Test All Adapters
```bash
# Rebuild
cd /Users/tem/humanizer_root/humanizer-gm
npm run build:electron

# Restart and test
curl -X POST http://localhost:3002/api/ucg/import/instagram \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj"}'

curl -X POST http://localhost:3002/api/ucg/import/facebook \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/Downloads/your_facebook_activity"}'
```

---

## Files Modified/Created

| File | Status |
|------|--------|
| `services/content-graph/MediaImportService.ts` | NEW - Core utility |
| `adapters/instagram-adapter.ts` | COMPLETE - Full media support |
| `adapters/facebook-adapter.ts` | PARTIAL - Init done, methods TODO |
| `adapters/reddit-adapter.ts` | TODO - Needs media support |
| `services/content-graph/index.ts` | COMPLETE - Registered new adapters |

---

## The Pattern (for all future adapters)

```typescript
// 1. Import at top
import { MediaImportService, type MediaIndexResult } from '../MediaImportService.js';

// 2. Add property to class
private mediaService: MediaImportService | null = null;

// 3. Initialize in parse()
this.mediaService = new MediaImportService(exportBasePath);

// 4. For each media reference:
const indexed = this.mediaService.indexMediaFile(mediaRef);
if (indexed) {
  text += `![image](${indexed.url})`;
  indexedMedia.push(indexed);
  originalMediaRefs.push(mediaRef);
}

// 5. Store in sourceMetadata:
sourceMetadata: {
  originalMediaRefs,  // Archive canonical paths
  indexedMediaHashes: indexedMedia.map(m => m.hash),
}
```

---

## Test Data Locations

- Instagram: `/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj`
- Facebook: `/Users/tem/Downloads/your_facebook_activity` (2.9GB, freshly extracted)
- Reddit: `/Users/tem/Downloads/reddit_export_tem-noon_20260112`

---

## Key Insight

> "Regardless of origin, content must use standard markdown image format that renderers can resolve. Archive canonical paths go in sourceMetadata, working copy URLs go in content.text."

