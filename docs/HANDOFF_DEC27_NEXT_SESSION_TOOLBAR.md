# Humanizer GM - Next Session: Toolbar & Polish

**Date**: December 27, 2025
**Status**: Electron Build Working, Needs Polish
**Priority**: Wire toolbar, center content, fresh install flow
**Platform**: macOS only (arm64)

---

## START HERE

The Electron app builds and runs. Now we polish:

1. **Toolbar doesn't trigger analysis** - buttons toggle state but don't call functions
2. **Content not centered** - text is left-justified, should be centered container
3. **Fresh install flow** - archives and tools need to work from empty state

---

## IMMEDIATE TASK: Wire the Toolbar

### The Problem

In `SplitModeToolbar.tsx`, clicking "Analyze" changes `splitMode` state but doesn't run analysis:

```typescript
// Current: just changes state
<button onClick={() => setMode('analyze')}>Analyze</button>

// Needed: also trigger analysis
<button onClick={() => {
  setMode('analyze');
  runAnalysis(currentContent);  // THIS IS MISSING
}}>Analyze</button>
```

### Files to Modify

| File | What to Do |
|------|------------|
| `apps/web/src/components/layout/SplitModeToolbar.tsx` | Add analysis trigger on mode change |
| `apps/web/src/components/layout/LayoutContext.tsx` | Add `runAnalysis` action |
| `apps/web/src/Studio.tsx` | Pass content to toolbar, handle analysis |

### The Analysis Flow

```typescript
// 1. Import the analysis function
import { analyzeSentences } from './lib/transform/service';

// 2. When entering Analyze mode with content:
const handleModeChange = async (mode: SplitMode) => {
  setMode(mode);

  if (mode === 'analyze' && currentContent) {
    setAnalysisData({ isLoading: true });
    try {
      const sentences = await analyzeSentences(currentContent);
      setAnalysisData({ sentences, isLoading: false });
      setActiveHighlights(['ai-detection']);
    } catch (error) {
      setAnalysisData({ error: error.message, isLoading: false });
    }
  }
};

// 3. The HighlightableText component will render highlights from analysisData
```

### API Endpoint

```bash
# Test locally:
curl -X POST http://localhost:3003/ai-detection/detect \
  -H "Content-Type: application/json" \
  -d '{"text": "Your text here..."}'
```

---

## SECOND TASK: Center Content

### Current State
- Text fills available width, left-aligned
- No max-width constraint
- Feels like a code editor, not a reading experience

### Desired State
- Content centered in viewport
- Max-width ~800px for readability
- Text remains left-aligned within container

### CSS Fix

```css
/* apps/web/src/index.css - add or modify */

.split-pane-content,
.workspace-content,
.buffer-content {
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  padding: var(--space-lg);
}

/* Keep the container centered but text left-aligned */
.content-centered {
  display: flex;
  justify-content: center;
}

.content-centered > * {
  max-width: 800px;
  width: 100%;
}
```

---

## THIRD TASK: Fresh Install Flow

### What Needs to Work

1. **First Launch** - App opens with welcome/onboarding
2. **No Archives** - Prompt to import or create archive
3. **Import Flow** - Select folder → parse → create archive
4. **Empty State UI** - Helpful prompts, not blank screens

### Current State

- Archive server checks for archives at startup
- If none found, returns empty array
- UI may show blank or error state

### Files to Check

| File | Purpose |
|------|---------|
| `electron/archive-server/config.ts` | Archive path configuration |
| `electron/archive-server/routes/archives.ts` | Archive CRUD |
| `apps/web/src/components/archive/ImportView.tsx` | Import UI |
| `apps/web/src/Studio.tsx` | Main workspace, handles empty state |

### Import Flow Architecture

```
User selects folder
      ↓
POST /api/import/archive/folder {folderPath}
      ↓
Parser analyzes (conversations.json, media files)
      ↓
Returns jobId + preview
      ↓
User confirms
      ↓
POST /api/import/archive/apply/{jobId}
      ↓
Archive created at configured path
      ↓
UI refreshes, shows new archive
```

---

## ARCHITECTURE RECAP

### One Codebase: humanizer-gm

