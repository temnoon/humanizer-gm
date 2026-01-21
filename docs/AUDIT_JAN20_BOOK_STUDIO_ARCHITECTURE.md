# House Council Audit: Book Studio Architecture
**Date**: January 20, 2026
**Severity**: CRITICAL (Production-Blocking)
**Auditors**: Architect Agent, Data Agent, Security Agent

---

## Executive Summary

The Book Studio component has **critical architectural violations** that prevent production deployment:

1. **Business logic on client-side** - Outline generation, clustering, card review, and assignment logic are implemented entirely in the frontend
2. **Hard-coded configuration values** - 50+ magic numbers scattered across codebase
3. **Incomplete API coverage** - 8 core business functions have no server endpoints
4. **Dual embedding systems** - Two separate embedding databases causing confusion
5. **No E2E API workflow possible** - Cannot create a complete book without GUI

---

## Critical Findings

### 1. CLIENT-SIDE BUSINESS LOGIC (Architecture Violation)

**AFFECTED FILES:**

| File | Functions | Lines | Severity |
|------|-----------|-------|----------|
| `apps/web/src/lib/book-studio/outline-agent.ts` | 9 major functions | 1453 | **CRITICAL** |
| `apps/web/src/lib/book-studio/card-review-service.ts` | 6 functions | 339 | **HIGH** |
| `apps/web/src/lib/book-studio/clustering.ts` | 3 functions | 329 | **HIGH** |
| `apps/web/src/lib/book-studio/assignment-agent.ts` | 3 functions | 230 | **HIGH** |

**OUTLINE-AGENT.TS (1453 lines of client-side business logic):**

```
extractThemes()           - Lines 220-314   - Theme extraction from cards
detectNarrativeArcs()     - Lines 323-442   - Chekhov analysis for arcs
mapSourcesToThemes()      - Lines 452-512   - Card-to-theme mapping
analyzeCoverage()         - Lines 521-603   - Gap analysis
suggestSections()         - Lines 613-694   - Section generation
researchHarvest()         - Lines 713-768   - Main research aggregation
reviewOutline()           - Lines 1074-1131 - Outline coverage evaluation
generateOutline()         - Lines 1315-1373 - Final outline creation
orderCardsForOutline()    - Lines 1390-1453 - Card ordering for drafts
```

**IMPACT:** All book outline logic runs in the browser. No server-side persistence of research phases. Results cannot be shared between sessions or users. No audit trail.

---

### 2. MISSING API ENDPOINTS

**Server has only CRUD endpoints** (list/get/create/delete) for outlines. No computation endpoints exist.

| Required Endpoint | Purpose | Current State |
|-------------------|---------|---------------|
| `POST /api/outlines/research` | Run research phase on cards | **MISSING** |
| `POST /api/outlines/extract-themes` | Extract themes from cards | **MISSING** |
| `POST /api/outlines/detect-arcs` | Detect narrative arcs | **MISSING** |
| `POST /api/outlines/analyze-coverage` | Analyze coverage gaps | **MISSING** |
| `POST /api/outlines/suggest-sections` | Generate section suggestions | **MISSING** |
| `POST /api/outlines/generate` | Generate complete outline | **MISSING** |
| `POST /api/outlines/:id/review` | Review outline quality | **MISSING** |
| `POST /api/cards/assign-to-chapters` | Batch assign cards semantically | **MISSING** |
| `POST /api/clusters/compute` | Compute semantic clusters | **MISSING** |
| `POST /api/cards/batch-review` | Batch review/grade cards | **MISSING** |

---

### 3. HARD-CODED VALUES (Configuration Fragmentation)

**TOTAL FOUND: 50+ magic numbers requiring configuration**

**Search Limits (should be configurable):**

| File | Line | Value | Purpose |
|------|------|-------|---------|
| `routes/embeddings.ts` | 345 | `20` | Default semantic search limit |
| `routes/embeddings.ts` | 380 | `10` | Default similar search limit |
| `routes/embeddings.ts` | 408 | `20` | Default chunk search limit |
| `routes/embeddings.ts` | 460 | `20` | Default filtered search limit |
| `routes/embeddings.ts` | 514 | `20` | Default unified search limit |
| `routes/pyramid.ts` | 192 | `20` | Default pyramid search limit |
| `harvester.ts` | 82 | `20` | Default harvest limit |
| `harvester.ts` | 193 | `20` | Harvest query limit |
| `clustering.ts` | 65 | `30` | Clustering search limit |
| `harvest-buckets.ts` | 58 | `50` | Max harvest results |

