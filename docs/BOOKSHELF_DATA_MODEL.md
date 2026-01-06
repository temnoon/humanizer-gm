# Bookshelf Data Model - Visual Reference

**Purpose**: Quick visual reference for the data relationships and workflows

---

## Data Hierarchy

```
User
  └── Bookshelf (registry of all entities)
      ├── Personas (voice templates)
      ├── Styles (writing techniques)
      └── Books
          └── BookProject (main container)
              ├── Threads (thematic organization)
              ├── SourcePassages (curated text)
              │   └── PassageLinks (to chapters)
              ├── DraftChapters (written content)
              │   └── ChapterSections (subdivisions)
              ├── HarvestBuckets (temp staging)
              │   └── → becomes SourcePassage on approval
              ├── NarrativeArcs (story structures)
              │   └── ArcActs (with passage assignments)
              └── PyramidStructure (hierarchical summary)
```

---

## Harvest Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. SEMANTIC SEARCH                                      │
└─────────────────────────────────────────────────────────┘
         ↓
User searches "themes of failure"
Database returns 50 similar passages
         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. CREATE HARVEST BUCKET                                │
└─────────────────────────────────────────────────────────┘
         ↓
HarvestBucket {
  bookRef: "book://user/my-novel",
  threadRef: "thread://resilience",
  passages: [50 candidates],
  status: "pending",
  similarity: 0.75+
}
         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. CURATOR REVIEWS                                      │
└─────────────────────────────────────────────────────────┘
         ↓
For each passage:
  - Read text
  - Decide: approve / reject / skip
  - Add notes if needed
         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. APPROVE BUCKET                                       │
└─────────────────────────────────────────────────────────┘
         ↓
For each approved passage:
  Create SourcePassage in book.passages
  Link to thread
  Set status to "approved"
         ↓
┌─────────────────────────────────────────────────────────┐
│ 5. CLEANUP                                              │
└─────────────────────────────────────────────────────────┘
         ↓
Delete bucket (or auto-expire after 7 days)
Passages are now permanent in book.passages
```

---

## Curation Status Flow

```
New Passage (from harvest)
      │
      ├─→ status: "candidate"
      │
      ├─→ Curator reviews...
      │       ├─→ APPROVE
      │       │     └─→ status: "approved"
      │       │          └─→ Can be used in chapters
      │       │
      │       ├─→ MARK AS GEM
      │       │     └─→ status: "gem"
      │       │          └─→ Exceptional, highlight
      │       │
      │       └─→ REJECT
      │             └─→ status: "rejected"
      │                  └─→ Keep for reference, don't use
      │
      └─→ Also stored in:
            - PassageLink (if used in chapter)
            - PassageUsage (stats)
            - Tags (metadata)
```

---

## Narrative Arc Assignment

```
AUI PROPOSES STRUCTURE (based on content analysis)

"The Hero's Journey" Arc
│
├─→ Act 1: Call to Adventure
│   └─→ Passages: [p1, p3, p7]
│   └─→ Target Word Count: 2000
│   └─→ User: "Looks good" (approved)
│
├─→ Act 2: Crossing the Threshold
│   └─→ Passages: [p5, p9, p12]
│   └─→ Target Word Count: 3000
│   └─→ User: "Need more development" (rejected)
│
└─→ Act 3: Return with Elixir
    └─→ Passages: [p15, p18, p22]
    └─→ Target Word Count: 2500
    └─→ User: "Perfect" (approved)

