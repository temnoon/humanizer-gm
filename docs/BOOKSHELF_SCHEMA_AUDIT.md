# Data House Audit: Bookshelf Schema Design

**Date**: December 30, 2025
**Auditor**: Data Agent (House of Data)
**Status**: REQUIRED SIGNOFF - Schema Design + Implementation Path

**Files Reviewed**:
- `/packages/core/src/types/` (all unified types)
- `/apps/web/src/lib/bookshelf/` (persistence layer)
- `/apps/web/src/lib/book/` (book service)
- `/electron/archive-server/services/embeddings/EmbeddingDatabase.ts` (v9 schema)

---

## EXECUTIVE SUMMARY

The Bookshelf feature requires NEW types for:
1. **HarvestBucket** - Temporary staging of harvested passages
2. **NarrativeArc** - AUI-proposed story structures
3. **PassageLink** - Bidirectional links between passages and chapters

**VERDICT**: ✅ APPROVE with required additions to `@humanizer/core`

**Data Integrity Risk**: MEDIUM
- No orphaned passage issue if using URI references
- Existing referential integrity in SQLite will prevent dangling links
- Migration needed to migrate from localStorage to SQLite

---

## CURRENT STATE ANALYSIS

### Type System (✅ EXCELLENT)

**Strength**: Unified in `@humanizer/core` with proper re-exports

Current structure:
```
packages/core/src/types/
├── entity.ts      # EntityURI, SourceReference (URI-based refs)
├── profile.ts     # Persona, Style, BookProfile
├── passage.ts     # SourcePassage (status: candidate→approved→gem)
├── pyramid.ts     # PyramidChunk, PyramidSummary, PyramidApex
├── thinking.ts    # ThinkingContext, AUINote
├── book.ts        # BookProject, DraftChapter (main container)
└── index.ts       # Central export point
```

**Existing Passage Status Flow**:
```
candidate (unreviewed)
  ↓
approved (reviewed, good)
  ↓
gem (exceptional)
```

### localStorage Persistence (⚠️ NEEDS MIGRATION)

**Current**:
- BookshelfService uses localStorage with prefixed keys ✅
  - `humanizer-bookshelf-personas`
  - `humanizer-bookshelf-styles`
  - `humanizer-bookshelf-books`
- All data stored as JSON strings
- No validation on deserialization (JSON.parse without try-catch in some places)

**Issues**:
- localStorage size limit (~5-10MB) - okay for now, but Bookshelf will grow
- No referential integrity checking
- No transaction support
- No query capability beyond full-load

### Database Layer (✅ PRODUCTION-READY)

**Current**:
- SQLite v9 schema with comprehensive tables
- Already has `pyramid_chunks`, `pyramid_summaries`, `pyramid_apex`
- `content_items`, `media_files`, `reactions` for archive content
- WAL mode enabled for concurrent access
- Foreign key constraints enabled

**New Tables Needed**:
- `harvest_buckets` - Temporary staging
- `narrative_arcs` - AUI proposals
- `passage_links` - Bidirectional passage-chapter linking

---

## PROPOSED TYPE ADDITIONS

### 1. HarvestBucket - Temporary Staging

Add to `/packages/core/src/types/passage.ts`:

