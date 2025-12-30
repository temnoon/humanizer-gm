# ARCHITECT SIGNOFF: VISION SYSTEM ARCHITECTURE

**Status**: BLOCKING REQUIRED ❌
**Severity**: CRITICAL - Production code with parallel implementations
**Date**: December 30, 2025

---

## THE THREE SYSTEMS PROBLEM

You have three ways to select vision models - all incompatible:

### System 1: electron/vision/factory.ts (CANONICAL)
- Location: `/Users/tem/humanizer_root/humanizer-gm/electron/vision/`
- Lines: 217 (factory.ts) + 437 (profiles.ts)
- Models: 19 vetted models with output strategies
- Features:
  - Profile-based vetting
  - Output filtering (xml-tags, json-block, heuristic, none)
  - Multi-provider support (Ollama, OpenAI, Anthropic, Cloudflare)
  - Confidence scores and processing metadata
- Status: **IMPLEMENTED, CORRECT, BUT UNUSED**

```typescript
// CORRECT APPROACH
import { getBestVisionProvider, getVisionProfile } from 'electron/vision';
const provider = await getBestVisionProvider();
const result = await provider.analyze(request);
```

### System 2: scripts/direct-image-analysis.py (BYPASS)
- Location: `/Users/tem/humanizer_root/humanizer-gm/scripts/`
- Lines: 226
- Model: Hardcoded `qwen3-vl:8b`
- Features: None (direct Ollama call)
- Status: **PRODUCTION SCRIPT, BYPASSES FACTORY, NO VETTING**

```python
# WRONG APPROACH
payload = json.dumps({
    "model": "qwen3-vl:8b",  # HARDCODED - will break if model uninstalled
    "prompt": ANALYSIS_PROMPT,
    "images": [img_b64],
})
```

### System 3: electron/archive-server/services/vision/VisualModelService.ts
- Location: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/vision/`
- Lines: 369
- Model: Hardcoded array ['qwen3-vl:8b', 'llava:13b', 'llava']
- Features: Basic priority list, no vetting, no filtering
- Status: **SERVICE CODE, DOESN'T USE FACTORY, NO PROFILE LOOKUP**

```typescript
// PARTIALLY WRONG
const VISION_MODELS = ['qwen3-vl:8b', 'llava:13b', 'llava'];
for (const model of VISION_MODELS) {
  if (installedModels.includes(model)) {
    return model;  // No vetting, no filtering
  }
}
```

---

## EMBEDDING GAP

### Current State
Image descriptions are stored but never embedded:

| Table | Has Text | Has Embedding | Searchable |
|-------|----------|---------------|-----------|
| `image_analysis` | YES (description) | NO | NO |
| `image_embeddings` | NO | YES (CLIP visual) | YES (image-to-image only) |
| `content_items` | YES (any text) | YES (text embed) | YES (text-to-text) |

**Result**: Can't find images by text search. "sunset photo" won't match images with description "A beautiful sunset over the ocean"

### Needed State
Descriptions should be linked to text embeddings:

```
Image Analysis → Description Text → Embedding → content_items → vec_content
                                                     ↓
                                              Searchable via semantic search
```

---

## VIOLATIONS SUMMARY

| Violation | File | Line | Severity |
|-----------|------|------|----------|
| Hardcoded model in script | `scripts/direct-image-analysis.py` | 76 | CRITICAL |
| Hardcoded model array | `VisualModelService.ts` | 18 | CRITICAL |
| No output filtering | `VisualModelService.ts` | 95-152 | HIGH |
| Descriptions not embedded | `EmbeddingDatabase.ts` | Schema | CRITICAL |
| No factory usage | Both scripts | All | CRITICAL |

---

## ARCHITECTURE REQUIREMENT

**From CLAUDE.md - Implementation-First Protocol**:

> Before building ANY new feature, explore existing code.

You didn't explore:
- electron/vision/factory.ts exists ✓
- electron/vision/profiles.ts exists ✓
- 19 vetted models already configured ✓
- Output filtering strategies defined ✓

But implemented independently anyway ✗

**From AGENT.md - Capability Registry**:

> One source of truth per domain

Vision model selection has THREE sources of truth ✗

---

## CORRECT ARCHITECTURE

### Phase 1: Consolidate Model Selection
**Status**: Possible immediately, ~1 hour

Replace both hardcoded systems with factory:
```typescript
// VisualModelService.ts - NEW
import { 
  getVisionProfile, 
  filterVisionOutput,
  getBestVisionProvider 
} from 'electron/vision';

