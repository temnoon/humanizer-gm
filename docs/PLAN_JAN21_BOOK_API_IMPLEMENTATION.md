# Implementation Plan: Book Studio API Consolidation

**Date**: January 21, 2026
**Priority**: CRITICAL MVP
**Estimated Effort**: 8 days

---

## Phase 1: Database Schema (Day 1)

### Tasks

- [ ] 1.1 Create migration system in `electron/book-studio-server/database/migrations/`
- [ ] 1.2 Write migration 001: Add fields to harvest_history
- [ ] 1.3 Write migration 002: Create harvest_instructions table
- [ ] 1.4 Write migration 003: Create author_voices table
- [ ] 1.5 Write migration 004: Create draft_versions table
- [ ] 1.6 Write migration 005: Create book_media table
- [ ] 1.7 Set up sqlite-vec companion database (books-vec.db)
- [ ] 1.8 Create EmbeddingDatabase class for vec operations
- [ ] 1.9 Run migrations, verify schema
- [ ] 1.10 **HOUSE REVIEW: Data Agent sign-off**

### Files to Create
```
electron/book-studio-server/database/
├── migrate.ts              # Migration runner
├── migrations/
│   ├── index.ts            # Migration registry
│   ├── 001_harvest_history_fields.ts
│   ├── 002_harvest_instructions.ts
│   ├── 003_author_voices.ts
│   ├── 004_draft_versions.ts
│   └── 005_book_media.ts
└── vec-database.ts         # sqlite-vec wrapper
```

---

## Phase 2: Core Services (Days 2-3)

### Tasks

- [ ] 2.1 Create HarvestService.ts
  - [ ] search() - Query archive-server, return results
  - [ ] commit() - Create cards, record history
  - [ ] recordHistory() - Full harvest details
  - [ ] getHistory() - Retrieve past harvests
  - [ ] suggestRefinement() - Query improvement suggestions

- [ ] 2.2 Create DraftService.ts
  - [ ] generate() - Call Ollama, create draft
  - [ ] saveVersion() - Store with metadata
  - [ ] getVersions() - List versions
  - [ ] compare() - Diff two versions
  - [ ] accept() - Copy to chapter content

- [ ] 2.3 Create VoiceService.ts
  - [ ] extract() - Analyze cards for voice
  - [ ] apply() - Transform content with voice
  - [ ] list() - Get book's voices

- [ ] 2.4 Create EmbeddingService.ts
  - [ ] embed() - Get vector from Ollama
  - [ ] storeCard() - Store card embedding
  - [ ] storeChapter() - Store chapter embedding
  - [ ] searchSimilar() - Find similar content

- [ ] 2.5 Enhance OutlineService.ts
  - [ ] Move logic from frontend outline-agent.ts
  - [ ] Use EmbeddingService for similarity

- [ ] 2.6 Enhance ClusteringService.ts
  - [ ] Move logic from frontend clustering.ts
  - [ ] Use EmbeddingService

- [ ] 2.7 **HOUSE REVIEW: Architect Agent sign-off**

### Files to Create
```
electron/book-studio-server/services/
├── HarvestService.ts
├── DraftService.ts
├── VoiceService.ts
├── EmbeddingService.ts
└── index.ts               # Service registry
```

---

## Phase 3: API Routes (Days 4-5)

### Tasks

- [ ] 3.1 Create harvest routes
  - [ ] POST /api/harvest/search
  - [ ] POST /api/harvest/commit
  - [ ] GET /api/harvest/history/:bookId
  - [ ] POST /api/harvest/iterate/:harvestId
  - [ ] GET /api/harvest/suggestions/:bookId
  - [ ] POST /api/harvest/instructions (CRUD)

- [ ] 3.2 Create draft routes
  - [ ] POST /api/draft/generate
  - [ ] GET /api/draft/versions/:chapterId
  - [ ] GET /api/draft/compare
  - [ ] POST /api/draft/accept/:versionId

- [ ] 3.3 Create voice routes
  - [ ] POST /api/voice/extract
  - [ ] GET /api/voice/:bookId
  - [ ] POST /api/voice/apply
  - [ ] DELETE /api/voice/:id

- [ ] 3.4 Create validation middleware
  - [ ] Zod schemas for all requests
  - [ ] Consistent error responses

- [ ] 3.5 Create error handling middleware
  - [ ] Catch all errors
  - [ ] Format consistent responses
  - [ ] Log errors

- [ ] 3.6 Add authentication to all new routes
- [ ] 3.7 Add rate limiting to draft generation
- [ ] 3.8 Update server.ts to mount new routes
- [ ] 3.9 **HOUSE REVIEW: Security Agent sign-off**

### Files to Create
```
electron/book-studio-server/routes/
├── harvest.ts
├── draft.ts
└── voice.ts

electron/book-studio-server/middleware/
├── validation.ts
├── error-handler.ts
└── rate-limit.ts
```

