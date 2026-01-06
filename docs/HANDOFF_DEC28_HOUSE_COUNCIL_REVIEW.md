# HANDOFF: House Council Review - Universal Import Pipeline

**Date**: December 28, 2025 (Session 4)
**Branch**: `feature/subjective-intentional-constraint`
**Project**: humanizer-gm (Golden Master)
**Status**: Council review complete, architecture validated

---

## House Council Audit Results

### Architect Agent: Parser Architecture

**Concern Raised**: Parallel implementation detected
- `services/parser/` - OLD parsers (OpenAI, Claude, Facebook, etc.)
- `services/import/parsers/` - NEW parsers (OpenAI, Gemini, Document)

**Verdict**: **EVOLUTION, NOT DUPLICATION**

| Aspect | Old Pattern | New Pattern |
|--------|-------------|-------------|
| Output | `Conversation[]` | `ContentUnit[]` + `MediaRef[]` + `ContentLink[]` |
| Storage | EmbeddingDatabase (direct) | Xanadu pipeline (links table) |
| Media | MediaMatcher/Indexer | ContentAddressableStore (SHA-256) |
| Links | None | Bidirectional (parent/follows/responds_to) |

**Recommendation**: Document transition path. The old parsers remain for existing archive functionality while new parsers build toward Xanadu architecture.

---

### Data Agent: Schema Integrity

Schema v7 includes:
- `links` - Xanadu bidirectional links
- `media_items` - Content-addressable storage
- `media_references` - Links content to media
- `import_jobs` - Enhanced import tracking

**Status**: Tables properly added to `createTables()`. No FK constraint issues detected.

---

### Security Agent: Import Routes Review

| Check | Status | Notes |
|-------|--------|-------|
| Magic byte validation | ✅ | Proper signatures for ZIP, PDF, images |
| JSON parsing | ✅ | Try-catch wrapping |
| Path existence check | ✅ | Uses `existsSync` |
| File size limits | ⚠️ | Consider adding ZIP bomb protection |
| Path traversal | ⚠️ | Route-level validation recommended |

**Recommendations**:
1. Add max file size validation in import routes
2. Validate paths start with allowed base directory
3. Consider ZIP extraction size limits

---

## Instagram Export Discovery

**Format**: Instagram uses same Meta Messenger format as Facebook!

### Path Structure
```
instagram-export/
└── your_instagram_activity/
    └── messages/
        ├── inbox/           # Regular conversations
        └── message_requests/ # Message requests
            └── <username>_<id>/
                └── message_1.json
```

### JSON Format (identical to Facebook)
```json
{
  "participants": [{ "name": "..." }],
  "messages": [
    {
      "sender_name": "...",
      "timestamp_ms": 1636594640941,
      "content": "...",
      "share": { "link": "...", "share_text": "..." }
    }
  ],
  "title": "...",
  "is_still_participant": true,
  "thread_path": "message_requests/meira_756683582393427"
}
```

**Conclusion**: Can extend FacebookParser or create thin InstagramParser wrapper.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    humanizer-gm/electron/archive-server         │
├─────────────────────────────────────────────────────────────────┤
│  services/                                                       │
│  ├── parser/          [OLD] → Conversation[] output              │
│  │   ├── OpenAIParser.ts                                        │
│  │   ├── ClaudeParser.ts                                        │
│  │   ├── FacebookParser.ts                                      │
│  │   └── ...                                                    │
│  │                                                               │
│  ├── import/          [NEW] → ContentUnit[] + Links output       │
│  │   ├── ImportPipeline.ts     # Orchestrator                   │
│  │   ├── parsers/                                               │
│  │   │   ├── OpenAIParser.ts   # Xanadu-ready                   │
│  │   │   ├── GeminiParser.ts   # NEW                            │
│  │   │   └── DocumentParser.ts # txt/md/docx/pdf                │
│  │   ├── detection/                                             │
│  │   │   └── FileTypeDetector.ts                                │
│  │   └── media/                                                 │
│  │       └── ContentAddressableStore.ts                         │
│  │                                                               │
│  └── embeddings/                                                 │
│      ├── EmbeddingDatabase.ts  # v7 with links/media tables     │
│      └── types.ts              # Extended ImportSourceType       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files Reviewed This Session

| File | Purpose | Status |
|------|---------|--------|
| `services/parser/index.ts` | Old parser exports | Reviewed |
| `services/parser/OpenAIParser.ts` | Old OpenAI parser | Reviewed |
| `services/parser/FacebookParser.ts` | Facebook parser | Reviewed |
| `services/import/ImportPipeline.ts` | New pipeline orchestrator | Reviewed |
| `services/import/parsers/OpenAIParser.ts` | New OpenAI parser | Reviewed |
| `services/import/parsers/GeminiParser.ts` | New Gemini parser | Reviewed |
| `services/import/detection/FileTypeDetector.ts` | File type detection | Reviewed |

---

## Next Session: AUI Format Discovery

### Goal
Build an Agent UI system that can discover unfamiliar file formats through:
1. User querying about file origins
2. Probing assumptions about structure
3. Recursion/nesting detection
4. Pattern learning and storage

### Test Case
Instagram export: `/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj`

Since Instagram uses Meta format, this is a good validation:
- AUI should DISCOVER the similarity to Facebook
- AUI should ASK user if this is an Instagram export
- AUI should PROPOSE extending Facebook parser

### Implementation Approach

```typescript
interface FormatDiscoveryAgent {
  // Initial exploration
  exploreStructure(path: string): Promise<StructureInsight>;

  // Interactive discovery
  queryUser(question: string, options?: string[]): Promise<string>;

  // Hypothesis testing
  probeFile(path: string, hypothesis: Hypothesis): Promise<ProbeResult>;

  // Learning
  saveFormatInsight(insight: FormatInsight): Promise<void>;
}
```

---

## Quick Commands

### Start Development
```bash
cd /Users/tem/humanizer_root/humanizer-gm
ARCHIVE_PATH=/Users/tem/humanizer_root/test-archive npm run electron:dev
```

### Test Import API
```bash
# Test Instagram folder (should work once parser extended)
curl -X POST http://localhost:3002/api/import/file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj"}'
```

---

## End of Handoff

**Status**: Architecture validated, Instagram format discovered
**Next**: AUI format discovery agent + Instagram parser
**Blockers**: None

