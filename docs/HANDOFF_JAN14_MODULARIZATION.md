# Handoff: Modularization Progress - Jan 14, 2026

## Session Summary

Completed House Council audit and began modularization of 3 large files identified as critical technical debt.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `b105576` | Extract EmbeddingMigrations.ts from EmbeddingDatabase.ts |
| `5086e8c` | Add comprehensive README with architecture overview |
| `bdbdf80` | Fix CSS compliance violations (hardcoded white) |

**All pushed to origin/main**

---

## Completed Work

### 1. EmbeddingMigrations Extraction ✅

**Created:** `electron/archive-server/services/embeddings/EmbeddingMigrations.ts` (1,572 lines)

Contains:
- Schema migrations v2-v16
- `createVectorTables()` for vec0 setup
- Exported `SCHEMA_VERSION` and `EMBEDDING_DIM` constants

**Modified:** `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`
- Reduced from 6,260 → 4,725 lines (25% reduction)
- Imports and uses `EmbeddingMigrations` class
- Build verified - TypeScript compiles

---

## Remaining Modularization Tasks

### 2. facebook.ts Routes (NEXT PRIORITY)

**File:** `electron/archive-server/routes/facebook.ts`
**Current:** 2,932 lines, 55 routes
**Target:** 7 route modules + shared utilities

#### Proposed Structure

```
routes/facebook/
├── index.ts              (~60 lines)   - Router combiner
├── shared.ts             (~100 lines)  - Utilities, service access
├── feed.routes.ts        (~550 lines)  - /periods, /notes/*
├── media.routes.ts       (~700 lines)  - /media*, /image, /video*, /transcription/*
├── social.routes.ts      (~680 lines)  - /graph/*, /friends/*
├── groups.routes.ts      (~280 lines)  - /groups/*
├── messenger.routes.ts   (~180 lines)  - /messenger/*
└── meta.routes.ts        (~380 lines)  - /advertisers/*, /pages/*, /reactions/*
```

#### Route Mapping

| Current Route | Target Module |
|---------------|---------------|
| `/periods` | feed.routes.ts |
| `/media*`, `/image`, `/serve-media`, `/video*` | media.routes.ts |
| `/transcription/*` | media.routes.ts |
| `/graph/*`, `/friends/*` | social.routes.ts |
| `/groups/*` | groups.routes.ts |
| `/messenger/*` | messenger.routes.ts |
| `/notes/*` | feed.routes.ts |
| `/advertisers/*`, `/pages/*`, `/reactions/*` | meta.routes.ts |

#### Implementation Steps

1. Create `routes/facebook/` directory
2. Create `shared.ts` with lazy-initialized services
3. Extract each route group to its module
4. Create `index.ts` to combine routers
5. Update imports in main routes file
6. Test all 55 routes still work

---

### 3. FacebookView.tsx Tabs (AFTER ROUTES)

**File:** `apps/web/src/components/archive/FacebookView.tsx`
**Current:** 1,991 lines, 7 tabs
**Target:** 18 files (tabs + hooks + shared)

#### Proposed Structure

```
components/archive/
├── FacebookView.tsx                    (~200 lines)  - Container
└── facebook/
    ├── shared/
    │   ├── types.ts                    (~185 lines)  - All interfaces
    │   ├── mediaUtils.ts               (~40 lines)   - Media URL utilities
    │   ├── formatters.ts               (~30 lines)   - Date/size formatters
    │   └── useFacebookShared.ts        (~50 lines)   - Shared state hook
    ├── tabs/
    │   ├── FacebookFeedTab.tsx         (~350 lines)
    │   ├── FacebookGalleryTab.tsx      (~380 lines)
    │   ├── FacebookNotesTab.tsx        (~280 lines)
    │   ├── FacebookGroupsTab.tsx       (~320 lines)
    │   ├── FacebookMessengerTab.tsx    (~280 lines)
    │   ├── FacebookAdvertisersTab.tsx  (~250 lines)
    │   └── FacebookLightbox.tsx        (~160 lines)
    └── hooks/
        ├── useFeedData.ts              (~150 lines)
        ├── useGalleryData.ts           (~180 lines)
        ├── useNotesData.ts             (~120 lines)
        ├── useGroupsData.ts            (~130 lines)
        ├── useMessengerData.ts         (~130 lines)
        └── useAdvertisersData.ts       (~120 lines)
```

#### State by Tab

| Tab | Key State Variables |
|-----|---------------------|
| Feed | items, filterType, ownContentOnly, searchQuery |
| Gallery | media, mediaStats, thumbnailSize, show filters, lightbox state |
| Notes | notes, notesSearch, expandedNoteId |
| Groups | groups, groupsSearch, selectedGroupId, groupContent |
| Messenger | messengerThreads, messengerSearch, selectedThreadId, threadMessages |
| Advertisers | advertisers, advertisersSearch, advertiserStats, showDataBrokersOnly |

#### Implementation Phases

**Phase 1:** Extract shared utilities (low risk)
**Phase 2:** Extract shared state hook (medium risk)
**Phase 3:** Extract tab-specific hooks (medium risk)
**Phase 4:** Extract tab components (high risk)
**Phase 5:** Extract lightbox (optional)

---

## Additional Technical Debt (From Audit)

### CSS Violations (Partially Fixed)
- Fixed 15 critical button/active state violations
- ~68 remaining `color: white` in media overlays/lightboxes (may be intentional)

### Other Large Files Identified
- `EmbeddingDatabase.ts`: 4,725 lines (down from 6,260) - could split further
- `views.css`: 3,524 lines - split into gallery.css, facebook.css, etc.
- `panels.css`: 2,438 lines - split by panel type
- `books-tab.css`: 2,422 lines - extract book-grid.css, book-cards.css

### Code Quality
- 1,381 console.log statements - needs proper logging service
- 22 TODO/FIXME comments - manageable tech debt
- Test coverage <1% - add tests after modularization

---

## To Resume Next Session

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Retrieve this context
mcp__chromadb-memory__search_by_tag(["jan-14-2026"])
mcp__chromadb-memory__search_by_tag(["modularization"])
```

### Recommended Start

1. Read this handoff
2. Start with `facebook.ts` routes (smaller scope, clearer boundaries)
3. Create directory structure first
4. Extract one route group at a time, testing after each

### Commands to Verify

```bash
# Build electron
npm run build:electron

# Test routes
curl http://localhost:3002/api/facebook/groups/stats
curl http://localhost:3002/api/facebook/messenger/stats
```

---

## Key Files

| File | Purpose |
|------|---------|
| `electron/archive-server/routes/facebook.ts` | Routes to split (2,932 lines) |
| `apps/web/src/components/archive/FacebookView.tsx` | Component to split (1,991 lines) |
| `electron/archive-server/services/embeddings/EmbeddingMigrations.ts` | NEW - extracted migrations |
| `README.md` | NEW - comprehensive architecture docs |

---

## House Council Status

| House | Status | Notes |
|-------|--------|-------|
| Stylist | WARN | 15 CSS fixes applied, 68 remain in overlays |
| Architect | WARN | 2 files still need modularization |
| Security | PASS | No issues |
| Data | PASS | No issues |
| Accessibility | SKIP | Needs component-level audit |

---

**Session End:** Jan 14, 2026
**Next Priority:** facebook.ts routes modularization
