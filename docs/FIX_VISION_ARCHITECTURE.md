# FIX: Vision System Architecture - Implementation Guide

**Status**: BLOCKING REQUIRED
**Severity**: CRITICAL
**Time Estimate**: 2-3 hours
**Reviewer**: Architect House

---

## Overview

Your codebase has **three parallel vision model selection systems**. This guide consolidates them into one.

### Current State (WRONG)
- `scripts/direct-image-analysis.py` → hardcodes `qwen3-vl:8b`
- `VisualModelService.ts` → hardcodes array `['qwen3-vl:8b', 'llava:13b', 'llava']`
- `electron/vision/factory.ts` → proper factory with 19 vetted models (UNUSED)

### Target State (CORRECT)
- All code uses `VisionProviderFactory` from `electron/vision/`
- Single source of truth: `electron/vision/profiles.ts`
- Image descriptions embedded in `content_items` for text search

---

## Phase 1: Consolidate VisualModelService.ts

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/vision/VisualModelService.ts`

### Change 1: Remove hardcoded VISION_MODELS array

**DELETE lines 15-18**:
```typescript
// DELETE THIS
const OLLAMA_BASE = 'http://localhost:11434';
const VISION_MODELS = ['qwen3-vl:8b', 'llava:13b', 'llava'];
```

### Change 2: Replace getAvailableVisionModel()

**REPLACE lines 46-73**:

```typescript
// DELETE: Old implementation using hardcoded array
// REPLACE WITH:

import { getVisionProfile, getBestVisionProvider } from 'electron/vision';

export async function getAvailableVisionModel(): Promise<string | null> {
  try {
    const provider = await getBestVisionProvider();
    if (provider) {
      return provider.defaultModel;
    }
    return null;
  } catch {
    return null;
  }
}
```

### Change 3: Update callVisionModel to use profiles

**REPLACE lines 95-152** with:

```typescript
import { 
  getVisionProfile, 
  filterVisionOutput,
  OllamaVisionProvider,
  DEFAULT_ANALYSIS_PROMPT
} from 'electron/vision';

async function callVisionModel(
  imagePath: string,
  prompt: string,
  options: {
    model?: string;
    timeout?: number;
  } = {}
): Promise<{ response: string; model: string; timeMs: number }> {
  const model = options.model || (await getAvailableVisionModel());
  if (!model) {
    throw new Error('No vision model available. Install qwen3-vl or llava with: ollama pull qwen3-vl:8b');
  }

  // Get profile for filtering
  const profile = getVisionProfile(model);

  const imageBase64 = await imageToBase64(imagePath);
  const timeoutMs = options.timeout ?? 120000;

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.3,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama vision failed: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    let responseText = data.response || '';
    const timeMs = Date.now() - startTime;

    // APPLY FILTERING STRATEGY from profile
    if (profile && profile.outputStrategy !== 'none') {
      const filtered = filterVisionOutput(responseText, profile);
      responseText = filtered.content;
    }

    return {
      response: responseText,
      model,
      timeMs,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Vision model timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

## Phase 2: Update ImageIndexer.ts to Embed Descriptions

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/vision/ImageIndexer.ts`

### Find where image analysis is saved

Look for the `saveImageAnalysis()` call in `indexDirectory()` method (around line 150-170).

### Add description embedding call after save

After the line that saves analysis, add:

```typescript
// In ImageIndexer.indexDirectory(), inside the loop after:
// const analysis = await VisualModel.analyzeImage(...);

// Add this immediately after saving:
if (analysis.description) {
  try {
    await this.db.embedImageDescription(imageAnalysisId, analysis);
  } catch (err) {
    console.warn(`Failed to embed image description for ${imagePath}:`, err);
    // Don't fail the whole indexing process if embedding fails
  }
}
```

---

## Phase 3: Add embedImageDescription() to EmbeddingDatabase.ts

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/embeddings/EmbeddingDatabase.ts`

### Find the class and add new method

Add this method to the `EmbeddingDatabase` class (around line 800, before the closing brace):

```typescript
/**
 * Create a text embedding for an image description
 * Links the description to content_items for semantic search
 */
async embedImageDescription(
  imageAnalysisId: string,
  analysis: {
    description: string;
    file_path?: string;
    source?: string;
  }
): Promise<string> {
  if (!analysis.description) {
    throw new Error('No description to embed');
  }

  // Generate text embedding for the description
  const embedding = await this.generateEmbedding(analysis.description);
  if (!embedding) {
    throw new Error('Failed to generate embedding for image description');
  }

  // Create content_item linking description to image
  const contentId = uuidv4();
  
  this.db.prepare(`
    INSERT INTO content_items (
      id,
      type,
      source,
      text,
      title,
      created_at,
      embedding,
      embedding_model,
      file_path,
      media_refs,
      metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    contentId,
    'image_description',
    analysis.source || 'auto_generated',
    analysis.description,
    `Image Description: ${analysis.file_path?.split('/').pop() || 'Unknown'}`,
    Date.now() / 1000,
    embedding,
    'nomic-embed-text',
    analysis.file_path || null,
    JSON.stringify([imageAnalysisId]),
    JSON.stringify({
      imageAnalysisId,
      source: 'image_analysis_auto',
      created_by: 'image_indexer'
    })
  ]);

  // Also insert into vec_content for similarity search
  if (this.vecLoaded) {
    try {
      this.db.prepare(`
        INSERT INTO vec_content (content_item_id, embedding)
        VALUES (?, ?)
      `).run([contentId, embedding]);
    } catch (err) {
      console.warn('Failed to insert into vec_content:', err);
      // Non-critical, continue
    }
  }

  return contentId;
}

