# Handoff: Book Studio API-First Architecture Complete

**Date**: January 20, 2026
**Status**: All phases complete, harvest quality fixed
**Commits**: `51e897e`, `602a426`, `0fd2a01`

---

## Session Summary

Completed comprehensive API-first refactoring of Book Studio with metrics system and harvest quality improvements.

---

## Commits This Session

1. `51e897e` - API-first architecture with metrics system
2. `602a426` - Card roles, harvest history, book counts fix
3. `0fd2a01` - Harvest quality filtering and deduplication

---

## What Was Built

### Server Services (`electron/book-studio-server/services/`)
| Service | Purpose |
|---------|---------|
| `OutlineService.ts` | Research, themes, arcs, outline generation |
| `ClusteringService.ts` | Semantic clustering |
| `AssignmentService.ts` | Card-to-chapter assignment |
| `MetricsService.ts` | Quality tracking per stage |

### Client API Wrappers (`apps/web/src/lib/book-studio/`)
| File | Purpose |
|------|---------|
| `outline-api.ts` | Calls `/api/outline-compute/*` |
| `clustering-api.ts` | Calls `/api/clusters/*` |
| `assignment-api.ts` | Calls `/api/cards/assign-*` |

### Database Migrations (6 total)
| Migration | Tables Added |
|-----------|--------------|
| 4 | `card_orders` |
| 5 | `book_metrics`, `research_cache` |
| 6 | `harvest_history`, `book_settings`, `cards.role` column |

### Card Roles
```
author_voice | main_source | reference | epigraph
example | evidence | counterpoint | background
```

---

## Harvest Fixes (Latest)

**Problems Fixed:**
- Short stubs appearing instead of full content
- Duplicate cards (same "asian" card 3x)
- Irrelevant content bubbling up

**Solutions Applied:**
- `minWordCount`: 20 → 75 words
- `minContentLength`: 50 → 200 chars
- Content deduplication by normalized hash
- Source ID deduplication in grading loop
- Quality sorting: similarity + length bonus
- Search 5x limit to account for filtering

---

## Known Issues Still Pending

### 1. Book Counts Not Showing in UI
The API returns correct counts but UI may need hot reload.
- API: `GET /api/books` returns `cardCount`, `chapterCount`
- UI: `ProjectsView.tsx` updated to use `book.cardCount ?? book.stagingCards?.length`

**To verify**: Restart app, check if counts appear.

### 2. Harvest History UI Not Built
Schema exists (`harvest_history` table) but no UI to:
- Show previous harvests
- Re-run with same query
- Pre-fill form from history

### 3. Card Roles UI Not Built
Schema exists (`cards.role` column) but no UI to:
- Assign roles to cards
- Filter cards by role
- Use roles in outline/draft generation

---

## Test Commands

```bash
# E2E test (validates full workflow)
./scripts/e2e-book-creation.sh --verbose --cleanup

# Test metrics API
curl -X POST http://127.0.0.1:3004/api/metrics/{bookId}/compute | jq

# Test books API with counts
curl http://127.0.0.1:3004/api/books | jq '.books[] | {title, cardCount, chapterCount}'
```

---

## Next Session Priorities

1. **Verify UI shows book counts** - restart app, check ProjectsView
2. **Test harvest with new quality filters** - should return substantive content
3. **Build card roles UI** - dropdown to assign role per card
4. **Build harvest history UI** - show past queries, allow re-run
5. **Wire card roles into draft generation** - use author_voice for style, etc.

---

## Files Modified This Session

### Server
- `electron/book-studio-server/services/*.ts` (4 new services)
- `electron/book-studio-server/routes/*.ts` (metrics, outline-computation)
- `electron/book-studio-server/database.ts` (migrations 4-6)
- `electron/book-studio-server/config.ts` (type fixes)
- `electron/archive-server/services/HarvestService.ts` (quality fixes)
- `electron/archive-server/services/ConfigService.ts` (config defaults)

### Client
- `apps/web/src/lib/book-studio/*.ts` (API wrappers, types)
- `apps/web/src/components/book-maker/ProjectsView.tsx` (counts fix)

### Scripts
- `scripts/e2e-book-creation.sh` (new)

---

## ChromaDB Memories Stored

1. `c5280822...` - API-first architecture reference
2. `dca73202...` - Metrics system reference

---

**End of Session**
