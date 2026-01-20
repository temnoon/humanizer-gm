# Universal Content Graph (UCG) Specification

**Version:** 2.0
**Last Updated:** January 2026
**Status:** Production

---

## Overview

The Universal Content Graph (UCG) is a single, universal content interchange format that all sources normalize to. New formats require only adapters, never schema changes.

### Core Principles

1. **One Content Type**: Every piece of content becomes a `ContentNode`
2. **Adapters Over Tables**: New format = new adapter function, not new table
3. **Content Addressing**: SHA-256 hash-based identity enables deduplication and integrity
4. **Link Graph**: All relationships are explicit, bidirectional, traversable
5. **Version Control**: Every mutation creates a new version, history is preserved
6. **Derivatives Track Lineage**: Transformations link back to source

---

## Table of Contents

1. [Data Model](#data-model)
2. [Database Schema](#database-schema)
3. [REST API](#rest-api)
4. [Adapters](#adapters)
5. [Import Pipeline](#import-pipeline)
6. [Search & Retrieval](#search--retrieval)
7. [Quality Scoring](#quality-scoring)

---

## Data Model

### ContentNode

The universal content type. Every piece of content becomes a `ContentNode`.

```typescript
interface ContentNode {
  // === IDENTITY ===
  id: string;                    // UUID v4
  contentHash: string;           // SHA-256 of content.text
  uri: string;                   // content://{sourceType}/{path}

  // === CONTENT ===
  content: {
    text: string;                // Plain text (always present)
    format: ContentFormat;       // 'text' | 'markdown' | 'html' | 'conversation' | ...
    rendered?: string;           // Pre-rendered HTML if needed
    binary?: {                   // For non-text content
      hash: string;              // Reference to blob storage
      mimeType: string;
    };
  };

  // === METADATA ===
  metadata: {
    title?: string;              // Human-readable title
    author?: string;             // Author/creator
    createdAt: number;           // Original creation time (ms since epoch)
    importedAt: number;          // When imported to UCG (ms since epoch)
    wordCount: number;           // Word count
    language?: string;           // ISO language code
    tags: string[];              // User-applied tags
    sourceMetadata: Record<string, unknown>;  // Source-specific data
  };

  // === SOURCE TRACKING ===
  source: {
    type: SourceType;            // 'chatgpt' | 'facebook-post' | 'markdown' | ...
    adapter: string;             // Which adapter created this
    originalId?: string;         // ID in source system
    originalPath?: string;       // Path/location in source
    importBatch?: string;        // Which import job
  };

  // === VERSION CONTROL ===
  version: {
    number: number;              // Monotonic version number
    parentId?: string;           // Previous version ID
    rootId: string;              // Original import node ID
    operation?: string;          // What created this version
    operatorId?: string;         // Who/what made the change
  };

  // === ANCHORS ===
  anchors?: ContentAnchor[];     // Positions for fine-grained linking
}
```

### ContentFormat

Supported content formats:

| Format | Description |
|--------|-------------|
| `text` | Plain text |
| `markdown` | Markdown |
| `html` | HTML |
| `latex` | LaTeX |
| `json` | Structured JSON |
| `code` | Source code (language in metadata) |
| `conversation` | Chat format (messages in sourceMetadata) |
| `binary` | Non-text (image, audio, video, PDF) |

### SourceType

Known source types:

| Category | Types |
|----------|-------|
| AI Assistants | `chatgpt`, `claude`, `gemini` |
| Social Media | `facebook-post`, `facebook-comment`, `facebook-message`, `twitter`, `mastodon` |
| Communication | `discord`, `slack`, `email` |
| Documents | `markdown`, `text`, `pdf`, `docx`, `html`, `epub` |
| Notes | `notebook`, `obsidian`, `notion`, `roam` |
| Other | `rss`, `transform`, `compose`, `import`, `file`, `url`, `passage`, `unknown` |

### ContentLink

Explicit relationship between content nodes:

```typescript
interface ContentLink {
  id: string;                    // UUID
  sourceId: string;              // Source ContentNode ID
  targetId: string;              // Target ContentNode ID
  type: LinkType;                // Relationship type
  strength?: number;             // 0-1 for weighted relationships
  sourceAnchor?: LinkAnchor;     // Position in source
  targetAnchor?: LinkAnchor;     // Position in target
  createdAt: number;             // When created (ms since epoch)
  createdBy?: string;            // User or system ID
  metadata?: Record<string, unknown>;
}
```

### LinkType

Relationship types:

| Category | Types |
|----------|-------|
| Structural | `parent`, `child`, `sibling` |
| Derivation | `derived-from`, `version-of`, `fork-of` |
| Reference | `references`, `responds-to`, `related-to` |
| Curation | `harvested-into`, `placed-in` |
| Temporal | `follows`, `precedes` |

---

## Database Schema

### Tables

#### content_nodes (PRIMARY)

```sql
CREATE TABLE content_nodes (
  -- Identity
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  uri TEXT UNIQUE NOT NULL,

  -- Content
  text TEXT NOT NULL,
  format TEXT NOT NULL,
  rendered TEXT,
  binary_hash TEXT,

  -- Metadata
  title TEXT,
  author TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  tags TEXT,                      -- JSON array
  source_metadata TEXT,           -- JSON object

  -- Source tracking
  source_type TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  source_original_id TEXT,
  source_original_path TEXT,
  import_batch TEXT,

  -- Version control
  version_number INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT REFERENCES content_nodes(id),
  root_id TEXT NOT NULL,
  operation TEXT,
  operator_id TEXT,

  -- Chunking (for large content split into embeddable pieces)
  parent_node_id TEXT REFERENCES content_nodes(id),
  chunk_index INTEGER,
  chunk_start_offset INTEGER,
  chunk_end_offset INTEGER,

  -- Embedding metadata
  embedding_model TEXT,           -- 'nomic-embed-text'
  embedding_at INTEGER,           -- Unix timestamp
  embedding_text_hash TEXT,       -- SHA256 for staleness detection

  -- Hierarchy
  hierarchy_level INTEGER DEFAULT 0,
  thread_root_id TEXT,

  -- Ingestion tracking
  ingested_from_table TEXT,
  ingested_from_id TEXT,
  ingested_at INTEGER,

  -- Anchors
  anchors TEXT,                   -- JSON array

  -- Timestamps
  created_at INTEGER NOT NULL,
  imported_at INTEGER NOT NULL
);
```

#### content_links

```sql
CREATE TABLE content_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES content_nodes(id),
  target_id TEXT NOT NULL REFERENCES content_nodes(id),
  link_type TEXT NOT NULL,
  strength REAL,
  source_anchor_start INTEGER,
  source_anchor_end INTEGER,
  source_anchor_text TEXT,
  target_anchor_start INTEGER,
  target_anchor_end INTEGER,
  target_anchor_text TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  metadata TEXT,
  UNIQUE(source_id, target_id, link_type)
);
```

#### content_blobs

```sql
CREATE TABLE content_blobs (
  hash TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

#### content_quality

```sql
CREATE TABLE content_quality (
  node_id TEXT PRIMARY KEY REFERENCES content_nodes(id),
  authenticity REAL,              -- SIC analysis (0-1)
  necessity REAL,                 -- Chekhov gun (0-1)
  inflection REAL,                -- Quantum reading (0-1)
  voice REAL,                     -- Style coherence (0-1)
  overall REAL,                   -- Weighted composite (0-1)
  stub_type TEXT,                 -- Classification
  sic_category TEXT,              -- SIC classification
  analyzed_at INTEGER NOT NULL,
  analyzer_version TEXT,
  analysis_json TEXT              -- Full analysis results
);
```

#### content_nodes_fts (FTS5 Virtual Table)

```sql
CREATE VIRTUAL TABLE content_nodes_fts USING fts5(
  text, title,
  content='content_nodes',
  content_rowid='rowid'
);
```

#### content_nodes_vec (Vector Virtual Table)

Requires sqlite-vec extension.

```sql
CREATE VIRTUAL TABLE content_nodes_vec USING vec0(
  id TEXT PRIMARY KEY,
  content_hash TEXT,
  embedding float[768]            -- nomic-embed-text dimension
);
```

---

## REST API

Base URL: `http://localhost:3002/api/ucg`

### Node Operations

#### Create Node
```http
POST /nodes
Content-Type: application/json

{
  "text": "Content text here",
  "format": "text",
  "title": "Optional title",
  "sourceType": "import",
  "tags": ["tag1", "tag2"],
  "sourceMetadata": {}
}
```

Response: `201 Created` with full ContentNode

#### Get Node
```http
GET /nodes/:id
```

Response: `200 OK` with ContentNode or `404 Not Found`

#### Query Nodes
```http
POST /nodes/query
Content-Type: application/json

{
  "sourceType": "chatgpt",        // or ["chatgpt", "claude"]
  "tags": ["important"],          // AND filter
  "dateRange": {
    "start": 1704067200000,
    "end": 1735689600000
  },
  "searchQuery": "optional text",
  "limit": 50,
  "offset": 0,
  "orderBy": "createdAt",         // or "importedAt", "title", "wordCount"
  "orderDirection": "desc"        // or "asc"
}
```

Response: `200 OK` with array of ContentNodes

#### Update Node
```http
PUT /nodes/:id
Content-Type: application/json

{
  "text": "Updated content",
  "title": "Updated title",
  "tags": ["new-tag"]
}
```

Response: `200 OK` with updated ContentNode (new version created)

#### Delete Node
```http
DELETE /nodes/:id
```

Response: `204 No Content`

### Link Operations

#### Create Link
```http
POST /links
Content-Type: application/json

{
  "sourceId": "uuid-of-source-node",
  "targetId": "uuid-of-target-node",
  "type": "derived-from",
  "strength": 0.8,
  "metadata": {}
}
```

Response: `201 Created` with ContentLink

#### Get Links for Node
```http
GET /links/:nodeId?direction=both&type=derived-from
```

Query params:
- `direction`: `outgoing` | `incoming` | `both` (default: `both`)
- `type`: LinkType filter (optional)

Response: `200 OK` with array of ContentLinks

### Import Operations

#### Import Facebook Export
```http
POST /import/facebook
Content-Type: application/json

{
  "exportPath": "/path/to/facebook-export"
}
```

Response: `202 Accepted`
```json
{
  "success": true,
  "importId": "uuid-of-import-job",
  "message": "Facebook import started"
}
```

#### Import Folder
```http
POST /import/folder
Content-Type: application/json

{
  "folderPath": "/path/to/documents",
  "recursive": true,
  "extensions": [".md", ".txt"]   // optional filter
}
```

#### Import ChatGPT
```http
POST /import/chatgpt
Content-Type: application/json

{
  "archivePath": "/path/to/chatgpt-export.zip"
}
```

#### Import Claude
```http
POST /import/claude
Content-Type: application/json

{
  "archivePath": "/path/to/claude-export.json"
}
```

#### Import Single File (Auto-Detect)
```http
POST /import/file
Content-Type: application/json

{
  "filePath": "/path/to/file.md"
}
```

#### Get Import Status
```http
GET /import/status/:importId
```

Response:
```json
{
  "id": "uuid",
  "status": "parsing" | "ingesting" | "complete" | "error",
  "progress": 75,
  "nodeCount": 150,
  "error": null,
  "startedAt": 1704067200000,
  "completedAt": null
}
```

#### List Available Adapters
```http
GET /import/adapters
```

Response:
```json
{
  "adapters": [
    {
      "id": "chatgpt",
      "name": "ChatGPT Export",
      "sourceType": "chatgpt",
      "priority": 100
    },
    ...
  ]
}
```

### Search Operations

#### Full-Text Search
```http
GET /search/fulltext?q=search+terms&limit=50
```

#### Semantic Search
```http
POST /search/semantic
Content-Type: application/json

{
  "query": "natural language query",
  "limit": 20,
  "threshold": 0.5,
  "includeParent": true
}
```

Response:
```json
{
  "query": "natural language query",
  "results": [
    {
      "node": { /* ContentNode */ },
      "similarity": 0.87,
      "parent": { /* Parent ContentNode if chunk */ }
    }
  ],
  "total": 15
}
```

#### Agentic Search (Quality-Filtered)
```http
POST /search/agent
Content-Type: application/json

{
  "query": "search query",
  "targetCount": 20,
  "searchLimit": 100,
  "minQuality": 2.5,
  "minWordCount": 30,
  "expandContext": true
}
```

Response:
```json
{
  "query": "search query",
  "results": [
    {
      "node": { /* ContentNode */ },
      "similarity": 0.85,
      "quality": {
        "overall": 3.8,
        "specificity": 4.0,
        "coherence": 3.5,
        "substance": 4.0
      },
      "context": {
        "parent": { /* Optional parent node */ },
        "combinedText": "Expanded content..."
      },
      "cluster": "chatgpt-0"
    }
  ],
  "stats": {
    "totalSearched": 100,
    "totalAccepted": 20,
    "totalRejected": 75,
    "totalExpanded": 5,
    "clusters": 3,
    "exhausted": false,
    "duration": 1250
  }
}
```

### Graph Operations

#### Get Related Nodes
```http
GET /graph/related/:nodeId?depth=2&types=derived-from,references
```

#### Get Lineage
```http
GET /graph/lineage/:nodeId
```

Response includes ancestors, descendants, and version history.

### Stats

#### Get UCG Statistics
```http
GET /stats
```

Response:
```json
{
  "totalNodes": 15000,
  "totalLinks": 8500,
  "nodesBySourceType": {
    "chatgpt": 10000,
    "facebook-post": 3000,
    "markdown": 2000
  },
  "nodesByFormat": {
    "conversation": 10000,
    "text": 5000
  },
  "nodesWithEmbeddings": 12000
}
```

---

## Adapters

### Interface

```typescript
interface ContentAdapter<TInput = unknown> {
  readonly id: string;               // Unique identifier
  readonly name: string;             // Human-readable name
  readonly sourceType: SourceType;   // Default source type
  readonly supportedFormats: string[];
  readonly version: string;

  // Detect if this adapter can handle the input
  detect(input: TInput): Promise<DetectionResult>;

  // Parse input into ContentNodes (streaming)
  parse(
    input: TInput,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode>;

  // Optional: Extract links between nodes
  extractLinks?(node: ContentNode, allNodes?: ContentNode[]): ContentLink[];
}
```

### Built-in Adapters

| Adapter | ID | Source Types | Priority |
|---------|-----|--------------|----------|
| ChatGPT | `chatgpt` | `chatgpt` | 100 |
| Claude | `claude` | `claude` | 90 |
| Facebook | `facebook` | `facebook-post`, `facebook-comment`, `facebook-message` | 80 |
| Markdown | `markdown` | `markdown` | 50 |
| Folder | `folder` | `file`, `markdown`, `text` | 30 |
| Text | `text` | `text` | 10 |

### Creating a Custom Adapter

```typescript
import { randomUUID } from 'crypto';
import type {
  ContentNode,
  ContentAdapter,
  DetectionResult,
  AdapterOptions,
} from '@humanizer/core';

export class MyFormatAdapter implements ContentAdapter<string> {
  readonly id = 'myformat';
  readonly name = 'My Format';
  readonly sourceType = 'import' as const;
  readonly supportedFormats = ['.myf', 'application/myformat'];
  readonly version = '1.0.0';

  async detect(input: string): Promise<DetectionResult> {
    // Check if this adapter can handle the input
    if (input.startsWith('MYFORMAT:')) {
      return { canHandle: true, confidence: 1.0 };
    }
    return { canHandle: false, confidence: 0 };
  }

  async *parse(
    input: string,
    options?: AdapterOptions
  ): AsyncIterable<ContentNode> {
    const batchId = options?.batchId || randomUUID();

    // Parse your format and yield ContentNodes
    const items = parseMyFormat(input);

    for (const item of items) {
      yield {
        id: randomUUID(),
        contentHash: '', // Will be computed
        uri: `content://myformat/${item.id}`,
        content: {
          text: item.text,
          format: 'text',
        },
        metadata: {
          title: item.title,
          createdAt: item.timestamp,
          importedAt: Date.now(),
          wordCount: item.text.split(/\s+/).length,
          tags: [],
          sourceMetadata: {},
        },
        source: {
          type: 'import',
          adapter: this.id,
          originalId: item.id,
          importBatch: batchId,
        },
        version: {
          number: 1,
          rootId: '', // Will be set to id
        },
      };
    }
  }
}
```

### Registering an Adapter

```typescript
import { adapterRegistry, registerBuiltinAdapter } from './AdapterRegistry';
import { createMyFormatAdapter } from './my-format-adapter';

// Register with priority (higher = checked first for auto-detection)
registerBuiltinAdapter(createMyFormatAdapter, 60);
```

---

## Import Pipeline

### Flow

```
┌──────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│   Source     │ -> │   Adapter   │ -> │   Chunker   │ -> │  Database    │
│   (File/     │    │   (Parse)   │    │  (Split if  │    │  (Insert +   │
│    Folder)   │    │             │    │   needed)   │    │   Embed)     │
└──────────────┘    └─────────────┘    └─────────────┘    └──────────────┘
```

### Chunking

Large content is split into embeddable chunks (768 tokens target):

- **Parent node**: Full content, `parent_node_id = NULL`
- **Chunk nodes**: Pieces, `parent_node_id` = parent, `chunk_index` = sequence

Chunks are linked:
- `derived-from` link: chunk -> parent
- `parent` link: parent -> chunk
- `follows`/`precedes` links: chunk <-> adjacent chunk

### Embedding

Embeddings are generated using `nomic-embed-text` (768 dimensions) via Ollama:

1. Chunk content to target ~768 tokens
2. Generate embeddings in batches
3. Store in `content_nodes_vec` virtual table
4. Track staleness via `embedding_text_hash`

---

## Search & Retrieval

### Full-Text Search

Uses SQLite FTS5:
- Searches `text` and `title` fields
- Returns ranked results
- Supports FTS5 query syntax

### Semantic Search

Uses vector similarity:

```typescript
const results = graphDb.searchByEmbedding(
  queryEmbedding,  // float[768]
  limit,           // max results
  threshold        // minimum similarity (0-1)
);
```

### Agentic Search

Quality-filtered search pipeline:

1. **Search**: Fetch large result set via semantic search
2. **Grade**: Score each result on specificity, coherence, substance
3. **Expand**: Fetch parent context for short fragments
4. **Cluster**: Group by source type
5. **Return**: Quality-filtered results up to target count

---

## Quality Scoring

### Metrics

| Metric | Description | Range |
|--------|-------------|-------|
| `authenticity` | SIC analysis (human vs AI) | 0-1 |
| `necessity` | Chekhov gun (earns its place) | 0-1 |
| `inflection` | Quantum reading (meaning density) | 0-1 |
| `voice` | Style coherence | 0-1 |
| `overall` | Weighted composite | 0-1 |

### Stub Classification

| Type | Description |
|------|-------------|
| `stub-sentence` | Single incomplete sentence |
| `stub-breadcrumb` | Reference/pointer only |
| `optimal` | Complete, self-contained |
| `over-elaborated` | Unnecessarily verbose |

### SIC Categories

| Category | Description |
|----------|-------------|
| `polished-human` | Edited human writing |
| `raw-human` | Unedited human writing |
| `neat-slop` | AI-generated, polished |
| `raw-slop` | AI-generated, unedited |

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `202` | Accepted (async operation started) |
| `204` | No Content (successful delete) |
| `400` | Bad Request (validation error) |
| `404` | Not Found |
| `500` | Internal Server Error |

### Error Response Format

```json
{
  "error": "Human-readable error message"
}
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARCHIVE_PORT` | `3002` | Archive server port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server for embeddings |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model name |

### Embedding Dimensions

The system uses 768-dimensional embeddings (nomic-embed-text). This is hardcoded in the schema as `EMBEDDING_DIM = 768`.

---

## Examples

### Import Facebook and Search

```typescript
// 1. Start import
const importResponse = await fetch('/api/ucg/import/facebook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ exportPath: '/Users/me/facebook-export' }),
});
const { importId } = await importResponse.json();

// 2. Poll for completion
let status;
do {
  await new Promise(r => setTimeout(r, 1000));
  const statusResponse = await fetch(`/api/ucg/import/status/${importId}`);
  status = await statusResponse.json();
} while (status.status !== 'complete' && status.status !== 'error');

// 3. Search imported content
const searchResponse = await fetch('/api/ucg/search/semantic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'conversations about travel',
    limit: 20,
  }),
});
const { results } = await searchResponse.json();
```

### Create and Link Nodes

```typescript
// 1. Create a node
const node1 = await fetch('/api/ucg/nodes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'Original content here',
    format: 'text',
    sourceType: 'compose',
    title: 'My Note',
  }),
}).then(r => r.json());

// 2. Create a derivative node
const node2 = await fetch('/api/ucg/nodes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'Transformed version of the content',
    format: 'text',
    sourceType: 'transform',
    title: 'My Note (Edited)',
  }),
}).then(r => r.json());

// 3. Link them
await fetch('/api/ucg/links', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sourceId: node2.id,
    targetId: node1.id,
    type: 'derived-from',
  }),
});
```

---

## Changelog

### Version 2.0 (January 2026)
- Added Facebook adapter for UCG direct import
- Added Folder adapter for directory scanning
- Added UCG import routes (`/api/ucg/import/*`)
- Added UnifiedArchiveView component
- Added agentic search with quality filtering
- Added chunking and embedding metadata columns
- Added content quality table

### Version 1.0 (December 2025)
- Initial UCG implementation
- ChatGPT, Claude, Markdown, Text adapters
- Basic CRUD operations
- Full-text and semantic search
- Link graph with traversal
