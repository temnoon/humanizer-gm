# Handoff: Vision + Embedding Architecture Fix

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: ARCHITECTURAL ISSUES IDENTIFIED - 3-Phase Fix Required
**Priority**: BLOCKING before merge to main

---

## Executive Summary

House Agent review identified critical architectural violations in the image analysis pipeline:

1. **Bypass Scripts**: Two implementations hardcode model selection, ignoring the vetted vision factory
2. **Missing Embeddings**: Image descriptions are stored as text but never embedded for semantic search
3. **Broken Search**: "Find sunset images" only does keyword matching, not semantic similarity

**Time Estimate**: 6-8 hours total across 3 phases

---

## Current State

### What Works
- ✅ 36,255 message embeddings (768-dim nomic-embed-text)
- ✅ 1,720 conversations indexed
- ✅ 9 images analyzed with descriptions
- ✅ Vision infrastructure exists (`electron/vision/`) with 19 vetted models
- ✅ Ollama running with qwen3-vl:8b and nomic-embed-text

### What's Broken
- ❌ `scripts/direct-image-analysis.py` hardcodes `qwen3-vl:8b`
- ❌ `VisualModelService.ts` hardcodes model array, no factory usage
- ❌ Image descriptions not embedded (no semantic search)
- ❌ No `vec_image_descriptions` table
- ❌ Output filtering from profiles not applied

---

## Phase 1: Fix Vision Model Selection (2 hours)

### Goal
Use the existing vision factory instead of hardcoded models.

### Files to Modify

#### 1. `scripts/direct-image-analysis.py`

**Current (WRONG):**
```python
OLLAMA_URL = "http://localhost:11434/api/generate"
# Hardcoded model
payload = json.dumps({
    "model": "qwen3-vl:8b",
    ...
})
```

**Fix**: Either:
- A) Rewrite as TypeScript to use vision factory directly
- B) Call the gallery API endpoint (after fixing it)
- C) Accept model as parameter with validation

**Recommended (Option C):**
```python
#!/usr/bin/env python3
import sys

# Vetted models from electron/vision/profiles.ts
VETTED_OLLAMA_MODELS = [
    'qwen3-vl:8b', 'qwen2-vl:7b', 'llava:13b', 'llava:7b',
    'llava:34b', 'llama3.2-vision:11b', 'minicpm-v:8b'
]

def get_model():
    model = os.environ.get('VISION_MODEL', 'qwen3-vl:8b')
    if model not in VETTED_OLLAMA_MODELS:
        print(f"WARNING: {model} not in vetted list. Using qwen3-vl:8b")
        model = 'qwen3-vl:8b'
    return model
```

#### 2. `electron/archive-server/services/vision/VisualModelService.ts`

**Current (WRONG, line 18):**
```typescript
const VISION_MODELS = ['qwen3-vl:8b', 'llava:13b', 'llava'];
```

**Fix**: Import from vision factory:
```typescript
import {
  getVisionProviderFactory,
  getVisionProfile,
  filterVisionOutput
} from '../../../vision/index.js';

export async function getAvailableVisionModel(): Promise<string | null> {
  const factory = getVisionProviderFactory();
  const provider = await factory.getBestProvider();
  if (!provider) return null;

  // Get first available vetted model
  const models = await provider.listModels();
  for (const model of models) {
    if (getVisionProfile(model)?.vetted) {
      return model;
    }
  }
  return models[0] || null;
}
```

#### 3. Apply Output Filtering

**Current (WRONG):** Raw model output used directly

**Fix** in `VisualModelService.ts`:
```typescript
import { filterVisionOutput, getVisionProfile } from '../../../vision/index.js';

async function callVisionModel(imagePath: string, prompt: string, options = {}) {
  // ... existing code to call Ollama ...

  const rawResponse = data.response || '';
  const profile = getVisionProfile(model);

  // Apply output filtering based on model profile
  const filtered = filterVisionOutput(rawResponse, profile);

  return {
    response: filtered.cleanedOutput,
    model,
    timeMs,
  };
}
```

