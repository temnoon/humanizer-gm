# Handoff: Book Studio Critical Bug Fixes

**Date**: January 20, 2026 (Late Session)
**Status**: Multiple bugs fixed, some still broken
**Next**: Need E2E testing with verified database writes

---

## Session Summary

Deep-dived into why Book Studio wasn't working:
1. Chapters showed "0 cards" after creation
2. Harvest returned duplicates
3. UI state was stale after operations

---

## Critical Bugs Found & Fixed

### 1. `updateCard` Missing `chapterId` (ROOT CAUSE)

**File**: `apps/web/src/lib/book-studio/api-client.ts`

```typescript
// BEFORE - chapterId was NOT included!
body: JSON.stringify({
  userNotes: updates.userNotes,
  // ... no chapterId!
})

// AFTER - Now included
body: JSON.stringify({
  chapterId: updates.suggestedChapterId,  // ← KEY FIX
  userNotes: updates.userNotes,
  // ...
})
```

**Impact**: When OutlineView called `updateCard(cardId, { suggestedChapterId, status: 'placed' })`, the chapterId was silently dropped. Cards were never assigned to chapters in the database.

### 2. Cross-Harvest Deduplication Missing

**File**: `apps/web/src/lib/book-studio/BookStudioProvider.tsx`

```typescript
const commitHarvestResults = useCallback(async () => {
  const cards = harvestState.results.map(convertToHarvestCard)

  // NEW: Filter duplicates against existing book cards
  const existingCards = api.activeBook?.stagingCards || []
  const uniqueCards = cards.filter(card => {
    const duplicate = findDuplicateCard(card.content, existingCards, 0.85)
    return !duplicate
  })

  if (uniqueCards.length > 0) {
    await api.actions.harvestCardsBatch(uniqueCards)
  }
})
```

### 3. Book State Not Refreshed After Chapter Creation

**File**: `apps/web/src/components/book-maker/views/OutlineView.tsx`

```typescript
// After creating chapters and assigning cards:
await bookStudio.actions.refreshBooks()  // ← NEW: Reload from DB
bookStudio.outline.clear()
```

### 4. API Book Counts Not Flowing to UI

**File**: `apps/web/src/lib/book-studio/api-client.ts`

```typescript
interface ApiBook {
  // ... existing fields
  cardCount?: number    // ← NEW
  chapterCount?: number // ← NEW
}

function apiBookToBook(api: ApiBook, ...): Book {
  return {
    // ...
    cardCount: api.cardCount,     // ← NEW
    chapterCount: api.chapterCount, // ← NEW
  }
}
```

### 5. Batch Chapters API Contract Mismatch

**File**: `apps/web/src/lib/book-studio/api-client.ts`

```typescript
// BEFORE: Wrong parameter name
body: JSON.stringify({ bookId, titles })

// AFTER: Correct format
const chapters = titles.map(title => ({ title }))
body: JSON.stringify({ bookId, chapters })
```

---

## Still Broken (Need Next Session)

### A. Archive Search Has Control Characters
Search results contain `\u0000-\u001f` characters that break JSON parsing.
Need to sanitize at `electron/archive-server` level.

### B. Chapters Still Show "0 cards"
Even after fixes, the UI doesn't show cards in chapters.
Need to verify:
1. Database is being written to
2. `getBook()` is loading chapter-card associations
3. Chapter object's `cards` array is being populated

### C. Database Location Unknown
Need to find `books.db` location to verify data integrity.
Check: `electron/book-studio-server/config.ts` → `getDbPath()`

### D. Draft Generation Not Wired Up
- Draft service exists but UI doesn't connect to it
- Writing tab shows chapters but can't generate content

---

## Data Flow (Expected)

```
1. Search archive → results with content
2. Harvest → cards created in `cards` table with book_id
3. Research → themes extracted, stored in research_cache
4. Generate outline → sections with itemCardAssignments
5. Create chapters → chapters created, cards updated with chapter_id
6. refreshBooks() → UI reloads book with chapter-card associations
7. Chapters view → shows chapters with card counts
8. Writing tab → generates drafts using cards in each chapter
```

---

## Files Modified

| File | Change |
|------|--------|
| `api-client.ts` | Added chapterId to updateCard, fixed apiBookToBook counts, fixed batch chapters |
| `BookStudioProvider.tsx` | Added cross-harvest deduplication |
| `OutlineView.tsx` | Added refreshBooks after chapter creation |

---

## Test Commands

```bash
# E2E test
./scripts/e2e-book-creation.sh --verbose --cleanup

# Test specific book
BOOK_ID="<book-id>"
curl http://127.0.0.1:3004/api/cards?bookId=$BOOK_ID | jq '.cards | length'
curl http://127.0.0.1:3004/api/chapters?bookId=$BOOK_ID | jq '.chapters'

# Test outline generation
curl -X POST http://127.0.0.1:3004/api/outline-compute/generate \
  -H "Content-Type: application/json" \
  -d '{"bookId": "'$BOOK_ID'"}'
```

---

## Next Session Priorities

1. **Find and verify database**
   - Locate `books.db`
   - Verify cards are written with correct `chapter_id`

2. **Fix chapter-card loading**
   - Trace `getBook()` → `apiBookToBook()` → chapter.cards
   - Ensure cardsByChapter map is built correctly

3. **Run clean E2E test**
   - Create new book
   - Harvest clean content
   - Generate outline
   - Create chapters
   - Verify cards appear in chapters

4. **Wire up draft generation**
   - Connect Writing tab to draft service
   - Test generating a chapter draft

---

## ChromaDB Memory

Stored comprehensive bug analysis:
- ID: `b3aa74ae...`
- Tags: book-studio, bugs, critical, jan2026, handoff

---

**End of Handoff**
