# Humanizer Operation Parity Specification

**Created**: January 6, 2026
**Status**: DEFINITIVE SPECIFICATION - No development until gaps resolved
**Purpose**: Achieve 100% parity between UI, IPC, AUI Tools, and REST API

---

## System Description (One Paragraph)

**Humanizer** harvests passages from your conversation archives using semantic search. You approve passages you want, mark special ones as gems, and reject the rest. When ready, you stage a batch and commit it to your book. The committed passages become available for narrative arc planning, where you choose a structure (progressive, dialectic, thematic) and the system organizes passages into chapters. Finally, you select a persona voice and generate a first draft that weaves the passages into prose. Every operation from harvest to draft is available both through the UI and through API calls that the AUI (or scripts) can invoke.

---

## Parity Matrix Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Exists and working |
| ⚠️ | Exists but broken/incomplete |
| ❌ | Does not exist |
| 🔇 | Exists but no feedback/silent |

---

## 1. BOOK MANAGEMENT

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| List books | ✅ | ✅ `xanadu:book:list` | ❌ | ❌ |
| Get book | ✅ | ✅ `xanadu:book:get` | ❌ | ❌ |
| Create book | ✅ | ✅ `xanadu:book:upsert` | ✅ `create_book` | ❌ |
| Update book | ✅ | ✅ `xanadu:book:upsert` | ❌ | ❌ |
| Delete book | ✅ | ✅ `xanadu:book:delete` | ❌ | ❌ |
| Set active book | ✅ | ❌ (context only) | ❌ | ❌ |

**Gaps**: No AUI tools for list/get/update/delete book. No REST API.

---

## 2. HARVEST BUCKET MANAGEMENT

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Create bucket | ✅ | ✅ `xanadu:harvest-bucket:upsert` | ✅ `harvest_for_thread` | ❌ |
| List buckets | ✅ | ✅ `xanadu:harvest-bucket:list` | ❌ | ❌ |
| Get bucket | ✅ | ✅ `xanadu:harvest-bucket:get` | ❌ | ❌ |
| Delete bucket | ✅ | ✅ `xanadu:harvest-bucket:delete` | ❌ | ❌ |

**Status**: CRUD exists, but these are just raw data operations.

---

## 3. HARVEST SEARCH (Finding Candidates)

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Semantic search | ✅ | ❌ (HTTP only) | ✅ `search_archive` | ✅ `/api/embeddings/search` |
| Add candidates to bucket | ✅ | ❌ | ✅ `harvest_for_thread` | ❌ |
| Search + auto-add | ✅ | ❌ | ✅ `harvest_archive` | ❌ |

**Status**: Search works. Adding to bucket requires frontend service.

---

## 4. PASSAGE CURATION (The Broken Part)

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Approve passage | 🔇 (no feedback) | ❌ | ❌ | ❌ |
| Reject passage | 🔇 (no feedback) | ❌ | ❌ | ❌ |
| Mark as gem | 🔇 (no feedback) | ❌ | ❌ | ❌ |
| Undo (move to candidates) | 🔇 (no feedback) | ❌ | ❌ | ❌ |

**CRITICAL GAP**: These operations exist ONLY in `HarvestBucketService.ts` (frontend JavaScript). They:
1. Modify in-memory arrays
2. Call `saveToStorage()` which fires async `xanadu:harvest-bucket:upsert`
3. Provide NO feedback on success/failure
4. Cannot be called by AUI or scripts

**Required IPC Handlers**:
```typescript
xanadu:harvest:approve-passage(bucketId, passageId) → {success, error?}
xanadu:harvest:reject-passage(bucketId, passageId, reason?) → {success, error?}
xanadu:harvest:gem-passage(bucketId, passageId) → {success, error?}
xanadu:harvest:undo-passage(bucketId, passageId) → {success, error?}
```

---

## 5. BUCKET LIFECYCLE (The Other Broken Part)

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Finish collecting | ✅ | ❌ | ❌ | ❌ |
| Stage bucket | 🔇 (no feedback) | ❌ | ❌ | ❌ |
| Commit bucket | 🔇 (no feedback) | ❌ | ❌ | ❌ |
| Discard bucket | ✅ | ❌ | ❌ | ❌ |

**CRITICAL GAP**: Stage and commit are frontend-only with silent failures.