### Testing Phase 1
```bash
# Test model selection
curl -s http://localhost:3002/api/gallery/analyze -X POST \
  -H "Content-Type: application/json" \
  -d '{"limit": 1}'

# Should use factory, not hardcoded model
# Check logs for: "[vision] Using model: qwen3-vl:8b (vetted: true)"
```

---

## Phase 2: Add Description Embeddings (3 hours)

### Goal
Embed image descriptions using nomic-embed-text for semantic search.

### Database Schema Changes

#### File: `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`

Add to `createTables()` method (around line 1140):

```typescript
// Image description text embeddings (768-dim nomic-embed-text)
CREATE TABLE IF NOT EXISTS image_description_embeddings (
  id TEXT PRIMARY KEY,
  image_analysis_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL DEFAULT 'nomic-embed-text',
  dimensions INTEGER NOT NULL DEFAULT 768,
  created_at REAL NOT NULL,
  FOREIGN KEY (image_analysis_id) REFERENCES image_analysis(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_desc_analysis
  ON image_description_embeddings(image_analysis_id);
```

Add to vec0 table creation (around line 1508):

```typescript
CREATE VIRTUAL TABLE IF NOT EXISTS vec_image_descriptions USING vec0(
  id TEXT PRIMARY KEY,
  image_analysis_id TEXT,
  source TEXT,
  embedding float[768]
);
```

### New Methods to Add

#### `insertImageDescriptionEmbedding()`
```typescript
/**
 * Insert text embedding for an image description
 */
insertImageDescriptionEmbedding(data: {
  id: string;
  imageAnalysisId: string;
  text: string;
  embedding: number[];
}): void {
  const embeddingBuffer = Buffer.from(new Float32Array(data.embedding).buffer);

  this.db.prepare(`
    INSERT OR REPLACE INTO image_description_embeddings
    (id, image_analysis_id, text, embedding, model, dimensions, created_at)
    VALUES (?, ?, ?, ?, 'nomic-embed-text', 768, ?)
  `).run(
    data.id,
    data.imageAnalysisId,
    data.text,
    embeddingBuffer,
    Date.now() / 1000
  );

  // Also insert into vec0 table for similarity search
  if (this.vecLoaded) {
    const analysis = this.getImageAnalysisById(data.imageAnalysisId);
    if (analysis) {
      this.db.prepare(`
        INSERT OR REPLACE INTO vec_image_descriptions
        (id, image_analysis_id, source, embedding)
        VALUES (?, ?, ?, ?)
      `).run(data.id, data.imageAnalysisId, analysis.source, embeddingBuffer);
    }
  }
}
```

#### `searchImageDescriptionsByVector()`
```typescript
/**
 * Search image descriptions by semantic similarity
 */
searchImageDescriptionsByVector(
  queryEmbedding: number[] | Float32Array,
  options?: { limit?: number; source?: string }
): Array<{
  id: string;
  imageAnalysisId: string;
  filePath: string;
  description: string;
  similarity: number;
}> {
  const limit = options?.limit || 20;
  const embeddingBuffer = Buffer.from(
    queryEmbedding instanceof Float32Array
      ? queryEmbedding.buffer
      : new Float32Array(queryEmbedding).buffer
  );

  let sql = `
    SELECT v.id, v.image_analysis_id, v.distance,
           ia.file_path, ia.description, ia.source
    FROM vec_image_descriptions v
    JOIN image_analysis ia ON ia.id = v.image_analysis_id
    WHERE v.embedding MATCH ?
  `;

  if (options?.source) {
    sql += ` AND v.source = '${options.source}'`;
  }

  sql += ` ORDER BY v.distance LIMIT ${limit}`;

  const rows = this.db.prepare(sql).all(embeddingBuffer);

  return rows.map((row: any) => ({
    id: row.id,
    imageAnalysisId: row.image_analysis_id,
    filePath: row.file_path,
    description: row.description,
    similarity: 1 - row.distance, // Convert distance to similarity
  }));
}
```

