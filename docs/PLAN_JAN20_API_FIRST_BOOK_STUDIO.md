# Plan: API-First Book Studio Remediation

**Date**: January 20, 2026
**Status**: Awaiting Approval
**Estimated Effort**: 13-16 days

---

## Objective

Transform Book Studio from a GUI-dependent application to a fully API-driven system where:
1. ALL business logic runs server-side
2. ALL configuration is centralized and tunable
3. Complete books can be created via API without GUI
4. Single source of truth for embeddings

---

## Phase 1: Configuration Centralization

### 1.1 Create Server Config Defaults

**File:** `electron/book-studio-server/config/defaults.ts`

```typescript
/**
 * Book Studio Server Configuration Defaults
 *
 * ALL numeric literals MUST be defined here.
 * NO magic numbers in route handlers or services.
 */

export const DEFAULTS = {
  // Search & Retrieval
  search: {
    defaultLimit: 20,
    maxLimit: 1000,
    semanticLimit: 100,
    minSimilarity: 0.3,
    defaultSimilarity: 0.55,
    highSimilarity: 0.85,
  },

  // Clustering
  clustering: {
    minClusterSize: 2,
    maxClusters: 10,
    similarityThreshold: 0.55,
    jaccardThreshold: 0.15,
    searchLimit: 30,
  },

  // Outline Generation
  outline: {
    minThemes: 3,
    maxThemes: 10,
    maxSections: 10,
    minRelevance: 0.2,
    themeRelevanceThreshold: 0.3,
    minCardsPerTheme: 2,
    topKeywordsPerTheme: 5,
  },

  // Card Review
  grading: {
    minWordsForAnalysis: 50,
    maxSuggestions: 5,
    batchSize: 32,
  },

  // Assignment
  assignment: {
    minConfidence: 0.3,
    maxAlternatives: 3,
  },

  // Pyramid
  pyramid: {
    chunksPerSummary: 5,
    targetSummaryWords: 150,
    targetApexWords: 300,
  },

  // Harvesting
  harvest: {
    defaultTarget: 20,
    maxResults: 100,
    minWordCount: 20,
    diversityThreshold: 0.7,
    discoveryRadius: 0.4,
    dedupeThreshold: 0.9,
  },

  // Embeddings
  embeddings: {
    dimensions: 768,
    batchSize: 32,
    maxChunkChars: 4000,
    targetChunkChars: 2000,
    minChunkChars: 200,
  },

  // Rate Limiting
  rateLimit: {
    searchMaxRequests: 120,
    searchWindowMs: 60000,
    importMaxRequests: 10,
    importWindowMs: 300000,
  },
} as const

export type BookStudioConfig = typeof DEFAULTS
```

### 1.2 Update Route Handlers

**Pattern to apply in ALL route files:**

```typescript
// BEFORE (bad)
const limit = parseInt(req.query.limit as string) || 20

// AFTER (good)
import { getConfig } from '../config'
const config = getConfig()
const limit = parseInt(req.query.limit as string) || config.search.defaultLimit
```

**Files to update:**
- [ ] `routes/embeddings.ts` - Lines 345, 380, 408, 460, 514
- [ ] `routes/pyramid.ts` - Line 192
- [ ] `routes/cards.ts` - All limit defaults
- [ ] `routes/clusters.ts` - All limit defaults

### 1.3 Fix Hardcoded Values in Services

**Files to update:**
- [ ] `services/embeddings/EmbeddingGenerator.ts:141` - Use config.embeddings.batchSize
- [ ] `services/embeddings/PyramidService.ts:106-108` - Use config.pyramid.*
- [ ] `services/embeddings/ArchiveIndexer.ts:57` - Use config.embeddings.batchSize
- [ ] `services/content-graph/ChunkingService.ts:14-16` - Use config.embeddings.*

---

## Phase 2: Outline Service (Server-Side)

### 2.1 Create OutlineService

**File:** `electron/book-studio-server/services/OutlineService.ts`