**Batch Sizes (duplicated across files):**

| Value | Files Using It |
|-------|----------------|
| `32` | EmbeddingGenerator:141, ArchiveIndexer:57, embeddings.ts:88, types.ts:257 |
| `100` | DatabaseImporter:37, ConfigService:77 |

**Thresholds (scattered, no central reference):**

| File | Line | Value | Purpose |
|------|------|-------|---------|
| `clustering.ts` | 31 | `0.55` | Similarity threshold |
| `clustering.ts` | 300 | `0.15` | Jaccard threshold |
| `harvester.ts` | 83 | `0.5` | Min relevance |
| `harvester.ts` | 84 | `0.7` | Diversity threshold |
| `harvester.ts` | 85 | `0.4` | Discovery radius |
| `harvest-buckets.ts` | 57 | `0.65` | Min similarity |
| `harvest-buckets.ts` | 69 | `0.9` | Dedupe threshold |
| `draft-generator.ts` | 68 | `0.85` | Dedupe threshold (HARDCODED, ignores config!) |
| `outline-agent.ts` | 481 | `0.2` | Min relevance for matching |
| `outline-agent.ts` | 875 | `0.3` | Min theme relevance |
| `assignment-agent.ts` | 86 | `0.3` | Min confidence |

**Pyramid Settings (hardcoded, should be in ConfigService):**

| File | Line | Value | Purpose |
|------|------|-------|---------|
| `PyramidService.ts` | 106 | `5` | Chunks per summary |
| `PyramidService.ts` | 107 | `150` | Target summary words |
| `PyramidService.ts` | 108 | `300` | Target apex words |

---

### 4. DUAL EMBEDDING SYSTEMS

**System 1: Archive Embeddings (port 3002)**
- Database: `/Users/tem/openai-export-parser/output_v13_final/humanizer.db`
- Stats: 36,255 messages with embeddings
- Routes: `/api/embeddings/*`

**System 2: UCG Content Graph (port 3002)**
- Database: Separate tables in same SQLite
- Stats: 77,994 node embeddings, 108,060 total nodes
- Routes: `/api/ucg/*`

**CONFUSION:**
- Same port, different endpoints
- Different embedding counts (36K vs 77K)
- Clustering service uses Archive embeddings, not UCG
- No clear documentation on when to use which

---

### 5. CONFIGURATION SYSTEMS

**Two separate config systems exist:**

1. **Client Config** (`apps/web/src/lib/book-studio/config.ts`)
   - Lines 16-250: Schema with defaults
   - Three-layer: schema → file → user → programmatic
   - Good centralization for client values

2. **Server Config** (`electron/archive-server/services/ConfigService.ts`)
   - Lines 76-106: Server operational settings
   - Separate from client config
   - No sync mechanism

**PROBLEM:** `draft-generator.ts:68` hardcodes `0.85` instead of reading from either config system.

---

## House Agent Reports

### Architect Agent Assessment

**VERDICT: FAIL - Cannot ship to production**

The architecture violates fundamental separation of concerns:
- Business logic runs client-side where it cannot be audited, versioned, or shared
- No API-first design - GUI is required to create books
- Impossible to build automation, testing, or batch processing

**VIOLATIONS:**
1. Implementation-First Protocol violated - duplicate logic exists in client and server
2. No single source of truth for configuration
3. Missing server-side services for 8 core functions

### Data Agent Assessment

**VERDICT: FAIL - Data integrity at risk**

1. Outline research results are transient - lost on page refresh
2. Theme extraction has no persistence layer
3. Card assignments computed locally, not tracked
4. Two embedding databases with no migration path

### Security Agent Assessment

**VERDICT: WARNING - Not blocking but concerning**

1. Client-side business logic exposes algorithms
2. Hard-coded limits could be exploited
3. No rate limiting on clustering/outline operations
4. Auth token stored in localStorage (acceptable but noted)

---

## Remediation Plan

### Phase 1: Configuration Centralization (1-2 days)

**Goal:** All literals in config files, not code

1. Create `electron/book-studio-server/config/defaults.ts`:
```typescript
export const BOOK_STUDIO_DEFAULTS = {
  search: {
    defaultLimit: 20,
    maxLimit: 1000,
    similarityThreshold: 0.55,
  },
  clustering: {
    minClusterSize: 2,
    maxClusters: 10,
    similarityThreshold: 0.55,
  },
  outline: {
    minThemes: 3,
    maxSections: 10,
    minRelevance: 0.2,
  },
  grading: {
    batchSize: 32,
    minWordsForAnalysis: 50,
  },
  pyramid: {
    chunksPerSummary: 5,
    targetSummaryWords: 150,
    targetApexWords: 300,
  }
}
```

