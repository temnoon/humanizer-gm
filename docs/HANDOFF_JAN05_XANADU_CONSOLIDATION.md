# Handoff: Xanadu Unified Storage Consolidation

**Date**: January 5, 2026
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Phase 3 Complete - Migration Service + Frontend Integration

---

## Summary

Implemented the first phase of the "Xanadu" unified storage architecture, consolidating book/persona/style storage from fragmented localStorage into the central EmbeddingDatabase (sqlite-vec).

---

## What Was Done

### 1. Research (Stored in ChromaDB)

- **Math Embedding Strategies**: Researched how to properly embed LaTeX/mathematical content
  - Key finding: Context is critical - prose surrounding equations provides semantic grounding
  - Specialized models exist (Tangent-CFT, BERT-based) but contextual prose embeddings work well enough
  - Content-type aware chunking needed to prevent mixed code/math/prose confounding embeddings

- **RAG Chunking Best Practices**: 400-512 tokens with 10-20% overlap optimal
  - Code/math need special handling (never split mid-function)
  - Recursive character splitting preserves natural boundaries

### 2. Schema Migration (v9 → v10)

Added 6 new tables to `EmbeddingDatabase.ts`:

| Table | Purpose |
|-------|---------|
| `books` | Replaces BookProjectService + BookshelfService book storage |
| `personas` | Writing personas with voice/vocabulary/system prompts |
| `styles` | Writing styles with characteristics/structure |
| `book_passages` | Harvested content with curation status |
| `book_chapters` | Chapter content with version tracking |
| `chapter_versions` | Version history snapshots |

Added columns to `pyramid_chunks` for content-type aware chunking:
- `content_type` (prose/math/code/mixed)
- `language` (latex/python/etc.)
- `context_before`, `context_after`
- `linked_chunk_ids`

Added vec0 virtual tables:
- `vec_personas`
- `vec_styles`
- `vec_book_passages`

### 3. CRUD Operations

Added ~600 lines of CRUD methods:
- `upsertBook()`, `getBook()`, `getAllBooks()`, `deleteBook()`
- `upsertPersona()`, `getPersona()`, `getAllPersonas()`, `deletePersona()`
- `upsertStyle()`, `getStyle()`, `getAllStyles()`, `deleteStyle()`
- `upsertBookPassage()`, `getBookPassages()`, `updatePassageCuration()`, `deleteBookPassage()`
- `upsertBookChapter()`, `getBookChapters()`, `getBookChapter()`, `deleteBookChapter()`
- `saveChapterVersion()`, `getChapterVersions()`

---

## Files Modified

| File | Changes |
|------|---------|
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Schema v10, 6 tables, vec0 tables, ~600 lines CRUD |

---

## Phase 2: IPC Handlers + Library Seed (Complete)

### IPC Handlers Added

Added ~200 lines of IPC handlers in `electron/main.ts`:

| Channel | Operations |
|---------|------------|
| `xanadu:book:*` | list, get, upsert, delete |
| `xanadu:persona:*` | list, get, upsert, delete |
| `xanadu:style:*` | list, get, upsert, delete |
| `xanadu:passage:*` | list, upsert, curate, delete |
| `xanadu:chapter:*` | list, get, upsert, delete |
| `xanadu:version:*` | list, save |
| `xanadu:seed-library` | Seed built-in library data |

### Preload API Added

Added `XanaduAPI` interface in `electron/preload.ts`:

```typescript
// Usage from renderer:
const books = await window.electronAPI.xanadu.books.list();
const persona = await window.electronAPI.xanadu.personas.get('persona://tem-noon/marginalia-voice');
await window.electronAPI.xanadu.seedLibrary();
```

### Library Seed Data

Created `electron/xanadu/library-seed.ts` with:
- 2 personas (Marginalia Voice, Intergalactic Guide)
- 2 styles (Phenomenological Weave, Notebook Raw)
- 3 books (Three Threads, Marginalia Notebook, Intergalactic Phenomenology)

Seeding is automatic via `xanadu:seed-library` IPC call.

---

## Phase 3: Migration Service + Frontend Integration (Complete)

### Migration Service

Created `apps/web/src/lib/migration/LocalStorageMigration.ts`:

```typescript
// Auto-migrates on first load in Electron
import { migrateToUnifiedStorage, isMigrationComplete } from '../migration';

// Usage in BookshelfContext:
if (!isMigrationComplete() && hasDataToMigrate()) {
  await migrateToUnifiedStorage();
}
```

