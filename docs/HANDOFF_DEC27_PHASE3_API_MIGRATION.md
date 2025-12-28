# Humanizer GM - Phase 3: API Migration Plan

**Date**: December 27, 2025
**Status**: PLANNING - Ready for Execution
**Previous Phase**: Phase 2 Complete (embedded archive server)

---

## Executive Summary

Phase 3 involves migrating the `npe-api` Cloudflare Worker into the Humanizer GM architecture. This is a **significant undertaking** - the npe-api contains ~37,000 lines of TypeScript across 36 routes and 60+ services.

**Key Decision Required**: The npe-api can either be:
1. **Option A**: Embedded in Electron (like archive-server) - Full offline capability
2. **Option B**: Kept as separate Cloudflare Worker - Cloud-first, simpler migration
3. **Option C**: Hybrid - Core routes embedded, cloud routes stay on Cloudflare

---

## Current State

### What's Done (Phase 1 & 2)
- ✅ humanizer-gm repo created: https://github.com/temnoon/humanizer-gm
- ✅ Foundation migrated (apps/, packages/, electron/)
- ✅ Archive server embedded in Electron (`electron/archive-server/`)
- ✅ 43 AUI tools working
- ✅ Agent Council IPC wiring complete

### Current API Dependencies

```
humanizer-app frontend
├── Archive Server (localhost:3002)  ← Now EMBEDDED in Electron ✅
├── NPE-API (localhost:8787 or cloud) ← NEEDS MIGRATION
├── GPTZero API (Cloudflare Worker)   ← NEEDS MIGRATION
└── Ollama (localhost:11434)          ← External, stays as-is
```

---

## NPE-API Analysis

### Scale
| Component | Count | Lines |
|-----------|-------|-------|
| Routes | 36 | ~15,000 |
| Services | 60+ | ~21,000 |
| Migrations | 29 | ~2,700 |
| **Total** | ~140 files | **~37,000** |

### Route Categories

#### 1. Authentication & Security
```
routes/auth.ts           - Login, register, password reset
routes/oauth.ts          - Google, GitHub, Discord, Facebook, Apple
routes/webauthn.ts       - Passwordless authentication
```

#### 2. Text Transformations (CRITICAL - Most Used)
```
routes/transformations.ts        - Main router
routes/persona-transformation.ts - Voice/persona shifting
routes/style-transformation.ts   - Formality, complexity
services/computer-humanizer.ts   - AI text humanization
services/humanization/           - 5 sub-services
```

#### 3. AI Detection
```
routes/ai-detection.ts           - Main detection endpoint
routes/sic.ts                    - Subjective Intentional Constraint
services/ai-detection/           - 5 files
services/detection/              - 5 files (V2 composite scoring)
```

#### 4. User Personalization
```
routes/personal-personas.ts      - User's own personas
routes/personal-styles.ts        - User's own writing styles
routes/writing-samples.ts        - Upload text samples
routes/profile-factory.ts        - Paid persona/style extraction
```

#### 5. Content & Books
```
routes/books.ts                  - Book CRUD
routes/narratives.ts             - Story management
routes/gutenberg.ts              - Project Gutenberg search
routes/story-generation.ts       - LLM story generation
```

#### 6. Quantum Analysis & Research
```
routes/quantum-analysis.ts       - Quantum reading via POVMs
routes/analysis.ts               - V1 evaluation
routes/v2/rho.ts                - ρ-centric analysis
routes/v2/attributes.ts         - Attribute extraction
```

#### 7. Infrastructure
```
routes/sessions.ts               - Workspace persistence
routes/chat.ts                   - LLM chat (ChatPane)
routes/stripe.ts                 - Billing
routes/admin.ts                  - System admin
```

### Database Schema (21 Tables)

**Core Tables**:
- `users`, `webauthn_credentials`, `user_roles_quotas`, `oauth_accounts`

**Personalization**:
- `personalizer_writing_samples`, `personalizer_personas`, `personalizer_styles`

**Detection & Analysis**:
- `ai_detection_results`, `humanizer_detection_results`, `quantum_analysis_sessions`

**Content**:
- `bookmaking_projects`, `bookmaking_chapters`, `bookmaking_sections`

**Infrastructure**:
- `api_keys`, `model_preferences`, `studio_sessions`, `model_registry`

### External Dependencies

| Dependency | Purpose | Required? |
|------------|---------|-----------|
| OpenAI API | GPT-4 transformations | Yes |
| Anthropic API | Claude transformations | Yes |
| Google AI | Gemini models | Optional |
| Groq | Fast inference | Optional |
| GPTZero | AI detection | Yes (for detection) |
| Stripe | Billing | Production only |
| 5 OAuth providers | Social login | Production only |

---

## Migration Options

