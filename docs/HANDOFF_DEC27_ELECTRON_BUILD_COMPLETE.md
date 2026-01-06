# Humanizer GM - Electron Build Complete

**Date**: December 27, 2025
**Status**: Electron App Built and Running
**Build**: `release/Humanizer-1.0.0-arm64.dmg` (165 MB)

---

## Summary

This session completed the Electron build of humanizer-gm, a self-contained desktop app with embedded servers:
- **NPE-Local Server** (port 3003) - AI detection, transformations, quantum analysis
- **Archive Server** (port 3002) - Conversation browsing, embeddings, semantic search
- **Chat Service** - LLM chat via Ollama
- **Agent Council** - Multi-agent orchestration

---

## Key Fixes Applied

### 1. Build Configuration
| Issue | Fix | File |
|-------|-----|------|
| `electron-store` not packaged | Moved to `dependencies` | `package.json` |
| Asset paths `/assets/...` | Changed to `./assets/...` via `base: './'` | `apps/web/vite.config.ts` |
| BrowserRouter + file:// | Changed to `HashRouter` | `apps/web/src/App.tsx` |
| Schema SQL not copied | Added copy commands to build script | `package.json` |
| OAuth redirect fails | Opens in external browser | `lib/auth/api.ts`, `AuthContext.tsx` |
| AUIContext init order | Moved `settings` useState before `conversation` | `lib/aui/AUIContext.tsx` |

### 2. New IPC Handlers
```typescript
// electron/main.ts
ipcMain.handle('shell:open-external', (url) => shell.openExternal(url));

// electron/preload.ts
shell: { openExternal: (url) => ipcRenderer.invoke('shell:open-external', url) }
```

---

## Current State of Toolbar

The bottom toolbar in `SplitModeToolbar.tsx` has **mode buttons** and **highlight toggles**:

### Mode Buttons (Left)
- **View** (`Cmd+1`) - Clean reading, hides UI
- **Analyze** (`Cmd+2`) - Show highlight overlays
- **Transform** (`Cmd+3`) - Show diff view
- **Compare** (`Cmd+4`) - Side-by-side panes

### Highlight Toggles (Right)
- **AI** - Sentence AI scores (red/yellow/green)
- **GPT** - GPTZero results (premium)
- **Tell** - Tell-phrase matches
- **Diff** - Change highlights
- **Style** - Stylometry (not implemented)

### Problem: Buttons Don't Trigger Analysis

The buttons toggle state but don't call the analysis functions. Need to wire:

```typescript
// When entering Analyze mode with content:
const { setData: setAnalysisData } = useHighlights();

// Should call:
const sentences = await analyzeSentences(content);
setAnalysisData({ sentences, isLoading: false });
```

**Key files**:
- `apps/web/src/components/layout/SplitModeToolbar.tsx` - The toolbar
- `apps/web/src/components/layout/LayoutContext.tsx` - State management
- `apps/web/src/lib/transform/service.ts` - Analysis functions
- `apps/web/src/lib/analysis/highlightMapper.ts` - Data → highlights

---

## UI Issues to Address

### 1. Text Alignment (User Request)
**Current**: Left-justified text in main content area
**Desired**: Center-justified, centered on viewport

**Files to modify**:
- `apps/web/src/index.css` - Global styles
- `packages/ui/styles/components/book-editor.css` - Editor styles

**Suggested fix**:
```css
.workspace-content,
.buffer-content,
.split-pane-content {
  max-width: 800px;
  margin: 0 auto;
  text-align: left; /* Keep text left-aligned within centered container */
}
```

### 2. Top Menubar Center Buffer Title
**Current**: Shows "workspace" statically
**Desired**: Dynamic buffer title with navigation

**File**: `apps/web/src/components/layout/WindowTitleBar.tsx` or equivalent

### 3. Toolbar Wiring
**Issue**: Mode buttons and highlight toggles change state but don't trigger analysis
**Solution**: Add effect hooks or callbacks to run analysis when mode changes

---

## Architecture Overview

