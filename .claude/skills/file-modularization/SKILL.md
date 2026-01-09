---
description: File modularization patterns and thresholds. Reference when splitting large files, creating module boundaries, or auditing file sizes. Critical for maintaining Claude Code readability.
user-invocable: true
---

# File Modularization Guide

## Why This Matters

**Claude Code cannot read files larger than ~100KB directly.** When files exceed this:
- Full file reads fail, requiring fragmented grep/search
- Context is lost - changes miss related code
- Token waste from repeated partial reads
- Architectural understanding degrades

**Current Emergency** (based on file listing):
- `index.css`: 418KB (~12,000 lines) - **UNREADABLE**
- `Studio.tsx`: 184KB (~5,000 lines) - **UNREADABLE**

---

## Size Thresholds

| File Type | Target | Warning | MUST SPLIT |
|-----------|--------|---------|------------|
| CSS | <100 lines | 150 lines | 200+ lines |
| React Component | <150 lines | 250 lines | 350+ lines |
| TypeScript Module | <100 lines | 150 lines | 200+ lines |
| Hook | <50 lines | 80 lines | 120+ lines |
| Type Definitions | <80 lines | 120 lines | 200+ lines |

**File Size in Bytes**:
- Target: <15KB
- Warning: 25KB
- MUST SPLIT: 50KB+

---

## CSS Modularization

### Logical Groupings

```
styles/
├── index.css           # @imports only
├── base/
│   ├── variables.css   # CSS custom properties
│   ├── reset.css       # Normalize/reset
│   └── typography.css  # Fonts, text styles
├── layout/
│   ├── grid.css        # Grid system
│   ├── containers.css  # Container patterns
│   └── responsive.css  # Media queries
├── components/
│   ├── [component].css # One file per component type
└── features/
    ├── [feature].css   # One file per feature area
```

### CSS Split Algorithm

1. **Extract CSS variables first** → `base/variables.css`
2. **Extract reset/normalize** → `base/reset.css`
3. **Group by selector prefix**:
   - `.book-*` → `features/book.css`
   - `.aui-*` → `features/aui.css`
   - `.btn-*` → `components/buttons.css`
4. **Extract media queries** → `layout/responsive.css`
5. **Create index.css** with @imports in dependency order

### Import Order (Critical)

```css
/* 1. Variables first - others depend on these */
@import './base/variables.css';

/* 2. Reset - normalize before adding styles */
@import './base/reset.css';

/* 3. Typography - base text styles */
@import './base/typography.css';

/* 4. Layout - structural patterns */
@import './layout/grid.css';
@import './layout/containers.css';

/* 5. Components - reusable elements */
@import './components/buttons.css';
@import './components/forms.css';
/* ... */

/* 6. Features - specific feature styles */
@import './features/archive.css';
@import './features/book.css';
/* ... */

/* 7. Responsive LAST - overrides previous */
@import './layout/responsive.css';

/* 8. Utilities LAST - highest specificity needs */
@import './utilities/helpers.css';
```

---

## React Component Modularization

### Split Triggers

Split a component when it has:
- Multiple useState/useEffect clusters (3+)
- Multiple distinct UI sections
- Embedded sub-components
- Helper functions that could be hooks
- More than 2 context consumers

### Extraction Pattern

**Before** (monolithic):
```tsx
// Studio.tsx - 5000 lines
export function Studio() {
  // 500 lines of state
  // 300 lines of effects
  // 200 lines of handlers
  // 4000 lines of JSX with embedded components
}
```

**After** (modular):
```tsx
// Studio.tsx - 150 lines
export function Studio() {
  return (
    <StudioProvider>
      <StudioLayout>
        <StudioToolbar />
        <StudioPanels />
        <StudioFooter />
      </StudioLayout>
    </StudioProvider>
  );
}
```

### Hook Extraction

```tsx
// Before: in component
const [state, setState] = useState(initial);
const [derived, setDerived] = useState(null);
useEffect(() => { /* complex logic */ }, [deps]);
const handleAction = () => { /* logic */ };

// After: custom hook
// hooks/useStudioState.ts
export function useStudioState(initial) {
  const [state, setState] = useState(initial);
  const [derived, setDerived] = useState(null);
  
  useEffect(() => { /* complex logic */ }, [deps]);
  
  const handleAction = useCallback(() => { /* logic */ }, [deps]);
  
  return { state, derived, handleAction };
}
```

### Context Extraction

```tsx
// contexts/StudioContext.tsx
const StudioContext = createContext<StudioContextType | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const state = useStudioState(initialState);
  return (
    <StudioContext.Provider value={state}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be within StudioProvider');
  return context;
}
```

---

## Barrel Exports Pattern

Every directory with multiple exports should have an index.ts:

```typescript
// studio/index.ts
export { Studio } from './Studio';
export { StudioProvider, useStudio } from './StudioContext';
export { StudioLayout } from './StudioLayout';
export { StudioToolbar } from './StudioToolbar';
export { StudioPanels } from './StudioPanels';
export type { StudioState, StudioAction } from './types';
```

**Benefits**:
- Clean imports: `import { Studio, useStudio } from './studio'`
- Single point of change for refactors
- Clear public API

---

## Dependency Rules

### Allowed Dependencies
```
base/ → nothing
layout/ → base/
components/ → base/, layout/
features/ → base/, layout/, components/
pages/ → all
```

### Circular Dependency Prevention

1. **Never import parent from child**
2. **Shared dependencies go in `shared/` or `lib/`**
3. **Types in separate `types/` files**
4. **Use context for cross-cutting state**

---

## Quick Commands

```bash
# Find files over threshold
find . -name "*.tsx" -size +50k -exec ls -lh {} \;
find . -name "*.css" -size +20k -exec ls -lh {} \;

# Count lines per file
find . -name "*.tsx" -exec wc -l {} \; | sort -rn | head -20

# Find files with too many imports (complexity signal)
for f in $(find . -name "*.tsx"); do
  count=$(grep -c "^import" "$f" 2>/dev/null)
  if [ "$count" -gt 15 ]; then
    echo "$count imports: $f"
  fi
done

# Check for inline component definitions (split candidates)
grep -l "function.*=.*=>" apps/web/src/*.tsx
```

---

## Refactoring Checklist

- [ ] File under size threshold
- [ ] Single responsibility
- [ ] Clean imports (no deep paths)
- [ ] Types extracted to types file
- [ ] Hooks in hooks/ directory
- [ ] Context in contexts/ directory
- [ ] Barrel export created
- [ ] No circular dependencies
- [ ] Tests still pass
