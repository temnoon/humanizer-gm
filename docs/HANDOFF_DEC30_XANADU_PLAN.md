# Handoff: Xanadu-izing Plan + OAuth Complete

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings` (branched from `main`)
**Status**: Plan approved, ready for implementation

---

## Session Summary

### Completed Today

| Task | Status | Details |
|------|--------|---------|
| OAuth Deep Link | ✅ WORKING | Dev: localhost callback, Prod: humanizer:// protocol |
| Title Centering | ✅ FIXED | True viewport center via absolute positioning |
| Production Build | ✅ 165MB DMG | Clean install, protocol registered |
| Git Commit | ✅ 18bd1b4 | 61 files committed to main |
| Xanadu Plan | ✅ APPROVED | 4-phase implementation plan |

---

## OAuth Implementation Details

### Development Mode (localhost callback)
```
User clicks login → Electron starts HTTP server on random port
→ Browser opens: npe-api.../auth/oauth/google/login?redirect=http://127.0.0.1:PORT
→ User authenticates → npe-api redirects to localhost
→ HTTP server receives token → IPC to renderer
→ Browser shows "Login Successful!" page
```

### Production Mode (custom protocol)
```
User clicks login → Browser opens npe-api with redirect=humanizer://auth/callback
→ User authenticates → Browser redirects to humanizer://auth/callback?token=...
→ macOS routes to Humanizer.app via protocol handler
→ Electron parses URL → IPC to renderer
```

### Key Files
| File | Lines | Purpose |
|------|-------|---------|
| `electron/main.ts` | 790-935 | OAuth callback server, protocol handler |
| `electron/preload.ts` | 478-488 | Auth API exposure to renderer |
| `apps/web/src/lib/auth/api.ts` | 145-208 | URL generation, port fetching |
| `apps/web/src/lib/auth/AuthContext.tsx` | 113-149 | Callback listener |

### Known Issue
- Login modal stays open after OAuth success (minor UX, token works)

---

## Title Centering Fix

### Problem
Title "humanizer" was offset left due to CSS Grid centering the center *column*, not accounting for nav arrows.

### Solution
Changed from CSS Grid to Flexbox with absolute positioning:

```css
.studio-topbar {
  display: flex;  /* Was: display: grid */
  justify-content: space-between;
}

