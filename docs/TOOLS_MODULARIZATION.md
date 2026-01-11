# Tools.ts Modularization - Task Scope Document

**Created**: January 11, 2026
**Status**: In Progress
**Context**: Multi-session refactoring task

---

## Overview

The file `apps/web/src/lib/aui/tools.ts` is being modularized from a 5,334-line monolith into focused modules. This document guides consistent implementation across multiple Claude sessions.

---

## Current State

### Completed (Session 1)
- [x] Created `tools/` directory structure
- [x] Extracted `tools/types.ts` - Type definitions
- [x] Extracted `tools/parser.ts` - USE_TOOL parsing
- [x] Extracted `tools/system-prompt.ts` - AUI system prompt
- [x] Created `tools/index.ts` - Barrel exports
- [x] Updated `tools.ts` imports to use new modules
- [x] Verified TypeScript compiles and build passes

**Lines reduced**: 5,334 → 4,666 (668 lines extracted)

### Remaining Extractions

| Module | Lines (approx) | Status | Functions |
|--------|----------------|--------|-----------|
| `book.ts` | 300 | Pending | executeCreateBook, executeUpdateChapter, executeCreateChapter, executeDeleteChapter, executeRenderBook, executeListChapters, executeGetChapter |
| `workspace.ts` | 150 | Pending | executeGetWorkspace, executeSaveToChapter |
| `archive.ts` | 450 | Pending | executeSearchArchive, executeCheckArchiveHealth, executeBuildEmbeddings, executeSearchFacebook, isValidSearchResult |
| `passages.ts` | 240 | Pending | executeAddPassage, executeListPassages, executeMarkPassage |
| `images.ts` | 350 | Pending | executeDescribeImage, executeSearchImages, executeClassifyImage, executeFindSimilarImages, executeClusterImages, executeAddImagePassage |
| `personas.ts` | 490 | Pending | executeListPersonas, executeListStyles, executeApplyPersona, executeApplyStyle, executeExtractPersona, executeExtractStyle, executeDiscoverVoices, executeCreatePersona, executeCreateStyle |
| `transforms.ts` | 380 | Pending | executeHumanize, executeDetectAI, executeTranslate, executeAnalyzeText, executeQuantumRead |
| `pyramid.ts` | 300 | Pending | executeBuildPyramid, executeGetPyramid, executeSearchPyramid, executeGenerateFirstDraft, executeFillChapter |
| `conversations.ts` | 580 | Pending | executeListConversations, executeHarvestArchive |
| `agents.ts` | 220 | Pending | executeListAgents, executeGetAgentStatus, executeListPendingProposals, executeRequestAgent |
| `workflows.ts` | 320 | Pending | executeDiscoverThreads, executeStartBookWorkflow, ThreadPassage, DiscoveredThread |
| `harvest-buckets.ts` | 800 | Pending | executeHarvestForThread, executeProposeNarrativeArc, executeTraceNarrativeArc, executeFindResonantMirrors, executeDetectNarrativeGaps |
| `executor.ts` | 250 | Pending | executeTool, executeAllTools, normalizeToolName |

---

## Extraction Pattern (FOLLOW EXACTLY)

### Step 1: Read the Section
```bash
# Find section boundaries
grep -n "// ═══.*SECTION_NAME" apps/web/src/lib/aui/tools.ts
```

### Step 2: Create Module File

**File header template:**
```typescript
/**
 * AUI Tools - [Module Name]
 *
 * [Brief description of what this module handles]
 */

import type { AUIContext, AUIToolResult } from './types';
// Add other imports as needed from:
// - './types' for type definitions
// - External services (../transform/service, ../platform, etc.)
// - DO NOT import from '../tools' (circular dependency)
```

### Step 3: Copy Functions
- Copy all functions in the section
- Update imports at the top
- Export all public functions

### Step 4: Update tools.ts
- Remove the copied section
- Add import from new module
- Add re-export if function was previously exported

### Step 5: Update index.ts
- Add re-export for any publicly exported functions

### Step 6: Verify
```bash
# Type check
npx tsc --noEmit -p apps/web/tsconfig.json

# Build
npm run build --workspace=apps/web
```

---

## Dependency Map

```
Level 0 (No internal deps):
  types.ts
  parser.ts
  system-prompt.ts

Level 1 (Depends on types only):
  book.ts → types
  workspace.ts → types
  archive.ts → types, gui-bridge
  passages.ts → types
  images.ts → types
  personas.ts → types
  transforms.ts → types
  pyramid.ts → types
  conversations.ts → types, gui-bridge
  agents.ts → types, agent-bridge
  workflows.ts → types
  harvest-buckets.ts → types, gui-bridge

Level 2 (Orchestrator):
  executor.ts → ALL Level 1 modules
```

**Critical**: No module at Level 1 should import from another Level 1 module.

---

## External Dependencies by Module

### book.ts
- `./types` (AUIContext, AUIToolResult, BookProject, DraftChapter)

### workspace.ts
- `./types` (AUIContext, AUIToolResult, WorkspaceState)

