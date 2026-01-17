# Book Studio API - Executive Summary

**Location**: `/Users/tem/humanizer_root/humanizer-gm/docs/BOOK_STUDIO_API_DESIGN.md`  
**Diagram**: `/Users/tem/humanizer_root/humanizer-gm/docs/BOOK_STUDIO_ARCHITECTURE.txt`  
**Date**: January 16, 2026  
**Architect**: House of Architect Agent

---

## OVERVIEW

This design moves Book Studio from a **browser-centric architecture** (all logic in React) to a **server-orchestrated architecture** (Express API on :3004 orchestrates operations across Archive, NPE-Local, and Ollama).

### Why Now?

- **Persistence**: Currently books die on app restart. Need DB-backed storage.
- **Scalability**: Same API will serve both Electron app and future web version.
- **Performance**: LLM operations block the UI. Move to background queue.
- **Event-driven UX**: Tools signal completion, UI reacts. Better UX than callbacks.

---

## ARCHITECTURE AT A GLANCE

```
Frontend (React)           Server (:3004)           External APIs
[BookStudio.tsx]  ←→  [Book Studio API]  ←→  Archive (:3002)
[WebSocket]             [Services]              NPE-Local (:3003)
                        [SQLite DB]             Ollama (:11434)
```

### Three Key Principles

1. **Frontend = View Layer**: React only handles UI state (selectedCard, viewMode)
2. **Server = Orchestration**: All business logic (outlines, grading, drafts) moves to Express
3. **Events = Communication**: Tools emit events, frontend subscribes via WebSocket

---

## WHAT MOVES TO SERVER

| System | Current Home | New Home | Why |
|--------|--------------|----------|-----|
| outline-agent.ts | Browser Worker | OutlineService | Needs persistence + background processing |
| draft-generator.ts | Browser Worker | DraftService | LLM calls take 5-30 seconds, block UI |
| harvest-review-agent.ts | Browser Component | HarvestService | SIC/Quantum API calls, background queue |
| reactive-clustering.ts | Browser State | ClusteringService | Move data model to DB |
| BookStudio state | React Context | BookService + DB | Survive app restart |

---

## API SURFACE

### Books
```
POST   /api/books                    Create book
GET    /api/books                    List all books
GET    /api/books/:id                Get book + chapters
PATCH  /api/books/:id                Update book
DELETE /api/books/:id                Delete book
GET    /api/books/current            Get current book
POST   /api/books/:id/set-current    Set as current
```

### Harvest (Card Management)
```
POST   /api/books/:id/harvest        Harvest single card
POST   /api/books/:id/harvest-batch  Harvest multiple cards
GET    /api/books/:id/cards          List cards (filter: staging|placed)
PATCH  /api/books/:id/cards/:cid     Update card notes
DELETE /api/books/:id/cards/:cid     Delete card
POST   /api/books/:id/deduplicate    Remove duplicates
POST   /api/books/:id/cluster        Get card clusters
```

### Outlines (3-Phase Process)
```
POST   /api/books/:id/chapters/:cid/research         Phase 1: Research
POST   /api/books/:id/chapters/:cid/review-outline   Phase 2: Review
POST   /api/books/:id/chapters/:cid/generate-outline Phase 3: Generate
GET    /api/books/:id/chapters/:cid/outline          Get saved outline
```

### Drafts (Streaming Generation)
```
POST   /api/books/:id/chapters/:cid/draft            Generate (WebSocket)
POST   /api/books/:id/chapters/:cid/draft-sync       Generate (blocking, testing)
POST   /api/books/:id/chapters/:cid/expand-section   Expand selected text
POST   /api/books/:id/chapters/:cid/save-draft       Save draft
```

### WebSocket Events
```
card-harvested       → Card added to staging area
card-graded          → Full grade completed (SIC + Quantum)
card-clustered       → Clustering analysis done
outline-researched   → Research phase complete
outline-reviewed     → Review phase complete
outline-generated    → Generation phase complete
draft-progress       → Streaming generation update
draft-complete       → Draft generation done
session-error        → Operation failed
```

---

## DATA FLOW: User Harvests a Card

```
Frontend: Click "Search & Harvest"
          Type query
          
↓

Backend: Archive :3002 search
         Returns: SearchResult[]
         
↓

Frontend: User clicks one result
          POST /api/books/{id}/harvest

↓

Backend: HarvestService.harvestCard()
  1. Create HarvestCard in DB (status='staging')
  2. quickGradeCard() - fast, local
     - classifyStub() [heuristic]
     - analyzeNecessity() [Chekhov local]
     Result: grade with confidence=0.5
  3. WS event: 'card-harvested'
     Include: card, quick grade
  4. Background queue: gradeCardFull()
     - POST :3003/transformations/analyze [SIC]
     - POST :3003/quantum-analysis/start [Quantum]
     - Merge grades
     - WS event: 'card-graded' with full grade

↓

Frontend: 
  - Receives 'card-harvested'
    → Add card to staging area
    → Show grade with spinner
  - Later receives 'card-graded'
    → Update grade, remove spinner
```

