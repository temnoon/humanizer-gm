# AUI (Agent UI) Announcements Accessibility Design
**Agent Tool Echo Display with Screen Reader Support**  
**Date**: January 16, 2026  
**WCAG Criterion**: 4.1.3 Status Messages, 1.3.1 Info & Relationships

---

## OVERVIEW

AUI (Agent User Interface) broadcasts tool actions from the server to the frontend. These events trigger UI state changes that must be announced to screen reader users in real-time.

**Example flow**:
1. User clicks "Harvest Card" button
2. Card added to staging area with quick grade
3. Server: `{ type: 'card-harvested', card, grade }`
4. Frontend: Announces to screen reader
5. User hears: "Card harvested and added to staging area. Grade: 4 out of 5."

---

## LIVE REGION ARCHITECTURE

### Central Announcement Hub
```tsx
// Context for announcing tool events
export const AnnounceContext = createContext<{
  announce: (message: string, level?: 'polite' | 'assertive') => void
} | null>(null)

export function AnnounceProvider({ children }: { children: React.ReactNode }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  const announce = useCallback(
    (message: string, level: 'polite' | 'assertive' = 'polite') => {
      const id = crypto.randomUUID()
      const announcement: Announcement = { id, message, level, timestamp: Date.now() }
      
      setAnnouncements(prev => [...prev, announcement])
      
      // Remove after announcement read (~3 seconds)
      setTimeout(() => {
        setAnnouncements(prev => prev.filter(a => a.id !== id))
      }, 3000)
    },
    []
  )

  return (
    <AnnounceContext.Provider value={{ announce }}>
      {children}
      <AnnounceRegion announcements={announcements} />
    </AnnounceContext.Provider>
  )
}

// Live regions for each priority level
function AnnounceRegion({ announcements }: { announcements: Announcement[] }) {
  const politeAnnouncements = announcements.filter(a => a.level === 'polite')
  const assertiveAnnouncements = announcements.filter(a => a.level === 'assertive')

  return (
    <>
      {/* Polite announcements (non-urgent) */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {politeAnnouncements.map(a => (
          <div key={a.id}>{a.message}</div>
        ))}
      </div>

      {/* Assertive announcements (urgent/errors) */}
      <div
        className="sr-only"
        role="alert"
        aria-atomic="true"
      >
        {assertiveAnnouncements.map(a => (
          <div key={a.id}>{a.message}</div>
        ))}
      </div>
    </>
  )
}

// Usage hook
export function useAnnounce() {
  const context = useContext(AnnounceContext)
  if (!context) {
    throw new Error('useAnnounce must be used within AnnounceProvider')
  }
  return context.announce
}
```

---

## TOOL EVENT TRANSLATIONS

### Event Type Mapping

| Tool Event | Screen Reader Announcement | Priority | Example |
|------------|---------------------------|----------|---------|
| card-harvested | "{count} card added to staging" | polite | "Card added to staging area" |
| card-graded | "Card grading complete: {score}/5" | polite | "Grade: 4 out of 5 - Authenticity good" |
| card-clustered | "{count} cards grouped" | polite | "15 cards grouped into 3 clusters" |
| outline-researched | "Research complete: {themes} themes" | polite | "Found 5 themes and 3 narrative arcs" |
| outline-reviewed | "Outline review: {coverage}% coverage" | polite | "Coverage: 85% - All major themes included" |
| outline-generated | "Outline generated: {sections} sections" | polite | "Outline generated with 7 sections" |
| draft-progress | "Generating draft: {phase} - {percent}%" | assertive | "Generating draft: 45% complete" |
| draft-complete | "Draft complete: {words} words" | polite | "Draft generated: 2,847 words" |
| session-error | "Error: {message}" | assertive | "Error: Generation failed - Connection lost" |
| session-cancelled | "Operation cancelled" | polite | "Outline generation cancelled" |

### Event Handler Implementation

