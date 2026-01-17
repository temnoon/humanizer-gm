# Panel System Accessibility Specification
**Book Studio Photoshop-Style Panels**  
**Date**: January 16, 2026  
**WCAG Target**: 2.1 Level AA

---

## OVERVIEW

The Book Studio panel system must support:
1. **Docked panels**: Left/right side, fixed position
2. **Floating panels**: Draggable windows
3. **Tabbed panels**: Multiple tabs within panel
4. **Resizable panels**: Drag edges to resize
5. **Collapsible panels**: Expand/collapse sections

Accessibility requirements for each interaction pattern.

---

## PANEL CONTAINER STRUCTURE

### DOM Structure
```tsx
<div className="panel-system">
  {/* Left docked panel */}
  <aside
    className="panel panel--docked panel--left"
    role="region"
    aria-label="Outline panel"
    aria-expanded={isVisible}
  >
    <div className="panel__header">
      <h2 className="panel__title" id="outline-title">
        Outline
      </h2>
      <button
        className="panel__close"
        aria-label="Close outline panel"
        onClick={closePanel}
      >
        ×
      </button>
    </div>
    <div
      className="panel__content"
      role="region"
      aria-labelledby="outline-title"
    >
      {/* Panel content */}
    </div>
  </aside>

  {/* Resizer between panels */}
  <div
    className="panel-resizer"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize outline panel. Use arrow keys."
    aria-valuenow={panelWidth}
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    tabIndex={0}
    onKeyDown={handleResize}
  />

  {/* Main content area */}
  <main
    id="main-content"
    className="main-content"
    role="main"
  >
    {/* Content */}
  </main>

  {/* Right docked panel */}
  <aside
    className="panel panel--docked panel--right"
    role="region"
    aria-label="Settings panel"
    aria-expanded={isVisible}
  >
    {/* Settings */}
  </aside>
</div>

{/* Floating panels - rendered in portal */}
<FloatingPanel
  id="draft-panel"
  title="Draft"
  isOpen={isDraftOpen}
  onClose={closeDraft}
>
  {/* Draft content */}
</FloatingPanel>
```

---

## DOCKED PANEL ACCESSIBILITY

### Keyboard Navigation

**Tab Order**:
```
Skip Link → Header → Left Panel → Resizer → Main → Right Panel → Footer
```

**Keyboard Shortcuts**:
| Shortcut | Action |
|----------|--------|
| `Tab` | Navigate to next panel/element |
| `Shift+Tab` | Navigate to previous panel/element |
| `Cmd+[` or `Ctrl+[` | Focus left panel |
| `Cmd+]` or `Ctrl+]` | Focus right panel |
| `Cmd+M` | Focus main content |
| `Alt+O` | Toggle outline panel |
| `Alt+S` | Toggle settings panel |

**Implementation**:

```tsx
export function usePanelNavigation() {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case '[':
          e.preventDefault()
          focusPanel('left')
          break
        case ']':
          e.preventDefault()
          focusPanel('right')
          break
        case 'm':
        case 'M':
          e.preventDefault()
          focusPanel('main')
          break
      }
    }

    if (e.altKey) {
      switch (e.key) {
        case 'o':
        case 'O':
          e.preventDefault()
          togglePanel('outline')
          break
        case 's':
        case 'S':
          e.preventDefault()
          togglePanel('settings')
          break
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
```

### Panel Expansion/Collapse

```tsx
// Panel with collapsible sections
<div className="panel__section">
  <button
    className="panel__section-toggle"
    aria-expanded={isExpanded}
    aria-controls={`section-${id}`}
    onClick={() => setIsExpanded(!isExpanded)}
  >
    <span aria-hidden="true">
      {isExpanded ? '▼' : '▶'}
    </span>
    Section Title
  </button>

  <div
    id={`section-${id}`}
    className="panel__section-content"
    hidden={!isExpanded}
  >
    {/* Content shown only when expanded */}
  </div>
</div>
```

