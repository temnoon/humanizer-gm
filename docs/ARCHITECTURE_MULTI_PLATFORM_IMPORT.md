# Multi-Platform Import Architecture

**Date**: January 19, 2026
**Status**: Planning

---

## Vision

Import personal data from any platform with minimal configuration. Use agentic parsing to:
1. Auto-detect archive format
2. Recursively discover content
3. Extract text + media + metadata
4. Normalize to Universal Content Graph (UCG)

---

## Platform Support Matrix

| Platform | Export Type | Format | Status |
|----------|-------------|--------|--------|
| ChatGPT | Data export | JSON + media folders | ✅ Done |
| Claude | Projects export | JSON | ✅ Done |
| Facebook | Download Your Data | JSON/HTML + media | ✅ Done |
| Instagram | Download Data | JSON + media | 🔜 Next |
| Reddit | Data request | CSV files | 🔜 Next |
| X/Twitter | Archive | JS + JSON + media | Planned |
| Discord | Data package | JSON + attachments | Planned |
| Substack | Export | HTML/Markdown | Planned |
| Google | Takeout | Mixed (Drive, Docs, Chat) | Planned |

---

## Architecture

### 1. Adapter Registry

```typescript
interface ContentAdapter<T> {
  id: string;
  name: string;
  sourceType: SourceType;
  supportedFormats: string[];

  detect(input: T): Promise<DetectionResult>;
  parse(input: T, options?: AdapterOptions): AsyncIterable<ContentNode>;
  extractLinks(node: ContentNode): ContentLink[];
}
```

### 2. Agentic Import Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│                     Import Pipeline                          │
├─────────────────────────────────────────────────────────────┤
│  1. DETECT                                                   │
│     - Scan archive structure                                 │
│     - Try each adapter's detect() method                     │
│     - Score confidence (0-1)                                 │
│     - Select highest confidence adapter                      │
├─────────────────────────────────────────────────────────────┤
│  2. PARSE (recursive)                                        │
│     - Adapter yields ContentNodes                            │
│     - For nested archives, spawn sub-parsers                 │
│     - Track parent-child relationships                       │
├─────────────────────────────────────────────────────────────┤
│  3. ENRICH (agentic)                                         │
│     - LLM extracts topics, entities, sentiment               │
│     - Generate summaries for long content                    │
│     - Detect language, format, intent                        │
├─────────────────────────────────────────────────────────────┤
│  4. INDEX                                                    │
│     - Store in SQLite (content_items)                        │
│     - Generate embeddings                                    │
│     - Create links between nodes                             │
│     - Index media files                                      │
└─────────────────────────────────────────────────────────────┘
```

### 3. Agentic Format Discovery

For unknown archives, use LLM to analyze:

```typescript
async function discoverFormat(archivePath: string): Promise<FormatHint> {
  // Sample files from archive
  const samples = await sampleArchiveFiles(archivePath, { maxFiles: 10 });

  // Ask LLM to identify format
  const prompt = `
    Analyze these files from a data export archive:
    ${samples.map(s => `File: ${s.path}\nContent (first 500 chars):\n${s.content}`).join('\n\n')}

    Identify:
    1. Which platform is this from?
    2. What format is used (JSON, CSV, HTML, etc)?
    3. Where is the main content stored?
    4. Where are media files stored?
    5. What metadata is available?
  `;

  return await llm.structured(prompt, FormatHintSchema);
}
```

---

## Adapter Specifications

### Reddit Adapter

**Input**: Directory with CSV files
**Key files**:
- `comments.csv` - User comments
- `post_headers.csv` - Post titles/metadata
- `saved_posts.csv` - Saved content
- `messages.csv` - Direct messages

**Schema mapping**:
```typescript
// comments.csv -> ContentNode
{
  id: row.id,
  uri: `content://reddit/comment/${row.id}`,
  content: { text: row.body, format: 'markdown' },
  metadata: {
    createdAt: parseDate(row.date),
    subreddit: row.subreddit,
    sourceMetadata: {
      permalink: row.permalink,
      parent: row.parent,
      gildings: row.gildings,
    }
  },
  source: { type: 'reddit', adapter: 'reddit' }
}
```

### Instagram Adapter

**Input**: Download Your Data folder
**Key files**:
- `your_instagram_activity/messages/inbox/*/message_1.json`
- `your_instagram_activity/content/posts_1.json`
- `your_instagram_activity/content/stories.json`
- `media/` folders

**Format**: JSON with base64-encoded media or file references

### X/Twitter Adapter

**Input**: Twitter archive zip
**Key files**:
- `data/tweets.js` (JSON wrapped in JS assignment)
- `data/direct-messages.js`
- `data/like.js`
- `data/tweet_media/`

**Parsing quirk**: Files start with `window.YTD.tweets.part0 = [`

### Discord Adapter

**Input**: Data package folder
**Key files**:
- `messages/*/messages.json`
- `servers/*/messages/*/messages.json`
- `account/user.json`

### Google Takeout Adapter

**Input**: Takeout zip/folder
**Recursive structure**:
```
Takeout/
├── Drive/
│   └── My Drive/
│       └── *.gdoc, *.gsheet, *.md, etc
├── Chat/
│   └── Groups/
│       └── */messages.json
├── Keep/
│   └── *.json
└── Mail/ (mbox format)
```

**Strategy**: Use folder-adapter as base, detect sub-formats

---

## Implementation Plan

### Phase 1: Core Adapters (Week 1-2)
1. Reddit adapter (CSV parsing)
2. Instagram adapter (JSON + media)

### Phase 2: Complex Formats (Week 3-4)
1. X/Twitter adapter (JS-wrapped JSON)
2. Discord adapter (nested JSON)

### Phase 3: Google Ecosystem (Week 5-6)
1. Google Takeout adapter (recursive)
2. Google Docs conversion
3. Gmail mbox parsing

### Phase 4: Agentic Enhancement (Week 7-8)
1. Auto-format detection
2. LLM-powered metadata extraction
3. Content summarization
4. Entity/topic extraction

---

## API Design

### Import Endpoint

```typescript
POST /api/ucg/import
{
  "source": "/path/to/archive",
  "adapter": "auto" | "reddit" | "instagram" | ...,
  "options": {
    "recursive": true,
    "extractMedia": true,
    "generateEmbeddings": true,
    "enrichWithLLM": false
  }
}
```

### Progress Streaming

```typescript
GET /api/ucg/import/:jobId/stream
// SSE stream of progress events
event: progress
data: { "phase": "parse", "processed": 150, "total": 500 }

event: node
data: { "id": "...", "title": "...", "type": "reddit-comment" }

event: complete
data: { "nodes": 500, "media": 23, "links": 1200 }
```

---

## Available Test Data

| Platform | Location | Size |
|----------|----------|------|
| Facebook | `/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4` | ~500MB |
| Reddit | `/Users/tem/Downloads/reddit_export_tem-noon_20260112/` | ~150KB |
| ChatGPT | `/Users/tem/openai-export-parser/output_v13_final/` | ~4GB (indexed) |

---

## Next Steps

1. [ ] Create Reddit adapter (based on ChatGPT adapter pattern)
2. [ ] Test with available Reddit export
3. [ ] Create Instagram adapter
4. [ ] Build import UI in Electron app
5. [ ] Add progress tracking and cancellation
