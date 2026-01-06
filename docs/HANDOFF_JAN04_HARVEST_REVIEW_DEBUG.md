# Handoff: Harvest Review Debug Session
**Date**: January 4, 2026
**Session Focus**: AUI Tool Integration, sqlite-vec, Harvest Flow
**Status**: Significant progress, one remaining bug in HarvestWorkspaceView

---

## Executive Summary

This session made major progress on the AUI harvest pipeline. We fixed:
- Tool name normalization for AUI's creative naming
- `create_book` tool missing from prompts and context
- sqlite-vec native extension bundling for packaged Electron app
- `conversationFolder` vs `conversationId` for API calls
- Content extraction from array-based message format

**Remaining Bug**: HarvestWorkspaceView renders only the title, not message content.

---

## What Works Now

### 1. AUI Tool Execution
- `create_book` tool works - books appear in Books list
- Tool name normalization handles variations (`book_create`, `CREATE_BOOK`, `book_builder`)
- Prompts include `create_book` in all three tiers (TINY, STANDARD, FULL)

### 2. sqlite-vec Vector Search
- Custom path finder for packaged Electron apps (`findSqliteVecPath()`)
- Searches multiple paths including `app.asar.unpacked/node_modules/sqlite-vec/node_modules/`
- Embeddings search returns results (319MB database at `/Users/tem/openai-export-parser/output_v13_final/.embeddings.db`)

### 3. Harvest Flow
- Harvest buckets create successfully
- Semantic search finds candidates (32+ results)
- `conversationFolder` properly passed through sourceRef
- API calls use folder name, not UUID

---

## The Remaining Bug

### Symptom
When clicking "📖 Review" on a harvest passage:
1. Workspace title shows correctly (e.g., "Explain Husserl")
2. Message content area is **empty**
3. HarvestWorkspaceView renders but shows no messages

### Screenshot Analysis (9:07 PM)
- Workspace shows "Explain Husserl" title
- Below title: empty space
- No message cards, no navigation, no content

### Root Cause Hypothesis
The `extractContent()` function was added but may not be handling all cases:

```typescript
// In Studio.tsx handleReviewInWorkspace (line ~4562)
const extractContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: { type?: string }) => part?.type === 'text')
      .map((part: { content?: string }) => part?.content || '')
      .join('\n');
  }
  return '';
};
```

**Possible Issues**:
1. Message content parts may have different structure than expected
2. Messages array might be empty after filtering
3. HarvestWorkspaceView might not be rendering (check `harvestReview` state)

### Debug Steps for Next Session

1. **Add Console Logging**:
```typescript
// In handleReviewInWorkspace after fetch
console.log('[Review] Raw API response:', data);
console.log('[Review] Raw messages:', data.messages);
console.log('[Review] Extracted messages:', messages);
console.log('[Review] Message count:', messages.length);
```

2. **Check API Response Structure**:
```bash
curl -s http://localhost:PORT/api/conversations/FOLDER_NAME | python3 -m json.tool | head -100
```

3. **Verify Content Part Structure**:
- Check if `part.type === 'text'` matches actual data
- Check if `part.content` exists (might be `part.text` instead)

4. **Test HarvestWorkspaceView Directly**:
- Pass hardcoded messages to verify component renders
- Check CSS for display:none or height:0 issues

---

## Files Modified This Session

### Core Type Changes
- `packages/core/src/types/entity.ts` - Added `conversationFolder` to `SourceReference`

### AUI Tools
- `apps/web/src/lib/aui/tools.ts`:
  - Added `normalizeToolName()` function (line ~244)
  - Aliases: `book_create`, `book_builder`, `book_new`, `new_book_project`
  - Better logging in `executeCreateBook()`

- `electron/agent-master/prompts/chat.ts`:
  - Added `create_book` tool to TINY, STANDARD, FULL tiers
  - Strengthened "CRITICAL: Use EXACT tool names" warnings

### Context Wiring
- `apps/web/src/lib/aui/AUIContext.tsx`:
  - Added `createProject` to fallback book object (line ~285)
  - Added `createProject` to both toolContext objects (lines ~334, ~504)

### sqlite-vec Fix
- `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`:
  - Added `findSqliteVecPath()` function (line ~37)
  - Tries standard load, then custom paths
  - Handles nested node_modules in asar unpacked

- `electron-builder.json`:
  - Added sqlite-vec to `files` array
  - Added `asarUnpack` for sqlite-vec and better-sqlite3

### Harvest Panel
- `apps/web/src/components/tools/HarvestQueuePanel.tsx`:
  - Added `conversationFolder` to result types (line ~384)
  - Store `conversationFolder` in sourceRef (line ~430)
  - Use `conversationFolder` for API calls (line ~64, ~71, ~98, ~132)

### Content Extraction
- `apps/web/src/Studio.tsx`:
  - Added `extractContent()` helper in `handleReviewInWorkspace` (line ~4563)
  - Extracts text from `[{type: 'text', content: '...'}]` array format

---

## Architecture Understanding

### Harvest Flow
```
User clicks "create book" in AUI
  → AUI generates USE_TOOL(create_book, {...})
  → tools.ts executeTool() normalizes name
  → executeCreateBook() calls context.createProject()
  → Book appears in BooksView

User asks to harvest
  → harvest_archive tool calls /api/embeddings/search/messages
  → sqlite-vec performs vector similarity search
  → Results include conversationId, conversationFolder, conversationTitle
  → Passages added to harvest bucket

User clicks "Review" on passage
  → handleReviewInWorkspace(conversationFolder, title, passage)
  → Fetches /api/conversations/{folder}
  → API returns messages as array of content parts
  → extractContent() converts to plain strings
  → setHarvestReview() updates state
  → HarvestWorkspaceView renders (BROKEN - shows only title)
```

### Key Data Structures

**API Message Format** (from conversations API):
```json
{
  "id": "abc123",
  "role": "assistant",
  "content": [
    {"type": "text", "content": "The actual text..."},
    {"type": "image", "url": "/api/...", "filename": "img.png"}
  ]
}
```

**Expected by HarvestWorkspaceView**:
```typescript
interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;  // Plain string, not array
}
```

---

## Commands

```bash
# Development
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Production build
npm run electron:build
open release/mac-arm64/Humanizer.app

# Test API directly
curl http://localhost:PORT/api/health
curl http://localhost:PORT/api/embeddings/status
curl -X POST http://localhost:PORT/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "phenomenology", "limit": 5}'
```

---

## Next Steps Priority

1. **DEBUG**: Add logging to trace message extraction
2. **FIX**: Correct content extraction to match actual API format
3. **TEST**: Verify HarvestWorkspaceView receives and renders messages
4. **VALIDATE**: Full harvest-to-review flow works end-to-end

---

## ChromaDB Memory ID
Store this handoff for retrieval: `handoff-jan04-harvest-review-debug`

**End of Handoff**
