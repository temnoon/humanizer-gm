# Next Context Guide

Step-by-step instructions for the next Claude Code session. Continue until merge is ready for testing.

---

## Session Goal

Complete PRE_MERGE_REQUIREMENTS.md so sandbox can merge to humanizer-gm.

---

## Before Starting

### Load Context
```
Read these files first:
1. /Users/tem/humanizer_root/humanizer-gm/docs/council-jan16/COUNCIL_REVIEW_INDEX.md
2. /Users/tem/humanizer_root/humanizer-gm/docs/council-jan16/PRE_MERGE_REQUIREMENTS.md
3. /Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/types.ts
```

### Verify Dev Server
```bash
cd /Users/tem/humanizer_root/humanizer-sandbox
npm run dev
# Should be running on localhost:5176
```

---

## Task 1: Install Dependencies (5 min)

```bash
cd /Users/tem/humanizer_root/humanizer-sandbox
npm install zod dompurify @types/dompurify
```

---

## Task 2: Create Validation Schemas (2-3 hrs)

### Create validation.ts
```
File: /Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/validation.ts
```

**Content to implement:**
```typescript
import { z } from 'zod'

// Book schemas
export const BookCreateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
})

export const BookUpdateSchema = BookCreateSchema.partial()

// Card schemas
export const CardCreateSchema = z.object({
  content: z.string().min(1).max(50000),
  title: z.string().max(255).optional(),
  sourceType: z.enum(['message', 'post', 'comment', 'document', 'note', 'image', 'other']),
  source: z.string().max(500),
  sourceUrl: z.string().url().optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  userNotes: z.string().max(2000).optional(),
})

// Chapter schemas
export const ChapterCreateSchema = z.object({
  title: z.string().min(1).max(255),
  order: z.number().int().min(0),
})

// Search schemas
export const SearchInputSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(100).default(20),
  filters: z.object({
    sourceTypes: z.array(z.string()).optional(),
    dateRange: z.object({
      start: z.number().optional(),
      end: z.number().optional(),
    }).optional(),
  }).optional(),
})

// Outline schemas
export const OutlineItemSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    level: z.number().int().min(0).max(5),
    text: z.string().min(1).max(500),
    children: z.array(OutlineItemSchema).optional(),
  })
)

export const OutlineStructureSchema = z.object({
  type: z.enum(['numbered', 'bulleted', 'chapter-list', 'conversational']),
  items: z.array(OutlineItemSchema),
  depth: z.number().int().min(1).max(6),
  confidence: z.number().min(0).max(1),
})

// Export types
export type BookCreateInput = z.infer<typeof BookCreateSchema>
export type CardCreateInput = z.infer<typeof CardCreateSchema>
export type ChapterCreateInput = z.infer<typeof ChapterCreateSchema>
export type SearchInput = z.infer<typeof SearchInputSchema>
```

---

## Task 3: Create Sanitization Utility (30 min)

### Create sanitize.ts
```
File: /Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/sanitize.ts
```

**Content:**
```typescript
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'br', 'blockquote']
const ALLOWED_ATTR = ['class']

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })
}

export function sanitizeText(dirty: string): string {
  // Strip ALL HTML for plain text contexts
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] })
}

export function sanitizeCardContent(card: { content: string; userNotes?: string }) {
  return {
    ...card,
    content: sanitizeHtml(card.content),
    userNotes: card.userNotes ? sanitizeText(card.userNotes) : undefined,
  }
}
```

---

## Task 4: Apply Sanitization to Components (1-2 hrs)

### Update HarvestCard.tsx
Find all places where `card.content` is rendered and wrap with sanitization:

```typescript
import { sanitizeHtml } from './sanitize'

// In render:
<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(card.content) }} />
// OR if plain text:
<div>{sanitizeText(card.content)}</div>
```

### Update WritingView.tsx
Sanitize draft content before display.

### Update StagingArea.tsx
Sanitize card previews.

---

## Task 5: Temporal Fields (1-2 hrs)

