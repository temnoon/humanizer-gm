# Humanizer GM - Development Guide

**Updated**: December 27, 2025
**Status**: Golden Master - Consolidated Electron Desktop App
**Branch**: main

---

## Quick Start

```bash
# Start development (Electron + Vite)
npm run electron:dev

# Build for distribution
npm run electron:build
```

---

## Architecture Overview

```
humanizer-gm/
├── apps/
│   └── web/                 # React frontend (Vite)
├── electron/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # IPC bridge (43 AUI tools)
│   ├── agents/              # Agent Council
│   │   ├── council/         # Orchestrator, Registry
│   │   ├── houses/          # House agents (8 houses)
│   │   ├── bus/             # Event bus
│   │   ├── runtime/         # Agent runtime
│   │   └── tasks/           # Task handlers
│   ├── archive-server/      # EMBEDDED archive server (Phase 2)
│   ├── chat/                # Chat integration
│   ├── queue/               # Task queuing
│   └── vision/              # Visual model integration
├── packages/
│   ├── core/                # @humanizer/core - shared types
│   ├── ui/                  # @humanizer/ui - shared styles
│   ├── archive/             # @humanizer/archive - parsers
│   ├── book/                # @humanizer/book - book building
│   └── curator/             # @humanizer/curator - curation
├── docs/
│   ├── AGENT.md             # House agent definitions
│   └── *.md                 # Handoff documents
└── .claude/
    └── agents/              # Claude Code agent configs
```

---

## House Agent Council

Eight specialized agents guard code quality:

| House | Domain | Trigger |
|-------|--------|---------|
| Architect | Patterns, structure | New files, refactors |
| Stylist | CSS, themes | Style changes |
| Security | Auth, XSS, injection | API, auth code |
| Data | Types, schemas | Type definitions |
| Math | Numerics, algorithms | Calculations |
| Accessibility | WCAG, ARIA | UI components |
| Curator | Content quality | Book passages |
| Resonance | Semantic mirrors | Text analysis |

Run audit: `/audit all` or `/audit <house>`

---

## AUI Tools (43 Total)

The Agentic UI exposes 43 tools via `USE_TOOL()` syntax:

### Book Tools
`update_chapter`, `create_chapter`, `delete_chapter`, `render_book`, `list_chapters`, `get_chapter`, `get_workspace`, `save_to_chapter`

### Archive Tools
`search_archive`, `search_facebook`, `list_conversations`, `harvest_archive`

### Passage Tools
`add_passage`, `list_passages`, `mark_passage`

### Image Tools
`describe_image`, `search_images`, `classify_image`, `find_similar_images`, `cluster_images`, `add_image_passage`

### Persona/Style Tools
`list_personas`, `list_styles`, `apply_persona`, `apply_style`, `extract_persona`, `extract_style`, `discover_voices`, `create_persona`, `create_style`

### Transform Tools
`humanize`, `detect_ai`, `translate`, `analyze_text`, `quantum_read`

### Pyramid Tools
`build_pyramid`, `get_pyramid`, `search_pyramid`

### Draft Tools
`generate_first_draft`

### Agent Tools
`list_agents`, `get_agent_status`, `list_pending_proposals`, `request_agent`

### Workflow Tools
`discover_threads`, `start_book_workflow`

---

## CSS Compliance (MANDATORY)

### Theme Variables Required
```css
/* Colors */
color: var(--text-primary);
background: var(--bg-secondary);

/* Spacing */
padding: var(--space-md);
gap: var(--space-sm);

/* Borders */
border-radius: var(--radius-md);
```

### No Inline Styles
```jsx
// WRONG
<div style={{ padding: '16px', color: '#666' }}>

// CORRECT
<div className="my-component">
```

---

## Migration Status

### Phase 1: Foundation (Complete)
- [x] Create repo
- [x] Copy electron/, apps/, packages/
- [x] Copy agent definitions
- [ ] npm install
- [ ] Build verification

### Phase 2: Archive Server (Pending)
- [ ] Convert archive-server.js to TypeScript
- [ ] Embed in electron/archive-server/
- [ ] Migrate embeddings service
- [ ] Migrate Facebook parsers
- [ ] Remove localhost:3002 references

### Phase 3: Workers (Pending)
- [ ] Copy npe-api/
- [ ] Copy gptzero-api/
- [ ] Update wrangler configs

### Phase 4: Testing (Pending)
- [ ] Full integration test
- [ ] AUI tools verification
- [ ] House Council approval

---

## Key Differences from humanizer-app

1. **Self-contained**: No external archive-server.js dependency
2. **Clean slate**: No experimental/deprecated code
3. **Type unity**: All services use @humanizer/core types
4. **Single Electron**: No spawning external processes

---

## Commands

```bash
# Development
npm run electron:dev        # Start Electron + Vite dev

# Build
npm run build               # Build all packages
npm run build:electron      # Build Electron main process
npm run electron:build      # Full production build

# Packages
npm run dev --workspace=apps/web    # Just the web frontend
```

---

## Files to Read First

1. `docs/HANDOFF_DEC27_HUMANIZER_GM_PLAN.md` - Migration plan
2. `docs/AGENT.md` - House agent definitions
3. `electron/main.ts` - Electron main process
4. `electron/preload.ts` - IPC bridge (43 tools)
5. `apps/web/src/lib/aui/` - AUI implementation

---

**End of Guide**
