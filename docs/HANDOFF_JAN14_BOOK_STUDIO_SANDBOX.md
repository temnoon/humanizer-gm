# Handoff: Book Studio Sandbox - Jan 14, 2026

## Session Summary

**Created a complete Book Studio prototype** in a new sandbox repository. Brainstormed the vision, sketched UI mockups, then built working components implementing the core workflow.

---

## Repositories

### humanizer-gm (main codebase)
New brainstorm documents added:
- `docs/brainstorm/BOOK_STUDIO_VISION.md` - Core philosophy and design principles
- `docs/brainstorm/UI_MOCKUPS.md` - 10 ASCII wireframe screens

### humanizer-sandbox (NEW)
Location: `/Users/tem/humanizer_root/humanizer-sandbox/`

Complete React/TypeScript prototype with:
- Vite build system (port 5174)
- Proxies to humanizer-gm archive server (port 3002)

---

## Commits This Session

### humanizer-gm
| Commit | Description |
|--------|-------------|
| `ada4f65` | docs: add Book Studio vision and UI mockups |

### humanizer-sandbox
| Commit | Description |
|--------|-------------|
| `f31a8a9` | Initial Book Studio sandbox |
| `a1e824b` | fix: correct TypeScript errors |
| `7b06ac5` | feat: wire CommandPalette to live archive search |
| `b82697f` | feat: add staging area, harvest cards, and outline panel |
| `ffd310b` | feat: add WritingView with distraction-free editor |
| `05afb8d` | feat: improve WritingView with centered layout and markdown support |

---

## What Was Built

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| BookStudio | `BookStudio.tsx` | Main orchestrator with state management |
| BookHeader | `BookHeader.tsx` | View switcher, writing mode, ⌘K |
| CommandPalette | `CommandPalette.tsx` | ⌘K search with live archive queries |
| StagingArea | `StagingArea.tsx` | Grid/timeline views for harvest cards |
| HarvestCard | `HarvestCard.tsx` | Full/compact card with notes, actions |
| OutlinePanel | `OutlinePanel.tsx` | Chapter list with reorder/rename |
| WritingView | `WritingView.tsx` | Centered editor with markdown support |

### Archive Reader API
`src/archive-reader/index.ts` - Complete client for archive server:
- `unifiedSearch()` - Semantic search across all content
- `listContent()` - Filter content by type/period
- `searchImages()` - Image description search
- `checkHealth()` - Archive status check

### Type System
`src/book-studio/types.ts`:
- `Book`, `Chapter`, `HarvestCard` interfaces
- `createCardFromSearchResult()` helper

---

## User Flow Implemented

```
1. ⌘K → Search archive (semantic/text/smart modes)
2. Click result → Creates HarvestCard in staging
3. Auto-switches to Staging view
4. Grid or Timeline view of cards
5. Select card → Add notes, assign to chapter
6. ⌘O → Outline panel for chapter management
7. Select chapter → Writing view
8. Markdown editing with Write/Preview toggle
9. Mode selector in header: Flow/Assist/Full
```

---

## Design Principles Established

1. **Vision-agnostic** - No assumed book type or structure
2. **Workspace over workflow** - Ambient tools, not linear steps
3. **Accessible over visible** - Distraction-free by default
4. **Book state as anchor** - Always know what you're building
5. **Configurable presence** - User controls AI assistance level

---

## Key UI Decisions

- **Writing width**: 650px max (comfortable reading)
- **Writing mode in header**: Flow/Assist/Full selector fades with view
- **Markdown toolbar**: B, I, H1, H2, Quote + Write/Preview toggle
- **Search modes**: Text (exact), Semantic (embeddings), Smart (both)
- **Staging views**: Grid (default), Timeline, Canvas (placeholder), Clusters (placeholder)

---

## What's NOT Built Yet

| Feature | Notes |
|---------|-------|
| Canvas view | Spatial card arrangement (Kanban-style) |
| Clusters view | AI-suggested groupings |
| Book persistence | localStorage or file-based |
| Book switcher | Multiple books, one active |
| Export | PDF, EPUB, Markdown |
| AI context generation | LLM annotations on cards |

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

1. **Test with real archive data** - Run both apps, search real content
2. **Add book persistence** - localStorage first, then consider file export
3. **Implement Canvas view** - Drag-and-drop card positioning
4. **Add AI context** - Generate card annotations via LLM
5. **Port validated patterns to humanizer-gm** - Once proven in sandbox

---

## File Structure

```
humanizer-sandbox/
├── src/
│   ├── archive-reader/
│   │   └── index.ts           # Archive API client
│   ├── book-studio/
│   │   ├── types.ts           # Book, Chapter, HarvestCard
│   │   ├── BookStudio.tsx     # Main orchestrator
│   │   ├── BookStudio.css
│   │   ├── BookHeader.tsx     # Header with view/mode switchers
│   │   ├── BookHeader.css
│   │   ├── CommandPalette.tsx # ⌘K search interface
│   │   ├── CommandPalette.css
│   │   ├── StagingArea.tsx    # Card views (grid/timeline)
│   │   ├── StagingArea.css
│   │   ├── HarvestCard.tsx    # Individual card component
│   │   ├── HarvestCard.css
│   │   ├── OutlinePanel.tsx   # Chapter list
│   │   ├── OutlinePanel.css
│   │   ├── WritingView.tsx    # Markdown editor
│   │   └── WritingView.css
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css              # CSS variables
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts             # Proxy to archive server
```

---

## Key Insight from Brainstorm

> "We are creating an experience for the user that must be as enjoyable as holding a finished product."

The tool serves the creative journey, not just the output. Publication is one exit, not the only exit.

---

**Session End:** Jan 14, 2026
**Status:** Sandbox prototype COMPLETE, ready for integration testing
**Next Action:** Test with real archive data, then iterate on proven patterns