```
humanizer-gm/
├── electron/
│   ├── main.ts              # Main process (826 lines)
│   ├── preload.ts           # IPC bridge (540+ lines)
│   ├── archive-server/      # Embedded archive API
│   │   ├── server.ts
│   │   └── routes/
│   │       ├── archives.ts
│   │       ├── conversations.ts
│   │       ├── embeddings.ts
│   │       └── facebook.ts
│   ├── npe-local/           # Embedded NPE API
│   │   ├── server.ts
│   │   └── routes/
│   │       ├── detection.ts
│   │       ├── transformations.ts
│   │       ├── quantum.ts
│   │       ├── books.ts
│   │       ├── sessions.ts
│   │       └── config.ts
│   ├── chat/                # LLM chat service
│   ├── agents/              # Agent council
│   └── queue/               # Background jobs
├── apps/web/                # React frontend
│   └── src/
│       ├── App.tsx          # HashRouter routes
│       ├── Studio.tsx       # Main workspace
│       ├── components/
│       │   ├── layout/
│       │   │   ├── SplitModeToolbar.tsx
│       │   │   ├── SplitScreenWorkspace.tsx
│       │   │   └── LayoutContext.tsx
│       │   └── workspace/
│       │       ├── HighlightableText.tsx
│       │       ├── AnalyzableMarkdown.tsx
│       │       └── DiffView.tsx
│       └── lib/
│           ├── auth/        # OAuth + token management
│           ├── platform/    # Electron detection
│           ├── transform/   # Humanization service
│           └── analysis/    # Highlight mapping
└── packages/
    ├── core/               # Shared types
    └── ui/                 # Shared styles
```

---

## API Endpoints (All Working)

### NPE-Local (localhost:3003)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status |
| `/ai-detection/detect` | POST | Full AI analysis |
| `/ai-detection/detect-quick` | POST | Quick verdict |
| `/ai-detection/features` | POST | Extract features |
| `/ai-detection/tell-phrases` | POST | Tell-phrase scoring |
| `/transformations/humanize` | POST | LLM humanization |
| `/transformations/persona` | POST | Persona transform |
| `/transformations/style` | POST | Style transform |
| `/transformations/chat` | POST | LLM chat |
| `/config/personas` | GET | List personas |
| `/config/styles` | GET | List styles |
| `/quantum-analysis/start` | POST | Start quantum session |
| `/quantum-analysis/:id/step` | POST | Process sentence |
| `/books/*` | CRUD | Book projects |
| `/sessions/*` | CRUD | Reading sessions |

### Archive Server (localhost:3002)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server status |
| `/api/archives` | GET | List archives |
| `/api/conversations` | GET | List conversations |
| `/api/embeddings/status` | GET | Embedding stats |
| `/api/embeddings/search/messages` | POST | Semantic search |
| `/api/facebook/*` | Various | Facebook archive |

---

## Next Steps (Priority Order)

### 1. Wire Toolbar to Analysis (High)
When user clicks "Analyze" mode button, automatically run:
```typescript
const sentences = await analyzeSentences(bufferContent);
setAnalysisData({ sentences });
setActiveHighlights(['ai-detection']);
```

### 2. Center Content Alignment (Medium)
Update CSS to center the main content area while keeping text left-aligned within.

### 3. Dynamic Title Bar (Medium)
Show current buffer name in center of title bar, with back/forward navigation.

### 4. Transform Integration (Medium)
When user selects text and clicks Transform mode:
- Show transformation options (intensity, persona, style)
- Run humanization
- Display diff in Compare mode

### 5. OAuth Token Import (Low)
For Electron users who authenticated via web, provide a way to paste/import their auth token.

---

## Commands

```bash
# Development
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Production Build
npm run electron:build

# Run Built App
open release/mac-arm64/Humanizer.app

# Test Endpoints
curl http://localhost:3003/health
curl http://localhost:3002/api/health
```

---

## Files Changed This Session

| File | Changes |
|------|---------|
| `package.json` | Moved electron-store, added SQL copy |
| `electron-builder.json` | Removed extraResources, arm64 only |
| `apps/web/vite.config.ts` | Added `base: './'` |
| `apps/web/src/App.tsx` | HashRouter, imports |
| `apps/web/src/lib/auth/api.ts` | Electron OAuth handling |
| `apps/web/src/lib/auth/AuthContext.tsx` | External browser OAuth |
| `apps/web/src/lib/platform/index.ts` | Shell API type |
| `apps/web/src/lib/aui/AUIContext.tsx` | Fixed init order |
| `electron/main.ts` | shell:open-external handler |
| `electron/preload.ts` | shell API |
| `electron/chat/store.ts` | Fixed schema exec |
| `build-resources/*` | Created icons, entitlements |

---

## Known Issues

1. **OAuth in Electron**: Opens browser, but no way to bring token back to app yet
2. **Biometric/Passkeys**: Not supported in Electron context
3. **Toolbar highlights**: Buttons toggle state but don't trigger analysis
4. **GPTZero**: Premium feature, not wired to local
5. **Stylometry**: Not implemented

---

**End of Handoff**