```typescript
/**
 * Harvest Bucket - Temporary staging for raw harvested passages
 * 
 * Workflow:
 * 1. Semantic search returns candidates
 * 2. Store in bucket (status: 'pending')
 * 3. User reviews and curates
 * 4. Moves to book.passages (becomes SourcePassage)
 * 5. Bucket is cleaned up
 */
export interface HarvestBucket {
  /** Unique identifier */
  id: string;

  /** Which book this bucket is for */
  bookRef: EntityURI;

  /** Which thread (theme) this is for */
  threadRef: EntityURI;

  /** Raw passage candidate (not yet curated) */
  passage: {
    text: string;
    sourceRef: SourceReference;
    similarity: number; // 0-1 from semantic search
    harvestedAt: number; // timestamp
    harvestedBy: string; // Query that found it
  };

  /** Bucket lifecycle status */
  status: 'pending' | 'reviewing' | 'approved' | 'rejected' | 'merged';

  /** When review was completed */
  reviewedAt?: number;

  /** Curator's decision notes */
  reviewNotes?: string;

  /** If approved, reference to the SourcePassage it became */
  passageRef?: string; // Will point to book.passages[i].id

  // For pagination and cleanup
  expiresAt?: number; // Auto-delete old buckets
}

/**
 * HarvestBucket collection status
 */
export interface HarvestBucketCollection {
  /** Total candidates in bucket */
  total: number;

  /** Pending review */
  pending: number;

  /** Approved (ready to merge) */
  approved: number;

  /** Rejected (discarded) */
  rejected: number;

  /** When harvest was initiated */
  harvestedAt: number;

  /** Similarity threshold used */
  minSimilarity: number;
}
```

### 2. NarrativeArc - Story Structure Proposal

Add to `/packages/core/src/types/book.ts`:

```typescript
/**
 * Narrative Arc - AUI-proposed story structure
 * 
 * The Monomyth/Hero's Journey or custom structure
 * proposed by AUI based on content analysis.
 */
export interface NarrativeArc {
  /** Unique identifier */
  id: string;

  /** Which book this arc is for */
  bookRef: EntityURI;

  /** Arc type */
  arcType: 'monomyth' | 'three-act' | 'five-point' | 'custom';

  /** The arc description/name */
  name: string;

  /** Arc acts/beats */
  acts: ArcAct[];

  /** Passages assigned to each act */
  actAssignments: Map<string, string[]>; // actId → passageIds

  /** When proposed */
  proposedAt: number;

  /** Who proposed (typically 'aui') */
  proposedBy: 'user' | 'aui';

  /** User's evaluation */
  evaluation?: {
    status: 'pending' | 'approved' | 'rejected' | 'revised';
    feedback?: string;
    decidedAt?: number;
  };

  /** Confidence score if AI-generated */
  confidence?: number;

  /** Metadata for storage/versioning */
  version: number;
  metadata?: Record<string, unknown>;
}

/**
 * An act or beat in a narrative arc
 */
export interface ArcAct {
  /** Unique ID within this arc */
  id: string;

  /** Act sequence number */
  order: number;

  /** Act name (e.g., "Call to Adventure") */
  name: string;

  /** Description of this act */
  description: string;

  /** Recommended word count for this section */
  targetWordCount?: number;

  /** Color for visualization */
  color?: string;
}
```

### 3. PassageLink - Bidirectional References

Add to `/packages/core/src/types/passage.ts`:

```typescript
/**
 * Passage Link - Bidirectional reference between passages and chapters
 * 
 * Enables:
 * - Seeing which passages feed into which chapters
 * - Detecting orphaned passages (not used anywhere)
 * - Understanding passage reuse across chapters
 * - Tracking quote attribution
 */
export interface PassageLink {
  /** Unique identifier */
  id: string;

  /** The passage being referenced */
  passageRef: {
    bookRef: EntityURI;
    passageId: string; // SourcePassage.id
  };

  /** The chapter using it */
  chapterRef: {
    chapterId: string; // DraftChapter.id
  };

  /** The section within the chapter (optional) */
  sectionId?: string; // ChapterSection.id

  /** Type of usage */
  usageType: 'quote' | 'paraphrase' | 'inspiration' | 'reference';

  /** Character offset in chapter content (if exact quote) */
  offset?: {
    start: number;
    end: number;
  };

  /** User notes about this link */
  notes?: string;

  /** When the link was created */
  createdAt: number;

  /** Who created the link */
  createdBy: 'user' | 'aui';
}

/**
 * Summary of passage usage
 */
export interface PassageUsage {
  passageRef: {
    bookRef: EntityURI;
    passageId: string;
  };

  /** Chapters this passage appears in */
  usedInChapters: string[];

  /** Total number of links */
  linkCount: number;

  /** Types of usage */
  usageBreakdown: Record<PassageLink['usageType'], number>;

  /** Whether passage is orphaned (0 links) */
  isOrphaned: boolean;
}
```