### Option A: Full Electron Embedding

**Pros**:
- Complete offline capability
- Single codebase
- No cloud costs
- Privacy-first

**Cons**:
- Massive migration effort (~37k lines)
- Database needs SQLite conversion (currently D1/PostgreSQL)
- No shared authentication across devices
- No billing/quotas without cloud

**Scope**: 3-4 weeks of focused work

### Option B: Keep Cloudflare Worker

**Pros**:
- Zero migration needed for API
- Existing infrastructure works
- Shared auth/data across devices
- Billing/quotas already implemented

**Cons**:
- Requires internet connection
- Ongoing Cloudflare costs
- Two codebases to maintain
- Data on cloud (privacy concern)

**Scope**: 0 weeks (just point frontend to existing API)

### Option C: Hybrid Approach (RECOMMENDED)

**What Goes in Electron**:
- Core transformations (persona, style, humanize)
- AI detection (local first, cloud fallback)
- Content operations (books, narratives)
- Session/workspace management

**What Stays on Cloudflare**:
- Authentication (OAuth, WebAuthn)
- Billing/quotas
- Cross-device sync
- GPTZero integration (rate-limited)

**Pros**:
- Best of both worlds
- Offline-capable for core features
- Cloud for auth/billing
- Manageable scope

**Scope**: 1-2 weeks

---

## Recommended Phase 3 Implementation

### Phase 3A: Critical Transformations (Week 1)

Create `electron/npe-local/` with:

```
electron/npe-local/
├── index.ts              # Module exports
├── server.ts             # Express server (like archive-server)
├── routes/
│   ├── transformations.ts   # Persona, style, humanize
│   ├── ai-detection.ts      # Local detection
│   └── sic.ts               # SIC analysis
├── services/
│   ├── llm/                 # LLM provider abstraction
│   │   ├── index.ts
│   │   ├── ollama.ts        # Primary for local
│   │   ├── anthropic.ts     # Cloud fallback
│   │   └── openai.ts        # Cloud fallback
│   ├── transformation/
│   │   ├── persona.ts
│   │   ├── style.ts
│   │   └── humanizer.ts
│   └── detection/
│       ├── local-detector.ts
│       ├── tell-words.ts
│       └── composite-scorer.ts
└── lib/
    ├── text-processing.ts
    └── markdown-preserver.ts
```

**Endpoints to implement**:
```
POST /transformations/persona
POST /transformations/style
POST /transformations/computer-humanizer
POST /ai-detection/detect
POST /sic/analyze
```

### Phase 3B: Content & Sessions (Week 2)

Add to `electron/npe-local/`:

```
routes/
├── books.ts              # Book CRUD
├── sessions.ts           # Workspace persistence
├── chat.ts              # LLM chat
└── quantum.ts           # Quantum analysis

services/
├── books/
│   ├── project-service.ts
│   └── chapter-service.ts
├── sessions/
│   └── workspace-storage.ts
└── quantum/
    ├── density-matrix.ts
    └── povm-measurement.ts
```

### Phase 3C: Cloud Integration (Optional)

For features requiring cloud:

```typescript
// electron/npe-local/cloud-bridge.ts

const CLOUD_API = 'https://npe-api.tem-527.workers.dev';

export async function cloudAuth(action: string, data: any) {
  return fetch(`${CLOUD_API}/auth/${action}`, { ... });
}

export async function gptzeroDetect(text: string) {
  return fetch(`${CLOUD_API}/ai-detection/gptzero`, { ... });
}
```

---

## Files to Migrate (Priority Order)

### Tier 1: Essential (Week 1)
```
From: workers/npe-api/src/

routes/transformations.ts
routes/ai-detection.ts
routes/sic.ts

services/computer-humanizer.ts
services/humanization/           (5 files)
services/ai-detection/           (5 files)
services/detection/              (5 files)
services/sic/                    (5 files)

lib/text-processing.ts
lib/markdown-preserver.ts
lib/constraint-guidance.ts
```

### Tier 2: Content (Week 2)
```
routes/books.ts
routes/sessions.ts
routes/chat.ts
routes/quantum-analysis.ts

services/quantum-reading/        (4 files)
services/povm-verification/      (5 files)
```

### Tier 3: Personalization (Week 3)
```
routes/personal-personas.ts
routes/personal-styles.ts
routes/writing-samples.ts
routes/profile-factory.ts

services/persona-transformation.ts
services/style-transformation.ts
services/style-extraction.ts
services/persona-extraction.ts
services/voice-discovery.ts
```

---

## Database Strategy

### Current: Cloudflare D1 (PostgreSQL-like)

