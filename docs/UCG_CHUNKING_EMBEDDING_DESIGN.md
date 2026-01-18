# UCG Chunking & Embedding Pipeline Design

**Status**: Draft for review
**Date**: January 2025

---

## Architecture Overview

```
ARCHIVE (immutable)          INGESTION PIPELINE              UCG (working layer)
┌──────────────────┐        ┌──────────────────┐           ┌──────────────────┐
│ conversations    │        │                  │           │ content_nodes    │
│ messages         │───────▶│  1. Detect       │──────────▶│ (source nodes)   │
│ content_items    │        │  2. Chunk        │           │                  │
│ media_files      │        │  3. Embed        │           │ content_nodes    │
│ (future imports) │        │  4. Link         │──────────▶│ (chunk nodes)    │
└──────────────────┘        │  5. Score        │           │                  │
                            └──────────────────┘           │ content_links    │
                                                           │ content_vectors  │
                                                           └──────────────────┘
```

---

## 1. Core Principles

### 1.1 Archive is Sacred
- Archive tables (`conversations`, `messages`, `content_items`) are **read-only** after import
- UCG ingestion reads from archive, never modifies it
- Original IDs preserved via `source.originalId` in ContentNode

### 1.2 Chunks are ContentNodes
- Every chunk is a full `ContentNode` with its own `id`, `uri`, `contentHash`
- Chunks link to their source via `derived-from` link
- Chunks link to each other via `follows`/`precedes` for sequence

### 1.3 Embeddings per Chunk
- Each chunk (~400-500 words) gets one embedding
- Source nodes do NOT get embeddings directly (too long)
- Search returns chunks, which link back to source

### 1.4 Pyramid is Transformation
- Pyramid summaries are ContentNodes with `sourceType: 'transform'`
- Each pyramid level links to its children via `derived-from`
- Apex summary is top-level ContentNode

---

## 2. Ingestion Pipeline Stages

### Stage 1: Source Detection
Determine what needs ingestion from archive.

```typescript
interface IngestionSource {
  table: 'conversations' | 'messages' | 'content_items';
  id: string;
  contentHash: string;  // To detect changes
  lastIngested?: number;
}

// Find unprocessed or changed archive items
function findPendingIngestion(): IngestionSource[] {
  // Compare archive items against existing UCG nodes
  // Return items where:
  //   - No UCG node exists with matching source.originalId
  //   - Or archive content hash differs from UCG node
}
```

### Stage 2: Content Chunking
Break long content into embeddable chunks.

```typescript
interface ChunkConfig {
  targetWords: number;      // 400-500 words ideal
  maxWords: number;         // 600 hard limit
  minWords: number;         // 50 minimum (avoid tiny chunks)
  boundaryStrategy: 'semantic' | 'paragraph' | 'sentence';
  overlapWords: number;     // 0-50 for context continuity
}

interface ChunkResult {
  chunks: ContentChunk[];
  sourceNode: ContentNode;  // Parent node (no embedding)
}

interface ContentChunk {
  text: string;
  index: number;            // 0-based sequence
  startOffset: number;      // Character position in source
  endOffset: number;
  boundaryType: string;     // What caused this split
  wordCount: number;
}
```

**Chunking Strategies by Content Type**:

| Content Type | Strategy | Boundaries |
|-------------|----------|------------|
| Conversation | By message turns | User/assistant alternation |
| Long message | By paragraphs | Double newlines |
| Prose/article | Semantic | Paragraph + sentence |
| Code | By function/block | Syntax-aware |
| Facebook post | Whole (usually short) | N/A |

### Stage 3: Embedding Generation
Generate embeddings for each chunk.

```typescript
interface EmbeddingJob {
  nodeId: string;           // ContentNode to embed
  text: string;             // Text to embed (chunk content)
  model: string;            // 'nomic-embed-text'
  priority: number;         // Higher = process first
}

interface EmbeddingResult {
  nodeId: string;
  embedding: number[];      // 768-dim vector
  model: string;
  generatedAt: number;
  textHash: string;         // For staleness detection
}
```

**Embedding Storage**:
```sql
-- Vector table (vec0 extension)
CREATE VIRTUAL TABLE content_vectors USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding float[768]
);

-- Metadata in content_nodes
ALTER TABLE content_nodes ADD COLUMN embedding_model TEXT;
ALTER TABLE content_nodes ADD COLUMN embedding_at INTEGER;
ALTER TABLE content_nodes ADD COLUMN embedding_text_hash TEXT;
```

### Stage 4: Link Creation
Create relationships between nodes.