**Required IPC Handlers**:
```typescript
xanadu:harvest:finish-collecting(bucketId) → {success, error?}
xanadu:harvest:stage-bucket(bucketId) → {success, error?}
xanadu:harvest:commit-bucket(bucketId) → {success, passageCount, error?}
xanadu:harvest:discard-bucket(bucketId) → {success, error?}
```

---

## 6. BOOK PASSAGES (After Commit)

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| List passages | ✅ | ✅ `xanadu:passage:list` | ✅ `list_passages` | ❌ |
| Add passage | ✅ | ✅ `xanadu:passage:upsert` | ✅ `add_passage` | ❌ |
| Update curation status | ✅ | ✅ `xanadu:passage:curate` | ✅ `mark_passage` | ❌ |
| Delete passage | ✅ | ✅ `xanadu:passage:delete` | ❌ | ❌ |

**Status**: Mostly complete. Passages CAN be added/managed once they exist in the book.

---

## 7. NARRATIVE ARCS

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Create arc | ✅ | ✅ `xanadu:narrative-arc:upsert` | ✅ `propose_narrative_arc` | ❌ |
| List arcs | ✅ | ✅ `xanadu:narrative-arc:list` | ❌ | ❌ |
| Get arc | ✅ | ✅ `xanadu:narrative-arc:get` | ❌ | ❌ |
| Update arc | ✅ | ✅ `xanadu:narrative-arc:upsert` | ❌ | ❌ |
| Delete arc | ✅ | ✅ `xanadu:narrative-arc:delete` | ❌ | ❌ |
| Trace arc through archive | ✅ | ❌ | ✅ `trace_arc` | ❌ |

**Status**: CRUD exists. Some AUI tools exist.

---

## 8. CHAPTERS

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| List chapters | ✅ | ✅ `xanadu:chapter:list` | ✅ `list_chapters` | ❌ |
| Get chapter | ✅ | ✅ `xanadu:chapter:get` | ✅ `get_chapter` | ❌ |
| Create chapter | ✅ | ✅ `xanadu:chapter:upsert` | ✅ `create_chapter` | ❌ |
| Update chapter | ✅ | ✅ `xanadu:chapter:upsert` | ✅ `update_chapter` | ❌ |
| Delete chapter | ✅ | ✅ `xanadu:chapter:delete` | ✅ `delete_chapter` | ❌ |

**Status**: Complete parity between UI, IPC, and AUI.

---

## 9. DRAFT GENERATION

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| Generate first draft | ⚠️ | ❌ | ✅ `generate_first_draft` | ❌ |
| Build pyramid | ⚠️ | ❌ | ✅ `build_pyramid` | ❌ |
| Search pyramid | ⚠️ | ❌ | ✅ `search_pyramid` | ❌ |
| Render book | ✅ | ❌ | ✅ `render_book` | ❌ |

**Status**: AUI tools exist but may depend on npe-api availability.

---

## 10. PERSONAS & STYLES

| Operation | UI Button | IPC Handler | AUI Tool | REST API |
|-----------|-----------|-------------|----------|----------|
| List personas | ✅ | ✅ `xanadu:persona:list` | ✅ `list_personas` | ❌ |
| Create persona | ✅ | ✅ `xanadu:persona:upsert` | ✅ `create_persona` | ❌ |
| Extract persona | ⚠️ | ❌ | ✅ `extract_persona` | ✅ npe-api |
| Apply persona | ⚠️ | ❌ | ✅ `apply_persona` | ✅ npe-api |
| List styles | ✅ | ✅ `xanadu:style:list` | ✅ `list_styles` | ❌ |
| Create style | ✅ | ✅ `xanadu:style:upsert` | ✅ `create_style` | ❌ |

**Status**: Good parity. Some operations depend on npe-api.

---

## GAP SUMMARY

### Critical (Workflow Blocking)

| Gap | Impact | Fix Required |
|-----|--------|--------------|
| No IPC for passage curation | AUI cannot approve/reject/gem passages | Add 4 IPC handlers |
| No IPC for bucket lifecycle | AUI cannot stage/commit | Add 4 IPC handlers |
| No feedback from UI buttons | Users think buttons are broken | Add return values + UI feedback |

### Important (Feature Incomplete)

