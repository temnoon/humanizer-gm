# Handoff: Semantic Search Debugging

**Date**: December 29, 2024
**Branch**: `feature/subjective-intentional-constraint`
**Status**: Partial fix - semantic search wired but startup errors remain

---

## Context

User requested debugging the AUI for enacting solutions. Investigation revealed semantic search (Explore view) was returning empty results because:

1. The `humanizer-gm` embedding routes were **stubbed out** - just returning "not yet implemented in GM"
2. There's a **72K embedding database** at `/Users/tem/openai-export-parser/output_v13_final/.embeddings.db` that was never being queried

---

## Work Completed

### 1. Wired Embedding Routes (`electron/archive-server/routes/embeddings.ts`)

Replaced stub responses with real service calls:
- `POST /api/embeddings/search/messages` - semantic search using `EmbeddingDatabase.searchMessages()`
- `GET /api/embeddings/stats` - returns embedding counts
- `GET /api/embeddings/status` - indexing status
- `POST /api/embeddings/build` - placeholder (index building deferred)

### 2. Created ESM Loader (`electron/archive-server/services/embeddings/esm-loader.ts`)

The `EmbeddingGenerator` uses `chromadb-default-embed` which is ESM-only. Created a wrapper using `new Function('return import(...)')` to enable dynamic ESM imports from CommonJS context.

### 3. Fixed Schema Migrations (`EmbeddingDatabase.ts`)

The existing database is at **schema version 6**, code expects **version 7**. Fixed migration issues:

**Line 1359**: Removed duplicate `ALTER TABLE content_items ADD COLUMN uri TEXT` (column already exists)

**Line 1371-1373**: Removed problematic index creation:
```sql
-- REMOVED (media_items table exists with different schema):
CREATE INDEX IF NOT EXISTS idx_media_items_hash ON media_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_media_items_imported ON media_items(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_items_mime ON media_items(mime_type);
```

### 4. Rebuilt Native Modules

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm rebuild better-sqlite3
```

---

## Current State

### What Works (when server runs standalone)

```bash
# Start server manually
cd /Users/tem/humanizer_root/humanizer-gm
ARCHIVE_PATH=/Users/tem/openai-export-parser/output_v13_final \
ARCHIVE_SERVER_PORT=3002 \
node dist-electron/archive-server/server.js

# Test semantic search
curl -X POST "http://localhost:3002/api/embeddings/search/messages" \
  -H "Content-Type: application/json" \
  -d '{"query": "QBism", "limit": 3}'

# Returns:
# - QBism vs Other Interpretations (similarity: 0.31)
# - QBism Essence Explained (similarity: 0.28)
```

### What's Broken

**Electron app startup fails** - user reported error when running `npm run electron:dev`. The error details were not captured before compaction was requested.

---

## Files Changed

```
electron/archive-server/
├── routes/embeddings.ts          # Rewired from stubs to real services
├── services/embeddings/
│   ├── esm-loader.ts             # NEW: ESM import wrapper
│   └── EmbeddingDatabase.ts      # Fixed schema migration issues
```

---

## Known Issues

### 1. Schema Version Mismatch
- Database: version 6
- Code expects: version 7
- The `media_items` table exists with a different schema (no `content_hash` column)
- Partial fix applied, but more migration issues may remain

### 2. ESM/CommonJS Module Loading
- `chromadb-default-embed` is ESM-only
- Created `esm-loader.ts` workaround but not fully tested in Electron context
- The `ArchiveIndexer` (for building new embeddings) is not wired up yet

### 3. Electron Startup
- App expects archive server on port 3002
- May try to use "external server" if port appears occupied
- Full error details needed from next session

---

## Next Steps

1. **Capture the startup error** - Run `npm run electron:dev` and share error output
2. **Fix remaining schema issues** - May need to handle more missing columns/tables
3. **Test in Electron context** - The ESM loader may need adjustments for Electron's module resolution
4. **Wire up AUI tools** - Original goal was debugging AUI tool execution

---

## Quick Debug Commands

```bash
# Check if server is running
curl -s http://localhost:3002/api/health

# Check embedding stats
curl -s http://localhost:3002/api/embeddings/stats

# Test semantic search
curl -s -X POST http://localhost:3002/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "your search term", "limit": 5}'

# Check database schema version
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db \
  "SELECT version FROM schema_version;"

# Check what tables exist
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db ".tables"
```

---

## Database Stats

| Metric | Count |
|--------|-------|
| Conversations | 1,720 |
| Messages | 36,255 |
| Message Embeddings | 72,510 |
| Schema Version | 6 (code expects 7) |
| Database Size | 452 MB |

---

**End of Handoff**
