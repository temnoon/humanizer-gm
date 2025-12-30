# ARCHITECT REVIEW: Image Analysis & Embedding Pipeline
## Vision Infrastructure vs. Bypass Script Architecture

**Date**: December 30, 2025
**Reviewer**: Architect Agent
**Scope**: Complete image analysis pipeline review
**Status**: CRITICAL ARCHITECTURAL GAPS IDENTIFIED

---

## EXECUTIVE SUMMARY

The codebase has **TWO INCOMPATIBLE IMAGE ANALYSIS SYSTEMS**:

1. **Vision Infrastructure** (electron/vision/) - 437 lines, model vetting, profiles, factory pattern
2. **Bypass Scripts** (scripts/direct-image-analysis.py) - 226 lines, hardcoded models, no factory

**Critical Issues**:
- Your bypass script hardcodes `qwen3-vl:8b` while ignoring the vetted profiles system
- VisualModelService also hardcodes models, doesn't use factory
- Image DESCRIPTIONS are stored but NOT embedded for semantic search
- No link between visual embeddings (image_embeddings) and text embeddings (content_items)

**Architecture**: VIOLATION of implementation-first protocol and single-source-of-truth principle.

---

## PARALLEL IMPLEMENTATIONS IDENTIFIED

### Issue 1: Model Selection (3 Different Approaches)

#### Location 1: electron/vision/profiles.ts
**19 VETTED MODELS** with output strategies, confidence, timestamps:
```typescript
'qwen3-vl:8b': {
  modelId: 'qwen3-vl:8b',
  displayName: 'Qwen3-VL 8B',
  provider: 'ollama',
  supportsMultipleImages: true,
  supportedFormats: ['jpeg', 'png', 'webp'],
  vetted: true,
  vettedDate: '2025-12-27',
  outputStrategy: 'heuristic',  // ← FILTERING STRATEGY
  patterns: {
    thinkingTags: ['<think>', '</think>'],
    preamblePhrases: ['Okay,', 'Let me', ...],
  },
  // ... more metadata
}
```
- 437 lines total
- Factory pattern for provider selection
- Output filtering strategies (xml-tags, json-block, heuristic, none)

#### Location 2: scripts/direct-image-analysis.py
**HARDCODED MODEL**:
```python
payload = json.dumps({
    "model": "qwen3-vl:8b",  # ← HARDCODED
    "prompt": ANALYSIS_PROMPT,
    "images": [img_b64],
    "stream": False,
    "options": {"temperature": 0.3}
})
```
- 226 lines, no factory, no vetting
- Hardcodes qwen3-vl:8b directly in Ollama call
- No fallback logic

#### Location 3: electron/archive-server/services/vision/VisualModelService.ts
**HARDCODED ARRAY**:
```typescript
const VISION_MODELS = ['qwen3-vl:8b', 'llava:13b', 'llava'];

for (const model of VISION_MODELS) {
  if (installedModels.includes(model)) {
    return model;  // ← Simple first-match, no vetting
  }
}
```
- 369 lines, has priority list but NO profile lookup
- Basic heuristic for unknown models: `includes('vl') || includes('llava')`
- No output filtering, no confidence scores

---

## ARCHITECTURAL PROBLEMS

### Problem 1: Model Selection Fragmentation

| System | Model Selection | Vetting | Output Filtering | Fallback |
|--------|-----------------|---------|------------------|----------|
| **profiles.ts** | Explicit vetting + default | YES (19 models) | YES (strategies) | Via factory |
| **direct-image-analysis.py** | Hardcoded | NO | NO | None |
| **VisualModelService.ts** | Hardcoded array | NO | NO | Heuristic keyword match |

**Gap**: Scripts and VisualModelService don't use the vetted profiles system at all.

### Problem 2: Output Filtering Absent

Your vetted profiles define filtering strategies:
```typescript
export type VisionOutputStrategy =
  | 'xml-tags'      // Strip <think>, <reasoning> blocks
  | 'heuristic'     // Strip conversational preambles
  | 'json-block'    // Extract JSON from markdown code block
  | 'none';         // No filtering needed
```

But `VisualModelService.ts` and `direct-image-analysis.py` **don't use these**:
```python
# direct-image-analysis.py - NO FILTERING
analysis = {
    "description": analysis.get("description", ""),
    "categories": analysis.get("categories", []),
    "objects": analysis.get("objects", []),
    "scene": analysis.get("scene", "unknown"),
    "mood": analysis.get("mood", "neutral"),
}
```

