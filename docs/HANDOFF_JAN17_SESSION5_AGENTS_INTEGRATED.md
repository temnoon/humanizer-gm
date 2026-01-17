# Handoff: January 17, 2026 (Session 5) - Agents Integrated

## Session Summary

Two major accomplishments:
1. **Architecture Correction** - Removed incorrect bookmaking POST routes from archive-server
2. **Agent Integration** - Copied all humanizer-sandbox bookmaking agents to humanizer-gm

---

## Architecture Clarified

### Correct Server Responsibilities

| Server | Port | Responsibility |
|--------|------|----------------|
| Archive Server | 3002 | Search, embeddings, content index (READ-ONLY for books) |
| Book Studio Server | 3004 | Project management: cards, chapters, outlines, clusters |
| NPE-Local | 3003 | AI detection, analysis |
| Ollama | 11434 | LLM inference for draft generation |

### What Was Fixed
- Removed POST routes from `archive-server/routes/books.ts` (proposal, arcs, outline, chapters)
- Kept GET routes for reading legacy Xanadu book data
- See: `docs/ARCHITECTURE_BOOKMAKING_INTEGRATION.md`

---

## Agents Integrated

### Location: `apps/web/src/lib/book-studio/`

| Agent/Service | File | Purpose |
|---------------|------|---------|
| Smart Harvest | `smart-harvest-agent.ts` | Quality filtering during harvest |
| Outline Agent | `outline-agent.ts` | Multi-phase outline generation (45KB) |
| Draft Generator | `draft-generator.ts` | LLM drafts via Ollama (26KB) |
| Review Agent | `harvest-review-agent.ts` | Stub classification, grading |
| Clustering | `clustering.ts`, `reactive-clustering.ts` | Semantic card grouping |
| Chekhov Local | `chekhov-local.ts` | Narrative necessity analysis |
| Outline Detector | `outline-detector.ts` | Detect outline structures |
| API Client | `api-client.ts` | Book Studio server REST + WebSocket |
| React Hook | `useBookStudioApi.ts` | Hook for components |
| Config | `config.ts` | Configuration system |
| Types | `types.ts` | TypeScript definitions |

### Also Added: `apps/web/src/lib/archive-reader/`
- `index.ts` - Read-only archive access (unifiedSearch, getMessageContext, etc.)

### Module Entry Point
```typescript
import {
  smartHarvest,
  OutlineAgent,
  generateDraft,
  useBookStudioApi,
  apiClient,
} from '@/lib/book-studio'
```

---

## Build Status

✅ **SUCCESS** - `npm run build` completed without errors

---

## API Endpoints Reference

### Book Studio Server (Port 3004) - For Project Management
```
GET/POST/PATCH/DELETE /api/books
GET/POST/PATCH/DELETE /api/chapters
GET/POST/PATCH/DELETE /api/cards
GET/POST/DELETE /api/outlines
GET/POST/PATCH/DELETE /api/clusters
WS /ws (real-time events)
```

### Archive Server (Port 3002) - For Search Only
```
POST /api/embeddings/search/unified
GET /api/conversations/:id
GET /api/conversations
```

### Ollama (Port 11434) - For Draft Generation
```
POST /api/generate (streaming)
GET /api/tags (list models)
```

---

## Data Flow

```
User searches archive
        ↓
Smart Harvest Agent → filters quality → creates HarvestCards
        ↓
POST /api/cards → Book Studio Server → SQLite
        ↓
Outline Agent → analyzes cards → generates OutlineStructure
        ↓
POST /api/outlines → saved
        ↓
Draft Generator → Ollama /api/generate → chapter content
        ↓
PATCH /api/chapters → content saved
```

---

## Key Files Modified This Session

```
# Architecture docs
docs/ARCHITECTURE_BOOKMAKING_INTEGRATION.md (NEW)
docs/HANDOFF_JAN17_ARCHITECTURE_CORRECTION.md (NEW)

# Archive server cleanup
electron/archive-server/routes/books.ts (simplified to GET-only)

# Agent integration (NEW)
apps/web/src/lib/book-studio/*.ts (17 files)
apps/web/src/lib/archive-reader/index.ts
```

---

## Next Session TODO

1. **Wire agents to UI**
   - Connect smart-harvest-agent to search results
   - Add harvest button that uses the agent
   - Show graded cards with CardGrade display

2. **Test full workflow**
   - Harvest cards via smart agent
   - Generate outline from cards
   - Generate draft from outline

3. **Verify real-time updates**
   - WebSocket connection to book-studio-server
   - Card/chapter updates broadcast properly

---

## Quick Start Commands

```bash
# Start app
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test Book Studio Server
curl -s http://localhost:3004/api/books | jq '.books'
curl -s http://localhost:3004/api/cards?bookId=XXX | jq '.cards'

# Test Archive Server (read-only books)
curl -s http://localhost:3002/api/books | jq '.count'
```

---

## Key IDs (from earlier sessions)

| Resource | ID |
|----------|---|
| Visual Art book | `visual-art-mandala` |
| Visual Art harvest bucket | `dea7985a-c072-4156-b45f-a5535677a092` |
| Journal bucket | `546e1697-65f2-46f7-9188-90d139bc59a1` |

---

*Handoff created: January 17, 2026*
*Build: SUCCESS*
*Agents: INTEGRATED*
