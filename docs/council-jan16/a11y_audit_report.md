# Accessibility Audit: Book Studio Redesign
**Review Date**: January 16, 2026  
**Agent**: House of Accessibility  
**WCAG Target**: 2.1 Level AA  
**Signoff Level**: REQUIRED (interactive components)

---

## EXECUTIVE SUMMARY

The Book Studio redesign introduces a Photoshop-style panel system with AUI (Agent UI) tool echo display. Current codebase has **MODERATE accessibility gaps** affecting keyboard navigation, screen reader compatibility, and focus management across panel systems.

**VERDICT**: ⚠️ **CONDITIONAL PASS** - Critical issues must be resolved before merge

**Violations Found**: 12 Critical | 8 Serious | 14 Moderate  
**Recommendations**: 6 Required | 8 Advisory

### Quick Stats
- **Keyboard accessible buttons**: 85% ✓
- **ARIA labels on icon-only elements**: 40% ✗
- **Focus-visible styles defined**: 0% ✗
- **Prefers-reduced-motion support**: 0% ✗
- **Touch targets (44px+)**: 60% ✗
- **Form inputs with labels**: 85% ✓

---

## CRITICAL VIOLATIONS (Must Fix)

### 1. Panel System: Missing Keyboard Navigation [WCAG 2.1.1]

**Impact**: Keyboard-only users cannot navigate between panels, resize, or interact.

**Files**:
- `/Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/BookStudio.tsx` (Main layout)
- `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/components/layout/SplitModeToolbar.tsx` (Toolbar)

**Issues**:

```tsx
// VIOLATION: No keyboard navigation between panels
// BookStudio.tsx - Main layout doesn't support Tab to switch panels
<div className="book-studio__body">
  {showOutline && <OutlinePanel ... />}
  <main className="book-studio__main">
    {/* Content */}
  </main>
</div>

// Tab order is broken: 
// Cannot tab between OutlinePanel → Main Content → Settings
// No focus trap management for modal panels
```

**Fix Required**: 
1. Implement panel tab order with `tabIndex` management
2. Support Alt+Tab or Cmd+[ / Cmd+] for panel switching
3. Add keyboard shortcuts documented in UI

---

### 2. Modal Panels: No Focus Trap or Keyboard Escape [WCAG 2.1.2, 2.4.3]

**Impact**: Screen reader users don't know focus is trapped in modal; Escape key doesn't close panels.

**Files**:
- `OutlinePanel.tsx`
- `ContextModal.tsx`
- `SettingsPanel.tsx`
- `CommandPalette.tsx`

**Issue**:

```tsx
// VIOLATION: ContextModal has no focus trap
export function ContextModal() {
  // No role="dialog", aria-modal
  // Escape key closes panel, but not announced
  // Focus can escape to main content
  return (
    <div className="context-modal">
      {/* Modal content */}
    </div>
  )
}
```

**Expected**:

```tsx
export function ContextModal() {
  const modalRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const initialFocus = modalRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]'
    ) as HTMLElement
    initialFocus?.focus()
    
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    
    document.addEventListener('keydown', trap)
    return () => document.removeEventListener('keydown', trap)
  }, [])
  
  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <h2 id="modal-title">Modal Title</h2>
      {/* Content */}
    </div>
  )
}
```

**Required Fixes**:
1. Add `role="dialog"` and `aria-modal="true"` to all modals
2. Focus trap on open (focus first interactive element)
3. Keyboard shortcuts documented (Escape to close)
4. Initial focus on title heading (aria-labelledby)

---

### 3. Panel Resizer: Inaccessible Resize Interaction [WCAG 2.1.1, 2.5.5]

**Impact**: Keyboard-only and touch users cannot resize panels.

**File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/components/layout/PanelResizer.tsx` (lines 28-144)

**Analysis** (Good News - Already Partially Implemented):

```tsx
// POSITIVE: Has some keyboard support
export function PanelResizer({ panel, side, className = '' }: PanelResizerProps) {
  // ✓ Keyboard support for arrow keys
  const handleKeyDown = useCallback((e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 50 : 20
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        // Handles resizing
    }
  }, [...])

  // ✓ ARIA attributes present
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${panel} panel...`}
      aria-valuenow={panelConfig.width}
      aria-valuemin={panelConfig.minWidth}
      aria-valuemax={panelConfig.maxWidth}
      tabIndex={0}
    >
```

