# UCG Embedding Optimization Implementation Plan

**Version:** 1.0  
**Date:** January 2026  
**Status:** Ready for Implementation  
**Target:** Claude Code / Claude Desktop

---

## Executive Summary

This plan upgrades the UCG embedding system from single-resolution dense vectors to a **Multi-Resolution Hybrid Hierarchical** architecture. The goal is to optimize agentic operations on the corpus and latent space while preserving meaning boundaries.

### Key Enhancements

1. **Semantic-aware chunking** — Detect topic boundaries before splitting
2. **Multi-resolution embeddings** — Vectors at document, section, and chunk levels
3. **Hybrid retrieval** — Fuse dense vectors with FTS5 sparse search
4. **Quality-gated pipeline** — Integrate SIC/Chekhov scoring into retrieval
5. **Future: Late interaction** — ColBERT-style for narrative transformation

### Prerequisites

- Existing UCG schema (v2.0) at `docs/UCG_SPECIFICATION.md`
- sqlite-vec extension loaded
- FTS5 virtual table `content_nodes_fts` operational
- Ollama with `nomic-embed-text` model available

---

## Project Structure

All new code should be created in the existing humanizer-gm architecture:

```
humanizer-gm/
├── electron/archive-server/services/
│   ├── embeddings/
│   │   ├── EmbeddingDatabase.ts      # Existing - extend
│   │   ├── EmbeddingMigrations.ts    # Add migration v17+
│   │   └── types.ts                  # Extend types
│   │
│   ├── chunking/                     # NEW DIRECTORY
│   │   ├── SemanticChunker.ts        # Phase 1
│   │   ├── BoundaryDetector.ts       # Phase 1
│   │   ├── ChunkingStrategy.ts       # Phase 1 - interface
│   │   └── index.ts
│   │
│   ├── retrieval/                    # NEW DIRECTORY
│   │   ├── HybridSearch.ts           # Phase 3
│   │   ├── MultiResolutionRetrieval.ts # Phase 2
│   │   ├── QualityGatedPipeline.ts   # Phase 4
│   │   ├── ReciprocalRankFusion.ts   # Phase 3
│   │   └── index.ts
│   │
│   └── import/
│       ├── ImportPipeline.ts         # Modify to use SemanticChunker
│       └── parsers/                  # Existing parsers
│
├── packages/archive/src/
│   └── types/
│       └── retrieval.ts              # NEW - shared types
│
└── docs/
    └── UCG_SPECIFICATION.md          # Reference spec
```

---

## Phase 1: Semantic Chunking Enhancement

**Duration:** 3-4 days  
**Goal:** Replace naive token-count splitting with semantic boundary detection

### 1.1 Create Chunking Strategy Interface

**File:** `electron/archive-server/services/chunking/ChunkingStrategy.ts`

```typescript
export interface ChunkingOptions {
  minTokens: number;           // Minimum chunk size (default: 100)
  maxTokens: number;           // Maximum chunk size (default: 768)
  targetTokens: number;        // Target chunk size (default: 512)
  overlapTokens: number;       // Overlap between chunks (default: 50)
  semanticThreshold: number;   // Distance threshold for boundaries (default: 0.35)
}

export interface ChunkResult {
  text: string;
  startOffset: number;
  endOffset: number;
  chunkIndex: number;
  boundaryType: 'semantic' | 'structural' | 'size-limit';
  metadata?: {
    sentenceCount: number;
    topicSignature?: string;   // Optional: first few keywords
  };
}

export interface ChunkingStrategy {
  readonly name: string;
  readonly supportedFormats: string[];
  
  chunk(
    text: string,
    format: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ChunkResult[]>;
}
```

### 1.2 Implement Boundary Detector

**File:** `electron/archive-server/services/chunking/BoundaryDetector.ts`

```typescript
import { embed } from '../embeddings/EmbeddingService.js';

export interface BoundaryScore {
  index: number;           // Position between units[index] and units[index+1]
  distance: number;        // Semantic distance (0-1, higher = more different)
  isSignificant: boolean;  // Above threshold
}

export class BoundaryDetector {
  private threshold: number;
  
  constructor(threshold: number = 0.35) {
    this.threshold = threshold;
  }
  
  /**
   * Detect semantic boundaries between text units (sentences, paragraphs, turns)
   */
  async detectBoundaries(units: string[]): Promise<BoundaryScore[]> {
    if (units.length < 2) return [];
    
    // Batch embed all units
    const embeddings = await this.batchEmbed(units);
    
    // Compute pairwise cosine distances
    const scores: BoundaryScore[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      const distance = 1 - this.cosineSimilarity(embeddings[i], embeddings[i + 1]);
      scores.push({
        index: i,
        distance,
        isSignificant: distance > this.threshold
      });
    }
    
    return scores;
  }
  
  /**
   * Find optimal split points respecting min/max constraints
   */
  findSplitPoints(
    boundaries: BoundaryScore[],
    unitLengths: number[],
    options: { minTokens: number; maxTokens: number }
  ): number[] {
    const splits: number[] = [];
    let currentLength = 0;
    
    for (let i = 0; i < boundaries.length; i++) {
      currentLength += unitLengths[i];
      
      // Force split if approaching max
      if (currentLength >= options.maxTokens * 0.9) {
        splits.push(i + 1);
        currentLength = 0;
        continue;
      }
      
      // Split at significant boundary if above min
      if (boundaries[i].isSignificant && currentLength >= options.minTokens) {
        splits.push(i + 1);
        currentLength = 0;
      }
    }
    
    return splits;
  }
  
  private async batchEmbed(texts: string[]): Promise<Float32Array[]> {
    // Implement batched embedding via Ollama
    // Use existing embed() function from EmbeddingService
    return Promise.all(texts.map(t => embed(t)));
  }
  
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

### 1.3 Implement Semantic Chunker

**File:** `electron/archive-server/services/chunking/SemanticChunker.ts`

```typescript
import { BoundaryDetector } from './BoundaryDetector.js';
import type { ChunkingStrategy, ChunkingOptions, ChunkResult } from './ChunkingStrategy.js';

