# Handoff: Book Making Audit & Option B Plan
**Date**: January 6, 2026
**Status**: Audit Complete, Ready for Option B Testing

---

## Executive Summary

The book-making system is fragmented across **multiple implementations** built over 6 weeks:

1. **MCP BookBuilder** (Dec 2025) - Created "Intergalactic Phenomenology"
   - Worked via Claude Code + MCP tools
   - Pandoc pipeline, LaTeX rendering
   - 82-page PDF produced successfully

2. **humanizer-gm AUI** (Current) - GUI-based
   - harvest_archive, generate_first_draft, propose_arc tools exist
   - GUI buttons don't cleanly map to tools
   - Data flows through 5+ disconnected storage layers

3. **curl-based Pipeline** (Dec 31 test) - API direct
   - Archive search → SIC analysis → Arc trace → Draft generation
   - Proven working via curl commands
   - No GUI involvement

**The core insight**: The TOOLS work when called directly. The GUI is the problem.

---

## How "Intergalactic Phenomenology" Was Built

From ChromaDB memories (Dec 21-31, 2025):

### Process Used:
```
1. CORPUS COLLECTION
   - Merged Gemini (skeleton) + ChatGPT (flesh) corpora
   - 9 merged modules as markdown

2. PERSONA EXTRACTION
   - Searched for notebook transcripts
   - Identified voice: synthesizes across traditions,
     creates novel metaphors (√-1), first-person reflective

3. RAW MATERIAL SEARCH
   - QBism: SIC-POVMs, Born Rule, observer probabilities
   - Phenomenology: Husserl, intentionality, noesis/noema
   - Found intersection: "Being in a Field", "Three Worlds"

4. SIC ANALYSIS
   - Used /quantum-analysis/start and /step endpoints
   - Measured literal/metaphorical/both/neither probabilities
   - Peak purity (0.53) at √-1 metaphor passage
   - Entropy decrease 2.0 → 1.73 (increased certainty through arc)

5. ARC TRACING
   - Hard Problem opening
   - √-1 central metaphor
   - QBism bridge
   - SIC-POVM technical foundation
   - Three Worlds integration
   - Return to opening

6. DRAFT GENERATION
   - Ollama qwen3:14b with persona voice
   - ~700 word chapters

7. RENDERING
   - Pandoc with LaTeX typography
   - Saddle-stitch booklet imposition
```

### MCP Tools Used:
- `create_book`, `add_chapter`, `add_section`, `add_page`
- `get_book_structure`, `generate_cover`, `export_book`
- Located in: `~/.claude/plugins/book-builder/`

---

## Current humanizer-gm Tools (AUI)

### Working:
| Tool | Function | Tested |
|------|----------|--------|
| `create_book` | Creates book in Xanadu SQLite | ✅ Jan 6 |
| `harvest_archive` | Semantic search → candidates | ✅ Jan 6 |
| `list_personas` | Shows available personas | ✅ |
| `quantum_read` | Tetralemma POVM analysis | ⚠️ MCP issues |

### Exist But Untested:
| Tool | Function | Issue |
|------|----------|-------|
| `add_passage` | Add to book | Unclear if wired |
| `mark_passage` | Approve/reject/gem | GUI disconnect |
| `propose_narrative_arc` | Keyword clustering → themes | Needs 3+ approved |
| `trace_narrative_arc` | Assign passages to chapters | Needs arc first |
| `generate_first_draft` | LLM draft from passages | Needs NPE-API |
| `apply_persona` | Transform with persona | Exists |

### Not Implemented:
- `auto_curate` - Automatically approve high-SIC passages
- `analyze_passage_sic` - Get SIC scores for harvest candidate
- Integration between quantum_read and harvest curation

---

## Data Storage Fragmentation

| Data Type | Storage Location | Access |
|-----------|------------------|--------|
| Books | SQLite `.embeddings.db` | Xanadu IPC |
| Passages | SQLite `.embeddings.db` | Xanadu IPC |
| Harvest Buckets | SQLite (migrated) | Xanadu IPC |
| Conversations | SQLite + Filesystem | Archive server |
| Personas | SQLite | Xanadu IPC |
| Library Seeds | Hardcoded TypeScript | Loaded on startup |

---

## GUI vs AUI Mapping (Current Issues)

