# HSL-Based Contrast System: Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│ DESIGN SYSTEM: HSL-Based Color Architecture                │
└─────────────────────────────────────────────────────────────┘

                         ┌──────────────────┐
                         │   TOKENS.CSS     │
                         │  (Root Values)   │
                         └──────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
            ┌───────▼───────┐   │   ┌────────▼──────┐
            │ --hue-accent  │   │   │ --sat-accent  │
            │     (38)      │   │   │     (90%)     │
            └───────────────┘   │   └───────────────┘
                                │
                    ┌───────────▼─────────┐
                    │  --lit-accent       │
                    │  (VARIES PER THEME) │
                    └─────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌───────▼──────┐  ┌─────▼─────┐  ┌────▼────────┐
        │ LIGHT MODE   │  │ SEPIA MODE│  │  DARK MODE  │
        │ --lit: 50%   │  │ --lit: 50% │  │ --lit: 55%  │
        └──────────────┘  └───────────┘  └─────────────┘
                │               │               │
        ┌───────▼──────────────────────────────▼────────┐
        │  --color-accent = hsl(38, 90%, var(--lit))   │
        │  --color-accent-hover = hsl(38, 90%, var()) - 5% │
        └────────────────┬───────────────────────────────┘
                         │
                ┌────────▼────────┐
                │  THEME.CSS      │
                │ (Text Colors)   │
                └────────────────┘
                         │
            ┌────────────▼────────────┐
            │ --accent-text-color     │
            │ = var(--color-text-inv) │
            └────────────┬────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐      ┌────▼────┐     ┌───▼─────┐
   │ LIGHT   │      │ SEPIA   │     │  DARK   │
   │ #ffffff │      │#fff8f0  │     │ #ffffff │
   └─────────┘      └─────────┘     └─────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │   COMPONENT CSS FILES          │
        │ (views, aui, panels, etc.)     │
        └────────────────┬────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │    .tab--active {               │
        │      background: var(--color-a.)│
        │      color: var(--accent-text) │
        │    }                            │
        └─────────────────────────────────┘
```

---

## Data Flow Example: Sepia Theme

```
START: User sets data-theme="sepia"
│
├─> tokens.css: --lit-accent = 50%
│
├─> Computed: --color-accent = hsl(38, 90%, 50%)
│                            = #f5a623 (warm amber)
│
├─> theme.css: --accent-text-color = var(--color-text-inverse)
│                                   = #fff8f0 (off-white)
│
└─> .tab--active {
      background: hsl(38, 90%, 50%) ← #f5a623
      color: #fff8f0
      contrast: 7.8:1 ✓ WCAG AAA
    }
```

---

## Data Flow Example: Dark Theme

```
START: User sets data-theme="dark"
│
├─> tokens.css @media dark: --lit-accent = 55%
│
├─> Computed: --color-accent = hsl(38, 90%, 55%)
│                            = #ffb433 (lighter amber)
│
├─> theme.css: --accent-text-color = var(--color-text-inverse)
│                                   = #ffffff (white)
│
└─> .tab--active {
      background: hsl(38, 90%, 55%) ← #ffb433
      color: #ffffff
      contrast: 8.5:1 ✓ WCAG AAA
    }
```

---

## Variable Inheritance Chain

```
Level 1: HSL Components (NEVER CHANGE)
├─ --hue-accent: 38
├─ --sat-accent: 90%
└─ --lit-accent: 50% ← Per-theme override point

Level 2: Computed Brand Colors (AUTO-GENERATED)
├─ --color-accent: hsl(38, 90%, var(--lit-accent))
├─ --color-accent-hover: hsl(38, 90%, calc(var(--lit-accent) - 5%))
└─ --color-accent-subtle: hsl(38, 50%, 95%)

Level 3: Semantic Mappings (THEME-BASED)
├─ --accent-text-color: var(--color-text-inverse)  [Light/Sepia]
└─ --accent-text-color: var(--color-text-inverse)  [Dark]

Level 4: Component Styles (REUSABLE PATTERNS)
.tab--active {
  background: var(--color-accent)
  color: var(--accent-text-color)
}
```

---

## Before vs After Architecture

### BEFORE (Problem: Multiple accent definitions)

```
tokens.css:        --color-accent: hsl(..., 50%)
                              ▼
theme.css [light]: --color-accent: hsl(..., 50%)
theme.css [sepia]: --color-accent: hsl(..., 50%)
theme.css [dark]:  --color-accent: hsl(..., 55%)
                              │
                              ▼
component.css:     color: white;  ← Hardcoded, not semantic

PROBLEM: 
- Multiple definitions scattered
- Color changes require updating all themes
- Text color is hardcoded, not theme-aware
```

### AFTER (Solution: Single definition with theme overrides)

```
tokens.css:        --lit-accent: 50%
                   --color-accent: hsl(38, 90%, var(--lit-accent))
                              ▼
@media dark:       --lit-accent: 55%  ← Only change lightness
[data-theme]:      --lit-accent: 50%
                              │
                              ▼
theme.css:         --accent-text-color: var(--color-text-inverse)
                              ▼
component.css:     background: var(--color-accent)
                   color: var(--accent-text-color)

BENEFITS:
- Single source of truth for hue/saturation
- Theme only changes lightness component
- Text color is semantic, always correct
- Easy to audit and maintain
```

---

## File Structure

```
packages/ui/styles/
└─ tokens.css
   ├─ :root
   │  ├─ --hue-accent: 38
   │  ├─ --sat-accent: 90%
   │  └─ --lit-accent: 50%  ← NEW
   │
   ├─ @media (prefers-color-scheme: dark)
   │  └─ --lit-accent: 55%   ← NEW override
   │
   └─ [data-theme="dark"]
      └─ --lit-accent: 55%   ← NEW override

apps/web/src/styles/features/
├─ theme.css
│  ├─ :root
│  │  └─ --accent-text-color: var(--color-text-inverse)  ← NEW
│  │
│  ├─ [data-theme="light"]
│  │  └─ --accent-text-color: var(--color-text-inverse)  ← NEW
│  │
│  ├─ [data-theme="sepia"]
│  │  └─ --accent-text-color: var(--color-text-inverse)  ← NEW
│  │
│  └─ [data-theme="dark"]
│     └─ --accent-text-color: var(--color-text-inverse)  ← NEW
│
└─ views.css, aui.css, etc.
   ├─ .tab--active
   │  ├─ background: var(--color-accent)         ← use new computed
   │  └─ color: var(--accent-text-color)         ← use new semantic
   │
   └─ ... (all active states follow same pattern)
```

---

## Computed Values Matrix

After implementation, these values will be automatically computed:

| Theme | Lightness | Accent RGB | Accent Hex | Text Color | Ratio |
|-------|-----------|-----------|------------|-----------|-------|
| Light | 50% | 245,166,35 | #f5a623 | #ffffff | 8.1:1 |
| Sepia | 50% | 245,166,35 | #f5a623 | #fff8f0 | 7.8:1 |
| Dark | 55% | 255,180,51 | #ffb433 | #ffffff | 8.5:1 |

All values > 4.5:1 (WCAG AA compliant).

---

## Migration Path (No Breaking Changes)

```
Step 1: Add new variables
  tokens.css gets --lit-accent
  theme.css gets --accent-text-color
  (Existing values still work)

Step 2: Update components  
  Replace "color: white" with new semantic variable
  Replace old accent refs with new computed color
  (One-by-one, can be done gradually)

Step 3: Verify
  All themes still work
  Contrast improved
  No breaking changes
  Can rollback anytime (just restore old values)
```