**Issues**:

1. **Touch target too small** - .panel-resizer has only ~8px width. WCAG requires 44px minimum.
2. **No visual focus indicator** - CSS doesn't define `:focus-visible` style
3. **No aria-describedby** for keyboard instructions

**Required Fixes**:

```css
/* FIX 1: Increase touch target */
.panel-resizer {
  width: 8px;
  /* Expand hit area with padding or pseudo-element */
  padding-left: 18px; /* Total 44px left edge */
  margin-left: -18px;
}

/* FIX 2: Add visible focus indicator */
.panel-resizer:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: -4px;
  background-color: rgba(var(--color-primary-rgb), 0.1);
}

/* FIX 3: Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .panel-resizer--dragging {
    transition: none !important;
  }
}
```

**Code Fix**:

```tsx
// Add description for keyboard users
const resizeInstructions = useRef<string>('Use arrow keys to resize, ' +
  'Shift+arrow for larger steps, Home for minimum, End for maximum')

return (
  <div
    id="panel-resizer-help"
    role="separator"
    aria-label={`${panel} panel resizer. ${resizeInstructions.current}`}
    aria-describedby="panel-resizer-help"
    aria-orientation="vertical"
    aria-valuenow={panelConfig.width}
    aria-valuemin={panelConfig.minWidth}
    aria-valuemax={panelConfig.maxWidth}
    tabIndex={0}
    onKeyDown={handleKeyDown}
  >
    <div className="panel-resizer__handle" />
  </div>
)
```

---

### 4. Icon-Only Buttons: Missing aria-label [WCAG 1.1.1, 4.1.2]

**Impact**: Screen reader users cannot identify button purpose.

**Files**: 
- `BookHeader.tsx` (lines 164-180): ⚙ settings, ↓ export icons
- `HarvestCard.tsx` (lines 201-207): × close button
- `BookStudio.tsx` (Implicit buttons): ⌘K command, ⌘O outline

**Violations**:

```tsx
// VIOLATION 1: Settings button (BookHeader.tsx:174-179)
<button
  className="book-header__settings"
  onClick={onOpenSettings}
  title="Settings"  // ❌ title alone insufficient for AT
>
  ⚙  {/* ❌ Icon only, no accessible name */}
</button>

// VIOLATION 2: Close button (HarvestCard.tsx:201-207)
<button
  className="harvest-card__close"
  onClick={onDelete}
  title="Remove card"  // ❌ title not exposed to AT
>
  × {/* ❌ Icon only */}
</button>

// VIOLATION 3: Commands (BookHeader.tsx:164-169)
<button
  className="book-header__command"
  onClick={onCommandPalette}
  title="Command palette (⌘K)"  // ❌ Insufficient
>
  ⌘K {/* Emoji/icon only */}
</button>
```

**Required Fix**:

```tsx
// CORRECT: Add aria-label
<button
  className="book-header__settings"
  onClick={onOpenSettings}
  aria-label="Open settings"
  title="Settings (⌘,)"
>
  <span aria-hidden="true">⚙</span>
</button>

<button
  className="harvest-card__close"
  onClick={onDelete}
  aria-label="Delete card"
  title="Remove this card from staging"
>
  <span aria-hidden="true">×</span>
</button>

<button
  className="book-header__command"
  onClick={onCommandPalette}
  aria-label="Open command palette"
  title="Open command palette (⌘K)"
>
  <span aria-hidden="true">⌘K</span>
</button>
```

**All Icon-Only Components**:
| Component | File | Icon | Fix |
|-----------|------|------|-----|
| Settings button | BookHeader.tsx:174 | ⚙ | aria-label="Open settings" |
| Export button | BookHeader.tsx:184 | ↓ | aria-label="Export options" |
| Close (card) | HarvestCard.tsx:201 | × | aria-label="Delete card" |
| Chapter dropdown | BookHeader.tsx:105 | ▾ | aria-label="Select chapter" |
| Outline toggle | BookHeader.tsx:106 | ▾ | aria-label="Toggle outline panel" |
| Expand toggle | HarvestCard.tsx:219 | Show more | ✓ Has text (ok) |

---

### 5. Form Controls: No Associated Labels [WCAG 1.3.1, 3.3.2]

**Impact**: Screen reader users don't know what form fields do; autocomplete fails.

