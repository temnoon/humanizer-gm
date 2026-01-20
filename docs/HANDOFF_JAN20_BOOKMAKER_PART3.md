# Book Maker Critical Issues - Handoff Part 3

**Date**: January 20, 2026
**Status**: BLOCKED - Architectural Issues Require Resolution
**Previous Handoffs**: `HANDOFF_JAN20_BOOKMAKER_PART2.md`, `HANDOFF_JAN20_BOOKMAKER_ENHANCEMENTS.md`

---

## CRITICAL ARCHITECTURAL ISSUES

### 1. Hardcoded Configuration Values (ANTI-PATTERN)

**Problem**: Literal values scattered throughout code files instead of centralized configuration.

**Examples Found**:
| File | Line | Hardcoded Value | Should Be |
|------|------|-----------------|-----------|
| `smart-harvest-agent.ts` | 70 | `target: 20` | Config: `harvest.defaultTarget` |
| `smart-harvest-agent.ts` | 71 | `searchLimit: 100` | Config: `harvest.searchLimit` |
| `smart-harvest-agent.ts` | 72 | `minWordCount: 20` | Config: `harvest.minWordCount` |
| `HarvestView.tsx` | 123 | `harvestTarget = 20` | Config: `harvest.defaultTarget` |
| `rateLimit.ts` | 116 | `maxRequests: 120` | Config: `rateLimit.search` |
| `archive-reader/index.ts` | 108 | `HEALTH_CACHE_TTL = 30 * 1000` | Config: `cache.healthTtl` |

**Required Fix**:
- Create centralized `ConfigurationManager` service
- Admin interface to adjust all configurable values
- No literal values in code files except true constants

---

### 2. Content Embedding System BROKEN

**Root Cause**: UCG content items (Facebook posts, etc.) have NO embeddings.

**Evidence**:
```bash
# API returns 47,416 content items with embedding: null
curl -s "http://localhost:3002/api/content/items?limit=1" | jq '.items[0].embedding'
# Returns: null

# Message embeddings work (36,255 items)
curl -s "http://localhost:3002/api/embeddings/stats"
# Returns: {"totalMessages":36255,"totalChunks":0}
```

**Symptoms**:
- Unified search returns Facebook posts with `similarity: 1` (fake value)
- `distance: 0` because no vector comparison possible
- Messages get pushed out of results by fake high-similarity content
- Harvest returns "No results" when content items dominate

**Required Fix**:
- Implement three-level embedding pipeline:
  1. **Sentence-level**: Individual meaningful sentences
  2. **Paragraph-level**: Coherent thought units
  3. **Document-level**: Full content summaries
- Run embedding generation for ALL content types uniformly
- Track embedding status per content item

---

### 3. Grading System Not Integrated

**Current State**:
- `quickGradeCard()` exists in `harvest-review-agent.ts`
- Grades ARE being saved with cards (verified via API)
- BUT: Grading only happens during harvest, not retroactively

**Missing**:
- Background grading queue for existing cards
- Full grading with SIC (Subjective-Intentional Constraint) analysis
- Grade persistence verification across sessions
- Grade display in all views (not just staging)

**5 Grading Categories** (from `types.ts`):
1. `authenticity` - Human voice vs AI-generated (1-5)
2. `necessity` - Narrative importance/Chekhov analysis (1-5)
3. `inflection` - Turning points, modality shifts (1-5)
4. `voice` - Style coherence with author (1-5)
5. `overall` - Weighted composite

---

## FIXES APPLIED THIS SESSION (Partial/Workarounds)

| Fix | Status | Quality |
|-----|--------|---------|
| Book creation timestamp error | ✅ Fixed | Good - proper null guard |
| API response unwrapping | ✅ Fixed | Good - matches server format |
| Archive-reader URL (404) | ✅ Fixed | Good - dynamic URL |
| Rate limit increased | ⚠️ Workaround | Bad - hardcoded value |
| Health check caching | ⚠️ Workaround | Bad - hardcoded TTL |
| Auto-commit harvest | ✅ Fixed | Good - prevents lost cards |
| Conversation prioritization | ⚠️ Workaround | Bad - doesn't fix root cause |
| hasInteracted flag | ✅ Fixed | Good - prevents mount spam |

---

## API ENDPOINTS STATUS