User sees: immediate feedback + progressive grade enhancement

---

## DATA FLOW: User Generates Outline

```
Frontend: User selects cards for chapter
          Clicks "Analyze Outline"

↓

Backend: OutlineService.researchCards()
  ├─ extractThemes()
  │  ├─ Use precomputed clusters if available
  │  ├─ Find word co-occurrences
  │  └─ Return: { name, keywords, strength, avgGrade }
  │
  ├─ detectNarrativeArcs()
  │  ├─ Group by Chekhov function (setup, payoff, etc)
  │  └─ Check temporal evolution
  │
  ├─ mapSourcesToThemes()
  │  ├─ For each card, find relevant themes
  │  └─ Mark key passages
  │
  ├─ analyzeCoverage()
  │  ├─ Identify coverage gaps
  │  └─ Find strengths
  │
  └─ suggestSections()
     ├─ Structure from narrative arc (if complete)
     └─ Or structure from themes (fallback)

↓

Frontend: Display research panel
          User can:
          - Accept suggested outline
          - Propose custom outline
          - Request different analysis

↓

Backend (if user accepts suggestions):
  OutlineService.generateOutline()
  ├─ mergeOutlines()
  │  ├─ research suggestions
  │  ├─ + proposed outline (if provided)
  │  ├─ + review findings
  │  └─ Remove duplicates
  │
  ├─ orderForNarrativeFlow()
  │  ├─ Setup functions first
  │  ├─ Middle by theme strength
  │  └─ Payoff last
  │
  └─ buildCardAssignments()
     └─ For each outline item, assign matching cards

↓

Frontend: Display final outline
          User can:
          - View coverage analysis
          - Edit outline
          - Proceed to draft generation
```

---

## DATA FLOW: User Generates Draft

```
Frontend: User clicks "Generate Draft"
          Opens WebSocket connection

↓

Backend: DraftService.generateDraftStreaming()

  Phase 1: "preparing"
    └─ WS: { phase: 'preparing' }

  Phase 2: "deduplicating"
    ├─ Call deduplicateCards()
    ├─ Remove similar content
    └─ WS: { phase: 'deduplicating', removed: 5, kept: 45 }

  Phase 3: "generating"
    ├─ orderCardsForOutline() → OrderedSection[]
    ├─ buildPrompt()
    │  ├─ Author's voice instructions
    │  ├─ Key passages marked
    │  ├─ Transition guidance
    │  └─ Word count target
    │
    ├─ POST http://localhost:3003/transformations/generate
    │  ├─ Model: llama3.2 (configurable)
    │  ├─ Stream: true
    │  └─ Body: { model, prompt, stream, options }
    │
    ├─ Pipe response to WebSocket
    │  WS events per 10 tokens:
    │  { phase: 'generating',
    │    partialContent: '...',
    │    tokensGenerated: 42 }
    │
    └─ Accumulate full text

  Phase 4: "complete"
    └─ WS: { phase: 'complete', content: '...', wordCount: 1240 }

↓

Frontend: Listen to WebSocket
  'preparing'   → Show loading spinner
  'deduplicating' → Show dedup stats
  'generating'  → Update progress bar + stream text to preview
  'complete'    → Show draft, enable "Save Draft"
```

---

## DATABASE SCHEMA

**Core tables**:

```
books
  id, title, status, created_at, metadata

chapters
  id, book_id, title, order, status, created_at

harvest_cards
  id, book_id, content, status (staging|placed|archived)
  grade (JSONB), is_outline, tags, user_notes, harvested_at

placements
  id, card_id, chapter_id, position
  (link cards to chapters)

outlines
  id, book_id, chapter_id
  research_data (JSONB: OutlineResearch)
  generated_outline (JSONB: GeneratedOutline)
  user_edits (JSONB)
  status, created_at

sessions
  id, book_id, operation (research|outline-gen|draft-gen)
  status (active|completed|failed)
  input, output (JSONB)
  progress, error, created_at
```

**Benefits**:
- Books survive app restart
- Outlines are recoverable
- Drafts can be autosaved
- Progress tracking for long operations
- Full audit trail

---

## SERVICE LAYER

### BookService
CRUD for books + chapters. Manages "current book" context.

### HarvestService
Card management:
- Create card from search result
- Grade card (quick + background)
- Deduplicate cards
- Query cards (filter by status, book, etc)

