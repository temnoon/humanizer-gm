# Infrastructure Audit Results - January 9, 2026

## Executive Summary

**Status**: Phase 1 (Audit) & Phase 2 (Directory Structure) COMPLETE. Ready for Phase 3 (Extraction).

---

## File Metrics

| File | Size | Lines | Status |
|------|------|-------|--------|
| `apps/web/src/index.css` | 428 KB | 18,546 | ❌ Cannot read directly |
| `apps/web/src/Studio.tsx` | 189 KB | 4,811 | ❌ Cannot read directly |

**Target**: All files < 100KB (readable by Claude Code)

---

## CSS Analysis (index.css)

### Section Count: ~100 major sections

### Major Sections (by line number):

```
Line      Section
----      -------
20        APP LAYOUT
57        LANDING PAGE  
100       BUTTONS
144       SIC COMPONENTS
172       CARDS
200       ANALYZE SECTION
237       RESULT SECTION
376       BOOK READER
663       STUDIO - Sepia workspace
715       TOP BAR
895       MAIN WORKSPACE
1004      WELCOME SCREEN
1371      WORKSPACE EDIT MODE
1615      SPLIT VIEW
2060      HOVER PANELS
2174      ARCHIVE BROWSER
2287      MEDIA VIEWER
2647      MEDIA LIGHTBOX
2793      CONTENT VIEWER
2973      TOOLS PANEL
3711      PROFILE CARDS
4467      MOBILE RESPONSIVE
4517      STRUCTURE INSPECTOR
4782      WORKSPACE ENHANCEMENTS
5259      AUI CHAT
5529      AUI CHAT TAB
5922      AUI ANIMATIONS
6022      LOGIN PAGE
6249      LOGIN PROMPT MODAL
6310      AUTH UI IN TOPBAR
6348      USER DROPDOWN
6416      THEME SYSTEM
6593      THEME TOGGLE BUTTON
6633      THEME SETTINGS MODAL
6780      ARCHIVE ICON TAB BAR
6871      MEDIA GALLERY
7056      AUDIO PLAYER
7123      IMPORT TAB
7374      BOOKS TAB
7612      BOOK PROJECT DETAIL VIEW
8510      MARKDOWN TABLES
8639      MARKDOWN CODE BLOCKS
8682      MARKDOWN LISTS
8727      MARKDOWN BLOCKQUOTES
8751      MARKDOWN LINKS
8776      MARKDOWN HEADINGS
8838      MARKDOWN IMAGES
8853      MARKDOWN HORIZONTAL RULES
8991      PROFILE TAB
9535      PYRAMID VIEWER
9985      BOOK NAVIGATION
10399     BOOK CONTENT VIEW
10894     CONTAINER WORKSPACE
11248     GALLERY VIEW
11699     FACEBOOK TAB
12067     NETWORK GRAPH
12545     EXPLORE TAB
12916     SOCIAL GRAPH
13293     GUTENBERG VIEW
13499     FILES VIEW
13977     SYMMETRIC MENUBAR
13981     CORNER ASSISTANT
14161     AUI FLOATING CHAT PANEL
14709     BOTTOM SHEET HANDLE
14749     PANEL RESIZER
14813     MOBILE BOTTOM SHEET
14907     SPLIT SCREEN WORKSPACE
15053     SPLIT DIVIDER
15111     MOBILE SPLIT WORKSPACE
15276     HIGHLIGHT LAYERS
15568     SPLIT MODE TOOLBAR
15742     DIFF VIEW
15931     IMAGE CARD
16373     EXPANDED STATE CHANGES
16390     REDUCED MOTION SUPPORT
16414     DARK MODE ADJUSTMENTS
16434     SEPIA THEME SPECIFIC
16449     SCROLLBAR STYLING
16487     ELECTRON
16569     QUEUE TAB COMPONENTS
17419     HARVEST QUEUE PANEL
17975     DARK MODE FIXES
18110     HARVEST WORKSPACE VIEW
```

### Recommended Extraction Order (Safest First):

1. **THEME SYSTEM** (lines 6416-6631) → `styles/features/theme.css`
   - Self-contained, uses CSS variables
   - ~215 lines, good starting size
   
2. **MARKDOWN STYLES** (lines 8510-8854) → `styles/features/markdown.css`
   - All markdown: tables, code blocks, lists, blockquotes, etc.
   - ~344 lines combined
   
3. **BUTTONS** (lines 100-143) → `styles/components/buttons.css`
   - Simple, self-contained
   - ~43 lines
   
4. **AUI CHAT** (lines 5259-5528 + 5529-5921) → `styles/features/aui.css`
   - Feature-complete section
   - ~662 lines - may need subsplit

5. **ELECTRON** (lines 16487-16568) → `styles/utilities/electron.css`
   - Platform-specific, isolated
   - ~81 lines

