# CSS Modularization Refactoring Plan

## CRITICAL: Read This Before Starting

The file `apps/web/src/index.css` is **418KB (~12,000 lines)** - far too large for Claude Code to read directly. This document provides the complete refactoring plan so you can execute it with full context.

---

## Phase 1: Create Directory Structure

Execute these commands first:

```bash
mkdir -p apps/web/src/styles/{base,layout,components,features,utilities}
```

Target structure:
```
apps/web/src/styles/
├── index.css              # @imports only (max 50 lines)
├── base/
│   ├── variables.css      # CSS custom properties (colors, spacing, etc.)
│   ├── reset.css          # CSS reset/normalize
│   └── typography.css     # Font definitions, text styles
├── layout/
│   ├── grid.css           # Grid system
│   ├── containers.css     # Container patterns
│   ├── panels.css         # Panel layouts
│   └── responsive.css     # All @media queries consolidated
├── components/
│   ├── buttons.css        # .btn-*, button elements
│   ├── forms.css          # input, select, textarea, .form-*
│   ├── cards.css          # .card-*, card patterns
│   ├── modals.css         # .modal-*, dialog patterns
│   ├── navigation.css     # .nav-*, .tab-*, breadcrumbs
│   └── tables.css         # table, .table-*
├── features/
│   ├── archive.css        # .archive-*, archive browser
│   ├── book.css           # .book-*, book viewer/editor
│   ├── aui.css            # .aui-*, AUI chat interface
│   ├── tools.css          # .tool-*, tool panels
│   ├── workspace.css      # .workspace-*, .studio-*
│   └── library.css        # .library-*, library browser
└── utilities/
    ├── animations.css     # @keyframes, transitions
    ├── helpers.css        # Utility classes (.sr-only, .hidden, etc.)
    └── electron.css       # Electron-specific styles
```

---

## Phase 2: Extract CSS Variables First

Search for all CSS custom properties and consolidate:

```bash
# Find all :root and custom property definitions
grep -n ":root\|--[a-z]" apps/web/src/index.css | head -200
```

Create `apps/web/src/styles/base/variables.css`:

```css
/* variables.css - Design tokens and CSS custom properties */

:root {
  /* Colors - Light Mode */
  --text-primary: #1a1a1a;
  --text-secondary: #4a4a4a;
  --text-tertiary: #6a6a6a;
  --text-muted: #8a8a8a;
  
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-tertiary: #ebebeb;
  
  --border-color: #e0e0e0;
  --border-light: #f0f0f0;
  
  --accent-primary: #0066cc;
  --accent-secondary: #0052a3;
  
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  
  /* Spacing */
  --space-xs: 0.25rem;   /* 4px */
  --space-sm: 0.5rem;    /* 8px */
  --space-md: 1rem;      /* 16px */
  --space-lg: 1.5rem;    /* 24px */
  --space-xl: 2rem;      /* 32px */
  --space-2xl: 3rem;     /* 48px */
  
  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  
  /* Typography */
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: 'SF Mono', Menlo, Monaco, monospace;
  
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  
  /* Z-Index Scale */
  --z-dropdown: 100;
  --z-modal: 200;
  --z-tooltip: 300;
  --z-toast: 400;
}

/* Dark Mode */
[data-theme="dark"],
.dark {
  --text-primary: #f0f0f0;
  --text-secondary: #b0b0b0;
  --text-tertiary: #808080;
  --text-muted: #606060;
  
  --bg-primary: #1a1a1a;
  --bg-secondary: #252525;
  --bg-tertiary: #303030;
  
  --border-color: #404040;
  --border-light: #353535;
  
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
}
```

---

## Phase 3: Split by Selector Prefix

Use grep to identify logical groups:

```bash
# Book-related styles
grep -n "\.book" apps/web/src/index.css | wc -l

# Archive styles
grep -n "\.archive" apps/web/src/index.css | wc -l

# AUI styles
grep -n "\.aui" apps/web/src/index.css | wc -l

# Studio/workspace styles
grep -n "\.studio\|\.workspace" apps/web/src/index.css | wc -l

# Button styles
grep -n "\.btn\|button" apps/web/src/index.css | wc -l

# Form styles
grep -n "\.form\|input\|select\|textarea" apps/web/src/index.css | wc -l
```