**CSS**:
```css
.panel__section-content[hidden] {
  display: none;
}

.panel__section-toggle:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

---

## FLOATING PANEL ACCESSIBILITY

### Structure
```tsx
export function FloatingPanel({
  id,
  title,
  isOpen,
  onClose,
  children,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = `${id}-title`

  // Focus management
  useEffect(() => {
    if (!isOpen) return

    const previousFocus = document.activeElement as HTMLElement

    // Focus first interactive element in panel
    const firstFocusable = panelRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]'
    ) as HTMLElement
    firstFocusable?.focus()

    return () => {
      previousFocus?.focus()
    }
  }, [isOpen])

  // Focus trap + keyboard handling
  useEffect(() => {
    if (!isOpen || !panelRef.current) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // Focus trap: prevent Tab from escaping panel
      if (e.key === 'Tab') {
        const focusables = Array.from(
          panelRef.current!.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]'
          )
        ) as HTMLElement[]

        if (focusables.length === 0) return

        const firstFocus = focusables[0]
        const lastFocus = focusables[focusables.length - 1]
        const activeElement = document.activeElement as HTMLElement

        if (e.shiftKey) {
          if (activeElement === firstFocus) {
            e.preventDefault()
            lastFocus.focus()
          }
        } else {
          if (activeElement === lastFocus) {
            e.preventDefault()
            firstFocus.focus()
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Trap backdrop clicks
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="floating-panel__backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="floating-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Draggable header */}
        <div className="floating-panel__header" role="toolbar">
          <h2 id={titleId} className="floating-panel__title">
            {title}
          </h2>
          <button
            className="floating-panel__close"
            aria-label="Close panel"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Content */}
        <div className="floating-panel__content">
          {children}
        </div>
      </div>
    </div>
  )
}
```

**CSS**:
```css
.floating-panel__backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

@media (prefers-reduced-motion: reduce) {
  .floating-panel__backdrop {
    animation: none;
  }
}

.floating-panel {
  position: relative;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.floating-panel__header {
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.floating-panel__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.floating-panel__close {
  min-width: 44px;
  min-height: 44px;
  padding: 10px;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}

.floating-panel__close:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.floating-panel__content {
  flex: 1;
  padding: 16px;
  overflow: auto;
}
```

---

## TABBED PANEL ACCESSIBILITY

### Structure (WAI-ARIA Tab Pattern)
```tsx
export function TabbedPanel({
  tabs,
  activeTab,
  onTabChange,
}: TabbedPanelProps) {
  return (
    <div className="tabbed-panel">
      {/* Tab list */}
      <div
        role="tablist"
        className="tabbed-panel__tablist"
        aria-label="Panel tabs"
      >
        {tabs.map((tab, idx) => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, idx, tabs.length)}
            className={`tabbed-panel__tab ${
              activeTab === tab.id ? 'tabbed-panel__tab--active' : ''
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          className="tabbed-panel__panel"
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}

// Keyboard navigation for tabs
function handleTabKeyDown(
  e: React.KeyboardEvent,
  currentIndex: number,
  totalTabs: number
) {
  let targetIndex = currentIndex

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault()
      targetIndex = (currentIndex + 1) % totalTabs
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault()
      targetIndex = (currentIndex - 1 + totalTabs) % totalTabs
      break
    case 'Home':
      e.preventDefault()
      targetIndex = 0
      break
    case 'End':
      e.preventDefault()
      targetIndex = totalTabs - 1
      break
    default:
      return
  }

  const tabs = Array.from(
    document.querySelectorAll('[role="tab"]')
  ) as HTMLElement[]
  tabs[targetIndex]?.focus()
  tabs[targetIndex]?.click()
}
```

**CSS**:
```css
.tabbed-panel__tablist {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--color-border);
}

.tabbed-panel__tab {
  padding: 12px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.tabbed-panel__tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.tabbed-panel__tab[aria-selected="true"] {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-primary);
}

.tabbed-panel__panel[hidden] {
  display: none;
}
```

---

## RESIZE HANDLE ACCESSIBILITY

### Enhanced Resizer
```tsx
export function EnhancedPanelResizer({
  panel,
  side,
  onResize,
}: ResizeProps) {
  const [isDragging, setIsDragging] = useState(false)
  const resizerRef = useRef<HTMLDivElement>(null)

  // Focus helpers
  const announceWidth = useCallback((width: number) => {
    const announce = document.createElement('div')
    announce.setAttribute('aria-live', 'polite')
    announce.setAttribute('aria-atomic', 'true')
    announce.className = 'sr-only'
    announce.textContent = `${panel} panel width: ${width}px`
    document.body.appendChild(announce)
    setTimeout(() => announce.remove(), 1000)
  }, [panel])

  // Keyboard resize
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 50 : 20

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          onResize(step)
          announceWidth(/* new width */)
          break
        case 'ArrowLeft':
          e.preventDefault()
          onResize(-step)
          announceWidth(/* new width */)
          break
        case 'Home':
          e.preventDefault()
          onResize('min')
          announceWidth(/* min width */)
          break
        case 'End':
          e.preventDefault()
          onResize('max')
          announceWidth(/* max width */)
          break
      }
    },
    [onResize, announceWidth]
  )

  return (
    <div
      ref={resizerRef}
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panel} panel`}
      aria-describedby="resizer-help"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={() => setIsDragging(true)}
    >
      {/* Visual handle */}
      <div className="panel-resizer__handle" aria-hidden="true" />
    </div>
  )
}
```

**CSS for accessibility**:
```css
.panel-resizer {
  width: 8px;
  cursor: col-resize;
  
  /* Expand hit area */
  padding-left: 18px;
  margin-left: -18px;
  
  display: flex;
  align-items: center;
  justify-content: center;
  
  /* 44px total width */
  min-width: 44px;
  min-height: 44px;
}

.panel-resizer:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: -4px;
  background-color: rgba(var(--color-primary-rgb), 0.1);
}

.panel-resizer:hover .panel-resizer__handle {
  width: 4px;
  background: var(--color-primary);
}

.panel-resizer--dragging {
  background-color: rgba(var(--color-primary-rgb), 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .panel-resizer,
  .panel-resizer__handle {
    transition: none;
  }
}
```

---

## FOCUS MANAGEMENT PATTERNS

### Panel Order Management
```tsx
export function usePanelFocusOrder() {
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const rightPanelRef = useRef<HTMLDivElement>(null)

  // Get all focusable elements in order
  const getFocusableElements = useCallback(() => {
    const focusables: HTMLElement[] = []

    [leftPanelRef, mainRef, rightPanelRef].forEach((ref) => {
      if (ref.current) {
        const elements = Array.from(
          ref.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]'
          )
        ) as HTMLElement[]
        focusables.push(...elements)
      }
    })

    return focusables
  }, [])

  // Move focus to next/previous panel
  const focusNextPanel = useCallback(() => {
    const focusables = getFocusableElements()
    const currentFocus = document.activeElement as HTMLElement
    const currentIndex = focusables.indexOf(currentFocus)
    const nextFocusable = focusables[currentIndex + 1] || focusables[0]
    nextFocusable?.focus()
  }, [getFocusableElements])

  return { focusNextPanel, getFocusableElements }
}
```

---

## ANNOUNCED STATE CHANGES

### Panel Open/Close Announcements
```tsx
// Announce when panel opens/closes
useEffect(() => {
  if (isOutlineVisible) {
    announceToScreenReader(
      `Outline panel opened. Press Escape to close.`,
      'polite'
    )
  } else {
    announceToScreenReader('Outline panel closed', 'polite')
  }
}, [isOutlineVisible])

