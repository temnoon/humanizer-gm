# Handoff: Book Studio API Consolidation

**Date**: January 21, 2026
**Status**: Architecture Audit Complete, Implementation Required
**Priority**: CRITICAL - MVP Blocker
**Scope**: Full Book Maker API consolidation, eliminate frontend business logic

---

## Executive Summary

Book Studio has **three separate book systems** causing confusion, data loss, and broken features. The frontend contains heavy business logic that should be server-side. Harvest history is not being recorded. Draft generation doesn't work. This handoff provides the complete plan to consolidate everything into a single, production-ready Book Maker API.

---

## Current State (Problems)

### Three Duplicate Book Systems

| System | Database | Port | Used By |
|--------|----------|------|---------|
| book-studio-server | books.db | 3004 | UI (partial) |
| npe-local | npe-local.db | - | IPC draft:start |
| archive-server | embeddings.db | 3002 | Old book routes |

### Frontend Business Logic (Wrong Location)

| File | Lines | Problem |
|------|-------|---------|
| draft-generator.ts | 905 | Calls Ollama from browser |
| outline-agent.ts | 1540 | Heavy business logic |
| clustering.ts | 414 | Duplicates API |
| smart-harvest-agent.ts | 360 | Calls Ollama from browser |
| assignment-agent.ts | 314 | Should be API |
| harvest-review-agent.ts | 508 | Should be API |

### Missing Critical Features