```
humanizer-gm/
├── electron/           # Desktop shell
│   ├── main.ts         # Window, IPC, server startup
│   ├── preload.ts      # Renderer bridge
│   ├── archive-server/ # Local archive API (port 3002)
│   └── npe-local/      # Local AI API (port 3003)
├── apps/web/           # React frontend
│   └── src/
│       ├── Studio.tsx  # Main workspace
│       ├── components/
│       │   ├── layout/
│       │   │   ├── SplitModeToolbar.tsx  ← TOOLBAR
│       │   │   ├── LayoutContext.tsx     ← STATE
│       │   │   └── SplitScreenWorkspace.tsx
│       │   ├── archive/  # Archive views
│       │   └── workspace/ # Content rendering
│       └── lib/
│           ├── transform/ # Humanization
│           └── analysis/  # Highlight mapping
└── packages/
    ├── core/           # Shared types
    └── ui/             # Shared styles
```

### Embedded Servers

| Server | Port | Purpose |
|--------|------|---------|
| Archive | 3002 | Conversations, embeddings, Facebook |
| NPE-Local | 3003 | AI detection, transformations, quantum |
| Ollama | 11434 | LLM inference (external) |

### Key State Management

```typescript
// LayoutContext provides:
useSplitMode()    → { mode, setMode }
useHighlights()   → { activeHighlights, analysisData, setData, toggle }

// BufferContext provides:
useBuffer()       → { content, setContent, originalContent }

// AuthContext provides:
useAuth()         → { user, isAuthenticated, loginWithOAuth }
```

---

## WORKING FEATURES

| Feature | Status | Notes |
|---------|--------|-------|
| App launch | ✅ | Opens, shows UI |
| Archive browsing | ✅ | Lists conversations |
| Semantic search | ✅ | 72K vectors indexed |
| AI detection | ✅ | Local statistical analysis |
| Humanization | ✅ | Via Ollama |
| Personas/Styles | ✅ | 6 personas, 8 styles |
| Quantum analysis | ✅ | Session-based reading |
| Split view | ✅ | Original/Workspace panes |
| Mode buttons | ⚠️ | Toggle state only |
| Highlight toggles | ⚠️ | Toggle state only |
| OAuth | ⚠️ | Opens browser, no return |

---

## NOT WORKING / TODO

| Issue | Priority | Complexity |
|-------|----------|------------|
| Toolbar doesn't trigger analysis | HIGH | Medium |
| Content not centered | HIGH | Easy |
| Fresh install empty state | HIGH | Medium |
| Dynamic title bar | MEDIUM | Easy |
| Transform on selection | MEDIUM | Medium |
| OAuth token import | LOW | Easy |
| Windows/Linux builds | LOW | Config only |

---

## COMMANDS

```bash
# Navigate to repo
cd /Users/tem/humanizer_root/humanizer-gm

# Development (hot reload)
npm run electron:dev

# Production build
npm run electron:build

# Run built app
open release/mac-arm64/Humanizer.app

# Test servers
curl http://localhost:3003/health
curl http://localhost:3002/api/health
curl http://localhost:3002/api/archives
```

---

## KEY FILES FOR TOOLBAR WORK

```
apps/web/src/components/layout/SplitModeToolbar.tsx   # The toolbar UI
apps/web/src/components/layout/LayoutContext.tsx      # State & actions
apps/web/src/components/layout/SplitScreenWorkspace.tsx # Container
apps/web/src/lib/transform/service.ts                 # analyzeSentences()
apps/web/src/lib/analysis/highlightMapper.ts          # Data → highlights
apps/web/src/components/workspace/HighlightableText.tsx # Renders highlights
```

---

## NEXT SESSION CHECKLIST

- [ ] Read this handoff
- [ ] Run `npm run electron:dev` to start
- [ ] Open SplitModeToolbar.tsx
- [ ] Add analysis trigger when mode changes to 'analyze'
- [ ] Test with archive content
- [ ] Add CSS centering
- [ ] Test fresh install (delete archives, restart)

---

**End of Handoff**

*Handoff document: `docs/HANDOFF_DEC27_NEXT_SESSION_TOOLBAR.md`*
*Previous handoff: `docs/HANDOFF_DEC27_ELECTRON_BUILD_COMPLETE.md`*