### Problem 3: Text Embeddings Never Created for Image Descriptions

**Current database schema**:

```sql
-- Image analysis stores text description
CREATE TABLE image_analysis (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  description TEXT,                    -- ← STORED BUT NOT EMBEDDED
  categories TEXT,
  objects TEXT,
  scene TEXT,
  mood TEXT,
  model_used TEXT,
  analyzed_at REAL,
  media_file_id TEXT
);

-- Visual embeddings (CLIP vectors only)
CREATE TABLE image_embeddings (
  id TEXT PRIMARY KEY,
  image_analysis_id TEXT NOT NULL,
  embedding BLOB NOT NULL,             -- ← ONLY VISUAL SIMILARITY
  model TEXT,
  dimensions INTEGER
);

-- Text embeddings (for semantic search)
CREATE TABLE content_items (
  id TEXT PRIMARY KEY,
  text TEXT,
  embedding BLOB,                      -- ← 768-dim nomic-embed-text
  embedding_model TEXT DEFAULT 'nomic-embed-text',
  -- ... media references
);
```

**THE GAP**: 
- Image descriptions stored in `image_analysis.description`
- But NO corresponding text embedding in `content_items`
- Search for "sunset photo" won't find images with description containing "sunset"
- Visual embeddings only enable image-to-image similarity, not text-to-image search

---

## CORRECT ARCHITECTURE

### 1. Model Selection Should Use Factory + Profiles

**The electron/vision/factory.ts system already handles this correctly**:

```typescript
// FROM FACTORY
export async function getBestVisionProvider(): Promise<VisionProvider | null> {
  return getVisionProviderFactory().getBestProvider();
}

// WHAT SCRIPTS SHOULD DO
import { getBestVisionProvider, getVisionProfile } from 'electron/vision';

const provider = await getBestVisionProvider();
if (!provider) throw new Error('No vision provider available');

const result = await provider.analyze(request, 'qwen3-vl:8b');
// Provider handles model selection, vetting, output filtering
```

### 2. Description Text Should Create Embeddings

**Schema change needed**:

```typescript
// When saving image analysis:
async saveImageAnalysis(analysis: ImageAnalysis) {
  // 1. Insert into image_analysis (existing)
  const imageAnalysisId = db.exec(`
    INSERT INTO image_analysis (...) VALUES (...)
  `);

  // 2. ALSO create text embedding for description
  const descriptionEmbedding = await embedder.embed(analysis.description);
  
  // 3. Insert as content_item linking to image
  db.exec(`
    INSERT INTO content_items (
      id,
      type,
      source,
      text,
      embedding,
      embedding_model,
      media_refs,  -- Link to image
      file_path,
      created_at
    ) VALUES (
      ?,
      'image_description',
      ?,
      ?,
      ?,
      'nomic-embed-text',
      JSON_ARRAY(?),
      ?,
      ?
    )
  `, [
    imageId,
    'auto_generated',  // or 'image_analysis'
    analysis.description,
    descriptionEmbedding,
    imageAnalysisId,
    imagePath,
    now
  ]);
}
```

### 3. Vector Search Links Images to Text

```sql
-- Search for "sunset photo from 2020"
SELECT ci.*, ia.file_path, ia.id
FROM content_items ci
JOIN image_embeddings ie ON ci.metadata->>'image_id' = ie.image_analysis_id
WHERE ci.type = 'image_description'
  AND vec_distance('vec_content', ci.embedding, query_embedding) < 0.3
ORDER BY distance ASC;
```

---

## SPECIFIC VIOLATIONS

### Violation 1: Direct Model Hardcoding

**File**: `/Users/tem/humanizer_root/humanizer-gm/scripts/direct-image-analysis.py`

Line 76: `"model": "qwen3-vl:8b",`

**Should be**:
```python
import subprocess
import json

# Use factory to determine best model
result = subprocess.run(['node', '-e', '''
  const {getBestVisionProvider} = require("electron/vision");
  getBestVisionProvider().then(p => console.log(p.defaultModel));
'''], capture_output=True)
best_model = result.stdout.decode().strip()

payload = json.dumps({
    "model": best_model,  # ← Dynamic selection
    "prompt": ANALYSIS_PROMPT,
    "images": [img_b64],
})
```

### Violation 2: No Output Filtering

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/vision/VisualModelService.ts`

Lines 95-152: `callVisionModel()` - Parses JSON but doesn't use profile output strategies

**Should look up profile and filter**:
```typescript
import { getVisionProfile, filterVisionOutput } from 'electron/vision';

