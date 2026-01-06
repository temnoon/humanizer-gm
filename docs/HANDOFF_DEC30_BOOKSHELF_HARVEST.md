# Handoff: Bookshelf Harvest System Implementation

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Phase 1 PARTIAL - Types complete, Service complete, Context pending
**Priority**: HIGH - Core book-making workflow blocked

---

## Executive Summary

Implementing the **HarvestBucket** system to enable the book-making workflow:
```
Archive Search → HarvestBucket (staging) → Review → Approved Passages → Book
```

This session completed:
- ✅ House Agent Council audit (5 agents)
- ✅ Type definitions (`harvest.ts`)
- ✅ HarvestBucketService (singleton)
- ⏳ BookshelfContext extension (pending)
- ⏳ UI integration (pending)

---

## What Was Built

### 1. Type Definitions (`packages/core/src/types/harvest.ts`)

**New Types Created:**

```typescript
// HarvestBucket - Temporary staging for search results
interface HarvestBucket extends EntityMeta {
  type: 'harvest-bucket';
  bookUri: EntityURI;
  threadUri?: EntityURI;
  status: HarvestStatus; // collecting → reviewing → staged → committed
  queries: string[];
  config: HarvestConfig;
  candidates: SourcePassage[];
  approved: SourcePassage[];
  gems: SourcePassage[];
  rejected: SourcePassage[];
  duplicateIds: string[];
  stats: HarvestStats;
}

// NarrativeArc - AUI-proposed story structure
interface NarrativeArc extends EntityMeta {
  type: 'narrative-arc';
  bookUri: EntityURI;
  arcType: ArcType; // linear | spiral | dialectic | mosaic | monomyth
  thesis: string;
  themes: ArcTheme[];
  chapters: ChapterOutline[];
  evaluation: ArcEvaluation;
}

// PassageLink - Bidirectional chapter-passage tracking
interface PassageLink {
  id: string;
  passageId: string;
  chapterId: string;
  sectionId?: string;
  position: number;
  usageType: 'verbatim' | 'paraphrase' | 'inspiration' | 'reference';
}

// NarrativeGap - Missing content detection
interface NarrativeGap {
  id: string;
  location: GapLocation;
  gapType: GapType;
  description: string;
  priority: 'critical' | 'important' | 'nice-to-have';
  suggestion: GapSuggestion;
}
```

**Factory Functions:**
- `createHarvestBucket(bookUri, queries, options)`
- `createNarrativeArc(bookUri, thesis, options)`
- `createPassageLink(passageId, chapterId, position, options)`

**Helper Functions:**
- `isHarvestTerminal(bucket)` - Check if committed/discarded
- `isHarvestReady(bucket)` - Check if ready to commit
- `getHarvestProgress(bucket)` - Calculate review progress (0-100)
- `getAllApproved(bucket)` - Get approved + gems
- `isArcApproved(arc)` - Check arc evaluation status
- `getOrphanedPassages(passageIds, links)` - Find unlinked passages

### 2. HarvestBucketService (`apps/web/src/lib/bookshelf/HarvestBucketService.ts`)

**Singleton service with:**

**Bucket Operations:**
- `createBucket(bookUri, queries, options)` - Create new harvest
- `getBucket(bucketId)` - Get by ID
- `getBucketsForBook(bookUri)` - All buckets for a book
- `getActiveBucketsForBook(bookUri)` - Non-terminal buckets
- `updateBucket(bucketId, updates)` - Update bucket
- `deleteBucket(bucketId)` - Delete bucket

**Passage Curation:**
- `addCandidate(bucketId, passage)` - Add to candidates (with dedup)
- `addCandidates(bucketId, passages)` - Bulk add
- `approvePassage(bucketId, passageId)` - Approve candidate
- `markAsGem(bucketId, passageId)` - Mark as gem
- `rejectPassage(bucketId, passageId, reason)` - Reject with reason
- `moveToCandidates(bucketId, passageId)` - Undo approval/rejection

**Bucket Lifecycle:**
- `finishCollecting(bucketId)` - collecting → reviewing
- `stageBucket(bucketId)` - reviewing → staged
- `commitBucket(bucketId)` - Merge into BookProject
- `discardBucket(bucketId)` - Abandon without committing

