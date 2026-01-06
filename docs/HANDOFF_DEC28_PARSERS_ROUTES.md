# HANDOFF: Universal Import Pipeline - Parsers & Routes

**Date**: December 28, 2025 (Session 2)
**Branch**: `feature/subjective-intentional-constraint`
**Project**: humanizer-gm (Golden Master)
**Status**: Parsers complete, API routes wired, ready for testing

---

## What Was Built This Session

### 1. OpenAIParser (`services/import/parsers/OpenAIParser.ts`)

Full TypeScript parser for ChatGPT export archives:

```typescript
const parser = createOpenAIParser({ verbose: true });
if (await parser.canParse('/path/to/export.zip')) {
  const result = await parser.parse('/path/to/export.zip', 'openai');
  // result.units: ContentUnit[]
  // result.mediaRefs: MediaRef[]
  // result.links: ContentLink[]
}
```

**Features**:
- ZIP extraction using `adm-zip`
- Detects OpenAI archives by presence of `conversations.json`
- Linearizes mapping tree (DAG) to chronological message order
- Extracts text from multi-part message content
- Extracts media references from:
  - `asset_pointer` (sediment://, file-service://)
  - `attachments` in metadata
  - DALL-E generation metadata
- Creates Xanadu links (message → conversation, message → previous message)
- Maps OpenAI roles to ContentUnit roles ('tool' → 'third_party')

### 2. DocumentParser (`services/import/parsers/DocumentParser.ts`)

Parser for plain text and markdown documents:

```typescript
const parser = createDocumentParser({
  verbose: true,
  chunkByHeadings: true,
  minPassageWords: 50
});
const result = await parser.parse('/path/to/doc.md', 'md');
```

**Features**:
- Handles `.txt`, `.md`, `.markdown` files
- Extracts YAML frontmatter from markdown
- Chunks by headings (configurable)
- Creates passage ContentUnits with parent/sequence links
- Extracts markdown image references

### 3. Import API Routes (`routes/import.ts`)

Full REST API for the import pipeline:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/import/detect` | POST | Detect file type (multipart upload) |
| `/api/import/upload` | POST | Upload file, create pending job |
| `/api/import/:id/start` | POST | Start processing job |
| `/api/import/:id/status` | GET | Poll job progress |
| `/api/import/jobs` | GET | List recent jobs |
| `/api/import/:id` | DELETE | Cancel/delete job |
| `/api/import/file` | POST | Import local file directly |

**Features**:
- File uploads via multer (500MB max)
- Progress tracking via in-memory map + database
- Async processing with poll-based status
- Automatic cleanup of uploaded files on completion

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `services/import/parsers/OpenAIParser.ts` | **Created** | ChatGPT archive parser |
| `services/import/parsers/DocumentParser.ts` | **Created** | Text/markdown parser |
| `services/import/parsers/index.ts` | **Created** | Parser exports |
| `services/import/index.ts` | Modified | Export parsers |
| `routes/import.ts` | **Created** | Import API routes |
| `server.ts` | Modified | Mount import router |
| `services/embeddings/EmbeddingDatabase.ts` | Modified | Fixed getImportJob return types |
| `services/import/media/ContentAddressableStore.ts` | Modified | Fixed null → undefined |
| `package.json` | Modified | Added multer dependency |

---

## Dependencies Added

```json
{
  "dependencies": {
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@types/multer": "^1.4.12"
  }
}
```

---

## Testing the Import Pipeline

### Start the server:
```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev
```

### Test file type detection:
```bash
curl -X POST http://localhost:3002/api/import/detect \
  -F "file=@/path/to/export.zip"
```

### Test full import:
```bash
# 1. Upload file
curl -X POST http://localhost:3002/api/import/upload \
  -F "file=@/path/to/export.zip"
# Returns: { jobId: "abc123", detection: { sourceType: "openai", ... } }

# 2. Start processing
curl -X POST http://localhost:3002/api/import/abc123/start \
  -H "Content-Type: application/json" \
  -d '{"skipEmbeddings": true}'

# 3. Poll status
curl http://localhost:3002/api/import/abc123/status
# Returns: { status: "processing", progress: 0.45, ... }

# 4. List jobs
curl http://localhost:3002/api/import/jobs
```

### Test local file import:
```bash
curl -X POST http://localhost:3002/api/import/file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/export.zip"}'
```

---

## Known Limitations

1. **Media Resolution**: The 4-strategy media matching works for most cases, but some edge cases may not resolve (recorded as errors in job status)

2. **Embedding Generation**: Currently skipped (`skipEmbeddings: true` recommended until embedding service is wired up)

3. **Large Archives**: No streaming - entire archive is extracted to temp directory before processing

4. **Claude Parser**: Not implemented yet (OpenAI and documents only)

---

## Next Steps (Week 2-3)

### Immediate:
1. **Test with real exports** - Try actual ChatGPT and document imports
2. **Wire up embeddings** - Connect to EmbeddingGenerator service
3. **Add Claude parser** - Similar structure to OpenAI parser

### Future:
4. **Add DOCX/PDF extraction** - Install mammoth and pdf-parse
5. **Streaming for large archives** - Process in chunks
6. **Frontend import UI** - Drag-drop upload component

---

## Architecture Summary

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Upload File   │────▶│ FileDetector │────▶│  ImportPipeline │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
        ┌─────────────────────────────────────────────┼─────────────────┐
        │                                             │                 │
        ▼                                             ▼                 ▼
┌───────────────┐                             ┌──────────────┐  ┌──────────────┐
│ OpenAIParser  │                             │ DocumentParser│  │ ClaudeParser │
│               │                             │              │  │   (TODO)     │
└───────┬───────┘                             └──────┬───────┘  └──────────────┘
        │                                             │
        └──────────────────┬──────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ ContentUnit[]│
                    │ MediaRef[]   │
                    │ ContentLink[]│
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌──────────────┐  ┌──────────────┐
│   Database    │  │ ContentAddr  │  │  Xanadu      │
│  (SQLite)     │  │ MediaStore   │  │  Links       │
└───────────────┘  └──────────────┘  └──────────────┘
```

---

## End of Handoff

**Status**: Parsers and API routes complete, TypeScript compiles
**Next**: Test with real ChatGPT exports
**Blockers**: None