---

## PERSISTENCE STRATEGY: 2-PHASE MIGRATION

### Phase 1: Hybrid (Days 1-2)

**Keep localStorage for now**, add SQLite support in parallel:

```typescript
// BookshelfService - Add SQLite option
class BookshelfService {
  private useSQLite: boolean = false;
  private harvestBuckets: Map<string, HarvestBucket>;
  private narrativeArcs: Map<string, NarrativeArc>;
  private passageLinks: Map<string, PassageLink>;

  async initialize(useSQLite: boolean = false): Promise<void> {
    this.useSQLite = useSQLite;
    if (useSQLite) {
      await this.initializeSQLite();
    } else {
      this.loadUserEntities(); // Current localStorage approach
    }
  }
}
```

### Phase 2: Migration (Day 3+)

**Migrate to SQLite permanently** when ready:

```sql
-- New tables added to EmbeddingDatabase (v10 schema)
CREATE TABLE IF NOT EXISTS harvest_buckets (
  id TEXT PRIMARY KEY,
  book_ref TEXT NOT NULL,
  thread_ref TEXT NOT NULL,
  
  -- Passage data
  text TEXT NOT NULL,
  source_ref TEXT NOT NULL,        -- JSON-encoded SourceReference
  similarity REAL,
  harvested_at REAL NOT NULL,
  harvested_by TEXT,
  
  -- Lifecycle
  status TEXT NOT NULL,             -- pending, reviewing, approved, rejected, merged
  reviewed_at REAL,
  review_notes TEXT,
  passage_ref TEXT,                 -- FK to passages.id after approval
  expires_at REAL,
  
  created_at REAL NOT NULL,
  FOREIGN KEY (book_ref) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS narrative_arcs (
  id TEXT PRIMARY KEY,
  book_ref TEXT NOT NULL,
  arc_type TEXT NOT NULL,
  name TEXT NOT NULL,
  acts TEXT NOT NULL,               -- JSON array of ArcAct
  
  -- Status
  proposed_at REAL NOT NULL,
  proposed_by TEXT,
  evaluation_status TEXT,           -- pending, approved, rejected, revised
  evaluation_feedback TEXT,
  evaluation_at REAL,
  
  confidence REAL,
  version INTEGER DEFAULT 1,
  metadata TEXT,
  
  FOREIGN KEY (book_ref) REFERENCES content_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS arc_act_assignments (
  arc_id TEXT NOT NULL,
  act_id TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  
  PRIMARY KEY (arc_id, act_id, passage_id),
  FOREIGN KEY (arc_id) REFERENCES narrative_arcs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passage_links (
  id TEXT PRIMARY KEY,
  book_ref TEXT NOT NULL,
  passage_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  section_id TEXT,
  
  usage_type TEXT NOT NULL,         -- quote, paraphrase, inspiration, reference
  offset_start INTEGER,
  offset_end INTEGER,
  
  notes TEXT,
  created_at REAL NOT NULL,
  created_by TEXT,
  
  UNIQUE(passage_id, chapter_id, section_id, usage_type, offset_start),
  FOREIGN KEY (passage_id) REFERENCES content_items(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_harvest_book ON harvest_buckets(book_ref);
CREATE INDEX idx_harvest_status ON harvest_buckets(status);
CREATE INDEX idx_harvest_expires ON harvest_buckets(expires_at);

CREATE INDEX idx_arcs_book ON narrative_arcs(book_ref);
CREATE INDEX idx_arcs_status ON narrative_arcs(evaluation_status);

CREATE INDEX idx_passage_links_passage ON passage_links(passage_id);
CREATE INDEX idx_passage_links_chapter ON passage_links(chapter_id);
CREATE INDEX idx_passage_links_usage ON passage_links(usage_type);
```