const DEFAULT_OPTIONS: ChunkingOptions = {
  minTokens: 100,
  maxTokens: 768,
  targetTokens: 512,
  overlapTokens: 50,
  semanticThreshold: 0.35
};

export class SemanticChunker implements ChunkingStrategy {
  readonly name = 'semantic';
  readonly supportedFormats = ['text', 'markdown', 'conversation', 'html'];
  
  private detector: BoundaryDetector;
  
  constructor(threshold?: number) {
    this.detector = new BoundaryDetector(threshold);
  }
  
  async chunk(
    text: string,
    format: string,
    options?: Partial<ChunkingOptions>
  ): Promise<ChunkResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // 1. Split into atomic units based on format
    const units = this.splitToUnits(text, format);
    
    // 2. Estimate token counts per unit
    const unitLengths = units.map(u => this.estimateTokens(u));
    
    // 3. Detect semantic boundaries
    const boundaries = await this.detector.detectBoundaries(units);
    
    // 4. Find optimal split points
    const splitPoints = this.detector.findSplitPoints(boundaries, unitLengths, opts);
    
    // 5. Create chunks from split points
    return this.createChunks(text, units, splitPoints, opts);
  }
  
  private splitToUnits(text: string, format: string): string[] {
    switch (format) {
      case 'conversation':
        // Split by message boundaries (already structured)
        return text.split(/\n(?=(?:User|Assistant|Human|Claude):)/i);
      
      case 'markdown':
        // Split by paragraphs, respecting headers
        return text.split(/\n\n+/).filter(p => p.trim());
      
      case 'html':
        // Strip tags, split by block elements
        const stripped = text.replace(/<[^>]+>/g, '\n');
        return stripped.split(/\n\n+/).filter(p => p.trim());
      
      default:
        // Split by sentences
        return this.splitSentences(text);
    }
  }
  
  private splitSentences(text: string): string[] {
    // Sentence boundary detection (simplified)
    // In production, use a proper sentence tokenizer
    return text
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .filter(s => s.trim());
  }
  
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }
  
  private createChunks(
    originalText: string,
    units: string[],
    splitPoints: number[],
    options: ChunkingOptions
  ): ChunkResult[] {
    const chunks: ChunkResult[] = [];
    let startUnit = 0;
    let offset = 0;
    
    const allSplits = [...splitPoints, units.length];
    
    for (let i = 0; i < allSplits.length; i++) {
      const endUnit = allSplits[i];
      const chunkUnits = units.slice(startUnit, endUnit);
      const chunkText = chunkUnits.join('\n\n');
      
      const startOffset = offset;
      offset += chunkText.length + 2; // +2 for join separator
      
      chunks.push({
        text: chunkText,
        startOffset,
        endOffset: offset,
        chunkIndex: i,
        boundaryType: 'semantic',
        metadata: {
          sentenceCount: chunkUnits.length
        }
      });
      
      startUnit = endUnit;
    }
    
    return chunks;
  }
}
```

### 1.4 Integrate with Import Pipeline

**File:** `electron/archive-server/services/import/ImportPipeline.ts`

Add to existing pipeline:

```typescript
import { SemanticChunker } from '../chunking/SemanticChunker.js';

// In the ImportPipeline class:
private chunker: SemanticChunker;

constructor() {
  this.chunker = new SemanticChunker();
  // ... existing initialization
}

