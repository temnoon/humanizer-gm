# Handoff: Facebook Import UI + Unified Import Integration

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: API READY - UI needed
**Priority**: HIGH - Users cannot import Facebook data without API calls

---

## Executive Summary

Facebook import API is now functional (`POST /api/facebook/graph/import`) but lacks UI integration. The Import tab exists but routes Facebook through a generic pipeline that doesn't work. Need to either:
1. Add Facebook-specific UI to existing Import tab
2. Create dedicated Facebook import flow

---

## Current State

### What Works
- ✅ `FacebookFullParser` fully implemented (parses posts, comments, reactions, media)
- ✅ `POST /api/facebook/graph/import` endpoint wired up (commit `cb1f19e`)
- ✅ Import tab UI exists for ChatGPT, Claude, folders, paste
- ✅ File type detection identifies Facebook exports

### What's Broken
- ❌ Import tab sends Facebook to generic `ImportPipeline` (no FacebookParser)
- ❌ No UI for selecting Facebook export folder
- ❌ No progress tracking for Facebook imports
- ❌ Import tab expects ZIP upload, but Facebook can be folder

---

## Architecture Overview

### Two Import Systems (Need Unification)

| System | Location | Handles | UI |
|--------|----------|---------|-----|
| Unified ImportPipeline | `services/import/` | ChatGPT, Gemini, PDF, docs | Import tab |
| Facebook Full Parser | `services/facebook/` | Facebook exports | **None** |

### Key Files

**Frontend (Import UI)**
- `apps/web/src/components/archive/ImportView.tsx` - Main import tab
- `apps/web/src/components/archive/types.ts` - Import types

**Backend (Import APIs)**
- `electron/archive-server/routes/import.ts` - Generic import routes
- `electron/archive-server/routes/facebook.ts` - Facebook-specific routes
- `electron/archive-server/services/import/ImportPipeline.ts` - Generic pipeline
- `electron/archive-server/services/facebook/FacebookFullParser.ts` - Facebook parser

---

## Phase 1: Quick Fix - Add Facebook to Import UI (2-3 hours)

### Goal
Make Facebook import work from Import tab without major refactoring.

### Changes Required

#### 1. Update ImportView.tsx

Add folder selection for Facebook:

```typescript
// In IMPORT_TYPES array, update facebook entry:
{
  id: 'facebook',
  icon: '👤',
  label: 'Facebook',
  description: 'Select export folder',
  accept: undefined,  // No file upload - use folder picker
  useFolderPicker: true,  // New flag
}

// Add folder picker handler:
const handleFacebookImport = async () => {
  // Use Electron dialog to select folder
  const folderPath = await window.electronAPI?.selectFolder();
  if (!folderPath) return;

  setImporting(true);
  setImportStatus('Starting Facebook import...');

  try {
    const response = await fetch(`${archiveServer}/api/facebook/graph/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exportPath: folderPath }),
    });

    const result = await response.json();
    if (result.success) {
      setImportStatus('Import started! Processing in background...');
      // Poll for completion
      pollFacebookImportStatus();
    } else {
      setImportStatus(`Error: ${result.error}`);
    }
  } catch (err) {
    setImportStatus(`Error: ${err.message}`);
  }
};
```

#### 2. Add Progress Polling

The Facebook import runs async. Add status endpoint and polling:

**Backend** (`routes/facebook.ts`):
```typescript
// Track active imports
const activeImports = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  progress: { stage: string; message: string };
  result?: FacebookImportResult;
  error?: string;
}>();

// Add status endpoint
router.get('/graph/import/:id/status', (req, res) => {
  const status = activeImports.get(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'Import not found' });
    return;
  }
  res.json(status);
});

// Update import endpoint to return ID and track progress
router.post('/graph/import', async (req, res) => {
  const importId = crypto.randomUUID();
  activeImports.set(importId, { status: 'running', progress: { stage: 'starting', message: '' } });

  res.json({ success: true, importId, message: 'Import started' });

  parser.importExport({
    ...options,
    onProgress: (progress) => {
      activeImports.set(importId, { status: 'running', progress });
    },
  }).then((result) => {
    activeImports.set(importId, { status: 'completed', progress: { stage: 'done', message: '' }, result });
  }).catch((err) => {
    activeImports.set(importId, { status: 'failed', progress: { stage: 'error', message: '' }, error: err.message });
  });
});
```

**Frontend** (ImportView.tsx):
```typescript
const pollFacebookImportStatus = async (importId: string) => {
  const interval = setInterval(async () => {
    const response = await fetch(`${archiveServer}/api/facebook/graph/import/${importId}/status`);
    const status = await response.json();

    setImportStatus(`${status.progress.stage}: ${status.progress.message}`);

    if (status.status === 'completed') {
      clearInterval(interval);
      setImporting(false);
      setImportStatus(`Complete! Imported ${status.result.posts_imported} posts, ${status.result.comments_imported} comments`);
    } else if (status.status === 'failed') {
      clearInterval(interval);
      setImporting(false);
      setImportStatus(`Failed: ${status.error}`);
    }
  }, 2000);
};
```

---

## Phase 2: Unified Import Architecture (4-6 hours)

### Goal
Create single import pipeline that handles all sources consistently.

### Option A: Add FacebookParser to ImportPipeline

Create `services/import/parsers/FacebookParser.ts`:

```typescript
import { ContentParser, ParseResult, ContentUnit, MediaRef } from '../ImportPipeline.js';
import { FacebookFullParser } from '../../facebook/FacebookFullParser.js';