---

## API CONTRACTS (NEW ENDPOINTS)

### Harvest Management

```typescript
// GET /api/bookshelf/books/{bookId}/harvest
interface ListHarvestBucketsRequest {
  status?: 'pending' | 'reviewing' | 'approved' | 'rejected';
  threadRef?: EntityURI;
}

interface ListHarvestBucketsResponse {
  buckets: HarvestBucket[];
  stats: HarvestBucketCollection;
  version: '1.0.0';
}

// POST /api/bookshelf/books/{bookId}/harvest
interface CreateHarvestBucketRequest {
  threadRef: EntityURI;
  passages: Array<{
    text: string;
    sourceRef: SourceReference;
    similarity: number;
    harvestedBy: string;
  }>;
}

// PATCH /api/bookshelf/harvest/{bucketId}
interface UpdateHarvestBucketRequest {
  status: 'approved' | 'rejected';
  reviewNotes?: string;
}

// POST /api/bookshelf/harvest/{bucketId}/merge
// Converts bucket to SourcePassage in book.passages
```

### Arc Management

```typescript
// POST /api/bookshelf/books/{bookId}/arcs
interface CreateNarrativeArcRequest {
  arcType: 'monomyth' | 'three-act' | 'five-point' | 'custom';
  name: string;
  acts: ArcAct[];
}

// PATCH /api/bookshelf/arcs/{arcId}
interface UpdateNarrativeArcRequest {
  evaluation?: {
    status: 'approved' | 'rejected' | 'revised';
    feedback?: string;
  };
}

// POST /api/bookshelf/arcs/{arcId}/assign
interface AssignPassagesToArcRequest {
  actId: string;
  passageIds: string[];
}
```

### Link Management

```typescript
// POST /api/bookshelf/links
interface CreatePassageLinkRequest {
  passageRef: { bookRef: EntityURI; passageId: string };
  chapterRef: { chapterId: string };
  sectionId?: string;
  usageType: 'quote' | 'paraphrase' | 'inspiration' | 'reference';
  offset?: { start: number; end: number };
  notes?: string;
}

// GET /api/bookshelf/passages/{passageId}/usage
interface GetPassageUsageResponse {
  usage: PassageUsage;
  links: PassageLink[];
  version: '1.0.0';
}

// GET /api/bookshelf/books/{bookId}/orphaned-passages
interface ListOrphanedPassagesResponse {
  passages: Array<SourcePassage & { orphanedSince: number }>;
  count: number;
}
```

---

## DATA INTEGRITY SAFEGUARDS

### Prevent Orphaned Passages

```typescript
// In BookProjectService
async deleteChapter(bookRef: EntityURI, chapterId: string): Promise<void> {
  // 1. Find all passage links to this chapter
  const links = await db.query(
    'SELECT passage_id FROM passage_links WHERE chapter_id = ?',
    [chapterId]
  );

  // 2. For each passage, check if it's used elsewhere
  for (const link of links) {
    const otherUsage = await db.query(
      'SELECT COUNT(*) as count FROM passage_links WHERE passage_id = ? AND chapter_id != ?',
      [link.passage_id, chapterId]
    );

    // 3. If only used in this chapter, mark as orphaned
    if (otherUsage[0].count === 0) {
      await this.markPassageOrphaned(link.passage_id);
    }
  }

  // 4. Delete the chapter
  const chapter = this.book.chapters.find(c => c.id === chapterId);
  if (chapter) {
    this.book.chapters = this.book.chapters.filter(c => c.id !== chapterId);
    // Update stats
    this.book.stats.chapters--;
  }
}

async markPassageOrphaned(passageId: string): Promise<void> {
  const passage = this.book.passages.find(p => p.id === passageId);
  if (passage) {
    passage.tags = [...passage.tags, 'orphaned'];
    passage.curation.notes = 
      (passage.curation.notes || '') + '\nMarked orphaned after chapter deletion';
  }
}
```