### Update Image Analysis Flow

#### File: `electron/archive-server/routes/gallery.ts`

After storing image analysis, also embed the description:

```typescript
// In POST /analyze handler, after db.upsertImageAnalysis():

// Embed the description for semantic search
if (analysis.description) {
  const { embed } = await import('../services/embeddings/EmbeddingGenerator.js');
  const descEmbedding = await embed(analysis.description);

  db.insertImageDescriptionEmbedding({
    id: crypto.randomUUID(),
    imageAnalysisId: id,
    text: analysis.description,
    embedding: descEmbedding,
  });
}
```

### New API Endpoint

#### File: `electron/archive-server/routes/gallery.ts`

```typescript
/**
 * Semantic search for images by description
 * GET /api/gallery/analysis/semantic-search?q=sunset&limit=20
 */
router.get('/analysis/semantic-search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const source = req.query.source as string | undefined;

    if (!query) {
      res.status(400).json({ error: 'Query parameter q is required' });
      return;
    }

    // Embed the query
    const { embed } = await import('../services/embeddings/EmbeddingGenerator.js');
    const queryEmbedding = await embed(query);

    // Search
    const db = getEmbeddingDatabase();
    const results = db.searchImageDescriptionsByVector(queryEmbedding, { limit, source });

    res.json({
      success: true,
      query,
      results: results.map(r => ({
        ...r,
        url: `/api/conversations/${encodeURIComponent(r.filePath)}`,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

### Testing Phase 2
```bash
# After implementing, test semantic search
curl "http://localhost:3002/api/gallery/analysis/semantic-search?q=sunset%20over%20mountains"

# Should return images with semantically similar descriptions
# Even if "sunset" isn't in the exact text
```

---

## Phase 3: Backfill & Polish (2 hours)

### Goal
Embed all existing image descriptions and add hybrid search.

### Backfill Script

Create `scripts/backfill-image-embeddings.py`:

```python
#!/usr/bin/env python3
"""Backfill embeddings for existing image descriptions."""

import base64
import json
import os
import sqlite3
import time
import urllib.request
import uuid

DB_PATH = "/Users/tem/openai-export-parser/output_v13_final/.embeddings.db"
OLLAMA_URL = "http://localhost:11434/api/embed"

