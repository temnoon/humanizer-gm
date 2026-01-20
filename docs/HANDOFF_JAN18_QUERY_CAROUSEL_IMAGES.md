# Handoff: Advanced Query, Filter Carousel & Image Rendering

**Date**: January 18, 2026
**Status**: Query/Carousel complete, Image rendering partially fixed

---

## Summary

This session implemented:
1. **Advanced Query Language** - TECO-inspired query syntax with full parser
2. **FilterDimensionCarousel** - Compact scroll-to-cycle filter controls
3. **Image Rendering Fix** - Started but needs backend endpoint

---

## Completed: Advanced Query Language

### Files Created (`apps/web/src/lib/query/`)
| File | Purpose |
|------|---------|
| `types.ts` | FilterTree, token types, compiled query types |
| `QueryParser.ts` | Lexer + recursive descent parser |
| `QueryCompiler.ts` | AST → API query parameters |
| `SavedStacks.ts` | localStorage + Ctrl+1-9 shortcuts |
| `index.ts` | Public exports |

### Query Syntax
```
+source:chatgpt          # Include
-source:facebook         # Exclude
~source:mixed            # Both (spanning)
?source:undefined        # Neither

(+chatgpt | +claude) & -coding   # Boolean groups
/conscious(ness)?/       # Regex
words:100..500           # Range
"exact phrase"           # Phrase
conscio*                 # Wildcard
@philosophy              # Saved stack
```

### Bug Fix: Infinite Loop in FilterBuilder
- `onFilterChange` was triggering on every render
- Fixed with `useRef` to track initial mount and last notified query
- File: `FilterBuilder.tsx` lines 76-100

---

## Completed: FilterDimensionCarousel

### Files Created (`apps/web/src/components/catuskoti/`)
- `FilterDimensionCarousel.tsx`
- `filter-dimension-carousel.css`

### 10 Filter Dimensions
| Dimension | Icon | Controls |
|-----------|------|----------|
| Date | 📅 | Relative/Range mode |
| Words | 📏 | Min/Max inputs |
| Messages | 💬 | Min/Max (conversation count) |
| Type | 📄 | +/- toggle + dropdown |
| Tags | 🏷️ | +/- toggle + text input |
| Quality | ✨ | Above/Below + slider |
| Source | 📥 | +/- toggle + dropdown |
| Author | 👤 | user/assistant/system |
| Has | 📎 | Images, code, links buttons |
| Text | 🔍 | Phrase/regex/wildcard modes |

### Bug Fix: Passive Event Listener
- `preventDefault()` failed on wheel events
- Fixed with `useEffect` + native `addEventListener({ passive: false })`

---

## In Progress: Image Rendering

### Problem
- **Chat pane**: Shows images correctly (converts `file-service://` → `/api/conversations/.../media/...`)
- **All pane**: Shows raw text only, no images rendered

### Partial Fix Applied
```tsx
// UnifiedArchiveView.tsx - changed line 1209-1212
<div className="unified-archive__detail-content">
  <MathMarkdown className="unified-archive__markdown">
    {selectedNode.content.text}
  </MathMarkdown>
</div>
```

### Still Needed
1. **Create backend endpoint** to serve media by pointer:
   ```
   GET /api/media/by-pointer?pointer=file-service://file-ABC123
   ```

2. **Query media_items table**:
   ```sql
   SELECT file_path FROM media_items WHERE original_pointer = ?
   -- Or via media_references table
   ```

3. **Transform URLs** in content before rendering:
   - Replace `file-service://file-XXX` with `/api/media/by-pointer?pointer=...`
   - Or create custom ReactMarkdown image component

4. **Serve files**:
   - Electron: `local-media://serve/path/to/file`
   - Browser: `${archiveServerUrl}/api/media/...`

### Database Tables
- `media_items`: content_hash, file_path, original_pointer
- `media_references`: content_item_id, media_hash, original_pointer

---

## Testing Checklist

- [x] Parse basic queries: `+source:chatgpt`
- [x] Parse boolean groups: `(+chatgpt | +claude) & -coding`
- [x] Parse regex: `/conscious(ness)?/`
- [x] Dimension carousel cycles correctly
- [x] Wheel scroll on label changes dimension
- [x] No passive event listener errors
- [ ] Images render in All pane detail view
- [ ] `file-service://` URLs resolve to media

---

## Files Modified

| File | Changes |
|------|---------|
| `UnifiedArchiveView.tsx` | Added MathMarkdown import and usage |
| `FilterBuilder.tsx` | Infinite loop fix, carousel integration |
| `catuskoti/index.ts` | Added carousel exports |

---

## Next Steps

1. Add `/api/media/by-pointer` endpoint in `content-graph.ts` or new `media.ts`
2. Transform content URLs before rendering OR create custom image component
3. Test with actual `file-service://` content
4. Consider adding media preview to card view (optional)