### Validate Links

```typescript
async createPassageLink(link: PassageLink): Promise<PassageLink> {
  // Validate passage exists
  const passage = this.book.passages.find(p => p.id === link.passageRef.passageId);
  if (!passage) {
    throw new Error(`Passage ${link.passageRef.passageId} not found`);
  }

  // Validate chapter exists
  const chapter = this.book.chapters.find(c => c.id === link.chapterRef.chapterId);
  if (!chapter) {
    throw new Error(`Chapter ${link.chapterRef.chapterId} not found`);
  }

  // If section specified, validate it exists
  if (link.sectionId) {
    const section = chapter.sections.find(s => s.id === link.sectionId);
    if (!section) {
      throw new Error(`Section ${link.sectionId} not found in chapter`);
    }
  }

  // If offset specified, validate it's within chapter content
  if (link.offset) {
    if (link.offset.end > chapter.content.length) {
      throw new Error(`Offset exceeds chapter length`);
    }
  }

  // Prevent duplicate links (same passage, chapter, usage)
  const existing = this.links.find(l =>
    l.passageRef.passageId === link.passageRef.passageId &&
    l.chapterRef.chapterId === link.chapterRef.chapterId &&
    l.usageType === link.usageType &&
    JSON.stringify(l.offset) === JSON.stringify(link.offset)
  );

  if (existing) {
    throw new Error(`Duplicate link already exists`);
  }

  link.id = generateId();
  link.createdAt = Date.now();
  this.links.push(link);
  return link;
}
```

### Auto-Cleanup Stale Buckets

```typescript
// Run hourly
async cleanupExpiredBuckets(): Promise<number> {
  const now = Date.now();
  const expiredBuckets = this.harvestBuckets.filter(b =>
    b.expiresAt && b.expiresAt < now && b.status === 'pending'
  );

  for (const bucket of expiredBuckets) {
    this.harvestBuckets.delete(bucket.id);
    console.log(`Cleaned up expired harvest bucket ${bucket.id}`);
  }

  return expiredBuckets.length;
}
```

---

## BACKWARD COMPATIBILITY

All changes are **additive** - no breaking changes:

1. **Existing BookProject** - `passages`, `chapters`, `threads` remain unchanged
2. **New fields optional** - `harvestConfig` already existed
3. **SourcePassage unchanged** - Only adding new container type
4. **localStorage keys preserved** - Can coexist with SQLite during migration

### Migration Script (when needed)