export async function analyzeImage(imagePath: string) {
  const provider = await getBestVisionProvider();
  const result = await provider.analyze(request);
  // Provider handles model selection, vetting, filtering
  return result;
}
```

### Phase 2: Add Description Embeddings
**Status**: Needs implementation, ~2 hours

Create new method in EmbeddingDatabase:
```typescript
async embedImageDescription(imageAnalysisId: string): Promise<void> {
  const analysis = db.prepare(
    'SELECT description FROM image_analysis WHERE id = ?'
  ).get(imageAnalysisId);
  
  if (!analysis.description) return;
  
  const embedding = await this.embedder.embed(analysis.description);
  
  db.prepare(`
    INSERT INTO content_items (
      id, type, source, text, embedding, embedding_model,
      file_path, media_refs, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    uuidv4(),
    'image_description',
    'auto_generated',
    analysis.description,
    embedding,
    'nomic-embed-text',
    imagePath,
    JSON.stringify([imageAnalysisId]),
    Date.now()
  ]);
}
```

### Phase 3: Update ImageIndexer
**Status**: One-line change, <5 minutes

After saving analysis, embed description:
```typescript
// In ImageIndexer.indexDirectory(), after saveImageAnalysis:
await this.db.embedImageDescription(analysisId);
```

---

## CHANGES NEEDED

### Must Fix (CRITICAL)

1. **consolidate-models.ts** - Make VisualModelService use factory
2. **embeddings.ts** - Add embedImageDescription method
3. **index-images.ts** - Call embedding method in indexer
4. **capability-registry** - Update AGENT.md

### Nice to Have (MEDIUM)

1. Unified search endpoint querying both vec_image_embeddings + vec_content
2. Blend visual + text similarity scores
3. Include images in full-text search results

---

## FILES TO MODIFY

| File | Changes | Status |
|------|---------|--------|
| `electron/archive-server/services/vision/VisualModelService.ts` | Import factory, remove hardcoded VISION_MODELS | BLOCKING |
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Add embedImageDescription() method | BLOCKING |
| `electron/archive-server/services/vision/ImageIndexer.ts` | Call embedding method in workflow | BLOCKING |
| `scripts/direct-image-analysis.py` | Replace model selection with factory call | BLOCKING |
| `AGENT.md` | Update capability registry | REQUIRED |

---

## RISK ASSESSMENT

### Current Risk (With Parallel Systems)
- If qwen3-vl:8b is uninstalled: scripts break completely
- If profile filtering logic improves: old code doesn't benefit
- If new models added to profiles: scripts don't see them
- Images undiscoverable by text search
- Maintenance burden: 3 places to update when models change

### Fixed Risk (With Factory)
- Model changes centralized in one place
- Fallback logic in factory handles missing models
- Output filtering automatic
- Text-to-image search enabled
- One maintenance point

---

## ARCHITECT VERDICT

### Current Status: NOT APPROVED

The vision infrastructure you built (electron/vision/) is **excellent**.
But the scripts and services that **bypass it are problematic**.

### Requirements for Approval

1. [ ] Consolidate model selection to factory only
2. [ ] Add image description embeddings
3. [ ] Update capability registry
4. [ ] Remove hardcoded model arrays from all services
5. [ ] Test image text search functionality

---

## DEPLOYMENT DECISION

**DO NOT MERGE** scripts/direct-image-analysis.py or VisualModelService changes to main until:

1. They use VisionProviderFactory for model selection
2. Image descriptions are embedded as text
3. Semantic search test passes

This is a BLOCKING requirement per Architect House.

---

## RECOMMENDATION FOR DEVELOPER

**Good news**: You already built the correct system (electron/vision/).
**Better news**: Fixing this is simple - just use what you built.

Steps:
1. Import factory in both files
2. Replace hardcoded arrays with factory calls
3. Add one method to embed descriptions
4. Update one document (AGENT.md)

**Time**: 2-3 hours
**Benefit**: Unified model management, text-to-image search, consistent output filtering

---

Generated by Architect House - Guardian of Structural Integrity
