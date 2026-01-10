# Handoff: HSL Accent Colors & Button Text Contrast

**Date**: January 9, 2026
**Status**: COMPLETE - All active state text colors removed
**Branch**: main

---

## Problem Summary

Active/selected buttons in the Books pane have text contrast issues across themes. The root cause was using different text colors for active states vs normal states.

## User's Solution (Not Yet Implemented)

**The font color should be THE SAME in all button states (inactive, active, hover).**

- Dark mode already works this way - light text in ALL states
- Light/Sepia should work the same - dark text in ALL states
- The accent background color changes, but the TEXT COLOR stays constant

This eliminates:
- Complex `--studio-accent-text` variable
- Theme-specific text color overrides
- All contrast issues

## What Was Done This Session

### 1. HSL-Based Accent Colors (theme.css)
Changed accent colors to use HSL with adjustable lightness:

**Light/Sepia modes** (lines 14-17, 32-35, 70-73, 89-92):
```css
--studio-accent: hsl(38, 70%, 70%);      /* Light amber */
--studio-accent-hover: hsl(38, 70%, 62%); /* Slightly darker */
--studio-accent-text: hsl(38, 50%, 20%);  /* Dark text (NOT WORKING) */
```

**Dark mode** (lines 50-53, 108-111):
```css
--studio-accent: hsl(220, 70%, 35%);      /* Dark blue */
--studio-accent-hover: hsl(220, 70%, 42%); /* Slightly lighter */
--studio-accent-text: #ffffff;             /* Light text */
```

### 2. tokens.css Updates
Added `--lit-accent` and `--color-accent-text` variables (lines 23-30, 267-272, 338-343).

### 3. books-tab.css - Partial Fix Attempted
Changed `.book-project__tab.active` to use `var(--studio-accent-text)` but the variable inheritance isn't working correctly.

**Current broken state** (lines 340-363):
```css
.book-project__tab.active {
  background: var(--studio-accent);
  color: hsl(220, 60%, 25%);  /* Hardcoded - wrong approach */
}
/* Plus theme-specific overrides that add complexity */
```

---

## The Fix (COMPLETED)

### What Was Done

Removed `color` declarations from ALL active/current button states. Text now inherits from base selectors which use theme-aware CSS variables (`--studio-text-secondary`, `--studio-text`).

**books-tab.css changes:**
- `.book-project__tab.active` - removed `color: hsl(220, 60%, 25%)`
- `.book-project__tab.active:hover` - removed color
- Deleted all `[data-theme]` text color overrides (lines 351-363)
- `.thread-badge.active` - removed `color: var(--studio-accent-text)`
- `.thread-badge.active:hover` - removed color
- `.chapter-item.active` - removed `color: var(--studio-accent-text)`
- `.chapter-item.active:hover` - removed color
- `.edit-toggle.active`, `.version-toggle.active` - removed color
- `.level-btn.active` - removed color
- `.path-crumb.current` - removed color

**aui.css changes:**
- `.aui-chat-tab__settings-btn.active` - removed `color: var(--studio-accent-text)`
- `.aui-chat-tab__settings-btn.active:hover` - removed color

### Why This Works

**The Pattern: Active = Emphasized Text**

Base selectors use `--studio-text-secondary` (muted grey).
Active selectors use `--studio-text` (primary, emphasized).

This creates proper visual hierarchy:
- **Light/Sepia**: inactive = dark grey, active = very dark (#433422 sepia, #1a1a2e light)
- **Dark**: inactive = light grey (#a0a0b0), active = near white (#e8e8ed)

**Key Insight**: Dark mode's "white on dark accent" works because it's the INVERSE of the inactive state. Light mode must do the same - "black on light accent" (darker than inactive grey).

The `--studio-text` variable automatically provides this inversion across themes.

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `packages/ui/styles/tokens.css` | Added `--lit-accent`, `--color-accent-text` |
| `apps/web/src/styles/features/theme.css` | HSL accent colors, accent-text variables |
| `apps/web/src/styles/features/books-tab.css` | Partial (broken) active state fixes |
| `apps/web/src/styles/features/aui.css` | Active button changes |
| `apps/web/src/styles/features/auth.css` | User dropdown dark mode (WORKING) |
| `CLAUDE.md` | Updated CSS best practices |

---

## Testing Checklist

After implementing the correct fix:
- [ ] Books tab (Sources/Thinking/Drafts) - text readable in all states, all themes
- [ ] Chapter list items - same
- [ ] Thread badges - same
- [ ] Harvest queue (already fixed)
- [ ] User dropdown (already fixed)

---

## Restart Prompt

```
Continue from docs/HANDOFF_JAN09_HSL_ACCENT_COLORS.md

The solution is SIMPLE:
1. Remove ALL `color:` declarations from `.active` and `.active:hover` states
2. Let text color inherit from the base button state
3. Only the BACKGROUND changes on active/hover, not the text

This matches how dark mode already works correctly.
Apply this fix to all active button states in:
- books-tab.css
- aui.css

Then test in all 3 themes (light, sepia, dark).
```

---

## Key Insight

**Dark mode works because the text color is the SAME in all states (light text).**
**Light/Sepia should work the same way - dark text in ALL states.**

The accent background provides visual distinction. The text color should NOT change.

---

**End of Handoff**
