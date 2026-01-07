# Handoff: Harvest Search Fix & Xanadu Migration Audit Needed
**Date**: January 6, 2026
**Status**: Harvest Search FIXED, Commit Flow BROKEN

---

## Executive Summary

The harvest search now returns **substantive assistant messages** instead of garbage. However, the **commit flow** is broken because `HarvestBucketService.commitBucket()` uses the old `bookshelfService` (localStorage) instead of Xanadu IPC.

---

## What Was Fixed

### 1. Role Filter Applied After Limiting (CRITICAL)
**Problem**: Search returned top 40 results (mostly user messages), THEN filtered to `role='assistant'` → only a few short responses left.

**Fix** (`EmbeddingDatabase.ts:2789-2818`):
```sql
SELECT * FROM (
  -- Inner query fetches 10x limit
  WHERE embedding MATCH ? AND k = ?
)
WHERE role = ?
  AND LENGTH(content) > 200
  AND content NOT LIKE 'search("%'  -- Filter tool calls
  AND content NOT LIKE '{"query":%'
  AND content NOT LIKE '{"type":%'
LIMIT ?
```

### 2. ChatGPT Tool Calls Stored as Assistant Messages
**Discovery**: 505 messages like `search("QBism and Buddhism")` are stored as `role=assistant`. These were polluting results because they contain keywords similar to search queries.

**Fix**: SQL now filters out tool call patterns.

### 3. Book Lookup Failed Due to URI Format Differences
**Problem**: `book://tem-noon/xyz` ≠ `book://user/xyz` → book not found → duplicate creation.

**Fix** (`BookshelfContext.tsx:367-389`): `getBook()` now checks:
- Exact URI match
- ID match (from URI or direct)
- Path match (ignoring `user/` prefix)

### 4. Library Seed Books Not in Database
**Problem**: Library books exist in UI only, not in SQLite → harvest bucket foreign key fails.

**Fix** (`BooksView.tsx:481-504`): Auto-create book in database before harvesting.

---

## What Is Still Broken

### CRITICAL: commitBucket Uses Old Storage

`HarvestBucketService.ts:656-701`:
```typescript
commitBucket(bucketId: string): BookProject | undefined {
  // ...
  const book = bookshelfService.getBook(bucket.bookUri);  // ← OLD LOCALSTORAGE!
  // ...
  const updatedBook = bookshelfService.updateBook(...);   // ← DOESN'T PERSIST TO XANADU!
}
```

**Result**: Even if you stage and commit, passages go nowhere. The `book_passages` table remains empty.

**Fix Needed**: Update to use `window.electronAPI.xanadu.passages.upsert()`.

---

## Audit Required: Deprecated Code Paths

### Files to Audit for Old Storage Usage

| File | Issue |
|------|-------|
| `HarvestBucketService.ts` | Uses `bookshelfService` instead of Xanadu |
| `BookshelfService.ts` | Old localStorage-based service |
| `BookshelfContext.tsx` | Mixed: some Xanadu, some bookshelfService |
| `tools.ts` | AUI tools may use old patterns |

### Grep Patterns for Audit
```bash
# Find old bookshelfService usage
grep -r "bookshelfService\." apps/web/src/

# Find localStorage fallbacks
grep -r "localStorage\." apps/web/src/lib/bookshelf/

# Find missing Xanadu calls
grep -r "window.electronAPI.xanadu" apps/web/src/ | grep -v "\.d\.ts"
```

---

## Database State After Session

```sql
-- Books
SELECT id, uri, name, status FROM books;
-- heart-sutra-science | book://user/heart-sutra-science | Heart Sutra Science | harvesting
-- 1767733846537-nq5fokr1x | book://user/buddhism-and-phenomenology | Buddhism and Phenomenology | drafting
-- [plus new auto-created books from library seeds]

-- Harvest Buckets (latest)
SELECT id, status, json_array_length(approved) as approved FROM harvest_buckets ORDER BY created_at DESC LIMIT 1;
-- harvest-1767747430313-c10v | reviewing | 4

-- Book Passages
SELECT COUNT(*) FROM book_passages;
-- 0 (EMPTY - commit is broken!)
```

---

## Test Results

| Test | Result |
|------|--------|
| Create book | ✅ Works |
| Start harvest | ✅ Works |
| Semantic search | ✅ Returns substantive content |
| Approve/Gem passages | ✅ Works (in harvest bucket) |
| Stage bucket | ⚠️ Untested |
| Commit bucket | ❌ BROKEN - uses old storage |
| Passages in book | ❌ Never persisted |

---

## Recommended Next Steps

### Priority 1: Fix commitBucket for Xanadu
```typescript
// HarvestBucketService.ts - commitBucket()
// Replace bookshelfService with Xanadu IPC:

const allApproved = getAllApproved(bucket);
for (const passage of allApproved) {
  await window.electronAPI.xanadu.passages.upsert({
    id: passage.id,
    bookId: bookId,  // Need to look up from book
    text: passage.text,
    curationStatus: passage.curation?.status === 'gem' ? 'gem' : 'approved',
    // ... other fields
  });
}
```

### Priority 2: House Agent Audit
Run the audit agents to find ALL deprecated patterns:
- `architect-agent`: Pattern violations, old service usage
- `data-agent`: Schema mismatches, API contract issues

### Priority 3: E2E Book Creation Test
Once commit is fixed:
1. Create book → Harvest → Approve → Stage → Commit
2. Verify passages appear in `book_passages` table
3. Test `propose_narrative_arc` with real passages
4. Test `generate_first_draft`

---

## Commits from Session

```
76b57a0 fix(search): Filter out tool calls and short content in SQL
ec69575 fix(search): Apply role filter in SQL, not after limiting
b7b27a0 fix(harvest): Auto-create library books before harvesting
8368247 fix(harvest): Look up actual book ID for foreign key constraint
aea2d10 fix(harvest): Lower minimum word threshold from 50 to 20
1144b9a fix(harvest): Filter search to assistant messages with 50+ words
```

---

## ChromaDB Tags
`harvest-fix, xanadu-migration, deprecated-audit, commitBucket-broken, jan-2026`

---

**End of Handoff**
