# Handoff: UCG Direct Import & Unified Archive

**Date:** January 18, 2026
**Status:** Implementation Complete, Pending Server Restart
**Next:** Run Facebook import, then discuss new embedding format

---

## What Was Built

### Phase 1-6: UCG Direct Import Pipeline

All imports now flow directly to UCG `content_nodes` table instead of legacy tables.

#### New Files Created

| File | Purpose |
|------|---------|
| `electron/archive-server/services/content-graph/adapters/facebook-adapter.ts` | Parses Facebook/Meta exports → ContentNodes |
| `electron/archive-server/services/content-graph/adapters/folder-adapter.ts` | Recursively imports directories → ContentNodes |
| `apps/web/src/components/archive/UnifiedArchiveView.tsx` | Single view for all UCG content |
| `apps/web/src/lib/content-graph/ucg-search-agent.ts` | Agentic search with quality filtering |
| `docs/UCG_SPECIFICATION.md` | Comprehensive UCG spec for Claude Desktop |

#### Modified Files

| File | Changes |
|------|---------|
| `electron/archive-server/routes/content-graph.ts` | Added `/api/ucg/import/*` routes |
| `electron/archive-server/services/content-graph/index.ts` | Registered Facebook + Folder adapters |
| `electron/archive-server/services/content-graph/adapters/index.ts` | Exported new adapters |
| `apps/web/src/components/archive/ImportView.tsx` | Wired to UCG endpoints |
| `apps/web/src/components/archive/ArchiveTabs.tsx` | Added "All" unified tab |
| `apps/web/src/components/archive/types.ts` | Added 'unified' tab type |
| `apps/web/src/lib/content-graph/index.ts` | Exported search agent |

---

## API Endpoints Ready

```
POST /api/ucg/import/facebook   - Import Facebook export
POST /api/ucg/import/chatgpt    - Import ChatGPT export
POST /api/ucg/import/claude     - Import Claude export
POST /api/ucg/import/folder     - Import directory
POST /api/ucg/import/file       - Auto-detect single file
GET  /api/ucg/import/status/:id - Poll import progress
GET  /api/ucg/import/adapters   - List available adapters
POST /api/ucg/search/agent      - Agentic search with quality filtering
```

---

## Current Database State

**Database:** `/Users/tem/openai-export-parser/output_v13_final/.embeddings.db`

### In UCG (content_nodes)
| Source | Count |
|--------|-------|
| chatgpt | 36,166 |
| gemini | 9 |
| claude | 2 |
| **Total** | **36,177** |

### NOT in UCG (legacy tables)
| Table | Count |
|-------|-------|
| fb_notes | 57 |
| fb_group_content | 1,356 |
| fb_outbound_reactions | 55,009 |
| facebook_media | 1,304 |
| content_items | 47,416 |
| content_blocks | 58,713 |

### Pending Import
**Facebook raw export:** `/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4/`

---

## Next Session Tasks

### 1. Restart Server & Run Import

```bash
# After restarting Electron app:
curl -X POST http://localhost:3002/api/ucg/import/facebook \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4"}'

# Check status:
curl http://localhost:3002/api/ucg/import/status/{importId}
```

### 2. Verify Import

```bash
# Check UCG stats after import:
curl http://localhost:3002/api/ucg/stats

# Should show new facebook-* source types
```

### 3. Discuss New Embedding Format

Topics to cover:
- Current: nomic-embed-text (768 dim) via Ollama
- Chunking strategy (768 token target)
- Staleness detection via `embedding_text_hash`
- New format requirements?

---

## Key Architecture Decisions

1. **Adapters over tables**: New formats only need adapters, not schema changes
2. **Streaming parse**: Adapters yield ContentNodes via AsyncIterable for memory efficiency
3. **Background processing**: Imports run async with polling status endpoint
4. **iterateParseResult helper**: Handles both AsyncIterable and Promise<ParseResult> return types

---

## Files to Review

- **UCG Spec:** `docs/UCG_SPECIFICATION.md` - Complete API and type documentation
- **Facebook Adapter:** `electron/archive-server/services/content-graph/adapters/facebook-adapter.ts`
- **Import Routes:** `electron/archive-server/routes/content-graph.ts` (lines 839-1270)

---

## Technical Notes

- TypeScript compiles clean (`npx tsc --noEmit -p electron/tsconfig.json`)
- Server needs restart to load new routes (currently running old code)
- Archive server runs on port 3002
- UCG routes mounted at `/api/ucg`
