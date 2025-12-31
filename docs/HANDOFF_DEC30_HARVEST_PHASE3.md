# Handoff: HarvestBucket Phase 3 - AUI Integration

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Codebase**: `/Users/tem/humanizer_root/humanizer-gm`
**Status**: Phase 1-2 COMPLETE, Phase 3 READY

---

## Executive Summary

The **HarvestBucket** system enables the book-making workflow:

```
Archive Search → HarvestBucket (staging) → User Review → Approved Passages → Book
```

**Phase 3** adds AUI (AI User Interface) integration - tools that allow the AI assistant to harvest content from archives, propose narrative structures, and find semantic connections.

---

## Project Philosophy

### The Humanizer Vision

Humanizer is a desktop app for **reclaiming subjective agency through narrative analysis**. Users import their writing archives (ChatGPT, Claude, Facebook, documents) and curate them into books.

Key concepts:
- **Sentence as quantum of meaning** - irreducible unit of expression
- **SIC (Subjective Intentional Constraint)** - traces of lived experience in text
- **AUI (AI User Interface)** - AI that teaches by doing, showing users the GUI path

### Book-Making Workflow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Archive Search  │────▶│  HarvestBucket   │────▶│  BookProject    │
│ (embeddings)    │     │  (staging)       │     │  (permanent)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                       │
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Query Results   │     │ User Review      │     │ Chapters        │
│ (candidates)    │     │ approve/reject   │     │ with passages   │
└─────────────────┘     │ mark as gem      │     └─────────────────┘
                        └──────────────────┘
```

---

## What Was Built (Phase 1-2)

### Phase 1: Core Types & Services

**File: `packages/core/src/types/harvest.ts`** (~580 lines)

```typescript
// Key types
export type HarvestStatus = 'collecting' | 'reviewing' | 'staged' | 'committed' | 'discarded';

export interface HarvestBucket extends EntityMeta {
  type: 'harvest-bucket';
  bookUri: EntityURI;
  status: HarvestStatus;
  queries: string[];
  config: HarvestConfig;
  candidates: SourcePassage[];
  approved: SourcePassage[];
  gems: SourcePassage[];
  rejected: SourcePassage[];
  stats: HarvestStats;
}

export interface NarrativeArc extends EntityMeta {
  type: 'narrative-arc';
  bookUri: EntityURI;
  arcType: ArcType; // linear | spiral | dialectic | mosaic | monomyth
  thesis: string;
  themes: ArcTheme[];
  chapters: ChapterOutline[];
  evaluation: ArcEvaluation;
}

export interface PassageLink {
  passageId: string;
  chapterId: string;
  position: number;
  usageType: 'verbatim' | 'paraphrase' | 'inspiration' | 'reference';
}

// Factory functions
export function createHarvestBucket(bookUri, queries, options): HarvestBucket
export function createNarrativeArc(bookUri, thesis, options): NarrativeArc
export function createPassageLink(passageId, chapterId, position, options): PassageLink

// Helper functions
export function isHarvestTerminal(bucket): boolean
export function isHarvestReady(bucket): boolean
export function getHarvestProgress(bucket): number
export function getAllApproved(bucket): SourcePassage[]
```

**File: `apps/web/src/lib/bookshelf/HarvestBucketService.ts`** (~790 lines)

```typescript
class HarvestBucketService {
  // Bucket operations
  createBucket(bookUri, queries, options): HarvestBucket
  getBucket(bucketId): HarvestBucket | undefined
  getActiveBucketsForBook(bookUri): HarvestBucket[]

  // Passage curation
  addCandidate(bucketId, passage): HarvestBucket
  approvePassage(bucketId, passageId): HarvestBucket
  markAsGem(bucketId, passageId): HarvestBucket
  rejectPassage(bucketId, passageId, reason?): HarvestBucket
  moveToCandidates(bucketId, passageId): HarvestBucket

  // Bucket lifecycle
  finishCollecting(bucketId): HarvestBucket
  stageBucket(bucketId): HarvestBucket
  commitBucket(bucketId): BookProject
  discardBucket(bucketId): boolean

