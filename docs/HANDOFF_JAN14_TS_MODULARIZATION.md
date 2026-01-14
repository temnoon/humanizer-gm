# Handoff: TypeScript Modularization & Book Studio Planning - Jan 14, 2026

## Session Summary

**Completed TypeScript modularization** of two large components, reducing complexity and improving maintainability. Also scoped the next major development initiative: a unified Book Production tool.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `1914bea` | refactor(tsx): modularize FacebookView.tsx into 7 component files |
| `22f36f7` | refactor(tsx): modularize BookshelfContext.tsx into operations modules |

**All pushed to origin/main**

---

## TypeScript Modularization Summary

### FacebookView.tsx (1,831 lines) → 8 files

| New File | Lines | Content |
|----------|-------|---------|
| FacebookView.tsx | 213 | Orchestrator with tabs, period picker |
| FacebookFeedView.tsx | 268 | Posts/comments with filters |
| FacebookGalleryView.tsx | 269 | Media thumbnails with size control |
| FacebookNotesView.tsx | 213 | Notes with expansion |
| FacebookGroupsView.tsx | 222 | Groups with content |
| FacebookMessengerView.tsx | 196 | Messenger threads |
| FacebookAdvertisersView.tsx | 210 | Advertisers/data brokers |
| index.ts | 14 | Barrel export |

**Location:** `apps/web/src/components/archive/facebook/`

### BookshelfContext.tsx (1,502 lines) → 8 files

| New File | Lines | Content |
|----------|-------|---------|
| BookshelfContext.tsx | 591 | Slim orchestrator with React state |
| operations/storage.ts | 38 | Storage mode detection |
| operations/personaOps.ts | 67 | Persona CRUD |
| operations/styleOps.ts | 67 | Style CRUD |
| operations/bookOps.ts | 238 | Book CRUD + rendering |
| operations/chapterOps.ts | 271 | Chapter CRUD + versioning |
| operations/passageOps.ts | 150 | Passage CRUD |
| operations/index.ts | 14 | Barrel export |

**Location:** `apps/web/src/lib/bookshelf/operations/`

---

## Build Status

```bash
npm run build        # ✅ Passes
npm run build:electron  # ✅ Passes
```

---

## NEXT SESSION: Book Studio (Major Initiative)

### Problem Statement

The current book production workflow is fragmented across multiple panes:
- **BooksView** - Book list, project selection
- **HarvestQueuePanel** - Harvest execution
- **ExploreView** - Semantic search for content
- **AUI Panel** - AI-assisted operations

**Pain points:**
1. Context loss - Harvest tool forgets which book was active
2. State disappears - Completed harvests vanish after navigation
3. High cognitive load - Hard to understand even for the creator
4. Manual orchestration - User must coordinate tools that should work together

### Proposed Solution: Unified "Book Studio"

A single workspace treating book production as a **continuous pipeline**:

```
Source Discovery → Harvesting → Curation → Outlining → Drafting → Review → Export
```

**Key features:**
- Persistent book context (always know what you're working on)
- Pipeline visibility (see all stages at once)
- Automation with override (smart defaults, manual control)
- LLM routing (different models for different tasks)
- Version control for everything (drafts, outlines, harvest configs)
- Book covers, internet sources, appendices
- Multi-part review process

### Development Strategy: SANDBOX-FIRST

**CRITICAL: No changes to humanizer-gm until patterns are proven.**

#### Phase 1: Brainstorm (Next Session Start)
- Define ideal workflows without implementation constraints
- Map current pain points to solutions
- Sketch UI/UX concepts
- Identify required data flows

#### Phase 2: Prototype in humanizer-sandbox
- Create new repo: `humanizer-sandbox`
- Independent development environment
- **Read-only** access to humanizer-gm archives
- Test with real-world content

#### Phase 3: Validate
- Use real archives to validate patterns
- Iterate on prototype based on findings
- Document what works, what doesn't

#### Phase 4: Integration (Future)
- Only after prototype is proven
- Wire Book Studio into humanizer-gm
- Migrate or deprecate existing panes

### Sandbox Setup (First Task Next Session)

```bash
# Create sandbox repo
cd /Users/tem/humanizer_root
mkdir humanizer-sandbox
cd humanizer-sandbox
npm init -y

# Structure
humanizer-sandbox/
├── src/
│   ├── book-studio/     # New unified tool
│   └── archive-reader/  # Read-only archive access
├── docs/
│   └── brainstorm/      # Planning documents
└── package.json
```

### Questions to Answer in Brainstorm

1. **Pipeline Model**: How do we represent book state across all stages?
2. **Context Persistence**: How do we ensure the active book is never lost?
3. **Harvest Integration**: How do harvests relate to the book they serve?
4. **LLM Routing**: Which models for which tasks? User-configurable?
5. **Version Control**: What level of granularity? Per-chapter? Per-draft?
6. **Review Process**: How do multi-part reviews work? Who reviews what?
7. **Export Formats**: What outputs do we need? (PDF, EPUB, Markdown, etc.)

---

## Session Statistics

| Metric | Value |
|--------|-------|
| TS files modularized | 2 |
| New files created | 15 |
| Lines reorganized | 3,333 |
| Main file reductions | 88% (Facebook), 61% (Bookshelf) |
| Build status | ✅ All green |

---

## File Structure After Modularization

```
apps/web/src/
├── components/archive/
│   ├── FacebookView.tsx          # Orchestrator (213 lines)
│   └── facebook/
│       ├── index.ts
│       ├── FacebookFeedView.tsx
│       ├── FacebookGalleryView.tsx
│       ├── FacebookNotesView.tsx
│       ├── FacebookGroupsView.tsx
│       ├── FacebookMessengerView.tsx
│       ├── FacebookAdvertisersView.tsx
│       └── shared/               # Existing types/utils
└── lib/bookshelf/
    ├── BookshelfContext.tsx      # Slim orchestrator (591 lines)
    ├── BookshelfService.ts       # Unchanged
    ├── HarvestBucketService.ts   # Unchanged
    ├── types.ts                  # Unchanged
    └── operations/               # NEW
        ├── index.ts
        ├── storage.ts
        ├── personaOps.ts
        ├── styleOps.ts
        ├── bookOps.ts
        ├── chapterOps.ts
        └── passageOps.ts
```

---

**Session End:** Jan 14, 2026
**Status:** TS modularization COMPLETE, Book Studio brainstorm READY TO BEGIN
**Next Action:** Create humanizer-sandbox repo and start brainstorming session
