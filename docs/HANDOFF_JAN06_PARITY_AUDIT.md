# Handoff: Parity Specification & Architecture Audit

**Date**: January 6, 2026 (Evening Session)
**Status**: DEVELOPMENT FROZEN - Specification requires review
**Predecessor**: HANDOFF_JAN06_HARVEST_FIX.md

---

## Executive Summary

After attempting to fix the harvest commit flow (again), the user correctly identified that we were creating yet another parallel system. Development was halted. A comprehensive audit was conducted. The result is a **Parity Specification** that documents every operation, what exists, what's broken, and what's missing.

**Key Discovery**: The entire passage curation workflow (approve/reject/gem/stage/commit) exists ONLY in frontend JavaScript with no IPC handlers, no AUI tools, and no error feedback. This is why buttons appear broken.

---

## What Was Attempted (And Stopped)

### Initial Fix Attempt
Modified `HarvestBucketService.commitBucket()` to use Xanadu IPC:
- Made function async
- Added `isXanaduPassagesAvailable()` helper
- Loops through approved passages calling `xanadu.passages.upsert()`
- Updated `BookshelfContext.tsx` and `HarvestQueuePanel.tsx` for async

**Commit**: `9df41db fix(harvest): Route commitBucket() through Xanadu IPC`

### Why It Didn't Work
The user staged and committed passages, but `book_passages` table remained empty. Further investigation revealed:
1. The approve/gem/reject buttons provide no feedback
2. Status changes aren't persisting (buckets stuck in "reviewing")
3. The entire curation flow is fire-and-forget with swallowed errors

### User's Correct Observation
> "The problem with Option A is we risk (like the two book systems) having 2 incompatible systems which become entrenched in the codebase... So PLEASE stop developing, and audit everything."

---

## Audit Conducted

Three parallel audits were run:

### 1. Storage Systems Audit
- **Database**: Single `.embeddings.db` with 25+ tables including Xanadu schema
- **87 IPC handlers** in electron/main.ts
- **36 Xanadu handlers** for CRUD operations
- **localStorage**: Mostly deprecated, used for UI state only
- **Migration**: Complete from localStorage to Xanadu

### 2. Frontend Services Audit
- **BookshelfService.ts** (748 lines): localStorage ONLY, deprecated
- **HarvestBucketService.ts** (938 lines): Dual-mode, contains ALL curation logic
- **BookshelfContext.tsx** (1,502 lines): React context, 64 async patterns
- **Problem**: Curation operations are frontend-only methods that modify in-memory state

### 3. AUI Tools Audit
- **52 tools** defined (not 43 as previously documented)
- **All claim WORKING** but passage curation tools don't exist
- Book/chapter tools work because they have IPC handlers
- Harvest tools create buckets but can't curate passages

---

## The Root Cause (Documented)

