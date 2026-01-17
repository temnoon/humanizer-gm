# Book Studio Data Schema Documentation

## Quick Start

Start here to understand the data schema requirements for Book Studio:

1. **Executive Summary** (5 min read)
   - /docs/BOOK_STUDIO_DATA_AUDIT_SUMMARY.txt
   - Critical issues overview
   - Mandatory fixes list
   - Implementation timeline

2. **Full Specification** (20 min read)
   - /docs/BOOK_STUDIO_DATA_SCHEMA.md
   - All date field specifications
   - Type definitions
   - API contracts
   - Migration guide
   - Validation rules

3. **Implementation Guide** (10 min read)
   - /docs/BOOK_STUDIO_DATA_IMPLEMENTATION.md
   - Files to create/modify
   - Database schema
   - Testing checklist
   - Critical path

## Key Points

### Temporal Metadata
Every data item flows through multiple timestamp fields:
- **sourceCreatedAt**: Original creation on platform (Unix seconds)
- **harvestedAt**: When imported into Book Studio (ISO string)
- **importedAt**: When moved from staging to book (ISO string, optional)
- **createdAt**: Book/Chapter creation timestamp (ISO string)

### Type System
All types defined in: `/humanizer-gm/packages/core/src/types/`
- Use @humanizer/core as single source of truth
- Frontend imports types, never duplicates
- Archive and Book Studio share compatible types

### Zero-Date Detection
Invalid dates are detected and marked:
- createdAt == 0 (epoch zero)
- createdAt < 157680000 (before 1975)
- createdAt == '1970-01-01T00:00:00Z'
- null, undefined, empty string
- Status field indicates: 'known', 'approximate', or 'unknown'

### Metadata Preservation
All sourceMetadata from Archive is preserved as-is:
- Original platform fields kept verbatim
- Date recovery attempts logged
- Audit trail shows what was recovered
- User can always trace back to source

## Document Details

### BOOK_STUDIO_DATA_AUDIT_SUMMARY.txt
- **Audience**: Architect, Team Lead, Product Manager
- **Purpose**: Quick overview of critical issues and fixes
- **Sections**: 
  - Executive Summary
  - Critical Findings (4 major issues)
  - Mandatory Fixes
  - Implementation Order
  - Sign-Off Requirements
  - Next Steps

### BOOK_STUDIO_DATA_SCHEMA.md
- **Audience**: Developers implementing Book Studio
- **Purpose**: Complete technical specification
- **Sections**:
  - Temporal Integrity Crisis (the problem)
  - Data Layers & Responsibilities (architecture)
  - Unified Schema Specification (date types, helpers)
  - Archive Layer Schema (SearchResult)
  - Book Studio Schema (HarvestCard, Book, Chapter)
  - Migration Guide (fixing bad data)
  - Type System Alignment
  - Backward Compatibility
  - Metadata Flow Diagram
  - API Contract Specifications
  - Validation Rules
  - Testing Checklist
  - Signoff Requirements
  - Critical Commandments

### BOOK_STUDIO_DATA_IMPLEMENTATION.md
- **Audience**: Developers starting implementation
- **Purpose**: Actionable implementation checklist
- **Sections**:
  - Files to Create/Modify (with paths)
  - Migration Script
  - Data Flow Verification
  - Testing Checklist
  - Backward Compatibility
  - Sign-Off Points
  - Critical Path (implementation order)

## Files Affected

### New Files to Create
1. `/packages/core/src/types/book-studio.ts`
   - HarvestCard, Book, Chapter types
   - Date helper functions
   - CardGrade interface

2. `/electron/book-studio/database/migrations.ts`
   - SQLite schema for harvest_cards
   - Date normalization columns

3. `/electron/book-studio/migrations/normalize-dates.ts`
   - Migration script for existing data
   - Zero-date detection and recovery

### Files to Modify
1. `/electron/archive-server/routes/embeddings.ts`
   - Clarify SearchResult.createdAt type
   - Add exportedAt field
   - Add metadata.date_source field

2. `/electron/book-studio/services/HarvestService.ts`
   - Implement date normalization
   - Set sourceCreatedAtStatus
   - Preserve sourceMetadata

3. `/humanizer-sandbox/src/book-studio/types.ts`
   - Import from @humanizer/core
   - Remove duplicate definitions
   - Keep UI state types

4. `/humanizer-sandbox/src/archive-reader/index.ts`
   - Update SearchResult interface
   - Add exportedAt field
   - Update metadata type

## Critical Path

1. **Week 1**: Create unified types in @humanizer/core
2. **Week 2**: Implement date normalization logic
3. **Week 3**: Update frontend imports and test
4. **Week 4**: Code review and merge

## Mandatory Checks Before Merge

- [ ] SearchResult.createdAt is always number (Unix seconds)
- [ ] HarvestCard has sourceCreatedAt + sourceCreatedAtStatus
- [ ] sourceMetadata always preserved from Archive
- [ ] Zero-date detection active in HarvestService
- [ ] Frontend imports types from @humanizer/core
- [ ] No type duplication between packages
- [ ] Database schema includes temporal fields
- [ ] API responses use consistent ISO 8601 format
- [ ] Migration script handles existing bad data
- [ ] All tests pass

## Related Documents

- /docs/BOOK_STUDIO_API_DESIGN.md - API architecture
- /docs/BOOK_STUDIO_ARCHITECTURE.txt - System layers
- /CLAUDE.md - Development guide (overall)
- /docs/PHILOSOPHY_STATE_DEC25.md - Design philosophy

## Questions?

1. **What are the date field semantics?**
   → See BOOK_STUDIO_DATA_SCHEMA.md, "Unified Schema Specification"

2. **How do I preserve original dates through import?**
   → See BOOK_STUDIO_DATA_SCHEMA.md, "Metadata Flow Diagram"

3. **What about existing data with bad dates?**
   → See BOOK_STUDIO_DATA_SCHEMA.md, "Migration Guide"

4. **What files do I need to change?**
   → See BOOK_STUDIO_DATA_IMPLEMENTATION.md, "Files to Create/Modify"

5. **How do I test this?**
   → See BOOK_STUDIO_DATA_IMPLEMENTATION.md, "Testing Checklist"

---

**House of Data**  
Data integrity guardian of Humanizer  
January 16, 2026