export class FacebookParser implements ContentParser {
  async canParse(sourcePath: string): Promise<boolean> {
    // Check for Facebook export structure
    const hasActivity = await fs.access(
      path.join(sourcePath, 'your_facebook_activity')
    ).then(() => true).catch(() => false);
    return hasActivity;
  }

  async parse(sourcePath: string): Promise<ParseResult> {
    const parser = new FacebookFullParser();
    const result = await parser.importExport({
      exportDir: sourcePath,
      targetDir: sourcePath,  // In-place processing
      generateEmbeddings: false,  // Pipeline handles this
    });

    // Convert FacebookImportResult to ParseResult
    return {
      units: this.convertToContentUnits(result),
      mediaRefs: this.extractMediaRefs(result),
      links: [],
      errors: [],
    };
  }
}
```

Register in `services/import/parsers/index.ts`:
```typescript
export { FacebookParser, createFacebookParser } from './FacebookParser.js';
```

### Option B: Keep Separate But Unified UI

Keep `FacebookFullParser` separate but create unified UI that routes to appropriate backend:

```typescript
// ImportView.tsx
const handleImport = async (type: string, source: File | string) => {
  switch (type) {
    case 'facebook':
      return await importFacebook(source as string);  // Folder path
    case 'chatgpt':
      return await importChatGPT(source as File);     // ZIP file
    case 'folder':
      return await importFolder(source as string);    // Folder path
    default:
      return await importGeneric(source as File);     // Generic file
  }
};
```

---

## Phase 3: Enhanced Features (Optional, 2-4 hours)

### 1. Import Preview
Show what will be imported before starting:
- Post count
- Comment count
- Date range
- Media count

```typescript
// API endpoint
router.post('/graph/preview', async (req, res) => {
  const { exportPath } = req.body;
  const parser = new FacebookFullParser();
  const preview = await parser.preview(exportPath);  // Quick scan
  res.json(preview);
});
```

### 2. Selective Import
Let users choose what to import:
- Posts only
- Comments only
- Messages only
- Date range filter

### 3. Archive Merge
Import into existing archive vs. create new archive.

---

## Testing

### Manual Test Flow
```bash
# 1. Start dev environment
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# 2. Open Import tab in app

# 3. Click Facebook, select folder:
#    /Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4

# 4. Watch progress, verify completion

# 5. Switch to Facebook tab, verify data appears
```

### API Test
```bash
# Start import
curl -X POST http://localhost:3002/api/facebook/graph/import \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4"}'

# Check Facebook data
curl http://localhost:3002/api/facebook/periods
curl "http://localhost:3002/api/content/items?source=facebook&limit=10"
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/web/src/components/archive/ImportView.tsx` | Add Facebook folder picker, progress polling |
| `electron/archive-server/routes/facebook.ts` | Add import status endpoint, track active imports |
| `electron/preload.ts` | Expose `selectFolder` IPC if not already |
| `apps/web/src/components/archive/types.ts` | Add import type flags |

---

## Import Type Reference

| Type | Source | Method | Parser | Status |
|------|--------|--------|--------|--------|
| ChatGPT | ZIP file | Upload | OpenAIParser | ✅ Working |
| Facebook | Folder | Picker | FacebookFullParser | 🔧 API only |
| Claude | JSON file | Upload | (none) | ❌ Not implemented |
| Gemini | JSON file | Upload | GeminiParser | ✅ Working |
| PDF | PDF file | Upload | PdfParser | ✅ Working |
| Folder | Directory | Picker | DocumentParser | ✅ Working |
| Paste | Text | Paste | (inline) | ✅ Working |

---

## Success Criteria

- [ ] User can import Facebook from Import tab (no API calls)
- [ ] Progress shown during import
- [ ] Completion notification with stats
- [ ] Facebook tab shows imported data
- [ ] Semantic search works on Facebook posts
- [ ] Media gallery shows Facebook photos

---

## Quick Start for Next Session

```bash
cd /Users/tem/humanizer_root/humanizer-gm
git checkout feature/xanadu-768-embeddings

# Check current state
cat docs/HANDOFF_DEC30_FACEBOOK_IMPORT_UI.md

# Start dev
npm run electron:dev

# Test API directly (server must restart to pick up changes)
curl -X POST http://localhost:3002/api/facebook/graph/import \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4"}'
```

---

**End of Handoff**
