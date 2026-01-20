# Handoff: Backend-First Book Maker + Harvest Fix

**Date**: January 20, 2026
**Session**: Book Maker Production Implementation
**Status**: COMPLETE - All harvest API integration working

---

## Commits Summary

| Commit | Description | Lines Changed |
|--------|-------------|---------------|
| e0c3dfe | Backend APIs (Config, Pyramid, Grading, Harvest) | +4,760 |
| ac85afd | UI Modal refactoring (6 views) | +7,143/-1,421 |
| 153b747 | Harvest search filtering (min content length) | +204/-45 |
| 3acd3e5 | Harvest result→card conversion | +60/-5 |

---

## What Was Accomplished

### 1. Backend-First Architecture

Created comprehensive backend APIs for Book Maker:

**Archive Server (:3002)**:
- `services/ConfigService.ts` - Configuration management
- `services/HarvestService.ts` - Smart harvest logic with filtering
- `services/embeddings/PyramidService.ts` - 3-level embedding pyramid
- `routes/config.ts`, `routes/harvest.ts`, `routes/pyramid.ts`

**Book Studio Server (:3004)**:
- `services/ConfigService.ts` - Config for grading/UI/draft
- `services/GradingService.ts` - Card grading (stub, Chekhov, SIC, Quantum)
- `services/GradingQueueService.ts` - SQLite-backed background queue
- `routes/config.ts`, `routes/grading.ts`
- Migration 3: `grading_queue` table

### 2. Frontend Modal Refactoring

Refactored UI into modular Book Maker modal:
- `BookMakerModal.tsx` + 65KB CSS
- Views: Harvest, Staging, Chapters, Outline, Writing
- Extracted from monolithic BooksView (1358→179 lines)

### 3. Frontend API Clients

Thin clients that call backend APIs:
- `apps/web/src/lib/config/ConfigClient.ts`
- `apps/web/src/lib/book-studio/harvest-api.ts` (with `convertToHarvestCard()`)
- `apps/web/src/lib/book-studio/grading-api.ts`
- `apps/web/src/lib/book-studio/pyramid-api.ts`

---

## Issues Resolved

### Issue 1: Harvest Returns Short Junk Content

**Problem**: Search returned 100 results but all were rejected (short Facebook posts).

**Solution**: HarvestService now uses `searchMessagesFiltered` which has built-in `LENGTH(content) > 50` filter in SQL.

### Issue 2: Result→Card Type Mismatch

**Problem**: Backend returns `{original, stubType, grade}`, frontend expected `{card}`.

**Solution**: Added `convertToHarvestCard()` function in `harvest-api.ts` that converts `ExpandedResult` to `HarvestCard`. Updated `BookStudioProvider` and `HarvestView` to use this conversion.

---

## Test Commands

```bash
# Check servers
curl http://localhost:3002/api/health
curl http://localhost:3004/api/health

# Test harvest API (WORKS)
curl -X POST http://localhost:3002/api/harvest \
  -H "Content-Type: application/json" \
  -d '{"query":"meditation mindfulness consciousness","target":5,"sse":false}' | jq '.stats'

# Expected output:
# {"totalSearched": 100, "totalRejected": 0, "totalExpanded": 0, "exhausted": false}

# Test grading queue
curl http://localhost:3004/api/grading/queue
```

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

## Key Files Changed

| File | Change |
|------|--------|
| `harvest-api.ts` | Added `convertToHarvestCard()` function |
| `BookStudioProvider.tsx` | Uses `convertToHarvestCard` for result mapping |
| `HarvestView.tsx` | Updated to use `result.original` instead of `result.card` |
| `HarvestService.ts` | Uses filtered search with content length minimum |

---

## Next Steps

1. ✅ ~~Complete harvest result → card conversion~~
2. Test full workflow: Harvest → Staging → Outline → Draft (in app)
3. Add progress indicators for grading queue
4. Implement real-time WebSocket updates for grading completion

---

## Notes

- Harvest quality depends on semantic search relevance - some queries return better matches than others
- Default `minWordCount` is 20 words (configurable in `/api/config`)
- The `convertToHarvestCard` function creates a partial `CardGrade` with default values that will be refined by full grading
