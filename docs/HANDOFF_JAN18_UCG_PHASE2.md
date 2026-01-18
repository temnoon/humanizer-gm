# Handoff: UCG Phase 2 - Chunking & Embedding Pipeline

**Date**: January 18, 2026
**Status**: Core Implementation Complete, Compilation Fixes Needed
**Next**: Fix remaining TypeScript errors, test ingestion pipeline

---

## What Was Done (Phase 2)

### 1. Schema Updates (`schema.ts`)

Updated to version 2 with new columns:

**Chunking columns:**
- `parent_node_id` - Parent node for chunks
- `chunk_index` - Sequence within parent (0-based)
- `chunk_start_offset` - Character position in parent
- `chunk_end_offset` - End position

**Embedding columns:**
- `embedding_model` - Model used ('nomic-embed-text')
- `embedding_at` - Timestamp when embedded
- `embedding_text_hash` - SHA256 for staleness detection

**Hierarchy columns:**
- `hierarchy_level` - 0=source/chunk, 1+=summary
- `thread_root_id` - Root document ID for grouping

**Ingestion columns:**
- `ingested_from_table` - Source archive table
- `ingested_from_id` - Source archive row ID
- `ingested_at` - When ingested to UCG

### 2. Content Quality Table

New `content_quality` table for SIC/Chekhov analysis:
```sql
content_quality (
  node_id TEXT PRIMARY KEY,
  authenticity REAL,       -- SIC analysis
  necessity REAL,          -- Chekhov gun
  inflection REAL,         -- Quantum reading
  voice REAL,              -- Style coherence
  overall REAL,            -- Weighted composite
  stub_type TEXT,
  sic_category TEXT,
  analyzed_at INTEGER,
  analyzer_version TEXT,
  analysis_json TEXT
)
```

### 3. ChunkingService (`ChunkingService.ts`)

New service for splitting content into embeddable chunks:
- **Target size**: ~400-500 words (2000-4000 chars)
- **Strategies**:
  - `conversation` - By message turns
  - `paragraph` - By double newlines
  - `sentence` - By sentence endings
- **Falls back** to clause/hard splits for very long content
- **Tracks** boundary type, offsets, word counts

### 4. IngestionService (`IngestionService.ts`)

Pipeline from Archive → UCG:
- Reads from `conversations`, `messages`, `content_items`
- Chunks content using ChunkingService
- Creates ContentNodes for source and chunks
- Generates embeddings via EmbeddingGenerator
- Creates links (derived-from, parent, follows, precedes)
- Tracks ingestion metadata

**API Methods:**
- `ingestAll(options)` - Ingest all pending items
- `ingestConversation(id)` - Single conversation
- `ingestContentItem(id)` - Single content item
- `embedPending(limit)` - Generate pending embeddings
- `getStats()` - Ingestion statistics

### 5. ContentGraphDatabase Embedding Methods

Added to ContentGraphDatabase:
- `storeEmbedding(nodeId, embedding, model)` - Store embedding
- `getEmbedding(nodeId)` - Get embedding
- `hasEmbedding(nodeId)` - Check if exists
- `searchByEmbedding(embedding, limit, threshold)` - Vector search
- `getNodesNeedingEmbeddings(limit)` - Find nodes needing embeddings
- `isEmbeddingStale(nodeId)` - Check if text changed

### 6. Routes Wired to Server

- Content graph routes mounted at `/api/ucg`
- Uses service registry pattern
- New ingestion endpoints:
  - `GET /api/ucg/ingestion/stats`
  - `POST /api/ucg/ingestion/run`
  - `POST /api/ucg/ingestion/conversation/:id`
  - `POST /api/ucg/ingestion/content-item/:id`
  - `POST /api/ucg/ingestion/embed-pending`

### 7. Service Registry Updates

Added to `registry.ts`:
- `getContentGraphDatabase()` - UCG database
- `getIngestionService()` - Ingestion service
- Services reset on archive switch

### 8. Core Package Type Updates

Fixed `SourceType` conflict:
- Entity module has simple `SourceType`
- Content-graph has extended `ContentSourceType`
- Exported as `UCGSourceType` to avoid conflict

---

## Remaining Issues (Compilation Errors)