### Update types.ts
Add temporal fields to HarvestCard:

```typescript
export interface HarvestCard {
  // ... existing fields ...

  // Temporal fields (NEW)
  sourceCreatedAt: number | null        // Unix seconds, original platform
  sourceCreatedAtStatus: 'exact' | 'inferred' | 'unknown'
  harvestedAt: number                   // Unix seconds, when pulled into book

  // DEPRECATED: use sourceCreatedAt instead
  createdAt?: string | number
}
```

### Add zero-date detection
```typescript
export function isZeroDate(date: number | string | null | undefined): boolean {
  if (date === null || date === undefined) return true
  const ts = typeof date === 'number' ? date * 1000 : new Date(date).getTime()
  if (isNaN(ts)) return true
  // Epoch zero ± 1 day (86400000ms)
  return Math.abs(ts) < 86400000
}

export function normalizeDate(date: string | number | null | undefined): {
  value: number | null
  status: 'exact' | 'inferred' | 'unknown'
} {
  if (isZeroDate(date)) {
    return { value: null, status: 'unknown' }
  }
  const ts = typeof date === 'number' ? date : Math.floor(new Date(date!).getTime() / 1000)
  return { value: ts, status: 'exact' }
}
```

### Update processCardOnHarvest
In `harvest-review-agent.ts`, set temporal fields:

```typescript
export function processCardOnHarvest(card: HarvestCard): HarvestCard {
  const { value, status } = normalizeDate(card.createdAt)

  return {
    ...card,
    sourceCreatedAt: value,
    sourceCreatedAtStatus: status,
    harvestedAt: Math.floor(Date.now() / 1000),
    // ... rest of processing
  }
}
```

---

## Task 6: TypeScript Verification (30 min)

```bash
cd /Users/tem/humanizer_root/humanizer-sandbox
npx tsc --noEmit --skipLibCheck
```

Fix any errors that arise.

---

## Task 7: Manual Testing (1 hr)

### Test XSS Prevention
1. Open dev tools console
2. Try harvesting content with: `<script>alert('xss')</script>`
3. Verify script does NOT execute
4. Verify content displays safely (stripped or escaped)

### Test Validation
1. Try creating a book with empty title
2. Try creating a card with 100KB content
3. Verify validation errors are returned

### Test Temporal Fields
1. Harvest a card from archive
2. Inspect card object in dev tools
3. Verify `sourceCreatedAt`, `sourceCreatedAtStatus`, `harvestedAt` are set

---

## Task 8: Final Checklist

- [ ] `npm install` added zod, dompurify
- [ ] validation.ts created with all schemas
- [ ] sanitize.ts created
- [ ] HarvestCard.tsx sanitizes content
- [ ] WritingView.tsx sanitizes content
- [ ] StagingArea.tsx sanitizes content
- [ ] types.ts has temporal fields
- [ ] harvest-review-agent.ts sets temporal fields
- [ ] `npx tsc --noEmit` passes
- [ ] XSS test passes (script blocked)
- [ ] Temporal fields populated on harvest

---

## When Complete

Update PRE_MERGE_REQUIREMENTS.md checkboxes, then:

```bash
cd /Users/tem/humanizer_root/humanizer-sandbox
git add -A
git commit -m "Security hardening and temporal fields for Book Studio

- Add Zod validation schemas for all inputs
- Add DOMPurify XSS sanitization
- Add temporal field model (sourceCreatedAt, harvestedAt)
- Add zero-date detection and normalization

Council Review: Security requirements addressed
"
```

Then proceed to POST_MERGE_REQUIREMENTS.md Phase 1 (API server).

---

## Quick Reference

| File | Purpose |
|------|---------|
| `validation.ts` | Zod schemas for input validation |
| `sanitize.ts` | DOMPurify wrappers for XSS prevention |
| `types.ts` | Temporal field additions |
| `harvest-review-agent.ts` | Set temporal fields on harvest |

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npx tsc --noEmit` | Type check |
| `npm run build` | Production build |