**Migration handles:**
- Personas from `humanizer-bookshelf-personas`
- Styles from `humanizer-bookshelf-styles`
- Books from `humanizer-bookshelf-books` and `humanizer-book-project-*`
- Chapters and passages nested in books
- Version history for chapters
- Skips library items (already seeded)

### BookshelfContext Updated

All CRUD operations now use Xanadu IPC when running in Electron:

```typescript
// Hybrid storage detection
function isXanaduAvailable(): boolean {
  return window.isElectron === true &&
         window.electronAPI?.xanadu !== undefined;
}

// All methods are now async
const createBook = useCallback(async (book) => {
  if (isXanaduAvailable()) {
    await window.electronAPI!.xanadu.books.upsert({...});
  } else {
    bookshelfService.createBook(book); // fallback
  }
}, []);
```

**Updated methods:**
- `createPersona()` → async
- `createStyle()` → async
- `createBook()`, `updateBook()`, `deleteBook()` → async
- `addChapter()`, `updateChapter()` → async
- `saveDraftVersion()` → async
- `addPassageToBook()`, `updatePassageStatus()` → async

### Type Definitions

Added `apps/web/src/types/electron.ts`:
- XanaduAPI interface
- XanaduBook, XanaduPersona, XanaduStyle types
- CurationStatus, BookStatus, ChapterStatus types
- Global Window augmentation for window.electronAPI

### Call Sites Updated

Fixed async usage in:
- `AddToBookDialog.tsx` - await createBook()
- `Studio.tsx` - await createPersona(), await saveDraftVersion()
- `context-builder.ts` - Union return types for sync/async compat

---

## Files Modified (Phase 3)

| File | Changes |
|------|---------|
| `apps/web/src/lib/migration/LocalStorageMigration.ts` | NEW: ~450 lines migration logic |
| `apps/web/src/lib/migration/index.ts` | NEW: Module exports |
| `apps/web/src/types/electron.ts` | NEW: ~160 lines type definitions |
| `apps/web/src/lib/bookshelf/BookshelfContext.tsx` | ~300 lines: Hybrid storage, async ops |
| `apps/web/src/lib/aui/context-builder.ts` | Updated types for async compat |
| `apps/web/src/components/dialogs/AddToBookDialog.tsx` | Async createBook |
| `apps/web/src/Studio.tsx` | Async method calls |
| `apps/web/src/lib/queue/useQueue.ts` | Fixed Window type conflict |

---

## Phase 4.1: BookContext Consolidation (Complete)

### Problem Identified

After Phase 3, there was a data consistency issue:
- **BookshelfContext** (migrated) → Uses Xanadu IPC in Electron
- **BookContext** → Still uses BookProjectService → localStorage directly

Both contexts managed `BookProject` data from different sources - a split-brain situation.

### Solution: Consolidate into BookshelfContext

Added "Simple" methods to BookshelfContext that operate on `activeBookUri` automatically:

**Chapter Operations:**
- `createChapterSimple(title, content?)` → Creates chapter in activeBook
- `updateChapterSimple(chapterId, content, changes?)` → Updates via saveDraftVersion
- `deleteChapterSimple(chapterId)` → Deletes from activeBook
- `getChapterSimple(chapterId)` → Gets from activeBook
- `revertToVersionSimple(chapterId, version)` → Reverts to previous version
- `updateWriterNotesSimple(chapterId, notes)` → Updates writer notes
- `renderActiveBook()` → Compiles to markdown

**Passage Operations:**
- `addPassageSimple(passage)` → Adds passage to activeBook
- `updatePassageSimple(passageId, updates)` → Updates passage
- `getPassagesSimple()` → Gets passages from activeBook

**Also Added (URI-based):**
- `deleteChapter(bookUri, chapterId)`
- `getChapter(bookUri, chapterId)`
- `renderBook(bookUri)`
- `revertToVersion(bookUri, chapterId, version)`
- `getChapterVersions(bookUri, chapterId)`
- `updateWriterNotes(bookUri, chapterId, notes)`
- `deletePassage(bookUri, passageId)`

### Updated Call Sites

| File | Changes |
|------|---------|
| `apps/web/src/lib/aui/context-builder.ts` | Updated to prefer bookshelf simple methods |
| `apps/web/src/lib/aui/AUIContext.tsx` | Added useBookshelf, builds book interface from simple methods |
| `apps/web/src/components/workspace/BookContentView.tsx` | Switched from useBook to useBookshelf |