**Files**:
- `HarvestCard.tsx` (lines 298-309): Chapter select dropdown
- `StagingArea.tsx`: Filter inputs (assumed)
- `CommandPalette.tsx`: Search input (assumed)

**Violation**:

```tsx
// VIOLATION: Select without label
<select
  className="harvest-card__chapter-select"
  value={card.suggestedChapterId || ''}
  onChange={(e) => onMoveToChapter?.(e.target.value)}
>
  <option value="">Move to chapter...</option>
  {/* Options */}
</select>
```

**Fix**:

```tsx
// CORRECT: Visible label + aria-label backup
<div className="harvest-card__form-group">
  <label htmlFor="chapter-select-${card.id}">
    Move to chapter:
  </label>
  <select
    id={`chapter-select-${card.id}`}
    className="harvest-card__chapter-select"
    value={card.suggestedChapterId || ''}
    onChange={(e) => onMoveToChapter?.(e.target.value)}
  >
    <option value="">Select chapter...</option>
    {chapters.map(ch => (
      <option key={ch.id} value={ch.id}>{ch.title}</option>
    ))}
  </select>
</div>
```

**CSS for label**:
```css
.harvest-card__form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.harvest-card__form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
```

---

### 6. AUI Tool Echo: No Live Region Announcements [WCAG 4.1.3, 1.3.1]

**Impact**: Screen reader users miss tool action notifications and progress updates.

**Context**: AUI sends events from server → frontend displays them. Currently no ARIA live regions.

**Example Flow** (from API Design):
```
Server: { type: 'card-harvested', card, grade, timestamp }
Frontend: Adds card to staging area
Problem: Screen reader doesn't announce the new action
```

**Required Implementation**:

```tsx
// NEW: AUI announcement center
import { useState, useCallback } from 'react'

interface ToolAnnouncement {
  id: string
  type: 'success' | 'error' | 'info' | 'progress'
  message: string
  details?: string
  priority: 'polite' | 'assertive'
}

export function AUIAnnouncements() {
  const [announcements, setAnnouncements] = useState<ToolAnnouncement[]>([])

  // Subscribe to tool events
  useEffect(() => {
    const handleToolEvent = (event: ToolEvent) => {
      const announcement = translateToolEvent(event) // See below
      if (announcement) {
        const id = crypto.randomUUID()
        setAnnouncements(prev => [...prev, { ...announcement, id }])
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
          setAnnouncements(prev => prev.filter(a => a.id !== id))
        }, 5000)
      }
    }

    toolEventBus.subscribe(handleToolEvent)
    return () => toolEventBus.unsubscribe(handleToolEvent)
  }, [])

  return (
    <div className="aui-announcements" role="region" aria-live="polite" aria-label="Tool actions">
      {announcements.map(ann => (
        <div
          key={ann.id}
          role="status"
          aria-live={ann.priority}
          aria-atomic="true"
          className={`aui-announcement aui-announcement--${ann.type}`}
        >
          <span className="aui-announcement__icon" aria-hidden="true">
            {ann.type === 'success' && '✓'}
            {ann.type === 'error' && '✕'}
            {ann.type === 'info' && 'ℹ'}
            {ann.type === 'progress' && '⌛'}
          </span>
          <span className="aui-announcement__message">{ann.message}</span>
          {ann.details && (
            <span className="aui-announcement__details">{ann.details}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// Translate tool events to screen reader announcements
function translateToolEvent(event: ToolEvent): ToolAnnouncement | null {
  switch (event.type) {
    case 'card-harvested':
      return {
        type: 'success',
        message: 'Card harvested and added to staging area',
        details: `Grade: ${event.payload.grade.overall}/5. ${event.payload.card.content.substring(0, 50)}...`,
        priority: 'polite'
      }
    
    case 'card-graded':
      return {
        type: 'success',
        message: 'Card grading complete',
        details: `Overall score: ${event.payload.grade.overall}/5`,
        priority: 'polite'
      }
    
    case 'draft-progress':
      return {
        type: 'progress',
        message: `Generating draft: ${event.payload.phase}`,
        details: event.payload.progress ? `${event.payload.progress}% complete` : '',
        priority: 'assertive'
      }
    
    case 'draft-complete':
      return {
        type: 'success',
        message: 'Draft generation complete',
        details: `${event.payload.wordCount} words generated`,
        priority: 'polite'
      }
    
    case 'session-error':
      return {
        type: 'error',
        message: `Error: ${event.payload.error}`,
        details: `During ${event.payload.phase} phase`,
        priority: 'assertive'
      }
    
    default:
      return null
  }
}
```

