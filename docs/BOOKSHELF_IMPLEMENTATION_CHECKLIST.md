# Bookshelf Feature - Implementation Checklist

**Status**: Pre-Implementation
**Priority**: HIGH
**Signoff Required**: Yes (Data Agent)
**Estimated Effort**: 3-4 days (Phase 1 complete), 1-2 weeks (Phase 2 SQLite migration)

---

## PHASE 1: Type Definitions & Basic Services (Day 1-2)

### Step 1: Add Type Definitions to @humanizer/core

- [ ] **File**: `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/passage.ts`
  - [ ] Add `HarvestBucket` interface
  - [ ] Add `HarvestBucketCollection` interface
  - [ ] Add `PassageLink` interface
  - [ ] Add `PassageUsage` interface
  - [ ] Update imports to include `EntityURI` from entity.ts

- [ ] **File**: `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/book.ts`
  - [ ] Add `NarrativeArc` interface
  - [ ] Add `ArcAct` interface
  - [ ] Update imports to include `EntityURI` from entity.ts

- [ ] **File**: `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/index.ts`
  - [ ] Export `HarvestBucket`, `HarvestBucketCollection`, `PassageLink`, `PassageUsage` from passage.js
  - [ ] Export `NarrativeArc`, `ArcAct` from book.js

### Step 2: Create Service Layer (localStorage-based)

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/HarvestBucketService.ts`
  - [ ] `class HarvestBucketService`
  - [ ] `create(bucket: HarvestBucket)` - Add to map + localStorage
  - [ ] `list(bookRef, status)` - Filter by status/book
  - [ ] `update(id, status, notes)` - Update status
  - [ ] `approve(id)` - Move to SourcePassage
  - [ ] `reject(id)` - Mark rejected
  - [ ] `delete(id)` - Clean up
  - [ ] `cleanup()` - Remove expired buckets

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/NarrativeArcService.ts`
  - [ ] `class NarrativeArcService`
  - [ ] `create(arc: NarrativeArc)` - Create with acts
  - [ ] `list(bookRef)` - Get all arcs for book
  - [ ] `update(id, evaluation)` - Update evaluation status
  - [ ] `assignPassages(arcId, actId, passageIds)` - Assign to acts
  - [ ] `delete(id)` - Remove arc

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/PassageLinkService.ts`
  - [ ] `class PassageLinkService`
  - [ ] `create(link: PassageLink)` - Create link with validation
  - [ ] `getUsage(passageId)` - Get usage summary
  - [ ] `getOrphaned(bookRef)` - Find unused passages
  - [ ] `delete(linkId)` - Remove link
  - [ ] `validateLink(link)` - Check referential integrity

### Step 3: Storage Abstraction

- [ ] **Update**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/BookshelfService.ts`
  - [ ] Add `harvestBuckets` map
  - [ ] Add `narrativeArcs` map
  - [ ] Add `passageLinks` map
  - [ ] Add localStorage keys:
    - `humanizer-bookshelf-harvest-buckets`
    - `humanizer-bookshelf-narrative-arcs`
    - `humanizer-bookshelf-passage-links`
  - [ ] Add load/save methods for each collection
  - [ ] Add error handling with try-catch on JSON.parse

### Step 4: Validation Helpers

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/validation.ts`
  - [ ] `validatePassageLink(link, book)` - Check passage/chapter exist
  - [ ] `detectOrphanedPassages(book)` - Find unused
  - [ ] `validatePassageRef(passageId, bookRef)` - Lookup
  - [ ] `validateChapterRef(chapterId, bookRef)` - Lookup
  - [ ] `validateHarvestBucket(bucket, book)` - Check refs

---

## PHASE 2: API Endpoints (Day 2-3)

### Step 5: REST API Endpoints

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/apps/web/src/lib/bookshelf/api.ts`
  - [ ] **Harvest**:
    - `GET /api/bookshelf/books/:bookId/harvest` - List buckets
    - `POST /api/bookshelf/books/:bookId/harvest` - Create bucket
    - `PATCH /api/bookshelf/harvest/:bucketId` - Update status
    - `POST /api/bookshelf/harvest/:bucketId/approve` - Approve + merge
    - `DELETE /api/bookshelf/harvest/:bucketId` - Delete

  - [ ] **Arcs**:
    - `GET /api/bookshelf/books/:bookId/arcs` - List arcs
    - `POST /api/bookshelf/books/:bookId/arcs` - Create arc
    - `PATCH /api/bookshelf/arcs/:arcId` - Update evaluation
    - `POST /api/bookshelf/arcs/:arcId/assign` - Assign passages
    - `DELETE /api/bookshelf/arcs/:arcId` - Delete arc

  - [ ] **Links**:
    - `POST /api/bookshelf/links` - Create link
    - `GET /api/bookshelf/passages/:passageId/usage` - Get usage
    - `GET /api/bookshelf/books/:bookId/orphaned` - Find orphaned
    - `DELETE /api/bookshelf/links/:linkId` - Delete link

### Step 6: Data Integrity Safeguards

- [ ] **Update**: `BookProjectService.deleteChapter()`
  - [ ] Find all passage links to chapter
  - [ ] Check each passage for other usage
  - [ ] Mark as orphaned if unused
  - [ ] Delete links to this chapter

