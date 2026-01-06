# HANDOFF: Archive Import Strategy & Image Rendering
**Date**: December 28, 2025
**Branch**: `feature/subjective-intentional-constraint`
**Priority**: HIGH - Core functionality incomplete

---

## CRITICAL: Start Next Session with Planning

The next session MUST begin with 15-20 minutes of planning using the Plan agent to design the complete archive import pipeline. The current implementation is incomplete and images will fail for any new imports.

```
Recommended first prompt:
"Enter plan mode. Design a complete archive import strategy for OpenAI ChatGPT exports that enables accurate rendering of all 7 types of image references. Reference ChromaDB memory about 'image-matching 7-strategies' and the Python parser at /Users/tem/openai-export-parser/"
```

---

## Session Summary (Dec 28)

### What Was Fixed
1. **Hardcoded paths removed** - Config now uses `~/.humanizer/archive-config.json` with `archiveBasePath`
2. **Error messages fixed** - No longer says "npx tsx archive-server.js"
3. **URL normalization** - Frontend now properly constructs full URLs for images
4. **Asset pointer resolution** - Backend extracts `assetPointerMap` from conversation.html
5. **Media manifest support** - Backend uses `media_manifest.json` for attachment filename mapping

### What Still Fails
- **New imports will NOT render images** - The import pipeline doesn't generate required files
- **No import API routes** - `/api/import/*` endpoints don't exist
- **No output file generation** - TS parser doesn't create conversation.html or media_manifest.json

---

## The Core Problem

### Python Parser Output (What We Need)
```
YYYY-MM-DD_Conversation_Title_NNNNN/
├── conversation.json          # Original data
├── conversation.html          # Contains assetPointerMap, mediaMapping
├── media_manifest.json        # Display name → hashed filename
├── media/                     # Files with hash prefixes
└── assets/                    # Code blocks
```

### TypeScript Parser Output (What We Have)
```
(Returns in-memory data structures only - no files created)
```

---

## The 7 Image Reference Cases

| # | Reference Type | Format | Resolution Method |
|---|---------------|--------|-------------------|
| 1 | Asset Pointer | `file-service://file-{ID}` | assetPointerMap from HTML |
| 2 | Sediment | `sediment://file_{32-hex-hash}` | Hash index → user-*/ folder |
| 3 | Attachment Name | `metadata.attachments[].name` | media_manifest.json |
| 4 | Attachment Filename | `metadata.attachments[].filename` | media_manifest.json |
| 5 | DALL-E | `dalle-generations/file-{ID}-{uuid}.webp` | File-ID extraction |
| 6 | User Folder | `user-{userID}/file_{hash}-{uuid}.ext` | Hash extraction |
| 7 | Audio | `{uuid}/audio/file_{hash}.wav` | Conversation directory |

---

## Key Files

### Backend (archive-server)
- `electron/archive-server/routes/conversations.ts` - Image URL resolution
- `electron/archive-server/services/parser/ConversationParser.ts` - Has matching logic
- `electron/archive-server/services/parser/ComprehensiveMediaIndexer.ts` - 6 indices
- `electron/archive-server/services/parser/ComprehensiveMediaMatcher.ts` - 7 strategies

### Frontend
- `apps/web/src/lib/archive/service.ts` - Message parsing, markdown image generation
- `apps/web/src/components/archive/GalleryView.tsx` - Gallery display
- `apps/web/src/Studio.tsx` - Main conversation rendering

### Reference Implementation
- `/Users/tem/openai-export-parser/` - Python parser (97.9% accuracy)

---

## Implementation Plan for Next Session

### Phase 1: Import API Routes (2-3 hours)
Create `electron/archive-server/routes/import.ts`:
- `POST /api/import/archive/upload` - Handle ZIP upload
- `POST /api/import/archive/parse` - Preview changes
- `POST /api/import/archive/apply/:jobId` - Apply import
- `POST /api/import/archive/folder` - Import from folder path
- `GET /api/import/archive/status/:jobId` - Check progress

### Phase 2: Output File Generation (3-4 hours)
Extend ConversationParser to generate:
1. `conversation.html` with embedded:
   - `assetPointerMap` (asset_pointer → filename)
   - `mediaMapping` (display name → filename)
   - `mediaFiles` (list of all files)
2. `media_manifest.json`
3. Copy media files with hash prefixes

### Phase 3: Test All 7 Cases (2 hours)
Find test conversations for each reference type:
- Search "mandala" for DALL-E images
- Search for tool messages with sediment://
- Find conversations with user uploads
- Find audio conversations

---

## ChromaDB Reference

Key memories stored:
- `image-matching,media-reference,openai-archive,7-strategies` - Complete reference
- `openai-export,media-matching,archive-parser` - Nov 2025 implementation notes
- `archive-parser,python,reference,architecture` - Python reference details

Query: `retrieve_memory("image matching 7 strategies openai archive")`

---

## Commands to Resume

```bash
# Navigate to project
cd /Users/tem/humanizer_root/humanizer-gm

# Kill any stale processes
lsof -i :3002 | grep Electron | awk '{print $2}' | xargs kill 2>/dev/null

# Start development
npm run electron:dev

# Test current image rendering
# 1. Open Chat tab
# 2. Search "mandala"
# 3. Click a conversation
# 4. Check if images render
```

---

## Test Data Locations

- **Working archive** (Python-generated): `/Users/tem/openai-export-parser/output_v13_final/`
- **Raw OpenAI export**: Look for ZIP files in Downloads or specified import paths
- **Media-heavy conversation**: `2024-02-23_Symmetric_Mandala_Design_00818` (17 images)

---

## Architecture Decision Required

The next session should decide:

1. **Full Python port vs. Generate files differently?**
   - Option A: Port Python's HTML generation to TypeScript
   - Option B: Generate JSON instead of HTML, update frontend to read JSON
   - Option C: Store mappings in database instead of files

2. **Single archive vs. Multiple source support?**
   - Current Python parser supports multiple source directories for better media matching
   - OpenAI exports vary - older archives may have media files missing from newer ones

3. **Incremental vs. Full reimport?**
   - How to handle importing same conversation multiple times?
   - Merge strategy for media files?

---

## Status

| Component | Status |
|-----------|--------|
| Archive browsing | ✅ Working (existing archives) |
| Conversation display | ✅ Working |
| Image rendering (existing) | ⚠️ Partial (some cases work) |
| Image rendering (new imports) | ❌ NOT WORKING |
| Import API | ❌ NOT IMPLEMENTED |
| Output file generation | ❌ NOT IMPLEMENTED |
| Gallery views | ⚠️ Partial |

---

## End of Handoff

**Next Claude instance**: Begin with `EnterPlanMode` to design the complete import architecture before implementing.
