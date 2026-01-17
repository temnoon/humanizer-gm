# Book Studio API Architecture Design

**Date**: January 16, 2026  
**Status**: Architectural Proposal  
**Objective**: Move from browser-heavy to server-orchestrated book operations  

---

## EXECUTIVE SUMMARY

Current state: Business logic (outline research, clustering, draft generation) runs in React components using browser workers.

Desired state: Dedicated Book Studio API server (:3004) orchestrates these operations, calling existing APIs (NPE-Local, Archive) as needed, while the frontend becomes a reactive view layer.

**Key benefits**:
- Persistence across sessions (books survive app restarts)
- Reusable operations (outline generation via API, not UI)
- Scalable to web version (same API serves both Electron and web)
- Event-driven UI (frontend listens, doesn't poll)
- Safer LLM operations (rate limiting, retry logic at server)

---

## SERVICE TOPOLOGY

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (React + Electron)                                     │
│  ├─ BookStudio.tsx (view layer)                                │
│  ├─ BookContext (UI state only: selectedCard, view mode, etc)  │
│  └─ WebSocket listener (tool events, progress)                │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   :3004 Port       :3002 Port    :3003 Port
   ┌─────────┐      ┌──────────┐  ┌────────────┐
   │ Book    │      │ Archive  │  │ NPE-Local  │
   │ Studio  │──────│ (Embedx) │  │ (AI Tools) │
   │ API     │      │ :3002    │  │ :3003      │
   └─────────┘      └──────────┘  └────────────┘
        │                │             │
   Books DB          72K vectors    LLM (Ollama)
   Sessions          Conversations   SIC score
   Operations        Messages        Quantum
   State             Search index    Detection
```

### Port Allocation

| Port | Service | Purpose | Owned By |
|------|---------|---------|----------|
| :3002 | Archive | Embeddings, search, content storage | humanizer-gm/electron/archive-server |
| :3003 | NPE-Local | AI detection, analysis, transformations | humanizer-gm/electron/npe-local |
| :3004 | Book Studio API | Book operations, orchestration | NEW - humanizer-gm/electron/book-studio |
| :11434 | Ollama | LLM inference | External (local on Mac) |

---

## ARCHITECTURE LAYERS

### 1. Data Layer (Book Studio API)

**Database**: SQLite (local Electron) or PostgreSQL (web version)

```sql
-- Books
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  target_word_count INT,
  status TEXT DEFAULT 'draft', -- draft|reviewing|published|archived
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  metadata JSONB -- custom author fields
);

-- Chapters
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  order INT,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

