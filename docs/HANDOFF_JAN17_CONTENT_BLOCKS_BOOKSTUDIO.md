# Handoff: January 17, 2026

## Session Summary

This session accomplished:
1. **ContentBlockExtractor integration** - Wired up granular content extraction (code, prompts, artifacts)
2. **Import format documentation** - Created 11 ChromaDB memories covering brittleness/robustness of each platform
3. **Book Studio survey** - Comprehensive status of backend/frontend integration
4. **Archive Panel UI sketch** - New unified design for multi-source archives

---

## Critical Issue: Content Block Embedding Failed

**Error**: `Ollama embedding failed: 400 - {"error":"the input length exceeds the context length"}`

**Cause**: Some extracted content blocks exceed nomic-embed-text's 8192 token context window.

**Fix Required** in `ArchiveIndexer.ts` around line 530:

```typescript
// Before generating embedding, truncate long content
const MAX_EMBED_CHARS = 30000; // ~7500 tokens, safe for 8192 limit
const contentToEmbed = block.content.length > MAX_EMBED_CHARS
  ? block.content.slice(0, MAX_EMBED_CHARS) + '...[truncated]'
  : block.content;

const embedding = await this.generateEmbedding(contentToEmbed);
```

**Alternative**: Skip embedding for very long blocks, store metadata only.

---

## Content Block Extraction - What's Done

### Files Modified
- `ContentOperations.ts` - Added `insertContentBlock()`, `getContentBlocksByType()`, `getContentBlocksByGizmo()`
- `VectorOperations.ts` - Added `insertContentBlockEmbedding()`, `searchContentBlocks()`
- `EmbeddingDatabase.ts` - Added delegation methods for all above
- `types.ts` - Added `metadata` field to `Conversation` interface

### Database Tables (from v17 migration)
```sql
content_blocks (
  id, parent_message_id, parent_conversation_id, block_type,
  language, content, start_offset, end_offset, conversation_title,
  gizmo_id, created_at, metadata, embedding_id, extracted_at
)

vec_content_blocks (
  id, block_id, block_type, gizmo_id, embedding float[768]
)
```

### Block Types Extracted
| Type | Pattern | Example |
|------|---------|---------|
| `code` | \`\`\`language...\`\`\` | Code blocks with language |
| `image_prompt` | `{"prompt": "..."}` | DALL-E prompts |
| `artifact` | `<artifact>...</artifact>` | Claude artifacts |
| `canvas` | `<canvas>...</canvas>` | ChatGPT canvas |
| `transcription` | Journal Recognizer output | Notebook OCR |
| `json_data` | Other JSON payloads | Tool outputs |
| `prose` | Everything else | Regular text |

---

## Import Adapters - ChromaDB Memory Summary

Created 11 memories tagged `humanizer,import` covering:

### Platform-Specific Notes

| Platform | Status | Brittle Points | Robust Points |
|----------|--------|----------------|---------------|
| **OpenAI/ChatGPT** | ✅ Done | Mapping DAG changes, media pointer schemes | conversations.json stable since 2023 |
| **Claude/Anthropic** | 🟡 Planned | Artifacts format evolving, MCP tool calls | Linear messages (no DAG) |
| **Google Gemini** | ✅ Done | Takeout restructuring, product renaming | Established Takeout infrastructure |
| **Perplexity** | 🟡 Planned | Citation format, focus mode variations | Core Q&A structure fundamental |
| **Twitter/X** | 🟡 Planned | JS wrapper format, post-Musk changes | GDPR-mandated export |
| **Facebook/Meta** | 🧩 Partial | HTML↔JSON flip-flopping, encoding bugs | GDPR-mandated, core types stable |
| **Discord/MidJourney** | 🟡 Planned | No official export, CDN URL expiration | DiscordChatExporter well-maintained |
| **Substack** | 🟡 Planned | CSV column changes, Notes feature | CSV format simple |
| **Stable Diffusion** | 🟡 Planned | A1111 vs ComfyUI format differences | PNG metadata durable |

### Architecture Memory
- URI conventions: `content://{source}/{type}/{id}`, `media://{sha256}`
- ContentParser interface contract
- Deduplication strategy (uri uniqueness, link triple uniqueness)
- Link types vocabulary

### Brittleness Patterns Memory
- Format detection failures
- Media resolution failures
- Timestamp failures
- Threading/relationship failures
- Content normalization failures
- Mitigation strategies

**To query**: `mcp__chromadb-memory__search_by_tag(["humanizer", "import", "brittle"])`

---