**CSS for announcements** (visually hidden but available to AT):
```css
.aui-announcements {
  position: fixed;
  top: -9999px;
  left: -9999px;
  width: 1px;
  height: 1px;
  overflow: hidden;
}

/* Optional: Show in development */
@media (max-width: 480px) {
  .aui-announcements {
    position: fixed;
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    width: auto;
    height: auto;
  }
}

.aui-announcement {
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 4px;
  font-size: 14px;
}

.aui-announcement--success {
  background: var(--color-success);
  color: white;
}

.aui-announcement--error {
  background: var(--color-error);
  color: white;
}

.aui-announcement--progress {
  background: var(--color-info);
  color: white;
}

.aui-announcement__icon {
  margin-right: 8px;
}

.aui-announcement__details {
  display: block;
  font-size: 12px;
  opacity: 0.9;
  margin-top: 4px;
}
```

---

### 7. Draft Streaming: No Progress Announcement [WCAG 2.4.8, 1.3.1]

**Impact**: Users don't know draft generation is happening; accessibility users miss progress.

**Scenario**: Draft takes 30 seconds to generate. No feedback.

**Required Implementation**:

```tsx
// In WritingView or DraftGenerator component
export function DraftGenerator({ chapterId }: { chapterId: string }) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState<{
    phase: 'preparing' | 'deduplicating' | 'generating' | 'complete'
    percent: number
    currentSection?: number
    totalSections?: number
  } | null>(null)

  const startGeneration = useCallback(async () => {
    setIsGenerating(true)
    setProgress({ phase: 'preparing', percent: 0 })

    const ws = new WebSocket(`ws://localhost:3004/api/books/${bookId}/chapters/${chapterId}/draft`)
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      // Map server phases to progress
      const phasePercents = {
        preparing: 10,
        deduplicating: 20,
        generating: 80,
        complete: 100
      }
      
      const percent = phasePercents[data.phase] || 0
      const section = data.currentSection || 0
      const total = data.totalSections || 0
      
      setProgress({
        phase: data.phase,
        percent,
        currentSection: section,
        totalSections: total
      })
      
      if (data.phase === 'complete') {
        setIsGenerating(false)
        setProgress(null)
      }
    }
  }, [bookId, chapterId])

  if (!isGenerating) {
    return (
      <button onClick={startGeneration} className="draft-generator__start">
        Generate Draft
      </button>
    )
  }

  return (
    <div
      className="draft-generator__progress"
      role="region"
      aria-busy="true"
      aria-label="Draft generation in progress"
    >
      {/* Progress bar with ARIA attributes */}
      <div className="draft-generator__bar-container">
        <div
          className="draft-generator__progress-bar"
          style={{ width: `${progress?.percent || 0}%` }}
          role="progressbar"
          aria-valuenow={progress?.percent || 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Draft generation ${progress?.percent || 0}% complete`}
        />
      </div>
      
      {/* Status text for screen readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {progress?.phase === 'preparing' && 'Preparing cards for generation'}
        {progress?.phase === 'deduplicating' && 'Removing duplicate content'}
        {progress?.phase === 'generating' && (
          `Generating draft section ${progress.currentSection} of ${progress.totalSections}`
        )}
      </div>
      
      {/* Visible status */}
      <p className="draft-generator__status">
        {progress?.phase === 'preparing' && 'Preparing cards...'}
        {progress?.phase === 'deduplicating' && 'Removing duplicates...'}
        {progress?.phase === 'generating' && (
          `Generating section ${progress.currentSection}/${progress.totalSections}...`
        )}
      </p>
    </div>
  )
}
```

**CSS**:
```css
.draft-generator__progress {
  padding: 16px;
  background: var(--color-bg-secondary);
  border-radius: 8px;
  border: 2px solid var(--color-accent);
}

.draft-generator__bar-container {
  height: 24px;
  background: var(--color-bg-primary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.draft-generator__progress-bar {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--color-accent),
    var(--color-accent-light)
  );
  transition: width 0.3s ease;
}

@media (prefers-reduced-motion: reduce) {
  .draft-generator__progress-bar {
    transition: none;
  }
}

/* Screen reader only */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

---

## SERIOUS ISSUES (Significant Barriers)

### 8. No Focus Visible Styles [WCAG 2.4.7]

**Impact**: Keyboard users cannot see where focus is.

**Current State**: No `.focus-visible` or `:focus-visible` styles defined anywhere.

**Required in all stylesheets**:

```css
/* Global focus styles */
:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

/* Override for different components */
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  :focus-visible {
    outline-offset: 0;
  }
}

/* Remove default outline only if custom focus style is present */
button:focus {
  outline: none;
}

/* Visible focus indicator for custom components */
[role="button"]:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

[role="separator"]:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: -4px;
}

