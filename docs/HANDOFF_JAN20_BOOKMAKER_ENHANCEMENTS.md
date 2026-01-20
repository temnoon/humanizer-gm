# Book Maker Modal Enhancements - Handoff Document

**Date**: January 20, 2026
**Status**: Planning Complete - Ready for Implementation
**ChromaDB Tags**: `book-maker`, `card-rating`, `outline-generation`, `jan-2026`

---

## Quick Start

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev
# Press Cmd+Shift+B to open Book Maker
```

## Current State

The Book Maker modal is functional with 6 views:
- **Projects** - Book selection/creation
- **Harvest** - Search and collect content
- **Staging** - View cards (Grid/Timeline/Canvas/Clusters)
- **Outline** - Generate outline from themes
- **Chapters** - Manage chapter structure
- **Writing** - Markdown editor with AI drafts

**What's Missing** (from user requirements):
1. Card rating system (5 categories, 1-5 scale)
2. Iterative harvest with priority ordering
3. Click-based buttons (not just keyboard)
4. Comprehensive outline generation (book/chapter/section)
5. In-modal chapter generation with workspace handoff

---

## Feature Requirements

### 1. Card Rating System

Implement the 5-category rating system from humanizer-sandbox:

| Category | Description | Score 1-5 |
|----------|-------------|-----------|
| **authenticity** | Human voice vs AI-generated | 1=robotic, 5=polished-human |
| **necessity** | Narrative importance (Chekhov analysis) | 1=dispensable, 5=essential |
| **inflection** | Turning points, modality shifts | 1=flat, 5=pivotal |
| **voice** | Style coherence with author | 1=inconsistent, 5=aligned |
| **overall** | Weighted composite | Calculated from above |

**Weights** (from sandbox config):
```typescript
const GRADE_WEIGHTS = {
  authenticity: 0.25,
  necessity: 0.25,
  inflection: 0.20,
  voice: 0.15,
  clarity: 0.15,  // Default 3 if no analyzer
}
```

**Implementation Files to Port**:
- `/humanizer-sandbox/src/book-studio/harvest-review-agent.ts` - `quickGradeCard()`, `gradeCardFull()`
- `/humanizer-sandbox/src/book-studio/chekhov-local.ts` - Local necessity analysis
- `/humanizer-sandbox/src/book-studio/types.ts` - `CardGrade` interface

### 2. Iterative Harvest with Priority Ordering

**Features**:
- "Harvest More" button in StagingView
- Runs additional smart harvest with current query or new query
- New cards merged with existing, all re-sorted by overall grade
- Cards with `overall < 3` filtered out (configurable threshold)

**Ordering Logic**:
```typescript
cards.sort((a, b) => {
  const gradeA = a.grade?.overall ?? 3
  const gradeB = b.grade?.overall ?? 3
  if (gradeA !== gradeB) return gradeB - gradeA  // Higher grades first
  // Then by temporal position
  return a.createdAt - b.createdAt
})
```

### 3. Card Management

**Manual Operations**:
- Drag-and-drop reordering in staging
- Chapter assignment dropdown per card
- "Create New Chapter" option in dropdown
- Bulk operations (select multiple, assign to chapter)

**Card Display** (update HarvestCard component):
- Show all 5 rating categories with visual bars
- Show overall score prominently
- Highlight "key passages" (overall >= 4)
- Chapter assignment indicator

### 4. Button Click Support

Ensure ALL navigation and action buttons work on click:
- View navigation tabs (Projects, Harvest, etc.) - currently keyboard only?
- Action buttons (Create, Generate, etc.)
- Review and fix any keyboard-only interactions

### 5. Outline Generation (Three Scopes)

**A. Book-Level Outline**:
- Generate outline from all staging cards
- Research phase: extract themes, detect arcs, find gaps
- Show suggested sections with card assignments
- Convert to chapters with one click

**B. Chapter-Level Outline**:
- Generate outline for a single chapter
- Use only cards assigned to that chapter
- Show section structure with card mappings

**C. Section-Level Outline (from existing text)**:
- User selects existing text in WritingView
- Selected text becomes prompt for outline generation
- Generate sub-sections or elaboration points
- Optionally include additional instructions

### 6. Chapter Generation in Modal

**Generation Flow**:
1. Select chapter to generate
2. View assigned cards and their grades
3. Add optional instructions
4. Generate draft (streaming, with progress)
5. Preview in modal
6. "Open in Workspace" button to continue editing

**Text Selection Features**:
- Select text to define generation scope
- Selected text used as prompt/context
- Generate continuation or elaboration
- Outline selection first, then generate sections

**Additional Instructions**:
- Always-visible instructions textarea
- Persisted per chapter
- Included in generation prompt

---

## Implementation Plan

### Phase 1: Card Rating System

1. **Port Types** (`/lib/book-studio/types.ts`):
   ```typescript
   export interface CardGrade {
     authenticity: number  // 1-5
     necessity: number     // 1-5
     inflection: number    // 1-5
     voice: number         // 1-5
     overall: number       // Weighted composite
     confidence: number    // 0-1
     gradedAt?: string
   }
   ```
   Add `grade?: CardGrade` to `HarvestCard`

2. **Port Grading Functions** (new file `/lib/book-studio/harvest-review-agent.ts`):
   - `quickGradeCard()` - Synchronous, local analysis
   - `gradeCardFull()` - Async with optional SIC
   - `gradeCardsBatch()` - Parallel processing

3. **Port Chekhov Analysis** (new file `/lib/book-studio/chekhov-local.ts`):
   - `analyzeNecessity()` - Local necessity scoring
   - Pattern detection for setup/payoff

4. **Update Card Display**:
   - Add grade visualization to `HarvestCardDisplay` component
   - Show 5 category bars with scores
   - Highlight key passages

### Phase 2: Staging View Enhancements

1. **Priority Ordering**:
   - Sort cards by grade then time
   - Add sort options (by grade, by time, manual)
   - Persist sort preference

2. **Iterative Harvest**:
   - "Harvest More" button
   - Query input (default to last query)
   - Merge new results, re-sort

3. **Chapter Assignment**:
   - Dropdown per card
   - "New Chapter..." option
   - Bulk selection and assignment

### Phase 3: Outline Generation

1. **Book Outline** (OutlineView):
   - "Research" button → analyze cards
   - Show themes, arcs, gaps
   - "Generate" button → create structure
   - "Create Chapters" → convert to chapters

2. **Chapter Outline** (ChaptersView/WritingView):
   - Per-chapter "Outline" button
   - Show suggested sections
   - Accept/modify structure

3. **Section Outline** (WritingView):
   - Text selection handler
   - "Outline Selection" button
   - Generate sub-points from selected text

### Phase 4: Chapter Generation

1. **Generation Controls** (WritingView):
   - Instructions textarea (always visible)
   - "Generate Draft" button with progress
   - Streaming content display

2. **Selection-Based Generation**:
   - Track text selection
   - "Generate from Selection" button
   - Context-aware prompting

3. **Workspace Handoff**:
   - "Open in Workspace" button
   - Pass chapter content to main workspace
   - Enable continued editing

### Phase 5: UI Polish

1. **Button Click Support**:
   - Audit all interactive elements
   - Ensure click handlers exist
   - Remove keyboard-only patterns

2. **Visual Improvements**:
   - Card grade visualizations
   - Generation progress indicators
   - Outline structure display

---

## Key Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `/lib/book-studio/harvest-review-agent.ts` | Card grading functions |
| `/lib/book-studio/chekhov-local.ts` | Local necessity analysis |
| `/lib/book-studio/grading-queue.ts` | Background grading queue |

### Files to Modify

| File | Changes |
|------|---------|
| `/lib/book-studio/types.ts` | Add `CardGrade` interface, update `HarvestCard` |
| `/lib/book-studio/smart-harvest-agent.ts` | Integrate grading into harvest |
| `/lib/book-studio/outline-agent.ts` | Add section-level outline |
| `/lib/book-studio/BookStudioProvider.tsx` | Add grading methods |
| `/components/book-maker/views/StagingView.tsx` | Priority ordering, harvest button |
| `/components/book-maker/views/WritingView.tsx` | Selection-based generation |
| `/components/book-maker/views/OutlineView.tsx` | Full outline workflow |
| `/components/book-maker/BookMakerModal.css` | New component styles |

---

## Reference Implementation

The humanizer-sandbox has the complete implementation:

```
/Users/tem/humanizer_root/humanizer-sandbox/src/book-studio/
├── harvest-review-agent.ts   # quickGradeCard, gradeCardFull, gradingQueue
├── chekhov-local.ts          # analyzeNecessity, pattern detection
├── smart-harvest-agent.ts    # smartHarvest with grading integration
├── outline-agent.ts          # Full outline research/review/generation
├── draft-generator.ts        # Draft generation with prompts
├── config.ts                 # Grade weights, thresholds
├── types.ts                  # CardGrade, HarvestCard with grade field
└── components/
    ├── HarvestCard.tsx       # Card display with grade visualization
    └── WritingView.tsx       # Generation controls
