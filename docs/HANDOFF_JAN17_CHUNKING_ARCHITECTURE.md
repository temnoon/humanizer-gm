# Handoff: January 17, 2026 (Session 2)

## Session Summary

This session focused on:
1. **Content block chunking** - Replaced truncation with pyramid L0 spec chunking
2. **Database migrations** - Fixed missing Xanadu tables (personas, harvest_buckets, etc.)
3. **Architecture clarification** - IPC vs Express for Book Studio
4. **Extraction testing** - Multiple iterations to fix context length errors

---

## Critical Fix: Pyramid Chunking (No Truncation)

### Problem
Content block embedding was failing with "context length exceeds limit" because:
- Long content blocks exceeded nomic-embed-text's 8192 token context
- Original approach truncated content, losing information

### Solution
Implemented pyramid L0 spec chunking - ALL content gets embedded, never truncated:

**EmbeddingGenerator.ts** (lines 74-423):
```typescript
// Target ~1000 tokens per chunk (~4000 chars)
const MAX_CHUNK_CHARS = 4000;

export function chunkForEmbedding(text: string): string[] {
  // 1. Try paragraph boundaries (double newlines)
  // 2. Fall back to sentence boundaries (.!?)
  // 3. Fall back to clause boundaries (,;:)
  // 4. Last resort: hard split (rare)
}
```

**ArchiveIndexer.ts** - Added `embedWithRetry()`:
```typescript
async function embedWithRetry(content: string, blockId: string): Promise<number[] | null> {
  try {
    return await embed(content);
  } catch (err) {
    // If context length error, try half size, then quarter size
    // Returns null if all attempts fail (content still stored)
  }
}
```

### Key Principles
- **Never truncate** - All content must be in latent space
- **~4000 chars per chunk** (~1000 tokens, pyramid L0 spec)
- **Never split mid-sentence** - Prefer paragraph → sentence → clause boundaries
- **Parent-child linking** - Chunks reference parent block via metadata
- **Graceful degradation** - If embedding fails, content still stored with `embeddingFailed: true`

---

## Database Migration Fix

### Problem
Schema version was 17 but Xanadu tables (v10+) were missing:
- `personas`
- `styles`
- `books`
- `book_passages`
- `harvest_buckets`
- `narrative_arcs`

### Solution
Reset schema version to 9, let migrations run:
```sql
UPDATE schema_version SET version = 9;
```

After restart, migrations v10-v17 created all missing tables.

---

## Architecture Decision: IPC vs Express

### Finding
Book Studio Express server (port 3004) is **dead code**:
- Frontend uses IPC exclusively via `window.electronAPI.xanadu.*`
- `BookshelfContext.tsx` → IPC → `xanadu.ts` handlers → `EmbeddingDatabase`
- No frontend code calls port 3004

### Architecture
```
Frontend (React)     →  IPC bridge  →  Backend (Electron main)
BooksView.tsx           preload.ts     xanadu.ts handlers
useBookshelf()                         BookOperations.ts (business logic)
                                       EmbeddingDatabase.ts (data access)
                                       SQLite (storage)
```

### Recommendation
Remove or deprecate `electron/book-studio-server/` directory.

---

## Task Status

| Task | Status | Notes |
|------|--------|-------|
| Fix content block embedding | ✅ Done | Pyramid chunking, no truncation |
| Wire Narrative Arcs IPC | ✅ Done | Already in xanadu.ts lines 505-529 |
| Verify Chapter Filler | ✅ Done | 393 lines, fully implemented |
| Decide Express vs IPC | ✅ Done | IPC only, Express is dead code |
| Add Media Browser UI | 📝 Pending | |
| Add Link Graph View | 📝 Pending | |

---

## Content Block Extraction Status

Last run reached ~2600 blocks before failing. With the new retry logic:
- Problematic chunks will auto-retry with smaller sizes
- If all retries fail, content still stored (just not searchable by embedding)
- Metadata marks failed embeddings with `embeddingFailed: true`

### To Continue
```bash
# Restart app to pick up code changes, then:
curl -X POST http://localhost:3002/api/embeddings/extract-blocks

# Monitor progress:
curl -s http://localhost:3002/api/embeddings/status | jq '{current, phase, status}'
```

---

## Files Modified This Session

```
electron/archive-server/services/embeddings/
├── EmbeddingGenerator.ts    (+120 lines - chunkForEmbedding, no truncation)
├── ArchiveIndexer.ts        (+80 lines - embedWithRetry, chunk handling)
```

---

## Key File Paths

| Purpose | Path |
|---------|------|
| Chunking logic | `electron/archive-server/services/embeddings/EmbeddingGenerator.ts:300-423` |
| Block extraction | `electron/archive-server/services/embeddings/ArchiveIndexer.ts:700-810` |
| IPC handlers | `electron/ipc/xanadu.ts` |
| Chapter filler | `electron/services/chapter-filler.ts` |
| Pyramid spec | `~/humanizer_root/docs/curator-system/03-CHUNK-PYRAMID.md` |

---

## ChromaDB Memories Created

Tagged `humanizer,chunking,jan-17-2026`:
- Pyramid L0 chunking implementation
- Content block extraction architecture
- IPC vs Express decision
- Embedding retry strategy

---

*Handoff created: January 17, 2026*
*Schema version: 17*
*Build: Content blocks extraction in progress with retry logic*