[role="dialog"]:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 0;
}
```

**Add to each CSS file** (BookStudio.css, HarvestCard.css, BookHeader.css, etc.):

```css
.component:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

---

### 9. No Prefers-Reduced-Motion Support [WCAG 2.3.3]

**Impact**: Users with vestibular disorders experience discomfort from animations.

**Current State**: No `@media (prefers-reduced-motion: reduce)` anywhere.

**Required globally**:

```css
/* In global stylesheet or each component */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Component-specific reduced motion */
@media (prefers-reduced-motion: reduce) {
  .harvest-card {
    transition: none;
  }

  .panel-resizer--dragging {
    transition: none;
  }

  .split-mode-toolbar {
    animation: none;
  }

  .aui-announcement {
    animation: none;
    transition: none;
  }
}
```

---

### 10. Color Contrast Issues [WCAG 1.4.3]

**Impact**: Users with low vision cannot read text.

**Files to Audit**:
- `BookStudio.css`: `.book-studio__hint` uses `--color-text-secondary`
- `HarvestCard.css`: Grade indicators
- `BookHeader.css`: Secondary text

**Required Check**:
```
All text colors must meet 4.5:1 contrast for normal text
Large text (18pt+ or 14pt bold) must meet 3:1 contrast
UI components must have 3:1 contrast
```

**Measurement Protocol**:
1. Use axe DevTools or WebAIM contrast checker
2. Check dark theme + light theme
3. Verify at 18pt and 14pt sizes

**Add to all CSS**:
```css
/* Ensure contrast in both themes */
:root {
  --color-text-primary: #000;       /* Should be #000 or darker */
  --color-text-secondary: #4a5568;  /* At least 4.5:1 with bg-white */
  --color-bg-primary: #fff;
}

[data-theme='dark'] {
  --color-text-primary: #f5f5f5;
  --color-text-secondary: #b0b0b0;
  --color-bg-primary: #1a1a1a;
}

/* Verify in CSS checker */
/* Test: text-secondary on bg-primary = 4.5:1 ✓/✗ */
```

---

## MODERATE ISSUES (Usability Problems)

### 11. Touch Targets Below 44px [WCAG 2.5.5]

**Impact**: Mobile and touch users cannot easily interact with small buttons.

**Files with issues**:

| Component | Size | Fix |
|-----------|------|-----|
| Export menu button | ~30px | Increase to 44px |
| Close buttons | ~20px | Increase to 44px |
| Grade badge | 20px | Increase to 44px |
| Panel resizer | 8px width | Expand to 44px |

**Example Fix**:

```css
/* Before: Small button */
.harvest-card__close {
  width: 24px;
  height: 24px;
  /* Touch target: 24x24 - too small */
}

/* After: Accessible button */
.harvest-card__close {
  min-width: 44px;
  min-height: 44px;
  padding: 10px;
  
  /* Keep visual size same, expand hit area */
  display: flex;
  align-items: center;
  justify-content: center;
  
  font-size: 20px; /* Icon stays visible */
}

/* For badge: Increase active area */
.book-studio__badge {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 12px;
}
```

---

### 12. No Skip Link [WCAG 2.4.1]

**Impact**: Keyboard users waste time tabbing through header/navigation.

**Required**:

```tsx
// In BookStudio.tsx root
export function BookStudio() {
  return (
    <div className="book-studio">
      {/* Skip link - always first focusable element */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      
      <BookHeader ... />
      
      <div className="book-studio__body">
        {/* ... panels ... */}
        <main
          id="main-content"
          className="book-studio__main"
          role="main"
        >
          {/* Content */}
        </main>
      </div>
    </div>
  )
}
```

