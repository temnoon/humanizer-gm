# Handoff: Book Studio Persistence & Canvas - Jan 14, 2026

## Session Summary

**Continued the Book Studio sandbox prototype** with three major features:
1. Book persistence with localStorage
2. Multi-book management with switcher UI
3. Canvas view with drag-and-drop card arrangement
4. Find Similar functionality for semantic discovery

---

## Repositories

### humanizer-sandbox
Location: `/Users/tem/humanizer_root/humanizer-sandbox/`

All work this session was in the sandbox. No changes to humanizer-gm.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `59a7de0` | feat: add book persistence and book switcher |
| `efd87f8` | feat: add Canvas view with drag-and-drop card arrangement |
| `058219b` | feat: add Find Similar functionality for semantic discovery |

---

## What Was Built

### 1. Book Persistence (`persistence.ts`)

Complete localStorage persistence layer:

```typescript
// Key functions
loadLibrary()     // Load all books from localStorage
saveLibrary()     // Save all books
setActiveBookId() // Track which book is active
debouncedSave()   // Autosave with 1s debounce
```

Books survive page reload. Each book stores:
- Chapters with content and word counts
- Staging cards with positions and notes
- Timestamps for sorting

### 2. Book Switcher (`BookSwitcher.tsx`)

Dropdown in header for managing multiple books:
- List all books sorted by last updated
- Create new book with title prompt
- Rename book inline (click pencil icon)
- Delete book with confirmation
- Switch between books

### 3. Canvas View (`CanvasView.tsx`)

Spatial card arrangement with drag-and-drop:
- Cards remember their position (`canvasPosition` on HarvestCard)
- Drag cards to reposition
- Shift+drag to pan the canvas
- Visual feedback for selected/dragging states
- Positions persist with the book

### 4. Find Similar

Semantic discovery from any card:
- Click "Find Similar" on a card in staging
- Uses card content as semantic search query
- Adds related content as new cards
- Excludes the source card from results

---

## File Structure Update

```
humanizer-sandbox/src/book-studio/
├── BookStudio.tsx      # Main orchestrator (updated with book management)
├── BookHeader.tsx      # Header with BookSwitcher integration
├── BookSwitcher.tsx    # NEW: Multi-book dropdown
├── BookSwitcher.css
├── CanvasView.tsx      # NEW: Draggable card canvas
├── CanvasView.css
├── persistence.ts      # NEW: localStorage persistence layer
├── types.ts            # Updated: CardPosition type
├── CommandPalette.tsx
├── StagingArea.tsx     # Updated: Uses CanvasView
├── HarvestCard.tsx
├── OutlinePanel.tsx
├── WritingView.tsx
└── *.css
```

---

## Types Added

```typescript
// Card position in canvas view
interface CardPosition {
  x: number
  y: number
}

// Added to HarvestCard
canvasPosition?: CardPosition
```

---

## User Flow Update

```
1. First visit → "Welcome to Book Studio" → Create New Book
2. Book switcher in header → switch between books
3. ⌘K → Search → Harvest cards to staging
4. Staging views: Grid | Timeline | Canvas | Clusters
5. Canvas view → Drag cards to arrange spatially
6. Select card → Find Similar → Discover related content
7. All changes auto-saved to localStorage
```

---

## What's Still NOT Built

| Feature | Notes |
|---------|-------|
| Clusters view | AI-suggested groupings (placeholder) |
| File export | PDF, EPUB, Markdown |
| AI context generation | LLM annotations on cards |
| Cloud sync | Currently localStorage only |
| Undo/redo | History tracking |

---

## To Run the Sandbox

```bash
# Terminal 1: Start humanizer-gm (provides archive server)
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Terminal 2: Start sandbox
cd /Users/tem/humanizer_root/humanizer-sandbox
npm run dev

# Open http://localhost:5174
```

---

## Next Session Suggestions

1. **Test end-to-end with real archive** - Verify search and card harvesting work
2. **Add export functionality** - Markdown export first (simplest)
3. **Implement Clusters view** - Use embeddings for semantic grouping
4. **Add chapter content persistence** - Writing view content should save
5. **Consider porting to humanizer-gm** - Once patterns are validated

---

## Technical Notes

### Persistence Architecture

```
localStorage
├── book-studio-books     // JSON array of all Book objects
└── book-studio-active-book-id  // ID of currently active book
```

### Canvas Positioning

Cards without explicit positions get auto-staggered:
- 4 columns, 280px horizontal spacing
- Rows at 180px vertical spacing
- Positions saved on drag end

### Find Similar Query

Uses first 200 chars of card content as semantic query to avoid overwhelming the embedding search with long text.

---

**Session End:** Jan 14, 2026
**Status:** Persistence and canvas COMPLETE
**Next Action:** Test with real archive, then add export