  // Narrative arcs
  createArc(bookUri, thesis, options): NarrativeArc
  getArcsForBook(bookUri): NarrativeArc[]
  approveArc(arcId, feedback?): NarrativeArc

  // Storage: localStorage with 7-day auto-cleanup
}

export const harvestBucketService = new HarvestBucketService();
```

**File: `apps/web/src/lib/bookshelf/BookshelfContext.tsx`**

Extended with 20+ harvest operations exposed via `useBookshelf()`:

```typescript
// Via useBookshelf() hook:
createHarvestBucket(bookUri, queries)
getActiveBuckets(bookUri)
getBucket(bucketId)
approvePassage(bucketId, passageId)
rejectPassage(bucketId, passageId, reason?)
markAsGem(bucketId, passageId)
moveToCandidates(bucketId, passageId)
finishCollecting(bucketId)
stageBucket(bucketId)
commitBucket(bucketId)
discardBucket(bucketId)
getPassages(bookUri)
addPassageToBook(bookUri, passage)
updatePassageStatus(bookUri, passageId, status)
createArc(bookUri, thesis)
getArcsForBook(bookUri)
approveArc(arcId, feedback?)
```

### Phase 2: UI Components

**File: `apps/web/src/components/tools/HarvestQueuePanel.tsx`** (~380 lines)

```typescript
interface HarvestQueuePanelProps {
  bookUri: string | null;
  onSelectPassage?: (passage: SourcePassage) => void;
}

// Sub-components:
// - PassageCard: Shows passage with approve/reject/gem buttons
// - BucketHeader: Shows status, progress bar, lifecycle controls

