# Handoff: Book Studio Testing & Embeddings Analysis

**Date**: January 20, 2026
**Session Focus**: Card Review Agent & Bulk Assignment Implementation
**Next Session**: End-to-end book making test + embeddings cluster analysis

---

## What Was Implemented This Session

### Phase 1: Bulk Selection in StagingView
- **File**: `apps/web/src/components/book-maker/views/StagingView.tsx`
- Multi-select state (`selectedCardIds` Set)
- Selection mode toggle with shift+click range selection
- Checkboxes in grid/timeline views

### Phase 2: Agent-Assisted Chapter Assignment
- **Curator Agent** (`electron/agents/houses/curator.ts`): Added `assign-cards-to-chapters` capability using AI semantic matching
- **Assignment Service** (`apps/web/src/lib/book-studio/assignment-agent.ts`): Frontend service with local heuristic fallback
- **AssignmentModal** (`apps/web/src/components/book-maker/AssignmentModal.tsx`): Review/confirm AI suggestions

### Phase 3: Outline Suggestion Banner
- **OutlineSuggestionBanner** (`apps/web/src/components/book-maker/OutlineSuggestionBanner.tsx`)
- **Trigger Logic** in `BookStudioProvider.tsx`: Shows after harvest when cards >= 5 and no chapters

### Phase 4: Card Review Service
- **File**: `apps/web/src/lib/book-studio/card-review-service.ts`
- SIC metrics, Chekhov analysis, originality detection
- `reviewCardLocal()`, `reviewCards()`, `applyReviewGrades()`

### Types & API
- **Types** (`apps/web/src/lib/book-studio/types.ts`): `CardAssignmentProposal`, `CardReview`, `CardReviewBatch`, `BookStudioAgentConfig`
- **API Endpoint** (`electron/book-studio-server/routes/cards.ts`): `POST /api/cards/batch-update`
- **Client** (`apps/web/src/lib/book-studio/api-client.ts`): `batchUpdateCards()`

### Bug Fixes
- **OutlineView.tsx**: Fixed `handleCreateChapters` to actually assign cards to chapters (was only creating titles)
- **CSS** (`apps/web/src/styles/features/book-studio.css`): Added styles for selection controls, bulk action bar, assignment modal, outline suggestion banner

---

## Current State

### Build Status
- ✅ Build passes (`npm run build`)
- ✅ All TypeScript errors resolved

### What Works
| Feature | Status | Notes |
|---------|--------|-------|
| Bulk selection | ✅ | Select button, checkboxes, shift+click |
| Manual chapter assignment | ✅ | Dropdown in bulk action bar |
| Agent assignment modal | ✅ | Opens, shows proposals |
| Outline research | ✅ | Extracts themes from cards |
| Outline generation | ✅ | Creates chapter structure with card assignments |
| Create chapters from outline | ✅ Fixed | Now assigns cards to chapters |
| Card review service | ✅ | Available but not wired to UI |

### What Needs Testing
1. **End-to-end book creation flow**
2. **Agent assignment accuracy**
3. **Card review grading quality**
4. **Bulk operations performance with many cards**

---

## Next Session Tasks

### 1. End-to-End Book Making Test (Direct API)

```bash
# Test endpoints directly
curl http://localhost:3004/health
curl http://localhost:3004/books
curl http://localhost:3002/api/health  # Archive server
```

**Test Flow**:
1. Create a book via API
2. Search archive for content (semantic search)
3. Harvest cards from search results
4. Generate outline
5. Create chapters from outline
6. Verify cards are assigned to chapters

### 2. Embeddings Analysis

**Archive Server**: Port 3002
**Database**: SQLite with vector embeddings

```bash
# Check archive stats
curl http://localhost:3002/api/archives
curl http://localhost:3002/api/conversations?limit=10
```

**Analysis Tasks**:
- Query total embedding count
- Check embedding dimensions
- Identify any null/missing embeddings
- Analyze embedding distribution

### 3. Cluster Analysis for Philosophy Book

**Goal**: Find most common philosophical topics in UGC content

**Approach**:
1. Extract all embeddings from archive
2. Run k-means or DBSCAN clustering
3. Identify largest clusters
4. Extract representative passages
5. Create book outline from clusters

**Potential API Calls**:
```typescript
// Search for philosophical content
POST /api/search
{ "query": "meaning consciousness philosophy existence", "limit": 100 }

// Or use semantic clusters
GET /api/clusters?minSize=5
```

