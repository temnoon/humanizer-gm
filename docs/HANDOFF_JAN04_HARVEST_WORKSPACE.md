# Handoff: Harvest Workspace Integration

**Date**: January 4, 2026
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Harvest search working, workspace review needed

---

## Summary

The harvest workflow now runs semantic search when "Start Harvest" is clicked, populating buckets with candidates from the archive. However, **full conversation content is too large for the tools panel** - a workspace-based review interface is needed.

---

## What Was Completed

### 1. Start Harvest Actually Harvests
**File**: `apps/web/src/components/archive/BooksView.tsx`

- `handleStartHarvest` is now async
- Runs semantic search against `/api/embeddings/search/messages`
- Populates bucket with candidates via `harvestBucketService.addCandidate()`
- Shows alert with result count

### 2. Query Display in Bucket Headers
**File**: `apps/web/src/components/tools/HarvestQueuePanel.tsx`

- `BucketHeader` shows search queries used
- "Run Harvest" button for manual re-runs

### 3. View Source Links
**File**: `apps/web/src/components/tools/HarvestQueuePanel.tsx`

- PassageCard has "View Source" button
- Opens original conversation via `open-conversation` event
- Handler in Studio.tsx dispatches to archive browser

### 4. Full Content Loading
**File**: `apps/web/src/components/tools/HarvestQueuePanel.tsx`

- Expand button on PassageCard
- Lazy-loads full conversation from `/api/conversations/{id}`
- Displays all messages in expanded view

---

## Critical Architectural Issue

**Problem**: Full conversations can contain 50+ messages, each potentially thousands of words. Displaying this in a 300px-wide tools panel is unworkable.

**User Quote**:
> "It should be attended to by the user in the workspace, but it may require additional interface features to step through possibly many long messages finding what we want to keep in the bookshelf for the specific question."

---

## What Needs to Be Built

### 1. HarvestWorkspaceView Component
**Purpose**: Display full conversation in main workspace area for curation

**Location**: `apps/web/src/components/workspace/HarvestWorkspaceView.tsx`

**Features**:
- Full-width conversation display
- Markdown rendering for messages
- Visual distinction between user/assistant messages
- Message-level selection/highlighting

### 2. Message Stepper
**Purpose**: Navigate through conversation message-by-message

**UI Concept**:
```
[← Prev] [3 / 47] [Next →]  [Jump to...]
```

**Keyboard shortcuts**:
- `j` / `k` or arrows: Next/prev message
- `g` + number: Jump to message N
- `gg` / `G`: First/last message

### 3. Per-Message Actions
**Purpose**: Curate at message level, not conversation level

**Actions per message**:
- **Approve** (✓): Add this message to staging
- **Skip** (→): Don't include, move to next
- **Gem** (⭐): Mark as exceptional content
- **Split** (✂): Extract portion of message

### 4. Staging Area
**Purpose**: Intermediate holding area between search results and book

**Data flow**:
```
Search Results → Harvest Bucket → Staging Area → Book Chapter
                (raw candidates)   (curated passages)
```

**Staging area features**:
- Reorder passages
- Edit/trim content
- Add editorial notes
- Bulk commit to chapter

---

## Relevant Code Locations

| File | What It Does |
|------|--------------|
| `apps/web/src/components/archive/BooksView.tsx:handleStartHarvest` | Runs harvest search |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | Current harvest UI |
| `apps/web/src/lib/bookshelf/HarvestBucketService.ts` | Bucket CRUD operations |
| `apps/web/src/lib/bookshelf/types.ts` | SourcePassage, HarvestBucket types |
| `apps/web/src/Studio.tsx:~3200` | Tool panel rendering |

---

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `POST /api/embeddings/search/messages` | Semantic search |
| `GET /api/conversations/{id}` | Full conversation |
| `GET /api/archives` | List archives |

---

## TypeScript Status

```bash
cd /Users/tem/humanizer_root/humanizer-gm/apps/web
npx tsc --noEmit -p tsconfig.json  # Clean - no errors
```

---

## Suggested Implementation Order

1. **Create HarvestWorkspaceView skeleton** - Basic layout, receives conversation data
2. **Add workspace routing** - When user clicks "Review in Workspace" on a harvest candidate
3. **Build message stepper** - Navigation controls, keyboard bindings
4. **Add per-message actions** - Approve/skip/gem buttons
5. **Create staging data structure** - In BookshelfContext or separate context
6. **Wire staging to chapter creation** - "Commit staged passages" action

---

## Design Considerations

### Visual Hierarchy
- User messages: Left-aligned, neutral background
- Assistant messages: Right-aligned or indented, subtle accent
- Selected message: Highlighted border
- Approved message: Green checkmark indicator

### Mobile/Responsive
- Message stepper should work on touch
- Swipe gestures for next/prev?
- Touch-friendly action buttons (44px targets)

### Performance
- Large conversations: Virtual scrolling may be needed
- Lazy load messages if >100?
- Cache loaded conversations

---

## ChromaDB Memory

Previous handoff stored with tags:
- `handoff`, `harvest-workflow`, `workspace-review`, `staging-area`, `january-2026`

Retrieve with:
```
mcp__chromadb-memory__search_by_tag tags: ["handoff", "january-2026"]
```

---

## Ready to Continue

The codebase is clean, TypeScript passes, and the harvest search works. The next phase is building the workspace-based review interface for large conversations.

**Start with**: Creating `HarvestWorkspaceView.tsx` and a route to open it from harvest candidates.