```typescript
/**
 * OutlineService - Server-side outline generation
 *
 * Moved from: apps/web/src/lib/book-studio/outline-agent.ts
 *
 * All business logic for outline research, theme extraction,
 * arc detection, and outline generation runs here.
 */

import { getDatabase } from '../database'
import { getConfig } from '../config'
import type {
  HarvestCard,
  OutlineResearch,
  ExtractedTheme,
  NarrativeArc,
  CoverageAnalysis,
  OutlineStructure,
  SuggestedSection
} from './types'

export class OutlineService {
  private db: ReturnType<typeof getDatabase>
  private config: ReturnType<typeof getConfig>

  constructor() {
    this.db = getDatabase()
    this.config = getConfig()
  }

  /**
   * Run complete research phase on book's staging cards
   */
  async researchCards(bookId: string): Promise<OutlineResearch> {
    // Get all staging cards
    const cards = this.getBookCards(bookId, 'staging')

    // Extract themes
    const themes = await this.extractThemes(cards)

    // Detect narrative arcs
    const arcs = await this.detectNarrativeArcs(cards)

    // Map sources to themes
    const sourceMappings = this.mapSourcesToThemes(cards, themes)

    // Analyze coverage
    const { gaps, strongAreas } = this.analyzeCoverage(themes, arcs)

    // Suggest sections
    const suggestedSections = this.suggestSections(themes, cards)

    const research: OutlineResearch = {
      themes,
      arcs,
      sourceMappings,
      coverageGaps: gaps,
      strongAreas,
      suggestedSections,
      totalCards: cards.length,
      analyzedAt: new Date().toISOString(),
      confidence: this.calculateConfidence(themes, arcs),
    }

    // Persist research results
    await this.saveResearch(bookId, research)

    return research
  }

  /**
   * Extract themes from cards using keyword analysis
   */
  async extractThemes(cards: HarvestCard[]): Promise<ExtractedTheme[]> {
    const config = this.config.outline
    // ... move logic from outline-agent.ts lines 220-314
  }

  /**
   * Detect narrative arcs using Chekhov analysis
   */
  async detectNarrativeArcs(cards: HarvestCard[]): Promise<NarrativeArc[]> {
    // ... move logic from outline-agent.ts lines 323-442
  }

  /**
   * Generate outline structure from research
   */
  async generateOutline(
    bookId: string,
    options: { maxSections?: number; preferArcStructure?: boolean }
  ): Promise<OutlineStructure> {
    const config = this.config.outline
    const maxSections = options.maxSections || config.maxSections

    // Get cached research or run fresh
    const research = await this.getOrCreateResearch(bookId)

    // ... move logic from outline-agent.ts lines 1315-1373
  }

  /**
   * Order cards for draft generation within each section
   */
  async orderCardsForDraft(outlineId: string): Promise<CardOrder[]> {
    // ... move logic from outline-agent.ts lines 1390-1453
  }

  // ... additional private helper methods
}
```

### 2.2 Create Outline Computation Routes

**File:** `electron/book-studio-server/routes/outline-computation.ts`

```typescript
import { Router, Request, Response } from 'express'
import { OutlineService } from '../services/OutlineService'
import { requireAuth, getUserId } from '../middleware/auth'

export function createOutlineComputationRouter(): Router {
  const router = Router()
  router.use(requireAuth())

  const outlineService = new OutlineService()

  /**
   * POST /api/outlines/:bookId/research
   * Run research phase on book's staging cards
   */
  router.post('/:bookId/research', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params
      const research = await outlineService.researchCards(bookId)
      res.json({ research })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /**
   * GET /api/outlines/:bookId/research
   * Get cached research (if exists)
   */
  router.get('/:bookId/research', async (req: Request, res: Response) => {
    try {
      const { bookId } = req.params
      const research = await outlineService.getCachedResearch(bookId)
      if (!research) {
        return res.status(404).json({ error: 'No research found. Run POST first.' })
      }
      res.json({ research })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /**
   * POST /api/outlines/generate
   * Generate outline from research
   */
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const { bookId, maxSections, preferArcStructure } = req.body
      if (!bookId) {
        return res.status(400).json({ error: 'bookId required' })
      }

      const outline = await outlineService.generateOutline(bookId, {
        maxSections,
        preferArcStructure,
      })

      res.json({ outline })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /**
   * POST /api/outlines/:id/review
   * Review outline coverage and quality
   */
  router.post('/:id/review', async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const review = await outlineService.reviewOutline(id)
      res.json({ review })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  /**
   * POST /api/outlines/:id/order-cards
   * Order cards within sections for draft generation
   */
  router.post('/:id/order-cards', async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const cardOrder = await outlineService.orderCardsForDraft(id)
      res.json({ cardOrder })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  return router
}
```