### Book Studio Server (Port 3004)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/books` | ✅ Works | Returns `{ book: ... }` |
| `GET /api/books` | ✅ Works | |
| `DELETE /api/books/:id` | ✅ Works | |
| `POST /api/cards` | ✅ Works | Requires `sourceId` |
| `POST /api/cards/:id/move` | ✅ Works | |
| `POST /api/chapters` | ✅ Works | |
| `GET /api/cards?bookId=` | ✅ Works | |

### Archive Server (Port 3002)
| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /api/embeddings/search/messages` | ✅ Works | Returns real similarity |
| `POST /api/embeddings/search/unified` | ❌ BROKEN | Content items have fake similarity |
| `GET /api/embeddings/health` | ✅ Works | |
| `GET /api/content/items` | ✅ Works | But items lack embeddings |

---

## FILES MODIFIED THIS SESSION

### Good Fixes
- `/apps/web/src/lib/book-studio/api-client.ts` - Response unwrapping, timestamp guards
- `/apps/web/src/lib/archive-reader/index.ts` - Dynamic URL, health caching
- `/apps/web/src/lib/book-studio/BookStudioProvider.tsx` - Auto-commit harvest
- `/apps/web/src/components/book-maker/views/HarvestView.tsx` - hasInteracted, UI improvements

### Workarounds (Need Proper Config System)
- `/electron/archive-server/middleware/rateLimit.ts` - Rate limit values
- `/apps/web/src/lib/book-studio/smart-harvest-agent.ts` - Harvest config values

---

## HOUSE AGENT REPORTS NOT ADDRESSED

### From CLAUDE.md
1. **architect-agent**: Pattern violations - implementation-first protocol not followed
2. **data-agent**: Schemas, API contracts - content items missing embeddings
3. **math-agent**: SIC, POVM, density matrices - not integrated into grading

### Required Reviews Before Next Session
- [ ] Run `architect-agent` on configuration anti-patterns
- [ ] Run `data-agent` on embedding schema completeness
- [ ] Run `accessibility-agent` on Book Maker modal

---

## NEXT SESSION PRIORITIES

### 1. Configuration Management System
Create `ConfigurationManager` with:
- Centralized config store (SQLite or JSON)
- Admin UI for adjusting values
- Type-safe config access
- Default values with override capability

### 2. Fix Content Embedding Pipeline
- Implement three-level chunking strategy
- Run batch embedding for all content items
- Add embedding status tracking
- Fix unified search to only include embedded items

### 3. Complete Grading Integration
- Background grading queue
- Full SIC analysis option
- Grade display in all views
- Re-grade capability

### 4. Clean Up Hardcoded Values
- Extract ALL literals to config
- Document each config option
- Add validation

---

## KEY CODE LOCATIONS

### Configuration (Needs Creation)
```
/apps/web/src/lib/config/
├── ConfigurationManager.ts  # To be created
├── defaults.ts              # Default values
└── types.ts                 # Config type definitions
```

### Embedding Pipeline
```
/electron/archive-server/services/embeddings/
├── EmbeddingDatabase.ts     # Has searchContentItems
├── ContentOperations.ts     # Content item embedding storage
└── ArchiveIndexer.ts        # Batch indexing
```

### Grading System
```
/apps/web/src/lib/book-studio/
├── harvest-review-agent.ts  # quickGradeCard, gradeCardFull
├── chekhov-local.ts         # Necessity analysis
└── types.ts                 # CardGrade interface
```

---

## TESTING COMMANDS

```bash
# Start dev server
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test book-studio API (port 3004)
curl -s http://localhost:3004/api/health

# Test archive API (port 3002)
curl -s http://localhost:3002/api/embeddings/health

# Check content item embedding status
curl -s "http://localhost:3002/api/content/items?limit=1" | jq '.items[0].embedding'

# Test message search (works)
curl -s -X POST http://localhost:3002/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "Heart Sutra", "limit": 5}'

# Test unified search (broken - shows fake similarity)
curl -s -X POST http://localhost:3002/api/embeddings/search/unified \
  -H "Content-Type: application/json" \
  -d '{"query": "Heart Sutra", "limit": 5}'
```

---

## SUMMARY

The Book Maker modal has multiple interconnected issues stemming from:

1. **Missing embeddings** for content items (root cause of search issues)
2. **Hardcoded configuration** throughout codebase (architectural debt)
3. **Incomplete grading** integration (partially implemented)

**Do not apply more workarounds.** The next session must:
1. Create proper configuration management
2. Fix the embedding pipeline at its root
3. Complete the grading system integration

---

**End of Handoff**