- harvest_history table exists but **never populated**
- No sqlite-vec embeddings for book content
- No draft generation API endpoint
- No author voice file storage
- No iterative harvest query improvement

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Archive Server (3002) - READ ONLY SOURCE                       │
│  - Conversations, messages                                       │
│  - 3-level pyramid embeddings                                    │
│  - Semantic search for harvest                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓ harvest
┌─────────────────────────────────────────────────────────────────┐
│  Book Studio API (3004) - SINGLE SOURCE OF TRUTH                │
│                                                                  │
│  books.db (SQLite)          │  books-vec.db (sqlite-vec)        │
│  ─────────────────          │  ────────────────────────         │
│  • books                    │  • card_embeddings                │
│  • chapters                 │  • chapter_embeddings             │
│  • cards                    │  • outline_embeddings             │
│  • outlines                 │  • voice_embeddings               │
│  • clusters                 │                                    │
│  • harvest_history ←NEW     │                                    │
│  • harvest_instructions     │                                    │
│  • author_voices            │                                    │
│  • book_media               │                                    │
│  • draft_versions           │                                    │
│                                                                  │
│  API Services:                                                   │
│  • /api/harvest/* - Search, commit, history, iterate            │
│  • /api/draft/* - Generate, version, compare                    │
│  • /api/outline/* - Research, generate, refine                  │
│  • /api/voice/* - Extract, store, apply                         │
│  • /api/cluster/* - Compute, refine                             │
│  • /api/assignment/* - Auto-assign, manual adjust               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React) - PRESENTATION ONLY                           │
│  - Calls API for ALL operations                                  │
│  - No business logic                                             │
│  - No direct Ollama calls                                        │
│  - State from API responses only                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## House Agent Council Implementation Guidance

### 1. Architect Agent

**Principle**: Single source of truth, API-first, no business logic in frontend.

**Patterns to Enforce**:
```typescript
// CORRECT: API call from frontend
const draft = await api.post('/api/draft/generate', { chapterId, cards });

// WRONG: Direct Ollama call from frontend
const response = await fetch('http://localhost:11434/api/generate', {...});
```

**File Structure**:
```
electron/book-studio-server/
├── routes/
│   ├── books.ts
│   ├── chapters.ts
│   ├── cards.ts
│   ├── harvest.ts         ← NEW: consolidate harvest logic
│   ├── draft.ts           ← NEW: draft generation
│   ├── voice.ts           ← NEW: author voice management
│   └── ...
├── services/
│   ├── HarvestService.ts  ← NEW: harvest business logic
│   ├── DraftService.ts    ← NEW: draft generation with Ollama
│   ├── OutlineService.ts  ← EXISTS: enhance
│   ├── ClusterService.ts  ← EXISTS: enhance
│   ├── VoiceService.ts    ← NEW: voice extraction/application
│   └── EmbeddingService.ts← NEW: sqlite-vec management
├── database/
│   ├── migrations/        ← NEW: schema migrations
│   ├── schema.ts          ← Consolidated schema
│   └── vec-schema.ts      ← NEW: sqlite-vec schema
└── config.ts
```

**Migration Strategy**:
1. Create new services in book-studio-server
2. Create thin API routes that call services
3. Update frontend to call API instead of local logic
4. Remove frontend business logic files
5. Remove duplicate systems (npe-local, archive-server books)

---

### 2. Data Agent

**Principle**: All book data in one database, proper foreign keys, migrations.

**New Schema Requirements**:

```sql
-- Harvest History (MUST BE POPULATED)
CREATE TABLE harvest_history (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT,

    -- Query details
    query TEXT NOT NULL,
    query_embedding BLOB,  -- For similarity comparison

    -- Parameters
    similarity_threshold REAL DEFAULT 0.3,
    result_limit INTEGER DEFAULT 20,
    source_types TEXT DEFAULT '["message"]',
    date_range_start INTEGER,
    date_range_end INTEGER,

    -- Results
    result_count INTEGER DEFAULT 0,
    result_ids TEXT DEFAULT '[]',

    -- Actions taken
    accepted_ids TEXT DEFAULT '[]',
    rejected_ids TEXT DEFAULT '[]',
    harvested_count INTEGER DEFAULT 0,

    -- Iteration
    parent_harvest_id TEXT,  -- For iterative refinement
    iteration_number INTEGER DEFAULT 1,
    adjustment_notes TEXT,

    -- Metadata
    config_json TEXT,
    created_at INTEGER NOT NULL,
    user_id TEXT,

    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_harvest_id) REFERENCES harvest_history(id)
);

-- Agentic Harvest Instructions
CREATE TABLE harvest_instructions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT,

    instruction_type TEXT NOT NULL,  -- 'include', 'exclude', 'prefer', 'avoid'
    instruction_text TEXT NOT NULL,

    -- Conditions
    applies_to_sources TEXT,  -- JSON array of source types
    applies_to_date_range TEXT,  -- JSON {start, end}

    priority INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    user_id TEXT,

    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

-- Author Voice Files
CREATE TABLE author_voices (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,

    name TEXT NOT NULL,
    description TEXT,

    -- Voice characteristics
    sample_text TEXT NOT NULL,
    extracted_features TEXT,  -- JSON: tone, vocabulary, rhythm, etc.

    -- Source
    source_card_ids TEXT DEFAULT '[]',
    source_type TEXT,  -- 'extracted', 'manual', 'imported'

    -- Usage
    is_primary INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,

    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    user_id TEXT,

    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- Draft Versions
CREATE TABLE draft_versions (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    book_id TEXT NOT NULL,

    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,

    -- Generation info
    generator_model TEXT,
    generator_params TEXT,  -- JSON
    card_ids_used TEXT DEFAULT '[]',
    voice_id TEXT,

    -- Quality
    quality_score REAL,
    review_status TEXT DEFAULT 'pending',
    review_notes TEXT,

    created_at INTEGER NOT NULL,
    user_id TEXT,

    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (voice_id) REFERENCES author_voices(id) ON DELETE SET NULL
);

-- Book Media
CREATE TABLE book_media (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    chapter_id TEXT,

    media_type TEXT NOT NULL,  -- 'image', 'audio', 'document'
    filename TEXT NOT NULL,
    mime_type TEXT,
    file_path TEXT NOT NULL,
    file_size INTEGER,

    -- Metadata
    title TEXT,
    description TEXT,
    alt_text TEXT,  -- For accessibility

    -- Usage
    usage_context TEXT,  -- 'cover', 'chapter_image', 'reference', etc.
    position INTEGER,

    created_at INTEGER NOT NULL,
    user_id TEXT,

    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);
```

**sqlite-vec Companion Schema**:

```sql
-- In books-vec.db
CREATE VIRTUAL TABLE card_embeddings USING vec0(
    card_id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    embedding FLOAT[1024]  -- mxbai-embed-large dimension
);

CREATE VIRTUAL TABLE chapter_embeddings USING vec0(
    chapter_id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    embedding FLOAT[1024]
);

CREATE VIRTUAL TABLE voice_embeddings USING vec0(
    voice_id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    embedding FLOAT[1024]
);
```

**Migration System**:
```typescript
// electron/book-studio-server/database/migrations/
// 001_initial_schema.ts
// 002_add_harvest_history_fields.ts
// 003_add_harvest_instructions.ts
// 004_add_author_voices.ts
// 005_add_draft_versions.ts
// 006_add_book_media.ts
```

---

### 3. Security Agent

**Principle**: Validate all inputs, sanitize outputs, authenticate requests.

**Requirements**:

```typescript
// Input validation on ALL endpoints
import { z } from 'zod';

const HarvestRequestSchema = z.object({
  bookId: z.string().uuid(),
  query: z.string().min(1).max(1000),
  similarityThreshold: z.number().min(0).max(1).default(0.3),
  limit: z.number().min(1).max(100).default(20),
  sourceTypes: z.array(z.enum(['message', 'document', 'note'])).optional(),
});

// Sanitize content before storage
function sanitizeContent(content: string): string {
  // Remove control characters
  return content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

// User isolation
async function getBooks(userId: string): Promise<Book[]> {
  return db.all('SELECT * FROM books WHERE user_id = ?', [userId]);
}

// Rate limiting on expensive operations
const draftRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,  // 5 draft generations per minute
});
```

**Auth Requirements**:
- All endpoints require authentication
- User can only access their own books
- Admin endpoints require admin role
- API keys for programmatic access

---

### 4. Accessibility Agent

**Principle**: All content must be accessible, proper alt text, keyboard navigation.

**Requirements**:

```typescript
// book_media table requires alt_text
if (mediaType === 'image' && !altText) {
  throw new ValidationError('Images require alt_text for accessibility');
}

// Draft content accessibility check
function checkDraftAccessibility(content: string): AccessibilityReport {
  return {
    hasHeadings: /^#{1,6}\s/m.test(content),
    hasLists: /^[-*]\s/m.test(content),
    imagesMissingAlt: (content.match(/!\[]\(/g) || []).length,
    readabilityScore: calculateReadability(content),
  };
}
```

---

### 5. Stylist Agent

**Principle**: Consistent API responses, proper error formats.

**API Response Standards**:

```typescript
// Success response
{
  success: true,
  data: { ... },
  meta: {
    timestamp: number,
    requestId: string,
  }
}

// Error response
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: any,
  },
  meta: {
    timestamp: number,
    requestId: string,
  }
}

// Pagination
{
  success: true,
  data: [...],
  pagination: {
    page: number,
    pageSize: number,
    total: number,
    hasMore: boolean,
  }
}
```

---

### 6. Technical Debt Agent

**Files to Remove After Migration**:

```
# Frontend business logic (move to API, then delete)
apps/web/src/lib/book-studio/draft-generator.ts
apps/web/src/lib/book-studio/outline-agent.ts
apps/web/src/lib/book-studio/clustering.ts
apps/web/src/lib/book-studio/reactive-clustering.ts
apps/web/src/lib/book-studio/smart-harvest-agent.ts
apps/web/src/lib/book-studio/assignment-agent.ts
apps/web/src/lib/book-studio/harvest-review-agent.ts
apps/web/src/lib/book-studio/chekhov-local.ts

# Duplicate book systems (remove entirely)
electron/npe-local/services/books/
electron/archive-server/routes/books.ts

# Old IPC handlers (replace with API calls)
# In electron/ipc/xanadu.ts: draft:start, draft:pause, etc.
```

**Technical Debt Tracking**:
- [ ] Remove frontend Ollama calls
- [ ] Remove npe-local.db book tables
- [ ] Remove archive-server book routes
- [ ] Consolidate IPC to use API
- [ ] Add comprehensive error handling
- [ ] Add request logging
- [ ] Add metrics/monitoring

---

## Implementation Plan (Phases)

### Phase 1: Database Schema (Day 1)

1. Create migration system for book-studio-server
2. Add new tables: harvest_instructions, author_voices, draft_versions, book_media
3. Enhance harvest_history with all required fields
4. Set up sqlite-vec companion database
5. Write schema documentation

### Phase 2: Core Services (Days 2-3)

1. **HarvestService.ts**
   - `search(query, params)` - Search archive, return results
   - `commit(results, bookId)` - Create cards from results
   - `recordHistory(harvest)` - Store harvest details
   - `getHistory(bookId)` - Get previous harvests
   - `suggestRefinement(harvestId)` - Suggest query improvements

2. **DraftService.ts**
   - `generate(chapterId, options)` - Generate draft via Ollama
   - `saveVersion(draft)` - Store draft version
   - `getVersions(chapterId)` - Get draft history
   - `compare(v1, v2)` - Compare draft versions

3. **VoiceService.ts**
   - `extract(cardIds)` - Extract voice from cards
   - `apply(voiceId, content)` - Apply voice to content
   - `list(bookId)` - List voices for book

4. **EmbeddingService.ts**
   - `embed(content)` - Get embedding via Ollama
   - `store(type, id, embedding)` - Store in sqlite-vec
   - `search(query, type)` - Semantic search within book

### Phase 3: API Routes (Days 4-5)

1. Create `/api/harvest/*` routes
2. Create `/api/draft/*` routes
3. Create `/api/voice/*` routes
4. Enhance existing routes with new features
5. Add consistent error handling and validation

### Phase 4: Frontend Migration (Days 6-7)

1. Replace direct Ollama calls with API calls
2. Replace business logic with API calls
3. Update state management to use API responses
4. Remove deprecated frontend files
5. Update tests

### Phase 5: Cleanup & Testing (Day 8)

1. Remove duplicate systems (npe-local, archive-server books)
2. Update IPC handlers to use new API
3. Integration testing
4. Load testing
5. Security audit

---

## API Endpoint Specification

### Harvest API

```
POST   /api/harvest/search
  Body: { bookId, query, similarityThreshold?, limit?, sourceTypes?, dateRange? }
  Returns: { results: SearchResult[], harvestId: string }

POST   /api/harvest/commit
  Body: { harvestId, acceptedIds: string[], rejectedIds?: string[] }
  Returns: { cards: Card[], committed: number }

GET    /api/harvest/history/:bookId
  Query: { page?, limit? }
  Returns: { harvests: HarvestHistory[], pagination }

POST   /api/harvest/iterate/:harvestId
  Body: { adjustments: { query?, threshold?, limit? }, notes? }
  Returns: { results: SearchResult[], newHarvestId: string }

GET    /api/harvest/suggestions/:bookId
  Returns: { suggestions: QuerySuggestion[] }
```

### Draft API

```
POST   /api/draft/generate
  Body: { chapterId, cardIds?, voiceId?, model?, temperature? }
  Returns: { draft: DraftVersion, jobId?: string }

GET    /api/draft/versions/:chapterId
  Returns: { versions: DraftVersion[] }

GET    /api/draft/compare
  Query: { v1, v2 }
  Returns: { diff: DiffResult, stats: CompareStats }

POST   /api/draft/accept/:versionId
  Returns: { chapter: Chapter }
```

### Voice API

```
POST   /api/voice/extract
  Body: { bookId, cardIds: string[], name? }
  Returns: { voice: AuthorVoice }

GET    /api/voice/:bookId
  Returns: { voices: AuthorVoice[] }

POST   /api/voice/apply
  Body: { voiceId, content: string }
  Returns: { transformed: string }
```

---

## Success Criteria

1. **All book operations work via API** - No frontend business logic
2. **harvest_history is populated** - Every search recorded
3. **Draft generation works** - Ollama called from server
4. **sqlite-vec embeddings exist** - Book content searchable
5. **No duplicate systems** - Single books.db
6. **Proper error handling** - All errors caught, logged, returned
7. **Authentication enforced** - User isolation
8. **House agents sign off** - All reviews pass

---

## Files Modified/Created

### New Files
```
electron/book-studio-server/
├── services/
│   ├── HarvestService.ts
│   ├── DraftService.ts
│   ├── VoiceService.ts
│   └── EmbeddingService.ts
├── routes/
│   ├── harvest.ts
│   ├── draft.ts
│   └── voice.ts
├── database/
│   ├── migrations/
│   │   ├── 001_initial.ts
│   │   ├── 002_harvest_history.ts
│   │   ├── 003_harvest_instructions.ts
│   │   ├── 004_author_voices.ts
│   │   ├── 005_draft_versions.ts
│   │   └── 006_book_media.ts
│   └── vec-database.ts
└── middleware/
    ├── validation.ts
    └── error-handler.ts
```

### Files to Update
```
electron/book-studio-server/server.ts  # Add new routes
electron/book-studio-server/config.ts  # Add vec db config
apps/web/src/lib/book-studio/api-client.ts  # Add new API calls
apps/web/src/lib/book-studio/useBookStudioApi.ts  # Update hooks
```

### Files to Delete (After Migration)
```
apps/web/src/lib/book-studio/draft-generator.ts
apps/web/src/lib/book-studio/outline-agent.ts
apps/web/src/lib/book-studio/clustering.ts
apps/web/src/lib/book-studio/smart-harvest-agent.ts
electron/npe-local/services/books/
electron/archive-server/routes/books.ts
```

---

## ChromaDB Memory Tags

- `book-studio-consolidation`
- `api-first-architecture`
- `mvp-blocker`
- `house-agent-council`
- `jan2026`
- `harvest-iteration`
- `draft-generation`
- `sqlite-vec`

---

**End of Handoff**
