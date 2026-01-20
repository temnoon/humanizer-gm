# Handoff: Backend-First Book Maker + Harvest Fix

**Date**: January 20, 2026
**Session**: Book Maker Production Implementation
**Status**: IN PROGRESS - Harvest API integration incomplete

---

## What Was Accomplished

### 1. Backend-First Architecture (COMMITTED)

Created comprehensive backend APIs for Book Maker (**commit e0c3dfe**):

**Archive Server (:3002)**:
- `services/ConfigService.ts` - Configuration management
- `services/HarvestService.ts` - Smart harvest logic
- `services/embeddings/PyramidService.ts` - 3-level embedding pyramid
- `routes/config.ts`, `routes/harvest.ts`, `routes/pyramid.ts`

**Book Studio Server (:3004)**:
- `services/ConfigService.ts` - Config for grading/UI/draft
- `services/GradingService.ts` - Card grading (stub, Chekhov, SIC, Quantum)
- `services/GradingQueueService.ts` - SQLite-backed background queue
- `routes/config.ts`, `routes/grading.ts`
- Migration 3: `grading_queue` table

### 2. Frontend Modal Refactoring (COMMITTED)

Refactored UI into modular Book Maker modal (**commit ac85afd**):
- `BookMakerModal.tsx` + 65KB CSS
- Views: Harvest, Staging, Chapters, Outline, Writing
- Extracted from monolithic BooksView (1358→179 lines)

### 3. Frontend API Clients (COMMITTED)

Thin clients that call backend APIs:
- `apps/web/src/lib/config/ConfigClient.ts`
- `apps/web/src/lib/book-studio/harvest-api.ts`
- `apps/web/src/lib/book-studio/grading-api.ts`
- `apps/web/src/lib/book-studio/pyramid-api.ts`

---

## Current Issue: Harvest Returns No Results

### Problem
Console shows "Search returned 100 results" but nothing appears in staging.

### Root Cause
1. **Unfiltered search returns short junk**: Facebook posts like "Monday Mooji" (3 words)
2. **All 100 results rejected**: Too short for minWordCount threshold
3. **Good content exists**: Filtered search finds substantive Heart Sutra content

### Fix In Progress (NOT COMMITTED)

**HarvestService.ts** - Updated to use filtered search:
```typescript
// Use filtered search which returns substantive content
const messageResults = embDb.searchMessagesFiltered(
  queryEmbedding,
  [],
  searchLimit * 3  // Search 3x to account for filtering
);

// Skip short content early
const minContentLength = 50;
if (!result.content || result.content.length < minContentLength) continue;
```

**BookStudioProvider.tsx** - Started migration to backend API:
```typescript
import { runHarvest as runHarvestApi } from './harvest-api'
// ...
const result = await runHarvestApi(query, onProgress, config)
```

### Remaining Work

1. **Fix result mapping**: Backend returns `{original, stubType, grade}`, frontend expects `{card}`
2. **Convert results to cards**: Add card creation in provider or update API response
3. **Test end-to-end**: Harvest → Staging → Outline → Chapter → Writing

---

## Test Commands

```bash
# Check servers
curl http://localhost:3002/api/health
curl http://localhost:3004/api/health

# Test filtered search (WORKS)
curl -X POST http://localhost:3002/api/embeddings/search/filtered \
  -H "Content-Type: application/json" \
  -d '{"query":"Heart Sutra Buddhism","limit":5}' | jq '.results[0].content[:200]'

# Test harvest API (NEEDS FIX)
curl -X POST http://localhost:3002/api/harvest \
  -H "Content-Type: application/json" \
  -d '{"query":"Heart Sutra","target":10,"sse":false}' | jq '.stats'

# Test grading queue
curl http://localhost:3004/api/grading/queue
```

---

## Files Modified (NOT COMMITTED)

| File | Change |
|------|--------|
| `electron/archive-server/services/HarvestService.ts` | Use filtered search, min content length |
| `apps/web/src/lib/book-studio/BookStudioProvider.tsx` | Import harvest-api, call runHarvestApi |

---

## Architecture Summary

```
┌─────────────────┐     ┌─────────────────┐
│   Book Maker    │     │   Archive API   │
│   Modal (React) │────▶│   :3002         │
└────────┬────────┘     │   /api/harvest  │
         │              │   /api/pyramid  │
         │              │   /api/config   │
         │              └─────────────────┘
         │              ┌─────────────────┐
         └─────────────▶│   Book Studio   │
                        │   :3004         │
                        │   /api/grading  │
                        │   /api/books    │
                        │   /api/cards    │
                        └─────────────────┘
```

---

## Next Steps

1. Complete harvest result → card conversion
2. Test full workflow: Harvest → Staging → Outline → Draft
3. Commit fixes
4. Add progress indicators for grading queue
