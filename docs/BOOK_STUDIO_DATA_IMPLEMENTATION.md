# BOOK STUDIO DATA SCHEMA - IMPLEMENTATION SUMMARY

## FILES TO CREATE/MODIFY

### 1. Core Type Definitions (NEW)
**File**: `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/book-studio.ts`

Create this new file with unified HarvestCard, Book, Chapter types:
- HarvestCard with sourceCreatedAt, sourceCreatedAtStatus, sourceMetadata
- Book with createdAt, updatedAt, publishedAt (all ISO)
- Chapter with createdAt, updatedAt, passageIds
- CardGrade interface
- Helper functions: isZeroDate(), normalizeDateFromSource(), unixToISO(), isoToUnix()

### 2. Archive Server Enhancement
**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/routes/embeddings.ts`

Update SearchResult return type:
- Ensure createdAt is always number (Unix seconds) or undefined
- Add exportedAt?: number field
- Add metadata.date_source and metadata.date_confidence fields
- Preserve original metadata fields for audit trail

### 3. Book Studio Database Schema
**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/book-studio/database/migrations.ts` (NEW)

SQLite migration:
```sql
CREATE TABLE harvest_cards (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_id TEXT,
  
  -- Source metadata (from Archive)
  source_created_at INTEGER,
  source_created_at_status TEXT,
  source_metadata TEXT,
  
  -- Book Studio timeline
  created_at TEXT NOT NULL,
  harvested_at TEXT NOT NULL,
  imported_at TEXT,
  
  -- Content
  content TEXT NOT NULL,
  title TEXT,
  source TEXT,
  similarity REAL,
  
  -- Grading
  grade JSONB,
  
  -- Annotations
  user_notes TEXT,
  tags TEXT,
  status TEXT DEFAULT 'staging',
  
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

### 4. Harvest Service
**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/book-studio/services/HarvestService.ts`

Implements date normalization on import:
```typescript
harvestCard(bookId: string, searchResult: SearchResult): Promise<HarvestCard>
  - Normalize searchResult.createdAt (Unix seconds)
  - Set sourceCreatedAtStatus based on reliability
  - Preserve full sourceMetadata
  - Set harvestedAt to current time (ISO)
  - Return card ready for staging
```

### 5. Frontend Type Imports
**File**: `/Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/types.ts`

Change from duplicate definitions to imports:
```typescript
// Remove local definitions
// Import instead:
export type {
  HarvestCard,
  Book,
  DraftChapter,
  CardGrade,
  OutlineStructure,
} from '@humanizer/core'

// Keep UI-only state:
export interface BookStudioState { ... }
export interface BookStudioUIState { ... }
```

### 6. Archive Reader Update
**File**: `/Users/tem/humanizer_root/humanizer-sandbox/src/archive-reader/index.ts`

Update SearchResult interface:
```typescript
interface SearchResult {
  // ... existing fields ...
  createdAt?: number // Unix seconds ONLY (clarify)
  exportedAt?: number // NEW: Export timestamp
  metadata?: {
    date_source?: 'platform' | 'export' | 'unknown'
    date_confidence?: 'precise' | 'approximate' | 'unknown'
    original_created_at?: unknown
    [key: string]: unknown
  }
}
```

---

## MIGRATION SCRIPT

**File**: `/Users/tem/humanizer_root/humanizer-gm/electron/book-studio/migrations/normalize-dates.ts`

Run on first launch to fix existing data:
- Detect zero-dates
- Attempt recovery from metadata
- Set appropriate status field
- Log corrections for audit trail
- Preserve all original data

---

## DATA FLOW VERIFICATION

Test these flows end-to-end:

1. **Harvest Flow**:
   - Archive search returns SearchResult with createdAt
   - Book Studio normalizes to Unix seconds
   - Card stores sourceCreatedAt + sourceCreatedAtStatus
   - Zero-dates detected and marked as 'unknown'
   - Metadata fully preserved

2. **Export/Import Flow**:
   - Cards exported to JSON with ISO dates
   - Re-import normalizes dates back
   - Data integrity maintained (lossless)

3. **Outline Generation**:
   - Research captures card date statuses
   - Outline includes dateHandling metadata
   - Users aware of which sources have uncertain dates

4. **Book Publishing**:
   - Passagelinks preserve sourceCreatedAt
   - Published output includes metadata about source dates
   - Reader can trace back to source

---

## TESTING CHECKLIST

### Date Handling
- [ ] Zero-date (0, 1970-01-01, null, undefined) detected correctly
- [ ] Unix seconds in range [Jan 1975, today] parsed correctly
- [ ] Milliseconds converted to seconds correctly
- [ ] ISO strings parsed and round-trip losslessly
- [ ] Recovery from metadata fields works
- [ ] sourceCreatedAtStatus accurately reflects confidence

### Type System
- [ ] No type duplication between sandbox and core
- [ ] Frontend imports from @humanizer/core successfully
- [ ] Archive types compatible with Book Studio types
- [ ] API responses match defined interfaces

### API Contracts
- [ ] POST /api/books/:id/harvest returns HarvestCard with dates
- [ ] GET /api/books/:id/cards includes sourceCreatedAt fields
- [ ] POST /api/books/:id/chapters/:cid/generate-outline includes dateHandling
- [ ] All dates in API responses are ISO 8601 format

### Metadata Preservation
- [ ] sourceMetadata always preserved from SearchResult
- [ ] Original platform fields accessible for audit
- [ ] Date recovery attempts logged
- [ ] No metadata fields discarded during transformations

### Migration
- [ ] Existing zero-dates detected and remediated
- [ ] Metadata recovered where possible
- [ ] Status fields set accurately
- [ ] Audit log created
- [ ] No data loss during migration

---

## BACKWARD COMPATIBILITY

- [ ] Old HarvestCard format still readable (adaptLegacyCard)
- [ ] Existing books load without errors
- [ ] Date fields have sensible defaults
- [ ] API versioning not needed (additive only)

---

## SIGN-OFF POINTS

**Architect**: Verify schema and type system align with vision
**Data Agent**: Verify temporal integrity and metadata preservation
**Security Agent**: Verify no data exposure through metadata
**Accessibility Agent**: Verify date displays accessible to users

---

## CRITICAL PATH

1. Create book-studio.ts in core (types + helpers)
2. Update SearchResult in archive-reader
3. Create HarvestService with normalization
4. Add database migrations
5. Update frontend imports
6. Create migration script for existing data
7. End-to-end testing of all flows
8. Merge to main

---

**Data Agent Review**: CONDITIONAL PASS
**Mandatory Fixes**: Temporal metadata, type unification, zero-date detection
**Timeline**: Can proceed with fixes in parallel to avoid blocking
