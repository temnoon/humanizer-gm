# Pre-Merge Requirements

Issues that MUST be addressed in humanizer-sandbox BEFORE merging to humanizer-gm.

---

## BLOCKING: Security (3-4 days)

### 1. Input Validation (Day 1-2)
```
Files to create/modify:
- src/book-studio/validation.ts (NEW)
- src/book-studio/types.ts (add Zod schemas)
```

**Tasks:**
- [ ] Install Zod: `npm install zod`
- [ ] Create validation schemas for all API inputs:
  - BookCreateInput, BookUpdateInput
  - CardCreateInput, CardUpdateInput
  - ChapterCreateInput
  - OutlineInput
  - SearchInput
- [ ] Max lengths: title (255), content (50000), tags (50 each, 20 max)
- [ ] Enum validation for status, sourceType, etc.

### 2. XSS Prevention (Day 2)
```
Files to modify:
- src/book-studio/HarvestCard.tsx
- src/book-studio/WritingView.tsx
- src/book-studio/StagingArea.tsx
```

**Tasks:**
- [ ] Install DOMPurify: `npm install dompurify @types/dompurify`
- [ ] Create sanitization utility:
  ```typescript
  // src/book-studio/sanitize.ts
  import DOMPurify from 'dompurify'
  export const sanitize = (html: string) => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'br']
  })
  ```
- [ ] Sanitize all user content before rendering
- [ ] Sanitize card.content, card.userNotes, chapter.content

### 3. WebSocket Security (Day 3)
```
Files to create:
- src/book-studio/ws-auth.ts (NEW)
```

**Tasks:**
- [ ] Origin validation (must include 127.0.0.1 or localhost)
- [ ] Message schema validation with Zod
- [ ] Connection rate limiting (max 10 connections per minute)
- [ ] Subscription requires book ownership check

### 4. Server Binding (Day 3)
```
Files to verify:
- Any server startup code
```

**Tasks:**
- [ ] Ensure all servers bind to `127.0.0.1` not `0.0.0.0`
- [ ] Document localhost-only requirement

---

## REQUIRED: Type Unification (Day 4)

### Move Types to @humanizer/core
```
Files to modify:
- src/book-studio/types.ts → packages/core/src/types/book-studio.ts
```

**Tasks:**
- [ ] Move all Book Studio types to core package
- [ ] Update imports across all files
- [ ] Add temporal field types:
  ```typescript
  interface TemporalFields {
    sourceCreatedAt: number | null      // Unix seconds, original platform
    sourceCreatedAtStatus: 'exact' | 'inferred' | 'unknown'
    harvestedAt: number                 // Unix seconds, when pulled into book
    importedAt: number                  // Unix seconds, when entered archive
  }
  ```
- [ ] Add zero-date detection utility

---

## REQUIRED: Temporal Field Migration (Day 4-5)

### Update Existing Types
```
Files to modify:
- src/book-studio/types.ts
- src/book-studio/harvest-review-agent.ts
```

**Tasks:**
- [ ] Rename `createdAt` to `sourceCreatedAt` in HarvestCard
- [ ] Add `sourceCreatedAtStatus` field
- [ ] Add `harvestedAt` field (set on harvest)
- [ ] Create `isZeroDate()` utility:
  ```typescript
  function isZeroDate(date: number | string | null): boolean {
    if (!date) return true
    const ts = typeof date === 'number' ? date : new Date(date).getTime()
    // Epoch zero ± 1 day
    return ts < 86400000
  }
  ```
- [ ] Update `processCardOnHarvest()` to set temporal fields

---

## REQUIRED: Outline Agent API Prep (Day 5)

### Prepare for Server Migration
```
Files to modify:
- src/book-studio/outline-agent.ts
```

**Tasks:**
- [ ] Add JSDoc for all exported functions
- [ ] Ensure all functions are pure (no side effects)
- [ ] Document input/output types clearly
- [ ] Add error handling with typed errors
- [ ] Verify no browser-specific APIs used

---

## Summary Checklist

| Task | Priority | Est. Time | Status |
|------|----------|-----------|--------|
| Zod validation schemas | BLOCKING | 8 hrs | [ ] |
| DOMPurify XSS prevention | BLOCKING | 4 hrs | [ ] |
| WebSocket auth | BLOCKING | 4 hrs | [ ] |
| Server localhost binding | BLOCKING | 1 hr | [ ] |
| Type unification | REQUIRED | 4 hrs | [ ] |
| Temporal field migration | REQUIRED | 4 hrs | [ ] |
| Outline agent prep | REQUIRED | 2 hrs | [ ] |

**Total: ~27 hours (3-4 days)**

---

## Verification Before Merge

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds (0 errors)
- [ ] All validation schemas tested
- [ ] XSS sanitization verified (try `<script>alert(1)</script>` in card)
- [ ] WebSocket rejects invalid origins
- [ ] Zero-date detection works
- [ ] Temporal fields populated on harvest