```typescript
// Links created during ingestion:

// 1. Source to chunks
createLink(chunk.id, source.id, 'derived-from');
createLink(source.id, chunk.id, 'parent');

// 2. Chunk sequence
createLink(chunk[i].id, chunk[i-1].id, 'follows');
createLink(chunk[i-1].id, chunk[i].id, 'precedes');

// 3. Archive reference (for lineage)
// Stored in sourceMetadata, not as link:
chunk.source = {
  type: 'chatgpt',
  adapter: 'archive-ingest',
  originalId: message.id,        // Archive message ID
  originalPath: conversation.id, // Archive conversation ID
};
```

### Stage 5: Quality Scoring (Async)
Run quality analysis on chunks.

```typescript
interface QualityJob {
  nodeId: string;
  analysisTypes: ('sic' | 'chekhov' | 'quantum')[];
}

interface QualityResult {
  nodeId: string;
  scores: {
    authenticity: number;   // SIC-derived (0-1)
    necessity: number;      // Chekhov-derived (0-1)
    inflection: number;     // Quantum reading (0-1)
    overall: number;        // Weighted composite
  };
  stubType: StubClassification;
  analyzedAt: number;
}
```

---

## 3. Data Model Updates

### 3.1 ContentNode Schema Additions

```sql
-- Add to content_nodes table:

-- Chunking metadata
parent_node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
chunk_index INTEGER,              -- Sequence within parent
chunk_start_offset INTEGER,       -- Character position in parent
chunk_end_offset INTEGER,

-- Embedding metadata
embedding_model TEXT,             -- 'nomic-embed-text'
embedding_at INTEGER,             -- Unix timestamp
embedding_text_hash TEXT,         -- SHA256 of embedded text

-- Hierarchy/pyramid
hierarchy_level INTEGER DEFAULT 0, -- 0=source/chunk, 1+=summary
thread_root_id TEXT,              -- Root document for grouping

-- Ingestion tracking
ingested_from_table TEXT,         -- 'conversations', 'messages', etc.
ingested_from_id TEXT,            -- Original archive row ID
ingested_at INTEGER,              -- When ingested to UCG
```

### 3.2 New Indexes

```sql
-- Chunk queries
CREATE INDEX idx_content_nodes_parent ON content_nodes(parent_node_id);
CREATE INDEX idx_content_nodes_chunk_seq ON content_nodes(parent_node_id, chunk_index);

-- Embedding staleness
CREATE INDEX idx_content_nodes_embedding ON content_nodes(embedding_at);

-- Ingestion tracking
CREATE INDEX idx_content_nodes_ingested ON content_nodes(ingested_from_table, ingested_from_id);

-- Thread grouping
CREATE INDEX idx_content_nodes_thread ON content_nodes(thread_root_id);
```

### 3.3 Quality Table

```sql
CREATE TABLE content_quality (
  node_id TEXT PRIMARY KEY REFERENCES content_nodes(id) ON DELETE CASCADE,

  -- Scores (0.0 to 1.0)
  authenticity REAL,        -- SIC analysis
  necessity REAL,           -- Chekhov gun
  inflection REAL,          -- Quantum reading
  voice REAL,               -- Style coherence
  overall REAL,             -- Weighted composite

  -- Classification
  stub_type TEXT,           -- 'stub-sentence', 'optimal', etc.
  sic_category TEXT,        -- 'polished-human', 'neat-slop', etc.

  -- Tracking
  analyzed_at INTEGER NOT NULL,
  analyzer_version TEXT,

  -- Detailed breakdown (JSON)
  analysis_json TEXT
);

CREATE INDEX idx_quality_overall ON content_quality(overall DESC);
CREATE INDEX idx_quality_stub ON content_quality(stub_type);
```

---

## 4. Ingestion Service API

```typescript
class IngestionService {
  constructor(
    private archiveDb: Database,      // Read-only archive access
    private ucgDb: ContentGraphDatabase,
    private embedder: EmbeddingGenerator,
  ) {}

  /**
   * Ingest all pending archive items into UCG
   */
  async ingestAll(options?: {
    batchSize?: number;
    onProgress?: (progress: IngestionProgress) => void;
  }): Promise<IngestionStats>;

  /**
   * Ingest a specific conversation
   */
  async ingestConversation(conversationId: string): Promise<ContentNode[]>;

  /**
   * Ingest a specific content item (Facebook, etc.)
   */
  async ingestContentItem(itemId: string): Promise<ContentNode[]>;

  /**
   * Re-ingest items that have changed in archive
   */
  async reingestChanged(): Promise<IngestionStats>;

  /**
   * Generate embeddings for nodes missing them
   */
  async embedPending(limit?: number): Promise<number>;

  /**
   * Run quality analysis on unscored nodes
   */
  async analyzePending(limit?: number): Promise<number>;
}

interface IngestionProgress {
  phase: 'detecting' | 'chunking' | 'embedding' | 'linking' | 'scoring';
  current: number;
  total: number;
  currentItem?: string;
}

interface IngestionStats {
  sourcesProcessed: number;
  chunksCreated: number;
  embeddingsGenerated: number;
  linksCreated: number;
  duration: number;
  errors: string[];
}
```

