# Humanizer

**Electron desktop application for personal archive exploration, AI-assisted writing, and content humanization.**

> A unified, privacy-first tool that helps you explore your digital history (conversations, social media, documents), transform AI-generated content, and build meaningful narratives from your archives.

---

## Quick Start

```bash
# Prerequisites: Node.js 22+, Ollama (for LLM inference)
nvm use 22

# Install dependencies
npm install

# Start development server
npm run electron:dev

# Build for distribution (Mac arm64)
npm run electron:build
```

**Default Ports:**
| Service | Port | Purpose |
|---------|------|---------|
| Archive Server | 3002 | Local archive API, embeddings, search |
| NPE-Local | 3003 | AI detection, transformation, quantum analysis |
| Vite Dev | 5174 | React frontend (dev mode) |
| Ollama | 11434 | LLM inference (external) |

---

## Architecture Overview

```
humanizer-gm/
├── apps/                    # Application packages
│   ├── web/                 # React frontend (Vite)
│   │   ├── src/
│   │   │   ├── components/  # UI components
│   │   │   │   ├── archive/ # Archive views (Facebook, Gallery, Books, etc.)
│   │   │   │   ├── layout/  # Layout system (SplitScreen, Toolbar)
│   │   │   │   ├── workspace/ # Content rendering
│   │   │   │   ├── aui/     # Agentic UI chat
│   │   │   │   ├── queue/   # Job queue management
│   │   │   │   └── tools/   # Tool panels
│   │   │   ├── lib/         # Core libraries
│   │   │   │   ├── aui/     # AUI context and tools
│   │   │   │   ├── auth/    # OAuth authentication
│   │   │   │   ├── bookshelf/ # Book management
│   │   │   │   ├── buffer/  # Content buffer system
│   │   │   │   ├── theme/   # Theme management
│   │   │   │   └── transform/ # AI detection/humanization
│   │   │   ├── styles/      # CSS modules
│   │   │   ├── Studio.tsx   # Main workspace component
│   │   │   └── App.tsx      # Application root
│   │   └── index.html
│   └── cli/                 # Command-line tools
│
├── electron/                # Electron main process
│   ├── main.ts              # Window management, IPC, server startup
│   ├── preload.ts           # IPC bridge (43 AUI tools exposed)
│   ├── archive-server/      # Embedded archive server
│   │   ├── routes/          # API routes
│   │   │   ├── facebook.ts  # Facebook data API (55 routes)
│   │   │   ├── archives.ts  # Archive management
│   │   │   └── content.ts   # Content operations
│   │   └── services/        # Core services
│   │       ├── embeddings/  # Vector embeddings, clustering
│   │       ├── facebook/    # Facebook data parsers
│   │       ├── parser/      # General archive parsers
│   │       ├── import/      # Import pipeline
│   │       └── vision/      # Image indexing
│   ├── npe-local/           # Local AI services
│   │   ├── services/
│   │   │   ├── detection/   # AI detection algorithms
│   │   │   ├── transformation/ # Content humanization
│   │   │   ├── quantum/     # Quantum analysis
│   │   │   └── llm/         # LLM provider adapters
│   │   └── routes/          # NPE API routes
│   ├── agents/              # Agent Council system
│   │   ├── council/         # Orchestrator, coordination
│   │   ├── houses/          # House agents (8 specialists)
│   │   ├── runtime/         # Agent execution
│   │   ├── bus/             # Event bus
│   │   └── tasks/           # Task handlers
│   ├── ai-control/          # AI safety and routing
│   ├── chat/                # Chat integration
│   ├── vision/              # Vision model providers
│   ├── queue/               # Background job queue
│   └── whisper/             # Speech-to-text (planned)
│
├── packages/                # Shared packages
│   ├── core/                # @humanizer/core - shared types
│   ├── ui/                  # @humanizer/ui - shared styles
│   ├── archive/             # @humanizer/archive - parsers
│   ├── book/                # @humanizer/book - book building
│   ├── curator/             # @humanizer/curator - curation
│   └── transform/           # @humanizer/transform - transforms
│
├── docs/                    # Documentation and handoffs
├── scripts/                 # Build and maintenance scripts
└── build-resources/         # Electron builder assets
```

---

## Key Features

### Archive Exploration
- **Facebook Archive** - Posts, comments, photos, videos, notes, groups, messenger (28K+ messages), advertiser data
- **Conversation Archives** - ChatGPT, Claude, and other AI conversation exports
- **Gallery View** - Visual browsing with thumbnails, clustering, lightbox
- **Semantic Search** - Vector-based search across 72K+ indexed embeddings
- **Social Graph** - Relationship visualization and network analysis

### Content Transformation
- **AI Detection** - Statistical analysis to identify AI-generated content
- **Humanization** - Transform AI text to sound more natural (via Ollama)
- **Quantum Analysis** - Session-based sentence analysis framework

### Book Building
- **Chapter Organization** - Structure content into book format
- **Passage Curation** - Mark and collect meaningful passages
- **Export Formats** - Multiple output options

### Agentic UI (AUI)
- **43 Tools** - Exposed via `USE_TOOL()` syntax for agent interactions
- **House Council** - 8 specialized agents for code review and quality