def embed_text(text: str) -> list:
    """Get embedding from Ollama nomic-embed-text."""
    payload = json.dumps({
        "model": "nomic-embed-text",
        "input": text
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    return result["embeddings"][0]

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get all image analyses without description embeddings
    cursor = conn.execute("""
        SELECT ia.id, ia.description, ia.source
        FROM image_analysis ia
        LEFT JOIN image_description_embeddings ide ON ide.image_analysis_id = ia.id
        WHERE ia.description IS NOT NULL
          AND ia.description != ''
          AND ide.id IS NULL
    """)

    rows = cursor.fetchall()
    print(f"Found {len(rows)} descriptions to embed")

    for i, row in enumerate(rows, 1):
        print(f"[{i}/{len(rows)}] Embedding {row['id'][:8]}...")

        try:
            embedding = embed_text(row['description'])
            embedding_blob = bytes(bytearray(
                b for f in embedding for b in float(f).hex()
            ))

            # This is simplified - real implementation needs proper float32 encoding
            # Use struct.pack for production

            embed_id = str(uuid.uuid4())
            conn.execute("""
                INSERT INTO image_description_embeddings
                (id, image_analysis_id, text, embedding, model, dimensions, created_at)
                VALUES (?, ?, ?, ?, 'nomic-embed-text', 768, ?)
            """, (
                embed_id,
                row['id'],
                row['description'],
                embedding_blob,
                time.time()
            ))

            conn.commit()

        except Exception as e:
            print(f"  Error: {e}")

        time.sleep(0.1)  # Rate limit

    print("Done!")
    conn.close()

if __name__ == "__main__":
    main()
```

### Hybrid Search (Optional Enhancement)

Add to `gallery.ts`:

```typescript
/**
 * Hybrid search combining FTS and semantic
 */
router.get('/analysis/hybrid-search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const limit = parseInt(req.query.limit as string) || 20;

  // FTS results (keyword matching)
  const ftsResults = db.searchImagesFTS(query, { limit: limit * 2 });

  // Semantic results
  const { embed } = await import('../services/embeddings/EmbeddingGenerator.js');
  const queryEmbedding = await embed(query);
  const semanticResults = db.searchImageDescriptionsByVector(queryEmbedding, { limit: limit * 2 });

  // Combine with reciprocal rank fusion
  const combined = reciprocalRankFusion(
    ftsResults.map(r => r.id),
    semanticResults.map(r => r.imageAnalysisId),
    { k: 60 }
  );

  // Fetch full details for top results
  const topIds = combined.slice(0, limit);
  const results = topIds.map(id =>
    ftsResults.find(r => r.id === id) ||
    semanticResults.find(r => r.imageAnalysisId === id)
  ).filter(Boolean);

  res.json({ success: true, query, results });
});
```

### Testing Phase 3
```bash
# Test hybrid search
curl "http://localhost:3002/api/gallery/analysis/hybrid-search?q=outdoor%20nature"

# Run backfill
python3 scripts/backfill-image-embeddings.py

# Verify embeddings created
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db \
  "SELECT COUNT(*) FROM image_description_embeddings;"
```

---

## Files Reference

### To Modify
| File | Changes |
|------|---------|
| `electron/archive-server/services/vision/VisualModelService.ts` | Use factory, apply filtering |
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Add tables, methods |
| `electron/archive-server/routes/gallery.ts` | Embed descriptions, add search endpoint |
| `scripts/direct-image-analysis.py` | Validate model against vetted list |

### To Create
| File | Purpose |
|------|---------|
| `scripts/backfill-image-embeddings.py` | Embed existing descriptions |
| `packages/core/src/types/media.ts` | Type definitions |

### Existing Infrastructure (USE IT!)
| File | Contains |
|------|----------|
| `electron/vision/profiles.ts` | 19 vetted models with output strategies |
| `electron/vision/factory.ts` | Provider factory with fallback |
| `electron/vision/output-filter.ts` | Filtering logic for model output |
| `electron/vision/providers/*.ts` | Ollama, OpenAI, Anthropic, Cloudflare providers |

---

## Success Criteria

- [ ] No hardcoded model strings outside `profiles.ts`
- [ ] `direct-image-analysis.py` validates model against vetted list
- [ ] `VisualModelService.ts` uses factory for model selection
- [ ] Output filtering applied based on model profile
- [ ] `image_description_embeddings` table exists
- [ ] `vec_image_descriptions` virtual table exists
- [ ] New images get descriptions embedded automatically
- [ ] `GET /api/gallery/analysis/semantic-search` works
- [ ] Existing 9 descriptions backfilled with embeddings
- [ ] "Find sunset images" returns semantically similar results

---

## Quick Start for Next Session

```bash
cd /Users/tem/humanizer_root/humanizer-gm
git checkout feature/xanadu-768-embeddings

# Verify services
ollama serve &
curl http://localhost:11434/api/tags | grep nomic
curl http://localhost:11434/api/tags | grep qwen3-vl

# Start dev
npm run electron:dev

# Current stats
sqlite3 /Users/tem/openai-export-parser/output_v13_final/.embeddings.db \
  "SELECT 'Images analyzed:', COUNT(*) FROM image_analysis;"
```

---

**End of Handoff**