| Gap | Impact | Fix Required |
|-----|--------|--------------|
| No AUI tool for list_books | AUI can't enumerate books | Add tool |
| No AUI tool for get_book | AUI can't inspect book details | Add tool |
| No AUI tool for delete_book | AUI can't clean up | Add tool |
| No AUI tool for list_buckets | AUI can't see harvest state | Add tool |
| No REST API for any operation | Scripts can't help debug | Consider adding |

### Minor (Nice to Have)

| Gap | Impact | Fix Required |
|-----|--------|--------------|
| No AUI tool for list_arcs | Minor workflow gap | Add tool |
| No AUI tool for delete_passage | Minor workflow gap | Add tool |

---

## IMPLEMENTATION PRIORITY

### Phase 1: Fix the Broken Core (8 IPC handlers)

Add these IPC handlers in `electron/main.ts`:

```typescript
// Passage curation (operate on bucket's arrays)
xanadu:harvest:approve-passage
xanadu:harvest:reject-passage
xanadu:harvest:gem-passage
xanadu:harvest:undo-passage

// Bucket lifecycle (state transitions)
xanadu:harvest:finish-collecting
xanadu:harvest:stage-bucket
xanadu:harvest:commit-bucket
xanadu:harvest:discard-bucket
```

Each handler should:
1. Load bucket from database
2. Perform the operation (move passage between arrays OR change status)
3. Save bucket back to database
4. Return `{success: boolean, error?: string, data?: any}`

### Phase 2: Add Missing AUI Tools (6 tools)

```typescript
list_books      → calls xanadu:book:list
get_book        → calls xanadu:book:get
delete_book     → calls xanadu:book:delete
list_buckets    → calls xanadu:harvest-bucket:list
approve_passage → calls xanadu:harvest:approve-passage (NEW)
stage_bucket    → calls xanadu:harvest:stage-bucket (NEW)
commit_bucket   → calls xanadu:harvest:commit-bucket (NEW)
```

### Phase 3: Fix UI Feedback

Update `HarvestQueuePanel.tsx` to:
1. Call new IPC handlers instead of frontend service
2. Show loading state during async operations
3. Show success/error toast on completion
4. Update local state only after confirmed success

### Phase 4: Deprecate Frontend Service Methods

Once IPC handlers work:
1. Remove `HarvestBucketService.approvePassage()` etc.
2. Keep service only for in-memory state management
3. All mutations go through IPC

---

## VERIFICATION CHECKLIST

After implementation, verify each operation:

```bash
# Can query database directly
sqlite3 .embeddings.db "SELECT * FROM harvest_buckets"
sqlite3 .embeddings.db "SELECT * FROM book_passages"

# Can call IPC from DevTools console
window.electronAPI.xanadu.harvestBuckets.list()
window.electronAPI.xanadu.harvest.approvePassage(bucketId, passageId)

# Can use AUI tool
USE_TOOL(approve_passage, {bucket_id: "...", passage_id: "..."})

# UI shows feedback
[Button click] → [Loading spinner] → [Success toast] → [UI updates]
```

---

## ACCEPTANCE CRITERIA

The system is complete when:

1. **Every operation in this document has ✅ in all applicable columns**
2. **A user can complete the full workflow via UI with clear feedback**
3. **The same workflow can be completed entirely via AUI tools**
4. **Claude Code can help debug by calling IPC handlers or querying DB**
5. **The system can be explained in one paragraph (see top of document)**

---

## APPENDIX: Current Database Schema

```sql
-- Books
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  uri TEXT UNIQUE,
  name TEXT,
  status TEXT,  -- drafting, harvesting, reviewing, published
  ...
);

-- Passages (committed)
CREATE TABLE book_passages (
  id TEXT PRIMARY KEY,
  book_id TEXT REFERENCES books(id),
  text TEXT,
  curation_status TEXT,  -- candidate, approved, gem, rejected
  ...
);

-- Harvest Buckets (staging)
CREATE TABLE harvest_buckets (
  id TEXT PRIMARY KEY,
  book_id TEXT REFERENCES books(id),
  status TEXT,  -- collecting, reviewing, staged, committed, discarded
  candidates TEXT,  -- JSON array
  approved TEXT,    -- JSON array
  gems TEXT,        -- JSON array
  rejected TEXT,    -- JSON array
  ...
);
```

---

**END OF SPECIFICATION**

*No code changes until this specification is reviewed and approved.*