---

## Studio.tsx Analysis

### Component Count: 17 major functions

### Components (by line number):

```
Line      Component
----      ---------
13        processLatex() - Utility function
86        HoverPanel - Panel wrapper component
179       ArchivePanel - Archive browser panel
787       loadToolVisibility() - localStorage helper
801       saveToolVisibility() - localStorage helper
819       ToolsPanel - Main tools panel
1893      getContentText() - Content helper
1906      ArcToolPanel - Arc tool
2087      ThreadsToolPanel - Threads tool
2195      ChaptersToolPanel - Chapters tool
2393      PersonaToolPanel - Persona tool
2628      Workspace - Main workspace component
3625      UserDropdown - User menu
3708      TopBar - Application header
3970      AUIChat - AI chat interface
4321      StudioContent - Main content orchestrator
4798      Studio() - Root component (exported)
```

### Hook Counts:

- **useState**: 88 instances
- **useEffect**: 22 instances
- **useCallback**: Many (embedded in useState patterns)
- **useMemo**: Several
- **Type/Interface**: 15 definitions

### Recommended Extraction Order:

1. **Types** → `studio/types.ts`
   - Extract all interface/type definitions
   - Zero runtime impact
   
2. **Utility Functions** → `studio/utils.ts`
   - `processLatex()` (lines 13-19)
   - `getContentText()` (lines 1893-1904)
   - `loadToolVisibility()` (lines 787-799)
   - `saveToolVisibility()` (lines 801-817)
   
3. **HoverPanel** → `studio/components/HoverPanel.tsx`
   - Lines 74-176
   - Self-contained, reusable
   
4. **UserDropdown** → `studio/components/UserDropdown.tsx`
   - Lines 3609-3707
   - Small, independent
   
5. **Tool Panels** → `studio/components/tools/`
   - ArcToolPanel (lines 1906-2085)
   - ThreadsToolPanel (lines 2087-2193)
   - ChaptersToolPanel (lines 2195-2391)
   - PersonaToolPanel (lines 2393-2626)

---

## Directory Structure Created

```
apps/web/src/
├── styles/                 ← NEW (empty, ready for CSS extraction)
│   ├── base/
│   ├── layout/
│   ├── components/
│   ├── features/
│   └── utilities/
├── studio/                 ← NEW (empty, ready for component extraction)
│   ├── hooks/
│   ├── components/
│   └── contexts/
├── index.css               ← TARGET: 18,546 lines → <50 lines (imports only)
└── Studio.tsx              ← TARGET: 4,811 lines → <150 lines (shell only)
```

---

## Existing Infrastructure

All infrastructure files verified present:

```
.claude/
├── agents/
│   └── modularizer-agent.md     ✓
├── commands/
│   ├── audit-files.md           ✓
│   └── audit-css.md             ✓
├── refactoring/
│   ├── CSS_MODULARIZATION_PLAN.md    ✓
│   └── STUDIO_MODULARIZATION_PLAN.md ✓
└── skills/
    ├── file-modularization/SKILL.md  ✓
    ├── css-compliance/SKILL.md       ✓
    ├── claude-agent-sdk/SKILL.md     ✓
    └── session-memory/SKILL.md       ✓
```

---

## Ready for Claude Code

### Initialization Prompt:

```
New infrastructure was added to the humanizer-gm project. Please read:

1. .claude/refactoring/AUDIT_RESULTS_JAN09.md (this file)
2. .claude/refactoring/CSS_MODULARIZATION_PLAN.md
3. .claude/refactoring/STUDIO_MODULARIZATION_PLAN.md
4. .claude/agents/modularizer-agent.md
5. .claude/skills/file-modularization/SKILL.md

Directory structures are ready at:
- apps/web/src/styles/{base,layout,components,features,utilities}
- apps/web/src/studio/{hooks,components,contexts}

Begin with the safest CSS extraction:
1. Extract lines 6416-6631 (THEME SYSTEM) to styles/features/theme.css
2. Run: cd apps/web && npm run build
3. Verify no breaks, then commit

Then continue with buttons.css, markdown.css, etc.
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| CSS cascade breaks | Extract in order; test each extraction |
| Import path changes | Update index.css imports after each file |
| Build failures | Run `npm run build` after each change |
| Visual regressions | Manual visual check after each major section |
| Selector conflicts | Use grep to verify no duplicate selectors |

---

## Success Metrics

- [ ] All CSS files < 200 lines
- [ ] All TSX files < 300 lines
- [ ] index.css is imports-only (~50 lines)
- [ ] Studio.tsx is shell-only (~150 lines)
- [ ] Build passes
- [ ] No visual regressions
- [ ] Modularizer agent validates compliance

---

**Audit completed**: January 9, 2026
**Next action**: Claude Code extraction phase
