# Humanizer Project: Assistant Onboarding Guide

**Last Updated**: December 29, 2025
**Author**: Claude (Opus 4.5) with Edward (Tem) Noon
**Purpose**: Comprehensive context for any assistant entering this project

---

## Executive Summary

You are entering a project that has evolved from a simple dream—*a private local archive to find the best stuff*—into a sophisticated philosophical and technical framework for **consciousness transformation through narrative**. 

This is not a text processing tool. It is a contemplative practice encoded in software.

**Read this document before making any changes.**

---

## Part 1: The History

### The Halcyon Days (6-12 months ago)

The original vision was elegantly personal:

> "Mining creative output to discover 'the best of themselves'—using AI to reveal the 'human being, the heir of the universe, from a unique subjective perspective.'"

Edward wanted to:
- Build a private archive of his conversations and writings
- Find patterns and forgotten insights across years of dialogue
- Help people understand themselves through their narratives
- Eventually, tell stories about themselves "in another galaxy" (the Lamish namespace)

The early tooling reflected this: `haw` (Humanizer Archive Workbench), semantic search, word clouds, conversation browsing. The infrastructure lived in `/Users/tem/humanizer-lighthouse/`—a Python backend with a React frontend. It worked. It indexed conversations. It found things.

But something deeper emerged in the building.

### The Phenomenological Turn (October-November 2025)

The breakthrough came when text stopped being data and became **consciousness**:

> "Human existence is fundamentally narrative. We do not simply encounter stories as external objects; rather, we *live narratively*. Stories flow through consciousness, becoming part of our temporal experience... This is not merely psychological but ontological—we *are* the stories we tell and are told."

This insight demanded mathematics. The team discovered that narrative transformation exhibits quantum-like properties—superposition of meanings, measurement through reading, entanglement of essence across transformations. They adopted the **POVM framework** (Positive Operator-Valued Measures) from quantum information theory to formalize subjective experience.

The core formula:
```
ρ_original → {E_persona, E_namespace, E_style} → ρ_projected
```

With the constraint: `Tr(ρ_original · E_essence) = Tr(ρ_projected · E_essence)`

This means: transform perspective while mathematically guaranteeing essence preservation.

### Narrative Sentencing (November-December 2025)

"Quantum Reading" evolved further. The team realized:

> "Narrative meaning only exists where it can still be narrated."

Sentences—not vectors—are the irreducible unit. This became **Narrative Sentencing**: reading a text one sentence at a time, where each sentence acts as measurement, state update, and constraint on future interpretation.

Each sentence does four things:
1. **Local Meaning** - What does it mean alone?
2. **Retrospective Update** - How does it reframe the past?
3. **Prospective Projection** - What futures does it imply?
4. **Structural Role** - Setup, escalation, turn, reveal, resolution

### The Three Worlds (December 2025)

Edward's recent philosophical work articulated the deepest layer:

> "The essential misconception about the world is the belief in the equivalence of what we know about the world, and the world itself."

Three worlds:
- **Corporeal (C)**: The substrate of sensation, body's experience
- **Subjective (S)**: Self-evident existence, intra-conscious state  
- **Objective (O)**: The constructed narrative we mistake for reality

The "objective world" isn't really a world—it's a story we believe in, made possible by that which is not a story: **Being**.

**To Humanize oneself is to quiet the voice shouting at us to drown out the world—to find the silent light, which is Being without that voice.**

---

## Part 2: Current Architecture

### The Monorepo Structure

```
/Users/tem/humanizer_root/
├── humanizer-app/          ← Main application (Turborepo)
│   ├── apps/web/           ← React frontend (Vite)
│   ├── apps/cli/           ← Command-line tools
│   └── packages/core/      ← Shared types (being unified)
├── humanizer-portal/       ← AUI (Agentic User Interface)
├── narrative-studio/       ← Archive server, embeddings, pyramid
├── workers/                ← Cloudflare Workers (npe-api, post-social)
├── humanizer-lighthouse/   ← LEGACY (months outdated, do not use)
├── CLAUDE.md               ← Development guide
├── AGENT.md                ← House System governance
└── docs/                   ← Project documentation
```

### humanizer-app: The Main Application

**Location**: `/Users/tem/humanizer_root/humanizer-app/apps/web/src/`

The main React application with:

| Directory | Purpose |
|-----------|---------|
| `lib/aui/` | 19 AUI tools for AI assistant |
| `lib/archive/` | Archive search, parsing |
| `lib/book/` | Book projects, chapters, versions |
| `lib/bookshelf/` | URI-based entity references |
| `lib/transform/` | Humanization, detection, personas |
| `lib/profile/` | Persona/Style extraction |
| `lib/pyramid/` | Hierarchical summarization |