### 2.3 Update Server Entry Point

**File:** `electron/book-studio-server/server.ts`

```typescript
// Add import
import { createOutlineComputationRouter } from './routes/outline-computation'

// Add route mounting (after existing outline routes)
app.use('/api/outlines', createOutlineComputationRouter())
```

---

## Phase 3: Clustering & Assignment Services

### 3.1 Create ClusteringService

**File:** `electron/book-studio-server/services/ClusteringService.ts`

Move logic from `apps/web/src/lib/book-studio/clustering.ts`:
- `clusterCardsSemantically()`
- `generateThemeLabel()`
- `quickClusterByContent()`

### 3.2 Create AssignmentService

**File:** `electron/book-studio-server/services/AssignmentService.ts`

Move logic from `apps/web/src/lib/book-studio/assignment-agent.ts`:
- `assignCardsToChaptersLocal()` → `assignCardsToChapters()`
- `calculateRelevance()`

### 3.3 Add Routes

**New endpoints:**
- `POST /api/clusters/compute` - Compute clusters from cards
- `POST /api/cards/assign-to-chapters` - Semantic batch assignment

---

## Phase 4: Update Client to Use API

### 4.1 Update outline-agent.ts

**Before:**
```typescript
export async function researchHarvest(cards: HarvestCard[]): Promise<OutlineResearch> {
  // ... 50 lines of local computation
}
```

**After:**
```typescript
export async function researchHarvest(bookId: string): Promise<OutlineResearch> {
  const response = await fetch(`${API_BASE}/api/outlines/${bookId}/research`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
  if (!response.ok) throw new Error('Research failed')
  const { research } = await response.json()
  return research
}
```

### 4.2 Update clustering.ts

Replace local computation with API calls to `/api/clusters/compute`

### 4.3 Update assignment-agent.ts

Replace local heuristics with API calls to `/api/cards/assign-to-chapters`

---

## Phase 5: Database Schema Updates

### 5.1 Add Research Cache Table

```sql
CREATE TABLE IF NOT EXISTS outline_research (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id),
  themes TEXT,           -- JSON
  arcs TEXT,             -- JSON
  source_mappings TEXT,  -- JSON
  coverage_gaps TEXT,    -- JSON
  strong_areas TEXT,     -- JSON
  suggested_sections TEXT, -- JSON
  total_cards INTEGER,
  confidence REAL,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(book_id)
)
```

### 5.2 Add Card Order Table

```sql
CREATE TABLE IF NOT EXISTS card_orders (
  id TEXT PRIMARY KEY,
  outline_id TEXT NOT NULL REFERENCES outlines(id),
  section_index INTEGER,
  card_id TEXT NOT NULL REFERENCES cards(id),
  position INTEGER,
  created_at INTEGER
)
```

---

## Phase 6: E2E Test Script

**File:** `scripts/e2e-book-creation.sh`

