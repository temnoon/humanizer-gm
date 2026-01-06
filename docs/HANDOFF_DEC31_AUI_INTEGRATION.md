# Handoff: AUI Integration & Debugging Session

**Date**: December 31, 2025 ~2:30 AM
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Multiple fixes applied, more work needed

---

## Session Summary

Continued from AgentMaster Phase 2. This session focused on:
1. Wiring AUI to trigger GUI actions
2. Filtering JSON noise from semantic search
3. Styling fixes for chat window
4. Model configuration (switched to qwen3:14b)

---

## Commits Needed

Run these after review:
```bash
git add -A
git commit -m "feat(aui): Wire GUI actions, filter search noise, improve styling"
```

---

## What Was Fixed

### 1. Container Context Wired
**Files**: `tools.ts`, `AUIContext.tsx`, `Studio.tsx`
- Added `selectedContainer` to `WorkspaceState` type
- `buildWorkspaceContext()` now describes selected content (type, title, preview, tags)
- Studio passes `selectedContainer` in workspace state

### 2. Duplicate Message Bug Fixed
**File**: `electron/chat/service.ts`
- User message was being sent twice (stored before callLLM, then added again as input)
- Now skips last stored message if it matches current input

### 3. Prompt Anti-Hallucination
**File**: `electron/agent-master/prompts/chat.ts`
- All tiers now include: "CRITICAL: When you use USE_TOOL(), STOP. Never generate fake results."

### 4. Panel Action Handler
**File**: `Studio.tsx`
- TopBar now subscribes to `open_panel` GUI actions
- When tools call `dispatchOpenPanel('archives', 'explore')`, panel actually opens

### 5. JSON Noise Filter
**File**: `tools.ts` - `isValidSearchResult()` function
- Filters out JSON field names, system markers, high bracket content
- Requests 3x results to compensate for filtering

### 6. Chat Window Styling
**File**: `index.css`
- Messages: `--space-md --space-lg` padding, `--radius-large`
- Tool results: `--space-md` gap/padding, `--radius-large`
- Teaching section: `--space-md` margin + left padding, solid border
- Archive notice: `--space-small` vertical padding

### 7. Model Default Changed
**File**: `electron/main.ts`
- Fallback model changed from `llama3.2` (3b) to `qwen3:14b`
- Larger model follows tool instructions better

---

## Known Issues / Still Broken

### 1. Unknown Tool Errors (from AUI transcript)
```
Unknown tool: explore
Unknown tool: qbism
Unknown tool: text_analysis
```
**Problem**: LLM is generating tool names that don't exist
**Fix needed**: Either add aliases or improve prompt to use exact names:
- `explore` → should be `search_archive` or need to add `explore` alias
- `qbism` → should be `quantum_read`
- `text_analysis` → should be `analyze_text`

### 2. Transform View Styling (Screenshot 2:26 AM)
**Problem**: Cramped two-pane view after transformation
**Needs**:
- Generous reading space (match Nagarjuna screenshot style)
- Smooth animation from single-pane to two-pane (not flash)
- Consistent styling across all split views

### 3. Conversation List Sync
**User request**: When viewing a conversation in workspace, scroll to & highlight it in the conversations list
**Needs**:
- State sync between workspace and archive panel
- Virtual scroll for 1700 conversations (performance)
- Lazy load message names (only when expanded)

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `apps/web/src/lib/aui/tools.ts` | Added `ArchiveContainer` import, `selectedContainer` to WorkspaceState, `isValidSearchResult()` filter |
| `apps/web/src/lib/aui/AUIContext.tsx` | Enhanced `buildWorkspaceContext()` for container awareness |
| `apps/web/src/Studio.tsx` | Pass `selectedContainer` in workspaceState, subscribe to `open_panel` GUI actions |
| `apps/web/src/index.css` | Chat window styling (padding, border-radius) |
| `electron/chat/service.ts` | Fix duplicate message bug |
| `electron/agent-master/prompts/chat.ts` | Anti-hallucination instructions in all tiers |
| `electron/main.ts` | Model default to `qwen3:14b` |

---

## Architecture Notes

### AUI → GUI Flow (Now Working)
```
User: "search for philosophy"
    ↓
AUI generates: USE_TOOL(search_archive, {"query": "philosophy"})
    ↓
executeAllTools() parses and calls executeSearchArchive()
    ↓
executeSearchArchive():
  1. Calls archive API
  2. Filters JSON noise
  3. dispatchSearchResults() → ExploreView receives via useSearchResultsAction()
  4. dispatchOpenPanel('archives', 'explore') → TopBar opens panel
    ↓
Results appear in Archive panel's Explore tab
```

### Model Selection Flow
```
ChatService.sendMessage()
    ↓
ChatService.callLLM()
    ↓
AgentMaster.execute({ capability: 'chat', ... })
    ↓
PromptEngine selects tier (tiny/standard/full based on RAM)
    ↓
AIControlService.call() routes to provider
    ↓
providers.ts callOllama() with model from config
    ↓
Model: store.get('ollamaModel') || 'qwen3:14b'
```

---

## Next Session Priorities

1. **Add tool aliases** - Map common names to actual tool names
2. **Transform view styling** - Match the Nagarjuna split-screen aesthetic
3. **Smooth animation** - Transition from single to split pane
4. **Conversation list sync** - Highlight current conversation in list

---

## Test Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# In dev console:
await electronAPI.store.get('ollamaModel')  // Check model
await electronAPI.store.set('ollamaModel', 'qwen3:14b')  // Set model

# Make sure model is pulled:
ollama pull qwen3:14b
```

---

## Screenshots Referenced

1. **1:56 AM** - AUI triggering search, JSON noise in results
2. **1:53 AM** - More search results with errors
3. **12:49 AM** - Beautiful Nagarjuna split-screen (TARGET STYLE)
4. **2:26 AM** - Cramped transform view (NEEDS FIXING)

---

## Context for Next Session

```
AUI Integration session complete.

What's Done:
- Container context wired (AUI knows what you're viewing)
- GUI action handler (panels open when tools request)
- JSON noise filtered from search
- Chat styling improved (padding, radius)
- Model upgraded to qwen3:14b

What's Broken:
- Unknown tool errors (explore, qbism, text_analysis)
- Transform view cramped (needs Nagarjuna-style spacing)
- No smooth animation for split pane transition
- Conversation list doesn't sync with workspace

Read: docs/HANDOFF_DEC31_AUI_INTEGRATION.md
Branch: feature/xanadu-768-embeddings
```

---

**End of Handoff**
