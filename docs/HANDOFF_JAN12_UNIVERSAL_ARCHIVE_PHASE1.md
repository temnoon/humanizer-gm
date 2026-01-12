# Handoff: Universal Archive Interface - Phase 1 Implementation

**Date**: January 12, 2026
**Session**: Facebook Notes Import + Universal Archive Design
**Status**: Design approved, ready for Phase 1 implementation
**ChromaDB Tag**: `jan-12-2026-s11`

---

## Session Accomplishments

### 1. Facebook Notes Import (Complete)
- **57 notes imported** to `fb_notes` table
- **52,610 total words** of philosophical essays
- **Embeddings complete**: 49 direct + 8 chunked (108 chunks total)
- **Semantic search working**: `/api/facebook/notes/semantic-search`

### 2. Design Documents Created
- `docs/DESIGN_UNIVERSAL_CONTENT_PIPELINE.md` - Chunking architecture
- `docs/DESIGN_UNIVERSAL_ARCHIVE_INTERFACE.md` - Full universal archive design (1,666 lines with House reviews)

### 3. House Reviews Completed
- **Architect House**: APPROVED
- **Stylist House**: CONDITIONAL PASS (CSS fixes needed)

---

## Phase 1 Tasks (Priority Order)

### Task 1: Add Notes Tab to Facebook Panel
**File**: `apps/web/src/components/archive/FacebookView.tsx`
**Effort**: 2-4 hours

Currently shows only posts/comments. Add:
```typescript
// New tab for Notes
<Tab label="Notes" icon="📝" count={notesCount} />
```

API endpoint exists: `GET /api/facebook/notes`

### Task 2: Update Unified Search Stats
**File**: `electron/archive-server/routes/embeddings.ts` (line ~496)
**Effort**: 30 minutes

Current stats only count: messages, posts, comments, documents
Add: `notes: limitedResults.filter(r => r.type === 'note').length`

### Task 3: Create `search_content` AUI Tool
**File**: `apps/web/src/lib/aui/tools/archive.ts`
**Effort**: 1-2 hours

Unified search tool that replaces `search_archive` + `search_facebook`:
```typescript
USE_TOOL(search_content, {
  query: "consciousness",
  contentTypes: ["essay", "conversation", "post"],
  sources: ["facebook", "chatgpt"],
  limit: 20
})
```

### Task 4: Schema Migration (VERSION 15)
**File**: `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`
**Effort**: 2-3 hours

Add columns to `content_items`:
```sql
ALTER TABLE content_items ADD COLUMN uri TEXT UNIQUE;
ALTER TABLE content_items ADD COLUMN content_hash TEXT;
ALTER TABLE content_items ADD COLUMN source_id TEXT;
ALTER TABLE content_items ADD COLUMN imported_at REAL;
CREATE UNIQUE INDEX idx_source_unique ON content_items(source, source_id);
```

### Task 5: Rename `type` → `content_type`
**Files**: Multiple (database, routes, parsers)
**Effort**: 1-2 hours

For consistency with design. Affects:
- EmbeddingDatabase.ts schema
- content.ts routes
- facebook.ts routes
- All parsers

---

## Key Files Reference

### Already Working
| File | Purpose |
|------|---------|
| `electron/archive-server/services/facebook/NotesParser.ts` | Parse FB notes |
| `electron/archive-server/routes/facebook.ts:2162-2250` | Notes API endpoints |
| `electron/archive-server/services/embeddings/ContentChunker.ts` | Content-aware chunking |

### Need Modification
| File | Change Needed |
|------|---------------|
| `apps/web/src/components/archive/FacebookView.tsx` | Add Notes tab |
| `electron/archive-server/routes/embeddings.ts` | Add notes to stats |
| `apps/web/src/lib/aui/tools/archive.ts` | Add search_content tool |
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Schema v15 |

### Design Documents
| File | Content |
|------|---------|
| `docs/DESIGN_UNIVERSAL_ARCHIVE_INTERFACE.md` | Full design + House reviews |
| `docs/DESIGN_UNIVERSAL_CONTENT_PIPELINE.md` | Chunking/embedding pipeline |

---

## CSS Compliance Requirements (Stylist)

**CRITICAL**: Do NOT use hardcoded colors. Use tokens.css:

```css
/* WRONG */
.source-badge[data-source="facebook"] { color: #1877f2; }

/* CORRECT */
.source-badge[data-source="facebook"] {
  color: var(--color-archive-facebook);
  background: color-mix(in srgb, var(--color-archive-facebook) 8%, transparent);
}
```

Variable mappings:
- `--space-md` → `--space-medium`
- `--bg-secondary` → `--color-surface-secondary`
- `--radius-md` → `--radius-large`

---

## Database State

### Current Tables (SCHEMA_VERSION 14)
- `fb_notes`: 57 notes with `content_item_id` links
- `content_items`: 19,156 Facebook items (posts, comments, notes)
- `vec_content_items`: Embeddings for semantic search

### Pending Facebook Data
| Data Type | Status | Records |
|-----------|--------|---------|
| Groups | Not imported | ~1MB JSON |
| Messenger | Parser exists, not run | 1,762 threads |

---

## API Endpoints Summary

### Notes (Working)
```bash
GET  /api/facebook/notes              # List notes
GET  /api/facebook/notes/stats        # Statistics
GET  /api/facebook/notes/:id          # Full text
GET  /api/facebook/notes/search       # Text search
GET  /api/facebook/notes/semantic-search  # Vector search
POST /api/facebook/notes/import       # Import from export
POST /api/facebook/notes/embed        # Generate embeddings
```

### Unified Search (Needs notes count)
```bash
POST /api/embeddings/search/unified   # Returns notes but stats don't count them
```

---

## Future Platforms Roadmap

| Priority | Platform | Status |
|----------|----------|--------|
| Next | Instagram | Not started |
| Queued | Reddit | Export received |
| Queued | Substack | Export in process |
| Future | Quora, TikTok, Twitter, LinkedIn |

---

## Testing Commands

```bash
# Verify notes API
curl http://localhost:3002/api/facebook/notes/stats

# Test semantic search
curl "http://localhost:3002/api/facebook/notes/semantic-search?q=consciousness"

# Test unified search
curl -X POST http://localhost:3002/api/embeddings/search/unified \
  -H "Content-Type: application/json" \
  -d '{"query": "consciousness", "limit": 10}'
```

---

## Commits This Session

1. `c516cb2` - NotesParser + API (57 notes)
2. `51804c8` - Semantic search via embeddings
3. `936117a` - Intelligent chunking for long content
4. `d3ac71b` - Universal Archive Interface design + House reviews

---

## Next Session Start

1. Read this handoff
2. Read `docs/DESIGN_UNIVERSAL_ARCHIVE_INTERFACE.md` sections:
   - "Proposed Architecture" (lines 200-400)
   - "ARCHITECT HOUSE REVIEW" (lines 1086-1666)
3. Start with Task 1: NotesView component
4. Query ChromaDB: `tags: ["universal-archive", "phase1"]`

---

**End of Handoff**
