# Universal Content Pipeline - Design Document

**Created**: January 12, 2026
**Status**: Planning for future development
**Goal**: Enable arbitrary content to flow through: detect → parse → chunk → embed → link

---

## Current State

The codebase has strong foundations but they're not fully integrated:

### Existing Components

| Component | Location | Status |
|-----------|----------|--------|
| `ContentParser` interface | `import/ImportPipeline.ts:98` | Defined but not all parsers implement |
| `ContentUnit` format | `import/ImportPipeline.ts:29` | Universal, with URI scheme |
| `ContentChunker` | `embeddings/ContentChunker.ts` | Content-type aware (prose/code/math/table) |
| Pyramid types | `embeddings/types.ts:305` | Full hierarchy defined |
| `XanaduLink` | `embeddings/types.ts:464` | Bidirectional links with spans |
| Import job tracking | `embeddings/types.ts:578` | Phase-based progress |

### Gap Analysis

1. **Facebook parsers** don't implement `ContentParser` interface
2. **No automatic chunking** during import for long content
3. **No pyramid building** integrated into import flow
4. **Embedding failures** for content > 24K chars (nomic-embed-text context limit)

---

## Proposed Architecture

### Phase 1: Universal Parser Interface

All parsers should implement a common interface:

```typescript
interface UniversalParser {
  // Detection
  canParse(source: string | Buffer): Promise<boolean>;
  detectFormat(source: string | Buffer): Promise<FormatInfo>;

  // Parsing
  parse(source: string | Buffer, options?: ParseOptions): Promise<ParseResult>;

  // Streaming for large files
  parseStream?(source: ReadableStream): AsyncGenerator<ContentUnit>;
}

interface FormatInfo {
  format: 'json' | 'html' | 'markdown' | 'plain' | 'binary';
  schema?: string;  // 'facebook-notes', 'openai-export', etc.
  confidence: number;
  hints: string[];
}
```

### Phase 2: Content Ingestion Pipeline

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Detect    │────▶│    Parse     │────▶│    Save     │
│   Format    │     │  to Units    │     │   as Text   │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                    ┌──────────────┐     ┌──────┴──────┐
                    │   Embed      │◀────│    Chunk    │
                    │   Vectors    │     │  (Pyramid)  │
                    └──────────────┘     └─────────────┘
```

Each stage produces artifacts that can be inspected/resumed:

```typescript
interface IngestionJob {
  id: string;
  status: 'detecting' | 'parsing' | 'saving' | 'chunking' | 'embedding' | 'complete';

  // Artifacts
  detectedFormat?: FormatInfo;
  contentUnits?: ContentUnit[];
  chunks?: ChunkResult[];
  embeddings?: EmbeddingResult[];

  // Progress
  progress: number;
  errors: string[];
}
```

### Phase 3: Intelligent Chunking Strategy

Different content types need different chunking:

```typescript
interface ChunkingStrategy {
  // Content analysis
  analyzeContent(text: string): ContentAnalysis;

  // Strategy selection
  selectStrategy(analysis: ContentAnalysis): ChunkerConfig;

  // Execution
  chunk(text: string, config: ChunkerConfig): ChunkResult[];
}

interface ContentAnalysis {
  wordCount: number;
  estimatedTokens: number;
  contentTypes: ContentType[];  // prose, code, math, etc.
  structureType: 'linear' | 'hierarchical' | 'threaded';

  // Recommendations
  needsChunking: boolean;
  needsPyramid: boolean;
  suggestedChunkSize: number;
}
```

**Chunking decision tree:**

```
Content length < 500 words?
  └── Yes: Single embedding, no chunking
  └── No: Content length < 2000 words?
      └── Yes: Simple chunking (paragraphs)
      └── No: Content length < 10000 words?
          └── Yes: ContentChunker with semantic boundaries
          └── No: Full pyramid with LLM summaries
```

### Phase 4: Pyramid Builder Service

```typescript
interface PyramidBuilder {
  // Build pyramid for long content
  buildPyramid(
    content: string,
    options: PyramidBuildConfig
  ): Promise<Pyramid>;

  // Incremental updates
  updatePyramid(
    pyramidId: string,
    newContent: string
  ): Promise<Pyramid>;

  // Search at any level
  searchPyramid(
    pyramidId: string,
    query: string,
    level?: number  // 0 = chunks, 1+ = summaries, -1 = apex
  ): Promise<SearchResult[]>;
}
```

### Phase 5: Auto-Embedding with Fallback

```typescript
interface SmartEmbedder {
  // Embed with automatic chunking for long content
  embed(
    text: string,
    options?: EmbedOptions
  ): Promise<EmbeddingResult>;
}

interface EmbedOptions {
  // Strategy
  strategy: 'single' | 'chunk' | 'pyramid';

  // For chunking
  chunkSize?: number;
  overlap?: number;

  // For pyramid
  buildSummaries?: boolean;