### OutlineService
Outline workflow:
- Research: extract themes, arcs, gaps
- Review: map outline to cards
- Generate: merge + order for narrative flow
- Order: build OrderedSection[] for draft generation

### DraftService
Draft generation:
- Streaming generation with progress
- Section-by-section generation
- Expansion of selected text
- Save/publish

### ClusteringService
Card clustering:
- Run k-means or similar on cards
- Suggest groupings by theme
- Visualize clustering state

---

## MIGRATION PHASES

### Phase 1: Setup (Week 1)
- Create Express server on :3004
- Create database + migrations
- Create service stubs
- All logic stays in frontend (no breaking changes)

### Phase 2: Port Services (Weeks 2-3)
- BookService: move book CRUD
- HarvestService: move card operations
- ClusteringService: move clustering
- OutlineService: move research/review/generate
- DraftService: move LLM orchestration

### Phase 3: Events (Week 4)
- Add WebSocket layer
- Emit events from long-running operations
- Frontend subscribes to WebSocket

### Phase 4: Persistence (Week 5)
- Enable session recovery
- All books live in DB
- User experience: "Open app → continue where you left off"

---

## INTEGRATION WITH EXISTING APIS

### Archive (:3002)
**Book Studio calls Archive for**:
- Unified search (harvest cards)
- Full conversation retrieval
- Message context
- Metadata discovery

### NPE-Local (:3003)
**Book Studio calls NPE-Local for**:
- SIC analysis (card grading)
- Quantum analysis (inflection detection)
- LLM draft generation (via Ollama)

### Ollama (:11434)
**Via NPE-Local**:
- Models: llama3.2, qwen3:14b, etc
- Streaming generation with temperature control
- Chat completions

---

## RESILIENCE & ERROR HANDLING

### Graceful Degradation

| Failure | Behavior |
|---------|----------|
| Ollama unavailable | Show error, allow text-only editing |
| NPE-Local SIC fails | Use default grades (3/5) |
| Archive unreachable | Can't search/harvest, show error |
| DB corrupted | Recover from backup or factory reset |

### Retry Strategy
- Transient failures: exponential backoff (1s, 2s, 4s)
- Max 3 retries
- Timeouts: 30s for most operations

### Event Delivery
- WebSocket reconnection with exponential backoff
- Session persistence: unfinished operations resume on reconnect
- Error events include full details for debugging

---

## KEY DESIGN DECISIONS

### 1. WebSocket for Progress (Not HTTP SSE)
**Why**: WebSocket supports bidirectional communication (frontend can cancel operations)

### 2. Quick Grade + Background Full Grade
**Why**: 
- Users see immediate feedback (quick grade: <10ms)
- Full analysis runs in background (SIC: 1s, Quantum: 3s)
- No UI blocking

### 3. Outline Service Doesn't Call LLM
**Why**: 
- Outline research uses heuristics (fast, reliable)
- Outline generation only uses local logic
- LLM only called during draft generation

### 4. Database Persistence from Day 1
**Why**: 
- Enables session recovery
- Prepares for web version
- No breaking changes (frontend keeps calling same APIs)

---

## ARCHITECT REVIEW NOTES

✓ No duplicate systems (outline logic already exists, just moved)  
✓ Implementation-first protocol (explored before proposing)  
✓ Proper boundaries (frontend ≠ backend)  
✓ Integration patterns explicit (Archive, NPE-Local calls clear)  
✓ Event-driven (tools signal completion)  
✓ Scalable (same API for Electron + web)  

---

## DELIVERABLES

| File | Purpose |
|------|---------|
| BOOK_STUDIO_API_DESIGN.md | Complete API specification (27 KB) |
| BOOK_STUDIO_ARCHITECTURE.txt | Visual layers + data flows |
| BOOK_STUDIO_SUMMARY.md | This document |

---

## NEXT STEPS

1. ✅ **Review architecture** (you are here)
2. **Approve topology** - Any concerns about service separation?
3. **Finalize schema** - Any additions to database?
4. **Phase 1 kickoff** - Start skeleton server
5. **Iterative porting** - One service per PR
6. **E2E testing** - Full workflow validation

---

## QUESTIONS FOR TEAM

1. **Database**: SQLite for Electron, PostgreSQL for web?
2. **Event retention**: How long to keep session history?
3. **Export format**: Save books as .json? .markdown?
4. **Backup strategy**: Auto-backup to cloud?
5. **Rate limiting**: Any throttle on API calls?

---

**APPROVED BY**: House of Architect  
**IMPLEMENTATION LEAD**: [TBD]  
**START DATE**: January 20, 2026 (proposed)