```bash
#!/bin/bash
set -e

API_BASE="http://localhost:3004"
UCG_BASE="http://localhost:3002"

echo "=== E2E Book Creation Test ==="

# 1. Create book
echo "Creating book..."
BOOK=$(curl -s -X POST "$API_BASE/api/books" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E API Test Book","description":"Created entirely via API"}')
BOOK_ID=$(echo $BOOK | jq -r '.book.id')
echo "Book ID: $BOOK_ID"

# 2. Search for content
echo "Searching archive..."
RESULTS=$(curl -s -X POST "$UCG_BASE/api/ucg/search/semantic" \
  -H "Content-Type: application/json" \
  -d '{"query":"philosophy consciousness","limit":20}')
echo "Found $(echo $RESULTS | jq '.results | length') results"

# 3. Harvest cards
echo "Harvesting cards..."
CARDS=$(echo $RESULTS | jq '[.results[] | {
  sourceId: .node.id,
  sourceType: "ucg",
  source: "archive",
  content: .node.content.text,
  similarity: .similarity
}]')
curl -s -X POST "$API_BASE/api/cards/batch" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"cards\":$CARDS}" > /dev/null
echo "Cards harvested"

# 4. Run research phase (NEW)
echo "Running research..."
RESEARCH=$(curl -s -X POST "$API_BASE/api/outlines/$BOOK_ID/research")
THEMES=$(echo $RESEARCH | jq '.research.themes | length')
echo "Found $THEMES themes"

# 5. Generate outline (NEW)
echo "Generating outline..."
OUTLINE=$(curl -s -X POST "$API_BASE/api/outlines/generate" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"maxSections\":5}")
SECTIONS=$(echo $OUTLINE | jq '.outline.structure.items | length')
echo "Generated $SECTIONS sections"

# 6. Create chapters from outline
echo "Creating chapters..."
for i in $(seq 0 $((SECTIONS-1))); do
  TITLE=$(echo $OUTLINE | jq -r ".outline.structure.items[$i].text")
  curl -s -X POST "$API_BASE/api/chapters" \
    -H "Content-Type: application/json" \
    -d "{\"bookId\":\"$BOOK_ID\",\"title\":\"$TITLE\",\"order\":$i}" > /dev/null
done
echo "Chapters created"

# 7. Assign cards to chapters (NEW)
echo "Assigning cards..."
curl -s -X POST "$API_BASE/api/cards/assign-to-chapters" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\"}" > /dev/null

# 8. Verify final state
echo ""
echo "=== Final Book State ==="
curl -s "$API_BASE/api/books/$BOOK_ID" | jq '{
  title: .book.title,
  chapters: (.chapters | length),
  staging: .cardCounts.staging,
  placed: .cardCounts.placed
}'

echo ""
echo "=== E2E Test Complete ==="
```

---

## Verification Checklist

### Phase 1
- [ ] All routes use config for limits
- [ ] No hardcoded numbers in route handlers
- [ ] Config defaults match current behavior

### Phase 2
- [ ] `POST /api/outlines/:bookId/research` works
- [ ] `POST /api/outlines/generate` works
- [ ] Research results persisted to database
- [ ] Client calls API instead of local functions

### Phase 3
- [ ] `POST /api/clusters/compute` works
- [ ] `POST /api/cards/assign-to-chapters` works

### Phase 4
- [ ] No business logic remains in client
- [ ] All client functions are API wrappers

### Phase 5
- [ ] Database migrations run cleanly
- [ ] Research cache table created
- [ ] Card order table created

### Phase 6
- [ ] E2E script runs without errors
- [ ] Complete book created via API only
- [ ] All cards assigned to chapters

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing users | Keep client fallback during migration |
| Performance regression | Add caching for research results |
| Database migration failure | Create rollback scripts |
| API versioning | Use `/api/v1/` prefix for new endpoints |

---

## Timeline

| Week | Phase | Deliverable |
|------|-------|-------------|
| 1 | Phase 1 | Config centralization complete |
| 1-2 | Phase 2 | OutlineService + routes |
| 2 | Phase 3 | Clustering + Assignment services |
| 2-3 | Phase 4 | Client refactoring |
| 3 | Phase 5 | Database migrations |
| 3 | Phase 6 | E2E testing |

**Total: 3 weeks**

---

**Document Status:** Ready for Review
**Author:** Claude (Architect Agent)
**Approver:** TBD