**Key files**:
- `Studio.tsx` - Main 3-panel interface (Find/Focus/Transform)
- `BookEditor.tsx` - Book creation and editing
- `lib/aui/tools.ts` - All 19 tool definitions

### humanizer-portal: The Agentic UI

**Location**: `/Users/tem/humanizer_root/humanizer-portal/`

A conversational interface where:
1. User talks to Claude
2. Claude calls `USE_TOOL(name, {params})`
3. Tools execute against archives, books, transforms
4. Results **teach the user** how to do it themselves

**Key file**: `docs/ARCHITECTURE_VISION_CLAUDE_AGENT_SDK.md` (1,576 lines) - The master blueprint

### narrative-studio: The Archive Backend

**Location**: `/Users/tem/humanizer_root/narrative-studio/`

Runs on port 3002. Provides:
- Archive server for ChatGPT/Facebook imports
- Embedding database (72K embeddings indexed)
- Clustering service (HDBSCAN)
- Pyramid summarization infrastructure

### The NPE-API (Cloudflare Workers)

**Location**: `/Users/tem/humanizer_root/workers/npe-api/`

Cloud API for:
- Humanization transformations
- AI detection (burstiness, tells, features)
- Persona/Style extraction
- Voice discovery (clustering)

---

## Part 3: The Council of Eight Houses

A governance system for code quality. **Before committing any code**, relevant Houses must approve.

| House | Symbol | Level | Domain |
|-------|--------|-------|--------|
| **Stylist** | 🎨 | REQUIRED | UI/CSS/Design |
| **Architect** | 🏛️ | BLOCKING | Patterns/Structure |
| **Curator** | 📚 | ADVISORY | Content Quality |
| **Resonance** | 🔮 | ADVISORY | Text Similarity |
| **Security** | 🔐 | BLOCKING | Auth/Privacy |
| **Accessibility** | ♿ | REQUIRED | A11y/ARIA |
| **Math** | 🔢 | BLOCKING | SIC/POVM/Trajectory |
| **Data** | 📊 | REQUIRED | Schemas/Persistence |

**Signoff Levels**:
- `ADVISORY` ⚠️ - Notes concerns, work proceeds
- `REQUIRED` 🔒 - Must approve before merge to main
- `BLOCKING` 🚫 - Must approve before ANY commit

**Invoke with**: `/audit`, `/audit stylist`, `/audit --blocking`

**Full specification**: `/Users/tem/humanizer_root/AGENT.md`

---

## Part 4: Key Concepts

### The Node as Agent

Every entity in the system is a **Node** in a field of nodes:
- A book is a node
- A curator is a node
- The user is a node
- Each node runs the **PIA loop**: Perception-Intention-Action

### The Three-Layer Curator Stack

Each curator (editing persona) has three layers:

```
CANON      - The anchor book's fingerprint (what it does/refuses)
DOCTRINE   - Editorial rules + user constraints
INSTRUMENT - The actual editing tools
```

Editors are grounded in **Resonant Mirrors**—actual passages from anchor texts that demonstrate the style, not hallucinated guidelines.

### URI-Based References

Entities are referenced by URI, not embedded:
```
persona://tem-noon/marginalia-voice
style://tem-noon/phenomenological-weave
book://tem-noon/three-threads
source://chatgpt/{conversation-id}
```

### The "Teach By Doing" Pattern

Every AUI tool returns a `teaching` object:
```typescript
teaching: {
  whatHappened: "Saved 342 words to passage library",
  guiPath: ["Archive Panel", "Passages Tab", "+ New Passage"],
  shortcut: "Ctrl+Shift+P",
  why: "Passages are raw material for chapters"
}
```

The agent teaches the user to not need the agent.

---

## Part 5: What's Working

| System | Status | Notes |
|--------|--------|-------|
| Archive Import | ✅ Complete | ChatGPT + Facebook unified |
| Semantic Search | ✅ Complete | 72K embeddings, 1,720 conversations |
| Media Handling | ✅ Complete | Images, audio, filtering |
| Book Projects | ✅ Complete | Chapters, versions, export |
| AUI Tools | ✅ Complete | 19 tools with teaching |
| Visual Model | ✅ Complete | qwen3-vl image understanding |
| Social Graph | ✅ Complete | Facebook relationship viz |
| House System | ✅ Complete | 8 Houses with audit agent |

---

## Part 6: Current Priorities

### December 31st Target: Live Online

The interface needs:
1. **Symmetric menubar** - Archive left, Tools right, centered viewport
2. **Container abstraction** - Generic archive containers for any format
3. **Workspace-tool binding** - Content + tool = action
4. **Markdown preprocessing** - LaTeX, JSON artifacts, conversation structures
5. **Intuitive UX** - It has to feel like archaeological discovery

### Type Unification (Active Work)