export function HarvestQueuePanel({ bookUri, onSelectPassage }: HarvestQueuePanelProps)
```

**Integrated into Studio.tsx:**
- Added to TOOL_REGISTRY as 'harvest' tab
- Uses `bookshelf.activeBookUri` for context
- Loads passage into buffer on selection

**File: `apps/web/src/components/archive/BooksView.tsx`**

Added "Start Harvest" button:
```typescript
const handleStartHarvest = useCallback(() => {
  // Creates bucket with project name as query
  // Sets active book URI
  // Alerts user to check Harvest tab
}, [selectedProjectId, bookProjects, bookshelf]);
```

**CSS: `apps/web/src/index.css`** (~400 lines added)
- `.harvest-panel` - Main container
- `.harvest-card` - Passage display with status colors
- `.bucket-header` - Expandable header with progress
- `.harvest-btn` - Action buttons (approve/reject/gem)
- `.book-nav__harvest-btn` - Start harvest button

---

## Phase 3: AUI Integration

### Goal

Allow the AI assistant to:
1. **Harvest passages** from archives via semantic search
2. **Propose narrative arcs** based on collected material
3. **Find semantic mirrors** between passages
4. **Detect gaps** in the narrative structure

### Existing AUI Infrastructure

**File: `apps/web/src/lib/aui/tools.ts`**

Contains 40+ existing tools. Key patterns:

```typescript
// Tool definition pattern
const TOOL: AUITool = {
  name: 'tool_name',
  description: 'What it does',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '...' },
    },
    required: ['param1'],
  },
  execute: async (params, context) => {
    // Implementation
    return {
      success: true,
      message: 'Done',
      data: { ... },
      guiPath: 'Archive → Books → Sources → ...' // Teaching output
    };
  },
};
```

**Existing book-related tools:**
- `get_active_book` - Get current book project
- `create_book_project` - Create new project
- `add_passage_to_book` - Add passage to project
- `update_passage_status` - Change curation status
- `create_chapter` - Create new chapter
- `discover_threads` - AI clustering of passages

### New Tools to Implement

#### 1. `harvest_for_thread`

Searches archives and populates a harvest bucket with candidates.

```typescript
const harvest_for_thread: AUITool = {
  name: 'harvest_for_thread',
  description: 'Search archives for passages matching queries and add to harvest bucket',
  parameters: {
    type: 'object',
    properties: {
      book_uri: { type: 'string', description: 'URI of the book project' },
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Semantic search queries'
      },
      config: {
        type: 'object',
        properties: {
          min_similarity: { type: 'number', default: 0.65 },
          max_results: { type: 'number', default: 50 },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'Archive sources to search (chatgpt, facebook, etc)'
          },
        },
      },
    },
    required: ['book_uri', 'queries'],
  },
  execute: async (params, context) => {
    // 1. Create harvest bucket via harvestBucketService
    // 2. Call archive semantic search API
    // 3. Convert results to SourcePassage format
    // 4. Add candidates to bucket
    // 5. Finish collecting
    return {
      success: true,
      message: `Harvested ${count} passages for review`,
      data: { bucketId, candidateCount, queries },
      guiPath: 'Tools → Harvest → [bucket] → Review candidates',
    };
  },
};
```

**Implementation notes:**
- Archive search API: `GET /api/search?q=query&limit=50`
- Returns: `{ results: [{ text, similarity, source, conversationId, ... }] }`
- Convert to `SourcePassage` with proper `sourceRef` structure

#### 2. `propose_narrative_arc`

Analyzes approved passages and proposes chapter structure.

```typescript
const propose_narrative_arc: AUITool = {
  name: 'propose_narrative_arc',
  description: 'Analyze approved passages and propose a narrative structure',
  parameters: {
    type: 'object',
    properties: {
      book_uri: { type: 'string', description: 'URI of the book project' },
      arc_type: {
        type: 'string',
        enum: ['linear', 'spiral', 'dialectic', 'mosaic', 'monomyth'],
        description: 'Type of narrative structure to propose'
      },
      thesis: { type: 'string', description: 'Core thesis/argument of the book' },
    },
    required: ['book_uri'],
  },
  execute: async (params, context) => {
    // 1. Get approved passages from book
    // 2. Cluster by theme (use embeddings)
    // 3. Propose chapter structure
    // 4. Create NarrativeArc via harvestBucketService.createArc()
    // 5. Return for user review
    return {
      success: true,
      message: `Proposed ${chapterCount}-chapter arc`,
      data: { arcId, chapters, themes },
      guiPath: 'Archive → Books → [project] → Thinking tab',
    };
  },
};
```

**Implementation notes:**
- Use existing `discover_threads` logic for clustering
- Create `ChapterOutline` for each major theme
- Calculate `estimatedWordCount` from passage word counts

#### 3. `find_resonant_mirrors`

Finds semantically similar passages across the archive.

```typescript
const find_resonant_mirrors: AUITool = {
  name: 'find_resonant_mirrors',
  description: 'Find passages that resonate semantically with a given passage',
  parameters: {
    type: 'object',
    properties: {
      passage_id: { type: 'string', description: 'ID of the source passage' },
      passage_text: { type: 'string', description: 'Text to find mirrors for' },
      search_scope: {
        type: 'string',
        enum: ['book', 'archive', 'all'],
        description: 'Where to search for mirrors',
      },
      limit: { type: 'number', default: 10 },
    },
    required: ['passage_text'],
  },
  execute: async (params, context) => {
    // 1. Get embedding for passage_text
    // 2. Search archive for similar embeddings
    // 3. Filter by scope (book passages only, full archive, etc)
    // 4. Return ranked list with similarity scores
    return {
      success: true,
      message: `Found ${count} resonant passages`,
      data: { mirrors: [...], similarities: [...] },
      guiPath: 'Archive → Explore → Semantic Search',
    };
  },
};
```

#### 4. `detect_narrative_gaps`

Analyzes chapter structure for missing content.

```typescript
const detect_narrative_gaps: AUITool = {
  name: 'detect_narrative_gaps',
  description: 'Analyze narrative arc for gaps and suggest how to fill them',
  parameters: {
    type: 'object',
    properties: {
      book_uri: { type: 'string', description: 'URI of the book project' },
      arc_id: { type: 'string', description: 'ID of narrative arc to analyze' },
    },
    required: ['book_uri'],
  },
  execute: async (params, context) => {
    // 1. Get arc and chapters
    // 2. Analyze transitions between chapters
    // 3. Check for theme coverage
    // 4. Identify gaps (conceptual, transitional, emotional)
    // 5. Suggest fill strategies
    return {
      success: true,
      message: `Found ${gapCount} gaps`,
      data: { gaps: [...] },
      guiPath: 'Archive → Books → [project] → Thinking → Gaps',
    };
  },
};
```

### Archive Search API

**Endpoint**: `GET /api/search`

Located in: `electron/archive-server/` (embedded in Electron)

```typescript
// Request
GET /api/search?q=consciousness&limit=50&sources=chatgpt,facebook