2. Update `routes/embeddings.ts` to use config for all limits
3. Update `outline-agent.ts` to read config via API
4. Fix `draft-generator.ts:68` to use config

### Phase 2: API-First Outline Pipeline (3-5 days)

**Goal:** Complete outline workflow via API

**New File:** `electron/book-studio-server/services/OutlineService.ts`

```typescript
export class OutlineService {
  // Move ALL logic from outline-agent.ts here
  async researchCards(bookId: string): Promise<OutlineResearch>
  async extractThemes(cardIds: string[]): Promise<ExtractedTheme[]>
  async detectNarrativeArcs(cardIds: string[]): Promise<NarrativeArc[]>
  async analyzeCoverage(bookId: string): Promise<CoverageAnalysis>
  async generateOutline(bookId: string, options: OutlineOptions): Promise<OutlineStructure>
  async orderCardsForDraft(outlineId: string): Promise<CardOrder[]>
}
```

**New Routes:** `electron/book-studio-server/routes/outline-computation.ts`

```typescript
// Research phase
router.post('/api/outlines/:bookId/research', ...)
router.get('/api/outlines/:bookId/research', ...)  // Get cached research

// Generation
router.post('/api/outlines/generate', ...)
router.post('/api/outlines/:id/review', ...)

// Card ordering
router.post('/api/outlines/:id/order-cards', ...)
```

### Phase 3: Server-Side Clustering & Assignment (2-3 days)

**New File:** `electron/book-studio-server/services/ClusteringService.ts`

Move `clustering.ts` logic to server with endpoints:
- `POST /api/clusters/compute` - Compute clusters from cards
- `POST /api/cards/assign-to-chapters` - Semantic assignment

### Phase 4: Unified Embedding System (2-3 days)

**Decision Required:** Use UCG embeddings as single source

1. Migrate archive embeddings to UCG content graph
2. Deprecate `/api/embeddings/*` routes
3. All searches via `/api/ucg/search/*`

### Phase 5: E2E API Workflow Test (1 day)

**Test Script:** `scripts/e2e-book-creation.sh`

```bash
#!/bin/bash
# Complete book creation without GUI

# 1. Create book
BOOK_ID=$(curl -X POST /api/books -d '{"title":"Test"}' | jq -r '.book.id')

# 2. Search and harvest
curl -X POST /api/ucg/search/semantic -d '{"query":"philosophy"}' > results.json
curl -X POST /api/cards/batch -d "{\"bookId\":\"$BOOK_ID\",\"cards\":...}"

# 3. Research phase (NEW ENDPOINT)
curl -X POST /api/outlines/$BOOK_ID/research

# 4. Generate outline (NEW ENDPOINT)
curl -X POST /api/outlines/generate -d "{\"bookId\":\"$BOOK_ID\"}"

# 5. Create chapters from outline
curl -X POST /api/chapters/batch

# 6. Assign cards to chapters (NEW ENDPOINT)
curl -X POST /api/cards/assign-to-chapters

# 7. Verify
curl /api/books/$BOOK_ID | jq '.cardCounts'
```

---

## Priority Matrix

| Task | Effort | Impact | Priority |
|------|--------|--------|----------|
| Fix hardcoded limits | 1 day | HIGH | P0 |
| Create OutlineService | 3 days | CRITICAL | P0 |
| Add outline API routes | 2 days | CRITICAL | P0 |
| Server-side clustering | 2 days | HIGH | P1 |
| Server-side assignment | 1 day | HIGH | P1 |
| Unify embedding systems | 3 days | MEDIUM | P2 |
| E2E test script | 1 day | HIGH | P1 |

**Total Estimated Effort: 13-16 days**

---

## Acceptance Criteria

1. [ ] All 50+ hardcoded values moved to config files
2. [ ] `POST /api/outlines/research` endpoint works
3. [ ] `POST /api/outlines/generate` endpoint works
4. [ ] `POST /api/clusters/compute` endpoint works
5. [ ] `POST /api/cards/assign-to-chapters` endpoint works
6. [ ] E2E script creates complete book via API only
7. [ ] No client-side business logic remains
8. [ ] Single embedding system documented

---

## Sign-off Required

- [ ] Architect Agent: Architecture review
- [ ] Data Agent: Schema changes approved
- [ ] Security Agent: Auth/rate limiting review
- [ ] Product: Workflow validation

**Document Version:** 1.0
**Last Updated:** January 20, 2026