USER EVALUATION:
├─→ Status: "partially_approved"
├─→ Feedback: "Use Act 2 as outline, needs more passages"
├─→ AUI can revise and resubmit
```

---

## Passage Link Tracking

```
SINGLE PASSAGE:
┌──────────────────────────────────────────┐
│ Passage #5: "I learned to trust myself" │
└──────────────────────────────────────────┘
         │
         ├─ PassageLink #L1
         │  ├─ Chapter #1 (Growth)
         │  ├─ Section #S3 (Finding Confidence)
         │  ├─ UsageType: quote
         │  ├─ Offset: [120, 150]
         │  └─ CreatedBy: user
         │
         ├─ PassageLink #L2
         │  ├─ Chapter #3 (Reflection)
         │  ├─ Section #S9 (Lessons Learned)
         │  ├─ UsageType: inspiration
         │  └─ CreatedBy: aui
         │
         └─ PassageLink #L3
            └─ NONE (orphaned in Chapter #2)


USAGE SUMMARY:
PassageUsage {
  passageId: "p5",
  usedInChapters: ["c1", "c3"],
  linkCount: 2,
  usageBreakdown: {
    "quote": 1,
    "inspiration": 1,
    "paraphrase": 0,
    "reference": 0
  },
  isOrphaned: false
}
```

---

## Data Integrity: Orphan Detection

```
SCENARIO: Chapter deletion

Book.chapters = [c1, c2, c3, c4]
Passage p5 appears in: c1, c3

USER DELETES CHAPTER #3

SYSTEM:
  1. Find all links where chapter_id = "c3"
     → PassageLink #L2 (passage p5 in c3)
  
  2. For each passage (p5), count other links
     → p5 also in c1 (still has usage)
  
  3. No action needed
     → p5 keeps status "approved"
  
  4. Delete the links to c3
     → Remove PassageLink #L2

DIFFERENT SCENARIO: Passage ONLY in deleted chapter

Book.chapters = [c1, c2]
Passage p8 appears ONLY in c1

USER DELETES CHAPTER #1

SYSTEM:
  1. Find all links where chapter_id = "c1"
     → PassageLink #L99 (passage p8 in c1)
  
  2. For p8, count other links
     → No other chapters use p8
  
  3. Mark as orphaned
     → Add tag "orphaned" to passage
     → Update notes: "Orphaned after chapter deletion"
  
  4. DON'T delete the passage data
     → Can be recovered if chapter restored
     → Visible in UI for manual recovery


ORPHAN RECOVERY:
User can:
  - View orphaned passages list
  - Re-assign to another chapter
  - Create new chapter and link
  - Delete if truly unwanted
```

---

## Storage Architecture

```
PHASE 1: localStorage (Days 1-2)
┌──────────────────────────────────────────┐
│ Browser localStorage (5-10MB limit)      │
├──────────────────────────────────────────┤
│ humanizer-bookshelf-personas             │
│ humanizer-bookshelf-styles               │
│ humanizer-bookshelf-books                │
│ humanizer-bookshelf-harvest-buckets      │
│ humanizer-bookshelf-narrative-arcs       │
│ humanizer-bookshelf-passage-links        │
└──────────────────────────────────────────┘
         ↓
   Fast iteration, full reload


PHASE 2: Hybrid (Days 3-4)
┌──────────────────────────────────────────┐
│ Service Layer (Abstract Interface)       │
├──────────┬──────────────────────────────┤
│ Source   │ localStorage OR SQLite        │
│ Fallback │ localStorage (if SQLite down) │
└──────────┴──────────────────────────────┘


PHASE 3: SQLite (Days 4+)
┌──────────────────────────────────────────────────┐
│ SQLite Database (.embeddings.db)                 │
├──────────────────────────────────────────────────┤
│ harvest_buckets                                  │
│ narrative_arcs                                   │
│ arc_act_assignments                              │
│ passage_links                                    │
│ (+ existing: content_items, media_files, etc)   │
└──────────────────────────────────────────────────┘
         ↓
   Persistent, queryable, transactional
```

---

## Type Dependencies

```
EntityMeta (base class)
  ├─→ Persona
  ├─→ Style
  ├─→ BookProject
  │   ├─→ DraftChapter
  │   │   ├─→ ChapterSection
  │   │   └─→ Marginalia
  │   ├─→ SourcePassage (from passage.ts)
  │   ├─→ BookThread
  │   ├─→ NarrativeArc ← NEW
  │   │   └─→ ArcAct ← NEW
  │   └─→ PyramidStructure

EntityURI (reference type)
  ├─→ Used by:
  │   ├─→ BookProject.personaRefs
  │   ├─→ BookProject.styleRefs
  │   ├─→ SourcePassage.threadRefs
  │   ├─→ HarvestBucket.bookRef ← NEW
  │   ├─→ HarvestBucket.threadRef ← NEW
  │   ├─→ NarrativeArc.bookRef ← NEW
  │   └─→ PassageLink.passageRef.bookRef ← NEW

SourceReference (points to raw material)
  └─→ Used by:
      ├─→ SourcePassage.sourceRef
      └─→ HarvestBucket.passage.sourceRef ← NEW

PassageLink ← NEW
  ├─→ passageRef: { bookRef: EntityURI, passageId: string }
  ├─→ chapterRef: { chapterId: string }
  └─→ usageType: 'quote' | 'paraphrase' | 'inspiration' | 'reference'

HarvestBucket ← NEW
  ├─→ bookRef: EntityURI
  ├─→ threadRef: EntityURI
  └─→ status: 'pending' | 'reviewing' | 'approved' | 'rejected' | 'merged'

NarrativeArc ← NEW
  ├─→ bookRef: EntityURI
  ├─→ arcType: 'monomyth' | 'three-act' | 'five-point' | 'custom'
  └─→ acts: ArcAct[]
```

---

## Validation Rules

```
PASSAGE LINK CREATION

Before adding PassageLink {
  ├─→ Check passage exists
  │   └─→ passage = BookProject.passages.find(p => p.id == passageId)
  │        if !passage → ERROR
  │
  ├─→ Check chapter exists
  │   └─→ chapter = BookProject.chapters.find(c => c.id == chapterId)
  │        if !chapter → ERROR
  │
  ├─→ If section specified, check it exists
  │   └─→ section = chapter.sections.find(s => s.id == sectionId)
  │        if !section → ERROR
  │
  ├─→ If offset specified, validate bounds
  │   └─→ if offset.end > chapter.content.length → ERROR
  │
  ├─→ Check no duplicate link
  │   └─→ if similar link exists → ERROR "Duplicate link"
  │
  └─→ All checks pass?
      └─→ Create link with id, createdAt, createdBy
}


CHAPTER DELETION

When deleting DraftChapter {
  ├─→ Find all links to this chapter
  │   └─→ links = PassageLinkService.getByChapter(chapterId)
  │
  ├─→ For each passage in links
  │   ├─→ Check other links
  │   │   └─→ otherLinks = PassageLinkService.get(passageId)
  │   │        .filter(l => l.chapterId != chapterId)
  │   │
  │   └─→ If no other links
  │       └─→ Mark passage orphaned
  │           └─→ passage.tags.add("orphaned")
  │
  ├─→ Delete all links to this chapter
  │   └─→ PassageLinkService.deleteByChapter(chapterId)
  │
  └─→ Delete chapter from book.chapters
      └─→ book.chapters = book.chapters.filter(c => c.id != chapterId)
}


BUCKET AUTO-CLEANUP (hourly)

For each HarvestBucket {
  ├─→ if bucket.status == 'pending'
  │   AND bucket.createdAt < (now - 7 days)
  │   ├─→ Delete bucket
  │   └─→ Log "Cleaned up expired bucket {id}"
  │
  └─→ Continue...
}
```

---

## API Endpoint Structure

```
HARVEST ENDPOINTS
├─ GET    /api/bookshelf/books/:bookId/harvest
│         List buckets with filters
│         Query: ?status=pending&threadRef=...
│
├─ POST   /api/bookshelf/books/:bookId/harvest
│         Create bucket with passages
│         Body: { threadRef, passages: [...] }
│
├─ PATCH  /api/bookshelf/harvest/:bucketId
│         Update bucket status
│         Body: { status, reviewNotes }
│
├─ POST   /api/bookshelf/harvest/:bucketId/approve
│         Approve + convert to SourcePassages
│         Body: { passages: [{id, keep: boolean}] }
│
└─ DELETE /api/bookshelf/harvest/:bucketId
          Delete bucket


ARC ENDPOINTS
├─ GET    /api/bookshelf/books/:bookId/arcs
│         List arcs for book
│
├─ POST   /api/bookshelf/books/:bookId/arcs
│         Create new arc
│         Body: { arcType, name, acts: [...] }
│
├─ PATCH  /api/bookshelf/arcs/:arcId
│         Update evaluation
│         Body: { evaluation: { status, feedback } }
│
├─ POST   /api/bookshelf/arcs/:arcId/assign
│         Assign passages to act
│         Body: { actId, passageIds: [...] }
│
└─ DELETE /api/bookshelf/arcs/:arcId
          Delete arc


LINK ENDPOINTS
├─ POST   /api/bookshelf/links
│         Create link
│         Body: { passageRef, chapterRef, sectionId, usageType, offset, notes }
│
├─ GET    /api/bookshelf/passages/:passageId/usage
│         Get usage stats for passage
│
├─ GET    /api/bookshelf/books/:bookId/orphaned
│         List orphaned passages
│
└─ DELETE /api/bookshelf/links/:linkId
          Delete link
```

---

## Sign-Off Matrix

```
Component           | Type   | Data Agent | Architect | Audit
────────────────────┼────────┼────────────┼───────────┼─────────
Type Definitions    | CRIT   | ✓ APPROVE  | ✓ REVIEW  | COMPLETE
Service Layer       | HIGH   | ✓ REVIEW   | ✓ APPROVE | COMPLETE
API Contracts       | HIGH   | ✓ APPROVE  | ✓ APPROVE | COMPLETE
Storage Strategy    | CRIT   | ✓ APPROVE  | ✓ REVIEW  | COMPLETE
Data Integrity      | CRIT   | ✓ APPROVE  | ✓ REVIEW  | COMPLETE
SQLite Schema       | HIGH   | ✓ APPROVE  | ○ REVIEW  | COMPLETE
Migration Plan      | HIGH   | ✓ APPROVE  | ○ REVIEW  | COMPLETE
Backward Compat     | CRIT   | ✓ APPROVE  | ✓ REVIEW  | COMPLETE

✓ = Signed off
○ = Ready for review
```

