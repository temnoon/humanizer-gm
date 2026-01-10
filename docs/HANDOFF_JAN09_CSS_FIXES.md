# Handoff: CSS Dark Mode & Contrast Fixes

**Date**: January 9, 2026
**Status**: CSS fixes complete - additional round of fixes applied
**Branch**: main

---

## Session 2 Summary (Post-Testing)

User tested fixes and found:
1. **Active button hover in dark mode** - White text still on light amber hover background = low contrast
2. **User dropdown in dark mode** - White background with very light grey text = unreadable

### Fixes Applied

**`auth.css`** - Added dark mode overrides for user dropdown:
- Dark background for dropdown menu
- Light text for menu items
- Proper hover states

**`books-tab.css` & `aui.css`** - Changed hover pattern for active buttons:
- **Removed**: Background color change on hover (was `--studio-accent-hover`)
- **Added**: Subtle `filter: brightness(1.1)` for hover feedback
- **Removed**: All dark mode special-case overrides (no longer needed)

### New Standard Pattern (Added to CLAUDE.md)
```css
/* CORRECT - subtle brightness change, no text/bg color change */
.btn.active:hover {
  background: var(--studio-accent);  /* Keep same background */
  filter: brightness(1.1);            /* Subtle visual feedback */
}
```

This pattern:
- Works consistently across all themes (light, dark, sepia)
- Maintains text contrast without special dark mode overrides
- Matches other panes in the application

---

## Session 1 Summary

This session addressed two major CSS issues identified by House Council audit:

### Issue 1: Hover Contrast on Active Buttons
**Problem**: Active buttons (white text on accent background) lost text visibility on hover because hover state changed background but not text color.

**Fix**: Added `.active:hover` rules that maintain `var(--color-text-inverse)` and use `var(--studio-accent-hover)`.

### Issue 2: Dark Mode Unusable
**Problem**: Harvest queue cards, status badges, and many UI elements had hardcoded light-mode colors.

**Fix**: Added comprehensive `[data-theme='dark']` overrides to harvest.css and books-tab.css.

---

## Files Modified This Session

| File | Lines Added | Changes |
|------|-------------|---------|
| `FillChapterDialog.css` | Rewritten | Tokens.css variables, error states, removed hardcoded colors |
| `PromptDialog.css` | Rewritten | Tokens.css variables, focus states |
| `AddToBookDialog.css` | 3 | Warning color fallbacks removed |
| `tools.css` | 15 | Primary/cancel cards, chapter badges |
| `books-tab.css` | 95 | Active hover states, dark mode overrides |
| `harvest.css` | 190 | Comprehensive dark mode overrides |
| `queue.css` | 8 | Button colors |
| `aui.css` | 12 | FAB, messages, settings button |

---

## Key Patterns Applied

### 1. Active State Hover Pattern
```css
/* BEFORE - text disappears on hover */
.btn.active {
  background: var(--studio-accent);
  color: white;
}

/* AFTER - maintains contrast on hover */
.btn.active {
  background: var(--studio-accent);
  color: var(--color-text-inverse, white);
}

.btn.active:hover {
  background: var(--studio-accent-hover, var(--studio-accent));
  color: var(--color-text-inverse, white);
}
```

### 2. Dark Mode Override Pattern
```css
/* Light mode (default) */
.status-badge {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

/* Dark mode override */
[data-theme='dark'] .status-badge {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;  /* Lighter for dark bg */
}
```

### 3. Token Usage (for Portal Components)
```css
/* Dialogs use tokens.css variables (at :root level) */
.dialog {
  background: var(--color-surface-elevated);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
}

.dialog__error {
  background: var(--color-status-error-subtle);
  color: var(--color-status-error);
}
```

---

## Testing Checklist

### Session 2 Results
- [x] **Dark Mode - Harvest queue cards** - PASS (user confirmed)
- [ ] **Dark Mode - Active button hover** - Added dark text on hover, NEEDS RETEST
- [ ] **Dark Mode - User dropdown** - Added dark mode styling, NEEDS RETEST

### Theme Testing (All 3 Modes)
- [ ] **Sepia Mode**
  - [ ] Book project tabs (Sources, Thinking, Drafts) - hover active tab
  - [ ] Chapter list items - hover active chapter
  - [ ] Thread badges - hover active thread
  - [ ] FillChapterDialog - open and check error state
  - [ ] PromptDialog - open and check buttons

- [ ] **Light Mode**
  - [ ] Same tests as sepia
  - [ ] Status badges readable

- [ ] **Dark Mode**
  - [x] Harvest queue cards visible ✓
  - [ ] Status badges (COLLECTING, REVIEWING, etc.) readable
  - [ ] Active button hover - should have dark text on light amber
  - [ ] User dropdown - should have dark background with light text
  - [ ] Book card status badges readable
  - [ ] Chapter status badges readable
  - [ ] AUI chat messages visible
  - [ ] Tool cards visible

### Specific Components to Test
1. Books Tab → Select a book → Hover on active tab
2. Books Tab → Chapter list → Hover on active chapter
3. Tools Panel → Harvest tab → Check queue cards in dark mode
4. Tools Panel → Any tool card with primary style
5. Dialogs → FillChapterDialog, PromptDialog

---

## Remaining Work

### Not Fixed This Session
- 91 remaining `color: white` instances across 19 files
- Most are on colored backgrounds where contrast is maintained
- Lower priority - can be addressed in future cleanup

### Files with Most Remaining Hardcoded Colors
```
views.css: 19 instances
books-tab.css: 11 instances (mostly status badges, now have dark mode)
media.css: 7 instances
panels.css: 6 instances
aui.css: 6 instances
```

### Suggested Future Work
1. Convert remaining `color: white` to `var(--color-text-inverse)`
2. Audit all status badge colors across themes
3. Consider creating status color tokens for consistency

---

## House Council Status

**Audit completed this session:**
- Stylist: CSS hardcoded colors - ADDRESSED
- Architect: PASS
- Accessibility: PASS
- Security: PASS
- Data: Minor warning (constants duplication)
- Fallback Audit: PASS - all fallbacks justified

---

## Restart Prompt

```
Continue from docs/HANDOFF_JAN09_CSS_FIXES.md

Priority:
1. Visual testing of CSS fixes in all 3 themes
2. Focus on:
   - Active button hover states
   - Dark mode harvest queue
   - Dialog styling
3. If issues found, fix and re-test
4. If all passes, proceed to AUI testing

Key test areas:
- Books tab with active states
- Harvest queue in dark mode
- FillChapterDialog error states
```

---

## Quick Commands

```bash
# Start app for testing
npm run electron:dev

# If need to rebuild
npm run build

# Check remaining white instances
grep -r "color: white" apps/web/src/styles/ | wc -l
```

---

**End of Handoff**
