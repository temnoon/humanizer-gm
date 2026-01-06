# Handoff: Xanadu Migration & Technical Debt (Jan 6, 2026)

## Context

Session continued from previous handoff. Completed P1-P2 work for FALLBACK POLICY enforcement.

---

## Completed This Session

### P1 Infrastructure (DONE)

**Commit**: `fcc89b3` - feat(xanadu): Add harvest_buckets, narrative_arcs tables

1. **Schema Changes** (`EmbeddingDatabase.ts`):
   - SCHEMA_VERSION 10 → 11
   - Added `harvest_buckets` table with all HarvestBucket fields
   - Added `narrative_arcs` table with thesis, arcType, evaluation
   - Added `passage_links` table for chapter-passage connections
   - Added migration from v10 to v11
   - Added 12 new database methods

2. **Xanadu API** (`preload.ts`, `apps/web/src/types/electron.ts`):
   - XanaduHarvestBucket, XanaduNarrativeArc, XanaduPassageLink types
   - harvestBuckets.list/get/upsert/delete
   - narrativeArcs.list/get/upsert/delete
   - passageLinks.listByChapter/listByPassage/upsert/delete

3. **IPC Handlers** (`main.ts`):
   - All 12 handlers for harvest buckets, narrative arcs, passage links

4. **HarvestBucketService** (partially updated):
   - isXanaduHarvestAvailable() check
   - initialize() uses Xanadu when available
   - saveBucketToXanadu() for async persistence
   - saveToStorage() with dual-write pattern

---

### P1.5: Dev-Mode Guards (DONE)

**Pattern applied to 30+ instances in BookshelfContext.tsx:**

```typescript
// BEFORE
if (isXanaduAvailable()) {
  await window.electronAPI!.xanadu.books.upsert({...});
} else {
  bookshelfService.createBook(book); // BAD - silent fallback
}

// AFTER
if (isXanaduAvailable()) {
  await window.electronAPI!.xanadu.books.upsert({...});
} else if (import.meta.env.DEV) {
  console.warn('[DEV] Using localStorage fallback for createBook');
  bookshelfService.createBook(book);
} else {
  throw new Error('Xanadu storage unavailable. Run in Electron app.');
}
```

**Functions updated:**
- loadAll
- getPersona, createPersona
- getStyle, createStyle
- getBook, getResolvedBook, createBook, updateBook, deleteBook
- addChapter, updateChapter, deleteChapter, getChapter
- saveDraftVersion, revertToVersion, getChapterVersions
- updateWriterNotes, renderBook
- createChapterSimple
- activeBook, activePersona (derived state)
- findByTag, findByAuthor
- getPassages, addPassageToBook, updatePassageStatus, deletePassage

---

### P2: Silent Fallback Detection (DONE - Alternative Approach)

**Note**: ESLint is not set up in this project. Created a detection script instead.

**Created**: `scripts/detect-silent-fallbacks.js`

```bash
# Run detection
npm run fallback:check
```

**Output categories:**
- `DATA_OPERATION` (36 found): Dangerous - operations on API/storage responses
- `NEEDS_REVIEW` (56 found): Ambiguous - needs human review

**Total instances detected: 92**

---

## Remaining Tasks

### P3: Audit All 92 Fallback Instances (4-6 hours)

**Goal**: Classify and fix all `|| []` and `|| {}` patterns.

**Run**: `npm run fallback:check`

**Current breakdown:**
- DATA_OPERATION (dangerous): 36
- NEEDS_REVIEW: 56

**Critical paths to audit first:**
- `apps/web/src/lib/aui/tools.ts` (12 dangerous instances)
- `apps/web/src/components/archive/FacebookView.tsx` (6 dangerous instances)
- `apps/web/src/components/archive/BooksView.tsx` (4 dangerous instances)

**Classification needed:**

| Category | Example | Action |
|----------|---------|--------|
| Display default | `person.nickname \|\| 'Unknown'` | OK - leave as is |
| Data operation | `response.data \|\| []` | FIX - explicit error handling |
| Dev fallback | `storage \|\| localStorageShim` | FIX - add `import.meta.env.DEV` guard |

---

## Quick Resume Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Check fallback patterns
npm run fallback:check

# Check current localStorage keys in browser console:
Object.keys(localStorage).filter(k => k.startsWith('humanizer-'))

# Clear localStorage for testing:
['humanizer-harvest-buckets','humanizer-bookshelf-books','humanizer-bookshelf-personas','humanizer-bookshelf-styles'].forEach(k => localStorage.removeItem(k))
```

---

## Commits This Session

```
(pending commit)
```

**Previous session commits**:
```
fcc89b3 feat(xanadu): Add harvest_buckets, narrative_arcs tables for HarvestBucketService migration
509349b docs: Add handoff for book making crisis - data layer fragmentation
2a00f23 fix(harvest): Eliminate silent fallbacks that corrupt book data (DEBT-001, DEBT-002, DEBT-003)
```

---

## Key Files Reference

| Purpose | File |
|---------|------|
| Xanadu API definition | `electron/preload.ts` (lines 134-176) |
| SQLite schema | `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` |
| Migration logic | `apps/web/src/lib/migration/LocalStorageMigration.ts` |
| BookshelfContext | `apps/web/src/lib/bookshelf/BookshelfContext.tsx` |
| HarvestBucketService | `apps/web/src/lib/bookshelf/HarvestBucketService.ts` |
| Fallback detection | `scripts/detect-silent-fallbacks.js` |
| FALLBACK POLICY | `TECHNICAL_DEBT.md` (lines 6-52) |

---

## FALLBACK POLICY Reminder

**Production Fallbacks: FORBIDDEN**
- Silent API fallbacks
- Default empty collections without state
- Storage backend fallbacks

**Development Fallbacks: ALLOWED with guard**
```typescript
if (import.meta.env.DEV) {
  console.warn('[DEV] Using fallback...');
  return fallbackImpl();
}
throw new Error('Production requires X');
```

---

## Best Practice: End of Context Protocol

**Always store a ChromaDB memory summary before compacting context.**

```typescript
// Use mcp__chromadb-memory__store_memory with:
// - Comprehensive session summary
// - Tags: "handoff,session-summary,<date>,<topic>"
// - Type: "session-handoff"
```

This preserves session context for future retrieval and maintains continuity across conversations.

---

**End of Handoff**
