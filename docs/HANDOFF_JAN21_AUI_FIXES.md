# Handoff: AUI Fixes - Thinking Tags & Context Mismatch

**Date**: January 21, 2026
**Status**: Two bugs fixed, ready for continued testing
**Branch**: main

---

## Session Summary

This session fixed two bugs in the AUI system:

1. **`<think>` tags leaking to frontend** - Thinking tags from models like Qwen were appearing in chat output
2. **Context mismatch** - AUI context showed "General Agent Theory" as active, but tools said "No active book project"

---

## Bug #1: Thinking Tags Leaking

### Root Cause
The vetting-registry.ts had a flaw in how `filterHeuristic()` handled thinking tags:
- The general `qwen` profile defined `thinkingTags: ['<think>', '</think>']`
- BUT it also had `outputStrategy: 'heuristic'`
- The `filterHeuristic()` function only processed preambles/closings, NOT thinking tags
- Result: `<think>` blocks passed through unfiltered

### Fix
**File**: `electron/agent-master/vetting-registry.ts`

Updated `filterHeuristic()` to also check and strip thinking tags if the profile defines them:

```typescript
function filterHeuristic(text: string, profile: VettingProfile): VettingResult {
  let content = text.trim();
  let hadThinkingTags = false;

  // Strip thinking tags if profile defines them
  if (profile.thinkingTags && profile.thinkingTags.length > 0) {
    // Build tag pairs and strip them
    for (const { open, close } of tagPairs) {
      const regex = new RegExp(...);
      const before = content;
      content = content.replace(regex, '');
      if (content !== before) hadThinkingTags = true;
    }
  }

  // Then apply standard heuristic filtering for preambles/closings
  const result = filterHeuristicPhrases(content, profile);
  // ...
}
```

---

## Bug #2: Context Mismatch

### Root Cause
The AUI had two separate book systems that weren't synchronized:

| System | Used For | Data Source |
|--------|----------|-------------|
| **BookStudio** (new) | Context display | `useBookStudioOptional()` |
| **Bookshelf** (legacy) | Tool execution | `useBookshelf()` |

The context builder used BookStudio and correctly showed "General Agent Theory" as active.
The tool context used the legacy bookshelf which had no active project.

### Fix
**File**: `apps/web/src/lib/aui/AUIContext.tsx`

Updated the `book` object to prefer BookStudio's active book when available:

```typescript
const book = useMemo(() => {
  // Map BookStudio's Book type to what AUI tools expect
  const bookStudioActiveBook = bookStudio?.activeBook;
  const mappedActiveBook = bookStudioActiveBook ? {
    id: bookStudioActiveBook.id,
    uri: `book://user/${bookStudioActiveBook.id}`,
    type: 'book',
    name: bookStudioActiveBook.title, // Map title -> name for compatibility
    // ... other fields with defaults
  } as BookProject : null;

  return {
    // Prefer BookStudio's activeBook over legacy bookshelf
    activeProject: mappedActiveBook || bookshelf.activeBook || null,
    activeBook: mappedActiveBook || bookshelf.activeBook || null,
    // ... rest of methods
  };
}, [bookshelf.activeBook, ..., bookStudio?.activeBook]);
```

---

## Files Modified

| File | Changes |
|------|---------|
| `electron/agent-master/vetting-registry.ts` | Added thinking tag stripping to filterHeuristic() |
| `apps/web/src/lib/aui/AUIContext.tsx` | Prefer BookStudio's activeBook for tool context |

---

## Current State

### Working
- ✅ Thinking tags should now be stripped for all models with outputStrategy: 'heuristic'
- ✅ AUI tool context should see the same active book as the context display
- ✅ Both electron and web builds pass

### Needs Testing
- [ ] Verify `<think>` tags no longer appear in AUI output
- [ ] Test "What books do I have?" - should show correct list
- [ ] Test "How do I create a book?" - should not say "No active book project" if one is active
- [ ] Test tool execution (USE_TOOL calls) with active book
- [ ] Test book creation via AUI

---

## Known Architecture Notes

### Two Book Systems
The codebase has two book management systems:

1. **BookStudio** (new, preferred)
   - Location: `apps/web/src/lib/book-studio/`
   - Uses: `Book` type with `title`, `chapters`, `stagingCards`
   - API: Backend API at `/api/books/`
   - WebSocket updates for real-time sync

2. **Bookshelf** (legacy)
   - Location: `apps/web/src/lib/bookshelf/`
   - Uses: `BookProject` type with `name`, `uri`, `passages`
   - Storage: Local state

The AUI tools were built against the legacy bookshelf. Today's fix bridges them by mapping BookStudio data to the BookProject type that tools expect.

### Vetting Strategies
Models can use different output filtering strategies:

| Strategy | Used By | What It Strips |
|----------|---------|----------------|
| `xml-tags` | qwq, deepseek-r1 | Thinking tags |
| `heuristic` | qwen, llama, gemma | Preambles, closings, AND NOW thinking tags if defined |
| `json-block` | llava | JSON from markdown blocks |
| `structured` | o1 models | Structured output wrappers |
| `none` | claude, gpt-4 | Nothing (clean output) |

---

## Test Commands

After starting app with `npm run electron:dev`:

```
# Context awareness (should work without tools)
"What books do I have?"
"How many cards are in staging?"
"What chapters does this book have?"

# Book creation (should use active book context)
"How should I begin creating a book?"
"Create a chapter called Introduction"

# Verify no thinking tags
Ask any question with a Qwen model - output should be clean
```

---

**End of Handoff**