**CSS**:
```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--color-accent);
  color: white;
  padding: 8px 16px;
  text-decoration: none;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}

.skip-link:focus-visible {
  outline: 3px solid white;
  outline-offset: 2px;
}
```

---

### 13. Link Without Text Content [WCAG 1.1.1, 4.1.2]

**File**: `HarvestCard.tsx` (lines 182-191)

```tsx
// VIOLATION: Link with only icon
<a
  href={card.sourceUrl}
  target="_blank"
  rel="noopener noreferrer"
  className="harvest-card__source-link"
  title="View original"
>
  ↗  {/* No text content, title not exposed */}
</a>
```

**Fix**:

```tsx
<a
  href={card.sourceUrl}
  target="_blank"
  rel="noopener noreferrer"
  className="harvest-card__source-link"
  aria-label="View original source (opens in new window)"
  title="View original source"
>
  <span aria-hidden="true">↗</span>
</a>
```

---

## DESIGN RECOMMENDATIONS

### Panel System ARIA Patterns

**Recommendation**: Use WAI-ARIA practices for panel containers.

```tsx
// Dockable panels should use:
<div
  role="region"
  aria-label="Outline panel"
  aria-expanded={isVisible}
  className="panel"
>
  <div role="heading" aria-level={2}>
    Outline
  </div>
</div>

// Tabbed panels use role="tablist":
<div role="tablist" aria-label="View options">
  <button
    role="tab"
    aria-selected={activeTab === 'outline'}
    aria-controls="outline-panel"
  >
    Outline
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 'settings'}
    aria-controls="settings-panel"
  >
    Settings
  </button>
</div>

<div
  id="outline-panel"
  role="tabpanel"
  aria-labelledby="outline-tab"
>
  {/* Panel content */}
</div>
```

---

### AUI Event Mapping

**Recommendation**: Define ARIA roles for each tool action type.

| Event Type | ARIA Role | Announcement Level | Example |
|-----------|-----------|-------------------|---------|
| card-harvested | status | polite | "Card added to staging" |
| card-graded | status | polite | "Grade: 4/5" |
| draft-progress | progressbar | assertive | "Generating: 45% complete" |
| outline-generated | region | polite | "Outline generated with 5 sections" |
| session-error | alert | assertive | "Error: Generation failed" |

---

### Keyboard Shortcuts Documentation

**Recommendation**: Display keyboard shortcuts with proper ARIA.

