# Handoff: AUI GUI Context Awareness

**Date**: January 21, 2026
**Status**: Planning complete, ready for implementation
**Priority**: High - AUI currently cannot answer questions about GUI state

---

## Problem Statement

The AUI currently responds "I couldn't process that" when asked about books, chapters, cards, or GUI state because:

1. **No book list context** - AUI doesn't know what books exist
2. **No active state context** - AUI doesn't know what's currently selected/visible
3. **No tool awareness** - AUI doesn't know what tools are available and how to use them
4. **No vocabulary mapping** - User might say "the current page" or "this chapter" and AUI doesn't understand

---

## Current State

### What Works
- Electron chat routes through AgentMaster with tiered prompts
- Vetting strips `<think>` tags from Qwen/DeepSeek models
- Cloud indicator shows when data leaves local machine
- 25 Book Studio tools are wired to API

### What's Missing
- `buildWorkspaceContext()` in AUIContext.tsx only includes minimal info
- System prompt doesn't list all available tools
- No book/chapter/card inventory passed to LLM
- No mapping of user language to GUI concepts

---

## Implementation Plan

### Phase 1: Enhanced Workspace Context (Priority: Critical)

**File**: `apps/web/src/lib/aui/AUIContext.tsx`

Update `buildWorkspaceContext()` to include:

```typescript
function buildWorkspaceContext(
  workspace: AUIToolContext['workspace'],
  book: BookContext,
  bookStudio: BookStudioContext  // NEW
): string {
  const parts: string[] = [];

  // 1. Book Studio State
  if (bookStudio) {
    // List all books
    const books = bookStudio.listBooks();
    parts.push(`Available books (${books.length}):`);
    books.forEach(b => {
      const active = b.id === bookStudio.activeBookId ? ' [ACTIVE]' : '';
      parts.push(`  - "${b.title}"${active} (${b.cardCount} cards, ${b.chapterCount} chapters)`);
    });

    // Active book details
    if (bookStudio.activeBook) {
      const ab = bookStudio.activeBook;
      parts.push(`\nActive book: "${ab.title}"`);

      // Chapters
      if (ab.chapters?.length) {
        parts.push(`Chapters (${ab.chapters.length}):`);
        ab.chapters.forEach((ch, i) => {
          parts.push(`  ${i+1}. "${ch.title}" (${ch.wordCount} words, ${ch.cards?.length || 0} cards)`);
        });
      }

      // Cards summary
      const staging = ab.stagingCards?.length || 0;
      const placed = ab.chapters?.reduce((sum, ch) => sum + (ch.cards?.length || 0), 0) || 0;
      parts.push(`Cards: ${staging} staging, ${placed} placed`);

      // Voice profiles
      if (ab.voices?.length) {
        parts.push(`Voice profiles: ${ab.voices.map(v => v.name).join(', ')}`);
      }
    }
  }

  // 2. Current Selection (existing code, enhanced)
  if (workspace?.selectedContainer) {
    // ... existing container code
  }

  // 3. Current View Mode
  parts.push(`\nCurrent view: ${workspace?.viewMode || 'unknown'}`);

  return parts.join('\n');
}
```

**Tasks**:
- [ ] Add BookStudioContext to AUIProvider dependencies
- [ ] Import book studio hooks/context
- [ ] Enhance buildWorkspaceContext with full inventory
- [ ] Include card counts, chapter list, voice profiles

### Phase 2: Comprehensive Tool Documentation

**File**: `apps/web/src/lib/aui/tools/system-prompt.ts`

Add all 72 tools to the system prompt with clear categories:

```typescript
// Tool categories for system prompt
const TOOL_DOCUMENTATION = `
## Available Tools (72 total)

### Book Management
- list_books: List all your books
- create_book: Create a new book
- get_book: Get book details
...

### Card Operations (Book Studio)
- list_cards: List cards in active book
- harvest_card: Create card from content
- move_card: Assign card to chapter
- batch_update_cards: Update multiple cards
...

### Harvest Workflow
- search_for_harvest: Search archive for content
- commit_harvest: Convert results to cards
...

### Draft Generation
- generate_chapter_draft: Generate via LLM
- accept_draft: Publish to chapter
...

### Voice Profiles
- extract_voice: Extract from samples
- apply_book_voice: Transform with voice
...
`;
```

**Tasks**:
- [ ] Enumerate all tools by category
- [ ] Add parameter documentation
- [ ] Add example usage for each
- [ ] Include "when to use" guidance

### Phase 3: Vocabulary Mapping

**File**: `apps/web/src/lib/aui/tools/vocabulary.ts` (NEW)

Create mapping from user language to tool actions:

```typescript
export const VOCABULARY_MAPPINGS = {
  // Book references
  'the current book': 'activeBook',
  'this book': 'activeBook',
  'my book': 'activeBook',
  'the book': 'activeBook',

  // Chapter references
  'this chapter': 'selectedChapter',
  'the current chapter': 'selectedChapter',
  'chapter 1': { type: 'chapter', index: 0 },

  // Card references
  'this card': 'selectedCard',
  'the selected card': 'selectedCard',
  'staging cards': 'stagingCards',
  'unassigned cards': 'stagingCards',

  // Content references
  'this content': 'workspace.bufferContent',
  'the text': 'workspace.bufferContent',
  'what I'm looking at': 'workspace.selectedContainer',

  // Actions
  'add to book': 'harvest_card',
  'save this': 'harvest_card',
  'move to chapter': 'move_card',
  'generate draft': 'generate_chapter_draft',
  'find similar': 'search_for_harvest',
};

export const ACTION_MAPPINGS = {
  'show me': ['list_cards', 'list_chapters', 'get_book'],
  'find': ['search_for_harvest', 'search_archive'],
  'add': ['harvest_card', 'create_chapter'],
  'create': ['create_book', 'create_chapter', 'harvest_card'],
  'move': ['move_card', 'batch_update_cards'],
  'generate': ['generate_chapter_draft', 'extract_voice'],
  'analyze': ['auto_assign_cards', 'get_assignment_stats'],
};
```

**Tasks**:
- [ ] Create vocabulary.ts with mappings
- [ ] Add to system prompt as examples
- [ ] Include in buildWorkspaceContext as "User might refer to X as Y"

### Phase 4: GUI State Sync

**File**: `apps/web/src/lib/aui/hooks/useGUIState.ts` (NEW)

Create hook that aggregates all GUI state for AUI:

```typescript
export function useAUIGUIState() {
  const bookStudio = useBookStudio();
  const bookshelf = useBookshelf();
  const layout = useLayout();
  const workspace = useWorkspace();

  return useMemo(() => ({
    // Books
    books: bookStudio.books,
    activeBook: bookStudio.activeBook,
    activeChapter: bookStudio.activeChapter,

    // Cards
    stagingCards: bookStudio.stagingCards,
    selectedCards: bookStudio.selectedCardIds,

    // View state
    viewMode: layout.mode,
    panelOpen: layout.panelOpen,

    // Selection
    selectedContent: workspace.selectedContainer,
    bufferContent: workspace.bufferContent,

    // Summary for LLM
    toContextString: () => buildWorkspaceContext(...),
  }), [bookStudio, bookshelf, layout, workspace]);
}
```

**Tasks**:
- [ ] Create useAUIGUIState hook
- [ ] Integrate with AUIProvider
- [ ] Auto-update context when GUI changes
- [ ] Debounce updates to avoid excessive re-renders

### Phase 5: Smart Tool Selection

**File**: `apps/web/src/lib/aui/tools/smart-dispatch.ts` (NEW)

Help LLM select the right tool based on context:

```typescript
export function suggestTools(
  userIntent: string,
  guiState: GUIState
): ToolSuggestion[] {
  const suggestions: ToolSuggestion[] = [];

  // If user mentions "cards" and has staging cards
  if (userIntent.includes('card') && guiState.stagingCards.length > 0) {
    suggestions.push({
      tool: 'list_cards',
      reason: `You have ${guiState.stagingCards.length} staging cards`,
    });
  }

  // If user mentions "draft" and has cards in chapter
  if (userIntent.includes('draft') && guiState.activeChapter?.cards?.length) {
    suggestions.push({
      tool: 'generate_chapter_draft',
      params: { chapterId: guiState.activeChapter.id },
      reason: `Chapter has ${guiState.activeChapter.cards.length} cards to draft from`,
    });
  }

  return suggestions;
}
```

**Tasks**:
- [ ] Create smart-dispatch.ts
- [ ] Add intent detection patterns
- [ ] Integrate with tool execution
- [ ] Add to system prompt as hints

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `AUIContext.tsx` | Modify | Enhanced buildWorkspaceContext |
| `system-prompt.ts` | Modify | Full tool documentation |
| `vocabulary.ts` | Create | User language mappings |
| `useAUIGUIState.ts` | Create | Aggregated GUI state hook |
| `smart-dispatch.ts` | Create | Intent-based tool suggestions |

---

## Testing Plan

After implementation, test these queries:

1. "What books do I have?" → Should list all books
2. "What's in this book?" → Should describe active book
3. "Show me the cards" → Should list_cards
4. "Add this to chapter 1" → Should move_card
5. "Generate a draft" → Should generate_chapter_draft with context
6. "Find content about X" → Should search_for_harvest