```tsx
// Subscribe to tool events and translate to announcements
export function useToolEventAnnouncements() {
  const announce = useAnnounce()

  useEffect(() => {
    const handleToolEvent = (event: ToolEvent) => {
      const { type, payload, timestamp } = event

      switch (type) {
        case 'card-harvested': {
          const message = `Card harvested and added to staging area. ` +
            `Title: "${payload.card.title || 'Untitled'}". ` +
            `Initial grade: ${payload.grade.overall} out of 5.`
          announce(message, 'polite')
          break
        }

        case 'card-graded': {
          const { grade } = payload
          const details = [
            `Overall: ${grade.overall}/5`,
            grade.authenticity && `Authenticity: ${grade.authenticity}/5`,
            grade.necessity && `Necessity: ${grade.necessity}/5`,
          ].filter(Boolean).join('. ')
          
          const message = `Card grading complete. ${details}.`
          announce(message, 'polite')
          break
        }

        case 'card-clustered': {
          const { clusters } = payload
          const totalCards = clusters.reduce((sum, c) => sum + c.cards.length, 0)
          const message = `${totalCards} cards grouped into ${clusters.length} ` +
            `clusters. Largest cluster: ${Math.max(...clusters.map(c => c.cards.length))} cards.`
          announce(message, 'polite')
          break
        }

        case 'outline-researched': {
          const { research } = payload
          const message = `Research complete. ` +
            `Found ${research.themes.length} themes, ` +
            `${research.narrativeArcs.length} narrative arcs, ` +
            `${research.suggestedSections.length} suggested sections.`
          announce(message, 'polite')
          break
        }

        case 'outline-reviewed': {
          const { review } = payload
          const coverage = Math.round(review.overallCoverage * 100)
          const feasible = review.feasibleItems.length
          const uncovered = review.uncoveredItems.length
          
          const message = `Outline review complete. ` +
            `Coverage: ${coverage}% of themes. ` +
            `Feasible items: ${feasible}. ` +
            `Uncovered items: ${uncovered}.`
          announce(message, 'polite')
          break
        }

        case 'outline-generated': {
          const { outline } = payload
          const sections = countSections(outline.structure)
          const message = `Outline generated with ${sections} sections. ` +
            `Confidence: ${Math.round(outline.confidence * 100)}%.`
          announce(message, 'polite')
          break
        }

        case 'draft-progress': {
          const { phase, progress, currentSection, totalSections } = payload
          
          let message = `Generating draft: ${phase}.`
          if (progress) message += ` ${progress}% complete.`
          if (currentSection && totalSections) {
            message += ` Section ${currentSection} of ${totalSections}.`
          }
          
          // Only announce every 25% to avoid spam
          if (progress && progress % 25 === 0) {
            announce(message, 'assertive')
          }
          break
        }

        case 'draft-complete': {
          const { content, wordCount } = payload
          const message = `Draft generation complete. ` +
            `Generated ${wordCount} words.`
          announce(message, 'polite')
          break
        }

        case 'session-error': {
          const { error, phase } = payload
          const message = `Error during ${phase}: ${error}`
          announce(message, 'assertive')
          break
        }

        case 'session-cancelled': {
          const message = `Operation cancelled.`
          announce(message, 'polite')
          break
        }
      }
    }

    // Subscribe to WebSocket events
    toolEventBus.subscribe(handleToolEvent)
    return () => toolEventBus.unsubscribe(handleToolEvent)
  }, [announce])
}

// Helper to count sections in outline
function countSections(outline: OutlineStructure): number {
  if (outline.type === 'numbered') {
    return outline.items.length
  }
  // Add other outline types as needed
  return 0
}
```

---

## CONTEXTUAL ANNOUNCEMENTS

### Progressive Disclosure
For long operations, provide incremental announcements:

```tsx
// Draft generation: Announce phase changes
export function DraftProgressAnnouncer() {
  const announce = useAnnounce()
  const [lastPhase, setLastPhase] = useState<string | null>(null)

  useEffect(() => {
    const handleDraftProgress = (event: DraftProgressEvent) => {
      // Only announce when phase changes
      if (event.phase !== lastPhase) {
        let announcement = ''

        switch (event.phase) {
          case 'preparing':
            announcement = 'Preparing cards for draft generation.'
            break
          case 'deduplicating':
            announcement = `Removing duplicates. Found ${event.payload.removed} duplicates.`
            break
          case 'generating':
            announcement = `Starting draft generation. Generating section 1 of ${event.payload.totalSections}.`
            break
          case 'complete':
            announcement = `Draft complete. Generated ${event.payload.wordCount} words in ${event.payload.duration}s.`
            break
        }

        if (announcement) {
          announce(announcement, event.phase === 'complete' ? 'polite' : 'assertive')
          setLastPhase(event.phase)
        }
      }
    }

    toolEventBus.subscribe(handleDraftProgress)
    return () => toolEventBus.unsubscribe(handleDraftProgress)
  }, [lastPhase, announce])

  return null
}
```

### Card Batch Operations
When multiple cards are affected:

```tsx
// Announce batch card operations
const handleBatchHarvest = (cards: SearchResult[]) => {
  const announce = useAnnounce()
  
  // Initial announcement
  announce(`Harvesting ${cards.length} cards...`, 'assertive')
  
  // Track completions
  let completed = 0
  const announceProgress = () => {
    completed++
    if (completed % 5 === 0) {
      announce(`${completed} of ${cards.length} cards processed.`, 'polite')
    }
  }

  // After all complete
  const announceComplete = () => {
    announce(`${cards.length} cards harvested and added to staging.`, 'polite')
  }
}
```

---

## VISUAL + AUDIO FEEDBACK

### Optional Toast Notifications (Visible + Spoken)
```tsx
// Enhanced announcements with optional visual feedback
interface VisibleAnnouncement {
  id: string
  type: 'success' | 'error' | 'info' | 'progress'
  message: string
  details?: string
  priority: 'normal' | 'high'
  duration?: number
}

export function AnnounceRegionWithVisuals({
  announcements,
  showVisually = false,
}: {
  announcements: Announcement[]
  showVisually?: boolean
}) {
  // Screen reader only
  const politeAnnouncements = announcements.filter(a => a.level === 'polite')
  const assertiveAnnouncements = announcements.filter(a => a.level === 'assertive')

  return (
    <>
      {/* Live regions for AT */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {politeAnnouncements.map(a => (
          <div key={a.id}>{a.message}</div>
        ))}
      </div>

      <div
        className="sr-only"
        role="alert"
        aria-atomic="true"
      >
        {assertiveAnnouncements.map(a => (
          <div key={a.id}>{a.message}</div>
        ))}
      </div>

      {/* Optional visual toast (if enabled) */}
      {showVisually && (
        <div className="toast-container">
          {announcements.map(a => (
            <Toast
              key={a.id}
              message={a.message}
              level={a.level}
              autoClose={3000}
            />
          ))}
        </div>
      )}
    </>
  )
}

// Toast component with ARIA
function Toast({
  message,
  level,
  autoClose,
}: {
  message: string
  level: 'polite' | 'assertive'
  autoClose?: number
}) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (!autoClose) return
    const timer = setTimeout(() => setIsVisible(false), autoClose)
    return () => clearTimeout(timer)
  }, [autoClose])

  if (!isVisible) return null

  return (
    <div
      className={`toast toast--${level === 'assertive' ? 'error' : 'info'}`}
      role={level === 'assertive' ? 'alert' : 'status'}
      aria-live={level}
    >
      <span className="toast__icon" aria-hidden="true">
        {level === 'assertive' ? '✕' : '✓'}
      </span>
      <span className="toast__message">{message}</span>
    </div>
  )
}
```