.studio-topbar__center {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
```

### Result
Center of "humanizer" (between 'a' and 'n') is now exactly at viewport center.

---

## Xanadu-izing Plan

### Overview
Transform the archive into a Xanadu-style system with:
1. **768-dim embeddings** via Ollama (nomic-embed-text)
2. **Unified content addressing** with automatic URI generation
3. **PDF ingestion** through the import pipeline
4. **Bidirectional links** auto-created during imports

### Phase 1: Embedding Migration (384 → 768)

**Constants to update:**
| File | Line | Change |
|------|------|--------|
| `EmbeddingGenerator.ts` | 23 | `384` → `768` |
| `EmbeddingDatabase.ts` | 30 | `384` → `768` |
| `types.ts` | 215 | `384` → `768` |
| `esm-loader.ts` | 15 | `384` → `768` |

**Provider switch:**
```typescript
// OLD: chromadb-default-embed (transformers.js)
import { pipeline } from 'chromadb-default-embed';

// NEW: Ollama API
const OLLAMA_ENDPOINT = 'http://localhost:11434';
export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
    method: 'POST',
    body: JSON.stringify({ model: 'nomic-embed-text', input: text })
  });
  const data = await response.json();
  return data.embeddings[0]; // 768-dim
}
```

**Startup validation:**
```typescript
async function validateOllama(): Promise<void> {
  const res = await fetch('http://localhost:11434/api/tags');
  const data = await res.json();
  if (!data.models?.some(m => m.name.includes('nomic-embed-text'))) {
    throw new Error('Run: ollama pull nomic-embed-text');
  }
}
```

**Schema migration (v7 → v8):**
- Drop all 11 vec0 tables
- Clear embedding columns
- Recreate with 768-dim
- Re-index all content

### Phase 2: Unified Content + Xanadu Wiring

**URI generation:**
```typescript
function generateContentUri(unit: ContentUnit): string {
  return `content://${unit.source}/${unit.type}/${unit.id}`;
}
// Example: content://openai/conversation/abc123
```

**Auto-linking:**
```typescript
if (unit.parentUri) {
  db.insertLink({
    source_uri: unit.uri,
    target_uri: unit.parentUri,
    link_type: 'parent',
    created_by: 'import'
  });
}
```

**New API routes (links.ts):**
```typescript
GET  /api/links?uri=...           // Get links for URI
GET  /api/content/:uri            // Resolve by URI
POST /api/links                   // Create link
```

### Phase 3: PDF Ingestion

**Install:**
```bash
npm install pdf-parse
```

**Parser (PdfParser.ts):**
```typescript
export class PdfParser implements ContentParser {
  async parse(filePath: string): Promise<ContentUnit[]> {
    const pdf = await pdfParse(buffer);
    return [{
      uri: `content://local/document/${uuid}`,
      unitType: 'document',
      content: pdf.text,
      metadata: { pageCount: pdf.numpages, title: pdf.info?.Title }
    }];
  }
}
```

### Phase 4: Split-Screen UI Polish

**⚠️ STYLIST MUST REVIEW BEFORE IMPLEMENTATION**

Requirements:
- Animated split transition (text "pulls apart")
- Proper padding (2rem) on both panes
- Elegant easing curves
- Book-page aesthetic on right pane

---

## Current Architecture

### Embedding System
| Aspect | Current | Target |
|--------|---------|--------|
| Model | all-MiniLM-L6-v2 | nomic-embed-text |
| Dimensions | 384 | 768 |
| Provider | chromadb-default-embed | Ollama API |
| Storage | SQLite + sqlite-vec | Same |
| Indexed | 72K vectors | Same (re-embedded) |

### Content Schema (v7)
| Table | Purpose |
|-------|---------|
| `content_items` | Unified content (all sources) |
| `links` | Bidirectional Xanadu relationships |
| `media_items` | Content-addressable media (SHA-256) |
| `import_jobs` | Pipeline progress tracking |

### Link Types
- `parent` / `child` - Structural hierarchy
- `reference` - Explicit citation
- `transclusion` - Content embedding
- `similar` - Semantic similarity (auto)
- `follows` - Temporal sequence
- `responds_to` - Reply relationship
- `version_of` - Version history

---

## Files Reference

### Create
| File | Purpose |
|------|---------|
| `electron/archive-server/routes/links.ts` | Link traversal API |
| `electron/archive-server/services/import/parsers/PdfParser.ts` | PDF → ContentUnit |

### Modify
| File | Changes |
|------|---------|
| `EmbeddingGenerator.ts` | Ollama provider, 768-dim |
| `EmbeddingDatabase.ts` | Schema v8, vec0 tables |
| `types.ts` | Update dimension constant |
| `esm-loader.ts` | Update dimension constant |
| `ImportPipeline.ts` | URI generation, link creation |
| `electron/main.ts` | Ollama validation |

---

## Implementation Order

1. **Phase 1.1-1.3**: Constants + Ollama provider (~1 hr)
2. **Phase 1.4**: Schema migration v8 (~30 min)
3. **Phase 2.1-2.2**: URI + auto-linking (~1 hr)
4. **Phase 2.3**: Link traversal API (~1 hr)
5. **Phase 3**: PDF pipeline (~1 hr)
6. **STYLIST REVIEW**: Split-screen design
7. **Phase 4**: UI implementation (~1-2 hrs)
8. **Testing**: Re-index, verify search quality

**Total: 6-8 hours + stylist review**

---

## Prerequisites

Before starting implementation:
1. Ensure Ollama is running: `ollama serve`
2. Pull embedding model: `ollama pull nomic-embed-text`
3. Verify: `curl http://localhost:11434/api/tags`

---

## Success Criteria

- [ ] Ollama validation at startup (helpful error if missing)
- [ ] 768-dim embeddings generated
- [ ] Schema migrates to v8
- [ ] Archives re-indexed (clean rebuild)
- [ ] Search quality noticeably improved
- [ ] PDFs importable and searchable
- [ ] Links auto-created during import
- [ ] `/api/links` endpoint works
- [ ] Split-screen transition elegant (stylist-approved)

---

## Rollback Plan

If migration fails:
1. Restore `SCHEMA_VERSION = 7`
2. Restore `EMBEDDING_DIM = 384`
3. Restore chromadb-default-embed
4. Content data preserved (embeddings regenerable)

---

## Quick Start After Restart

```bash
cd /Users/tem/humanizer_root/humanizer-gm
git checkout feature/xanadu-768-embeddings

# Ensure Ollama is ready
ollama serve &
ollama pull nomic-embed-text

# Start dev
npm run electron:dev
```

---

## Workflow Rules

1. **ALWAYS call stylist-agent BEFORE implementing UI changes**
2. **Ollama required** - fail loudly with setup instructions
3. **Clean rebuild** - drop vec0 tables, re-embed all content
4. **Test in production build** before shipping

---

**End of Handoff**