  // Aggregation for search
  aggregation?: 'first' | 'mean' | 'max' | 'weighted';
}

interface EmbeddingResult {
  success: boolean;

  // Single or aggregated embedding
  embedding: number[];

  // Individual chunk embeddings (if chunked)
  chunkEmbeddings?: Array<{
    chunkId: string;
    content: string;
    embedding: number[];
  }>;

  // Metadata
  strategy: string;
  totalTokens: number;
  chunksCreated: number;
}
```

---

## Implementation Priorities

### Immediate (Fix long notes)

1. Add chunking to notes embed endpoint
2. Store chunk embeddings with parent link
3. Aggregate for search (mean pooling)

### Short-term

1. Refactor Facebook parsers to implement `ContentParser`
2. Create `ChunkingStrategy` service
3. Add pyramid building for essays > 5000 words

### Medium-term

1. Create format auto-detector for unknown files
2. Build streaming parser for large archives
3. Implement incremental pyramid updates

### Long-term

1. Multi-modal: images → CLIP embeddings
2. Audio/video → transcripts → text pipeline
3. Cross-archive linking (Facebook ↔ OpenAI ↔ Claude)

---

## Format Registry Pattern

For unknown content, use a registry of format detectors:

```typescript
// Format detector interface
interface FormatDetector {
  name: string;
  detect(sample: string | Buffer): DetectionResult;
}

interface DetectionResult {
  matches: boolean;
  confidence: number;  // 0-1
  parserName?: string;
  hints?: string[];
}

// Registry
class FormatRegistry {
  private detectors: FormatDetector[] = [];

  register(detector: FormatDetector): void;

  detect(content: string | Buffer): FormatInfo {
    const results = this.detectors
      .map(d => ({ detector: d, result: d.detect(content) }))
      .filter(r => r.result.matches)
      .sort((a, b) => b.result.confidence - a.result.confidence);

    return results[0] || { format: 'plain', confidence: 0.1 };
  }
}

// Example detectors
const detectors = [
  {
    name: 'facebook-notes',
    detect: (sample) => {
      if (typeof sample === 'string') {
        const hasNotesV2 = sample.includes('"notes_v2"');
        return { matches: hasNotesV2, confidence: 0.95, parserName: 'NotesParser' };
      }
      return { matches: false, confidence: 0 };
    }
  },
  {
    name: 'openai-export',
    detect: (sample) => {
      if (typeof sample === 'string') {
        const hasMapping = sample.includes('"mapping"') && sample.includes('"current_node"');
        return { matches: hasMapping, confidence: 0.9, parserName: 'OpenAIParser' };
      }
      return { matches: false, confidence: 0 };
    }
  },
  // Add more detectors...
];
```

---

## Xanadu Universal Format

All content ultimately resolves to:

```typescript
interface XanaduUnit {
  // Identity
  uri: string;  // content://facebook/note/123, media://sha256:abc...
  contentHash: string;  // SHA-256 of canonical form

  // Content
  text: string;
  format: 'plain' | 'markdown' | 'html';

  // Structure
  parentUri?: string;
  childUris?: string[];
  position?: number;

  // Embeddings (multiple levels)
  embeddings: {
    level: 'full' | 'chunk' | 'summary' | 'apex';
    vector: number[];
    model: string;
  }[];

  // Links
  links: XanaduLink[];

  // Provenance
  source: {
    type: ImportSourceType;
    originalPath?: string;
    importedAt: number;
  };
}
```

---

## Testing Strategy

For any new parser:

```typescript
// Parser conformance test
describe('MyParser', () => {
  it('implements ContentParser interface', () => {
    const parser = new MyParser();
    expect(parser.canParse).toBeDefined();
    expect(parser.parse).toBeDefined();
  });

  it('returns valid ContentUnits', async () => {
    const result = await parser.parse(sampleData);
    for (const unit of result.units) {
      expect(unit.id).toBeDefined();
      expect(unit.uri).toMatch(/^content:\/\//);
      expect(unit.content).toBeTruthy();
      expect(unit.wordCount).toBeGreaterThan(0);
    }
  });

  it('handles chunking for long content', async () => {
    const result = await parser.parse(longContent);
    const longUnits = result.units.filter(u => u.wordCount > 2000);

    for (const unit of longUnits) {
      expect(unit.metadata?.chunked).toBe(true);
      expect(unit.metadata?.chunkCount).toBeGreaterThan(1);
    }
  });
});
```

---

## Summary

The path to universal content ingestion:

1. **Interface compliance** - All parsers implement `ContentParser`
2. **Smart chunking** - Automatic strategy based on content analysis
3. **Pyramid summaries** - LLM-generated for very long content
4. **Format detection** - Registry-based auto-detection
5. **Xanadu storage** - Content-addressable with bidirectional links

This enables the vision: drop any file, any format, and it flows through to semantically searchable, linked content.