---

## Dependencies

- BookStudioProvider context
- Bookshelf context
- Layout context
- Workspace state

---

## Session Summary (Jan 21, 2026)

### Completed This Session

1. **Wired 25 AUI Tools to Book Studio API**
   - Card tools: list_cards, harvest_card, update_card, move_card, batch_update_cards
   - Harvest tools: search_for_harvest, commit_harvest, iterate_harvest, get_harvest_history, create_harvest_rule
   - Draft tools: generate_chapter_draft, save_draft, review_draft, accept_draft, compare_drafts
   - Voice tools: extract_voice, list_book_voices, apply_book_voice, set_primary_voice, get_voice_features
   - Assignment tools: auto_assign_cards, apply_assignments, get_assignment_stats
   - Batch tools: create_chapters_batch, harvest_cards_batch

2. **Removed Hardcoded Models**
   - Removed `ollamaModel: 'qwen3:14b'` from main.ts
   - Changed chat service to use `model: 'auto'` for router selection
   - AUIContext fallback now discovers available Ollama models

3. **Added Cloud LLM Indicator**
   - Track isCloud flag in LLMResponse
   - Display "☁ Cloud LLM" badge on cloud-generated messages
   - Styled for light/dark themes

4. **Vetting Now Works**
   - `<think>` tags stripped automatically for Qwen/DeepSeek models
   - AgentMaster applies vetting via vetting-registry.ts

### Commits

```
b6c4709 refactor(aui): remove hardcoded models, use AI Control router with cloud indicator
83827db feat(book-studio): complete API backend for harvest, draft, and voice services
7e04ac5 feat(aui): wire 25 Book Studio API tools for end-to-end book creation
```

---

## Implementation Progress

### Phase 1: Complete ✅

**Implemented January 21, 2026 (Session 2)**

Changes made to `apps/web/src/lib/aui/AUIContext.tsx`:

1. **Imported BookStudio context** (line 32):
   ```typescript
   import { useBookStudioOptional } from '../book-studio';
   ```

2. **Added BookStudio to AUIProvider** (line 392):
   ```typescript
   const bookStudio = useBookStudioOptional();
   ```

3. **Enhanced buildWorkspaceContext** (lines 167-310):
   - Now accepts `bookStudio: BookStudioContextValue | null` parameter
   - Includes full book inventory with card/chapter counts
   - Shows active book details (chapters, cards, voices)
   - Shows agent states (harvest, outline, draft in progress)
   - Formats context as markdown with headers

4. **Updated system prompt** (lines 312-344):
   - Imported comprehensive `AUI_BOOK_SYSTEM_PROMPT` with all 72 tools
   - Added intro explaining workspace state awareness
   - Added vocabulary mapping guidance
   - Combined into `AUI_SYSTEM_PROMPT`

5. **Updated sendMessage callback** (line 672):
   - Passes `bookStudio` to `buildWorkspaceContext()`
   - Added to dependency array

### Testing

Test these queries to verify the implementation works:

1. "What books do I have?" → Should list all books from context
2. "What's in this book?" → Should describe active book
3. "Show me the cards" → Should use list_cards tool OR answer from context
4. "How many staging cards?" → Should answer directly from context
5. "Generate a draft" → Should use generate_chapter_draft with chapter context

### Remaining Phases

- **Phase 2**: Tool documentation - Already complete (using AUI_BOOK_SYSTEM_PROMPT)
- **Phase 3**: Vocabulary mapping - Basic version in system prompt intro
- **Phase 4**: GUI State Hook - Not needed; using BookStudioOptional directly
- **Phase 5**: Smart dispatch - Future enhancement

### Session 2 Bug Fix: Error Visibility

**Commit:** `960811c` fix(aui): show actual errors instead of "I couldn't process that"

**Problem:** User saw "I couldn't process that" for all queries. The actual error was hidden because:
- Backend sends errors as `role: 'system'` messages
- Frontend only checked for `role: 'assistant'` messages

**Fix in `apps/web/src/lib/aui/AUIContext.tsx`:**
- Added check for system messages starting with "Error:"
- Shows actual error message to user
- Added helpful message when Ollama is not running

**Fix in `electron/agent-master/prompts/chat.ts`:**
- Updated all three tiered prompts (tiny, standard, full)
- Added CONTEXT AWARENESS section explaining workspace state
- LLM now knows to answer questions from context directly
- Only use tools for ACTIONS (search, create, modify)

## Next Steps

1. Test the implementation - should now see actual errors
2. Verify workspace context is being passed correctly
3. If context is too long, consider summarizing
4. Add more vocabulary mappings as user patterns emerge