/**
 * Generate embedding for text (shared utility)
 * Calls Ollama with nomic-embed-text model
 */
private async generateEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const response = await fetch('http://localhost:11434/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        input: text,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error('Embedding generation failed:', response.statusText);
      return null;
    }

    const data = await response.json();
    if (data.embeddings && Array.isArray(data.embeddings) && data.embeddings.length > 0) {
      return new Float32Array(data.embeddings[0]);
    }

    return null;
  } catch (err) {
    console.error('Error generating embedding:', err);
    return null;
  }
}
```

---

## Phase 4: Update direct-image-analysis.py Script

**File**: `/Users/tem/humanizer_root/humanizer-gm/scripts/direct-image-analysis.py`

### Option A: Call the TypeScript factory via subprocess (RECOMMENDED)

Replace the entire `analyze_image_with_ollama()` function:

```python
import json
import subprocess
import time
import urllib.request

def get_best_model():
    """Get best available model from TypeScript factory"""
    try:
        result = subprocess.run(
            ['node', '-e', '''
const {getBestVisionProvider} = require("../electron/vision");
(async () => {
  const provider = await getBestVisionProvider();
  console.log(provider ? provider.defaultModel : "qwen3-vl:8b");
})();
            '''],
            cwd='/Users/tem/humanizer_root/humanizer-gm',
            capture_output=True,
            text=True,
            timeout=10
        )
        model = result.stdout.strip()
        return model if model else "qwen3-vl:8b"
    except Exception as e:
        print(f"Warning: Could not get model from factory: {e}")
        return "qwen3-vl:8b"

def analyze_image_with_ollama(image_path):
    """Call Ollama vision model to analyze an image."""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    # Get model from factory instead of hardcoding
    model = get_best_model()
    
    payload = json.dumps({
        "model": model,  # ← NOW DYNAMIC
        "prompt": ANALYSIS_PROMPT,
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.3}
    }).encode("utf-8")

    # ... rest of the function unchanged ...
```

### Option B: Hardcode temporarily with documentation

If Option A doesn't work immediately, at minimum update the hardcoded model with a comment:

```python
# TODO: Replace with factory call from electron/vision/factory.ts
# Current model: qwen3-vl:8b (from electron/vision/profiles.ts)
# See: ARCHITECT_VERDICT_VISION_CRITICAL.md
payload = json.dumps({
    "model": "qwen3-vl:8b",
    # ...
})
```

---

## Phase 5: Update AGENT.md Capability Registry

**File**: `/Users/tem/humanizer_root/AGENT.md` or `/Users/tem/humanizer_root/humanizer-gm/AGENT.md`

Find the Capability Registry section and update:

### Add Vision to Registry

```markdown
| Domain | System | Location | Status |
|--------|--------|----------|--------|
| Vision Models | VisionProviderFactory | electron/vision/factory.ts | ✅ CANONICAL |
| Vision Profiles | VISION_MODEL_PROFILES | electron/vision/profiles.ts | ✅ CANONICAL |
| Image Analysis | VisualModelService | electron/archive-server/services/vision/ | ✅ USES FACTORY |
| Image Embeddings | EmbeddingDatabase | electron/archive-server/services/embeddings/ | ✅ TEXT + VISUAL |
```

---

## Testing Checklist

After making changes, test:

- [ ] **Model Selection**: Run `getBestVisionProvider()` returns a provider
- [ ] **Image Analysis**: Script analyzes an image without errors
- [ ] **Output Filtering**: Output filtering strategy applied (check for thinking tags)
- [ ] **Description Embedding**: New content_item created for image description
- [ ] **Text Search**: Search for "sunset" finds images with "sunset" in description
- [ ] **Visual Search**: Image similarity search still works

### Test Script

```bash
# Test 1: Verify factory works
cd /Users/tem/humanizer_root/humanizer-gm
node -e "
const {getBestVisionProvider} = require('./electron/vision');
(async () => {
  const provider = await getBestVisionProvider();
  console.log('Best provider:', provider.defaultModel);
})();
"

# Test 2: Run direct-image-analysis.py
python3 scripts/direct-image-analysis.py 1

# Test 3: Check database for new content_item
sqlite3 .embeddings.db "SELECT COUNT(*) FROM content_items WHERE type='image_description';"
```

---

## Rollback Plan

If anything breaks:

1. Keep backup of original files:
   - `VisualModelService.ts.backup`
   - `EmbeddingDatabase.ts.backup`
   - `ImageIndexer.ts.backup`

2. Revert to backups
3. Check logs for specific error
4. Modify approach and retry

---

## Summary

| Phase | File | Change | Time |
|-------|------|--------|------|
| 1 | VisualModelService.ts | Import factory, remove hardcoded array | 30 min |
| 2 | ImageIndexer.ts | Add embedding call | 5 min |
| 3 | EmbeddingDatabase.ts | Add embedImageDescription() method | 30 min |
| 4 | direct-image-analysis.py | Use factory for model selection | 30 min |
| 5 | AGENT.md | Update capability registry | 5 min |
| Testing | All | Verify functionality | 30 min |
| **TOTAL** | | | **~2.5 hours** |

---

**References**:
- `/Users/tem/humanizer_root/humanizer-gm/docs/ARCHITECT_REVIEW_VISION_EMBEDDINGS.md` (full analysis)
- `/Users/tem/humanizer_root/humanizer-gm/docs/ARCHITECT_VERDICT_VISION_CRITICAL.md` (verdict)
- `/Users/tem/humanizer_root/humanizer-gm/electron/vision/` (canonical system)
- `/Users/tem/humanizer_root/CLAUDE.md` (implementation-first protocol)

Generated by Architect House