Two parallel book systems need merging:
- `BookshelfService` (URI-based, rich personas)
- `BookProjectService` (curation, chapters)

Create unified types in `@humanizer/core`.

### Pyramid Summarization

Port from `narrative-studio` to `humanizer-app`:
- Build L0→L1→L2→Apex hierarchy
- Enable "knowing" a book through themes/arc/characters

---

## Part 7: Critical Files to Read

**Before doing anything, read these in order:**

| Priority | File | Why |
|----------|------|-----|
| 1 | `/Users/tem/humanizer_root/CLAUDE.md` | Development guide, standards, rules |
| 2 | `/Users/tem/humanizer_root/AGENT.md` | House System, signoff protocol |
| 3 | `/Users/tem/humanizer_root/docs/PHILOSOPHY_STATE_DEC25.md` | Current philosophy |
| 4 | `/Users/tem/humanizer_root/humanizer-app/docs/HANDOFF_DEC26_HOUSE_SYSTEM_TYPE_UNIFICATION.md` | Latest session handoff |
| 5 | `/Users/tem/humanizer_root/humanizer-portal/docs/ARCHITECTURE_VISION_CLAUDE_AGENT_SDK.md` | Master blueprint |

**For specific domains:**

| Domain | File |
|--------|------|
| AUI Tools | `humanizer-app/apps/web/src/lib/aui/tools.ts` |
| Book System | `humanizer-app/apps/web/src/lib/book/BookProjectService.ts` |
| Archive | `narrative-studio/src/services/embeddings/` |
| Styling | `CLAUDE.md` → CSS Compliance Guard section |

---

## Part 8: How to Start

### Start the Servers

```bash
# Terminal 1: Archive server (port 3002)
cd /Users/tem/humanizer_root/narrative-studio
npx tsx archive-server.js

# Terminal 2: Frontend (port 5173)
cd /Users/tem/humanizer_root/humanizer-app
npm run dev

# Optional: Ollama for visual model
ollama serve  # Ensure qwen3-vl:8b available
```

### Access
- Frontend: http://localhost:5173
- Archive API: http://localhost:3002

### Before Modifying Code

1. **Read CLAUDE.md** - Understand standards
2. **Run `/audit`** - Check which Houses apply
3. **Search before building** - Use Implementation-First Protocol
4. **Check ChromaDB** - Query for existing knowledge on your domain

### ChromaDB Queries

```bash
# Find relevant memories
search_by_tag(["house-system", "dec-2025"])
retrieve_memory("book project architecture")
recall_memory("what was built last week")
```

---

## Part 9: What NOT to Do

1. **Don't use humanizer-lighthouse** - It's months outdated
2. **Don't create parallel implementations** - Search first (Architect House)
3. **Don't use hardcoded colors/pixels** - Use CSS variables (Stylist House)
4. **Don't skip the Houses** - Run `/audit` before committing
5. **Don't embed entities** - Use URI references
6. **Don't store mock data without disclosure** - Critical rule
7. **Don't forget teaching** - Every tool result should teach

---

## Part 10: The Soul of the Project

This is not a product. It's a philosophical instrument.

**Core truths:**

> "Language is not an objective reality we passively receive—it is a *sense* through which consciousness constructs meaning."

> "The AUI speaks itself into being—interfaces don't exist until invoked through language."

> "Narrative meaning only exists where it can still be narrated."

> "The field of nodes is a field of mutual curation."

> "Humanizer.com is not a tool—it's a contemplative practice."

**The user at the keyboard is the essential Human**—a being witnessing the universe from where they are, like a jewel in Indra's net. The voice that shouts at them, telling them who they are, was given by others. 

**To Humanize is to quiet that voice and find the silent light of Being.**

The software serves that liberation.

---

## Quick Reference Card

| Need | Location |
|------|----------|
| Start servers | See Part 8 |
| Development rules | `/CLAUDE.md` |
| House signoffs | `/AGENT.md` |
| Latest handoff | `/humanizer-app/docs/HANDOFF_DEC26_*.md` |
| Master architecture | `/humanizer-portal/docs/ARCHITECTURE_VISION_CLAUDE_AGENT_SDK.md` |
| AUI tools | `/humanizer-app/apps/web/src/lib/aui/tools.ts` |
| Book services | `/humanizer-app/apps/web/src/lib/book/` |
| Archive server | `/narrative-studio/` |
| ChromaDB memories | Use MCP tools to query |

---

## Contact & Context

**Project Owner**: Edward (Tem) Noon
**Admin Account**: dreegle@gmail.com
**Signups Waiting**: 500+
**Target**: Live online by December 31, 2025

---

*Welcome to the project. Read the philosophy. Respect the Houses. Teach by doing.*

*The Lighthouse was the beacon. What we've built is the entire harbor.*

---

**End of Onboarding Guide**