```
┌─────────────────────────────────────────────────────────────────┐
│  WHAT EXISTS                                                    │
├─────────────────────────────────────────────────────────────────┤
│  IPC: xanadu:harvest-bucket:upsert (saves ENTIRE bucket JSON)   │
│                                                                 │
│  Frontend: HarvestBucketService.approvePassage()                │
│            → modifies bucket.candidates/approved arrays         │
│            → calls saveToStorage()                              │
│            → which calls saveBucketToXanadu() async             │
│            → which fires xanadu:harvest-bucket:upsert           │
│            → NO RETURN VALUE, NO ERROR HANDLING                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  WHAT'S MISSING                                                 │
├─────────────────────────────────────────────────────────────────┤
│  IPC: xanadu:harvest:approve-passage(bucketId, passageId)       │
│       xanadu:harvest:reject-passage(bucketId, passageId)        │
│       xanadu:harvest:gem-passage(bucketId, passageId)           │
│       xanadu:harvest:stage-bucket(bucketId)                     │
│       xanadu:harvest:commit-bucket(bucketId)                    │
│       ... etc (8 handlers total)                                │
│                                                                 │
│  Each should return {success: boolean, error?: string}          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Parity Specification Created

**File**: `docs/PARITY_SPECIFICATION.md`
**Commit**: `24f3c9d`

### Contents
1. One-paragraph system description
2. Parity matrix for 10 operation categories
3. Gap analysis with severity ratings
4. Implementation phases (1-4)
5. Verification checklist
6. Acceptance criteria

### Critical Gaps Identified

| Operation | UI | IPC | AUI | Status |
|-----------|-----|-----|-----|--------|
| Approve passage | 🔇 | ❌ | ❌ | BROKEN |
| Reject passage | 🔇 | ❌ | ❌ | BROKEN |
| Mark as gem | 🔇 | ❌ | ❌ | BROKEN |
| Stage bucket | 🔇 | ❌ | ❌ | BROKEN |
| Commit bucket | 🔇 | ❌ | ❌ | BROKEN |

(🔇 = exists but no feedback, ❌ = does not exist)

---

## Database State (End of Session)

```sql
-- Books: 3 exist
SELECT id, name, status FROM books;
-- heart-sutra-science | Heart Sutra Science | harvesting
-- 1767733846537-nq5fokr1x | Buddhism and Phenomenology | drafting
-- 1767745832871-owf1uqkl6 | The Pulse of Lamain | harvesting

-- Passages: STILL ZERO
SELECT COUNT(*) FROM book_passages;
-- 0

-- Harvest Buckets: 18 exist, none committed
SELECT id, status, json_array_length(approved) FROM harvest_buckets
WHERE json_array_length(approved) > 0;
-- harvest-1767751721495-duut | reviewing | 5
-- harvest-1767747430313-c10v | reviewing | 4
```

The approved passages exist in bucket JSON but never reach `book_passages` table.

---

## Files Modified This Session

| File | Change |
|------|--------|
| `HarvestBucketService.ts` | Added `isXanaduPassagesAvailable()`, made `commitBucket()` async |
| `BookshelfContext.tsx` | Updated type and wrapper for async commitBucket |
| `HarvestQueuePanel.tsx` | Updated handler for async commit |
| `docs/PARITY_SPECIFICATION.md` | **NEW** - Definitive specification |

---

## Commits This Session

```
9df41db fix(harvest): Route commitBucket() through Xanadu IPC
24f3c9d docs: Add definitive parity specification for harvest/book operations
```

---

## Known Issues (Unchanged)

1. **CSS contrast**: Harvest cards use hardcoded light colors, no dark mode
2. **Search relevance**: Bank statements matching "Heart Sutra Science"
3. **UI feedback**: All curation buttons are silent

---

## Next Session Requirements

### MANDATORY FIRST STEP
Walk through `docs/PARITY_SPECIFICATION.md` with user to:
1. Verify completeness
2. Identify any missing operations
3. Agree on implementation order
4. Get explicit approval before any coding

### Implementation Order (After Approval)
1. **Phase 1**: Add 8 IPC handlers in `electron/main.ts`
2. **Phase 2**: Add corresponding AUI tools
3. **Phase 3**: Update UI to use IPC with feedback
4. **Phase 4**: Remove frontend-only mutation methods

### Verification Method
```bash
# After Phase 1, test via DevTools:
await window.electronAPI.xanadu.harvest.approvePassage(bucketId, passageId)
# Should return {success: true} or {success: false, error: "..."}

# Then verify in database:
sqlite3 .embeddings.db "SELECT json_array_length(approved) FROM harvest_buckets WHERE id='...'"
```

---

## User Sentiment

The user is frustrated by:
- Weeks of work on incompatible parallel systems
- Context loss across sessions
- Having to manually test UI buttons that don't work
- Lack of scriptable/debuggable operations

They explicitly requested:
> "100% parity between what the front end can do and what the tools the AUI has access to"

This is the correct requirement. The specification documents it. No more coding until it's approved.

---

## ChromaDB Tags
`parity-spec, architecture-audit, harvest-broken, ipc-gaps, commit-broken, jan-2026`

---

**END OF HANDOFF**