| GUI Button | Expected Action | Actual Behavior |
|------------|-----------------|-----------------|
| + New Project | create_book | ✅ Works now |
| Start Harvest | harvest_archive | ✅ Works now |
| View Source | Load conversation | ⚠️ 404 fixed, shows roles only |
| Review | Open in workspace | Loads conversation, unclear next |
| Stage | ??? | Button exists, purpose unclear |
| Commit | Add to chapter? | Doesn't seem connected |
| Approve/Reject/Gem | mark_passage | Buttons exist, data unclear |

---

## Option B: Direct Tool Testing Plan

### Test Case: "Buddhism and Phenomenology"

**Objective**: Create a first draft chapter using AUI tools directly, bypassing GUI.

**Step 1: Verify Book Exists**
```
Already created: book://user/buddhism-and-phenomenology
ID: 1767733846537-nq5fokr1x
```

**Step 2: Check Harvest Results**
```
40 candidates collected from search
Need to: list passages, check their status
```

**Step 3: Mark Best Passages**
```
USE_TOOL(mark_passage, {"id": "xxx", "status": "approved"})
Need: passage IDs from harvest
```

**Step 4: Propose Narrative Arc**
```
USE_TOOL(propose_narrative_arc, {
  "book_uri": "book://user/buddhism-and-phenomenology",
  "thesis": "Phenomenology and Buddhist philosophy converge on consciousness as primary",
  "arc_type": "dialectical"
})
```

**Step 5: Generate First Draft**
```
USE_TOOL(generate_first_draft, {
  "chapterTitle": "The Meeting of East and West",
  "style": "reflective, synthesizing traditions, first-person philosophical"
})
```

**Step 6: Apply Persona (if available)**
```
USE_TOOL(list_personas)
USE_TOOL(apply_persona, {"persona": "xxx", "text": "..."})
```

### Required Debugging
- Get list of passage IDs from harvest bucket
- Verify mark_passage actually persists
- Check if passages flow to generate_first_draft
- Test NPE-API connectivity for LLM calls

---

## Critical Gaps Identified

### 1. No SIC Integration in Harvest
**Current**: Passages ranked only by embedding similarity
**Needed**: Quantum analysis scores (purity, entropy, tetralemma) to identify load-bearing sentences

### 2. No Auto-Curate Flow
**Current**: Manual approve/reject for each of 40+ candidates
**Needed**: `auto_curate(threshold=0.6)` to bulk-approve high-quality

### 3. Persona Not in Draft Generation
**Current**: `generate_first_draft` has optional `style` param
**Needed**: Proper persona injection from extracted notebook persona

### 4. MCP vs AUI Tool Mismatch
**MCP BookBuilder**: create_book, add_chapter, add_section, add_page
**humanizer-gm AUI**: create_book, generate_first_draft, add_passage
**Different models** - not compatible

---

## Recommended Approach for Next Session

### Phase 1: Verify Tool Chain (30 min)
1. List harvest bucket contents
2. Get passage IDs and check status
3. Manually approve 5-10 best passages
4. Attempt propose_narrative_arc

### Phase 2: Draft Generation (30 min)
1. If arc succeeds, attempt generate_first_draft
2. Check NPE-API availability
3. Test with and without persona

### Phase 3: Fix or Document Gaps (60 min)
1. Document what broke and why
2. Either fix blocking issues OR
3. Create minimal curl-based pipeline as workaround

---

## API Endpoints (from Dec 31 test)

```bash
# Semantic search
POST /api/embeddings/search/messages
Body: {"query": "...", "limit": 40, "role": "assistant"}

# Quantum/SIC analysis
POST /quantum-analysis/start
Body: {"text": "..."}

POST /quantum-analysis/:id/step
Body: {}

# LLM generation (Ollama)
POST http://localhost:11434/api/generate
Body: {"model": "qwen3:14b", "prompt": "..."}

# Conversations
GET /api/conversations/:folderOrId
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `apps/web/src/lib/aui/tools.ts` | All AUI tool implementations |
| `apps/web/src/lib/bookshelf/BookshelfContext.tsx` | Book state management |
| `apps/web/src/lib/bookshelf/HarvestBucketService.ts` | Harvest bucket CRUD |
| `apps/web/src/components/tools/HarvestQueuePanel.tsx` | Harvest GUI |
| `electron/archive-server/routes/embeddings.ts` | Search API |
| `electron/archive-server/routes/conversations.ts` | Conversation API |

---

## ChromaDB Tags for Retrieval
`book-making, option-b, handoff, jan-2026, buddhism-phenomenology, harvest, draft-generation, sic-analysis`

---

**End of Handoff**