// Modify the content processing to use semantic chunking:
async processContent(unit: ContentUnit): Promise<ContentNode[]> {
  const nodes: ContentNode[] = [];
  
  // Check if content needs chunking
  const tokenEstimate = this.estimateTokens(unit.content);
  
  if (tokenEstimate > 768) {
    // Use semantic chunking
    const chunks = await this.chunker.chunk(
      unit.content,
      unit.contentType,
      { maxTokens: 768, minTokens: 100 }
    );
    
    // Create parent node (full content, no embedding yet)
    const parentNode = this.createParentNode(unit);
    nodes.push(parentNode);
    
    // Create child nodes for each chunk
    for (const chunk of chunks) {
      const childNode = this.createChunkNode(chunk, parentNode.id, unit);
      nodes.push(childNode);
    }
  } else {
    // Content fits in single node
    nodes.push(this.createSingleNode(unit));
  }
  
  return nodes;
}
```

### 1.5 Success Criteria - Phase 1

- [ ] `SemanticChunker` correctly identifies topic boundaries
- [ ] Chunks respect min/max token constraints
- [ ] Conversation turns are not split mid-message
- [ ] `chunk_start_offset` and `chunk_end_offset` are accurately populated
- [ ] Import pipeline uses semantic chunking for content > 768 tokens
- [ ] Unit tests pass for boundary detection and chunking

---

## Phase 2: Multi-Resolution Embeddings

**Duration:** 2-3 days  
**Goal:** Store embeddings at document, section, and chunk levels

### 2.1 Schema Migration (v17)

**File:** `electron/archive-server/services/embeddings/EmbeddingMigrations.ts`

Add new migration:

```typescript
// Migration v17: Multi-resolution embeddings
if (fromVersion < 17) {
  console.log('[migration] v17: Adding multi-resolution embedding support...');
  
  // Add resolution column to vector table
  this.db.exec(`
    ALTER TABLE content_nodes_vec ADD COLUMN resolution INTEGER DEFAULT 2;
  `);
  
  // Index for staged retrieval by resolution
  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vec_resolution ON content_nodes_vec(resolution);
  `);
  
  // Add composite index for efficient hierarchical queries
  this.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_hierarchy 
    ON content_nodes(parent_node_id, hierarchy_level);
  `);
  
  // Add embedding_resolution to content_nodes for tracking
  this.db.exec(`
    ALTER TABLE content_nodes ADD COLUMN embedding_resolution INTEGER;
  `);
}
```

### 2.2 Resolution Constants

**File:** `electron/archive-server/services/embeddings/types.ts`

Add:

```typescript
export enum EmbeddingResolution {
  DOCUMENT = 0,    // Whole document/thread/conversation
  SECTION = 1,     // Section/topic-episode/message-group
  CHUNK = 2        // Leaf chunk/individual turn
}

export interface MultiResolutionEmbedding {
  nodeId: string;
  resolution: EmbeddingResolution;
  embedding: Float32Array;
  textHash: string;
}
```

### 2.3 Implement Multi-Resolution Embedding Service

**File:** `electron/archive-server/services/retrieval/MultiResolutionRetrieval.ts`

```typescript
import { EmbeddingResolution } from '../embeddings/types.js';
import type { EmbeddingDatabase } from '../embeddings/EmbeddingDatabase.js';

export class MultiResolutionEmbedder {
  constructor(private db: EmbeddingDatabase) {}
  
  /**
   * Embed a node and its ancestors at appropriate resolutions
   */
  async embedHierarchy(nodeId: string): Promise<void> {
    const node = await this.db.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    
    // Embed the leaf node at resolution 2
    await this.embedAtResolution(node, EmbeddingResolution.CHUNK);
    
    // If node has a parent, embed parent at resolution 1
    if (node.parent_node_id) {
      const parent = await this.db.getNode(node.parent_node_id);
      if (parent && !this.hasEmbedding(parent.id, EmbeddingResolution.SECTION)) {
        await this.embedAtResolution(parent, EmbeddingResolution.SECTION);
      }
      
      // If parent has a thread root, embed at resolution 0
      if (parent?.thread_root_id && parent.thread_root_id !== parent.id) {
        const root = await this.db.getNode(parent.thread_root_id);
        if (root && !this.hasEmbedding(root.id, EmbeddingResolution.DOCUMENT)) {
          await this.embedAtResolution(root, EmbeddingResolution.DOCUMENT);
        }
      }
    }
  }
  
  /**
   * Embed a node at a specific resolution
   */
  private async embedAtResolution(
    node: ContentNode,
    resolution: EmbeddingResolution
  ): Promise<void> {
    // For higher resolutions (document/section), we may want to:
    // - Use a summary instead of full text (for very long content)
    // - Concatenate child texts (for section-level)
    
    let textToEmbed = node.text;
    
    if (resolution === EmbeddingResolution.DOCUMENT && node.word_count > 2000) {
      // For very long documents, embed title + first paragraph + last paragraph
      textToEmbed = this.createDocumentSummary(node);
    }
    
    const embedding = await this.embed(textToEmbed);
    
    await this.db.upsertVectorWithResolution(node.id, embedding, resolution);
    await this.db.updateNode(node.id, { embedding_resolution: resolution });
  }
  
  private createDocumentSummary(node: ContentNode): string {
    const parts: string[] = [];
    
    if (node.title) parts.push(node.title);
    
    // First ~500 chars
    const firstChunk = node.text.slice(0, 500);
    parts.push(firstChunk);
    
    // Last ~300 chars
    if (node.text.length > 800) {
      const lastChunk = node.text.slice(-300);
      parts.push(lastChunk);
    }
    
    return parts.join('\n\n');
  }
  
  private hasEmbedding(nodeId: string, resolution: EmbeddingResolution): boolean {
    // Check if vector exists at this resolution
    return this.db.hasVectorAtResolution(nodeId, resolution);
  }
  