async function callVisionModel(
  imagePath: string,
  prompt: string,
  options = {}
) {
  const model = options.model || (await getAvailableVisionModel());
  const profile = getVisionProfile(model);  // ← GET PROFILE
  
  // ... existing Ollama call ...
  
  const result = await fetch(...);
  const data = await response.json();
  
  // Filter output using profile
  if (profile) {
    const filtered = filterVisionOutput(data.response, profile);
    return {
      response: filtered.content,
      model,
      timeMs,
      filtered: filtered.wasFiltered,
      strategy: profile.outputStrategy
    };
  }
  
  return { response: data.response, model, timeMs };
}
```

### Violation 3: Image Descriptions Not Embedded

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/embeddings/EmbeddingDatabase.ts`

The `image_analysis` table stores descriptions but there's no code that:
1. Embeds the description text
2. Links it to content_items
3. Inserts into vec_content_embeddings for text search

**Missing method**: 
```typescript
async embedImageDescription(imageId: string): Promise<void> {
  const analysis = this.db.prepare(
    'SELECT description FROM image_analysis WHERE id = ?'
  ).get(imageId) as {description: string};
  
  if (!analysis.description) return;
  
  // 1. Generate embedding
  const embedding = await this.generateEmbedding(analysis.description);
  
  // 2. Create content_item linking to image
  const contentId = uuidv4();
  this.db.prepare(`
    INSERT INTO content_items (
      id, type, source, text, embedding, embedding_model,
      media_refs, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    contentId,
    'image_description',
    'auto_generated',
    analysis.description,
    embedding,
    'nomic-embed-text',
    JSON.stringify([imageId]),
    Date.now()
  ]);
}
```

---

## CAPABILITY REGISTRY GAPS

Current registry in AGENT.md:

| Domain | System | Location | Status |
|--------|--------|----------|--------|
| Vision Analysis | ??? | Fragmented | BROKEN |

**Should be**:
```
| Vision Analysis | VisionProviderFactory | electron/vision/factory.ts | ✅ CANONICAL |
| Image Descriptions | ??? | electron/archive-server/services/vision/ | NEEDS CREATION |
| Image Embeddings | ??? | electron/archive-server/services/embeddings/ | NEEDS LINKING |
```

---

## CHANGES NEEDED

### Phase 1: Consolidate Model Selection (REQUIRED)

**Files to modify**:
1. `scripts/direct-image-analysis.py` - Use factory instead of hardcoding
2. `electron/archive-server/services/vision/VisualModelService.ts` - Import profiles, add filtering
3. Update capability registry

**Why**: Single source of truth for model selection, vetting, output filtering

### Phase 2: Add Description Embeddings (REQUIRED)

**Files to create/modify**:
1. Create method in `EmbeddingDatabase.ts` to embed image descriptions
2. Modify `ImageIndexer.ts` to call embedding method after analysis
3. Add foreign key linking `content_items` to `image_analysis`

**Why**: Enable semantic search across image descriptions (text-to-image discovery)

### Phase 3: Link Visual + Text Embeddings (OPTIONAL but recommended)

**Files to modify**:
1. Add search endpoint that queries both `vec_image_embeddings` and `vec_content` simultaneously
2. Return results blended by similarity score
3. Include images in text search results if descriptions match

**Why**: Unified search experience - one query surface for all content types

---

## IMPLEMENTATION COMPARISON

### Option A: CORRECT (Use Factory)
```typescript
// Script or service:
import { getBestVisionProvider, getVisionProfile } from 'electron/vision';