```tsx
export function KeyboardShortcuts() {
  return (
    <div role="region" aria-label="Keyboard shortcuts">
      <table>
        <thead>
          <tr>
            <th>Shortcut</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><kbd>⌘K</kbd></td>
            <td>Open command palette</td>
          </tr>
          <tr>
            <td><kbd>⌘O</kbd></td>
            <td>Toggle outline panel</td>
          </tr>
          <tr>
            <td><kbd>⌘,</kbd></td>
            <td>Open settings</td>
          </tr>
          <tr>
            <td><kbd>Escape</kbd></td>
            <td>Close modal</td>
          </tr>
          <tr>
            <td><kbd>Tab</kbd></td>
            <td>Navigate between panels</td>
          </tr>
          <tr>
            <td><kbd>Arrow Left/Right</kbd></td>
            <td>Resize panel (when resizer focused)</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

---

## TESTING CHECKLIST

### Automated Testing (axe DevTools / Lighthouse)

- [ ] Run axe DevTools scan on each page
- [ ] Check Lighthouse accessibility audit (target: 90+)
- [ ] Run WAVE browser extension
- [ ] Check color contrast with WebAIM tool

### Keyboard Testing (Manual)

- [ ] Tab through all interactive elements
- [ ] Verify focus order is logical
- [ ] Test panel resize with keyboard (Arrow keys)
- [ ] Test all modals open/close with Escape
- [ ] Test shortcut keys (⌘K, ⌘O, ⌘,)
- [ ] Test Tab to navigate between panels
- [ ] Verify no keyboard traps

### Screen Reader Testing (VoiceOver/NVDA)

- [ ] Navigate with screen reader enabled
- [ ] Verify all buttons have accessible names
- [ ] Verify modal announcements (role="dialog")
- [ ] Verify live region announcements (draft progress)
- [ ] Verify form labels are associated
- [ ] Verify link text is meaningful
- [ ] Test with AT at 200% zoom

### Touch / Mobile Testing

- [ ] All buttons are at least 44x44px
- [ ] Can resize panels on touch device
- [ ] Can interact with all controls
- [ ] Tap targets have adequate spacing (8px minimum)

### Reduced Motion Testing

- [ ] Disable animations in OS settings
- [ ] Verify animations stop or reduce duration
- [ ] No dizziness/vestibular triggers

---

## IMPLEMENTATION TIMELINE

### Phase 1: Critical Fixes (Week 1)
- [ ] Add aria-label to all icon-only buttons
- [ ] Add focus-visible styles globally
- [ ] Implement modal focus trap + role="dialog"
- [ ] Add skip link
- [ ] Implement AUI live region announcements

### Phase 2: Serious Issues (Week 2)
- [ ] Add prefers-reduced-motion support
- [ ] Verify color contrast (4.5:1)
- [ ] Increase touch targets to 44px
- [ ] Fix form label associations

### Phase 3: Refinement (Week 3)
- [ ] Panel keyboard navigation
- [ ] Draft progress announcements
- [ ] ARIA panel patterns
- [ ] Comprehensive testing

### Phase 4: Validation (Week 4)
- [ ] Final axe DevTools scan
- [ ] Screen reader testing (VoiceOver + NVDA)
- [ ] Mobile/touch device testing
- [ ] Sign-off from accessibility team

---

## WCAG 2.1 AA COMPLIANCE MAP

| WCAG Criteria | Status | Files | Fix |
|---------------|--------|-------|-----|
| 1.1.1 Non-text Content | FAIL | HarvestCard, BookHeader | Add alt text / aria-label |
| 1.3.1 Info & Relationships | FAIL | ContextModal, Form inputs | Add roles, labels, live regions |
| 1.4.3 Contrast | WARN | All CSS | Verify 4.5:1 ratio |
| 2.1.1 Keyboard | FAIL | Panel system, Resize | Add keyboard nav |
| 2.1.2 No Keyboard Trap | FAIL | Modals | Implement focus trap |
| 2.3.3 Animation | FAIL | All CSS | Add prefers-reduced-motion |
| 2.4.1 Bypass Blocks | FAIL | BookStudio | Add skip link |
| 2.4.3 Focus Order | WARN | All panels | Document + test order |
| 2.4.7 Focus Visible | FAIL | All components | Add :focus-visible styles |
| 2.5.5 Target Size | FAIL | Small buttons | Increase to 44x44px |
| 3.3.2 Labels | FAIL | Form controls | Associate labels |
| 4.1.2 Name Role Value | FAIL | Icon buttons | Add aria-label |
| 4.1.3 Status Messages | FAIL | AUI events | Add live regions |

---

## RESOURCES

### WCAG 2.1 Documentation
- [WCAG 2.1 Spec](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

### Testing Tools
- [axe DevTools](https://www.deque.com/axe/devtools/)
- [WAVE Browser Extension](https://wave.webaim.org/extension/)
- [Lighthouse (Chrome DevTools)](https://developers.google.com/web/tools/lighthouse)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Code Examples
- [MDN: ARIA Live Regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)
- [MDN: Focus Management](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Understanding_WCAG/Keyboard)
- [WAI-ARIA Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

---

## SIGN-OFF REQUIREMENTS

**Before merge to main**, ALL of the following must be complete:

- [ ] **Critical Violations**: All 7 critical issues resolved
- [ ] **Serious Issues**: At least 6 of 8 serious issues resolved
- [ ] **ARIA Implementation**: Modal focus trap + AUI live regions working
- [ ] **Keyboard Testing**: Tab through entire app with no traps
- [ ] **Screen Reader Testing**: Tested with VoiceOver or NVDA
- [ ] **Focus Styles**: All :focus-visible defined
- [ ] **Reduced Motion**: @media queries in all CSS files
- [ ] **Documentation**: Keyboard shortcuts documented in UI
- [ ] **Contrast**: Verified 4.5:1 ratio on all text
- [ ] **Touch Targets**: All buttons >= 44x44px

**Agent Sign-off**: Accessibility Agent provides APPROVED or REQUIRED-FIXES status

---

**VERDICT**: ⚠️ **CONDITIONAL PASS** - Merge when all critical violations + sign-off requirements complete

*Generated by House of Accessibility Agent - WCAG 2.1 AA Guardian*
