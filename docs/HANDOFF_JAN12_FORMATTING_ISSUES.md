# Handoff: Notes Tab & Formatting Issues - Jan 12, 2026

## Session Summary

Phase 1 of the Universal Archive Interface was partially implemented, but significant formatting issues remain unresolved.

---

## Commits This Session (9 total)

| Commit | Description | Status |
|--------|-------------|--------|
| `0687755` | Phase 1: Notes tab, search_content tool, schema v15 | Working |
| `1c549fa` | Fix migration to be idempotent | Working |
| `5717d47` | Add textCleaner utility for HTML stripping | Working |
| `d41661d` | Improve whitespace normalization | Working |
| `9dfd447` | Try paragraph elements in ContentViewer | Did not fix |
| `0fdad2d` | Add remark-breaks plugin | Caused LaTeX issues |
| `35cb068` | Revert remark-breaks | Reverted |
| `dfba413` | Route Facebook to main workspace | Partial - ContentViewer still showing |
| `7485e6f` | Add media rendering for Facebook content | Not tested |

---

## Current State

### What Works
1. **Notes tab in Archive Panel** - Shows notes list with proper formatting
2. **Notes expanded in Archive Panel** - Paragraph breaks display correctly
3. **Main workspace (Read mode)** - Uses AnalyzableMarkdown, displays paragraphs correctly
4. **textCleaner utility** - Strips HTML/XML tags, normalizes whitespace
5. **Schema v15 migration** - Added uri, content_hash, source_id, imported_at columns

### What's Broken

#### 1. ContentViewer Still Showing for Facebook Content
**Problem**: When clicking "Open in Workspace" on Notes, the ContentViewer component shows (the "Post" header view) instead of the main workspace.

**Root Cause**: Despite setting `setSelectedFacebookContent(null)` in `handleSelectFacebookContent`, the ContentViewer is still being triggered somehow.

**File**: `apps/web/src/Studio.tsx` lines 131-151

```typescript
// Current code - should NOT show ContentViewer
const handleSelectFacebookContent = useCallback((content: SelectedFacebookContent) => {
  setSelectedFacebookContent(null); // <-- This should prevent ContentViewer
  // ... rest of code
  importText(content.text, ...); // <-- This should use main workspace
}, [importText]);
```

**Investigation needed**: Check why ContentViewer still renders. May be:
- State not clearing properly
- Another code path setting selectedFacebookContent
- Race condition

#### 2. ContentViewer Shows Text as Block
**Problem**: When ContentViewer DOES show, text appears as one solid block without paragraph breaks.

**Attempts that failed**:
1. Split on `\n` and render as `<p>` elements (commit `9dfd447`)
2. CSS `white-space: pre-wrap` (was already there)

**File**: `apps/web/src/components/workspace/ContentViewer.tsx`

The current code splits on newlines and renders paragraphs, but they still appear as a block. CSS may be overriding.

#### 3. Facebook Social Graph Broken
**Error**:
```
GET http://localhost:5174/node_modules/.vite/deps/d3-force.js?v=a94029a3 net::ERR_ABORTED 504 (Outdated Optimize Dep)
```

**Cause**: Vite dependency cache is stale after package changes (remark-breaks install/uninstall).

**Fix**: Clear Vite cache:
```bash
rm -rf apps/web/node_modules/.vite
npm run electron:dev
```

#### 4. LaTeX Rendering Issues
**Symptoms**:
- Standout equations (`$$...$$`) not centered
- May have lost spacing around equations
- Title headers showing markdown characters instead of rendered

**Possible causes**:
- remark-breaks install/revert may have affected dependencies
- CSS changes may have affected math rendering
- MathMarkdown or MathRenderer may need checking

**Files to check**:
- `apps/web/src/components/markdown/MathMarkdown.tsx`
- `apps/web/src/components/markdown/MathRenderer.tsx`
- CSS for `.workspace__markdown` and math classes

---

## Key Files

### Text Cleaning
- `apps/web/src/lib/utils/textCleaner.ts` - HTML stripping, whitespace normalization

### Content Rendering
- `apps/web/src/components/workspace/ContentViewer.tsx` - Facebook post/comment view (BROKEN)
- `apps/web/src/components/workspace/MainWorkspace.tsx` - Main workspace with AnalyzableMarkdown
- `apps/web/src/components/workspace/AnalyzableMarkdown.tsx` - Markdown renderer wrapper
- `apps/web/src/components/markdown/MathMarkdown.tsx` - Math-aware markdown
- `apps/web/src/components/markdown/MathRenderer.tsx` - KaTeX integration

### Facebook Content Flow
- `apps/web/src/Studio.tsx` - `handleSelectFacebookContent` function (line ~131)
- `apps/web/src/components/archive/FacebookView.tsx` - Notes tab, "Open in Workspace" button

### CSS
- `apps/web/src/styles/features/content-viewer.css` - ContentViewer styles
- `apps/web/src/styles/features/workspace.css` - Workspace styles (includes new media section)

---

## Recommended Next Steps

### 1. Fix Vite Cache (Quick)
```bash
rm -rf apps/web/node_modules/.vite
npm run electron:dev
```

### 2. Debug ContentViewer Issue
Add console.log in Studio.tsx to trace why ContentViewer shows:
```typescript
// In renderWorkspaceContent
console.log('selectedFacebookContent:', selectedFacebookContent);
console.log('activeContent:', activeContent);
```

### 3. Consider Simpler Approach
Instead of trying to make ContentViewer work, consider:
- Removing ContentViewer entirely for Facebook content
- Always using main workspace (AnalyzableMarkdown) which already works
- Only use ContentViewer for media-only content

### 4. Check LaTeX Rendering
- Compare current rendering to before this session
- Check if math CSS was affected
- Verify KaTeX is loading correctly

---

## ChromaDB Memory Tags
- `jan-12-2026-s12` - This session
- `formatting-issues` - Ongoing formatting problems
- `contentviewer-broken` - ContentViewer specific issues

---

## To Resume

```bash
# Retrieve context
mcp__chromadb-memory__search_by_tag(["jan-12-2026-s12"])
mcp__chromadb-memory__search_by_tag(["formatting-issues"])

# Fix Vite cache first
cd /Users/tem/humanizer_root/humanizer-gm
rm -rf apps/web/node_modules/.vite
npm run electron:dev
```

---

## What User Wants
- Facebook notes/posts/comments with proper paragraph formatting in workspace
- Images from Facebook posts visible in workspace
- LaTeX equations properly rendered (centered, spaced)
- Use the same rendering as "message" view (AnalyzableMarkdown) which already works

The user noted: "can we just use the more robust message formatting to format Facebook posts, comments and notes?" - This is the right approach, but the implementation isn't working as expected.