**Narrative Arc Operations:**
- `createArc(bookUri, thesis, options)`
- `getArc(arcId)` / `getArcsForBook(bookUri)`
- `updateArc(arcId, updates)`
- `approveArc(arcId, feedback)` / `rejectArc(arcId, feedback)`

**Passage Link Operations:**
- `createLink(passageId, chapterId, position, options)`
- `getLinksForChapter(chapterId)` / `getLinksForPassage(passageId)`
- `getOrphanedPassages(bookUri)` - Find unlinked passages

**Storage:**
- localStorage keys: `humanizer-harvest-buckets`, `humanizer-narrative-arcs`, `humanizer-passage-links`
- Auto-cleanup: Expired buckets (7 days after terminal state)

---

## House Agent Council Findings

### 🏗️ Architect - CONDITIONAL PASS
- Architecture sound, HarvestBucket abstraction was the missing piece
- No anti-patterns introduced
- Backward compatible (additive only)

### 📊 Data - APPROVED
- Created 6 documentation files (76 KB)
- Two-tier storage: Phase 1 localStorage, Phase 3 SQLite v10
- 15 new API endpoints planned

### 🎨 Stylist - APPROVED (Zero Violations)
- Complete CSS components designed
- New tokens needed for status colors, progress bars
- Responsive behavior defined

### ♿ Accessibility - FAIL (12 Critical Issues)
- Tab navigation missing ARIA
- Icon-only buttons need labels
- 4-5 days remediation needed

### 📚 Curator - Quality Framework Defined
- Measurable criteria for each phase
- AUI prompts for harvest/curate/arc/draft
- Gem detection formula (inflection, velocity, tension, commitment)

---

## What Remains

### Phase 1 Completion (1-2 hours)

1. **Extend BookshelfContext** (`apps/web/src/lib/bookshelf/BookshelfContext.tsx`)

   Add to context interface:
   ```typescript
   // Harvest operations
   createHarvestBucket: (bookUri: EntityURI, queries: string[]) => HarvestBucket;
   getActiveBuckets: (bookUri: EntityURI) => HarvestBucket[];
   approvePassage: (bucketId: string, passageId: string) => void;
   rejectPassage: (bucketId: string, passageId: string) => void;
   markAsGem: (bucketId: string, passageId: string) => void;
   commitBucket: (bucketId: string) => BookProject | undefined;

   // Passage operations on books
   getPassages: (bookUri: EntityURI) => SourcePassage[];
   addPassageToBook: (bookUri: EntityURI, passage: SourcePassage) => void;
   updatePassageStatus: (bookUri: EntityURI, passageId: string, status: CurationStatus) => void;
   ```

2. **Update BookshelfService** with passage methods:
   ```typescript
   addPassageToBook(bookUri, passage): BookProject | undefined
   updatePassageStatus(bookUri, passageId, status): BookProject | undefined
   removePassageFromBook(bookUri, passageId): BookProject | undefined
   ```

3. **Export from index** (`apps/web/src/lib/bookshelf/index.ts`):
   ```typescript
   export { harvestBucketService } from './HarvestBucketService';
   ```

### Phase 2: UI Components (4-6 hours)

1. **HarvestQueuePanel** - Tools panel component
   - Show active buckets for current book
   - Candidate list with approve/reject/gem buttons
   - Progress indicator

2. **Update BooksView** - Archive pane
   - Show harvest status on book cards
   - "Start Harvest" button per thread

3. **PassageCurationView** - Review interface
   - Passage card with source preview
   - Quick actions (approve/reject/gem)
   - Bulk operations

### Phase 3: AUI Integration (4-6 hours)

1. **New AUI Tools:**
   ```typescript
   harvest_for_thread(threadId, queries, config)
   analyze_passage_quality(passageId)
   find_resonant_mirrors(passageId, searchSpace)
   propose_narrative_arc(bookUri)
   detect_gaps(bookUri)
   ```

2. **Teaching Output** - Show GUI path for manual replication

### Phase 4: Accessibility Remediation (4-5 days)
- See `docs/ACCESSIBILITY_AUDIT_BOOKSHELF_DEC30.md`