### 1. Duplicate Export in content-graph.ts
```
error TS2323: Cannot redeclare exported variable 'createContentGraphRouter'
```
**Fix**: Remove duplicate export at end of file

### 2. Type Incompatibility in PATCH route
```
error TS2345: Argument of type '{content?, metadata?}' not assignable to Partial<Pick<ContentNode>>
```
**Fix**: Make content.text required or update type

### 3. Implicit Any for links
```
error TS7034: Variable 'links' implicitly has type 'any[]'
```
**Fix**: Add type annotation `let links: ContentLink[] = []`

### 4. Instance vs Type in index.ts
```
error TS2749: 'ContentGraphDatabase' refers to a value, used as type
```
**Fix**: Use `InstanceType<typeof ContentGraphDatabase>` or import class type

---

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `services/content-graph/schema.ts` | Modified | Schema v2 with new columns |
| `services/content-graph/ChunkingService.ts` | Created | Content chunking |
| `services/content-graph/IngestionService.ts` | Created | Archive → UCG pipeline |
| `services/content-graph/ContentGraphDatabase.ts` | Modified | Embedding methods |
| `services/content-graph/index.ts` | Modified | Export new services |
| `services/registry.ts` | Modified | UCG service registry |
| `routes/content-graph.ts` | Modified | Registry pattern, ingestion routes |
| `server.ts` | Modified | Mount UCG routes |
| `packages/core/src/types/index.ts` | Modified | Handle SourceType conflict |
| `packages/core/src/types/content-graph.ts` | Modified | ContentSourceType |

---

## Architecture Diagram

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│     ARCHIVE     │     │   INGESTION SVC     │     │       UCG       │
│   (immutable)   │     │                     │     │                 │
│                 │     │ ┌─────────────────┐ │     │ ┌─────────────┐ │
│ conversations ──┼────▶│ │ ChunkingService │ │────▶│ │ContentNodes │ │
│ messages        │     │ └─────────────────┘ │     │ └─────────────┘ │
│ content_items   │     │          │          │     │        │        │
│                 │     │          ▼          │     │        ▼        │
│                 │     │ ┌─────────────────┐ │     │ ┌─────────────┐ │
│                 │     │ │EmbeddingGen     │ │────▶│ │ContentLinks │ │
│                 │     │ └─────────────────┘ │     │ └─────────────┘ │
└─────────────────┘     └─────────────────────┘     │        │        │
                                                    │        ▼        │
                                                    │ ┌─────────────┐ │
                                                    │ │content_vecs │ │
                                                    │ └─────────────┘ │
                                                    └─────────────────┘
```

---

## Commands to Test (After Fixes)

```bash
# Development
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test UCG endpoints
curl http://localhost:3002/api/ucg/stats
curl http://localhost:3002/api/ucg/ingestion/stats
curl -X POST http://localhost:3002/api/ucg/ingestion/run

# Ingest specific conversation
curl -X POST http://localhost:3002/api/ucg/ingestion/conversation/CONV_ID

# Generate pending embeddings
curl -X POST http://localhost:3002/api/ucg/ingestion/embed-pending
```

---

## Next Steps

1. **Fix TypeScript Errors** (see above)
2. **Test Ingestion Pipeline**
   - Run with skipEmbedding first
   - Verify chunks created correctly
   - Enable embedding generation
3. **Integration**
   - Update search to query UCG
   - Update tools panel to use UCG
4. **Quality Scoring**
   - Wire SIC analyzer to UCG
   - Async analysis queue

---

## Critical Notes

1. **Database shares with EmbeddingDatabase** - Uses same better-sqlite3 instance
2. **Vec extension required** for embeddings - Falls back gracefully if not loaded
3. **Migration runs automatically** - Schema v1 → v2 on initialize
4. **Registry pattern** - Services created lazily, reset on archive switch

---

## Summary

UCG Phase 2 implementation is complete at the code level:
- Schema updated with chunking/embedding/quality columns
- ChunkingService splits content by type
- IngestionService pipelines archive → UCG
- ContentGraphDatabase has embedding operations
- Routes wired to server at /api/ucg
- Service registry pattern implemented

Remaining work: Fix 4 TypeScript compilation errors, then test the full pipeline.