### archive.ts
- `./types` (AUIToolResult)
- `../../platform` (getArchiveServerUrl)
- `../gui-bridge` (dispatchSearchResults, dispatchOpenPanel)

### passages.ts
- `./types` (AUIContext, AUIToolResult, SourcePassage)

### images.ts
- `./types` (AUIContext, AUIToolResult)
- `../../platform` (getArchiveServerUrl)

### personas.ts
- `./types` (AUIContext, AUIToolResult)
- `../../transform/service` (transformPersona, transformStyle, getPersonas, getStyles)
- `../../profile` (extractPersona, extractStyle, discoverVoices, toUnifiedPersona, toUnifiedStyle)
- `../../auth` (getStoredToken)

### transforms.ts
- `./types` (AUIContext, AUIToolResult)
- `../../transform/service` (humanize, detectAI, detectAILite, analyzeSentences)
- `../../auth` (getStoredToken)

### pyramid.ts
- `./types` (AUIContext, AUIToolResult)
- `../../pyramid` (buildPyramid, searchChunks)
- `../../auth` (getStoredToken)

### conversations.ts
- `./types` (AUIContext, AUIToolResult)
- `../../platform` (getArchiveServerUrl)
- `../gui-bridge` (dispatchSearchResults, dispatchOpenPanel)

### agents.ts
- `./types` (AUIToolResult)
- `../agent-bridge` (getAgentBridge)

### workflows.ts
- `./types` (AUIContext, AUIToolResult)

### harvest-buckets.ts
- `./types` (AUIContext, AUIToolResult)
- `../../bookshelf/HarvestBucketService` (harvestBucketService)
- `@humanizer/core` (HarvestBucket, NarrativeArc, ArcType)
- `../../platform` (getArchiveServerUrl)
- `../gui-bridge` (dispatchSearchResults, dispatchOpenPanel)

### executor.ts
- `./types` (AUIContext, AUIToolResult, ParsedToolUse)
- `./parser` (parseToolUses)
- ALL tool modules (book, workspace, archive, etc.)

---

## Section Markers in tools.ts

Use these to locate sections:
```
// ═══════════════════════════════════════════════════════════════════
// SECTION NAME
// ═══════════════════════════════════════════════════════════════════
```

Current sections (grep to find line numbers):
- TOOL EXECUTOR
- TOOL IMPLEMENTATIONS (book tools)
- WORKSPACE TOOLS
- ARCHIVE SEARCH TOOLS
- PASSAGE MANAGEMENT TOOLS
- IMAGE TOOLS
- PERSONA/STYLE TOOLS
- TEXT TRANSFORMATION TOOLS
- PYRAMID BUILDING TOOLS
- CONVERSATION & HARVESTING TOOLS
- AGENT TOOLS
- WORKFLOW TOOLS
- PHASE 3: HARVEST BUCKET TOOLS

---

## Verification Checklist (After Each Module)

- [ ] TypeScript compiles: `npx tsc --noEmit -p apps/web/tsconfig.json`
- [ ] Build passes: `npm run build --workspace=apps/web`
- [ ] No circular imports (check for errors mentioning cycles)
- [ ] All exports maintained (grep for function usage)
- [ ] tools.ts line count decreased

---

## Handoff Protocol

When ending a session:

1. **Update this document** with:
   - Which modules were completed
   - Current line count of tools.ts
   - Any issues encountered

2. **Commit progress** with message:
   ```
   refactor(aui): extract [module] tools from tools.ts

   - Created tools/[module].ts ([N] lines)
   - tools.ts: [old] → [new] lines
   - [N] modules remaining
   ```

3. **Store in ChromaDB**:
   ```
   Tags: tools-modularization, aui-refactor, [date]
   ```

---

## Progress Tracking

### Session 1 (Jan 11, 2026)
- Completed: types.ts, parser.ts, system-prompt.ts, index.ts
- tools.ts: 5,334 → 4,666 lines
- Also fixed 3 BLOCKING security issues (XSS, token storage)

### Session 2 (Jan 11, 2026 - continued)
- Completed: book.ts, workspace.ts, archive.ts, passages.ts, images.ts
- tools.ts: 4,666 → 3,372 lines
- **Total extracted: 1,962 lines (37%)**
- Modules remaining: 7 (personas, transforms, pyramid, conversations, agents, workflows, harvest-buckets)

---

## Best Practices

1. **One module at a time** - Complete extraction, verify, commit
2. **Don't change function signatures** - Maintain API compatibility
3. **Keep tools.ts re-exports** - Existing imports must work
4. **Test after each extraction** - Catch errors early
5. **Update index.ts** - Keep barrel exports current
6. **Watch for shared helpers** - Some functions may be used across modules

---

## Known Shared Dependencies

These are used by multiple tool functions:
- `NPE_API_BASE` constant (currently in tools.ts)
- `getArchiveServerUrl()` from platform
- `getStoredToken()` from auth
- `dispatchSearchResults()`, `dispatchOpenPanel()` from gui-bridge

Consider creating `tools/constants.ts` if needed for shared constants.

---

**End of Document**