---

## 5. Search Integration

### 5.1 Unified Search

Search queries UCG chunks, returns with source context.

```typescript
interface SearchRequest {
  query: string;
  mode: 'semantic' | 'keyword' | 'hybrid';
  filters?: {
    sourceTypes?: SourceType[];
    dateRange?: { start: number; end: number };
    minQuality?: number;
    tags?: string[];
  };
  limit?: number;
}

interface SearchResult {
  chunk: ContentNode;           // The matching chunk
  source: ContentNode;          // Parent source node
  similarity: number;           // Vector similarity (0-1)
  highlights?: string[];        // Keyword highlights
  quality?: QualityScores;      // If analyzed
}
```

### 5.2 Search Flow

```
Query
  │
  ├─▶ Embed query text (768-dim vector)
  │
  ├─▶ Vector search on content_vectors
  │   WHERE node has embedding
  │   AND matches filters
  │   ORDER BY similarity DESC
  │
  ├─▶ (Optional) Keyword search on content_nodes_fts
  │   Combine with vector results
  │
  ├─▶ Load source nodes via parent_node_id
  │
  └─▶ Return SearchResult[]
```

---

## 6. Pyramid Integration

Pyramid summaries become ContentNodes through transformation.

### 6.1 Pyramid as Transformation

```typescript
// Building a pyramid creates ContentNodes at each level:

// Level 0: Original chunks (already exist from ingestion)
// Level 1: Summary of 4-6 chunks
// Level 2: Summary of 4-6 L1 summaries
// ...
// Apex: Final summary

interface PyramidNode extends ContentNode {
  // These are stored in standard ContentNode fields:
  // hierarchy_level: 1, 2, 3... (0 = base chunk)
  // sourceType: 'transform'
  // source.adapter: 'pyramid-builder'

  // Links:
  // derived-from -> each child node
  // parent -> thread root
}
```

### 6.2 Pyramid Building Flow

```
Source chunks (L0)
     │
     ├─▶ Group into batches of 4-6
     │
     ├─▶ LLM summarize each batch → L1 nodes
     │   Create derived-from links to L0 chunks
     │   Embed L1 summaries
     │
     ├─▶ Group L1 into batches of 4-6
     │
     ├─▶ LLM summarize → L2 nodes
     │   Create derived-from links to L1
     │   Embed L2 summaries
     │
     └─▶ Continue until apex (single summary)
```

---

## 7. Implementation Order

### Phase 1: Schema Updates
1. Add new columns to content_nodes
2. Create content_quality table
3. Add indexes
4. Update TypeScript types

### Phase 2: Chunking Service
1. Create ChunkingService with strategies
2. Implement conversation chunking (by turns)
3. Implement prose chunking (by paragraph)
4. Test with real archive data

### Phase 3: Ingestion Pipeline
1. Create IngestionService
2. Wire to archive tables
3. Implement batch processing
4. Add progress tracking

### Phase 4: Embedding Integration
1. Connect to existing EmbeddingGenerator
2. Store in content_vectors table
3. Track embedding metadata
4. Implement staleness detection

### Phase 5: Search Unification
1. Update search to query UCG
2. Implement hybrid search
3. Add source node loading
4. Test performance

### Phase 6: Quality Analysis
1. Wire SIC analyzer to UCG
2. Store in content_quality table
3. Implement async analysis queue
4. Add quality filters to search

### Phase 7: Pyramid Migration
1. Create PyramidTransformer service
2. Migrate existing pyramids to UCG
3. Update pyramid builder to output UCG
4. Test full pipeline

---

## 8. Open Questions

1. **Chunk overlap**: Should chunks overlap for context continuity?
   - Pro: Better retrieval for boundary topics
   - Con: More storage, duplicate content

2. **Embedding updates**: When source changes, re-embed all chunks?
   - Option A: Yes, always (consistent but expensive)
   - Option B: Only if chunk text changed (efficient but complex)

3. **Quality scoring timing**: Score during ingestion or async?
   - Recommendation: Async queue, score after embedding

4. **Archive-UCG sync**: One-time migration or continuous sync?
   - Recommendation: Continuous, check for new/changed items

---

## 9. Verification Checklist

After implementation, verify:

- [ ] All conversations ingested as source + chunk nodes
- [ ] Chunks are ~400-500 words each
- [ ] Every chunk has embedding in content_vectors
- [ ] Links exist: chunk → source (derived-from)
- [ ] Links exist: chunk[i] → chunk[i-1] (follows)
- [ ] Search returns chunks with source context
- [ ] Pyramid summaries are ContentNodes
- [ ] Quality scores populated async
- [ ] No truncation of long content
- [ ] Archive tables unchanged after ingestion