```sql
-- Example: users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Local: SQLite (better-sqlite3)

The archive-server already uses SQLite. We can:
1. **Reuse existing database** - Add tables to archive-server's SQLite
2. **Separate database** - `~/.humanizer/npe-local.db`
3. **Hybrid** - Local cache + cloud sync

**Recommendation**: Add to existing `~/.humanizer/humanizer.db`

### Migration Script Needed

```typescript
// electron/npe-local/database/setup.ts

import Database from 'better-sqlite3';

const db = new Database(path.join(humanizerDir, 'humanizer.db'));

// Create tables from migrations
const migrations = [
  'CREATE TABLE IF NOT EXISTS transformations (...)',
  'CREATE TABLE IF NOT EXISTS personas (...)',
  'CREATE TABLE IF NOT EXISTS styles (...)',
  // etc.
];

migrations.forEach(sql => db.exec(sql));
```

---

## Frontend Integration Changes

### Current State
```typescript
// apps/web/src/lib/transform/service.ts
const API_BASE = import.meta.env.VITE_NPE_API_URL || 'http://localhost:8787';
```

### After Migration
```typescript
// Use local server in Electron, cloud in browser
const API_BASE = window.electronAPI
  ? 'http://localhost:3003'  // Local npe-local server
  : 'https://npe-api.tem-527.workers.dev';
```

### Files Requiring Updates
```
apps/web/src/lib/transform/service.ts
apps/web/src/lib/auth/api.ts
apps/web/src/lib/profile/ProfileExtractionService.ts
apps/web/src/lib/pyramid/PyramidBuildingService.ts
apps/web/src/lib/aui/tools.ts
apps/web/src/lib/filesystem/summarization.ts
electron/ai-control/router.ts
```

---

## Testing Strategy

### Phase 3A Tests
```bash
# Start embedded servers
npm run electron:dev

# Test transformation
curl -X POST http://localhost:3003/transformations/persona \
  -H "Content-Type: application/json" \
  -d '{"text": "Test", "personaId": "casual"}'

# Test detection
curl -X POST http://localhost:3003/ai-detection/detect \
  -d '{"text": "The synergistic paradigm shift..."}'
```

### Integration Tests
```typescript
// Test AUI tool execution
USE_TOOL(humanize, { text: "AI-generated text", intensity: 0.7 })
USE_TOOL(detect_ai, { text: "Suspicious content" })
```

---

## Dependencies to Add

```json
// package.json additions
{
  "dependencies": {
    "natural": "^8.1.0",              // NLP
    "sentence-splitter": "^5.0.0",    // Text chunking
    "wink-tokenizer": "^5.3.0",       // Tokenization
    "fastest-levenshtein": "^1.0.16", // String diff
    "mathjs": "^15.0.0"               // Matrix operations (quantum)
  }
}
```

---

## Commands to Start Next Session

```bash
# 1. Navigate to GM repo
cd /Users/tem/humanizer_root/humanizer-gm

# 2. Read this handoff
cat docs/HANDOFF_DEC27_PHASE3_API_MIGRATION.md

# 3. Verify current state
npm run build:electron  # Should succeed

# 4. Explore npe-api source
ls -la ../workers/npe-api/src/
cat ../workers/npe-api/src/routes/transformations.ts

# 5. Begin Phase 3A: Create electron/npe-local/
mkdir -p electron/npe-local/{routes,services,lib}
```

---

## Success Criteria

### Phase 3A Complete When:
- [ ] `electron/npe-local/` exists with modular structure
- [ ] Core transformation routes work locally
- [ ] AI detection runs without cloud
- [ ] Ollama integration for local LLM
- [ ] `npm run build:electron` passes

### Phase 3B Complete When:
- [ ] Book/chapter operations work locally
- [ ] Session persistence in SQLite
- [ ] Chat endpoint works with Ollama
- [ ] Quantum analysis functional

### Phase 3C Complete When:
- [ ] Cloud fallback for auth/billing
- [ ] GPTZero integration via cloud bridge
- [ ] Cross-device sync optional

---

## GPTZero API (Separate Worker)

The `gptzero-api` worker is a thin wrapper:
- Proxies to GPTZero's API
- Tracks per-user quota
- Returns detection results

**Strategy**: Keep on Cloudflare, access via cloud-bridge.

---

## ChromaDB Memory IDs

| ID | Tags |
|----|------|
| `60a5b84c...` | humanizer-gm,phase2,archive-server,dec27 |
| `681c354d...` | humanizer-gm,phase1,golden-master,dec27 |

---

## Estimated Timeline

| Phase | Duration | Scope |
|-------|----------|-------|
| 3A | 3-4 sessions | Core transformations |
| 3B | 2-3 sessions | Content & sessions |
| 3C | 1-2 sessions | Cloud integration |
| Testing | 1-2 sessions | Integration verification |
| **Total** | **7-11 sessions** | Full API migration |

---

**End of Handoff**
