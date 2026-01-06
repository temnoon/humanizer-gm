# Handoff: Xanadu Migration & Technical Debt (Jan 6, 2026)

## Context

Session ran out of context after fixing P0 issues and establishing FALLBACK POLICY. The remaining work is P1-P3 from the House Council audit.

---

## Remaining Tasks

### P1: Complete Xanadu Migration (PRIORITY - 1-2 days)

**Goal**: Remove all localStorage fallbacks for book data. All book-related data must live in SQLite via Xanadu API.

#### Files That Need Migration

| File | Storage Keys | Current State | Action Needed |
|------|-------------|---------------|---------------|
| `BookshelfService.ts` | `humanizer-bookshelf-{personas,styles,books,index}` | Used as fallback when Xanadu unavailable | Remove fallback, fail loudly in production |
| `HarvestBucketService.ts` | `humanizer-harvest-{buckets,arcs,links}` | PRIMARY storage (no Xanadu) | Integrate with Xanadu API |
| `persona-store.ts` | `humanizer-curator-persona` | localStorage only | Consider if this is "user preference" (OK to keep) or "book data" (must migrate) |

#### BookshelfContext.tsx Pattern

Current code uses this pattern throughout:
```typescript
if (isXanaduAvailable()) {
  // Use Xanadu
  await window.electronAPI!.xanadu.books.upsert({...});
} else {
  // FALLBACK to localStorage - THIS MUST GO
  bookshelfService.createBook(book);
}
```

**Required change** (per FALLBACK POLICY):
```typescript
if (isXanaduAvailable()) {
  await window.electronAPI!.xanadu.books.upsert({...});
} else if (import.meta.env.DEV) {
  console.warn('[DEV] Using localStorage fallback');
  bookshelfService.createBook(book);
} else {
  throw new Error('Xanadu storage unavailable. Run in Electron app.');
}
```

#### HarvestBucketService.ts - Full Migration Needed

This service has NO Xanadu integration. It needs:

1. **Add Xanadu API methods** to `electron/preload.ts`:
```typescript
xanadu: {
  // existing...
  harvestBuckets: {
    list: (bookId?: string) => Promise<HarvestBucket[]>,
    get: (bucketId: string) => Promise<HarvestBucket | null>,
    upsert: (bucket: HarvestBucket) => Promise<void>,
    delete: (bucketId: string) => Promise<void>,
  },
  narrativeArcs: {
    list: (bookId?: string) => Promise<NarrativeArc[]>,
    upsert: (arc: NarrativeArc) => Promise<void>,
    delete: (arcId: string) => Promise<void>,
  },
}
```

2. **Add SQLite tables** to `EmbeddingDatabase.ts`:
```sql
CREATE TABLE IF NOT EXISTS harvest_buckets (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  status TEXT NOT NULL,
  candidates TEXT,  -- JSON array
  approved TEXT,    -- JSON array
  gems TEXT,        -- JSON array
  rejected TEXT,    -- JSON array
  config TEXT,      -- JSON object
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS narrative_arcs (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  thesis TEXT,
  arc_type TEXT,
  evaluation TEXT,  -- JSON object
  created_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

3. **Update HarvestBucketService** to use Xanadu when available

#### Migration Infrastructure Already Exists

File: `apps/web/src/lib/migration/LocalStorageMigration.ts`

```typescript
// Already implemented:
export async function migrateToUnifiedStorage(options?: MigrationOptions): Promise<MigrationResult>
export function hasDataToMigrate(): boolean
export function isMigrationComplete(): boolean

// Migration marker key: 'xanadu-migration-complete'
```

The migration runs automatically in `BookshelfContext.tsx` line 213:
```typescript
if (!isMigrationComplete() && hasDataToMigrate()) {
  console.log('[Bookshelf] Running localStorage -> Xanadu migration');
  await migrateToUnifiedStorage({ clearAfterMigration: true });
}
```

---

### P2: Add ESLint Rule for `|| []` Patterns (1 hour)

**Goal**: Prevent silent fallback patterns from being introduced.

**Location**: Create `eslint-local-rules/no-silent-fallback.js`

**Rule Logic**:
```javascript
// Warn on patterns like:
data || []
result.items || []
response.data || {}

// Allow patterns like (display defaults):
name || 'Unknown'
count || 0
```

**Configuration** in `.eslintrc.js`:
```javascript
rules: {
  'local/no-silent-fallback': 'warn',
}
```

---

### P3: Audit All 97 Fallback Instances (4-6 hours)

**Goal**: Classify and fix all `|| []` and `|| {}` patterns.

**Found via**: `grep -r "\|\| \[\]" apps/web/src --include="*.ts" --include="*.tsx"`

**Classification needed**:

| Category | Example | Action |
|----------|---------|--------|
| Display default | `person.nickname \|\| 'Unknown'` | OK - leave as is |
| Data operation | `response.data \|\| []` | FIX - explicit error handling |
| Dev fallback | `storage \|\| localStorageShim` | FIX - add `import.meta.env.DEV` guard |

**Critical paths to audit first**:
- `apps/web/src/lib/aui/tools.ts` (book-making tools)
- `apps/web/src/lib/bookshelf/BookshelfContext.tsx`
- `apps/web/src/components/tools/HarvestQueuePanel.tsx`

---

## Quick Resume Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Check current localStorage keys in browser console:
Object.keys(localStorage).filter(k => k.startsWith('humanizer-'))

# Clear localStorage for testing:
['humanizer-harvest-buckets','humanizer-bookshelf-books','humanizer-bookshelf-personas','humanizer-bookshelf-styles'].forEach(k => localStorage.removeItem(k))
```

---

## Commits This Session

```
d1c6a20 docs: Add handoff for House Council session fixes
d3ba690 docs: Add FALLBACK POLICY to TECHNICAL_DEBT.md
ddc2b38 fix(aui): Fix AUIContext type errors (P0)
1755866 fix(data): Fix pyramid chunk overwrites and bookType (Codex P1, P2)
```

---

## Key Files Reference

| Purpose | File |
|---------|------|
| Xanadu API definition | `electron/preload.ts` (lines 134-176) |
| SQLite schema | `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` |
| Migration logic | `apps/web/src/lib/migration/LocalStorageMigration.ts` |
| BookshelfContext | `apps/web/src/lib/bookshelf/BookshelfContext.tsx` |
| HarvestBucketService | `apps/web/src/lib/bookshelf/HarvestBucketService.ts` |
| FALLBACK POLICY | `TECHNICAL_DEBT.md` (lines 6-52) |

---

## FALLBACK POLICY Reminder

**Production Fallbacks: FORBIDDEN**
- Silent API fallbacks
- Default empty collections without state
- Storage backend fallbacks

**Development Fallbacks: ALLOWED with guard**
```typescript
if (import.meta.env.DEV) {
  console.warn('[DEV] Using fallback...');
  return fallbackImpl();
}
throw new Error('Production requires X');
```

---

## Best Practice: End of Context Protocol

**Always store a ChromaDB memory summary before compacting context.**

```typescript
// Use mcp__chromadb-memory__store_memory with:
// - Comprehensive session summary
// - Tags: "handoff,session-summary,<date>,<topic>"
// - Type: "session-handoff"
```

This preserves session context for future retrieval and maintains continuity across conversations.

**Memory stored this session**: `42de168b...` (tags: handoff, house-council, fallback-policy, xanadu-migration)

---

**End of Handoff**