- [ ] **Validation on create**:
  - [ ] `PassageLink` creation validates passage/chapter exist
  - [ ] Prevents duplicate links (same passage+chapter+usage+offset)
  - [ ] Checks offset is within chapter bounds

- [ ] **Cleanup job**:
  - [ ] Hourly cleanup of expired buckets (>7 days, pending)
  - [ ] Log cleanup results

---

## PHASE 3: SQLite Migration (Day 4+)

### Step 7: Database Schema (v10)

- [ ] **Update**: `/Users/tem/humanizer_root/humanizer-gm/electron/archive-server/services/embeddings/EmbeddingDatabase.ts`
  - [ ] Bump SCHEMA_VERSION to 10
  - [ ] Add `harvest_buckets` table
  - [ ] Add `narrative_arcs` table
  - [ ] Add `arc_act_assignments` table
  - [ ] Add `passage_links` table
  - [ ] Add indexes:
    - `idx_harvest_book`, `idx_harvest_status`, `idx_harvest_expires`
    - `idx_arcs_book`, `idx_arcs_status`
    - `idx_passage_links_passage`, `idx_passage_links_chapter`, `idx_passage_links_usage`
  - [ ] Update migration logic in `migrateSchema()`

### Step 8: Hybrid Storage Layer

- [ ] **Update**: Service classes to support both localStorage and SQLite
  - [ ] Add `useSQLite: boolean` flag
  - [ ] Add `db?: EmbeddingDatabase` property
  - [ ] Add conditional logic in CRUD methods
  - [ ] Keep localStorage as fallback

### Step 9: Migration Script

- [ ] **New File**: `/Users/tem/humanizer_root/humanizer-gm/electron/migrations/migrate-bookshelf-v10.ts`
  - [ ] Read from localStorage
  - [ ] Insert into SQLite tables
  - [ ] Verify counts match
  - [ ] Backup localStorage before migration

### Step 10: Feature Flag & Testing

- [ ] Add feature flag for SQLite persistence
- [ ] Test with both localStorage and SQLite
- [ ] Verify data integrity queries (see audit)
- [ ] Load test with large bookshelf (100+ books)

---

## TESTING CHECKLIST

### Unit Tests

- [ ] HarvestBucketService
  - [ ] Create bucket with valid refs
  - [ ] Reject with invalid bookRef/threadRef
  - [ ] Update status transitions
  - [ ] Cleanup expired buckets
  - [ ] JSON serialization/deserialization

- [ ] NarrativeArcService
  - [ ] Create arc with acts
  - [ ] Assign passages to acts
  - [ ] Update evaluation
  - [ ] List arcs by book

- [ ] PassageLinkService
  - [ ] Create valid links
  - [ ] Reject invalid passage/chapter
  - [ ] Detect orphaned passages
  - [ ] Prevent duplicates

### Integration Tests

- [ ] Book deletion triggers orphan detection
- [ ] Orphaned passages marked correctly
- [ ] Migration from localStorage to SQLite
- [ ] Referential integrity maintained
- [ ] API endpoints return correct data

### Data Integrity Tests

```bash
# Run these SQL queries after migration
sqlite3 archive.db < validation-queries.sql
```

---

## DOCUMENTATION

- [ ] Update `/Users/tem/humanizer_root/humanizer-gm/CLAUDE.md`
  - [ ] Add Bookshelf section to WORKING FEATURES
  - [ ] Add to Key Directories

- [ ] Add JSDoc comments to all public methods

- [ ] Create `/Users/tem/humanizer_root/humanizer-gm/docs/BOOKSHELF_USER_GUIDE.md`
  - [ ] Explain harvest workflow
  - [ ] Explain arc proposal flow
  - [ ] Explain passage linking

---

## SIGN-OFF GATES

### Gate 1: Type Definitions (Day 1)
- [ ] Types added to @humanizer/core
- [ ] Exports updated
- [ ] Compiles without errors
- [ ] Data Agent approves

### Gate 2: Services Complete (Day 2)
- [ ] All services implemented
- [ ] localStorage persistence working
- [ ] Tests passing
- [ ] Data Agent reviews

### Gate 3: API Ready (Day 3)
- [ ] Endpoints documented
- [ ] Validation in place
- [ ] Manual testing done
- [ ] Architect reviews

### Gate 4: SQLite Migration (Day 5+)
- [ ] Schema v10 complete
- [ ] Migration script tested
- [ ] Data integrity verified
- [ ] Data Agent final approval

---

## DEFERRED (Post-Launch)

These items are nice-to-have but not blocking:

- [ ] Passage linking UI component
- [ ] Arc visualization (timeline view)
- [ ] Search within buckets
- [ ] Batch passage approval
- [ ] Arc template library
- [ ] Analytics dashboard

---

## SUCCESS CRITERIA

- [ ] All new types exported from @humanizer/core
- [ ] Services handle both localStorage and SQLite
- [ ] All validation safeguards in place
- [ ] No orphaned data possible
- [ ] 100% API contract coverage
- [ ] Data migration tested and documented
- [ ] All tests passing
- [ ] Code reviewed by Data + Architect agents

---

**Created**: 2025-12-30
**Last Updated**: 2025-12-30
**Estimated Completion**: 2025-01-06