  private async embed(text: string): Promise<Float32Array> {
    // Use existing embedding service
    return this.db.generateEmbedding(text);
  }
}
```

### 2.4 Implement Staged Retrieval

**File:** `electron/archive-server/services/retrieval/MultiResolutionRetrieval.ts` (continued)

```typescript
export interface StagedRetrievalOptions {
  coarseLimit: number;      // How many sections/docs to retrieve first
  fineLimit: number;        // How many chunks to retrieve per section
  coarseResolution: EmbeddingResolution;
  fineResolution: EmbeddingResolution;
}

export class StagedRetriever {
  constructor(private db: EmbeddingDatabase) {}
  
  /**
   * Two-stage retrieval: coarse (sections) → fine (chunks)
   */
  async stagedSearch(
    queryEmbedding: Float32Array,
    options: StagedRetrievalOptions
  ): Promise<ContentNode[]> {
    // Stage 1: Retrieve top sections/documents
    const coarseResults = await this.db.vectorSearchByResolution(
      queryEmbedding,
      options.coarseResolution,
      options.coarseLimit
    );
    
    // Extract parent IDs from coarse results
    const parentIds = coarseResults.map(r => r.id);
    
    // Stage 2: Retrieve chunks within those parents
    const fineResults = await this.db.vectorSearchWithParentFilter(
      queryEmbedding,
      parentIds,
      options.fineResolution,
      options.fineLimit
    );
    
    return fineResults;
  }
}
```

### 2.5 Database Method Additions

**File:** `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`

Add these methods:

```typescript
/**
 * Upsert vector with resolution tag
 */
upsertVectorWithResolution(
  nodeId: string,
  embedding: Float32Array,
  resolution: number
): void {
  const contentHash = this.getNodeContentHash(nodeId);
  
  this.db.prepare(`
    INSERT INTO content_nodes_vec (id, content_hash, embedding, resolution)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      embedding = excluded.embedding,
      resolution = excluded.resolution
  `).run(nodeId, contentHash, Buffer.from(embedding.buffer), resolution);
}

/**
 * Check if vector exists at resolution
 */
hasVectorAtResolution(nodeId: string, resolution: number): boolean {
  const row = this.db.prepare(`
    SELECT 1 FROM content_nodes_vec WHERE id = ? AND resolution = ?
  `).get(nodeId, resolution);
  return !!row;
}

/**
 * Vector search filtered by resolution
 */
vectorSearchByResolution(
  queryEmbedding: Float32Array,
  resolution: number,
  limit: number
): ContentNode[] {
  // Using sqlite-vec distance function
  const rows = this.db.prepare(`
    SELECT cn.*, vec_distance_cosine(cnv.embedding, ?) as distance
    FROM content_nodes cn
    JOIN content_nodes_vec cnv ON cn.id = cnv.id
    WHERE cnv.resolution = ?
    ORDER BY distance ASC
    LIMIT ?
  `).all(Buffer.from(queryEmbedding.buffer), resolution, limit);
  
  return rows.map(this.rowToNode);
}

/**
 * Vector search with parent filter
 */
vectorSearchWithParentFilter(
  queryEmbedding: Float32Array,
  parentIds: string[],
  resolution: number,
  limit: number
): ContentNode[] {
  const placeholders = parentIds.map(() => '?').join(',');
  
  const rows = this.db.prepare(`
    SELECT cn.*, vec_distance_cosine(cnv.embedding, ?) as distance
    FROM content_nodes cn
    JOIN content_nodes_vec cnv ON cn.id = cnv.id
    WHERE cnv.resolution = ?
      AND cn.parent_node_id IN (${placeholders})
    ORDER BY distance ASC
    LIMIT ?
  `).all(
    Buffer.from(queryEmbedding.buffer),
    resolution,
    ...parentIds,
    limit
  );
  
  return rows.map(this.rowToNode);
}
```

### 2.6 Success Criteria - Phase 2

- [ ] Migration v17 runs without errors
- [ ] Embeddings stored with `resolution` column (0, 1, or 2)
- [ ] `embedHierarchy()` correctly populates all three levels
- [ ] Staged retrieval returns chunks within relevant parents
- [ ] Performance: staged retrieval faster than flat search for large corpora
- [ ] Unit tests for multi-resolution embedding and retrieval

---

## Phase 3: Hybrid Dense + Sparse Retrieval

**Duration:** 2-3 days  
**Goal:** Fuse FTS5 sparse search with dense vector search

### 3.1 Implement Reciprocal Rank Fusion

**File:** `electron/archive-server/services/retrieval/ReciprocalRankFusion.ts`

```typescript
export interface RankedResult {
  id: string;
  score: number;
  source: 'dense' | 'sparse';
}

export interface FusedResult {
  id: string;
  denseScore: number | null;
  denseRank: number | null;
  sparseScore: number | null;
  sparseRank: number | null;
  fusedScore: number;
}

/**
 * Reciprocal Rank Fusion (RRF)
 * Combines rankings from multiple retrieval systems
 * 
 * Formula: score = Σ 1/(k + rank_i) for each system i
 * k is a constant (typically 60) that dampens the impact of high ranks
 */
