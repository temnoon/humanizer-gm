# Bookshelf Schema - Quick Start Guide

**Audit Date**: December 30, 2025
**Signoff**: Data Agent (REQUIRED)
**Status**: APPROVED - Ready for Implementation

---

## What's Being Added?

Three new data concepts to support the Bookshelf feature:

### 1. HarvestBucket
Raw passages from semantic search, waiting for curator review.

```
User searches "themes of failure" → 50 candidates found
├── HarvestBucket #1 (10 results, pending review)
├── HarvestBucket #2 (15 results, approved)
└── HarvestBucket #3 (25 results, rejected)

When approved: candidate becomes SourcePassage in book.passages
```

**Files to update**:
- `/packages/core/src/types/passage.ts` - Add interface

### 2. NarrativeArc
AUI proposes story structure (monomyth, 3-act, etc.) based on content.

```
AUI analyzes book content → proposes "Hero's Journey"
├── Act: Call to Adventure (passages: p1, p3, p7)
├── Act: Crossing the Threshold (passages: p5, p9)
└── Act: Return with Elixir (passages: p15, p18)

User reviews → approves, rejects, or revises
```

**Files to update**:
- `/packages/core/src/types/book.ts` - Add interfaces

### 3. PassageLink
Bidirectional link tracking which passages are used in which chapters.

```
Passage p5 ("I learned to trust myself")
├── Used in Chapter 1, Section "Growth" as quote
├── Used in Chapter 3, Section "Reflection" as inspiration
└── NOT used in Chapter 2 (orphaned from this book)
```

**Files to update**:
- `/packages/core/src/types/passage.ts` - Add interfaces

---

## File Change Summary

### New Types (Read-Only Reference)
- `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/passage.ts` - 4 new interfaces
- `/Users/tem/humanizer_root/humanizer-gm/packages/core/src/types/book.ts` - 2 new interfaces

### Existing Files (No Breaking Changes)
- `/packages/core/src/types/index.ts` - Re-exports only
- `/apps/web/src/lib/bookshelf/types.ts` - Re-exports only

### New Services (To Implement)
- `HarvestBucketService.ts` - Create, list, approve, reject buckets
- `NarrativeArcService.ts` - Create, assign, evaluate arcs
- `PassageLinkService.ts` - Create, validate, detect orphans

---

## Implementation Path

### Phase 1: Types + Services (2 days)
1. Add types to @humanizer/core (copy-paste from audit)
2. Create 3 service classes (localStorage-based)
3. Add validation helpers
4. Test with unit tests

### Phase 2: API + Safety (1 day)
5. Wire up REST endpoints
6. Add orphan detection on chapter delete
7. Implement stale bucket cleanup
8. Integration tests

### Phase 3: SQLite (2-3 days)
9. Add schema v10 tables
10. Implement hybrid storage (localStorage + SQLite)
11. Migration script
12. Data integrity tests

---

## Key Decisions

### URI-Based References
All types use `EntityURI` for references - no raw IDs.

```typescript
// CORRECT
passageRef: {
  bookRef: EntityURI;      // "book://author/title"
  passageId: string;       // Raw ID within that book
}

// WRONG - don't do this
passageRef: {
  bookId: string;
  passageId: string;
}
```

### Lifecycle vs Container
**HarvestBucket** is temporary staging - not a container like BookProject.

```
Timeline:
pending → reviewing → approved → merged → deleted
                   ↓
                SourcePassage (permanent)
```

### Orphan Prevention
When deleting a chapter:
1. Find all links to this chapter
2. For each passage, check if it's used elsewhere
3. If only used in deleted chapter, mark orphaned (tag)
4. Don't delete the passage data itself

---

## Data Integrity Safeguards

### Prevented Problems

- Orphaned passages (passages not in any chapter)
  - **Solution**: PassageLink.getOrphaned() + tagging
  
- Broken references (link points to deleted passage/chapter)
  - **Solution**: Validation on create + foreign keys in SQLite
  
- Duplicate links (same passage+chapter+usage)
  - **Solution**: UNIQUE constraint in SQLite, duplicate check in services
  
- Data loss on arc rejection
  - **Solution**: Arcs are immutable, evaluation is additive

### Validation at Every Boundary

```typescript
// Before creating a link
validatePassageRef(passage_id) → exists in book.passages?
validateChapterRef(chapter_id) → exists in book.chapters?
validateSectionRef(section_id) → exists in chapter.sections?
checkDuplicate() → not already linked with same usage?
checkOffset() → within chapter bounds?
```

---