### Files Modified (Phase 4.1)

| File | Changes |
|------|---------|
| `apps/web/src/lib/bookshelf/BookshelfContext.tsx` | +300 lines: Simple methods, URI-based ops, renderBook |
| `apps/web/src/lib/aui/context-builder.ts` | Updated interface, prefers bookshelf methods |
| `apps/web/src/lib/aui/AUIContext.tsx` | Added useBookshelf, hybrid book interface |
| `apps/web/src/components/workspace/BookContentView.tsx` | Migrated to useBookshelf |

---

## What's Next (Phase 4.2+)

### Remove BookContext Entirely

Now that BookshelfContext has all the operations, BookContext and BookProjectService
can be deprecated and eventually removed:

1. Update remaining call sites (BooksView.tsx still uses hybrid)
2. Remove `useBook` / `useBookOptional` hooks
3. Delete `lib/book/BookContext.tsx` and `lib/book/BookProjectService.ts`

### Content-Type Aware Chunking

Implement LLM-mediated content segmentation:

```typescript
// electron/archive-server/services/embeddings/ContentSegmenter.ts
export async function segmentByContentType(text: string): Promise<ContentSegment[]> {
  // Use LLM to identify content-type boundaries
  // Return segments with type: 'prose' | 'math' | 'code' | 'mixed'
}
```

### Full E2E Testing

1. Start fresh (delete .embeddings.db)
2. Verify library seeding works
3. Create new book via UI
4. Verify persistence across app restart
5. Test migration from localStorage (if existing data)

---

## Files Modified (Phase 2)

| File | Changes |
|------|---------|
| `electron/main.ts` | +200 lines: Xanadu IPC handlers, seed-library |
| `electron/preload.ts` | +170 lines: XanaduAPI types + implementation |
| `electron/archive-server/index.ts` | Export getEmbeddingDatabase |
| `electron/xanadu/library-seed.ts` | NEW: Library seed data |

---

## Testing

To verify migration works:

```bash
# Start the app - migration runs automatically on schema version bump
npm run electron:dev

# Check database has new tables
sqlite3 /path/to/archive/.embeddings.db ".tables"
# Should show: books, personas, styles, book_passages, book_chapters, chapter_versions

# Verify schema version
sqlite3 /path/to/archive/.embeddings.db "SELECT version FROM schema_version"
# Should return: 10
```

---

## Architecture Vision (Xanadu)

```
┌───────────────────────────────────────────────────────────────────┐
│                    UNIFIED EMBEDDING DATABASE                      │
│                      (.embeddings.db sqlite-vec)                   │
├───────────────────────────────────────────────────────────────────┤
│  CONTENT:                                                         │
│  ├── content_items    → All messages (ChatGPT, FB, files)         │
│  ├── pyramid_chunks   → With content_type for smart retrieval     │
│  └── media_items      → Content-addressed media                   │
│                                                                   │
│  BOOKS:                                                           │
│  ├── books            → Project metadata, refs to personas/styles │
│  ├── book_passages    → Harvested content with curation           │
│  └── book_chapters    → Draft content with version history        │
│                                                                   │
│  ENTITIES:                                                        │
│  ├── personas         → Voice definitions for writing             │
│  └── styles           → Style definitions for writing             │
│                                                                   │
│  VECTORS:                                                         │
│  ├── vec_*            → All embeddings (768-dim nomic-embed-text) │
│  └── links            → Xanadu-style bidirectional references     │
└───────────────────────────────────────────────────────────────────┘
```

---

## ChromaDB Reference

Full research stored in ChromaDB with tags:
```
xanadu, architecture, embeddings, math-embeddings, latex, chunking,
content-type, rag, book-building, consolidation, sqlite-vec, research,
jan-2026, phase-planning, schema-design
```

Query: `mcp__chromadb-memory__retrieve_memory "Xanadu unified book storage consolidation"`

---

## Scholar's Workflow (Design Principle)

The architecture mirrors how a scholar writes a book:

| Phase | Scholar | System |
|-------|---------|--------|
| Gather | Collect books, papers | Archive parsers (ChatGPT, FB, PDF) |
| Read & Note | Make note cards | Smart chunking with content-type |
| Remember | Form associations | Embeddings in latent space |
| Look up | Rifle through notes | Vector search (harvest) |
| Draft Zero | Arrange notes | Candidate assembly |
| Read Together | Feel the flow | Re-chunk draft |
| First Draft | Write with arc | Book output |

This workflow guides all design decisions.
