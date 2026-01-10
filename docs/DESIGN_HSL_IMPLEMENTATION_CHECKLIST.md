# Implementation Checklist: HSL-Based Button Contrast

## File 1: `/packages/ui/styles/tokens.css`

### Location: Lines 20-26 (Accent color section)

**BEFORE**:
```css
/* Accent - Warm amber for highlights */
--hue-accent: 38;
--sat-accent: 90%;
--color-accent: hsl(var(--hue-accent), var(--sat-accent), 50%);
--color-accent-hover: hsl(var(--hue-accent), var(--sat-accent), 45%);
--color-accent-subtle: hsl(var(--hue-accent), 50%, 95%);
```

**AFTER**:
```css
/* Accent - Warm amber for highlights */
--hue-accent: 38;
--sat-accent: 90%;
--lit-accent: 50%;  /* NEW: Lightness component (theme-adjustable) */
--color-accent: hsl(var(--hue-accent), var(--sat-accent), var(--lit-accent));
--color-accent-hover: hsl(var(--hue-accent), var(--sat-accent), calc(var(--lit-accent) - 5%));
--color-accent-subtle: hsl(var(--hue-accent), 50%, 95%);
```

**Change**: 3 lines

---

### Location: Lines 258-265 (Dark mode brand colors)

**BEFORE**:
```css
/* Brand colors - lighter for dark backgrounds */
--color-primary: hsl(var(--hue-primary), var(--sat-primary), 60%);
--color-primary-hover: hsl(var(--hue-primary), var(--sat-primary), 65%);
--color-primary-subtle: hsl(var(--hue-primary), 30%, 18%);

--color-accent: hsl(var(--hue-accent), var(--sat-accent), 55%);
--color-accent-hover: hsl(var(--hue-accent), var(--sat-accent), 60%);
--color-accent-subtle: hsl(var(--hue-accent), 40%, 18%);
```

**AFTER**:
```css
/* Brand colors - lighter for dark backgrounds */
--color-primary: hsl(var(--hue-primary), var(--sat-primary), 60%);
--color-primary-hover: hsl(var(--hue-primary), var(--sat-primary), 65%);
--color-primary-subtle: hsl(var(--hue-primary), 30%, 18%);

--lit-accent: 55%;  /* NEW: Darker accent in dark mode for contrast */
```

**Change**: Remove the derived accent colors, use lightness component instead (already defined in line 1 change)

---

### Location: Lines 325-332 (Manual dark theme override)

**Same as above** - use `--lit-accent: 55%` pattern

---

### Location: Lines 368-400 (Sepia theme)

**BEFORE**:
```css
[data-theme="sepia"] {
  /* ... text and surface colors ... */
  
  --color-accent: hsl(35, 80%, 50%);
  --color-accent-hover: hsl(35, 80%, 45%);
  --color-accent-subtle: hsl(35, 40%, 92%);
```

**AFTER**:
```css
[data-theme="sepia"] {
  /* ... text and surface colors ... */
  
  --lit-accent: 50%;  /* Keep sepia accent at standard lightness */
```

**Change**: Remove derived colors, set lightness component

---

## File 2: `/apps/web/src/styles/features/theme.css`

### Location: After line 217 (theme-toggle__btn--active section)

**ADD NEW SECTION**:
```css
/* ═══════════════════════════════════════════════════════════════════
   ACCENT TEXT COLOR - Guarantees contrast on active states
   ═══════════════════════════════════════════════════════════════════ */

:root,
[data-theme="light"],
[data-theme="sepia"] {
  --accent-text-color: var(--color-text-inverse);
}

[data-theme="dark"] {
  --accent-text-color: var(--color-text-inverse);
}
```

**Lines to add**: 12 (with comments)

---

## File 3: `/apps/web/src/styles/features/views.css`

### Pattern: Find all `.--active` selectors with `color: white`

**Example Location 1: Line 499-502 (facebook-view__tab--active)**

**BEFORE**:
```css
.facebook-view__tab--active {
  background: var(--studio-accent);
  color: white;
  border-color: var(--studio-accent);
}
```

**AFTER**:
```css
.facebook-view__tab--active {
  background: var(--color-accent);
  color: var(--accent-text-color);
  border-color: var(--color-accent);
}
```

**Search for similar patterns**:
```
grep -n "color: white" apps/web/src/styles/features/views.css
```

Expected matches: 8-10 locations (tabs, buttons, toggles)

---

## File 4: `/apps/web/src/styles/features/aui.css`

### Pattern: Active button states

**Search and replace pattern**:
- Find: `background: var(--studio-accent);` with `color: white;` nearby
- Replace text color with `var(--accent-text-color)`
- Replace background with `var(--color-accent)` if using old variable

**Key lines**: Around 165, 240, 431, 467, 648

---

## File 5: `/apps/web/src/styles/features/book-nav.css`

### Navigation active states

**BEFORE**:
```css
.book-nav__item--active {
  background: var(--studio-accent);
  color: white;
}
```

**AFTER**:
```css
.book-nav__item--active {
  background: var(--color-accent);
  color: var(--accent-text-color);
}
```

**Key lines**: Around 99, 224, 379-393

---

## File 6: `/apps/web/src/styles/features/panels.css`

### Panel toggle active states

Search for `.panel__toggle--active` and similar patterns.

---

## Verification Commands

```bash
# 1. Find all remaining hardcoded white text on accent backgrounds
grep -rn "color: white" apps/web/src/styles/features/ | grep -i "active\|selected"

# 2. Find studio-accent references (should mostly migrate to color-accent)
grep -rn "\-\-studio-accent" apps/web/src/styles/ | wc -l
# Should reduce by ~50%

# 3. Find any remaining hardcoded hex colors in active states
grep -rn "background.*#[0-9a-f]" apps/web/src/styles/features/ | grep active

# 4. Count CSS variables used for colors in active states
grep -rn "\-\-color-accent\|--accent-text-color" apps/web/src/styles/ | wc -l
# Should increase significantly
```

---

## Testing Checklist

### Before Merge
- [ ] No hardcoded `color: white` in active states
- [ ] All active backgrounds use `var(--color-accent)`
- [ ] All active text colors use `var(--accent-text-color)`
- [ ] Sepia theme looks correct
- [ ] Light theme looks correct
- [ ] Dark theme looks correct

### Browser Testing
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)

### Accessibility Testing
- [ ] WCAG contrast checker: all combos >= 4.5:1
- [ ] Tab navigation works
- [ ] Keyboard focus visible on active buttons
- [ ] Screen reader announces active states

### Component Testing
- [ ] Tab navigation (views.css)
- [ ] Button groups (aui.css)
- [ ] Navigation menu (book-nav.css)
- [ ] Panel toggles (panels.css)

---

## Rollback Plan

If issues arise, revert in this order:
1. theme.css (remove --accent-text-color)
2. Component CSS files (restore `color: white` temporarily)
3. tokens.css (restore original accent definitions)

---

## Summary of Changes

| File | Lines | Type | Impact |
|------|-------|------|--------|
| tokens.css | 3-5 | Add | Add `--lit-accent` component |
| theme.css | 12 | Add | Add `--accent-text-color` |
| views.css | 15-20 | Modify | Replace hardcoded white |
| aui.css | 8-12 | Modify | Replace hardcoded white |
| book-nav.css | 5-8 | Modify | Replace hardcoded white |
| panels.css | 3-5 | Modify | Replace hardcoded white |
| **Total** | **50-70** | Mixed | All CSS, no JS changes |

All changes are backwards compatible - only CSS variables change.