---

## House Agent Council

Eight specialized agents guard code quality:

| House | Domain | Purpose |
|-------|--------|---------|
| **Architect** | Patterns & structure | Prevents parallel implementations, enforces design |
| **Stylist** | CSS & themes | Ensures theme compliance, design system integrity |
| **Security** | Auth & privacy | Guards against XSS, injection, credential leaks |
| **Data** | Schemas & types | Maintains backward compatibility, data integrity |
| **Math** | Algorithms | Guards numerical stability, theoretical integrity |
| **Accessibility** | WCAG & ARIA | Ensures keyboard nav, touch targets, screen readers |
| **Curator** | Content quality | Editorial standards, author voice preservation |
| **Resonance** | Semantic mirrors | Finds connections between texts |

---

## Technology Stack

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- CSS Modules with theme variables

**Backend (Embedded):**
- Express.js servers
- SQLite + sqlite-vec (vector search)
- better-sqlite3 (database)
- chromadb-default-embed (embeddings)

**Desktop:**
- Electron 33
- electron-builder (packaging)
- electron-store (preferences)

**AI Integration:**
- Ollama (local LLM inference)
- Vision providers (Anthropic, OpenAI, Cloudflare)
- Whisper (speech-to-text, planned)

---

## Development

### Scripts

```bash
# Development
npm run electron:dev        # Start Electron + Vite dev server

# Building
npm run build               # Build all packages
npm run build:electron      # Build Electron main process only
npm run electron:build      # Full production build (DMG)

# Quality
npm run style:check         # Check CSS compliance
npm run lint                # Run linter
npm run test                # Run tests

# Individual packages
npm run dev --workspace=apps/web
```

### CSS Requirements

All styles must use theme variables. **Never hardcode colors.**

```css
/* Correct */
color: var(--studio-text);
background: var(--studio-bg-secondary);
border-color: var(--studio-border);

/* Wrong */
color: white;
background: #1a1a1a;
```

### State Management

```typescript
// Layout and split modes
useSplitMode()      // { mode, setMode }
useHighlights()     // { activeHighlights, analysisData }

// Content buffers
useBuffers()        // { content, importText, activeBuffer }

// Authentication
useAuth()           // { user, isAuthenticated, loginWithOAuth }

// Book management
useBookshelf()      // { books, chapters, passages }

// AUI tools
useAUI()            // { sendMessage, tools, isProcessing }
```

---

## Data Architecture

### Database Schema (v16)

The archive server uses SQLite with vector extensions:

- **conversations** - Parsed conversation archives
- **messages** - Individual messages with embeddings
- **facebook_posts** - Facebook feed posts
- **facebook_comments** - Post comments
- **facebook_media** - Photos, videos, albums
- **facebook_notes** - Notes archive
- **facebook_groups** - Group memberships and posts
- **facebook_messenger** - Messenger threads and messages
- **facebook_advertisers** - Advertiser interaction data
- **friends** - Friend relationships
- **clusters** - Embedding clusters
- **embeddings** - Vector embeddings (72K+)

### API Endpoints

**Archive Server (3002):**
- `GET /api/health` - Health check
- `GET /api/archives` - List archives
- `GET /api/search` - Semantic search
- `GET /api/facebook/*` - Facebook data endpoints (55 routes)

**NPE-Local (3003):**
- `GET /health` - Health check
- `POST /api/detect` - AI detection
- `POST /api/humanize` - Content humanization
- `POST /api/quantum/*` - Quantum analysis

---

## Current Status

**Version:** 1.0.0
**Platform:** macOS (arm64)
**Build Size:** ~165MB DMG

### Working Features
- Archive browsing (conversations, Facebook data)
- Semantic search with 72K+ vectors indexed
- AI detection (local statistical)
- Humanization via Ollama
- Split view modes (View/Analyze/Transform/Compare)
- Facebook: Feed, Gallery, Notes, Groups, Messenger, Advertisers, Graph
- WCAG 2.1 AA accessibility compliance

### Data Indexed
| Data Type | Count |
|-----------|-------|
| Facebook Posts | 5,200+ |
| Facebook Comments | 828 |
| Facebook Notes | 128 |
| Facebook Groups | 433 |
| Messenger Threads | 1,715 |
| Messenger Messages | 28,317 |
| Advertisers | 2,449 |
| Vector Embeddings | 72,000+ |

---

## Documentation

Key documentation in `docs/`:

| File | Purpose |
|------|---------|
| `AGENT.md` | House agent definitions |
| `HANDOFF_*.md` | Session handoff documents |
| `AUI-TOOLS.md` | Complete AUI tool reference |
| `PHILOSOPHY_STATE_DEC25.md` | Design philosophy |

---

## Contributing

1. Read `CLAUDE.md` for development guidelines
2. Run House Council audit before submitting changes
3. Ensure CSS compliance (no hardcoded colors)
4. Follow implementation-first protocol (check existing code before adding new)
5. Maintain WCAG 2.1 AA accessibility

---

## License

Private - All rights reserved

---

**Last Updated:** January 13, 2026
