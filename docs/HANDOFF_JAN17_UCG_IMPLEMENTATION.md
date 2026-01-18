# Handoff: Universal Content Graph (UCG) Implementation

**Date**: January 17, 2025
**Status**: Phase 1 Complete, Phase 2 Designed
**Next**: Implement chunking + embedding pipeline

---

## What Was Done

### Phase 1: UCG Core Implementation (Complete)

Created the Universal Content Graph - a single content interchange format that all sources normalize to.

#### Files Created

**Core Types** (`packages/core/src/types/`):
- `content-graph.ts` - ContentNode, ContentLink, SourceType, LinkType, etc.
- `content-adapter.ts` - ContentAdapter interface, BaseContentAdapter, AdapterOptions

**Backend Services** (`electron/archive-server/services/content-graph/`):
- `schema.ts` - SQL schema, migrations, row types
- `ContentGraphDatabase.ts` - CRUD operations for nodes/links
- `AdapterRegistry.ts` - Adapter registration and detection
- `LinkGraph.ts` - Graph traversal, pathfinding, clustering
- `VersionControl.ts` - Versioning, diff, revert, fork
- `migration.ts` - Migrate existing conversations/content_items
- `index.ts` - Module exports

**Adapters** (`electron/archive-server/services/content-graph/adapters/`):
- `chatgpt-adapter.ts` - OpenAI conversation exports
- `claude-adapter.ts` - Claude conversation exports
- `markdown-adapter.ts` - Markdown files
- `text-adapter.ts` - Plain text files
- `index.ts` - Adapter exports

**Frontend** (`apps/web/src/lib/content-graph/`):
- `ContentGraphContext.tsx` - React context/provider
- `useContentGraph.ts` - React hooks
- `index.ts` - Frontend exports

**API Routes** (`electron/archive-server/routes/`):
- `content-graph.ts` - REST API endpoints (NOT YET WIRED to server.ts)

### House Agent Reviews (Complete)

Both architect-agent and data-agent reviewed the implementation.

**Key Findings**:
1. Missing embedding integration (vec table defined but unused)
2. No chunking logic (long content exceeds embedding context)
3. Missing pyramid integration
4. Missing quality score fields (SIC, Chekhov)
5. Routes not wired to server.ts
6. Type misalignment with existing BufferContext

### Design Document Created

`docs/UCG_CHUNKING_EMBEDDING_DESIGN.md` - Complete design for:
- Ingestion pipeline (archive → UCG)
- Chunking strategies by content type
- Embedding storage and staleness detection
- Link creation patterns
- Quality scoring integration
- Pyramid as transformation
- Search unification

---

## Architecture Clarification

The user clarified the system layers:

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│     ARCHIVE     │     │   CONTENT GRAPH     │     │      BOOKS      │
│   (immutable)   │ ──▶ │       (UCG)         │ ──▶ │   (separate)    │
│                 │     │                     │     │                 │
│ • Raw imports   │     │ • Chunked nodes     │     │ • Harvest API   │
│ • Conversations │     │ • Embeddings        │     │ • Chapters      │
│ • Facebook data │     │ • Links/lineage     │     │ • Book projects │
│ • Future imports│     │ • Quality scores    │     │                 │
└─────────────────┘     └─────────────────────┘     └─────────────────┘
     Source of              Working layer              Output layer
       truth              (analysis, search)          (curation)
```

- **Archive** = Immutable record of imports (never modified after import)
- **UCG** = Processed/ingested content for tools (chunked, embedded, scored)
- **Books** = Separate API/database for curation output

---

## What Needs To Be Done

### Immediate (Phase 2): Chunking + Embedding Pipeline

**Schema Updates**:
```sql
-- Add to content_nodes:
parent_node_id TEXT REFERENCES content_nodes(id),
chunk_index INTEGER,
chunk_start_offset INTEGER,
chunk_end_offset INTEGER,
embedding_model TEXT,
embedding_at INTEGER,
embedding_text_hash TEXT,
hierarchy_level INTEGER DEFAULT 0,
thread_root_id TEXT,
ingested_from_table TEXT,
ingested_from_id TEXT,
ingested_at INTEGER,
```

**New Services**:
1. `ChunkingService` - Split content by type (conversation turns, paragraphs, etc.)
2. `IngestionService` - Pipeline from archive to UCG
3. `ContentGraphVectorOperations` - Embedding storage/search

**Integration Points**:
- Wire routes to `server.ts`
- Connect to existing `EmbeddingGenerator`
- Update search to query UCG instead of old tables

### Later Phases

- Quality scoring integration (SIC, Chekhov)
- Pyramid transformer (summaries as ContentNodes)
- Smart import agent for unknown formats
- Unify with BufferContext in frontend

---

## Key Files to Reference

| File | Purpose |
|------|---------|
| `docs/UCG_CHUNKING_EMBEDDING_DESIGN.md` | Full design doc for next phase |
| `services/content-graph/schema.ts` | Current schema (needs updates) |
| `services/content-graph/ContentGraphDatabase.ts` | Core operations (needs embedding methods) |
| `services/embeddings/VectorOperations.ts` | Pattern to follow for vector ops |
| `services/embeddings/EmbeddingGenerator.ts` | Existing embedding service to reuse |

---

## Commands to Test

```bash
# Development
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Test archive endpoints
curl http://localhost:3002/api/health
curl http://localhost:3002/api/archives

# UCG routes NOT YET available (need to wire to server.ts)
```

---

## Open Questions for Next Session

1. **Chunk overlap**: Should chunks have overlapping words for context?
2. **Embedding updates**: Re-embed all chunks when source changes, or track individually?
3. **Archive sync**: One-time migration vs continuous sync with archive?
4. **Smart import priority**: Build agent now or after core pipeline works?

---

## Summary

UCG Phase 1 created the foundation - types, schema, adapters, database operations. House agents reviewed and identified gaps (embedding integration, chunking, quality scores). Design doc created for Phase 2 chunking + embedding pipeline. Architecture clarified: Archive (immutable) → UCG (working) → Books (output). Next step: implement the ingestion pipeline that chunks content and generates embeddings.
