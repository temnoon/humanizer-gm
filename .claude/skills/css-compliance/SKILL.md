---
description: CSS compliance enforcement. Auto-invoke when editing .css, .tsx, .jsx files. Prevents hardcoded colors, inline styles, and enforces CSS variable usage.
user-invocable: true
---

# CSS Compliance Reference

## Core Rule
**NO hardcoded colors or static inline styles. Use CSS variables for everything.**

## Required Variables

### Colors
| Purpose | Variable |
|---------|----------|
| Primary text | `var(--text-primary)` |
| Secondary text | `var(--text-secondary)` |
| Tertiary/muted | `var(--text-tertiary)` |
| Primary background | `var(--bg-primary)` |
| Secondary background | `var(--bg-secondary)` |
| Tertiary background | `var(--bg-tertiary)` |
| Borders | `var(--border-color)` |
| Accent/brand | `var(--accent-primary)` |
| Success | `var(--success)` |
| Warning | `var(--warning)` |
| Error | `var(--error)` |

### Spacing
| Variable | Usage |
|----------|-------|
| `var(--space-xs)` | 0.25rem - Tight spacing |
| `var(--space-sm)` | 0.5rem - Small padding |
| `var(--space-md)` | 1rem - Standard padding |
| `var(--space-lg)` | 1.5rem - Large spacing |
| `var(--space-xl)` | 2rem - Section spacing |

### Other
| Variable | Usage |
|----------|-------|
| `var(--radius-sm)` | Small border radius |
| `var(--radius-md)` | Standard border radius |
| `var(--radius-lg)` | Large border radius |
| `var(--shadow-sm)` | Subtle shadow |
| `var(--shadow-md)` | Standard shadow |

## Allowed Inline Styles (ONLY these)

```tsx
// ✅ Dynamic percentages
style={{ width: `${percent}%` }}

// ✅ Runtime transforms
style={{ transform: `translateX(${x}px)` }}

// ✅ Grid/flex spans
style={{ gridColumn: `span ${cols}` }}

// ✅ Animation frames
style={{ opacity: animationProgress }}
```

## Forbidden Patterns

```tsx
// ❌ NEVER: Hardcoded hex colors
style={{ color: '#666' }}
style={{ background: '#fff' }}

// ❌ NEVER: Static padding/margin
style={{ padding: '16px' }}
style={{ marginTop: '8px' }}

// ❌ NEVER: Hardcoded in CSS
.component { color: #333; }
.component { background: rgba(0,0,0,0.5); }
```

## Quick Audit Commands

```bash
# Count inline style violations
grep -r "style={{" --include="*.tsx" apps/web/src | grep -v "transform\|width:\s*\`\|opacity\|gridColumn" | wc -l

# Count hardcoded hex in CSS
grep -rE "#[0-9a-fA-F]{3,8}" --include="*.css" apps/web/src | wc -l

# Count hardcoded hex in TSX
grep -rE "color:\s*['\"]#|background:\s*['\"]#" --include="*.tsx" apps/web/src | wc -l
```

## BEM Naming Convention

```css
/* Block */
.book-project { }

/* Element */
.book-project__header { }
.book-project__title { }
.book-project__content { }

/* Modifier */
.book-project__header--collapsed { }
.book-project__title--large { }
```

## Override Protocol

If you MUST use a hardcoded value (third-party library, animation keyframe):
1. Add comment: `/* stylist-override: [reason] */`
2. Document in PR description
3. Track in TECHNICAL_DEBT.md
