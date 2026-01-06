# HANDOFF: Universal Import Pipeline Foundation

**Date**: December 28, 2025
**Branch**: `feature/subjective-intentional-constraint`
**Project**: humanizer-gm (Golden Master)
**Priority**: HIGH - Core infrastructure complete, parsers needed

---

## Vision: Xanadu Within Your Archive

This session established the foundation for a **universal import system** implementing Ted Nelson's Xanadu principles:

- **Persistent URIs** - Every content unit has a stable address (`content://source/type/id`)
- **Bidirectional Links** - All relationships are two-way and traversable
- **Content-Addressable Media** - Files stored by SHA-256 hash (automatic deduplication)
- **Source Agnostic** - Any input normalizes to unified `ContentUnit` format
- **Single Source of Truth** - SQLite database, no file-based manifests

### Why This Matters

Once content enters the system through the universal import pipeline, the **transformation and analysis engine** can operate on it regardless of origin:

```
OpenAI Export  ─┐
Claude Export  ─┤
Facebook Data  ─┼──► ContentUnit ──► Analysis ──► Transformation ──► Output
PDF / DOCX     ─┤                    (SIC)        (Humanization)
Markdown / TXT ─┘
```

**Content becomes narrative substrate** - tokenized, indexed, semantically searchable, pyramid-summarized, and ready for the Subjective Intentional Constraint analysis that powers the humanizer.

---

## What Was Built This Session

### 1. Database Schema v7

**File**: `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`

Four new tables implementing Xanadu principles:

```sql
-- Bidirectional links between any content URIs
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  source_uri TEXT NOT NULL,
  target_uri TEXT NOT NULL,
  link_type TEXT NOT NULL,  -- 'parent', 'child', 'reference', 'transclusion', 'similar'
  link_strength REAL DEFAULT 1.0,
  source_start INTEGER,     -- Character offsets for precise linking
  source_end INTEGER,
  target_start INTEGER,
  target_end INTEGER,
  label TEXT,
  created_at REAL NOT NULL,
  created_by TEXT           -- 'import', 'user', 'semantic', 'aui'
);

-- Content-addressable media (SHA-256 hash is canonical)
CREATE TABLE media_items (
  id TEXT PRIMARY KEY,
  content_hash TEXT UNIQUE NOT NULL,
  file_path TEXT NOT NULL,  -- media/{hash[0:2]}/{hash[2:4]}/{hash}.ext
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  ...
);

-- Links content to media via hash
CREATE TABLE media_references (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  media_hash TEXT NOT NULL,
  original_pointer TEXT,    -- sediment://, file-service://
  reference_type TEXT NOT NULL,
  ...
);

-- Enhanced import job tracking
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,     -- 'pending', 'extracting', 'parsing', 'indexing', 'embedding', 'completed', 'failed'
  source_type TEXT NOT NULL,
  progress REAL DEFAULT 0,
  ...
);
```

Also added `uri` column to existing `content_items` table.

### 2. ContentAddressableStore

**File**: `electron/archive-server/services/import/media/ContentAddressableStore.ts`

Hash-based media storage with:
- Automatic deduplication (same file = same hash = one copy)
- Sharded directory structure for scalability
- Pointer manifest building for OpenAI reference resolution
- Simplified 4-strategy matching (down from 7)

```typescript
// Store returns existing if hash matches
const result = await store.store('/path/to/image.jpg');
// { id, contentHash: 'a1b2c3...', filePath: 'media/a1/b2/a1b2c3...jpg', isNew: false }
```

### 3. ImportPipeline

**File**: `electron/archive-server/services/import/ImportPipeline.ts`

Universal orchestrator with 6-phase pipeline:
1. **Detection** - Identify file type
2. **Extraction** - Unzip, extract text
3. **Parsing** - Convert to ContentUnit[]
4. **Media** - Store in content-addressable store
5. **Linking** - Create bidirectional links
6. **Embedding** - Generate semantic vectors

```typescript
const pipeline = createImportPipeline(archivePath, db);
pipeline.registerParser(openaiParser);
pipeline.registerParser(documentParser);

const result = await pipeline.import('/path/to/export.zip', {
  sourceType: 'openai',
  sourceName: 'My ChatGPT Export',
}, (progress) => {
  console.log(`${progress.phase}: ${progress.progress * 100}%`);
});
```

### 4. FileTypeDetector

**File**: `electron/archive-server/services/import/detection/FileTypeDetector.ts`

Intelligent detection of:
- File types from extension and magic bytes
- Archive formats (OpenAI, Claude, Facebook)
- Document types (DOCX, ODT, PDF)

```typescript
const detector = createFileTypeDetector();
const result = await detector.detect('/path/to/file.zip');
// { sourceType: 'openai', mimeType: 'application/zip', confidence: 'high' }
```

### 5. TypeScript Types

**File**: `electron/archive-server/services/embeddings/types.ts`