export function reciprocalRankFusion(
  denseResults: RankedResult[],
  sparseResults: RankedResult[],
  k: number = 60
): FusedResult[] {
  const fusedMap = new Map<string, FusedResult>();
  
  // Process dense results
  denseResults.forEach((result, index) => {
    const rank = index + 1;
    const existing = fusedMap.get(result.id);
    
    if (existing) {
      existing.denseScore = result.score;
      existing.denseRank = rank;
      existing.fusedScore += 1 / (k + rank);
    } else {
      fusedMap.set(result.id, {
        id: result.id,
        denseScore: result.score,
        denseRank: rank,
        sparseScore: null,
        sparseRank: null,
        fusedScore: 1 / (k + rank)
      });
    }
  });
  
  // Process sparse results
  sparseResults.forEach((result, index) => {
    const rank = index + 1;
    const existing = fusedMap.get(result.id);
    
    if (existing) {
      existing.sparseScore = result.score;
      existing.sparseRank = rank;
      existing.fusedScore += 1 / (k + rank);
    } else {
      fusedMap.set(result.id, {
        id: result.id,
        denseScore: null,
        denseRank: null,
        sparseScore: result.score,
        sparseRank: rank,
        fusedScore: 1 / (k + rank)
      });
    }
  });
  
  // Sort by fused score (descending)
  return Array.from(fusedMap.values())
    .sort((a, b) => b.fusedScore - a.fusedScore);
}
```

### 3.2 Implement Hybrid Search

**File:** `electron/archive-server/services/retrieval/HybridSearch.ts`

```typescript
import { reciprocalRankFusion, type FusedResult } from './ReciprocalRankFusion.js';
import type { EmbeddingDatabase } from '../embeddings/EmbeddingDatabase.js';

export interface HybridSearchOptions {
  denseWeight?: number;      // Weight for dense results (default: 0.7)
  sparseWeight?: number;     // Weight for sparse results (default: 0.3)
  limit?: number;            // Max results to return
  searchLimit?: number;      // Max candidates from each source
  minDenseScore?: number;    // Minimum cosine similarity
  fusionK?: number;          // RRF k parameter
}

const DEFAULT_OPTIONS: HybridSearchOptions = {
  denseWeight: 0.7,
  sparseWeight: 0.3,
  limit: 20,
  searchLimit: 100,
  minDenseScore: 0.3,
  fusionK: 60
};

export class HybridSearchService {
  constructor(private db: EmbeddingDatabase) {}
  
  /**
   * Hybrid search combining dense vectors and FTS5
   */
  async search(
    query: string,
    queryEmbedding: Float32Array,
    options?: Partial<HybridSearchOptions>
  ): Promise<FusedResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    
    // Parallel search
    const [denseResults, sparseResults] = await Promise.all([
      this.denseSearch(queryEmbedding, opts.searchLimit!, opts.minDenseScore!),
      this.sparseSearch(query, opts.searchLimit!)
    ]);
    
    // Fuse results
    const fused = reciprocalRankFusion(
      denseResults.map(r => ({ id: r.id, score: r.similarity, source: 'dense' as const })),
      sparseResults.map(r => ({ id: r.id, score: r.rank, source: 'sparse' as const })),
      opts.fusionK
    );
    
    return fused.slice(0, opts.limit);
  }
  
  /**
   * Dense vector search
   */
  private async denseSearch(
    embedding: Float32Array,
    limit: number,
    minScore: number
  ): Promise<{ id: string; similarity: number }[]> {
    const rows = this.db.prepare(`
      SELECT id, 1 - vec_distance_cosine(embedding, ?) as similarity
      FROM content_nodes_vec
      WHERE similarity >= ?
      ORDER BY similarity DESC
      LIMIT ?
    `).all(Buffer.from(embedding.buffer), minScore, limit);
    
    return rows as { id: string; similarity: number }[];
  }
  
  /**
   * Sparse FTS5 search
   */
  private async sparseSearch(
    query: string,
    limit: number
  ): Promise<{ id: string; rank: number }[]> {
    // Escape special FTS5 characters
    const escapedQuery = this.escapeFTS5Query(query);
    
    const rows = this.db.prepare(`
      SELECT cn.id, fts.rank
      FROM content_nodes cn
      JOIN content_nodes_fts fts ON cn.rowid = fts.rowid
      WHERE content_nodes_fts MATCH ?
      ORDER BY fts.rank
      LIMIT ?
    `).all(escapedQuery, limit);
    
    return rows as { id: string; rank: number }[];
  }
  
  private escapeFTS5Query(query: string): string {
    // Basic escaping - expand as needed
    return query
      .replace(/["\-*()]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 1)
      .map(term => `"${term}"`)
      .join(' OR ');
  }
}
```

### 3.3 Update API Endpoint

**File:** Update `electron/archive-server/routes/ucg.ts` (or equivalent)

```typescript
import { HybridSearchService } from '../services/retrieval/HybridSearch.js';

// POST /api/ucg/search/hybrid
router.post('/search/hybrid', async (req, res) => {
  const { query, options } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }
  
  const hybridSearch = new HybridSearchService(db);
  const queryEmbedding = await embed(query);
  
  const results = await hybridSearch.search(query, queryEmbedding, options);
  
  // Fetch full nodes for results
  const nodes = await Promise.all(
    results.map(async r => ({
      ...r,
      node: await db.getNode(r.id)
    }))
  );
  
  res.json({
    query,
    results: nodes,
    total: nodes.length
  });
});
```

### 3.4 Success Criteria - Phase 3

- [ ] RRF correctly fuses dense and sparse rankings
- [ ] Hybrid search returns results from both sources
- [ ] Exact phrase matches rank higher (sparse contribution)
- [ ] Semantic matches still found (dense contribution)
- [ ] `/api/ucg/search/hybrid` endpoint operational
- [ ] Performance: hybrid search < 500ms for 100 candidates

---

## Phase 4: Quality-Gated Retrieval Pipeline

**Duration:** 2-3 days  
**Goal:** Integrate quality scoring into the retrieval pipeline

### 4.1 Implement Quality-Gated Pipeline

**File:** `electron/archive-server/services/retrieval/QualityGatedPipeline.ts`

```typescript
import { HybridSearchService } from './HybridSearch.js';
import { StagedRetriever, EmbeddingResolution } from './MultiResolutionRetrieval.js';
import type { EmbeddingDatabase } from '../embeddings/EmbeddingDatabase.js';