// Response
{
  results: [
    {
      id: 'msg-123',
      text: 'The passage text...',
      similarity: 0.87,
      source: 'chatgpt',
      conversationId: 'conv-456',
      conversationTitle: 'Philosophy Discussion',
      timestamp: '2024-03-15T10:30:00Z',
      author: 'user',
    },
    ...
  ],
  total: 150,
  query: 'consciousness',
}
```

### Integration Points

1. **harvestBucketService** - Already initialized in BookshelfContext
2. **Archive API** - Available at `http://localhost:3002/api/`
3. **executeAllTools** - Tool dispatcher in `apps/web/src/lib/aui/index.ts`
4. **AUI_TOOLS** - Export array in `apps/web/src/lib/aui/tools.ts`

---

## Implementation Checklist

### Phase 3A: harvest_for_thread (~2 hours)

- [ ] Add tool definition to `apps/web/src/lib/aui/tools.ts`
- [ ] Implement archive search integration
- [ ] Convert search results to SourcePassage format
- [ ] Add candidates to bucket via harvestBucketService
- [ ] Return guiPath for teaching output
- [ ] Test with real archive data

### Phase 3B: propose_narrative_arc (~3 hours)

- [ ] Add tool definition
- [ ] Implement passage clustering (reuse discover_threads logic)
- [ ] Generate ChapterOutline from clusters
- [ ] Create NarrativeArc via service
- [ ] Add to tool registry

### Phase 3C: find_resonant_mirrors (~2 hours)

- [ ] Add tool definition
- [ ] Implement embedding-based similarity search
- [ ] Filter by scope (book/archive/all)
- [ ] Return ranked results with scores

### Phase 3D: detect_narrative_gaps (~2 hours)

- [ ] Add tool definition
- [ ] Implement transition analysis
- [ ] Identify gap types (conceptual, transitional, emotional)
- [ ] Generate fill suggestions

### Phase 3E: Testing & Polish (~2 hours)

- [ ] Test full workflow with AUI
- [ ] Verify guiPath accuracy
- [ ] Update tool documentation

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/types/harvest.ts` | Type definitions |
| `apps/web/src/lib/bookshelf/HarvestBucketService.ts` | Core service |
| `apps/web/src/lib/bookshelf/BookshelfContext.tsx` | React context |
| `apps/web/src/lib/aui/tools.ts` | AUI tool definitions |
| `apps/web/src/lib/aui/index.ts` | Tool dispatcher |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | UI component |
| `apps/web/src/components/archive/BooksView.tsx` | Book navigation |
| `electron/archive-server/` | Embedded archive API |

---

## Quick Start

```bash
cd /Users/tem/humanizer_root/humanizer-gm
git checkout feature/xanadu-768-embeddings

# Verify state
cat docs/HANDOFF_DEC30_HARVEST_PHASE3.md

# Type check
cd packages/core && npm run build
cd apps/web && npx tsc --noEmit

# Start dev
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Next: Implement harvest_for_thread tool
code apps/web/src/lib/aui/tools.ts
```

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `2d61c43` | Extend BookshelfContext with harvest operations |
| `64094f4` | Add HarvestQueuePanel for passage curation |
| `4ef357c` | Add Start Harvest button to BooksView |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| `docs/HANDOFF_DEC30_BOOKSHELF_HARVEST.md` | Phase 1 handoff (from humanizer-gm) |
| `docs/HANDOFF_DEC27_HUMANIZER_GM_PLAN.md` | Golden Master consolidation plan |
| `CLAUDE.md` | Development guide |

---

**End of Handoff**
