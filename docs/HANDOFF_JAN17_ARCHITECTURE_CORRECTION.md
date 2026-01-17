# Handoff: January 17, 2026 - Architecture Correction

## Summary

**Critical Issue Identified & Fixed:**
Sessions 3-4 added bookmaking routes (proposal, arcs, outline, chapters) to the wrong server (archive-server on port 3002). The correct architecture uses **book-studio-server (port 3004)** for all project management.

---

## Architecture Overview

```
CORRECT ARCHITECTURE:

┌─────────────────────────────────────────────────────────────────┐
│                 humanizer-sandbox Agents                         │
│     Smart Harvest   │   Outline Agent   │   Draft Generator     │
└─────────┬───────────────────┬───────────────────┬───────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Archive Server  │   │ Book Studio     │   │ Ollama          │
│ (Port 3002)     │   │ (Port 3004)     │   │ (Port 11434)    │
├─────────────────┤   ├─────────────────┤   ├─────────────────┤
│ • unifiedSearch │   │ • Books CRUD    │   │ • /api/generate │
│ • embeddings    │   │ • Cards (harvest)│   │ • Draft text    │
│ • content index │   │ • Chapters      │   │                 │
│                 │   │ • Outlines      │   │                 │
│ READ-ONLY books │   │ • Clusters      │   │                 │
│                 │   │ • WebSocket     │   │                 │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

---

## What Was Changed

### Removed from archive-server/routes/books.ts:
- ~~POST /api/books/proposal~~ - Generate proposal from harvest bucket
- ~~POST /api/books/arcs~~ - Generate narrative arcs
- ~~POST /api/books/outline~~ - Generate chapter outline
- ~~POST /api/books/:id/chapters~~ - Create chapters

### Kept in archive-server/routes/books.ts (READ-ONLY):
- GET /api/books - List Xanadu books
- GET /api/books/:id - Get book details
- GET /api/books/:id/harvest-buckets - View legacy harvest buckets
- GET /api/books/:id/arcs - View existing arcs
- GET /api/books/:id/chapters - View existing chapters

---

## Book Studio Server Already Has

The `electron/book-studio-server/` (port 3004) already provides:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/books` | CRUD | Book project management |
| `/api/chapters` | CRUD | Chapter organization |
| `/api/cards` | CRUD | Harvest cards with temporal tracking |
| `/api/outlines` | CRUD | Outline structures |
| `/api/clusters` | CRUD | Semantic card grouping |
| `/ws` | WebSocket | Real-time updates |

---

## Integration Path Forward

### Step 1: Use book-studio-server for new development
The server is already running on port 3004 with full CRUD for cards, chapters, outlines.

### Step 2: Copy humanizer-sandbox agents
The agents in `humanizer-sandbox/src/book-studio/` need to be integrated:
- `smart-harvest-agent.ts` - Calls archive search, saves to book-studio cards
- `outline-agent.ts` - Reads cards, generates outlines
- `draft-generator.ts` - Uses Ollama, saves to chapters

### Step 3: Wire the integration
- Archive server: Search and content retrieval
- Book studio server: Project state persistence
- Ollama: Draft generation

---

## Files Reference

### New Documentation
- `docs/ARCHITECTURE_BOOKMAKING_INTEGRATION.md` - Full architecture guide

### Modified
- `electron/archive-server/routes/books.ts` - Simplified to GET-only

### Already Working (book-studio-server)
- `electron/book-studio-server/routes/books.ts`
- `electron/book-studio-server/routes/chapters.ts`
- `electron/book-studio-server/routes/cards.ts`
- `electron/book-studio-server/routes/outlines.ts`
- `electron/book-studio-server/routes/clusters.ts`

### To Integrate (from humanizer-sandbox)
- `src/book-studio/smart-harvest-agent.ts`
- `src/book-studio/outline-agent.ts`
- `src/book-studio/draft-generator.ts`
- `src/book-studio/api-client.ts`

---

## Testing the Current State

```bash
# Archive server (search, read-only books)
curl -s http://localhost:3002/api/books | jq '.count'

# Book studio server (project management)
curl -s http://localhost:3004/api/books | jq '.books'
curl -s http://localhost:3004/api/cards?bookId=XXX | jq '.cards'
```

---

## Agents Copied (Jan 17, 2026)

humanizer-sandbox agents have been copied to humanizer-gm:

**Location:** `apps/web/src/lib/book-studio/`

**Files copied:**
- `smart-harvest-agent.ts` - Quality filtering during harvest
- `outline-agent.ts` - Multi-phase outline generation
- `draft-generator.ts` - LLM-based draft via Ollama
- `harvest-review-agent.ts` - Stub classification, grading
- `clustering.ts` - Semantic card clustering
- `chekhov-local.ts` - Narrative analysis
- `api-client.ts` - Book Studio server client
- `useBookStudioApi.ts` - React hook
- `config.ts`, `types.ts`, etc.

**Also copied:** `apps/web/src/lib/archive-reader/` for search functions

**Build status:** SUCCESS

## Next Session Priority

1. **Wire agents to UI** - Connect to existing Book Studio views
2. **Test full harvest → outline → draft workflow**
3. **Verify WebSocket real-time updates work**

---

*Handoff created: January 17, 2026*
*Architecture corrected - book-studio-server is the source of truth for project management*
