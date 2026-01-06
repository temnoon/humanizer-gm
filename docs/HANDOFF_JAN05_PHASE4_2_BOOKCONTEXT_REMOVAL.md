# Handoff: Phase 4.2 - Complete BookContext Removal

**Date**: January 5, 2026
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Ready to Start - Council Approved
**Estimated Effort**: ~4 hours total

---

## Context

Phase 4.1 added "Simple" methods to BookshelfContext that operate on `activeBookUri` automatically. The Council of Eight Houses audited and approved the consolidation pattern.

**BookContext can now be removed** once remaining call sites are migrated.

---

## Remaining Work

### Task 1: Migrate Studio.tsx (~2 hours)

**File**: `apps/web/src/Studio.tsx`

**Current usages** (4 instances):
```
Line 52:   import { BookProvider, useBook } from './lib/book';
Line 1918: const book = useBook();
Line 2201: const bookContext = useBook();
Line 2402: const bookContext = useBook();
Line 3985: const book = useBook();
```

**Migration pattern**:
```typescript
// BEFORE
import { BookProvider, useBook } from './lib/book';
const book = useBook();
book.createChapter(title, content);
book.updateChapter(chapterId, content, changes);
book.activeProject;

// AFTER
import { useBookshelf } from './lib/bookshelf';
const bookshelf = useBookshelf();
await bookshelf.createChapterSimple(title, content);
await bookshelf.updateChapterSimple(chapterId, content, changes);
bookshelf.activeBook;
```

**Method mapping**:
| BookContext | BookshelfContext |
|-------------|------------------|
| `activeProject` | `activeBook` |
| `createChapter(title, content)` | `createChapterSimple(title, content)` |
| `updateChapter(id, content, changes)` | `updateChapterSimple(id, content, changes)` |
| `deleteChapter(id)` | `deleteChapterSimple(id)` |
| `getChapter(id)` | `getChapterSimple(id)` |
| `renderBook()` | `renderActiveBook()` |
| `addPassage(passage)` | `addPassageSimple(passage)` |
| `updatePassage(id, updates)` | `updatePassageSimple(id, updates)` |
| `getPassages()` | `getPassagesSimple()` |
| `revertToVersion(chapterId, version)` | `revertToVersionSimple(chapterId, version)` |
| `updateWriterNotes(chapterId, notes)` | `updateWriterNotesSimple(chapterId, notes)` |

**Note**: Simple methods are async (return Promises). Add `await` or use `void` for fire-and-forget.

---

### Task 2: Migrate BooksView.tsx (~30 min)

**File**: `apps/web/src/components/archive/BooksView.tsx`

**Current usages** (already hybrid - uses both):
```
Line 14:  import { useBook } from '../../lib/book';
Line 15:  import { useBookshelf, type BookProject as BookshelfBookProject } from '../../lib/bookshelf';
Line 111: const book = useBook();
Line 114: const bookshelf = useBookshelf();
```

**Key usages to migrate**:
```
Line 193: const userProjects = book.projects;
Line 259: const project = book.createProject(name.trim(), subtitle?.trim());
Line 272: book.setActiveProject(project);
Line 287: book.setActiveProject(null);
Line 292: if (book.content) { ... }
Line 293: importText(book.content, book.title, { type: 'book' });
Line 409: const chapter = book.createChapter(title);
```

**Migration**:
- `book.projects` → `bookshelf.books`
- `book.createProject()` → `await bookshelf.createBook()`
- `book.setActiveProject(project)` → `bookshelf.setActiveBookUri(project?.uri ?? null)`
- `book.content` → `bookshelf.activeBook?.chapters?.[0]?.content` (or workspace state)
- `book.createChapter(title)` → `await bookshelf.createChapterSimple(title)`

---

### Task 3: Remove BookProvider (~30 min)

**Location**: `apps/web/src/Studio.tsx` (around line 4000+)

Find and remove `<BookProvider>` from the component tree:
```tsx
// BEFORE
<BookProvider>
  <BookshelfProvider>
    {/* ... */}
  </BookshelfProvider>
</BookProvider>

// AFTER
<BookshelfProvider>
  {/* ... */}
</BookshelfProvider>
```

---

### Task 4: Delete BookContext Files (~1 hour)

**Files to delete**:
```
apps/web/src/lib/book/BookContext.tsx
apps/web/src/lib/book/BookProjectService.ts
```

**Update exports** in `apps/web/src/lib/book/index.ts`:
- Remove BookContext, BookProvider, useBook, useBookOptional exports
- Keep any other utilities if present

**Search for any remaining imports**:
```bash
grep -r "from.*lib/book" apps/web/src/
grep -r "useBook" apps/web/src/
grep -r "BookProvider" apps/web/src/
grep -r "BookContext" apps/web/src/
```

---

## Verification Steps

After migration:

1. **Build check**:
   ```bash
   cd /Users/tem/humanizer_root/humanizer-gm/apps/web
   npx vite build
   ```

2. **Runtime test in Electron**:
   ```bash
   npm run electron:dev
   ```
   - Create a new book
   - Add a chapter
   - Edit chapter content
   - Save and verify persistence across restart

3. **Runtime test in browser** (fallback mode):
   ```bash
   npm run dev
   ```
   - Same tests, verify localStorage fallback works

---

## Files Reference

**Already migrated** (use as examples):
- `apps/web/src/components/workspace/BookContentView.tsx` - Uses useBookshelf exclusively
- `apps/web/src/lib/aui/AUIContext.tsx` - Hybrid interface pattern

**Core implementation**:
- `apps/web/src/lib/bookshelf/BookshelfContext.tsx` - All Simple methods (lines 853-945, 1184-1241)

**Types**:
- `apps/web/src/lib/bookshelf/types.ts` - Re-exports from @humanizer/core

---

## Council Notes

From the audit (Jan 5, 2026):

**Approved patterns**:
- Dual-interface strategy (URI-based + Simple methods)
- isXanaduAvailable() for storage detection
- Async Simple methods with void for fire-and-forget

**Advisory (non-blocking)**:
- "Simple" naming could be more descriptive - accept for now
- Type assertions for Xanadu IPC - acceptable, future TODO

---

## Commands to Start

```bash
cd /Users/tem/humanizer_root/humanizer-gm

# Check current state
git status

# Start development
npm run electron:dev

# In another terminal, follow along
grep -n "useBook" apps/web/src/Studio.tsx
```

---

## After Completion

Update `docs/HANDOFF_JAN05_XANADU_CONSOLIDATION.md`:
- Mark Phase 4.2 complete
- Document any issues encountered
- Update "What's Next" to Phase 4.3 (Content-Type Chunking)

---

**End of Handoff**
