# Handoff: API-First Book Studio Remediation

**Date**: January 20, 2026
**Context**: Completing audit-driven architectural remediation
**Next Session Priority**: Phase 6 (E2E Test Script), then Phase 4-5

---

## Executive Summary

We discovered critical architectural issues during Book Studio E2E testing:
- Business logic (outline generation, clustering, assignment) was client-side
- 50+ hardcoded values scattered across codebase
- No complete E2E API workflow possible

We created a remediation plan and completed Phases 1-3. The server-side services are built. Next: validate with E2E test script, then update client code.

---

## Completed Phases

### Phase 1: Configuration Centralization ✅

**All hardcoded values now configurable via ConfigService**

Files Modified:
- `electron/book-studio-server/config.ts` - Expanded to 493 lines with all config types
- `electron/archive-server/services/ConfigService.ts` - Added pyramid, embeddings sections
- `electron/archive-server/routes/embeddings.ts` - Uses `harvestConfig.defaultTarget`
- `electron/archive-server/routes/pyramid.ts` - Uses config for search limits
- `electron/archive-server/services/embeddings/PyramidService.ts` - Uses config
- `electron/archive-server/middleware/rateLimit.ts` - Lazy-initialized with config
- `electron/archive-server/routes/config.ts` - Added pyramid, embeddings to valid sections
- `apps/web/src/lib/book-studio/config.ts` - Added clustering config fields
- `apps/web/src/lib/book-studio/clustering.ts` - Uses `getConfig()` for all values
- `apps/web/src/lib/book-studio/draft-generator.ts` - Uses config for similarity threshold

Config API: `GET/PUT /api/config/:section` on port 3002

### Phase 2: Outline Service (Server-Side) ✅

**Business logic moved from client to server**

Files Created:
- `electron/book-studio-server/services/OutlineService.ts` (750+ lines)
  - `researchCards()` - Extract themes, arcs, coverage analysis
  - `generateOutline()` - Create outline from research
  - `orderCardsForDraft()` - Order cards within sections
  - Creates `outline_research` table on init

- `electron/book-studio-server/routes/outline-computation.ts`
  - `POST /api/outline-compute/:bookId/research`
  - `GET /api/outline-compute/:bookId/research`
  - `POST /api/outline-compute/generate`
  - `POST /api/outline-compute/:bookId/order-cards`
  - `POST /api/outline-compute/:bookId/review`

- `apps/web/src/lib/book-studio/outline-api.ts` - Client wrapper

Files Modified:
- `electron/book-studio-server/server.ts` - Mounted outline-compute routes

### Phase 3: Clustering & Assignment Services ✅

**Clustering and card assignment now server-side**

Files Created:
- `electron/book-studio-server/services/ClusteringService.ts` (~400 lines)
  - `computeClusters()` - Keyword-based semantic clustering
  - `saveClusters()` / `getSavedClusters()`

- `electron/book-studio-server/services/AssignmentService.ts` (~300 lines)
  - `assignCardsToChapters()` - Generate proposals
  - `applyProposals()` / `applySelectedProposals()`
  - `getAssignmentStats()`

- `apps/web/src/lib/book-studio/clustering-api.ts` - Client wrapper
- `apps/web/src/lib/book-studio/assignment-api.ts` - Client wrapper

Files Modified:
- `electron/book-studio-server/routes/clusters.ts` - Added `POST /api/clusters/compute`
- `electron/book-studio-server/routes/cards.ts` - Added assignment endpoints:
  - `POST /api/cards/assign-to-chapters`
  - `POST /api/cards/apply-assignments`
  - `GET /api/cards/assignment-stats`

---

## Remaining Phases

### Phase 6: E2E Test Script (DO FIRST)

**Purpose**: Validate the entire API-first workflow works end-to-end

Create: `scripts/e2e-book-creation.sh`

