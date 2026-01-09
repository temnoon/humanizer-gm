# Studio.tsx Modularization Refactoring Plan

## CRITICAL: Read This Before Starting

The file `apps/web/src/Studio.tsx` is **184KB (~5,000 lines)** - far too large for Claude Code to read directly. This document provides the complete refactoring plan.

---

## Current State Analysis

`Studio.tsx` likely contains:
- Main Studio component
- Multiple embedded sub-components
- State management logic
- Event handlers
- Effect hooks
- Utility functions
- Type definitions

---

## Target Architecture

```
apps/web/src/
├── Studio.tsx                    # Shell only (~100-150 lines)
├── studio/
│   ├── index.ts                  # Barrel exports
│   ├── StudioContext.tsx         # Context provider + state
│   ├── StudioLayout.tsx          # Main layout structure
│   ├── StudioToolbar.tsx         # Top toolbar
│   ├── StudioSidebar.tsx         # Sidebar panel
│   ├── StudioPanels.tsx          # Panel management
│   ├── StudioFooter.tsx          # Footer/status bar
│   ├── hooks/
│   │   ├── index.ts
│   │   ├── useStudioState.ts     # Main state hook
│   │   ├── useStudioActions.ts   # Action handlers
│   │   ├── useStudioKeyboard.ts  # Keyboard shortcuts
│   │   └── useStudioLayout.ts    # Layout management
│   ├── components/
│   │   ├── index.ts
│   │   ├── PanelContainer.tsx
│   │   ├── PanelHeader.tsx
│   │   ├── PanelContent.tsx
│   │   └── ... (other sub-components)
│   └── types.ts                  # TypeScript types
```

---

## Phase 1: Create Directory Structure

```bash
mkdir -p apps/web/src/studio/{hooks,components}
```

---

## Phase 2: Identify Extraction Boundaries

Run these grep commands to understand the file structure:

```bash
# Find all function declarations
grep -n "^function\|^const.*=.*=>\|^export function\|^export const" apps/web/src/Studio.tsx | head -100

# Find all useState hooks
grep -n "useState" apps/web/src/Studio.tsx | wc -l

# Find all useEffect hooks
grep -n "useEffect" apps/web/src/Studio.tsx | wc -l

# Find all useCallback hooks
grep -n "useCallback" apps/web/src/Studio.tsx | wc -l

# Find all useMemo hooks
grep -n "useMemo" apps/web/src/Studio.tsx | wc -l

# Find all type definitions
grep -n "^type\|^interface" apps/web/src/Studio.tsx

# Find all return statements (component boundaries)
grep -n "return (" apps/web/src/Studio.tsx

# Find JSX component usage
grep -n "<[A-Z][a-zA-Z]*" apps/web/src/Studio.tsx | head -50
```

---

## Phase 3: Extract Types First

Create `apps/web/src/studio/types.ts`:

```typescript
// types.ts - All Studio-related TypeScript types

export interface StudioState {
  // Panel state
  panels: PanelState[];
  activePanel: string | null;
  
  // Layout state
  sidebarCollapsed: boolean;
  bottomPanelVisible: boolean;
  
  // UI state
  loading: boolean;
  error: string | null;
}

export interface PanelState {
  id: string;
  type: PanelType;
  title: string;
  visible: boolean;
  position: PanelPosition;
  size: PanelSize;
}

export type PanelType = 
  | 'archive'
  | 'book'
  | 'aui'
  | 'tools'
  | 'preview';

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface StudioActions {
  openPanel: (type: PanelType) => void;
  closePanel: (id: string) => void;
  toggleSidebar: () => void;
  setActivePanel: (id: string | null) => void;
}

export type StudioContextType = StudioState & StudioActions;
```

---

## Phase 4: Extract Context Provider

Create `apps/web/src/studio/StudioContext.tsx`:

```typescript
// StudioContext.tsx - State management for Studio

import { createContext, useContext, ReactNode } from 'react';
import { useStudioState } from './hooks/useStudioState';
import type { StudioContextType } from './types';

const StudioContext = createContext<StudioContextType | null>(null);

interface StudioProviderProps {
  children: ReactNode;
  initialState?: Partial<StudioState>;
}

export function StudioProvider({ children, initialState }: StudioProviderProps) {
  const state = useStudioState(initialState);
  
  return (
    <StudioContext.Provider value={state}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio(): StudioContextType {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used within a StudioProvider');
  }
  return context;
}
```

---

## Phase 5: Extract State Hook

Create `apps/web/src/studio/hooks/useStudioState.ts`:

```typescript
// useStudioState.ts - Main state management hook

import { useState, useCallback, useMemo } from 'react';
import type { StudioState, StudioActions, PanelType } from '../types';

const defaultState: StudioState = {
  panels: [],
  activePanel: null,
  sidebarCollapsed: false,
  bottomPanelVisible: true,
  loading: false,
  error: null,
};

export function useStudioState(initialState?: Partial<StudioState>) {
  const [state, setState] = useState<StudioState>({
    ...defaultState,
    ...initialState,
  });
  
  const openPanel = useCallback((type: PanelType) => {
    setState(prev => ({
      ...prev,
      panels: [
        ...prev.panels,
        {
          id: `${type}-${Date.now()}`,
          type,
          title: getPanelTitle(type),
          visible: true,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
        },
      ],
    }));
  }, []);
  
  const closePanel = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      panels: prev.panels.filter(p => p.id !== id),
      activePanel: prev.activePanel === id ? null : prev.activePanel,
    }));
  }, []);
  
  const toggleSidebar = useCallback(() => {
    setState(prev => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed,
    }));
  }, []);
  
  const setActivePanel = useCallback((id: string | null) => {
    setState(prev => ({
      ...prev,
      activePanel: id,
    }));
  }, []);
  
  const actions: StudioActions = useMemo(() => ({
    openPanel,
    closePanel,
    toggleSidebar,
    setActivePanel,
  }), [openPanel, closePanel, toggleSidebar, setActivePanel]);
  
  return { ...state, ...actions };
}

function getPanelTitle(type: PanelType): string {
  const titles: Record<PanelType, string> = {
    archive: 'Archive',
    book: 'Book',
    aui: 'AUI',
    tools: 'Tools',
    preview: 'Preview',
  };
  return titles[type];
}
```

---

## Phase 6: Extract Layout Component

Create `apps/web/src/studio/StudioLayout.tsx`:

```typescript
// StudioLayout.tsx - Main layout structure

import { ReactNode } from 'react';
import { useStudio } from './StudioContext';
import { StudioToolbar } from './StudioToolbar';
import { StudioSidebar } from './StudioSidebar';
import { StudioFooter } from './StudioFooter';

interface StudioLayoutProps {
  children: ReactNode;
}

export function StudioLayout({ children }: StudioLayoutProps) {
  const { sidebarCollapsed } = useStudio();
  
  return (
    <div className="studio">
      <StudioToolbar />
      <div className="studio__body">
        <StudioSidebar collapsed={sidebarCollapsed} />
        <main className="studio__main">
          {children}
        </main>
      </div>
      <StudioFooter />
    </div>
  );
}
```

---

## Phase 7: Create Barrel Export

Create `apps/web/src/studio/index.ts`:

```typescript
// index.ts - Barrel exports for studio module

export { StudioProvider, useStudio } from './StudioContext';
export { StudioLayout } from './StudioLayout';
export { StudioToolbar } from './StudioToolbar';
export { StudioSidebar } from './StudioSidebar';
export { StudioPanels } from './StudioPanels';
export { StudioFooter } from './StudioFooter';

// Hooks
export { useStudioState } from './hooks/useStudioState';
export { useStudioActions } from './hooks/useStudioActions';
export { useStudioKeyboard } from './hooks/useStudioKeyboard';

// Types
export type {
  StudioState,
  StudioActions,
  StudioContextType,
  PanelState,
  PanelType,
  PanelPosition,
  PanelSize,
} from './types';
```

---

## Phase 8: Refactor Main Component

New `apps/web/src/Studio.tsx` (~100 lines):

```typescript
// Studio.tsx - Main Studio component (shell only)

import { StudioProvider, StudioLayout, StudioPanels } from './studio';

interface StudioProps {
  initialState?: Partial<StudioState>;
}

export function Studio({ initialState }: StudioProps) {
  return (
    <StudioProvider initialState={initialState}>
      <StudioLayout>
        <StudioPanels />
      </StudioLayout>
    </StudioProvider>
  );
}

export default Studio;
```

---

## Incremental Migration Strategy

Since we can't read the full file, use this incremental approach:

### Step 1: Extract Types (Safe, No Behavior Change)
```bash
# Find type definitions
grep -n "^type\|^interface\|^export type\|^export interface" apps/web/src/Studio.tsx > /tmp/studio-types.txt
```

### Step 2: Extract Hooks One-by-One
```bash
# Find each hook cluster
grep -n "const \[.*useState\|useEffect\|useCallback\|useMemo" apps/web/src/Studio.tsx > /tmp/studio-hooks.txt
```

### Step 3: Identify Component Boundaries
```bash
# Find function components
grep -n "^function [A-Z]\|^const [A-Z].*=.*=>" apps/web/src/Studio.tsx > /tmp/studio-components.txt
```

### Step 4: Extract Bottom-Up
Start with leaf components (no dependencies on other Studio internals), then work up.

---

## Testing Strategy

After each extraction:

1. **Type Check**: `npx tsc --noEmit`
2. **Build**: `npm run build`
3. **Visual Test**: Run app, verify Studio renders correctly
4. **Console Check**: No new errors in browser console

---

## Success Criteria

- [ ] Studio.tsx < 150 lines
- [ ] No file > 300 lines
- [ ] All components independently testable
- [ ] Clean import paths (from './studio')
- [ ] Types in separate file
- [ ] Hooks in separate files
- [ ] Context properly isolated
- [ ] Build passes
- [ ] No visual regressions

---

## Common Pitfalls

1. **Circular Dependencies**: If A imports B and B imports A, extract shared code to C
2. **Context Scope**: Don't access context outside provider
3. **Hook Rules**: Hooks can only be called in React functions
4. **Type Exports**: Export types separately with `export type`

---

## If You Get Stuck

1. Extract the smallest, most independent piece first
2. Test immediately after each change
3. Keep the old code commented until new code is verified
4. Use `// TODO: extract to studio/X.tsx` comments to track progress
