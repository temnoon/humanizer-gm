# Session Handoff: Dec 28, 2025 - AUI Tools & Workspace Fixes

## Accomplishments

### 1. AUI Tool Execution Fixed
The AUI was showing tool commands but not executing them. Three root causes fixed:

**A. System prompt had no tool list**
- Added 20+ tools with examples to `AUIContext.tsx:122-168`
- Clear instruction: "Execute tools directly. Don't explain - just do it."

**B. Tool syntax visible to user**
- Changed execution order: tools run BEFORE displaying message
- Clean tool syntax from response using `cleanToolsFromResponse()`
- If response is only a tool call, show just results (no empty message)

**C. Regex broke on nested JSON**
- Replaced simple regex with brace-matching parser in `tools.ts:135-200`
- Handles nested objects like `{"options": {"limit": 10}}`

### 2. Workspace State Connection (KEY FIX)
The AUI couldn't access buffer content because `AUIProvider` wrapped `StudioContent` from outside.

**Fix:**
- Added `workspaceState` state to `AUIProvider`
- Added `setWorkspace()` function exposed via context
- `StudioContent` now syncs workspace state:
```typescript
const { setWorkspace } = useAUI();
useEffect(() => {
  setWorkspace(workspaceState);
}, [workspaceState, setWorkspace]);
```

### 3. AUI Styling Fixes
| Change | Before | After |
|--------|--------|-------|
| Input element | `<input type="text">` | `<textarea>` with auto-expand |
| Input height | Single line | 44px min, 200px max |
| Message gap | `--space-sm` (8px) | `--space-md` (16px) |
| Message padding | `--space-sm` vertical | `--space-md` all around |
| Line height | 1.5 | 1.6 |

## Files Modified

| File | Changes |
|------|---------|
| `AUIChatTab.tsx` | textarea, auto-resize, new placeholder |
| `AUIContext.tsx` | System prompt, workspace state, setWorkspace |
| `tools.ts` | Robust JSON parser, clean function |
| `index.css` | textarea styles, padding, gaps |
| `Studio.tsx` | Import useAUI, sync workspaceState |

## Outstanding Issues

### Facebook Images Broken in Main Viewer
- **Symptom**: Thumbnails in Gallery work, but clicking opens broken image in main viewer
- **Screenshot**: `/Users/tem/Desktop/Screenshot 2025-12-27 at 11.41.32 PM.png`
- **Investigation started**: The `getMediaUrl()` function should handle HTTP URLs, but something is wrong

**Code locations to check:**
- `Studio.tsx:1804-1821` - `getMediaUrl()` function
- `GalleryView.tsx:146` - passes `image.url` as `file_path`
- `Studio.tsx:2034` - uses `getMediaUrl(selectedMedia.file_path)`

**Likely issues:**
1. `file_path` might be undefined when passed to viewer
2. Encoding mismatch between `serve-media` (encodeURIComponent) and `image` (btoa) endpoints

### Workspace Architecture Discussion
User noted that images open in a separate "overlay viewer" (`media-viewer`, `content-viewer`) rather than integrating with the buffer system.

**Current behavior:**
- Clicking image sets `selectedMedia` state
- This triggers `media-viewer` component (overlays workspace)
- Has its own back button, not in buffer queue

**Desired behavior:**
- Clicking image should add it to buffer queue
- Images treated like any other content node
- Buffer system becomes foundation for batch operations
- Agents can queue work: "Categorize all images saving metadata"

## Next Session Priorities

1. **Fix Facebook image display** - Debug why main viewer shows broken images
2. **Book system rebuild** - Port concepts from Narrative Studio, start fresh
3. **Buffer-centric media** - Consider refactoring media viewer to use buffer system

## Key Insights

The workspace has two parallel systems:
1. **Buffer system** - Content graph with nodes, history, branches
2. **Viewer overlays** - `media-viewer`, `content-viewer` that bypass buffers

Unifying these would enable:
- Batch processing queues
- Agent-orchestrated workflows
- Consistent navigation (back/forward in buffer history)
