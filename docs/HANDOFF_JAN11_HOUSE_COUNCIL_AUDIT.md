# Handoff: House Council Codebase Audit

**Date**: January 11, 2026
**Status**: Audit complete, remediation needed
**Context Used**: ~95%

---

## Consolidated House Council Report Location

The full audit was conducted in-session by 7 House Agents running in parallel. The detailed output files are at:

```
/var/folders/t7/2jtx8jy15yz79zbc9rb_89480000gn/T/claude/-Users-tem-humanizer-root-humanizer-gm/tasks/
├── ac3d971.output  # Architect
├── a63f48a.output  # Stylist
├── ad9bce9.output  # Security
├── a4be26b.output  # Data
├── a880ad6.output  # Accessibility
├── af55a45.output  # Modularizer
└── a2dd17e.output  # Math
```

**Note**: These are temp files that may not persist. The summary below captures all critical findings.

---

## Next Steps (User's Choice)

1. **Dive deeper** into any specific house's findings
2. **Start fixing** the critical blockers (Security XSS, file modularization)
3. **Create a technical debt document** tracking all issues for future reference
4. **Prioritize differently** based on what you're working towards

---

## Most Urgent Issues by Impact

### 1. Security XSS (CRITICAL)
Could expose user data if exploited.

**Files to fix**:
- `apps/web/src/components/workspace/HighlightableText.tsx` (lines 199-222)
- `apps/web/src/components/archive/book-project/BookProjectDetail.tsx` (lines 806-829)
- `apps/web/src/lib/auth/api.ts` (lines 27-37) - token storage

**Fix**: Add DOMPurify sanitization, move tokens to memory-only storage.

### 2. File Sizes (CRITICAL)
tools.ts at 4,626 lines exceeds Claude Code's read limits, making it unmaintainable.

**Files to split**:
| File | Lines | Target |
|------|-------|--------|
| `lib/aui/tools.ts` | 4,626 | 12 tool category files (~400 each) |
| `electron/main.ts` | 1,755 | IPC handlers, server manager |
| `electron/preload.ts` | 1,056 | Domain-specific bridges |
| `MainWorkspace.tsx` | 1,077 | Mode components, hooks |

### 3. Type Fragmentation (HIGH)
Causes subtle bugs when types diverge between modules.

**Issue**: `lib/aui/tools.ts` line 13 imports types from `components/archive/book-project/types.ts` instead of `@humanizer/core`.

**Fix**: Move all BookProject, DraftChapter, SourcePassage types to @humanizer/core, update imports.

---

## Complete Audit Summary by House

### Security (BLOCKING - 3 Critical)

| Issue | Severity | File | Lines |
|-------|----------|------|-------|
| XSS: dangerouslySetInnerHTML | CRITICAL | HighlightableText.tsx | 199-222 |
| XSS: Unsafe Markdown | CRITICAL | BookProjectDetail.tsx | 806-829 |
| Token in localStorage | CRITICAL | auth/api.ts | 27-37 |
| Missing API auth | HIGH | archive-server/routes/* | - |
| Path traversal risk | HIGH | routes/conversations.ts | 387-434 |
| XSS in toast | MEDIUM | lib/aui/animator.ts | 364-388 |
| Permissive CORS | MEDIUM | archive-server/server.ts | 56 |

### Modularizer (BLOCKING - 4 Critical Files)

| File | Lines | Issue |
|------|-------|-------|
| `lib/aui/tools.ts` | 4,626 | 15x over 300-line limit |
| `electron/main.ts` | 1,755 | God object |
| `electron/preload.ts` | 1,056 | Massive contextBridge |
| `MainWorkspace.tsx` | 1,077 | 5 view modes in one file |
| `ToolsPanel.tsx` | 1,020 | Multiple tabs + state |

### Architect (CONDITIONAL - 4 Critical)

| Issue | Location |
|-------|----------|
| Boundary violation: lib imports components | tools.ts:13-18 |
| 5 duplicate analyze functions | electron/services/*.ts |
| Unregistered agents (5 TODOs) | agents/index.ts:100-105 |
| Type definitions split across modules | core/types, components/types |

### Data (CONDITIONAL - 7 Critical)

| Issue | File | Lines |
|-------|------|-------|
| Duplicate type defs | tools.ts | 13 |
| Unvalidated JSON.parse | LocalStorageMigration.ts | 188-334 |
| Missing API validation | archive/service.ts | 62,102,258 |
| Response type casting | transform/service.ts | 175-180 |
| Unsafe DB casts | EmbeddingDatabase.ts | 2613,2644 |
| No schema versioning | types/book.ts | - |
| Excessive `as any` | Multiple electron files | Multiple |

### Stylist (WARNING - 6 Issues)

| Issue | Count |
|-------|-------|
| Hardcoded hex colors | 70+ |
| `color: white` hardcoded | 28 |
| Competing theme systems | 2 (--color-* vs --studio-*) |
| Desktop-first media queries | 16 |
| Missing focus-visible | 1 button |
| rgba without variables | 28 |

### Accessibility (PASS - 4 Moderate)

| Issue | File | Lines |
|-------|------|-------|
| Touch target <44px | theme.css | 237-249 |
| Touch target <44px | aui.css | 91-105 |
| Touch target <44px | panels.css | 11-30, 242-256 |
| Missing aria-label | ImageCard.tsx | 95-109 |
| No prefers-reduced-motion | panels.css, aui.css | 82-94, 187-196 |

**Strengths**: Excellent ARIA implementation, keyboard navigation, semantic HTML.

### Math (WARNING - 3 Critical)

| Issue | File | Lines |
|-------|------|-------|
| Division by zero (no epsilon) | EmbeddingGenerator.ts | 215 |
| Probability normalization | quantum/index.ts | 90, 100 |
| Trace enforcement missing | quantum/index.ts | 60-70 |
| Variance naming confusion | trajectory.ts | 162-166 |

---

## Recommended Remediation Order

### Week 1 (Blocking)
1. Fix XSS in HighlightableText.tsx and BookProjectDetail.tsx
2. Move token storage from localStorage to memory
3. Split tools.ts into 12 category files
4. Add API response validators to archive/service.ts

### Week 2 (Integrity)
5. Consolidate type definitions to @humanizer/core
6. Extract Xanadu storage adapter
7. Add epsilon guards to math operations
8. Fix touch target sizes to 44px

### Week 3 (Polish)
9. Unify theme system (choose --color-* or --studio-*)
10. Add prefers-reduced-motion CSS rules
11. Complete agent registration or remove TODOs
12. Replace `as any` casts with proper types

---

## ChromaDB Memory

**Tags**: `session-summary, jan-11-2026, house-council, audit, security, modularization`

To retrieve:
```
mcp__chromadb-memory__search_by_tag(["session-summary", "jan-11-2026"])
```

---

## Quick Verification Commands

```bash
# Count XSS risks
grep -r "dangerouslySetInnerHTML" apps/web/src --include="*.tsx" | wc -l

# Count file sizes
wc -l apps/web/src/lib/aui/tools.ts electron/main.ts electron/preload.ts

# Count hardcoded colors
grep -r "#[0-9a-fA-F]\{3,8\}" apps/web/src/styles --include="*.css" | wc -l

# Count unsafe casts
grep -r "as any" electron --include="*.ts" | wc -l
```

---

## Previous Session Work

Before the audit, we completed:
- Transcript persistence to database (getMediaById fix)
- Transcript UI: selectable text, copy/download buttons
- Gallery info panel: upload date, linked content

**Commit**: `84d596e` - feat(transcription): persist transcripts and improve UI

---

**End of Handoff**
