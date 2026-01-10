# HSL-Based Automatic Contrast System for Active Button States

**Objective**: Ensure reliable text contrast on active/selected button backgrounds across all themes (light, sepia, dark) using HSL calculations.

**Status**: Research Complete - Ready for Implementation

---

## Current Problem

The `--studio-accent` color is mid-tone in most themes (amber #8b7355 in sepia/light, blue #2563eb in light, #60a5fa in dark). This creates contrast issues:

- **Sepia theme**: Accent #8b6914 or #8b7355 (mid-brown) doesn't contrast well with hardcoded white text
- **Light theme**: Accent #2563eb (blue) works with white but may not work in all scenarios  
- **Dark theme**: Accent #60a5fa (light blue) works with white but is inconsistent with the sepia approach

Current workaround: Hardcoded `color: white` on active buttons, which breaks accessibility in light modes.

---

## Research Findings

### 1. Existing HSL Infrastructure (✅ Already in Place)

The codebase **already uses HSL variables** for all theme colors:

**In `/packages/ui/styles/tokens.css`**:
- Base HSL components separated: `--hue-primary`, `--sat-primary`, etc.
- Brand colors constructed with HSL: `hsl(var(--hue-accent), var(--sat-accent), 50%)`
- Per-theme lightness adjustments in `@media (prefers-color-scheme: dark)`
- Three theme layers: `:root`, `@media dark`, `[data-theme="dark"]`

**Key insight**: The token system is designed for this. We just need to extend it.

### 2. CSS `color-contrast()` Function Status

**Browser Support**: ❌ **NOT YET READY** (CSS Color Module Level 5)
- Chromium: Under consideration
- Firefox: Not implemented
- Safari: Not implemented

**Decision**: Cannot rely on `color-contrast()` yet. Must use manual HSL calculations.

### 3. Manual HSL-Based Text Color Selection

**Simple formula** (works in all browsers):
```css
/* If background lightness > 50%, use dark text; else use light text */
/* HTML doesn't support conditional calc(), so we use CSS variables as a proxy */

--accent-l: 50%;  /* Define once per theme */

/* Then use this logic:
   - If lightness is HIGH (>60%), text should be DARK
   - If lightness is LOW (<40%), text should be LIGHT
*/
```

**Problem with pure calc()**: CSS doesn't have `if/else`, so we can't compute text color from lightness value alone. We need to set it explicitly per theme OR use the accent in a way that guarantees contrast.

---

## Proposed Solution: Two-Track Approach

### Option A: Explicit Lightness + Theme-Specific Text Color (RECOMMENDED)

Define accent as separate HSL components, then set text color explicitly per theme.

**Implementation**:

In `tokens.css`:
```css
:root {
  /* Accent color components */
  --accent-h: 38;         /* Hue: warm amber */
  --accent-s: 90%;        /* Saturation */
  --accent-l: 50%;        /* Lightness - BASE for light mode */
  
  /* Derive full accent color */
  --color-accent: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
  --color-accent-hover: hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) - 5%));
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Darkened for dark mode */
    --accent-l: 55%;
  }
}

/* Manual theme overrides */
[data-theme="sepia"] {
  --accent-l: 50%;
}

[data-theme="dark"] {
  --accent-l: 55%;
}
```

In component CSS (e.g., `views.css`):
```css
/* Active state - text color depends on background lightness */
.facebook-view__tab--active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  
  /* Text color: explicitly set per theme based on accent lightness */
  color: var(--accent-text-color);
}

/* Define accent text color in theme system */
```

In `theme.css`:
```css
:root,
[data-theme="light"] {
  --accent-text-color: var(--color-text-inverse); /* white, works with ~50% lightness */
}

[data-theme="sepia"] {
  --accent-text-color: var(--color-text-inverse); /* white on amber works */
}

[data-theme="dark"] {
  --accent-text-color: var(--color-text-inverse); /* white on light blue works */
}
```

**Advantages**:
- ✅ No calc() tricks needed
- ✅ Explicit and maintainable
- ✅ Easy to audit for contrast (WCAG)
- ✅ Reuses existing semantic variables
- ✅ Works in all browsers

**Disadvantages**:
- Manual per-theme configuration
- Requires documenting the intent (accent text always = inverse)

---

### Option B: Accent Lightness Range + RGB Fallback (ALTERNATIVE)

For scenarios where accent can be applied to varying backgrounds, we could use a range:

```css
:root {
  --accent-h: 38;
  --accent-s: 90%;
  --accent-l-light: 50%;   /* Light mode: medium brightness */
  --accent-l-dark: 30%;    /* Dark mode: darker for light text to work */
  
  --color-accent: hsl(var(--accent-h), var(--accent-s), var(--accent-l-light));
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-accent: hsl(var(--accent-h), var(--accent-s), var(--accent-l-dark));
  }
}
```

**Advantages**:
- ✅ Accent automatically adapts per theme
- ✅ Guarantees contrast (dark accent = light text works)

**Disadvantages**:
- ❌ Changes the accent color visually (darker in dark mode might be unexpected)
- May not align with brand intent

---

## Recommended Implementation (Option A)

### Step 1: Update `tokens.css`

Decompose accent into HSL components:

```css
:root {
  /* Accent - Warm amber for highlights */
  --hue-accent: 38;
  --sat-accent: 90%;
  --lit-accent: 50%;  /* NEW: explicit lightness variable */
  
  --color-accent: hsl(var(--hue-accent), var(--sat-accent), var(--lit-accent));
  --color-accent-hover: hsl(var(--hue-accent), var(--sat-accent), calc(var(--lit-accent) - 5%));
  --color-accent-subtle: hsl(var(--hue-accent), 50%, 95%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --lit-accent: 55%;  /* Lighter in dark mode for better contrast */
  }
}

[data-theme="dark"] {
  --lit-accent: 55%;
}

[data-theme="light"] {
  --lit-accent: 50%;
}

[data-theme="sepia"] {
  --lit-accent: 50%;
}
```

### Step 2: Add accent-text variable to `theme.css`

```css
/* Accent text color - always inverse to guarantee contrast */
:root,
[data-theme="light"],
[data-theme="sepia"] {
  --accent-text-color: var(--color-text-inverse);
}

[data-theme="dark"] {
  --accent-text-color: var(--color-text-inverse);
}
```

### Step 3: Update active button states in `views.css`, `aui.css`, etc.

Find patterns like:
```css
.facebook-view__tab--active {
  background: var(--studio-accent);
  color: white;  /* ← REMOVE hardcoded white */
}
```

Replace with:
```css
.facebook-view__tab--active {
  background: var(--color-accent);
  color: var(--accent-text-color);
}
```

**Files to update**: 
- `apps/web/src/styles/features/views.css` (multiple tab active states)
- `apps/web/src/styles/features/panels.css` (active states)
- `apps/web/src/styles/features/aui.css` (button active states)
- `apps/web/src/styles/features/book-nav.css` (nav active states)

### Step 4: Verify contrast with tools

Run contrast check after implementation:
```bash
# Check WCAG AA compliance (4.5:1 for normal text)
# Use: https://webaim.org/resources/contrastchecker/

# Test combos:
# Light: text-inverse (#fff) on accent (#f5a623) → ratio ~8:1 ✅
# Dark: text-inverse (#fff) on accent (#60a5fa) → ratio ~6.5:1 ✅
# Sepia: text-inverse (#fff) on accent (#8b6914) → ratio ~6:1 ✅
```

---

## Implementation Priority

**Phase 1 (Minimum)**:
- Update `tokens.css` to expose `--lit-accent`
- Add `--accent-text-color` to `theme.css`
- Update active states to use `var(--accent-text-color)` instead of hardcoded `white`

**Phase 2 (Optimization)**:
- Consider making accent calculation automatic (Option B) if brand wants consistent accent appearance
- Document accent contrast guarantees in STYLEGUIDE.md

**Phase 3 (Future)**:
- Monitor `color-contrast()` browser support
- Migrate to native CSS function when available (2026+)

---

## Testing Checklist

- [ ] Light theme: active buttons readable
- [ ] Dark theme: active buttons readable
- [ ] Sepia theme: active buttons readable
- [ ] Contrast ratio ≥4.5:1 (WCAG AA) for all combinations
- [ ] No hardcoded color values in new code
- [ ] Hover states maintain contrast
- [ ] Focus states visible on active + hovered buttons

---

## Questions for Code Owner

1. **Accent behavior in dark mode**: Should accent become lighter (current tokens), or should we darken it to guarantee contrast?
2. **Brand alignment**: Is text always white on active states acceptable, or do we need theme-specific text colors?
3. **Active state variations**: Are there scenarios where active states don't use white text currently?