```

---

## Testing Checklist

- [ ] Cards receive grades on harvest
- [ ] Grades display correctly (5 bars, overall score)
- [ ] Cards sort by grade then time
- [ ] "Harvest More" adds and re-sorts cards
- [ ] Chapter assignment works from dropdown
- [ ] "New Chapter" creates chapter and assigns card
- [ ] Book outline generates from all cards
- [ ] Chapter outline generates from chapter cards
- [ ] Section outline generates from selected text
- [ ] Draft generation streams with progress
- [ ] Instructions persist and affect generation
- [ ] "Open in Workspace" transfers content
- [ ] All buttons work on click (not just keyboard)

---

## Priority Order

1. **High**: Card rating system (core feature)
2. **High**: Priority ordering in staging
3. **Medium**: Iterative harvest
4. **Medium**: Chapter assignment UI
5. **Medium**: Draft generation enhancements
6. **Low**: Section-level outline
7. **Low**: Workspace handoff

---

## Notes

- The grading system can run in "hybrid" mode: quick grade on harvest, full grade in background
- SIC analysis is optional and expensive - default to local-only
- Chekhov analysis is lightweight and should always run
- Card grades should persist to the server via API
- The outline generation is sophisticated - port carefully from sandbox
- Text selection for generation is a new feature not in sandbox

---

**End of Handoff**
