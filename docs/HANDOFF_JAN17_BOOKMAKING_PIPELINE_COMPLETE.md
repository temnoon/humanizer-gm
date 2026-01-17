# Handoff: January 17, 2026 (Session 4) - Architecture Correction

## Session Summary

**Important Architectural Correction Made:**

Sessions 3-4 incorrectly added bookmaking POST routes to archive-server. These have been removed.
The correct architecture uses **book-studio-server (port 3004)** for project management.

See: `docs/ARCHITECTURE_BOOKMAKING_INTEGRATION.md` for full details.

---

## What Was Corrected
1. **Harvest** → ✅ Buckets created with candidates
2. **Proposal** → ✅ Generates title, analysis, arc options
3. **Arcs** → ✅ Generated and saved to database
4. **Outline** → ✅ Returns chapter structure with passage IDs
5. **Chapters** → ✅ Created from outline (new API added)
6. **Draft Generation** → ✅ API working, requires approved passages (curation step)

---

## Books API - All Endpoints Tested ✅

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/books` | GET | ✅ | Returns 4 books |
| `/api/books/:id` | GET | ✅ | Book details |
| `/api/books/:id/harvest-buckets` | GET | ✅ | Returns harvest buckets for book |
| `/api/books/:id/arcs` | GET | ✅ | Returns saved narrative arcs |
| `/api/books/:id/chapters` | GET | ✅ | **NEW** - Returns chapters |
| `/api/books/:id/chapters` | POST | ✅ | **NEW** - Creates chapters from outline |
| `/api/books/proposal` | POST | ✅ | Generates proposal from harvest bucket |
| `/api/books/arcs` | POST | ✅ | Generates arcs and optionally saves to DB |
| `/api/books/outline` | POST | ✅ | Returns chapter outline with arc selection |

---

## Test Results

### Books List
```bash
curl -s http://localhost:3002/api/books | jq '.count'
# 4 books returned
```

### Proposal Generation
```bash
curl -s -X POST http://localhost:3002/api/books/proposal \
  -H 'Content-Type: application/json' \
  -d '{"bucketId": "dea7985a-c072-4156-b45f-a5535677a092"}'
```
- ✅ Analyzed 100 passages
- ✅ Detected themes: image, description, radial, design, lines
- ✅ Generated arc options: thematic, chronological, spiral

### Arc Generation & Save
```bash
curl -s -X POST http://localhost:3002/api/books/arcs \
  -H 'Content-Type: application/json' \
  -d '{"bucketId": "dea7985a-c072-4156-b45f-a5535677a092", "bookId": "visual-art-mandala", "saveToDb": true}'
```
- ✅ 3 arcs saved to database

### Chapter Creation
```bash
curl -s -X POST "http://localhost:3002/api/books/visual-art-mandala/chapters" \
  -H 'Content-Type: application/json' \
  -d '{"chapters": [...]}'
```
- ✅ 3 chapters created with passage refs

### Draft Generation
```bash
curl -s -X POST http://localhost:3002/api/draft/start \
  -H 'Content-Type: application/json' \
  -d '{"bookUri": "book://tem-noon/visual-art-mandala", "chapterId": "chapter-visual-art-mandala-1-1768667522766", "style": "narrative"}'
```
- ✅ API working
- ⚠️ Requires approved passages (curation step must happen first)

---

## Bookmaking Pipeline Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│   HARVEST   │ --> │   CURATION   │ --> │ PROPOSAL  │
│ Collect     │     │ Approve/     │     │ Analyze   │
│ candidates  │     │ Reject/Gem   │     │ passages  │
└─────────────┘     └──────────────┘     └───────────┘
                           │                    │
                           v                    v
┌─────────────┐     ┌──────────────┐     ┌───────────┐
│    DRAFT    │ <-- │   CHAPTERS   │ <-- │   ARCS    │
│ Generate    │     │ Create from  │     │ Select    │
│ content     │     │ outline      │     │ narrative │
└─────────────┘     └──────────────┘     └───────────┘
```

**Curation is the key step** - passages must be approved before draft generation can use them.

---

## Current State: visual-art-mandala Book

| Resource | Count | Status |
|----------|-------|--------|
| Harvest bucket | 1 | dea7985a-c072-4156-b45f-a5535677a092 |
| Candidates | 100 | In harvest bucket (need curation) |
| Narrative arcs | 3 | Saved (thematic, chronological, spiral) |
| Chapters | 3 | Created (Image, Design, Other) |
| Approved passages | 0 | Need curation via UI |

---

## Files Modified This Session

```
electron/archive-server/routes/books.ts
  - Fixed import (getEmbeddingDatabase from registry)
  - Fixed Candidate type handling
  - Fixed upsertNarrativeArc parameters
  - Added POST /:id/chapters endpoint
  - Added GET /:id/chapters endpoint
```

---

## Next Steps for User

1. **Curate passages in UI** - Open Harvest Queue panel, approve passages
2. **Verify thumbnail rendering** - Visual Art passages should show thumbnails
3. **Test draft generation** - After approving passages, draft generation will work

---

## Key IDs Reference

| Resource | ID |
|----------|---|
| Visual Art book | `visual-art-mandala` |
| Harvest bucket | `dea7985a-c072-4156-b45f-a5535677a092` |
| Journal bucket | `546e1697-65f2-46f7-9188-90d139bc59a1` |
| Chapter 1 | `chapter-visual-art-mandala-1-1768667522766` |
| Chapter 2 | `chapter-visual-art-mandala-2-1768667522767` |
| Chapter 3 | `chapter-visual-art-mandala-3-1768667522767` |

---

## Commands for Testing

```bash
# List books
curl -s http://localhost:3002/api/books | jq '.books[].name'

# Get chapters
curl -s http://localhost:3002/api/books/visual-art-mandala/chapters | jq '.chapters[].title'

# Get arcs
curl -s http://localhost:3002/api/books/visual-art-mandala/arcs | jq '.arcs[].thesis'

# Start draft generation (after curation)
curl -s -X POST http://localhost:3002/api/draft/start \
  -H 'Content-Type: application/json' \
  -d '{"bookUri": "book://tem-noon/visual-art-mandala", "chapterId": "chapter-visual-art-mandala-1-1768667522766", "style": "narrative"}'
```

---

*Handoff created: January 17, 2026*
*Schema version: 17*
*Build status: ✅ Running*