**CSS**:
```css
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 4px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: slideIn 0.3s ease-out;
}

.toast--error {
  border-color: var(--color-error);
  background: var(--color-error-light);
  color: var(--color-error);
}

.toast--info {
  border-color: var(--color-success);
  background: var(--color-success-light);
  color: var(--color-success);
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
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

## PRIORITY LEVELS & TIMING

### Polite (Non-Urgent)
- Card harvest/grade updates
- Outline generation complete
- Research findings
- Success messages

**aria-live="polite"** - Won't interrupt current screen reader output

```tsx
announce('Card graded: 4/5 authenticity', 'polite')
// User hears after current sentence finishes
```

### Assertive (Urgent)
- Draft generation progress (25% increments)
- Errors/failures
- Cancellations
- Important state changes

**role="alert"** - Interrupts current output immediately

```tsx
announce('Error: Generation failed', 'assertive')
// User hears immediately, may interrupt other speech
```

---

## ANNOUNCEMENT THROTTLING

Prevent announcement spam during rapid updates:

```tsx
export function useThrottledAnnounce() {
  const announce = useAnnounce()
  const throttledRef = useRef<{
    eventType: string
    lastTime: number
  }>()

  const announceSafely = useCallback(
    (message: string, eventType: string, level: 'polite' | 'assertive' = 'polite') => {
      const now = Date.now()
      
      // Skip if we announced this event type recently
      if (
        throttledRef.current?.eventType === eventType &&
        now - throttledRef.current.lastTime < 1000 // 1 second throttle
      ) {
        return
      }

      announce(message, level)
      throttledRef.current = { eventType, lastTime: now }
    },
    [announce]
  )

  return announceSafely
}
```

**Usage**:
```tsx
const announce = useThrottledAnnounce()

// Won't announce multiple times within 1 second for same event
announce(`Progress: 25%`, 'draft-progress', 'assertive')
announce(`Progress: 50%`, 'draft-progress', 'assertive') // Skipped
announce(`Progress: 75%`, 'draft-progress', 'assertive') // Skipped
announce(`Complete!`, 'draft-complete', 'polite') // Announced (different event)
```

---

## TESTING ANNOUNCEMENTS

### Automated Testing
```tsx
describe('AUI Announcements', () => {
  it('announces card harvest', () => {
    const { getByRole } = render(
      <AnnounceProvider>
        <TestComponent />
      </AnnounceProvider>
    )

    const liveRegion = getByRole('status')
    fireEvent(toolEventBus, new Event('card-harvested', {
      payload: { card: {...}, grade: { overall: 4 } }
    }))

    expect(liveRegion.textContent).toContain('Card harvested')
    expect(liveRegion.textContent).toContain('4 out of 5')
  })

  it('announces errors with assertive priority', () => {
    const { getByRole } = render(
      <AnnounceProvider>
        <TestComponent />
      </AnnounceProvider>
    )

    const alertRegion = getByRole('alert')
    fireEvent(toolEventBus, new Event('session-error', {
      payload: { error: 'Connection lost', phase: 'generating' }
    }))

    expect(alertRegion.textContent).toContain('Error')
    expect(alertRegion.textContent).toContain('Connection lost')
  })
})
```

### Manual Testing with Screen Reader
1. Enable VoiceOver (Mac) or NVDA (Windows)
2. Trigger tool events:
   - [ ] Hear announcement immediately (assertive) or after sentence (polite)
   - [ ] Hear complete message, not truncated
   - [ ] Hear context (e.g., "Grade: 4 out of 5")
3. Verify timing:
   - [ ] Multiple announcements queue properly
   - [ ] Auto-remove after announcement complete
   - [ ] No announcement duplication (throttled)

---

## WCAG 2.1 COMPLIANCE

| Criterion | Implementation | Status |
|-----------|-----------------|--------|
| 4.1.3 Status Messages | Live regions with role="status" and role="alert" | ✓ |
| 1.3.1 Info & Relationships | ARIA roles identify announcement purpose | ✓ |
| 2.4.3 Focus Order | Announcements don't trap focus | ✓ |
| 3.2.2 On Input | State changes announced, not required for input | ✓ |

---

## IMPLEMENTATION CHECKLIST

- [ ] AnnounceProvider wraps app root
- [ ] Tool event translations cover all event types
- [ ] Live regions (polite + assertive) rendered
- [ ] Priority levels assigned correctly
- [ ] Throttling implemented for progress events
- [ ] Messages are clear and contextual
- [ ] Testing with VoiceOver/NVDA complete
- [ ] Focus not trapped by announcements
- [ ] Reduced motion support (optional animations)

