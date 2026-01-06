# Handoff: AUI Tools & Harvest Workflow

**Date**: January 4, 2026
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Partial fixes applied, more tool aliases needed

---

## Summary

Fixed several issues with book creation, harvest workflow, and AUI tools. However, AUI generates tool names that don't always match - need to audit all tool name variations.

---

## Completed This Session

### 1. `create_book` AUI Tool
**File**: `apps/web/src/lib/aui/tools.ts` (lines 245-252)

Added tool with aliases:
- `create_book`, `CREATE_BOOK`, `book_workspace`, `create_project`, `new_book`, `new_project`

Also added to:
- `apps/web/src/lib/aui/context-builder.ts` - `createProject` in interface and buildAUIContext

### 2. Book Naming UI
**File**: `apps/web/src/components/archive/BooksView.tsx` (line 253)

Changed "+ New Project" to prompt for name and subtitle before creating.

### 3. Harvest Results Refresh
**File**: `apps/web/src/lib/bookshelf/BookshelfContext.tsx` (lines 140-142, 524-526)

Added `bucketVersion` state and `refreshBuckets()` function to trigger UI updates when buckets change externally.

**File**: `apps/web/src/components/tools/HarvestQueuePanel.tsx` (line 349)

Added `bookshelf.bucketVersion` to `useMemo` dependencies.

**File**: `apps/web/src/components/archive/BooksView.tsx` (line 511)

Called `bookshelf.refreshBuckets()` after harvest completes.

### 4. HarvestWorkspaceView
**File**: `apps/web/src/components/workspace/HarvestWorkspaceView.tsx` (NEW)

Full conversation review in workspace with:
- Message stepper (j/k navigation)
- Per-message Stage/Gem/Skip actions
- Keyboard shortcuts
- Commit staged content to buffer

---

## Known Issue: AUI Tool Name Variations

AUI (the LLM) generates tool names that don't always match our implementations. Examples seen:
- `CREATE_BOOK` instead of `create_book`
- `book_workspace` instead of `create_book`

**Solution**: Add more aliases to the switch statement in `executeTool()`. Consider:
1. Making tool matching case-insensitive (convert to lowercase before switch)
2. Adding a tool name normalization function

### Recommended Fix

In `apps/web/src/lib/aui/tools.ts`, around line 241:

```typescript
export async function executeTool(
  toolUse: ParsedToolUse,
  context: AUIContext
): Promise<AUIToolResult> {
  // Normalize tool name: lowercase and replace common variations
  const name = toolUse.name.toLowerCase().replace(/_workspace$/, '').replace(/^new_/, 'create_');
  const { params } = toolUse;

  switch (name) {
    case 'create_book':
    case 'create_project':
      return executeCreateBook(params, context);
    // ... etc
  }
}
```

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `apps/web/src/lib/aui/tools.ts` | Added `create_book` tool, aliases |
| `apps/web/src/lib/aui/context-builder.ts` | Added `createProject` |
| `apps/web/src/lib/bookshelf/BookshelfContext.tsx` | Added `bucketVersion`, `refreshBuckets` |
| `apps/web/src/components/archive/BooksView.tsx` | Name prompts, refreshBuckets call |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | bucketVersion in useMemo |
| `apps/web/src/components/workspace/HarvestWorkspaceView.tsx` | NEW - full conversation review |
| `apps/web/src/components/workspace/index.ts` | Export HarvestWorkspaceView |
| `apps/web/src/Studio.tsx` | Wire up HarvestWorkspaceView, props threading |
| `apps/web/src/index.css` | CSS for HarvestWorkspaceView, review button |

---

## Next Steps

1. **Audit AUI tool calls** - Watch for more "Unknown tool" errors in AUI chat
2. **Normalize tool names** - Make matching case-insensitive, handle variations
3. **Test full harvest workflow**:
   - Create book (via GUI or AUI)
   - Start harvest
   - Review in Tools → Harvest
   - Use "Review" button for full conversation view
   - Stage/commit content

---

## Build Commands

```bash
# Development
npm run electron:dev

# Production
npm run electron:build
open /Users/tem/humanizer_root/humanizer-gm/release/mac-arm64/Humanizer.app
```

---

## ChromaDB Memory

Store this handoff:
```
mcp__chromadb-memory__search_by_tag tags: ["handoff", "aui-tools", "january-2026"]
```
