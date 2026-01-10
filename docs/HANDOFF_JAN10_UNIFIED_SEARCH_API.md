# Handoff: Unified Search API Implementation

**Date**: January 10, 2026
**Status**: IMPLEMENTED - Needs Testing
**Branch**: main (uncommitted changes)

---

## What Was Built

### New Unified Search API

**Endpoint**: `POST /api/embeddings/search/unified`

**File**: `electron/archive-server/routes/embeddings.ts` (lines 381-513)

**Purpose**: Search BOTH AI conversations (vec_messages) AND Facebook content (vec_content_items) in a single query, returning merged results sorted by similarity.

**Request**:
```json
{
  "query": "family celebration",
  "limit": 20,
  "sources": ["facebook", "openai"],  // Optional filter
  "types": ["post", "comment", "message"],  // Optional filter
  "includeMessages": true,
  "includeContentItems": true
}
```

**Response**:
```json
{
  "query": "family celebration",
  "total": 15,
  "stats": {
    "messages": 8,
    "posts": 5,
    "comments": 2,
    "documents": 0
  },
  "results": [
    {
      "id": "msg-123",
      "type": "message",
      "source": "openai",
      "content": "...",
      "similarity": 0.85,
      "conversationId": "...",
      "conversationTitle": "..."
    },
    {
      "id": "fb_post_456",
      "type": "post",
      "source": "facebook",
      "content": "...",
      "similarity": 0.82,
      "authorName": "...",
      "createdAt": 1234567890
    }
  ]
}
```

### Updated search_archive Tool

**File**: `apps/web/src/lib/aui/tools.ts` (lines 951-1095)

Now calls `/api/embeddings/search/unified` instead of `/api/embeddings/search/messages`.

**Changes**:
- Searches ALL content types (AI + Facebook + documents)
- Returns source breakdown in message: "Found 15 results (8 AI messages, 5 Facebook posts, 2 Facebook comments)"
- Supports optional `sources` parameter to filter by source type
- Extended result fields include `type`, `source`, `authorName`, `createdAt`

---

## Database State Discovery

### Facebook Content
- **content_items**: 19,100 (9,909 posts + 9,190 comments)
- **vec_content_items**: 16,048 embeddings (84% coverage)

### AI Conversations
- **messages**: 36,255
- **vec_messages**: 59,903 embeddings (includes chunks)

### Images
- **image_analysis**: 9 (very few analyzed)
- **vec_image_descriptions**: 0 (no embeddings)
- **media_items**: 0 (not indexed)

---

## What Needs Testing

1. **Test unified search API**:
```bash
curl -s -X POST 'http://localhost:3002/api/embeddings/search/unified' \
  -H 'Content-Type: application/json' \
  -d '{"query": "family celebration birthday", "limit": 10}' | jq .
```

2. **Test Facebook-only search**:
```bash
curl -s -X POST 'http://localhost:3002/api/embeddings/search/unified' \
  -H 'Content-Type: application/json' \
  -d '{"query": "family", "limit": 10, "sources": ["facebook"]}' | jq .
```

3. **Test via AUI**:
   - Open AUI chat
   - Run: `USE_TOOL(search_archive, {"query": "family gathering"})`
   - Verify results include Facebook content

4. **Test book harvesting** with Facebook content:
   - Create new book project
   - Run harvest with a query
   - Verify Facebook posts/comments appear as candidates

---

## Files Modified (Uncommitted)

| File | Change |
|------|--------|
| `electron/archive-server/routes/embeddings.ts` | Added unified search route |
| `apps/web/src/lib/aui/tools.ts` | Updated search_archive to use unified endpoint |

---

## CSS Fixes Also Done This Session

Committed earlier (`020253a`):
- Light mode blue accent: `hsl(220, 84%, 77%)`
- Fixed `studio.css` override that was forcing dark blue
- Active button text uses `var(--studio-text)` for readability

---

## Known Remaining Gaps

1. **Image embeddings**: Vision descriptions exist but no embeddings
2. **Media items**: Not indexed yet (media_items table empty)
3. **~16% Facebook content** without embeddings (need backfill)
4. **harvest_archive tool**: May also need updating to use unified search

---

## Restart Prompt

```
Continue from docs/HANDOFF_JAN10_UNIFIED_SEARCH_API.md

The unified search API is implemented but needs testing. First:

1. Rebuild and restart the dev server
2. Test the unified search endpoint:
   curl -s -X POST 'http://localhost:3002/api/embeddings/search/unified' \
     -H 'Content-Type: application/json' \
     -d '{"query": "family", "limit": 5}' | jq .

3. If working, commit the changes
4. Test via AUI search_archive tool
5. Consider updating harvest_archive to also use unified search
```

---

**End of Handoff**