export interface QualityGateOptions {
  // Retrieval options
  targetCount: number;         // Desired result count
  searchLimit: number;         // Initial candidate pool size
  useStaged: boolean;          // Use multi-resolution retrieval
  
  // Quality thresholds
  minQuality: number;          // Minimum overall quality (0-1)
  minWordCount: number;        // Minimum words
  excludeStubTypes: string[];  // Stub types to filter
  
  // Context expansion
  expandContext: boolean;      // Fetch parent for short chunks
  expandThreshold: number;     // Word count below which to expand
  
  // Optional reranking
  rerank: boolean;
  rerankModel?: string;
}

export interface QualityGatedResult {
  node: ContentNode;
  similarity: number;
  quality: ContentQuality | null;
  context?: {
    parent: ContentNode | null;
    combinedText: string;
  };
  rejected?: {
    reason: string;
  };
}

export interface PipelineStats {
  totalSearched: number;
  totalAccepted: number;
  totalRejected: number;
  rejectionReasons: Record<string, number>;
  totalExpanded: number;
  duration: number;
}

const DEFAULT_OPTIONS: QualityGateOptions = {
  targetCount: 20,
  searchLimit: 100,
  useStaged: true,
  minQuality: 0.4,
  minWordCount: 30,
  excludeStubTypes: ['stub-breadcrumb'],
  expandContext: true,
  expandThreshold: 50,
  rerank: false
};

export class QualityGatedPipeline {
  private hybridSearch: HybridSearchService;
  private stagedRetriever: StagedRetriever;
  
  constructor(private db: EmbeddingDatabase) {
    this.hybridSearch = new HybridSearchService(db);
    this.stagedRetriever = new StagedRetriever(db);
  }
  
  /**
   * Full quality-gated retrieval pipeline
   */
  async search(
    query: string,
    queryEmbedding: Float32Array,
    options?: Partial<QualityGateOptions>
  ): Promise<{ results: QualityGatedResult[]; stats: PipelineStats }> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    
    const stats: PipelineStats = {
      totalSearched: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rejectionReasons: {},
      totalExpanded: 0,
      duration: 0
    };
    
    // Stage 1: Retrieve candidates
    let candidates: { id: string; similarity: number }[];
    
    if (opts.useStaged) {
      const stagedResults = await this.stagedRetriever.stagedSearch(
        queryEmbedding,
        {
          coarseLimit: Math.ceil(opts.searchLimit / 5),
          fineLimit: opts.searchLimit,
          coarseResolution: EmbeddingResolution.SECTION,
          fineResolution: EmbeddingResolution.CHUNK
        }
      );
      candidates = stagedResults.map(n => ({
        id: n.id,
        similarity: n.distance ? 1 - n.distance : 0.5
      }));
    } else {
      const hybridResults = await this.hybridSearch.search(
        query,
        queryEmbedding,
        { searchLimit: opts.searchLimit }
      );
      candidates = hybridResults.map(r => ({
        id: r.id,
        similarity: r.denseScore || 0.5
      }));
    }
    
    stats.totalSearched = candidates.length;
    
    // Stage 2: Quality filter
    const results: QualityGatedResult[] = [];
    
    for (const candidate of candidates) {
      if (results.length >= opts.targetCount) break;
      
      const node = await this.db.getNode(candidate.id);
      if (!node) continue;
      
      const quality = await this.db.getQuality(candidate.id);
      
      // Apply quality gates
      const rejection = this.checkQualityGates(node, quality, opts);
      
      if (rejection) {
        stats.totalRejected++;
        stats.rejectionReasons[rejection] = 
          (stats.rejectionReasons[rejection] || 0) + 1;
        continue;
      }
      
      // Build result
      const result: QualityGatedResult = {
        node,
        similarity: candidate.similarity,
        quality
      };
      
      // Stage 3: Context expansion
      if (opts.expandContext && node.word_count < opts.expandThreshold) {
        const expanded = await this.expandContext(node);
        if (expanded) {
          result.context = expanded;
          stats.totalExpanded++;
        }
      }
      
      results.push(result);
      stats.totalAccepted++;
    }
    
