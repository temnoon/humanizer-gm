# Handoff: Advanced Query Language & Filter Stacking System

**Date**: January 18, 2026
**Status**: Complete - Ready for Testing
**Feature**: TECO-inspired query language with progressive refinement

---

## Summary

Implemented a comprehensive Advanced Query Language system for the archive view, featuring:

1. **TECO-inspired query syntax** with operators for include (+), exclude (-), spanning (~), neither (?)
2. **Boolean groups** with nested AND/OR/NOT logic
3. **Regex pattern matching** using /pattern/ syntax
4. **Saved stacks** with @name references and keyboard shortcuts (Ctrl+1-9)
5. **Progressive refinement** with undo/redo history
6. **Visual filter builder** with two-way sync between text and visual modes

---

## Files Created

### Query Language Core (`apps/web/src/lib/query/`)
| File | Purpose |
|------|---------|
| `types.ts` | FilterTree types, token types, compiled query types |
| `QueryParser.ts` | Lexer + recursive descent parser |
| `QueryCompiler.ts` | AST to API query parameters |
| `SavedStacks.ts` | LocalStorage persistence, keyboard shortcuts |
| `index.ts` | Public API exports |

### UI Components (`apps/web/src/components/catuskoti/`)
| File | Purpose |
|------|---------|
| `QueryBar.tsx` | Syntax-highlighted query input with autocomplete |
| `query-bar.css` | QueryBar styles |
| `FilterTreeView.tsx` | Visual tree display of parsed filters |
| `filter-tree-view.css` | FilterTreeView styles |
| `FilterBuilder.tsx` | Combined query bar + visual tree |
| `filter-builder.css` | FilterBuilder styles |
| `RefinementBreadcrumbs.tsx` | Drill-down history navigation |
| `refinement-breadcrumbs.css` | Breadcrumb styles |
| `useRefinementHistory.ts` | Refinement state management hook |
| `SavedStacksPicker.tsx` | Saved stacks management UI |
| `saved-stacks-picker.css` | SavedStacksPicker styles |

### Backend (`electron/archive-server/`)
| File | Changes |
|------|---------|
| `services/content-graph/ContentGraphDatabase.ts` | Extended queryNodes() with regex, word count, phrase, wildcard support |

### Core Types (`packages/core/`)
| File | Changes |
|------|---------|
| `src/types/content-graph.ts` | Extended ContentNodeQuery with new filter fields |

---

## Query Language Syntax

```
# Include/Exclude with category
+source:chatgpt         # Include ChatGPT sources
-source:facebook        # Exclude Facebook
~source:mixed           # Spanning (both states)
?source:undefined       # Neither (uncategorized)

# Boolean operators
& (AND)                 # Implicit between terms
| (OR)                  # Explicit OR
! (NOT)                 # Negate group
() (Grouping)           # Nested expressions

# Pattern matching
/conscious(ness)?/      # Regex pattern
"artificial intelligence" # Exact phrase
conscio*                # Wildcard

# Comparisons
words:>100              # Minimum word count
words:<500              # Maximum word count
date:2024-01..2024-06   # Date range
quality:>0.7            # SIC score threshold

# Saved stacks
@philosophy             # Apply saved stack
```

---

## Integration in UnifiedArchiveView

The archive view now has a Simple/Advanced toggle:
- **Simple mode**: Original search input
- **Advanced mode**: FilterBuilder with query bar and visual tree

Key handlers added:
- `handleAdvancedFilterChange()` - Updates view with compiled query
- `handleAdvancedQuerySubmit()` - Pushes refinement and new view
- `handleApplySavedStack()` - Applies a saved stack by name

---

## Backend Query Support

`ContentGraphDatabase.queryNodes()` now supports:
- `excludeSourceTypes` - Array of source types to exclude
- `excludeTags` - Array of tags to exclude
- `minWords` / `maxWords` - Word count range
- `phrases` - Exact phrase matches (LIKE)
- `wildcards` - Wildcard patterns (* → %)
- `regexPatterns` - Regex filters (JavaScript-side for now)

Regex is applied in JavaScript after SQL query due to SQLite not having native REGEXP support without extensions.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus query bar (when implemented in Studio) |
| `Ctrl+Enter` | Apply query |
| `Ctrl+Z` | Undo last refinement |
| `Ctrl+Shift+Z` | Redo refinement |
| `Ctrl+S` | Save current as stack |
| `Ctrl+1..9` | Apply saved stack 1-9 |
| `Escape` | Clear query bar |

---

## Testing Checklist

- [ ] Parse basic queries: `+source:chatgpt`
- [ ] Parse boolean groups: `(+chatgpt | +claude) & -coding`
- [ ] Parse regex: `/conscious(ness)?/`
- [ ] Parse ranges: `words:100..500`, `date:>2024-01`
- [ ] Visual tree renders correctly for all filter types
- [ ] Refinement breadcrumbs show history
- [ ] Undo/redo works
- [ ] Save stack to localStorage
- [ ] Load stack with @name
- [ ] Keyboard shortcuts work (Ctrl+1-9)
- [ ] Backend returns correct results for all filter types

---

## Known Limitations

1. **Regex performance**: Applied in JavaScript, not SQL. For large result sets, use other filters first to narrow down.

2. **"both" and "neither" states**: Backend doesn't have special handling for these catuskoti states yet. They're passed but treated as include for now.

3. **Saved stacks sync**: Server sync endpoint not implemented. Stacks are localStorage-only.

---

## Next Steps

1. Add SQLite REGEXP extension for native regex support
2. Implement "both" and "neither" state logic in backend
3. Add server sync for saved stacks
4. Add syntax help tooltip/modal
5. Add drag-and-drop for filter tree reordering