const provider = await getBestVisionProvider();
const result = await provider.analyze(request);
// Profile-aware, vetted, filtered automatically
```
**Lines**: 3-4
**Risk**: LOW
**Benefit**: Central vetting, consistent output filtering

### Option B: Current (Hardcoded)
```python
# direct-image-analysis.py
payload = json.dumps({
    "model": "qwen3-vl:8b",
    "prompt": ANALYSIS_PROMPT,
    "images": [img_b64],
})
```
**Lines**: 226
**Risk**: HIGH - if qwen3-vl:8b is uninstalled, entire script breaks
**Benefit**: None

---

## ASSESSMENT CHECKLIST

Architect House requirements for NEW systems:

- [x] **Search first**: electron/vision/ exists with factory pattern
- [ ] **Single source of truth**: VIOLATED - 3 different implementations
- [x] **Check registry**: Capability exists in profiles.ts
- [ ] **Don't duplicate**: VIOLATED - scripts create parallel implementation
- [x] **Use patterns**: Factory pattern available but not used
- [ ] **Integration plan**: MISSING - no linking of visual + text embeddings

---

## VERDICT

### BLOCKING VIOLATIONS

1. **Parallel model selection system** - scripts/direct-image-analysis.py bypasses factory
2. **Image descriptions never embedded** - no text-to-image search capability
3. **No filtering strategy applied** - output quality inconsistent

### RECOMMENDATION

**DO NOT DEPLOY** bypass script to production without:

1. Integrating with factory/profiles system
2. Adding description text embeddings
3. Updating capability registry

### PRIORITY

1. **CRITICAL**: Consolidate model selection to single factory
2. **CRITICAL**: Add description text embeddings
3. **HIGH**: Update capability registry
4. **MEDIUM**: Link visual + text search

---

## FILES INVOLVED

| File | Type | Issue | Status |
|------|------|-------|--------|
| scripts/direct-image-analysis.py | Script | Hardcoded qwen3-vl:8b | BYPASS, NOT INTEGRATED |
| electron/vision/factory.ts | Infrastructure | Correct pattern, unused | CANONICAL SYSTEM |
| electron/vision/profiles.ts | Configuration | 19 vetted models, unused | CANONICAL SYSTEM |
| electron/archive-server/services/vision/VisualModelService.ts | Service | Hardcoded array, no filtering | NEEDS UPDATE |
| electron/archive-server/services/embeddings/EmbeddingDatabase.ts | Database | Stores descriptions, no embeddings | NEEDS EXTENSION |
| electron/archive-server/services/vision/ImageIndexer.ts | Service | No description embedding calls | NEEDS INTEGRATION |

---

## CORRECT ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                     Image Analysis Pipeline                      │
└─────────────────────────────────────────────────────────────────┘

INPUT IMAGE
    │
    ├─→ ImageIndexer.indexDirectory()
    │       │
    │       ├─→ VisualModelService.analyzeImage()
    │       │       │
    │       │       ├─→ Factory.getBestProvider()
    │       │       │       │
    │       │       │       ├─→ getVisionProfile(model)  ← LOOKUP PROFILE
    │       │       │       └─→ Return vetted provider + filtering strategy
    │       │       │
    │       │       ├─→ Provider.analyze()
    │       │       │       └─→ callVisionModel() with profile strategy
    │       │       │
    │       │       └─→ filterVisionOutput(output, profile)  ← APPLY FILTERING
    │       │
    │       └─→ EmbeddingDatabase.saveImageAnalysis()
    │               │
    │               ├─→ INSERT image_analysis (description, categories, mood, etc.)
    │               │
    │               ├─→ embedImageDescription() [NEW]
    │               │       │
    │               │       ├─→ Generate nomic-embed-text embedding
    │               │       │
    │               │       └─→ INSERT content_items (text, embedding)
    │               │
    │               ├─→ generateImageEmbedding()
    │               │       └─→ INSERT image_embeddings (CLIP visual vectors)
    │               │
    │               └─→ INSERT into vec_image_embeddings and vec_content
    │
    ├─→ VECTOR SEARCH
    │       │
    │       ├─→ Text search: "sunset photos from 2020"
    │       │       └─→ vec_content (image_description in content_items)
    │       │
    │       ├─→ Visual search: "images similar to this"
    │       │       └─→ vec_image_embeddings (CLIP similarity)
    │       │
    │       └─→ Metadata search: scene=outdoor, mood=serene
    │               └─→ image_analysis table direct query
    │
    └─→ SEARCH RESULTS
            ├─→ Image metadata (description, categories, mood)
            ├─→ Visual similarity scores
            ├─→ Text semantic match scores
            └─→ File paths for display
```

---

## SUMMARY FOR DEVELOPER

Your **vision infrastructure is excellent** - it's already built correctly with:
- Factory pattern for provider selection
- 19 vetted models with output strategies
- Profile system for model capabilities
- Output filtering for different model quirks

But your **scripts and VisualModelService bypass it completely**, creating maintenance burden.

**The fix is simple**:
1. Import factory, not hardcode models
2. Add description embedding calls
3. Link results to content_items

**Time to fix**: ~2 hours
**Impact**: Enables text-to-image search, consistent model handling, proper output filtering