// Helper
function announceToScreenReader(message: string, level: 'polite' | 'assertive') {
  const announce = document.createElement('div')
  announce.setAttribute('aria-live', level)
  announce.setAttribute('aria-atomic', 'true')
  announce.className = 'sr-only'
  announce.textContent = message
  document.body.appendChild(announce)
  setTimeout(() => announce.remove(), 3000)
}
```

---

## TESTING CHECKLIST

- [ ] Tab through all panels in correct order
- [ ] Escape closes floating panels
- [ ] Focus returns to trigger element after modal close
- [ ] Keyboard shortcuts (Cmd+[, Cmd+]) work
- [ ] Arrow keys resize panels
- [ ] Screen reader announces panel open/close
- [ ] Focus trap in floating panels works
- [ ] Tab order doesn't escape main content
- [ ] Resize handle is 44px touch target
- [ ] All buttons have focus-visible outline

---

## WCAG 2.1 AA Compliance

| Criterion | Pattern | Status |
|-----------|---------|--------|
| 2.1.1 Keyboard | Arrow keys, Tab, Escape, Cmd+[ | ✓ Required |
| 2.1.2 No Keyboard Trap | Focus trap in modals, release on close | ✓ Required |
| 2.4.3 Focus Order | Tab order through panels | ✓ Required |
| 2.4.7 Focus Visible | :focus-visible on all interactive | ✓ Required |
| 2.5.5 Target Size | 44x44px resizer | ✓ Required |
| 4.1.2 Name Role Value | ARIA roles and labels | ✓ Required |

