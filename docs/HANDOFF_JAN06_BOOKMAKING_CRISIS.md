# Handoff: Book Making Crisis - Data Layer Fragmentation

**Date**: January 6, 2026 (1:30 AM EST)
**Branch**: `main`
**Status**: BLOCKED - Data architecture issues prevent book making from working

---

## Executive Summary

Book making is broken due to **fragmented data storage**. Data lives in multiple disconnected places, making it impossible to reliably create, harvest, and build books. The silent fallback fixes (DEBT-001/002/003) are committed but can't solve the underlying architecture problem.

---

## Critical Issues Identified

### 1. Data Lives in 5+ Disconnected Places

| Data Type | Storage Location | Access Method |
|-----------|------------------|---------------|
| Library Books (seed) | Hardcoded in `library-seed.ts` | Loaded at startup |
| User Books | SQLite `.embeddings.db` `books` table | IPC → Xanadu |
| Harvest Buckets | Browser localStorage `humanizer-harvest-buckets` | Direct localStorage |
| Book Passages | SQLite `book_passages` table | IPC → Xanadu |
| Personas/Styles | Mix of localStorage + SQLite | Inconsistent |

### 2. Conversation ID vs Folder Mismatch

**Root cause of 404 errors:**
- Search API returns `conversationId` (UUID like `d972e412-dfb8-486d-b1eb-a5573e7c7e9e`)
- Conversation lookup API expects `folder` name (like `2023-03-16_Súnyata-inspired_science._01388`)
- Old harvest data saved UUID, lookup fails with 404

**The fix requires**: Always save AND use `conversationFolder` for lookups, fall back to `conversationId` only for display.

### 3. Cannot Clear/Manage Books from UI

User reported: "Book projects have no CRUD abilities. I can create them, but then can't delete them, clear the harvest, clear drafts, or do anything else."

**Missing UI operations:**
- Delete book project
- Clear harvest bucket
- Clear all passages from book
- Reset book to harvesting state
- Delete individual passages

### 4. Data Persistence is Inconsistent

When I tried to clear books:
- Cleared SQLite `books` table → only had 1 book (Heart Sutra Science I created)
- UI still shows 4 books → coming from library seed + localStorage
- localStorage harvest buckets persist → still showing corrupted data

---

## What Was Fixed This Session

### DEBT-001: Silent Search Fallback (Committed)
- **Before**: Semantic search silently fell back to text search, returned fake content
- **After**: Returns explicit error with guidance to build embeddings
- **File**: `apps/web/src/lib/aui/tools.ts:969-990`

### DEBT-002: Harvest Content Validation (Committed)
- **Before**: Saved any search result, including empty/placeholder content
- **After**: Validates content exists, not placeholder, minimum 10 words
- **File**: `apps/web/src/lib/aui/tools.ts:3097-3136`

### DEBT-003: Show Load Errors in UI (Committed)
- **Before**: 404 errors only logged to console
- **After**: Error shown in red box in passage card
- **File**: `apps/web/src/components/tools/HarvestQueuePanel.tsx:62, 101-111, 178-182`

### API Field Mapping Fix (Committed)
- **Before**: Code expected snake_case (`conversation_id`), API returns camelCase (`conversationId`)
- **After**: Correct camelCase mapping
- **File**: `apps/web/src/lib/aui/tools.ts:1017-1034, 3088-3121`

---

## What Still Needs Fixing

### Priority 1: Unify Book Storage

All book-related data should live in ONE place (SQLite via Xanadu):
- Books
- Passages
- Harvest buckets
- Chapters
- Arcs

Remove localStorage fallbacks. If Xanadu isn't available, show error, don't silently use localStorage.

### Priority 2: Fix Conversation Lookup

The `/api/conversations/:id` endpoint should accept EITHER:
- UUID (`conversationId`)
- Folder name (`conversationFolder`)

Or search results should ALWAYS include `conversationFolder` and harvest should ONLY save that.

### Priority 3: Add Book CRUD Operations

UI needs:
```
- Delete Book button (with confirmation)
- Clear Harvest button
- Clear All Passages button
- Reset Book Status dropdown
```

API needs:
```
DELETE /api/xanadu/books/:id
POST /api/xanadu/books/:id/clear-harvest
POST /api/xanadu/books/:id/clear-passages
```

### Priority 4: End-to-End API-Only Book Creation

The AUI should be able to create a complete first draft without UI interaction:

```typescript
// 1. Create book
USE_TOOL(create_project, {name: "Heart Sutra Science", subtitle: "..."})

// 2. Harvest passages
USE_TOOL(harvest_archive, {queries: ["heart sutra", "emptiness quantum"], limit: 50})

// 3. Auto-curate (approve all above threshold)
USE_TOOL(auto_curate, {minSimilarity: 0.4, autoApprove: true})

// 4. Create narrative arc
USE_TOOL(trace_arc, {theme: "quantum emptiness", arcType: "thesis-journey"})

// 5. Generate first draft
USE_TOOL(generate_first_draft, {chapterTitle: "Form is Emptiness"})
```

Currently this flow breaks at step 2 due to data storage issues.

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `apps/web/src/lib/aui/tools.ts` | +84 lines: Silent fallback removal, field mapping, content validation |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | +16 lines: Error state display |
| `apps/web/src/index.css` | +16 lines: Error styling |
| `TECHNICAL_DEBT.md` | Created: 7 debt items documented |
| `docs/AUDIT_SILENT_FALLBACKS_JAN06.md` | Created: Full audit report |

---

## Commits This Session

```
2a00f23 fix(harvest): Eliminate silent fallbacks that corrupt book data (DEBT-001, DEBT-002, DEBT-003)
```

---

## How to Continue

### Option A: Fix Data Layer First
1. Audit all localStorage usage in bookshelf code
2. Migrate everything to Xanadu SQLite
3. Add proper book CRUD endpoints
4. Then test harvest flow

### Option B: Quick Fix for Testing
1. Clear browser localStorage completely
2. Add conversationFolder to harvest data save
3. Test fresh harvest with new book

### Browser localStorage keys to clear:
```javascript
localStorage.removeItem('humanizer-harvest-buckets');
localStorage.removeItem('humanizer-narrative-arcs');
localStorage.removeItem('humanizer-passage-links');
localStorage.removeItem('humanizer-bookshelf-books');
localStorage.removeItem('humanizer-bookshelf-personas');
localStorage.removeItem('humanizer-bookshelf-styles');
```

---

## House Agent Review Needed

Request council review of:

1. **Architect Agent**: Review data storage fragmentation, propose unified architecture
2. **Data Agent**: Audit all book-related schemas and storage locations
3. **Security Agent**: Check for data leakage between storage backends
4. **Debt Tracker**: Update TECHNICAL_DEBT.md with storage unification items

---

## Key Insight

The book making system was built incrementally with multiple storage backends:
1. First: localStorage for quick prototyping
2. Then: SQLite for embeddings
3. Then: Xanadu for unified storage
4. But: Never fully migrated, creating Frankenstein architecture

**The fix isn't more patches - it's completing the Xanadu migration.**

---

## Test Commands

```bash
# Check what's in the database
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db "SELECT id, name, status FROM books;"

# Check search API returns conversationFolder
curl -s -X POST http://localhost:3002/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "heart sutra", "limit": 1}' | jq '.results[0] | {conversationId, conversationFolder}'

# Test conversation lookup by folder
curl -s "http://localhost:3002/api/conversations/2023-03-16_Súnyata-inspired_science._01388" | jq '.title'
```

---

**End of Handoff**