New types for Xanadu architecture:
- `XanaduLink` - Bidirectional link with span offsets
- `MediaItem` - Content-addressable media
- `MediaReference` - Content-to-media linking
- `ImportJob` - Enhanced job tracking
- `ImportSourceType` - All supported source types

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Modified | Schema v7 + accessor methods |
| `electron/archive-server/services/embeddings/types.ts` | Modified | Xanadu types |
| `electron/archive-server/services/import/index.ts` | Created | Module exports |
| `electron/archive-server/services/import/ImportPipeline.ts` | Created | Main orchestrator |
| `electron/archive-server/services/import/media/ContentAddressableStore.ts` | Created | Hash-based storage |
| `electron/archive-server/services/import/detection/FileTypeDetector.ts` | Created | File type detection |

---

## What's Next: Week 2 Tasks

### 1. OpenAI Parser (Priority: HIGH)

Create `electron/archive-server/services/import/parsers/OpenAIParser.ts`:

```typescript
export class OpenAIParser implements ContentParser {
  async canParse(sourcePath: string): Promise<boolean>;
  async parse(sourcePath: string): Promise<ParseResult>;
}
```

Must handle:
- `conversations.json` with nested mapping tree
- Message extraction with role (user/assistant/system/tool)
- Media reference extraction (7 pointer types)
- Link creation (conversation → messages, message → message)

Reference: Python parser at `/Users/tem/openai-export-parser/openai_export_parser/`

### 2. Document Parser (Priority: MEDIUM)

Create `electron/archive-server/services/import/parsers/DocumentParser.ts`:

For `.txt` and `.md` files:
- Section detection (headings)
- Paragraph chunking
- Metadata extraction (frontmatter for .md)

### 3. Extraction Utilities (Priority: MEDIUM)

Create extractors for:
- `DocxExtractor.ts` - Use `mammoth` library
- `PdfExtractor.ts` - Use `pdf-parse` library

### 4. Import API Routes (Priority: HIGH)

Create `electron/archive-server/routes/import.ts`:

```typescript
POST /api/import/upload     // Upload file, return preview
POST /api/import/:id/start  // Begin processing
GET  /api/import/:id/status // Poll progress
DELETE /api/import/:id      // Cancel job
```

### 5. Wire Up Embeddings

Connect import pipeline to existing embedding service for semantic indexing.

---

## Key Architecture Decisions

### 1. Content-Addressable Storage (SHA-256)

**Why**: Same file imported twice = one copy. Media deduplication is automatic.

**Trade-off**: Slightly slower initial import (hashing), but much simpler matching and guaranteed deduplication.

### 2. SQLite as Single Source of Truth

**Why**: No more file-based manifests (`media_manifest.json`, `conversation.html`). Everything in database.

**Trade-off**: Requires migration for existing Python-generated archives. But forward progress is clean.

### 3. 4-Strategy Media Matching (Simplified from 7)

**Strategies**:
1. Direct hash match (sediment://)
2. File-ID match (file-service://)
3. Size match (unique size)
4. Filename match (fallback)

**Why**: Content-addressing makes most strategies redundant. Build pointer-to-hash manifest once during import.

### 4. Parser Registration Pattern

**Why**: Extensible. Add new source types without modifying pipeline core.

```typescript
pipeline.registerParser(new OpenAIParser());
pipeline.registerParser(new ClaudeParser());
pipeline.registerParser(new CustomParser());
```

---

## Testing the Foundation

```bash
cd /Users/tem/humanizer_root/humanizer-gm

# Start dev server (will trigger schema migration)
npm run electron:dev

# Check schema version
sqlite3 /path/to/archive/.embeddings.db "SELECT version FROM schema_version"
# Should return: 7

# Verify new tables exist
sqlite3 /path/to/archive/.embeddings.db ".tables"
# Should include: links, media_items, media_references, import_jobs
```

---

## Reference Materials

### Python Parser (for OpenAI logic)
`/Users/tem/openai-export-parser/openai_export_parser/`
- `parser.py` - Main orchestrator
- `comprehensive_media_matcher.py` - 7-strategy matching
- `media_reference_extractor.py` - Extract all reference types
- `html_generator.py` - HTML output (we skip this)

### ChromaDB Memory
Query: `image matching 7 strategies openai archive`

Contains documentation of all 7 image reference cases and resolution methods.

### Plan Document
`/Users/tem/.claude/plans/immutable-snacking-crayon.md`

Full implementation plan with phases and timelines.

---

## Quick Start for Next Session

```
Recommended first prompt:
"Continue the Universal Import Pipeline. The foundation is complete (schema v7, ContentAddressableStore, ImportPipeline, FileTypeDetector). Next: create the OpenAI parser that produces ContentUnit[] from ChatGPT exports. Reference the Python parser at /Users/tem/openai-export-parser/ for the parsing logic."
```

---

## The Golden Master Vision

This import pipeline is the **ingestion layer** for the Humanizer's Golden Master:

1. **Import** - Any content enters as ContentUnit
2. **Index** - Tokenized, FTS5, semantic embeddings, pyramid summaries
3. **Analyze** - SIC (Subjective Intentional Constraint) scoring
4. **Transform** - Humanization, style transfer, content curation
5. **Export** - Back to any format, with full provenance

The universal import ensures the transformation engine is **content-agnostic** - it works on sentences and semantic units, not file formats.

---

## End of Handoff

**Status**: Foundation complete, ready for parsers
**Next Priority**: OpenAI Parser → Document Parser → API Routes
**Blockers**: None
**Dependencies**: `mammoth` (docx), `pdf-parse` (pdf) - add when needed
