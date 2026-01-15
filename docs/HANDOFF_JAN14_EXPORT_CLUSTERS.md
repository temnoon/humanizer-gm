# Handoff: Export & Clusters View - Jan 14, 2026

## Session Summary

**Continued Book Studio development** with two major features:
1. Markdown export functionality (chapters and books)
2. Clusters view with multiple grouping options

---

## Repository

### humanizer-sandbox
Location: `/Users/tem/humanizer_root/humanizer-sandbox/`

All work in sandbox. Handoff doc committed to humanizer-gm.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `b9196e6` | feat: add Markdown export for chapters and books |
| `85cc20e` | feat: implement Clusters view with grouping options |

---

## Features Built

### 1. Markdown Export

#### export.ts (New File)
Core export functions:
```typescript
exportChapterToMarkdown(chapter)    // Single chapter with word count
exportBookToMarkdown(book, options) // Full book with frontmatter, TOC
downloadMarkdown(content, filename) // Browser download trigger
sanitizeFilename(title)             // Safe filename generation
```

#### Export Options
- **Include Frontmatter**: YAML metadata (title, dates, target words)
- **Include Staging Cards**: Append unused cards at end
- **Include Chapter Cards**: Source material as blockquotes

#### UI
- Export dropdown in BookHeader (right side)
- Options: Export Chapter, Export Book, Export Book + Staging
- Each option shows a hint describing what's included

### 2. Clusters View

#### ClustersView.tsx (New File)
Four grouping modes:

| Mode | Description |
|------|-------------|
| Source Type | 💬 Messages, 📝 Posts, 💭 Comments, 🖼️ Images |
| Time Period | Group by year extracted from createdAt |
| Tags | Group by user-defined tags (+ Untagged) |
| Manual | Drag-and-drop clustering |

#### Features
- Drag-and-drop for manual clustering
- Color-coded cluster headers
- Show up to 8 cards per cluster with "+N more"
- Quick actions: Add Tag, Move to Chapter
- Stats display: X clusters • Y cards

---

## Key Files Modified

### New Files
- `src/book-studio/export.ts` - Export logic
- `src/book-studio/ClustersView.tsx` - Clusters view component
- `src/book-studio/ClustersView.css` - Clusters styling

### Modified Files
- `src/book-studio/BookHeader.tsx` - Added export dropdown
- `src/book-studio/BookHeader.css` - Export menu styles
- `src/book-studio/BookStudio.tsx` - Pass currentChapter to header
- `src/book-studio/StagingArea.tsx` - Use ClustersView

---

## Export Output Format

### Chapter Export
```markdown
# Chapter Title

[Chapter content...]

---
*Word count: 1,234*
```

### Book Export
```markdown
---
title: "Book Title"
created: 2026-01-14T...
updated: 2026-01-14T...
---

# Book Title

## Table of Contents

1. [Chapter One](#chapter-one)
2. [Chapter Two](#chapter-two)

---

## Chapter One

[Content...]

### Source Material

> [Quoted card content]
>
> — *Author, Jan 14, 2026*

---

*Total chapters: 2*
*Total words: 5,678*
```

---

## Clusters View Modes

### Source Type Grouping
```
┌─ 💬 Messages (23) ─────────────┐
│ [card] [card] [card] ...       │
└────────────────────────────────┘
┌─ 📝 Posts (15) ────────────────┐
│ [card] [card] [card] ...       │
└────────────────────────────────┘
```

### Manual Clustering
- Drag cards between clusters
- Drop on "+" to create new cluster
- Clusters persist in component state (not yet persisted to storage)

---

## To Run

```bash
# Terminal 1: Archive server (humanizer-gm)
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Terminal 2: Sandbox
cd /Users/tem/humanizer_root/humanizer-sandbox
npm run dev

# Open http://localhost:5174
```

---

## What's NOT Built Yet

| Feature | Notes |
|---------|-------|
| Cluster persistence | Manual clusters don't save between sessions |
| Semantic clustering | Would need embedding API access |
| PDF/EPUB export | Only Markdown for now |
| Cloud sync | localStorage only |
| Undo/redo | No history tracking |

---

## Next Session Suggestions

1. **Test export with real content** - Verify formatting looks good
2. **Persist manual clusters** - Add cluster assignments to HarvestCard type
3. **Add semantic clustering** - Call unifiedSearch for each card to find similar
4. **Port to humanizer-gm** - Once patterns are validated
5. **Add PDF export** - Use a library like jsPDF or Puppeteer

---

## Technical Notes

### Export Architecture
The export module is pure functions - no side effects except `downloadMarkdown` which triggers browser download. This makes it easy to test and extend for other formats.

### Clusters State
Manual clusters are currently stored in component state (`useState`). For persistence, the cluster assignment should be added to the `HarvestCard` type:

```typescript
interface HarvestCard {
  // existing fields...
  clusterId?: string  // Add this for manual clustering
}
```

### Color Assignment
Cluster colors are assigned by index from a fixed palette. This ensures visual consistency but means colors may shift if clusters are reordered.

---

**Session End:** Jan 14, 2026
**Status:** Export and Clusters COMPLETE
**Next Action:** Test with real archive, add cluster persistence