## localStorage Keys (New)

Following humanizer- prefix convention:

```typescript
const STORAGE_KEYS = {
  // Existing
  personas: 'humanizer-bookshelf-personas',
  styles: 'humanizer-bookshelf-styles',
  books: 'humanizer-bookshelf-books',
  
  // New
  harvestBuckets: 'humanizer-bookshelf-harvest-buckets',
  narrativeArcs: 'humanizer-bookshelf-narrative-arcs',
  passageLinks: 'humanizer-bookshelf-passage-links',
};
```

All use JSON.stringify/parse with safe parsing.

---

## API Contracts (15 new endpoints)

### Harvest (5 endpoints)
- `GET /api/bookshelf/books/:id/harvest` - List buckets
- `POST /api/bookshelf/books/:id/harvest` - Create bucket
- `PATCH /api/bookshelf/harvest/:id` - Update status
- `POST /api/bookshelf/harvest/:id/approve` - Approve + merge
- `DELETE /api/bookshelf/harvest/:id` - Delete

### Arcs (5 endpoints)
- `GET /api/bookshelf/books/:id/arcs` - List arcs
- `POST /api/bookshelf/books/:id/arcs` - Create arc
- `PATCH /api/bookshelf/arcs/:id` - Update evaluation
- `POST /api/bookshelf/arcs/:id/assign` - Assign passages
- `DELETE /api/bookshelf/arcs/:id` - Delete

### Links (5 endpoints)
- `POST /api/bookshelf/links` - Create link
- `GET /api/bookshelf/passages/:id/usage` - Get usage
- `GET /api/bookshelf/books/:id/orphaned` - List orphaned
- `DELETE /api/bookshelf/links/:id` - Delete link
- (others as needed)

**All backward-compatible** - no breaking changes to existing API.

---

## Risk Assessment

### Medium Risk: Data Consistency
- **Risk**: Orphaned passages after chapter deletion
- **Mitigation**: Automatic detection + tagging + validation

### Low Risk: API Contracts
- **Risk**: Breaking existing BookProject API
- **Mitigation**: All new endpoints, no changes to existing

### Low Risk: Storage
- **Risk**: localStorage size exceeded
- **Mitigation**: Phase 2 migration to SQLite within 2 weeks

### Very Low Risk: Types
- **Risk**: Type incompatibility with existing code
- **Mitigation**: All additive, no breaking changes

---

## Testing Strategy

### Unit Tests (Phase 1)
- Service creation/update/delete
- Status transitions
- JSON serialization
- Reference validation

### Integration Tests (Phase 2)
- Chapter deletion → orphan detection
- Link creation → validation
- Bucket approval → passage creation
- Arc assignment → passage tracking

### Data Integrity Tests (Phase 3)
- SQL queries verify no orphaned records
- Foreign key constraints enforced
- Migration preserves all data
- Uniqueness constraints work

---

## Success Metrics

When complete, you should have:

- [ ] 3 new types in @humanizer/core
- [ ] 3 new service classes
- [ ] 15 new API endpoints
- [ ] 0 orphaned passages possible
- [ ] 0 broken reference possible
- [ ] SQLite backup ready
- [ ] All tests passing
- [ ] Full documentation

---

## Files You Need to Read

1. **Main Audit**: `/Users/tem/humanizer_root/humanizer-gm/docs/BOOKSHELF_SCHEMA_AUDIT.md` (848 lines, comprehensive)

2. **Type Definitions**: See Schema Additions section in audit

3. **Implementation Plan**: `/Users/tem/humanizer_root/humanizer-gm/docs/BOOKSHELF_IMPLEMENTATION_CHECKLIST.md`

---

## Next Steps

1. **Data Agent Review**: You're reading this!
2. **Design Review**: Architect Agent approves implementation plan
3. **Type Definition**: Copy types from audit into @humanizer/core (1 hour)
4. **Service Implementation**: Create 3 service classes (4 hours)
5. **Testing**: Unit + integration tests (3 hours)
6. **API Wiring**: Connect endpoints (2 hours)
7. **SQLite Migration**: Schema + hybrid layer (8 hours)

**Total**: ~3-4 days for Phase 1-2, 1-2 weeks for Phase 3

---

## Questions?

Refer to the comprehensive audit:
`/Users/tem/humanizer_root/humanizer-gm/docs/BOOKSHELF_SCHEMA_AUDIT.md`

For implementation details:
`/Users/tem/humanizer_root/humanizer-gm/docs/BOOKSHELF_IMPLEMENTATION_CHECKLIST.md`

