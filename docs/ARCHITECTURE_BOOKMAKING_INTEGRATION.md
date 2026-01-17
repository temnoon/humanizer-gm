# Bookmaking Architecture - Integration Guide

**Created:** January 17, 2026
**Purpose:** Clarify proper integration of humanizer-sandbox bookmaking tools into humanizer-gm

---

## The Problem

We discovered a mix-up in the bookmaking architecture:
- Session 3-4 added bookmaking routes (`/api/books/proposal`, `/api/books/arcs`, etc.) to **archive-server** (port 3002)
- However, the proper architecture has **book-studio-server** (port 3004) for project management
- The humanizer-sandbox tools were designed to work with book-studio-server

---

## Correct Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    humanizer-sandbox Agents                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │ Smart Harvest   │  │ Outline Agent   │  │ Draft Generator │      │
│  │ Agent           │  │                 │  │                 │      │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘      │
└───────────┼────────────────────┼────────────────────┼────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│  Archive Server   │    │ Book Studio       │    │ Ollama            │
│  (Port 3002)      │    │ Server (Port 3004)│    │ (Port 11434)      │
├───────────────────┤    ├───────────────────┤    ├───────────────────┤
│ • unifiedSearch() │    │ • Books CRUD      │    │ • /api/generate   │
│ • getMessageCtx() │    │ • Cards (harvest) │    │ • /api/tags       │
│ • embeddings      │    │ • Chapters        │    │                   │
│ • content index   │    │ • Outlines        │    │                   │
│                   │    │ • Clusters        │    │                   │
│ NO book mgmt!     │    │ • WebSocket       │    │                   │
└───────────────────┘    └───────────────────┘    └───────────────────┘
```

---

## Server Responsibilities

### Archive Server (Port 3002) - Content & Search
**Should have:**
- `/api/search` - Semantic search across archive
- `/unified-search` - Unified search endpoint
- `/api/conversations/:id` - Get conversation content
- `/api/messages/:id/context` - Get message context for breadcrumb expansion
- Embedding operations (index, query, similarity)

**Should NOT have:**
- Book project management
- Chapter CRUD
- Proposal generation
- Arc generation

### Book Studio Server (Port 3004) - Project Management
**Has (already implemented):**
- `/api/books` - Book CRUD
- `/api/chapters` - Chapter CRUD with ordering
- `/api/cards` - Harvest cards with:
  - Temporal tracking (sourceCreatedAt, harvestedAt)
  - Grading (CardGrade with SIC, Chekhov, Quantum)
  - Status lifecycle (staging → placed → archived)
  - Canvas positioning
- `/api/outlines` - Outline structures
- `/api/clusters` - Semantic card grouping
- `/api/events` - Event sourcing
- `/ws` - WebSocket for real-time updates

### NPE-Local Server (Port 3003) - Analysis
**Has:**
- AI detection
- Quantum analysis
- SIC analysis (for card grading)

---

## Data Model Comparison

### Archive Server (Legacy/Xanadu)
```
Books → Chapters → Passages
         ↓
    HarvestBuckets → Candidates
         ↓
    NarrativeArcs
```
- Uses `harvest_buckets` table with `candidates` JSON
- Passages have curation status (approved/gem/rejected)
- Designed for the original Xanadu system

### Book Studio Server (Current)
```
Books → Chapters → Cards
         ↓
    Outlines (structure_json)
         ↓
    Clusters (card_ids)
```
- Uses `cards` table with rich metadata
- Cards have status (staging/placed/archived)
- Designed for the humanizer-sandbox workflow

---

## What Happened in Sessions 3-4

We added routes to `archive-server/routes/books.ts`:
- `POST /api/books/proposal` - Generate proposal from harvest bucket
- `POST /api/books/arcs` - Generate narrative arcs
- `POST /api/books/outline` - Generate chapter outline
- `POST /api/books/:id/chapters` - Create chapters
- `GET /api/books/:id/chapters` - Get chapters

**Problem:** These use the Xanadu harvest bucket model, not the card-based model from humanizer-sandbox.

---

## Integration Path Forward

### Option A: Clean Separation (Recommended)
1. **Remove** the bookmaking routes from archive-server/routes/books.ts
2. **Keep** archive-server for search/embeddings only
3. **Enhance** book-studio-server if needed for proposal/outline generation
4. **Migrate** any useful logic (proposal generation) to book-studio-server

### Option B: Hybrid (Temporary)
1. **Keep** archive-server routes for legacy Xanadu data
2. **Prioritize** book-studio-server for new development
3. **Deprecate** archive-server book routes over time

---

## humanizer-sandbox Agent Integration

### Smart Harvest Agent
```
Calls: archive-server/unifiedSearch()
Saves: book-studio-server POST /api/cards
```

### Outline Agent
```
Reads: book-studio-server GET /api/cards
Saves: book-studio-server POST /api/outlines
```

### Draft Generator
```
Reads: book-studio-server GET /api/cards, /api/chapters
Calls: Ollama POST /api/generate
Saves: book-studio-server PATCH /api/chapters/:id
```

---

## Files to Review/Modify

### Archive Server (consider removing book routes)
```
electron/archive-server/routes/books.ts    ← Remove bookmaking routes
electron/archive-server/routes/draft.ts    ← Keep or move to book-studio
electron/services/book-proposal.ts         ← Move logic to book-studio
electron/services/draft-generator.ts       ← Move to book-studio
electron/services/chapter-filler.ts        ← Move to book-studio
```

### Book Studio Server (enhance if needed)
```
electron/book-studio-server/routes/cards.ts      ✓ Complete
electron/book-studio-server/routes/chapters.ts   ✓ Complete
electron/book-studio-server/routes/outlines.ts   ✓ Complete
electron/book-studio-server/routes/clusters.ts   ✓ Complete
```

### humanizer-sandbox (source of truth for agents)
```
src/book-studio/smart-harvest-agent.ts    ← Integrate
src/book-studio/outline-agent.ts          ← Integrate
src/book-studio/draft-generator.ts        ← Integrate
src/book-studio/api-client.ts             ← Already targets port 3004
```

---

## Next Steps

1. **Decide**: Keep hybrid or clean separation
2. **If clean**: Remove archive-server/routes/books.ts bookmaking routes
3. **Copy**: humanizer-sandbox agents to humanizer-gm
4. **Test**: Full workflow with book-studio-server
5. **Update**: Frontend to use correct endpoints

---

*This document clarifies the architectural confusion discovered on Jan 17, 2026*