```bash
#!/bin/bash
set -e

API_BASE="http://127.0.0.1:3004"
UCG_BASE="http://127.0.0.1:3002"

echo "=== E2E Book Creation Test ==="

# 1. Create book
BOOK=$(curl -s -X POST "$API_BASE/api/books" \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E API Test Book","description":"Created entirely via API"}')
BOOK_ID=$(echo $BOOK | jq -r '.book.id')
echo "Book ID: $BOOK_ID"

# 2. Search for content (UCG)
RESULTS=$(curl -s -X POST "$UCG_BASE/api/ucg/search/semantic" \
  -H "Content-Type: application/json" \
  -d '{"query":"philosophy consciousness","limit":20}')
echo "Found $(echo $RESULTS | jq '.results | length') results"

# 3. Harvest cards
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

# 4. Run research phase (NEW SERVER-SIDE)
echo "Running research..."
RESEARCH=$(curl -s -X POST "$API_BASE/api/outline-compute/$BOOK_ID/research")
THEMES=$(echo $RESEARCH | jq '.research.themes | length')
echo "Found $THEMES themes"

# 5. Compute clusters (NEW SERVER-SIDE)
echo "Computing clusters..."
CLUSTERS=$(curl -s -X POST "$API_BASE/api/clusters/compute" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\"}")
echo "Computed $(echo $CLUSTERS | jq '.result.clusters | length') clusters"

# 6. Generate outline (NEW SERVER-SIDE)
echo "Generating outline..."
OUTLINE=$(curl -s -X POST "$API_BASE/api/outline-compute/generate" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"maxSections\":5}")
SECTIONS=$(echo $OUTLINE | jq '.outline.structure.items | length')
echo "Generated $SECTIONS sections"

# 7. Create chapters from outline
echo "Creating chapters..."
for i in $(seq 0 $((SECTIONS-1))); do
  TITLE=$(echo $OUTLINE | jq -r ".outline.structure.items[$i].text")
  curl -s -X POST "$API_BASE/api/chapters" \
    -H "Content-Type: application/json" \
    -d "{\"bookId\":\"$BOOK_ID\",\"title\":\"$TITLE\",\"order\":$i}" > /dev/null
done
echo "Chapters created"

# 8. Assign cards to chapters (NEW SERVER-SIDE)
echo "Assigning cards..."
ASSIGN=$(curl -s -X POST "$API_BASE/api/cards/assign-to-chapters" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"options\":{\"autoApply\":true}}")
echo "Assigned $(echo $ASSIGN | jq '.appliedCount') cards"

# 9. Verify final state
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

**Verification Criteria**:
- [ ] Book created successfully
- [ ] Cards harvested from UCG
- [ ] Research phase returns themes and arcs
- [ ] Clusters computed and saved
- [ ] Outline generated with sections
- [ ] Chapters created from outline
- [ ] Cards assigned to chapters
- [ ] Final state shows 0 staging, N placed

### Phase 4: Update Client to Use API

**Replace local computation with API calls**

Files to Update:

1. `apps/web/src/lib/book-studio/outline-agent.ts`
   - Keep types and exports
   - Replace `researchHarvest()` body with API call to outline-api.ts
   - Replace `generateOutline()` body with API call
   - Add deprecation comments pointing to outline-api.ts

2. `apps/web/src/lib/book-studio/clustering.ts`
   - Replace `clusterCardsSemantically()` with API call to clustering-api.ts
   - Keep `quickClusterByContent()` as fallback
   - Add deprecation comments

3. `apps/web/src/lib/book-studio/assignment-agent.ts`
   - Replace `assignCardsToChapters()` with API call to assignment-api.ts
   - Remove local heuristic code
   - Add deprecation comments

4. `apps/web/src/lib/book-studio/BookStudioProvider.tsx`
   - Update harvest callback to use API
   - Update outline generation to use API

**Pattern**:
```typescript
// BEFORE (local)
export async function researchHarvest(cards: HarvestCard[]): Promise<OutlineResearch> {
  // ... 50 lines of local computation
}

// AFTER (API)
export async function researchHarvest(bookId: string): Promise<OutlineResearch> {
  return runResearch(bookId) // from outline-api.ts
}
```

### Phase 5: Database Schema Updates

**Mostly done - outline_research table created by OutlineService**

Still needed:
1. Add card_orders table for draft generation ordering:
```sql
CREATE TABLE IF NOT EXISTS card_orders (
  id TEXT PRIMARY KEY,
  outline_id TEXT NOT NULL,
  section_index INTEGER,
  card_id TEXT NOT NULL,
  position INTEGER,
  created_at INTEGER
);
```

2. Migration to add to `database.ts` MIGRATIONS array

---

## New API Endpoints Summary

### Book Studio Server (Port 3004)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/outline-compute/:bookId/research` | POST | Run research phase |
| `/api/outline-compute/:bookId/research` | GET | Get cached research |
| `/api/outline-compute/generate` | POST | Generate outline |
| `/api/outline-compute/:bookId/order-cards` | POST | Order cards for draft |
| `/api/outline-compute/:bookId/review` | POST | Review outline quality |
| `/api/clusters/compute` | POST | Compute semantic clusters |
| `/api/cards/assign-to-chapters` | POST | Generate assignment proposals |
| `/api/cards/apply-assignments` | POST | Apply selected assignments |
| `/api/cards/assignment-stats` | GET | Get assignment statistics |

### Archive Server (Port 3002)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/config` | GET | Get all configuration |
| `/api/config/:section` | GET/PUT | Get/update section |
| `/api/config/reset` | POST | Reset to defaults |

---

## Key Files Reference

### Server Services (Business Logic)
- `electron/book-studio-server/services/OutlineService.ts`
- `electron/book-studio-server/services/ClusteringService.ts`
- `electron/book-studio-server/services/AssignmentService.ts`
- `electron/archive-server/services/ConfigService.ts`

### Client API Wrappers
- `apps/web/src/lib/book-studio/outline-api.ts`
- `apps/web/src/lib/book-studio/clustering-api.ts`
- `apps/web/src/lib/book-studio/assignment-api.ts`

### Configuration
- `electron/book-studio-server/config.ts` - Book Studio config
- `electron/archive-server/services/ConfigService.ts` - Archive config
- `apps/web/src/lib/book-studio/config.ts` - Frontend config

### Audit Documents
- `docs/AUDIT_JAN20_BOOK_STUDIO_ARCHITECTURE.md`
- `docs/PLAN_JAN20_API_FIRST_BOOK_STUDIO.md`

---

## Testing Commands

```bash
# Start servers
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test health
curl http://127.0.0.1:3004/api/health
curl http://127.0.0.1:3002/api/health

# Test outline research
curl -X POST http://127.0.0.1:3004/api/outline-compute/BOOK_ID/research

# Test clustering
curl -X POST http://127.0.0.1:3004/api/clusters/compute \
  -H "Content-Type: application/json" \
  -d '{"bookId":"BOOK_ID"}'

# Test assignment
curl -X POST http://127.0.0.1:3004/api/cards/assign-to-chapters \
  -H "Content-Type: application/json" \
  -d '{"bookId":"BOOK_ID","options":{"autoApply":true}}'
```

---

## Priority Order for Next Session

1. **Phase 6**: Create and run E2E test script to validate all services work together
2. **Phase 4**: Update client code to use new API wrappers (deprecate local computation)
3. **Phase 5**: Add card_orders table migration if needed for draft generation

---

**Document Status**: Ready for continuation
**Author**: Claude (Architect Agent)