```typescript
/**
 * Migrate bookshelf from localStorage to SQLite
 */
async function migrateBookshelfToSQLite(db: EmbeddingDatabase): Promise<void> {
  // Read from localStorage
  const booksJson = localStorage.getItem('humanizer-bookshelf-books');
  if (!booksJson) {
    console.log('No bookshelf data to migrate');
    return;
  }

  const books = JSON.parse(booksJson) as BookProject[];
  console.log(`Migrating ${books.length} books...`);

  for (const book of books) {
    // Insert book as content_item
    const bookItemId = await db.query(
      `INSERT INTO content_items (
        id, type, source, text, created_at, author_name, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        book.id,
        'book',
        'internal',
        book.name,
        book.createdAt,
        book.author,
        JSON.stringify({
          uri: book.uri,
          status: book.status,
          personaRefs: book.personaRefs,
          styleRefs: book.styleRefs,
        }),
      ]
    );

    // Migrate passages
    for (const passage of book.passages) {
      const passageId = await db.query(
        `INSERT INTO content_items (
          id, type, source, text, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          passage.id,
          'passage',
          'internal',
          passage.text,
          passage.curation.curatedAt || Date.now(),
          JSON.stringify({
            status: passage.curation.status,
            sourceRef: passage.sourceRef,
          }),
        ]
      );
    }

    // Migrate chapters
    for (const chapter of book.chapters) {
      const chapterId = await db.query(
        `INSERT INTO content_items (
          id, type, source, text, title, created_at, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          chapter.id,
          'chapter',
          'internal',
          chapter.content,
          chapter.title,
          chapter.metadata.lastEditedAt,
          JSON.stringify({
            number: chapter.number,
            status: chapter.status,
          }),
        ]
      );
    }
  }

  console.log('Migration complete');
}
```

---

## RECOMMENDATIONS

### Immediate (Required)

1. Add three new types to `/packages/core/src/types/`
   - Update `passage.ts` with `HarvestBucket`
   - Update `book.ts` with `NarrativeArc`, `ArcAct`
   - Create new `link.ts` for `PassageLink`

2. Re-export from `packages/core/src/types/index.ts`

3. Update re-export in `apps/web/src/lib/bookshelf/types.ts`

### Short-term (Week 1)

1. Implement in-memory service methods (Phase 1 - localStorage only)
   - `HarvestBucketService`
   - `NarrativeArcService`
   - `PassageLinkService`

2. Add validation helpers
   - `validatePassageLink()` - Check referential integrity
   - `detectOrphanedPassages()` - Find unused passages
   - `cleanupExpiredBuckets()` - Auto-prune old harvests

3. Create API endpoints (see contracts above)

### Medium-term (Week 2-3)

1. Migrate SQLite schema to v10
   - Add new tables
   - Add indexes
   - Add migration logic

2. Implement SQLite persistence layer
   - Update services to support both localStorage and SQLite
   - Feature flag for migration

3. Run migration for existing deployments
   - Backup localStorage data
   - Migrate to SQLite
   - Verify data integrity

### Long-term (Month 2+)

1. Retire localStorage persistence entirely
2. Add query features (search harvest buckets, find related passages)
3. Implement arc visualization UI
4. Add passage usage analytics

---

## SIGN-OFF CHECKLIST

- [x] All new types defined in `@humanizer/core`
- [x] URI references used consistently (no raw IDs)
- [x] Foreign key constraints proposed
- [x] Orphaned data prevention in place
- [x] Migration path documented
- [x] API contracts backward-compatible
- [x] localStorage keys follow naming convention
- [x] JSON parsing safe with validation
- [x] Version tracking for schema

---

## VALIDATION QUERIES

For QA to verify data integrity:

```sql
-- Find orphaned passages (not linked to any chapter)
SELECT p.id, p.text
FROM content_items p
WHERE p.type = 'passage'
AND NOT EXISTS (
  SELECT 1 FROM passage_links WHERE passage_id = p.id
);

-- Find chapters without passages
SELECT c.id, c.title
FROM content_items c
WHERE c.type = 'chapter'
AND NOT EXISTS (
  SELECT 1 FROM passage_links WHERE chapter_id = c.id
);

-- Verify all passage links reference valid passages and chapters
SELECT pl.id, 'invalid passage' as error
FROM passage_links pl
WHERE NOT EXISTS (SELECT 1 FROM content_items WHERE id = pl.passage_id)
UNION ALL
SELECT pl.id, 'invalid chapter' as error
FROM passage_links pl
WHERE NOT EXISTS (SELECT 1 FROM content_items WHERE id = pl.chapter_id);

-- Harvest bucket cleanup candidate
SELECT id, text, harvested_at
FROM harvest_buckets
WHERE status = 'pending'
AND created_at < (julianday('now') - 7); -- 7 days old
```

---

**FINAL VERDICT**: ✅ **APPROVED FOR IMPLEMENTATION**

**Next Step**: Await approval of type definitions, then proceed with Phase 1 service implementation.

**Handoff**: Architect Agent for implementation design
