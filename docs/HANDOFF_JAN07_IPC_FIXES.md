# Handoff: IPC Handlers & Data Persistence Fixes

**Date**: January 7, 2026
**Status**: FIXES APPLIED - Ready for testing
**Predecessor**: HANDOFF_JAN06_PARITY_AUDIT.md

---

## Executive Summary

Implemented the "Thick Main" pattern per the Parity Specification. Added 8 IPC handlers for harvest curation and fixed critical data persistence bugs.

---

## What Was Implemented

### 1. Eight IPC Handlers in `electron/main.ts` (lines 972-1220)

```typescript
// Passage curation (4 handlers)
xanadu:harvest:approve-passage(bucketId, passageId)
xanadu:harvest:reject-passage(bucketId, passageId, reason?)
xanadu:harvest:gem-passage(bucketId, passageId)
xanadu:harvest:undo-passage(bucketId, passageId)

// Bucket lifecycle (4 handlers)
xanadu:harvest:finish-collecting(bucketId)
xanadu:harvest:stage-bucket(bucketId)
xanadu:harvest:commit-bucket(bucketId)
xanadu:harvest:discard-bucket(bucketId)
```

Each handler: loads bucket → performs operation → saves → returns `{success, error?}`

### 2. Preload Bridge in `electron/preload.ts`

Added `xanadu.harvest` API with all 8 methods exposed to renderer.

### 3. Type Definitions in `apps/web/src/types/electron.ts`

Added `HarvestCurationResult`, `HarvestStageResult`, `HarvestCommitResult` types and `harvest` property on `XanaduAPI`.

### 4. UI Wiring in `HarvestQueuePanel.tsx`

- `handlePassageAction` → calls IPC directly, refreshes from DB
- `handleStageBucket` → calls IPC, refreshes
- `handleCommitBucket` → calls IPC, refreshes
- `handleDiscardBucket` → calls IPC, refreshes

---

## Critical Bugs Fixed

### Bug 1: Race Condition in Harvest

**Problem**: `addCandidate()` fired 80 async saves, then `finishCollecting` IPC was called before saves completed. Database had 0 candidates.

**Fix** (`HarvestQueuePanel.tsx` ~line 479):
```typescript
// Save bucket with candidates to DB BEFORE calling finishCollecting
await window.electronAPI.xanadu.harvestBuckets.upsert({...currentBucket});
await window.electronAPI.xanadu.harvest.finishCollecting(bucketId);
```

### Bug 2: Buckets Never Loaded from Database

**Problem**: `HarvestBucketService.initialize()` said "data loads on-demand" but never loaded. `buckets` Map stayed empty.

**Fix** (`HarvestBucketService.ts` ~line 102):
```typescript
private async loadFromXanadu(): Promise<void> {
  const rawBuckets = await window.electronAPI!.xanadu.harvestBuckets.list();
  // Convert and populate this.buckets Map
}
```

### Bug 3: Crash on book.chapters.length

**Problem**: `AddToBookDialog.tsx` accessed `book.chapters.length` without null check.

**Fix**: Changed to `book.chapters?.length ?? 0` in AddToBookDialog.tsx and Studio.tsx.

---

## Database State (End of Session)

```sql
-- Books: 3 exist
SELECT id, name, status FROM books;
-- heart-sutra-science | Heart Sutra Science | harvesting
-- 1767733846537-nq5fokr1x | Buddhism and Phenomenology | drafting
-- 1767745832871-owf1uqkl6 | The Pulse of Lamain | harvesting

-- Buckets with approved passages: 8 exist
SELECT id, status, json_array_length(approved) + json_array_length(gems) as total
FROM harvest_buckets WHERE total > 0;
-- All status = 'reviewing' (none staged/committed yet)

-- Book passages: STILL 0 (need to test Stage → Commit flow)
SELECT COUNT(*) FROM book_passages;
-- 0
```

---

## Files Modified This Session

| File | Change |
|------|--------|
| `electron/main.ts` | Added 8 IPC handlers for harvest curation |
| `electron/preload.ts` | Added `xanadu.harvest` API bridge |
| `apps/web/src/types/electron.ts` | Added harvest result types |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | Wired all buttons to IPC |
| `apps/web/src/lib/bookshelf/HarvestBucketService.ts` | Added `loadFromXanadu()`, `refreshBucketFromXanadu()` |
| `apps/web/src/components/dialogs/AddToBookDialog.tsx` | Fixed null safety |
| `apps/web/src/Studio.tsx` | Fixed null safety |

---

## Next Session Requirements

### MANDATORY FIRST STEP
1. Restart app: `npm run electron:dev`
2. Check console for: `[HarvestBucketService] Loaded X buckets from Xanadu`
3. Verify buckets show correct counts (📥 ✓ 💎)
4. Test Stage → Commit flow on existing bucket with approved passages
5. Verify `book_passages` table has rows after commit

### If Stage/Commit Still Fails
1. Check console for error messages
2. Verify bucket status transitions: reviewing → staged → committed
3. Check if book lookup is working (URI mismatch issue noted)

### After Workflow Works
User requested: "Run all phases of book production from the API and give me a first draft"

This requires:
1. Working harvest → approve → stage → commit
2. Working chapter creation
3. Working first draft generation (needs `generate_first_draft` AUI tool)

---

## Verification Commands

```bash
# Check database state
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db \
  "SELECT status, COUNT(*) FROM harvest_buckets GROUP BY status;"

# Check book passages after commit
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db \
  "SELECT COUNT(*) FROM book_passages;"

# TypeScript check
cd /Users/tem/humanizer_root/humanizer-gm && npx tsc --noEmit
```

---

## Known Issues (Unchanged)

1. **No chapters table** - Schema may be incomplete
2. **Book URI mismatch** - `book://heart-sutra-science` vs `book://user/heart-sutra-science`
3. **CSS contrast** - Harvest cards in dark mode
4. **Search relevance** - Irrelevant results

---

## ChromaDB Tags

`ipc-handlers, thick-main, race-condition-fix, load-from-xanadu, jan-2026`

---

**END OF HANDOFF**