    // Stage 4: Optional reranking
    if (opts.rerank && results.length > 0) {
      // TODO: Implement cross-encoder reranking
      // For now, skip
    }
    
    stats.duration = Date.now() - startTime;
    
    return { results, stats };
  }
  
  /**
   * Check if node passes quality gates
   * Returns rejection reason or null if passed
   */
  private checkQualityGates(
    node: ContentNode,
    quality: ContentQuality | null,
    opts: QualityGateOptions
  ): string | null {
    // Word count check
    if (node.word_count < opts.minWordCount) {
      return 'word-count-too-low';
    }
    
    // Quality score check
    if (quality) {
      if (quality.overall < opts.minQuality) {
        return 'quality-too-low';
      }
      
      if (opts.excludeStubTypes.includes(quality.stub_type)) {
        return `stub-type-${quality.stub_type}`;
      }
    }
    
    return null;
  }
  
  /**
   * Expand context by fetching parent node
   */
  private async expandContext(
    node: ContentNode
  ): Promise<{ parent: ContentNode | null; combinedText: string } | null> {
    if (!node.parent_node_id) return null;
    
    const parent = await this.db.getNode(node.parent_node_id);
    if (!parent) return null;
    
    // Combine parent context with chunk
    const combinedText = parent.title
      ? `${parent.title}\n\n${node.text}`
      : `${parent.text.slice(0, 500)}...\n\n[...]\n\n${node.text}`;
    
    return { parent, combinedText };
  }
}
```

### 4.2 Update Agentic Search API

**File:** Update `/api/ucg/search/agent` endpoint

```typescript
import { QualityGatedPipeline } from '../services/retrieval/QualityGatedPipeline.js';

// POST /api/ucg/search/agent
router.post('/search/agent', async (req, res) => {
  const { query, options } = req.body;
  
  if (!query) {
    return res.status(400).json({ error: 'Query required' });
  }
  
  const pipeline = new QualityGatedPipeline(db);
  const queryEmbedding = await embed(query);
  
  const { results, stats } = await pipeline.search(
    query,
    queryEmbedding,
    {
      targetCount: options?.targetCount || 20,
      searchLimit: options?.searchLimit || 100,
      minQuality: options?.minQuality || 0.4,
      minWordCount: options?.minWordCount || 30,
      expandContext: options?.expandContext ?? true,
      rerank: options?.rerank ?? false
    }
  );
  
  res.json({
    query,
    results: results.map(r => ({
      node: r.node,
      similarity: r.similarity,
      quality: r.quality,
      context: r.context
    })),
    stats
  });
});
```

### 4.3 Success Criteria - Phase 4

- [ ] Quality gates correctly filter low-quality results
- [ ] Stub-breadcrumbs excluded from results
- [ ] Context expansion adds parent text for short chunks
- [ ] Stats track rejection reasons accurately
- [ ] Pipeline < 1s for 100 candidates
- [ ] `/api/ucg/search/agent` returns quality-filtered results

---

## Phase 5: Testing & Validation

**Duration:** 2-3 days  
**Goal:** Comprehensive testing and performance validation

### 5.1 Unit Tests

Create tests for each component:

```
electron/archive-server/services/
├── chunking/__tests__/
│   ├── BoundaryDetector.test.ts
│   ├── SemanticChunker.test.ts
│   └── fixtures/
│       ├── conversation.txt
│       ├── document.md
│       └── expected-chunks.json
│
├── retrieval/__tests__/
│   ├── ReciprocalRankFusion.test.ts
│   ├── HybridSearch.test.ts
│   ├── MultiResolutionRetrieval.test.ts
│   └── QualityGatedPipeline.test.ts
```

### 5.2 Integration Tests

Test the full pipeline:

```typescript
// __tests__/integration/embedding-pipeline.test.ts

describe('Embedding Pipeline Integration', () => {
  let db: EmbeddingDatabase;
  
  beforeAll(async () => {
    db = await createTestDatabase();
    await importTestCorpus(db);
  });
  
  test('semantic chunking preserves topic boundaries', async () => {
    const node = await db.getNode('test-conversation-1');
    const chunks = await db.getChunks(node.id);
    
    // Each chunk should be topically coherent
    for (const chunk of chunks) {
      const coherence = await measureTopicCoherence(chunk.text);
      expect(coherence).toBeGreaterThan(0.7);
    }
  });
  
  test('multi-resolution retrieval improves recall', async () => {
    const query = 'discussion about travel plans';
    const embedding = await embed(query);
    
    // Compare flat vs staged retrieval
    const flatRecall = await measureRecall(
      await flatSearch(embedding, 20),
      groundTruth
    );
    
    const stagedRecall = await measureRecall(
      await stagedSearch(embedding, 20),
      groundTruth
    );
    
    expect(stagedRecall).toBeGreaterThanOrEqual(flatRecall);
  });
  
  test('hybrid search finds both semantic and lexical matches', async () => {
    const query = 'quantum mechanics uncertainty principle';
    const embedding = await embed(query);
    
    const results = await hybridSearch(query, embedding, { limit: 20 });
    
    // Should find exact phrase matches
    const exactMatches = results.filter(r => 
      r.node.text.includes('uncertainty principle')
    );
    expect(exactMatches.length).toBeGreaterThan(0);
    
    // Should also find semantic matches
    const semanticMatches = results.filter(r =>
      r.node.text.includes('Heisenberg') || 
      r.node.text.includes('wave function')
    );
    expect(semanticMatches.length).toBeGreaterThan(0);
  });
  
  test('quality gating filters stub content', async () => {
    const query = 'any topic';
    const embedding = await embed(query);
    
    const { results, stats } = await qualityGatedSearch(query, embedding, {
      excludeStubTypes: ['stub-breadcrumb', 'stub-sentence']
    });
    
    // No stubs in results
    for (const result of results) {
      expect(result.quality?.stub_type).not.toMatch(/^stub-/);
    }
    
    // Some should have been rejected
    expect(stats.totalRejected).toBeGreaterThan(0);
  });
});
```

### 5.3 Performance Benchmarks

```typescript
// __tests__/benchmarks/retrieval-performance.bench.ts