### 4. Embedding Error Detection

**Check For**:
- Missing embeddings (content without vectors)
- Duplicate embeddings (same vector for different content)
- Outlier embeddings (unusually distant from clusters)
- Dimension mismatches
- NaN/Inf values

---

## Key Files Reference

### Book Studio
| File | Purpose |
|------|---------|
| `apps/web/src/lib/book-studio/BookStudioProvider.tsx` | Central context with harvest/outline/draft agents |
| `apps/web/src/lib/book-studio/useBookStudioApi.ts` | API hooks for books/chapters/cards |
| `apps/web/src/lib/book-studio/api-client.ts` | REST client for Book Studio server |
| `apps/web/src/lib/book-studio/outline-agent.ts` | Theme extraction, outline generation |
| `apps/web/src/lib/book-studio/assignment-agent.ts` | Card-to-chapter assignment |
| `apps/web/src/lib/book-studio/card-review-service.ts` | Card grading/review |

### Archive Server
| File | Purpose |
|------|---------|
| `electron/archive-server/` | Local archive API (port 3002) |
| `electron/archive-server/services/search-service.ts` | Semantic search |
| `electron/archive-server/services/embedding-service.ts` | Vector embeddings |

### Book Studio Server
| File | Purpose |
|------|---------|
| `electron/book-studio-server/` | Book/chapter/card API (port 3004) |
| `electron/book-studio-server/routes/cards.ts` | Card CRUD + batch-update |
| `electron/book-studio-server/routes/chapters.ts` | Chapter CRUD |

### Curator Agent
| File | Purpose |
|------|---------|
| `electron/agents/houses/curator.ts` | AI-assisted content curation |
| Capabilities | `assess-passage`, `assign-cards-to-chapters`, `suggest-clusters` |

---

## Database Schemas

### Book Studio (SQLite)
```sql
-- books table
id, title, description, author_id, target_word_count, created_at, updated_at

-- chapters table
id, book_id, title, order, content, draft_instructions, word_count, created_at, updated_at

-- cards table
id, book_id, chapter_id, source_id, source_type, source, content_origin, content,
title, author_name, similarity, source_created_at, source_created_at_status,
harvested_at, source_url, conversation_id, conversation_title, user_notes,
ai_context, ai_summary, tags, status, metadata, grade, is_outline,
outline_structure, canvas_x, canvas_y, created_at, updated_at
```

### Archive (SQLite with vectors)
```sql
-- conversations table
id, title, create_time, update_time, mapping, moderation_results, ...

-- messages table (with embeddings)
id, conversation_id, author_role, content_type, content_text,
create_time, embedding (BLOB), ...
```

---

## Commands to Start Testing

```bash
# Start the app
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# In another terminal, test APIs
curl http://localhost:3002/api/health      # Archive
curl http://localhost:3004/health          # Book Studio

# Check archive content
curl http://localhost:3002/api/archives
curl "http://localhost:3002/api/search?q=philosophy&limit=20"
```

---

## Known Issues to Investigate

1. **Theme extraction produces few themes** - With 58 cards, only 2 themes found. May need to tune clustering parameters in `outline-agent.ts`.

2. **Card review not wired to UI** - `card-review-service.ts` exists but no UI button to trigger bulk review.

3. **Embeddings analysis needed** - Unknown state of embeddings coverage and quality.

---

## Configuration

```typescript
// Book Studio Agent Config (types.ts)
interface BookStudioAgentConfig {
  agentAssignment: {
    enabled: boolean
    minConfidenceThreshold: number  // 0-1
    autoAssignHighConfidence: boolean
    highConfidenceThreshold: number
  }
  cardReview: {
    enabled: boolean
    autoReviewOnHarvest: boolean
    batchSize: number
  }
  outlineSuggestion: {
    enabled: boolean
    minCardsForSuggestion: number  // Default: 5
    showAfterHarvest: boolean
  }
}
```

---

## Summary for Next Session

1. **Start app**: `npm run electron:dev`
2. **Test book creation end-to-end** via UI and API
3. **Query archive embeddings** to analyze coverage and quality
4. **Run cluster analysis** on philosophical content
5. **Create a test book** on the most common philosophical topic
6. **Document any embedding errors** found

**Goal**: Verify the full book-making pipeline works and assess embedding data quality for content clustering.
