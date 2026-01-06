# Handoff: House Council Fixes (Jan 6, 2026)

## Session Summary

Addressed issues identified by Codex agent review and convened House Council to establish architectural policies.

---

## Completed (P0)

### 1. Pyramid Chunk Overwrites (FIXED)

**File**: `electron/archive-server/services/embeddings/ArchiveIndexer.ts:315`

**Problem**: When content-aware chunking processed multiple messages in the same conversation, `chunkIndex` reset to `i` (0,1,2...) for each message. With `UNIQUE(thread_id, chunk_index)` constraint, later messages overwrote earlier chunks.

**Fix**: Changed `chunkIndex: i` → `chunkIndex: currentTotal + i` to use conversation-wide running count.

**Commit**: `1755866` (part of P1/P2 commit)

### 2. bookType Persistence (FIXED)

**Files**:
- `EmbeddingDatabase.ts` - Added `book_type` column, `bookType` in upsert/parse
- `preload.ts` - Added `bookType` to XanaduBook interface
- `apps/web/src/types/electron.ts` - Added `bookType` to web app's interface
- `BookshelfContext.tsx` - Added `bookType` to createBook/updateBook payloads

**Problem**: Paper vs multi-chapter book distinction lost on save/reload.

**Fix**: Thread `bookType` through all layers from UI to SQLite.

**Commit**: `1755866`

### 3. AUIContext Type Errors (FIXED)

**Files**:
- `AUIContext.tsx` - Removed deprecated BookContext shim
- `context-builder.ts` - Fixed DraftChapter placeholder metadata
- `tools.ts` - Kept interface synchronous (tools expect sync returns)
- `Studio.tsx` - Fixed metadata and imports

**Problem**:
- `useBookOptional` was deprecated (just re-exporting `useBookshelf`)
- Shim tried to bridge non-existent properties
- DraftChapter placeholders missing required fields

**Fix**:
- Removed deprecated import, simplified to use `bookshelf` directly
- Added complete metadata to all DraftChapter placeholders
- Made `createProject` return sync placeholder (async creation happens fire-and-forget)

**Commit**: `ddc2b38`

### 4. FALLBACK POLICY Established

Added to `TECHNICAL_DEBT.md`:
- Formal policy banning silent production fallbacks
- Development-only fallbacks allowed with explicit guards
- Production readiness checklist with progress tracking
- User's quote about trust in open source

**Commit**: `d3ba690`

---

## Remaining (P1-P3)

### P1: Complete Xanadu Migration (1-2 days estimated)

**Status**: Architecture analyzed, implementation pending.

**Current State**:
- `BookshelfContext` uses Xanadu when available, falls back to localStorage
- `HarvestBucketService` uses localStorage only (no Xanadu integration)
- `persona-store.ts` uses localStorage only (no Xanadu integration)

**Files Using localStorage for Book Data**:

| Service | Storage Keys | Priority |
|---------|-------------|----------|
| `BookshelfService.ts` | `humanizer-bookshelf-{personas,styles,books,index}` | High |
| `HarvestBucketService.ts` | `humanizer-harvest-{buckets,arcs,links}` | High |
| `persona-store.ts` | `humanizer-curator-persona` | Medium |

**Migration Infrastructure Exists**:
- `LocalStorageMigration.ts` has `migrateToUnifiedStorage()` ready
- Xanadu API defined in `preload.ts` with SQLite backing
- Migration marker: `'xanadu-migration-complete'`

**Required Changes**:
1. Add dev-mode guards to all localStorage fallbacks in `BookshelfContext`
2. Integrate `HarvestBucketService` with Xanadu API
3. Consider `CuratorPersona` migration (or keep in localStorage as user preference)
4. Ensure migration runs on app startup
5. Fail loudly in production if Xanadu unavailable

### P2: Add ESLint Rule (1 hour estimated)

Create ESLint rule to warn on `|| []` and `|| {}` patterns in data operations.

**Proposed Rule**:
```javascript
// eslint-plugin-local/rules/no-silent-fallback.js
// Warn on: data || [], result.items || [], etc.
// Allow: nickname || 'Unknown' (display defaults)
```

### P3: Audit All Fallbacks (4-6 hours estimated)

**Scope**: 97 instances of `|| []` / `|| {}` found across 29 files.

**Classification needed**:
- Display (OK): `person.nickname || 'Unknown'`
- Data operation (NEEDS FIX): `response.data || []`
- Development only (NEEDS ENV CHECK): `storage || localStorageShim`

---

## Commits This Session

```
d3ba690 docs: Add FALLBACK POLICY to TECHNICAL_DEBT.md
ddc2b38 fix(aui): Fix AUIContext type errors - remove deprecated BookContext shim (P0)
1755866 fix(data): Fix pyramid chunk overwrites and persist bookType (P1, P2)
```

---

## Quick Resume Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# To verify build passes
npm run build --workspace=apps/web

# To test book making
# 1. Create new book in Books tab
# 2. Run harvest on Heart Sutra Science conversations
# 3. Verify passages save with actual content (not placeholders)
```

---

## House Council Ruling

**Established**: January 6, 2026

**FAIL LOUD Principle**: User-visible operations must never fail silently.

**Production Fallbacks**: FORBIDDEN
**Development Fallbacks**: ALLOWED with explicit `import.meta.env.DEV` guard

**Rationale** (user's words):
> "The user cannot be fooled. This will be released as open source, so any LLM 'tricks' where results that 'seem' to work will doom the perception of the software by eroding trust."

---

**End of Handoff**
