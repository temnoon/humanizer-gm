# Handoff: P3 Fallback Audit (Jan 6, 2026)

## Status: ✅ COMPLETE

All P3 fallback audit fixes committed.

## Context

Session completed P3 audit of 36 dangerous DATA_OPERATION fallback patterns.

---

## Completed This Session

### P1.5: Dev-Mode Guards (DONE) - Previous Session
Commit: `516705d`

### P2: Detection Script (DONE) - Previous Session
Created `scripts/detect-silent-fallbacks.js` with `npm run fallback:check`

### P3.1: lib/aui/tools.ts (PARTIAL)

**Fixed 7 API response fallbacks with warning logs:**

1. `search_archive` (line ~997): `data.results || []`
2. `search_facebook` (line ~1233): `data.items || []`
3. `list_conversations` (line ~2955): `data.conversations || []`
4. `harvest_archive` (line ~3086): `data.results || []`
5. `search_images` (line ~3958): `data.results || []`
6. `find_similar_images` (line ~4281): `data.results || []`
7. `cluster_images` (line ~4470): `data.results || []`

**Pattern applied:**
```typescript
// Before
const results = data.results || [];

// After
// Validate API response (per FALLBACK POLICY: no silent fallbacks)
if (!data.results) {
  console.warn('[tool_name] API response missing results field');
}
const results = data.results || [];
```

**NOT fixed (false positives - display defaults on existing objects):**
- Line 714: `context.activeProject.chapters || []` - Optional property access, valid
- Line 4562: `arc.chapters || []` - Optional property access, valid

---

## Remaining P3 Work

### P3.2: FacebookView.tsx (6 instances) - NOT STARTED

File: `apps/web/src/components/archive/FacebookView.tsx`

Lines to fix:
- Line 198: `setPeriods(data.periods || [])` - loadPeriods
- Line 244: `let filteredItems = data.items || []` - loadFeedItems
- Line 306: `setMedia(data.items || [])` - loadMedia
- Line 309: `setMedia(prev => [...prev, ...(data.items || [])])` - loadMedia append
- Line 332: `const posts = data.contentItems || []` - loadMediaPosts
- Line 561: `mediaItems = (data.media || [])` - loadMediaByFolder

### P3.3: Remaining Components - NOT STARTED

**Studio.tsx** (3 instances):
- Line 2206: `book?.passages || []` - display default (OK)
- Line 2213: `book?.chapters || []` - display default (OK)
- Line 4609: `data.messages || []` - API response (NEEDS FIX)

**BooksView.tsx** (4 instances):
- Line 142: `bsBook.passages || []` - mapping (NEEDS REVIEW)
- Line 166: `bsBook.chapters || []` - mapping (NEEDS REVIEW)
- Line 578: `selectedProject.passages || []` - display default (OK)
- Line 819: `selectedProject.chapters || []` - display default (OK)

**ExploreView.tsx** (1 instance):
- Line 177: `setResults(data.results || [])` - API response (NEEDS FIX)

**GalleryView.tsx** (1 instance):
- Line 108: `data.images || data.media || []` - API response (NEEDS FIX)

**GutenbergView.tsx** (1 instance):
- Line 95: `setSearchResults(data.books || [])` - API response (NEEDS FIX)

**ImportView.tsx** (1 instance):
- Line 161: `data.archives || []` - API response (NEEDS FIX)

**BookProfileView.tsx** (1 instance):
- Line 51: `project.passages || []` - display default (OK)

**BookProjectDetail.tsx** (2 instances):
- Line 205: `project.passages || []` - display default (OK)
- Line 643: `project.chapters || []` - display default (OK)

**AddToBookDialog.tsx** (1 instance):
- Line 61: `selectedBook?.chapters || []` - display default (OK)

**BookshelfContext.tsx** (4 instances):
- Line 630: `book.chapters || []` - Already in DEV-guarded block (OK)
- Line 858: `book.chapters || []` - Already in DEV-guarded block (OK)
- Line 926: `book.chapters || []` - Already in DEV-guarded block (OK)
- Line 1145: `book?.passages || []` - Already in DEV-guarded block (OK)

**LocalStorageMigration.ts** (2 instances):
- Line 389: `book.passages || []` - Migration code (NEEDS REVIEW)
- Line 421: `book.chapters || []` - Migration code (NEEDS REVIEW)

---

## Pattern Classification

| Category | Pattern | Action |
|----------|---------|--------|
| API Response | `data.results \|\| []` | Add warning before fallback |
| Display Default | `project.chapters \|\| []` | OK - leave as is |
| State Setter | `setResults(data.X \|\| [])` | Add warning before fallback |
| Migration | Migration code | Review case-by-case |

---

## Files Modified (Uncommitted)

1. `apps/web/src/lib/aui/tools.ts` - 7 warning additions
2. `apps/web/src/lib/utils/api-response.ts` - NEW utility (optional use)

---

## Quick Resume Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm

# Build to verify changes
npm run build --workspace=apps/web

# Check fallback patterns
npm run fallback:check

# Git status
git status
```

---

## Key Pattern to Apply

For API response fallbacks, add warning BEFORE the fallback:

```typescript
const data = await response.json();

// Validate API response (per FALLBACK POLICY: no silent fallbacks)
if (!data.results) {
  console.warn('[component_name] API response missing results field');
}
const results = data.results || [];
```

---

## Commits Pending

```bash
git add apps/web/src/lib/aui/tools.ts apps/web/src/lib/utils/api-response.ts
git commit -m "fix(aui): Add API response validation warnings to AUI tools

Per FALLBACK POLICY: no silent fallbacks.
Added console.warn for missing fields in:
- search_archive
- search_facebook
- list_conversations
- harvest_archive
- search_images
- find_similar_images
- cluster_images"
```

---

## Todo State

```
[completed] P1.5: Dev-mode guards in BookshelfContext
[completed] P2: Detection script
[completed] P3: Audit fallbacks
  [completed] P3.1: tools.ts (7/9 done, 2 false positives)
  [completed] P3.2: FacebookView.tsx (6 instances)
  [completed] P3.3: Other components (7 files fixed)
```

---

## Final Commits

1. `516705d` - P1.5 & P2: Dev-mode guards + detection script
2. `dadc5d8` - P3: API response validation warnings (9 files, 20 warnings added)

---

## Summary

| Task | Files | Warnings Added |
|------|-------|----------------|
| P3.1: tools.ts | 1 | 7 |
| P3.2: FacebookView.tsx | 1 | 6 |
| P3.3: Other components | 7 | 7 |
| **Total** | **9** | **20** |

---

**End of Handoff**
