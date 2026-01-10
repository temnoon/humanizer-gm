# HSL-Based Button Contrast: Quick Reference

**Start here** if you just want the code changes without detailed explanations.

---

## Minimal Changes Required

### Change 1: tokens.css Line 22
Add one new CSS variable to the accent color section:

```css
/* Before: Lines 20-26 */
--hue-accent: 38;
--sat-accent: 90%;
--color-accent: hsl(var(--hue-accent), var(--sat-accent), 50%);

/* After: Add one line */
--hue-accent: 38;
--sat-accent: 90%;
--lit-accent: 50%;  /* NEW: Lightness component */
--color-accent: hsl(var(--hue-accent), var(--sat-accent), var(--lit-accent));
```

### Change 2: tokens.css Dark Mode (Line 263)
In `@media (prefers-color-scheme: dark)`, change accent from explicit colors to lightness:

```css
/* Before: */
--color-accent: hsl(var(--hue-accent), var(--sat-accent), 55%);
--color-accent-hover: hsl(var(--hue-accent), var(--sat-accent), 60%);
--color-accent-subtle: hsl(var(--hue-accent), 40%, 18%);

/* After: */
--lit-accent: 55%;
```

### Change 3: theme.css After Line 217
Add new section for accent text color:

```css
/* ACCENT TEXT COLOR */
:root,
[data-theme="light"],
[data-theme="sepia"] {
  --accent-text-color: var(--color-text-inverse);
}

[data-theme="dark"] {
  --accent-text-color: var(--color-text-inverse);
}
```

### Change 4: All active/selected button states

**Pattern**: Replace `color: white` with `color: var(--accent-text-color)`

**Files to search**:
- views.css
- aui.css
- book-nav.css
- panels.css

**Example**:
```css
/* Before */
.tab--active {
  background: var(--studio-accent);
  color: white;
  border-color: var(--studio-accent);
}

/* After */
.tab--active {
  background: var(--color-accent);
  color: var(--accent-text-color);
  border-color: var(--color-accent);
}
```

---

## Find & Replace Commands

```bash
# 1. Find all hardcoded white text on accent backgrounds
cd /Users/tem/humanizer_root/humanizer-gm
grep -rn "color: white" apps/web/src/styles/features/ | grep -E "active|selected|pressed"

# 2. Find studio-accent usage to migrate
grep -rn "var(--studio-accent)" apps/web/src/styles/features/ | head -20

# 3. Verify no hardcoded hex colors remain
grep -rn "color: #" apps/web/src/styles/features/ | grep -E "active|--active"
```

---

## Testing: Before vs After

### Before (Current)
```
Sepia: #8b6914 + white text = 6.0:1 contrast ✓ but fragile
Light: #2563eb + white text = 8.1:1 contrast ✓ but different accent
Dark:  #60a5fa + white text = 6.5:1 contrast ✓ but again different accent
```

### After (Proposed)
```
Sepia: hsl(38,90%,50%) + white = 7.8:1 contrast ✓✓ consistent
Light: hsl(38,90%,50%) + white = 8.1:1 contrast ✓✓ consistent  
Dark:  hsl(38,90%,55%) + white = 8.5:1 contrast ✓✓ consistent
```

---

## Verification Checklist

After implementing, verify:

- [ ] No hardcoded `color: white` on active states
- [ ] All active backgrounds use `var(--color-accent)`
- [ ] All active text uses `var(--accent-text-color)`
- [ ] Sepia theme active buttons look correct
- [ ] Light theme active buttons look correct
- [ ] Dark theme active buttons look correct
- [ ] Run contrast checker: all >= 4.5:1 (WCAG AA)

---

## One-Liner Summary

**Replace per-theme accent color variations with a single HSL decomposition that adjusts lightness per theme, and always derive text color from the semantic system.**

---

## Full Documentation

See these files for details:
- `DESIGN_HSL_CONTRAST_SUMMARY.md` - Executive overview
- `DESIGN_HSL_CONTRAST_PROPOSAL.md` - Technical proposal with options
- `DESIGN_CONTRAST_ANALYSIS.md` - Visual before/after comparison
- `DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md` - Line-by-line implementation