---

## Phase 4: Frontend Migration (Days 6-7)

### Tasks

- [ ] 4.1 Update api-client.ts
  - [ ] Add harvest API methods
  - [ ] Add draft API methods
  - [ ] Add voice API methods

- [ ] 4.2 Update useBookStudioApi.ts
  - [ ] Add hooks for new APIs
  - [ ] Remove direct Ollama logic

- [ ] 4.3 Update BookStudioProvider.tsx
  - [ ] Remove business logic
  - [ ] Use API for all operations

- [ ] 4.4 Update StagingView.tsx
  - [ ] Use harvest API
  - [ ] Show harvest history

- [ ] 4.5 Update OutlineView.tsx
  - [ ] Use API for outline generation
  - [ ] Remove local outline-agent usage

- [ ] 4.6 Update WritingView.tsx
  - [ ] Use draft API for generation
  - [ ] Show version history
  - [ ] Voice selection

- [ ] 4.7 Update components to use new API responses
- [ ] 4.8 **HOUSE REVIEW: Stylist Agent sign-off (UI consistency)**
- [ ] 4.9 **HOUSE REVIEW: Accessibility Agent sign-off**

### Files to Update
```
apps/web/src/lib/book-studio/
├── api-client.ts           # Add new API calls
├── useBookStudioApi.ts     # Add hooks
├── BookStudioProvider.tsx  # Remove business logic
└── types.ts                # Update types

apps/web/src/components/book-maker/views/
├── StagingView.tsx
├── OutlineView.tsx
└── WritingView.tsx
```

---

## Phase 5: Cleanup & Testing (Day 8)

### Tasks

- [ ] 5.1 Remove frontend business logic files
  - [ ] draft-generator.ts
  - [ ] outline-agent.ts (keep types, move logic)
  - [ ] clustering.ts
  - [ ] reactive-clustering.ts
  - [ ] smart-harvest-agent.ts
  - [ ] assignment-agent.ts
  - [ ] harvest-review-agent.ts

- [ ] 5.2 Remove duplicate book systems
  - [ ] electron/npe-local/services/books/
  - [ ] electron/archive-server/routes/books.ts

- [ ] 5.3 Update IPC handlers
  - [ ] Point draft:* to new API
  - [ ] Remove old book IPC handlers

- [ ] 5.4 Integration testing
  - [ ] Harvest flow end-to-end
  - [ ] Outline generation end-to-end
  - [ ] Draft generation end-to-end
  - [ ] Voice extraction and application

- [ ] 5.5 Load testing
  - [ ] Concurrent harvests
  - [ ] Large card sets
  - [ ] Multiple draft generations

- [ ] 5.6 **HOUSE REVIEW: Technical Debt Agent sign-off**
- [ ] 5.7 **HOUSE REVIEW: Full Council sign-off**

### Files to Delete
```
# After verifying new system works
apps/web/src/lib/book-studio/draft-generator.ts
apps/web/src/lib/book-studio/clustering.ts
apps/web/src/lib/book-studio/reactive-clustering.ts
apps/web/src/lib/book-studio/smart-harvest-agent.ts
apps/web/src/lib/book-studio/assignment-agent.ts
apps/web/src/lib/book-studio/harvest-review-agent.ts
apps/web/src/lib/book-studio/chekhov-local.ts
electron/npe-local/services/books/index.ts
electron/archive-server/routes/books.ts
```

---

## House Agent Review Checkpoints

| Phase | Agent | Review Focus |
|-------|-------|--------------|
| 1 | Data Agent | Schema correctness, migrations, indexes |
| 2 | Architect Agent | Service patterns, separation of concerns |
| 3 | Security Agent | Auth, validation, rate limiting |
| 4 | Stylist Agent | API response consistency, UI patterns |
| 4 | Accessibility Agent | Alt text, keyboard nav, ARIA |
| 5 | Technical Debt Agent | Cleanup completeness, no orphaned code |
| 5 | Full Council | Integration, production readiness |

---

## Success Metrics

- [ ] harvest_history has records (was empty)
- [ ] Draft generation works via API (was broken)
- [ ] sqlite-vec queries return results
- [ ] Frontend makes 0 direct Ollama calls
- [ ] Only one books.db exists
- [ ] All tests pass
- [ ] No business logic in frontend files

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Backup books.db before each migration |
| Breaking existing UI | Keep old code until new API verified |
| Performance regression | Load test before removing old code |
| Ollama unavailable | Add proper error handling, queue system |

---

## Commands

```bash
# Run migrations
npm run book-studio:migrate

# Start book-studio server with new routes
npm run book-studio:dev

# Run integration tests
npm run test:book-studio

# Full house council audit
npm run audit:council
```

---

**End of Plan**