For each group, extract to appropriate file:

```bash
# Example: Extract book styles (lines X to Y)
sed -n 'X,Yp' apps/web/src/index.css > apps/web/src/styles/features/book.css
```

---

## Phase 4: Extract Media Queries

Consolidate all responsive styles:

```bash
# Find all media queries
grep -n "@media" apps/web/src/index.css
```

Create `apps/web/src/styles/layout/responsive.css` with all media queries in order:
1. Mobile breakpoints first (min-width: 480px)
2. Tablet breakpoints (min-width: 768px)
3. Desktop breakpoints (min-width: 1024px)
4. Large desktop (min-width: 1280px)

---

## Phase 5: Create Master Index

Create `apps/web/src/styles/index.css`:

```css
/* 
 * Humanizer CSS Index
 * This file only contains @import statements.
 * Each imported file should be <200 lines.
 */

/* Base - Order matters! Variables first */
@import './base/variables.css';
@import './base/reset.css';
@import './base/typography.css';

/* Layout */
@import './layout/grid.css';
@import './layout/containers.css';
@import './layout/panels.css';

/* Components */
@import './components/buttons.css';
@import './components/forms.css';
@import './components/cards.css';
@import './components/modals.css';
@import './components/navigation.css';
@import './components/tables.css';

/* Features */
@import './features/archive.css';
@import './features/book.css';
@import './features/aui.css';
@import './features/tools.css';
@import './features/workspace.css';
@import './features/library.css';

/* Utilities - Last for override capability */
@import './utilities/animations.css';
@import './utilities/helpers.css';
@import './utilities/electron.css';

/* Responsive - Always last */
@import './layout/responsive.css';
```

---

## Phase 6: Update Import Path

In `apps/web/src/main.tsx` (or wherever CSS is imported):

```tsx
// BEFORE
import './index.css';

// AFTER
import './styles/index.css';
```

---

## Phase 7: Verify and Test

After splitting:

```bash
# Verify no file exceeds 200 lines
find apps/web/src/styles -name "*.css" -exec wc -l {} \; | awk '$1 > 200'

# Build and test
cd apps/web && npm run build

# Visual regression (manual)
npm run dev
# Check each major view: Archive, Book, AUI, Tools
```

---

## Incremental Execution

If doing this incrementally:

1. **Day 1**: Extract variables.css + reset.css + typography.css
2. **Day 2**: Extract layout files (grid, containers, panels)
3. **Day 3**: Extract component files (buttons, forms, cards, etc.)
4. **Day 4**: Extract feature files (archive, book, aui, etc.)
5. **Day 5**: Extract utilities + responsive + create index

After each day:
- Run build to verify no breaks
- Commit with clear message: `refactor(css): extract [files] from index.css`

---

## Grep Patterns for Extraction

Use these to find style boundaries:

```bash
# Find all class definitions (start of a style block)
grep -n "^\." apps/web/src/index.css | head -100

# Find section comments
grep -n "/\*.*\*/" apps/web/src/index.css | head -50

# Find empty lines (natural breaks)
grep -n "^$" apps/web/src/index.css | head -50

# Find keyframes
grep -n "@keyframes" apps/web/src/index.css

# Find all IDs (should be rare)
grep -n "^#" apps/web/src/index.css
```

---

## Success Criteria

- [ ] No CSS file over 200 lines
- [ ] All files readable by Claude Code directly
- [ ] No broken styles (visual verification)
- [ ] Build passes
- [ ] Variables consolidated in one place
- [ ] Media queries consolidated
- [ ] Clear BEM naming visible in organization

---

## If You Get Stuck

1. Start with the easiest extraction: keyframes → utilities/animations.css
2. Then variables → base/variables.css
3. Use line ranges from grep to extract sections
4. Test after every extraction
5. Ask for help if a section is unclear

The goal is **modular, readable CSS** - not perfection on first pass.
