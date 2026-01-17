# Post-Merge Requirements

Issues to address AFTER merging sandbox to humanizer-gm.

---

## Phase 1: Book Studio API Server (Week 1-2)

### Create Express Server Skeleton
```
Location: electron/book-studio-server/
```

**Tasks:**
- [ ] Create `electron/book-studio-server/index.ts`
- [ ] Set up Express with TypeScript
- [ ] Add SQLite database with schema:
  ```sql
  CREATE TABLE books (id, title, author_id, created_at, updated_at)
  CREATE TABLE chapters (id, book_id, title, order, content, word_count)
  CREATE TABLE cards (id, book_id, chapter_id, content, source_created_at, ...)
  CREATE TABLE clusters (id, book_id, name, card_ids, locked)
  CREATE TABLE outlines (id, book_id, structure_json, generated_at)
  CREATE TABLE events (id, type, payload, created_at)
  ```
- [ ] Add WebSocket server for events
- [ ] Bind to port 3004, localhost only

### Port Services from Frontend
```
From: humanizer-sandbox/src/book-studio/
To: electron/book-studio-server/services/
```

| Service | Source Files | Priority |
|---------|-------------|----------|
| BookService | types.ts, persistence logic | Week 1 |
| HarvestService | harvest-review-agent.ts | Week 1 |
| OutlineService | outline-agent.ts | Week 2 |
| DraftService | draft-generator.ts | Week 2 |
| ClusteringService | clustering.ts, reactive-clustering.ts | Week 2 |

---

## Phase 2: Accessibility Fixes (Week 2-3)

### Panel System Keyboard Navigation
```
Files: apps/web/src/components/panels/
```

**Critical (12 issues):**
- [ ] Add `role="region"` to panel containers
- [ ] Implement focus trap for floating panels
- [ ] Add `aria-label` to all icon buttons
- [ ] Keyboard shortcuts: Cmd+[/] for panel nav, Escape to close
- [ ] Focus-visible styles on all interactive elements

### AUI Live Regions
```
Files: apps/web/src/components/aui/
```

- [ ] Create `AUIAnnouncer` component with live region
- [ ] Map tool events to announcements:
  - `card-harvested` → "Card added to staging"
  - `draft-progress` → "Draft 45% complete"
  - `session-error` → assertive alert
- [ ] Throttle announcements (max 1 per 500ms)

### Touch Targets
- [ ] Resize handles: 44px minimum (currently 8px)
- [ ] Panel collapse buttons: 44px minimum
- [ ] Tab close buttons: 44px minimum

### Reduced Motion
- [ ] Add `@media (prefers-reduced-motion: reduce)` rules
- [ ] Disable panel animations when reduced motion preferred

---

## Phase 3: Archive Integration (Week 3-4)

### Store Books in Archive
```
Files: electron/archive-server/
```

**Tasks:**
- [ ] Add `/api/books` endpoints to archive server
- [ ] Create books collection in SQLite
- [ ] Enable book content embedding
- [ ] Make books searchable via existing `/api/search`

### Unified Archive Panel
```
Files: apps/web/src/components/archive/
```

**Tasks:**
- [ ] Combine search, filter, browse into single panel
- [ ] Add source category tabs (Conversations, Facebook, Books, Web)
- [ ] Quick filter chips for common filters
- [ ] "Find similar" always visible in workspace
- [ ] Preserve filter state across tab switches

---

## Phase 4: Panel System Integration (Week 4)

### Implement Photoshop-Style Panels
```
Files: apps/web/src/components/layout/
```

**Use CSS from sandbox:**
- `panel-system.css` (already written)
- `panel-tabs.css` (already written)

**Tasks:**
- [ ] Create `PanelSystem` layout component
- [ ] Create `PanelRegion` (left, right, bottom, center)
- [ ] Create `PanelGroup` with tabs
- [ ] Add resize handles with drag behavior
- [ ] Add collapse/expand with state persistence
- [ ] Add floating panel support

### State Persistence
- [ ] Save panel positions to localStorage
- [ ] Restore on app restart
- [ ] Reset to defaults option

---

## Phase 5: Tool Signaling (Week 5)

### Event-Driven Display Pattern
```
Files: electron/book-studio-server/events.ts
       apps/web/src/hooks/useToolEvents.ts
```

**Architecture:**
```
Tool executes → Emits event → WebSocket → Frontend subscribes → GUI updates
```

**Tasks:**
- [ ] Define event types:
  ```typescript
  type ToolEvent =
    | { type: 'card-harvested', card: Card }
    | { type: 'draft-progress', percent: number, content: string }
    | { type: 'outline-generated', outline: Outline }
    | { type: 'cluster-updated', cluster: Cluster }
    | { type: 'error', message: string }
  ```
- [ ] Create `useToolEvents()` hook for frontend
- [ ] Update all components to subscribe to relevant events
- [ ] Remove manual "refresh" patterns

---

## Phase 6: Live Transformations (Future)

### Chapter Transformation Tracking
```
Reminder from user: "adding live transformations to chapters, so editing
the canonic chapter, any changes would be transformed in the same way"
```

**Design:**
- [ ] Store transformation recipe per chapter
- [ ] On chapter edit, re-apply transformations
- [ ] Track transformation history
- [ ] Allow undo/redo of transformations

---

## Summary Timeline

| Week | Phase | Focus |
|------|-------|-------|
| 1-2 | API Server | Express skeleton, port services |
| 2-3 | Accessibility | 12 critical fixes, live regions |
| 3-4 | Archive | Books in archive, unified panel |
| 4 | Panels | Photoshop-style layout |
| 5 | Events | Tool signaling pattern |
| Future | Transforms | Live chapter transformations |

**Total: 5-6 weeks to full integration**