-- Harvest Cards (content staged for chapters)
CREATE TABLE harvest_cards (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_id TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'staging', -- staging|placed|archived
  grade JSONB, -- CardGrade object
  is_outline BOOLEAN,
  outline_structure JSONB,
  tags TEXT[],
  user_notes TEXT,
  harvested_at TIMESTAMP,
  created_at TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

-- Placements (card -> chapter assignments)
CREATE TABLE placements (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  position INT,
  created_at TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES harvest_cards(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- Generated Outlines
CREATE TABLE outlines (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  research_data JSONB, -- OutlineResearch
  generated_outline JSONB, -- GeneratedOutline
  user_edits JSONB, -- User modifications
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- Sessions (multi-step operations)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- research|outline-gen|draft-gen
  status TEXT DEFAULT 'active', -- active|completed|failed
  input JSONB,
  output JSONB,
  progress JSONB, -- { phase, completed, total, current_step }
  error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

### 2. Service Layer (Book Studio API)

**Core Services** (in `/electron/book-studio/services/`):

#### BookService
```typescript
class BookService {
  // CRUD
  createBook(title: string, metadata?: object): Promise<Book>
  getBook(bookId: string): Promise<Book | null>
  updateBook(bookId: string, updates: Partial<Book>): Promise<Book>
  deleteBook(bookId: string): Promise<void>
  listBooks(filters?: BookFilters): Promise<Book[]>
  
  // Chapters
  addChapter(bookId: string, chapter: Chapter): Promise<Chapter>
  updateChapter(chapterId: string, updates: Partial<Chapter>): Promise<Chapter>
  removeChapter(chapterId: string): Promise<void>
  reorderChapters(bookId: string, order: string[]): Promise<void>
  
  // State
  getBookState(bookId: string): Promise<BookWithState>
  getCurrentBook(): Promise<Book | null>
  setCurrentBook(bookId: string): Promise<void>
}
```

#### HarvestService
```typescript
class HarvestService {
  // Card operations
  harvestCard(bookId: string, searchResult: SearchResult): Promise<HarvestCard>
  gradeCard(cardId: string): Promise<CardGrade>
  updateCard(cardId: string, updates: Partial<HarvestCard>): Promise<HarvestCard>
  deleteCard(cardId: string): Promise<void>
  
  // Batch operations
  harvestMultiple(bookId: string, results: SearchResult[]): Promise<HarvestCard[]>
  deduplicateCards(bookId: string): Promise<{ removed: string[]; kept: HarvestCard[] }>
  
  // Queries
  getCards(bookId: string, filter?: CardFilter): Promise<HarvestCard[]>
  getStagingCards(bookId: string): Promise<HarvestCard[]>
  getPlacedCards(bookId: string): Promise<HarvestCard[]>
}
```

#### OutlineService
```typescript
class OutlineService {
  // Research & analysis
  researchCards(bookId: string, chapterId?: string): Promise<OutlineResearch>
  reviewOutline(outline: OutlineStructure, bookId: string): Promise<OutlineReview>
  
  // Generation
  generateOutline(bookId: string, chapterId: string, options?: OutlineGenConfig): Promise<GeneratedOutline>
  
  // Persistence
  saveOutline(bookId: string, chapterId: string, outline: GeneratedOutline): Promise<void>
  getOutline(bookId: string, chapterId: string): Promise<GeneratedOutline | null>
  
  // Ordering for draft
  orderCardsForOutline(outline: GeneratedOutline, bookId: string): Promise<OrderedSection[]>
}
```

#### DraftService
```typescript
class DraftService {
  // One-shot generation
  generateDraft(chapterId: string, options?: DraftConfig): Promise<string>
  
  // Streaming with progress
  generateDraftStreaming(chapterId: string, onProgress: ProgressCallback): Promise<string>
  
  // Section-by-section
  generateSection(chapterId: string, sectionIndex: number): Promise<string>
  
  // Expansion
  expandSection(text: string, context: string): Promise<string>
  
  // Save draft
  saveDraft(chapterId: string, content: string): Promise<Chapter>
  publishDraft(chapterId: string, content: string): Promise<Chapter>
}
```

#### ClusteringService
```typescript
class ClusteringService {
  // Live clustering
  clusterCards(cards: HarvestCard[]): Promise<ReactiveCluster[]>
  
  // Suggestions
  suggestGrouping(bookId: string): Promise<SuggestedGrouping>
  
  // Visualization
  getClusteringState(bookId: string): Promise<ClusteringState>
}
```

### 3. API Layer (Express Routes)

**Book Studio API Endpoints** (`:3004`):

#### Books
```
POST   /api/books                  # Create book
GET    /api/books                  # List books
GET    /api/books/:id              # Get book + children
PATCH  /api/books/:id              # Update book
DELETE /api/books/:id              # Delete book
POST   /api/books/:id/archive      # Archive book

# Current book context
GET    /api/books/current          # Get current book
POST   /api/books/:id/set-current  # Set as current
```

#### Chapters
```
POST   /api/books/:id/chapters     # Add chapter
PATCH  /api/books/:id/chapters/:cid  # Update chapter
DELETE /api/books/:id/chapters/:cid  # Remove chapter
POST   /api/books/:id/chapters/reorder # Reorder chapters
```

#### Harvest
```
# Harvest operations
POST   /api/books/:id/harvest      # Harvest single card from archive search
POST   /api/books/:id/harvest-batch # Harvest multiple cards
GET    /api/books/:id/cards        # List cards (filter: staging|placed|all)
PATCH  /api/books/:id/cards/:cid   # Update card grade/notes
DELETE /api/books/:id/cards/:cid   # Delete/unplace card

# Deduplication
POST   /api/books/:id/deduplicate  # Remove duplicates, return stats

# Clustering
POST   /api/books/:id/cluster      # Get clustering for cards
GET    /api/books/:id/clustering-state # Get current clustering
```

#### Outlines
```
# Research phase
POST   /api/books/:id/chapters/:cid/research  # Research cards for chapter
  Returns: OutlineResearch { themes, arcs, gaps, suggestedSections, ... }

# Review phase
POST   /api/books/:id/chapters/:cid/review-outline  # Review provided outline
  Body: { outline: OutlineStructure }
  Returns: OutlineReview

# Generation phase
POST   /api/books/:id/chapters/:cid/generate-outline  # Generate outline
  Body: { proposedOutline?: OutlineStructure, config?: OutlineGenConfig }
  Returns: GeneratedOutline

# Persistence
GET    /api/books/:id/chapters/:cid/outline   # Get saved outline
PUT    /api/books/:id/chapters/:cid/outline   # Save/update outline
```

#### Drafts
```
# Generation (streaming)
POST   /api/books/:id/chapters/:cid/draft     # Generate draft (streaming SSE)
  Upgrade to WebSocket for progress events
  Returns: EventStream<GenerationProgress>

# One-shot (for testing)
POST   /api/books/:id/chapters/:cid/draft-sync # Generate draft (blocking)
  Returns: { draft: string, metadata: {...} }

# Section generation
POST   /api/books/:id/chapters/:cid/sections/:sec/draft # Single section

# Expansion
POST   /api/books/:id/chapters/:cid/expand-section
  Body: { text: string, context: string }
  Returns: { expanded: string }

# Save & publish
POST   /api/books/:id/chapters/:cid/save-draft
  Body: { content: string }
  Returns: Chapter

POST   /api/books/:id/chapters/:cid/publish
  Body: { content: string }
  Returns: Chapter
```

#### Sessions
```
# Track long-running operations
GET    /api/sessions/:id           # Get session status
GET    /api/sessions/:id/progress  # SSE stream of progress updates
POST   /api/sessions/:id/cancel    # Cancel running operation

# List active sessions for book
GET    /api/books/:id/sessions     # All sessions for book
```

#### Health & Status
```
GET    /api/health                 # Server health
GET    /api/status                 # Detailed status (Archive, NPE-Local, etc)
```

---

## DATA FLOW EXAMPLES

### Flow 1: Research → Review → Generate Outline

```
Frontend:
  1. User clicks "Analyze Outline" button
  2. Frontend makes POST /api/books/{id}/chapters/{cid}/research
  3. Frontend opens "Outline Research" panel with results

Server (BookStudioAPI):
  1. BookService.getCards() → fetch staged cards
  2. OutlineService.researchCards()
     └─ extractThemes() (local)
     └─ detectNarrativeArcs() (local)
     └─ mapSourcesToThemes() (local)
     └─ analyzeCoverage() (local)
     └─ suggestSections() (local)
  3. Store research in outlines table
  4. Return: { themes, arcs, gaps, strongAreas, suggestedSections }

Frontend:
  5. Display research results
  6. User proposes outline or accepts suggestions
  7. POST /api/books/{id}/chapters/{cid}/review-outline
     { outline: { type: 'numbered', items: [...] } }

Server:
  8. OutlineService.reviewOutline()
     └─ For each outline item, findMatchingCards()
     └─ Calculate coverage scores
     └─ Suggest additions from research
  9. Return: { itemReviews, overallCoverage, feasibility, uncoveredItems }

Frontend:
  10. Display review, highlight gaps
  11. User accepts outline
  12. POST /api/books/{id}/chapters/{cid}/generate-outline
      { proposedOutline: review.outline, config: { preferArcStructure: true } }

Server:
  13. OutlineService.generateOutline()
     └─ mergeOutlines(proposed, research, review, config)
     └─ orderForNarrativeFlow()
     └─ Build cardAssignments map
  14. Save to outlines table
  15. Return: GeneratedOutline with structure + card assignments

Frontend:
  16. Display final outline
  17. User proceeds to draft generation
```

### Flow 2: Draft Generation with Progress Streaming

```
Frontend:
  1. User clicks "Generate Draft"
  2. Opens WebSocket to /api/books/{id}/chapters/{cid}/draft-ws
  3. Sends: { strategy: 'outline-based', config: { model: 'llama3.2' } }

Server (BookStudioAPI):
  1. DraftService.generateDraftStreaming()
  2. Calls OutlineService.orderCardsForOutline() → OrderedSection[]
  3. Send WS event: { phase: 'preparing', progress: 0 }
  4. Call DraftService.deduplicateCards() → unique cards
  5. Send WS event: { phase: 'deduplicating', removed: 5, kept: 45 }
  6. Build prompt from sections
  7. POST to NPE-Local /api/transformations/generate (LLM)
  8. Pipe response stream → chunk events to frontend
  9. Send WS events on each chunk: { phase: 'generating', partialContent: '...', tokensGenerated: 42 }
  10. On completion: { phase: 'complete', content: '...' }

Frontend:
  1. Show progress bar (preparing → deduplicating → generating → complete)
  2. Stream partial text to draft preview
  3. On complete, enable "Save Draft" button
```

### Flow 3: Card Grading (Background)

```
Frontend:
  1. User harvests card from search
  2. POST /api/books/{id}/harvest
     { searchResult: { id, type, content, ... } }

Server (BookStudioAPI):
  1. HarvestService.harvestCard()
  2. Create HarvestCard in DB with status='staging'
  3. Call harvest-review-agent.quickGradeCard() → Partial<CardGrade>
  4. Update DB with quick grade
  5. Send WebSocket event: { type: 'card-harvested', card: {...}, grade: {...} }
  6. Queue full grading in background (async)
     └─ Call NPE-Local /api/transformations/analyze (SIC)
     └─ Call NPE-Local /api/quantum-analysis/start|step (Quantum)
     └─ Update DB with full grade
     └─ Send WS event: { type: 'card-graded', cardId, grade: {...} }

Frontend:
  1. Receive 'card-harvested' event
  2. Add card to staging area with quick grade
  3. Later receive 'card-graded' event
  4. Update card with full grade (animation: progress → complete)
```

---

## EVENT SIGNALING PATTERN (Tool Signaling)

### WebSocket Events from Server → Frontend

**Event Format**:
```typescript
interface ToolEvent {
  type: string // e.g., 'card-harvested', 'card-graded', 'draft-progress', 'outline-complete'
  bookId: string
  chapterId?: string
  payload: any
  timestamp: ISO8601
  sessionId?: string // Link to session if multi-step operation
}
```

**Event Types**:

| Event | Payload | Trigger | UI Effect |
|-------|---------|---------|-----------|
| `card-harvested` | `{ card, grade }` | User harvests from search | Add card to staging area |
| `card-graded` | `{ cardId, grade }` | Background grading completes | Update card grade visual |
| `card-clustered` | `{ clusters, stats }` | Clustering runs | Update cluster view |
| `outline-researched` | `{ research }` | Research completes | Show research panel |
| `outline-reviewed` | `{ review }` | Review completes | Show coverage analysis |
| `outline-generated` | `{ outline, confidence }` | Generation completes | Display outline |
| `draft-progress` | `{ phase, progress, tokens }` | LLM generates tokens | Update progress bar, stream text |
| `draft-complete` | `{ content, wordCount }` | Draft generation done | Show draft, enable save |
| `session-error` | `{ error, phase }` | Operation fails | Show error toast |

### WebSocket Connection

**URL**: `ws://localhost:3004/ws`

**Auth**: Pass `bookId` in query or header

**Client → Server**:
```typescript
// Subscribe to events for a book
{ type: 'subscribe', bookId: 'book-123' }

// Subscribe to specific chapters
{ type: 'subscribe', bookId: 'book-123', chapterId: 'ch-456' }

// Cancel operation
{ type: 'cancel', sessionId: 'sess-789' }
```

**Server → Client**:
```typescript
// Events stream continuously
{ type: 'card-harvested', bookId, card, timestamp }
{ type: 'draft-progress', bookId, chapterId, phase, progress, timestamp }
```

---

## INTEGRATION WITH EXISTING APIS

### Archive Integration (:3002)

**Book Studio calls Archive for**:
1. Semantic search (harvest cards)
2. Content retrieval (full conversations)
3. Metadata queries (date ranges, tags)

**Example call**:
```typescript
// In HarvestService.harvestCard()
const searchResult = await archiveReader.unifiedSearch(query, { limit: 50 })
// → Array<SearchResult>
```

### NPE-Local Integration (:3003)

**Book Studio calls NPE-Local for**:
1. SIC analysis (card authenticity grading)
2. Quantum analysis (inflection detection)
3. LLM draft generation (Ollama)

**Example call**:
```typescript
// In harvest-review-agent.ts (moved to server)
const sic = await fetch('http://localhost:3003/transformations/analyze', {
  method: 'POST',
  body: JSON.stringify({ text: card.content })
})
// → { score: 75, category: 'polished-human', signals: [...] }
```

**Example call**:
```typescript
// In DraftService.generateDraft()
const stream = await fetch('http://localhost:3003/transformations/generate', {
  method: 'POST',
  body: JSON.stringify({
    model: 'llama3.2',
    prompt: buildPrompt(chapter, cards),
    stream: true
  })
})
// → streaming JSON response
```

---

## MIGRATION PATH: Browser → Server

### Phase 1: Setup (Week 1)

**Create Book Studio API skeleton**:
- Express server on :3004
- Database layer (SQLite for Electron)
- Service classes (stub implementations)
- Routes (empty handlers)

**Parallel**: Keep all logic in frontend (no breaking changes)

### Phase 2: Port Services (Weeks 2-3)

**Move in order of dependency**:
1. `BookService` - simple CRUD
2. `HarvestService` - card management
3. `ClusteringService` - card grouping
4. `OutlineService` - research/review/generate (local logic)
5. `DraftService` - LLM coordination

**For each service**:
- Move logic from browser file → server file
- Create API endpoints
- Update frontend to call API instead of local function
- Test end-to-end

### Phase 3: Event Signaling (Week 4)

**Add WebSocket layer**:
- Server emits events on completion
- Frontend subscribes to WebSocket
- Remove polling/callbacks

**Example: Card grading**
- Before: Frontend calls `quickGradeCard()`, waits for response, updates UI
- After: Frontend harvests card (API), server sends event when grading complete, frontend updates UI from event

### Phase 4: Persistence (Week 5)

**Enable session recovery**:
- All books stored in DB
- Outlines persisted
- Drafts autosaved

**User workflow change**:
- Open app → loads last book
- All work is available offline
- No "save" needed (incremental saves on API calls)

---

## DETAILED API SPECIFICATIONS

### POST /api/books/:id/harvest

**Request**:
```json
{
  "searchResult": {
    "id": "msg-123",
    "type": "message",
    "source": "conversation",
    "content": "This is a collected passage...",
    "title": "Untitled",
    "similarity": 0.92,
    "authorName": "Jane"
  }
}
```

**Response** (201 Created):
```json
{
  "id": "card-456",
  "content": "This is a collected passage...",
  "status": "staging",
  "grade": {
    "overall": 3,
    "authenticity": 3,
    "necessity": 3,
    "inflection": 2,
    "voice": 3,
    "stubType": "optimal",
    "gradedBy": "auto",
    "confidence": 0.5
  },
  "harvestedAt": "2026-01-16T12:34:56Z",
  "tags": [],
  "userNotes": ""
}
```

**Background**:
- Quick grade runs synchronously
- Full grade (SIC + Quantum) queued async
- When full grade completes → WebSocket event

### POST /api/books/:id/chapters/:cid/generate-outline

**Request**:
```json
{
  "proposedOutline": {
    "type": "numbered",
    "items": [
      { "level": 0, "text": "Chapter Overview" },
      { "level": 1, "text": "Key Theme 1" },
      { "level": 1, "text": "Key Theme 2" }
    ]
  },
  "config": {
    "keepProposedItems": true,
    "minSectionStrength": 0.3,
    "maxSections": 10,
    "preferArcStructure": true
  }
}
```

**Response** (200 OK):
```json
{
  "id": "outline-789",
  "structure": {
    "type": "numbered",
    "items": [
      { "level": 0, "text": "Introduction", "children": [...] }
    ],
    "depth": 2,
    "confidence": 0.78
  },
  "itemCardAssignments": {
    "0": ["card-1", "card-5", "card-12"],
    "0-0": ["card-3", "card-7"]
  },
  "confidence": 0.78,
  "generatedAt": "2026-01-16T12:34:56Z",
  "basedOn": {
    "research": true,
    "proposedOutline": true,
    "userPrompts": false
  }
}
```

### POST /api/books/:id/chapters/:cid/draft (WebSocket)

**WebSocket URL**: `ws://localhost:3004/api/books/:id/chapters/:cid/draft`

**Initial Message** (client → server):
```json
{
  "strategy": "outline-based",
  "config": {
    "model": "llama3.2",
    "temperature": 0.7,
    "preserveVoice": true,
    "includeTransitions": true,
    "generateBySection": false
  }
}
```

**Server Response Events**:
```json
{ "phase": "preparing", "timestamp": "..." }
{ "phase": "deduplicating", "removed": 5, "kept": 45, "timestamp": "..." }
{
  "phase": "generating",
  "currentSection": 1,
  "totalSections": 3,
  "sectionTitle": "Introduction",
  "tokensGenerated": 42,
  "partialContent": "The first section started when...",
  "timestamp": "..."
}
{ "phase": "complete", "content": "...", "wordCount": 1240, "timestamp": "..." }
```

---

## DEPLOYMENT & CONFIGURATION

### Electron (humanizer-gm)

**File structure**:
```
electron/
├── book-studio/                  # NEW
│   ├── server.ts                # Express app
│   ├── routes/
│   │   ├── books.ts
│   │   ├── chapters.ts
│   │   ├── harvest.ts
│   │   ├── outlines.ts
│   │   └── drafts.ts
│   ├── services/
│   │   ├── BookService.ts
│   │   ├── HarvestService.ts
│   │   ├── OutlineService.ts
│   │   ├── DraftService.ts
│   │   ├── ClusteringService.ts
│   │   └── database/
│   │       ├── migrations.ts
│   │       └── models.ts
│   ├── utils/
│   │   ├── prompts.ts
│   │   ├── deduplication.ts
│   │   └── constants.ts
│   └── index.ts                 # startBookStudioServer()
├── main.ts                      # Start all servers
└── npe-local/
└── archive-server/
```

**main.ts changes**:
```typescript
// Start Book Studio API on :3004 when app launches
import { startBookStudioServer } from './book-studio';

async function startEmbeddedServers() {
  // Archive :3002
  await startArchiveServer({ archivePath });
  
  // NPE-Local :3003
  await startNpeLocalServer({ ollamaUrl });
  
  // Book Studio :3004 (NEW)
  await startBookStudioServer({ dbPath: userData + '/books.db' });
}
```

### Environment & Configuration

**Config file** (`~/.humanizer/book-studio.json`):
```json
{
  "port": 3004,
  "database": {
    "type": "sqlite",
    "path": "~/.humanizer/books.db"
  },
  "services": {
    "archive": "http://localhost:3002",
    "npe_local": "http://localhost:3003",
    "ollama": "http://localhost:11434"
  },
  "logging": {
    "level": "info",
    "file": "~/.humanizer/logs/book-studio.log"
  }
}
```

---

## ERROR HANDLING & RESILIENCE

### Graceful Degradation

| Failure | Fallback |
|---------|----------|
| Ollama unavailable | Show error message, allow text-only editing |
| NPE-Local SIC fails | Use default grades (3/5) for all cards |
| Archive unreachable | Can't search/harvest, show error |
| DB corrupted | Recover from backup, or factory reset |

### Retry Strategy

```typescript
// For transient failures
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === maxRetries - 1) throw e
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)))
    }
  }
}

// Usage
const grades = await withRetry(() => gradeCardsFull(cards))
```

### Request Timeouts

```typescript
// Prevent hanging requests
const timeout = (ms: number) => new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Request timeout')), ms)
)

const result = await Promise.race([
  fetch('/api/...'),
  timeout(30000) // 30s timeout
])
```

---

## TESTING STRATEGY

### Unit Tests
- Individual services (BookService, HarvestService, etc)
- Utility functions (deduplication, clustering)
- DB migrations

### Integration Tests
- API endpoints + database
- Service interactions (Harvest → Outline → Draft)
- Event emission

### E2E Tests (Electron)
- Full workflow: harvest → research → outline → draft
- WebSocket event delivery
- Error scenarios

### Performance Tests
- Clustering speed (100+ cards)
- Outline generation (50 items)
- Draft streaming (smooth progress)

---

## ARCHITECT REVIEW CHECKLIST

- [x] No duplicate systems (Outline service exists, moved to server)
- [x] Implementation-first (outline-agent.ts, draft-generator.ts → server)
- [x] Proper boundaries (Browser = view, Server = orchestration)
- [x] Integration patterns (Archive, NPE-Local calls are explicit)
- [x] Event-driven (tools signal completion, UI listens)
- [x] Persistence (DB-backed, recoverable)
- [x] Scalability (same API for Electron + future web)

---

## SUMMARY TABLE

| Aspect | Current State | Proposed State |
|--------|---------------|----------------|
| Business Logic | Browser (React) | Server (Express) |
| Storage | localStorage | SQLite (:3004) |
| Persistence | Session-only | Permanent DB |
| Persistence | Session-only | Permanent DB |
| Grading | UI blocks during SIC/Quantum | Background queue |
| Scaling | Single user only | Multi-user ready |
| Interop | Browser-specific | API-driven (any client) |
| Progress Feedback | setProgress callbacks | WebSocket events |

---

## NEXT STEPS

1. **Approve architecture** - Ensure topology makes sense
2. **Design database schema** - Finalize migrations
3. **Implement Phase 1** - Skeleton server + health endpoint
4. **Port services incrementally** - One service per PR
5. **Add WebSocket layer** - Event streaming
6. **Load testing** - Ensure performance with real data