describe('Retrieval Performance', () => {
  test('semantic chunking throughput', async () => {
    const largeDoc = await readFile('fixtures/large-document.txt');
    const chunker = new SemanticChunker();
    
    const start = performance.now();
    const chunks = await chunker.chunk(largeDoc, 'text');
    const duration = performance.now() - start;
    
    console.log(`Chunked ${largeDoc.length} chars in ${duration}ms`);
    console.log(`Produced ${chunks.length} chunks`);
    
    expect(duration).toBeLessThan(5000); // < 5 seconds
  });
  
  test('hybrid search latency', async () => {
    const queries = await loadTestQueries(100);
    const latencies: number[] = [];
    
    for (const query of queries) {
      const embedding = await embed(query);
      const start = performance.now();
      await hybridSearch(query, embedding, { limit: 20 });
      latencies.push(performance.now() - start);
    }
    
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    
    console.log(`Hybrid search p50: ${p50}ms, p95: ${p95}ms`);
    
    expect(p50).toBeLessThan(200);
    expect(p95).toBeLessThan(500);
  });
});
```

### 5.4 Success Criteria - Phase 5

- [ ] All unit tests pass
- [ ] Integration tests demonstrate improved retrieval
- [ ] Performance benchmarks meet targets
- [ ] No regressions in existing functionality

---

## Phase 6 (Future): Late Interaction / ColBERT

**Status:** Research / Design  
**Goal:** Add ColBERT-style retrieval for narrative transformation

This phase is deferred but documented for future implementation:

### 6.1 Scope

- Add multi-vector storage (one vector per token)
- Implement MaxSim scoring for late interaction
- Create specialized index for narrative matching
- Integrate with Narrative Studio

### 6.2 Considerations

- Storage increase: ~10-20x per document
- Index complexity: Specialized ANN for multi-vector
- Use case: Primarily for finding stylistically similar content

### 6.3 Implementation Options

1. **Qdrant multivector** — If migrating to Qdrant
2. **Custom sqlite-vec extension** — Store token embeddings
3. **Separate ColBERT index** — Dedicated file for narrative ops

---

## Summary: Implementation Order

| Phase | Component | Duration | Dependencies |
|-------|-----------|----------|--------------|
| **1** | Semantic Chunking | 3-4 days | None |
| **2** | Multi-Resolution Embeddings | 2-3 days | Phase 1 |
| **3** | Hybrid Dense+Sparse | 2-3 days | None (parallel with 2) |
| **4** | Quality-Gated Pipeline | 2-3 days | Phases 2, 3 |
| **5** | Testing & Validation | 2-3 days | Phases 1-4 |
| **6** | Late Interaction (Future) | TBD | Phases 1-5 |

**Total estimated duration:** 2-3 weeks

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `services/chunking/SemanticChunker.ts` | Semantic boundary detection + chunking |
| `services/chunking/BoundaryDetector.ts` | Embedding-based topic shift detection |
| `services/retrieval/MultiResolutionRetrieval.ts` | 3-level embedding + staged retrieval |
| `services/retrieval/HybridSearch.ts` | Dense + FTS5 fusion |
| `services/retrieval/ReciprocalRankFusion.ts` | RRF algorithm |
| `services/retrieval/QualityGatedPipeline.ts` | Full agentic search pipeline |
| `services/embeddings/EmbeddingMigrations.ts` | Schema v17 migration |

---

## Starting Point for Claude Code

```
I'm implementing a Multi-Resolution Hybrid Hierarchical embedding system for the humanizer-gm UCG.

Reference documents:
- UCG Specification: docs/UCG_SPECIFICATION.md
- This implementation plan: [provide path or paste]

Current state:
- Schema v16 with content_nodes, content_links, content_nodes_vec, content_nodes_fts
- nomic-embed-text 768-dim embeddings via Ollama
- Basic single-vector search operational

Please start with Phase 1: Semantic Chunking Enhancement.

First task: Create the ChunkingStrategy interface and BoundaryDetector class at:
- electron/archive-server/services/chunking/ChunkingStrategy.ts
- electron/archive-server/services/chunking/BoundaryDetector.ts
```

---

**END OF IMPLEMENTATION PLAN**