## Book Studio Integration Status

### Fully Wired ✅
| Component | Location | Lines |
|-----------|----------|-------|
| BookOperations.ts | electron/archive-server/services/embeddings/ | 1,302 |
| xanadu.ts IPC handlers | electron/ipc/ | 600+ |
| BookshelfContext.tsx | apps/web/src/lib/bookshelf/ | 590 |
| BooksView.tsx | apps/web/src/components/archive/ | 1,178 |
| Library seed | electron/xanadu/library-seed.ts | 13,500 |

### Partially Done 🟡
- **Narrative Arcs** - Service creates them, IPC handlers missing
- **Chapter Filler** - IPC exists, implementation unclear
- **Book Studio Express** - Routes defined, may be redundant (IPC used)

### Not Started 📝
- Media browser UI
- Link visualization (graph view)
- Book profiles (AI extraction)
- Pyramid summaries
- Outline editor UI

---

## Next Session Tasks (In Order)

### 1. Fix Content Block Embedding (15 min)
Add content truncation in `ArchiveIndexer.ts` to handle long blocks.

### 2. Wire Narrative Arcs IPC (30 min)
Add to `electron/ipc/xanadu.ts`:
```typescript
ipcMain.handle('xanadu:arc:list', ...)
ipcMain.handle('xanadu:arc:get', ...)
ipcMain.handle('xanadu:arc:upsert', ...)
ipcMain.handle('xanadu:arc:delete', ...)
```

### 3. Verify Chapter Filler (15 min)
Check `/electron/services/chapter-filler.js` implementation.

### 4. Decide Express vs IPC (15 min)
Book Studio server may be dead code - BooksView uses IPC directly.

### 5. Add Media Browser (2-3h)
Content-addressable store is ready, needs UI.

### 6. Link Graph View (2-3h)
Reuse graph concept from archive panel sketch.

---

## Archive Panel UI Direction

New unified design supports:
- **Source-agnostic timeline** - All content in one view
- **Faceted filters** - Source, type, date range, tags
- **Four view modes** - Timeline, Grid, Graph, List
- **Smart import** - Auto-detect format, show progress
- **Content-type cards** - Different layouts for conversations, tweets, posts, media

See wireframes in session transcript.

---

## Files Changed This Session

```
electron/archive-server/services/embeddings/
├── ContentBlockExtractor.ts     (existing - ready)
├── ContentOperations.ts         (modified - +80 lines)
├── VectorOperations.ts          (modified - +115 lines)
├── EmbeddingDatabase.ts         (modified - +65 lines)
├── types.ts                     (modified - +1 line)
└── ArchiveIndexer.ts            (existing - calls new methods)
```

---

## Build Status

- **Message embeddings**: ✅ Complete (28,765 / 28,765)
- **Content blocks**: ❌ Failed (context length error)
- **Fix**: Truncate long blocks before embedding

---

## Quick Commands

```bash
# Check current status
curl -s http://localhost:3002/api/embeddings/status | jq .

# RUN CONTENT BLOCKS ONLY (skip message embeddings) - USE THIS NEXT TIME
curl -X POST http://localhost:3002/api/embeddings/extract-blocks

# Full rebuild (messages + content blocks)
curl -X POST http://localhost:3002/api/embeddings/build \
  -H "Content-Type: application/json" \
  -d '{"extractContentBlocks": true}'

# Query ChromaDB for import notes
# Use mcp__chromadb-memory__search_by_tag(["humanizer", "import"])
```

## New Endpoint Added

**POST /api/embeddings/extract-blocks**

Runs ONLY the content block extraction phase, skipping message embedding. Use this when:
- Message embeddings are already complete
- You want to re-extract content blocks after code changes
- Testing content block extraction without waiting for full rebuild

---

## Key File Paths

| Purpose | Path |
|---------|------|
| Content block extraction | `electron/archive-server/services/embeddings/ContentBlockExtractor.ts` |
| Archive indexer | `electron/archive-server/services/embeddings/ArchiveIndexer.ts` |
| Book operations | `electron/archive-server/services/embeddings/BookOperations.ts` |
| IPC handlers | `electron/ipc/xanadu.ts` |
| Bookshelf context | `apps/web/src/lib/bookshelf/BookshelfContext.tsx` |
| Books view UI | `apps/web/src/components/archive/BooksView.tsx` |
| Import adapters spec | User's message in session (comprehensive doc) |

---

*Handoff created: January 17, 2026*
*Schema version: 17*
*Build: Messages complete, content blocks need truncation fix*