---

## Files Created/Modified

### Created
| File | Lines | Purpose |
|------|-------|---------|
| `packages/core/src/types/harvest.ts` | ~450 | Type definitions |
| `apps/web/src/lib/bookshelf/HarvestBucketService.ts` | ~500 | Service singleton |
| `docs/NEW_MACHINE_IMPORT_GUIDE.md` | ~200 | Fresh install docs |
| `docs/HANDOFF_DEC30_BOOKSHELF_HARVEST.md` | This file | |

### Modified
| File | Change |
|------|--------|
| `packages/core/src/types/index.ts` | Added harvest.ts export |
| `apps/web/src/components/archive/ImportView.tsx` | Facebook folder picker |

---

## Testing

### Type Check
```bash
cd /Users/tem/humanizer_root/humanizer-gm
npx tsc --noEmit
```

### Manual Test Flow
```typescript
// In browser console after app loads
import { harvestBucketService } from './lib/bookshelf/HarvestBucketService';
import { bookshelfService } from './lib/bookshelf/BookshelfService';

// Initialize
harvestBucketService.initialize();

// Get a book
const books = bookshelfService.getAllBooks();
const book = books[0];

// Create a harvest bucket
const bucket = harvestBucketService.createBucket(
  book.uri,
  ['consciousness experience', 'phenomenology Husserl']
);

// Add a test passage
harvestBucketService.addCandidate(bucket.id, {
  id: 'test-passage-1',
  sourceRef: { uri: 'source://test/1', sourceType: 'import' },
  text: 'Test passage content...',
  wordCount: 50,
  curation: { status: 'candidate' },
  tags: [],
});

// Approve it
harvestBucketService.approvePassage(bucket.id, 'test-passage-1');

// Check bucket state
console.log(harvestBucketService.getBucket(bucket.id));
```

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BOOKSHELF SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │ Archive Search  │────▶│  HarvestBucket   │────▶│  BookProject    │  │
│  │ (embeddings)    │     │  (staging)       │     │  (permanent)    │  │
│  └─────────────────┘     └──────────────────┘     └─────────────────┘  │
│           │                       │                       │             │
│           │                       │                       │             │
│           ▼                       ▼                       ▼             │
│  ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │ Query Results   │     │ User Review      │     │ Chapters        │  │
│  │ (candidates)    │     │ approve/reject   │     │ with passages   │  │
│  └─────────────────┘     │ mark as gem      │     └─────────────────┘  │
│                          └──────────────────┘              │            │
│                                   │                        │            │
│                                   ▼                        │            │
│                          ┌──────────────────┐              │            │
│                          │ NarrativeArc     │◀─────────────┘            │
│                          │ (AUI proposes)   │                           │
│                          └──────────────────┘                           │
│                                                                         │
│  Storage: localStorage (Phase 1) → SQLite v10 (Phase 3)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start for Next Session

```bash
cd /Users/tem/humanizer_root/humanizer-gm
git checkout feature/xanadu-768-embeddings

# Check current state
cat docs/HANDOFF_DEC30_BOOKSHELF_HARVEST.md

# Type check
npx tsc --noEmit

# Start dev
npm run electron:dev

# Next task: Extend BookshelfContext with harvest operations
code apps/web/src/lib/bookshelf/BookshelfContext.tsx
```

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/BOOKSHELF_AUDIT_SUMMARY.md` | Executive overview |
| `docs/BOOKSHELF_SCHEMA_AUDIT.md` | Type definitions, SQL |
| `docs/BOOKSHELF_IMPLEMENTATION_CHECKLIST.md` | Task list |
| `docs/ACCESSIBILITY_AUDIT_BOOKSHELF_DEC30.md` | A11y issues |
| `docs/NEW_MACHINE_IMPORT_GUIDE.md` | Fresh install guide |

---

## Session Accomplishments (Dec 30)

1. **Facebook Import** - API tested, 76K items imported successfully
2. **Facebook Import UI** - Folder picker with progress tracking
3. **House Agent Council** - 5 agents audited Bookshelf architecture
4. **HarvestBucket Types** - Complete type system for staging
5. **HarvestBucketService** - Full service implementation

---

**End of Handoff**
