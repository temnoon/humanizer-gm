# HANDOFF: Universal Import Pipeline - Complete

**Date**: December 28, 2025 (Session 3)
**Branch**: `feature/subjective-intentional-constraint`
**Project**: humanizer-gm (Golden Master)
**Status**: Multi-format import working, ready for AUI exploration

---

## What Was Built This Session

### 1. Schema v7 Fix

Fixed `createTables()` to include v7 tables that were only in migration code:
- `links` - Xanadu bidirectional links
- `media_items` - Content-addressable storage
- `media_references` - Links content to media
- `import_jobs` - Enhanced import tracking
- `vec_media_items` - Vector table for media embeddings

### 2. GeminiParser

New parser for Google Gemini conversation exports:

```typescript
const parser = createGeminiParser({ verbose: true });
if (await parser.canParse('/path/to/conversation.json')) {
  const result = await parser.parse('/path/to/conversation.json', 'gemini');
}
```

**Gemini Format Detected**:
```json
{
  "title": "...",
  "source": "Gemini",
  "messages": [
    {
      "id": "msg_0",
      "role": "user" | "model",
      "content": { "parts": [{ "text": "..." }] },
      "timestamp": 1766274482277
    }
  ]
}
```

### 3. Legacy Frontend Routes

Added routes that match what the existing ImportView.tsx expects:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/import/archive/upload` | POST | Upload with 'archive' field |
| `/api/import/archive/parse` | POST | Start parsing job |
| `/api/import/archive/status/:id` | GET | Poll progress |
| `/api/import/archive/apply/:id` | POST | Apply import |
| `/api/import/archive/folder` | POST | Import from folder |

### 4. Enhanced FileTypeDetector

Updated to detect conversation formats in JSON files:
- `isGeminiConversation()` - Checks for `source: "Gemini"` or `content.parts` structure
- `isOpenAISingleConversation()` - Checks for `mapping` object
- `isGenericConversation()` - Fallback for array-of-messages

---

## Test Results

### OpenAI ZIP Export (500MB)
```
[OpenAIParser] Loaded 1722 conversations
[OpenAIParser] Found 386 media files
[OpenAIParser] Parsed 41935 units, 188 media refs, 78706 links
```

### Gemini JSON Conversation
```
[GeminiParser] Processing conversation: "Phenomenological Iconography: Sacred Languages" with 14 messages
[GeminiParser] Parsed 15 units, 0 media refs, 27 links
```

### Database State
| Metric | Count |
|--------|-------|
| Total Links | 78,733 |
| Import Jobs Completed | 3 |
| Content Sources | OpenAI, Gemini |

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `services/import/parsers/GeminiParser.ts` | **Created** | Gemini conversation parser |
| `services/import/parsers/index.ts` | Modified | Export GeminiParser |
| `services/import/index.ts` | Modified | Export GeminiParser |
| `services/import/detection/FileTypeDetector.ts` | Modified | Detect Gemini/conversation formats |
| `services/embeddings/types.ts` | Modified | Added 'gemini', 'conversation', 'folder' |
| `services/embeddings/EmbeddingDatabase.ts` | Modified | v7 tables in createTables() |
| `routes/import.ts` | Modified | Legacy routes + GeminiParser registration |

---

## Architecture Summary

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   File/Folder   │────▶│ FileDetector │────▶│  ImportPipeline │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
        ┌─────────────────────────────────────────────┼─────────────────┐
        │                                             │                 │
        ▼                                             ▼                 ▼
┌───────────────┐                             ┌──────────────┐  ┌──────────────┐
│ OpenAIParser  │                             │ GeminiParser │  │DocumentParser│
│  (ZIP/JSON)   │                             │   (JSON)     │  │  (txt/md)    │
└───────┬───────┘                             └──────┬───────┘  └──────┬───────┘
        │                                             │                 │
        └──────────────────┬──────────────────────────┴─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ ContentUnit[]│
                    │ MediaRef[]   │
                    │ ContentLink[]│
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌──────────────┐  ┌──────────────┐
│   Database    │  │ ContentAddr  │  │  Xanadu      │
│  (SQLite)     │  │ MediaStore   │  │  Links       │
└───────────────┘  └──────────────┘  └──────────────┘
```

---

## NEXT SESSION: AUI-Driven Format Discovery

### Goal
Build an AUI (Agent UI) system integrated into Electron that can **agentically discover** unfamiliar file formats through:

1. **User Querying** - Ask about file origins, context, export source
2. **Probing** - Test assumptions about structure, handle errors gracefully
3. **Recursion Detection** - Find nested structures, embedded JSON, multi-level hierarchies
4. **Learning** - Save insights about format patterns for future imports

### Test Case: Instagram Export
```
/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj
```

May be similar to Facebook, but might have differences.

### Approach

1. **AUI Interface**
   - Chat-like interface in the import view
   - Agent asks clarifying questions when format is unknown
   - Shows probing progress and discoveries

2. **Format Discovery Agent**
   ```typescript
   interface FormatDiscoveryAgent {
     // Initial exploration
     exploreStructure(path: string): Promise<StructureInsight>;

     // Ask user about unknown patterns
     queryUser(question: string, options?: string[]): Promise<string>;

     // Probe specific files
     probeFile(path: string, hypothesis: Hypothesis): Promise<ProbeResult>;

     // Save learned patterns
     saveFormatInsight(insight: FormatInsight): Promise<void>;
   }
   ```

3. **Insight Storage**
   - Store discovered patterns in ChromaDB or SQLite
   - Build a library of format signatures
   - Reference when encountering similar structures

### Expected Instagram Structure (to discover)
```
instagram-temnoon-2025-11-18-9eN6zwBj/
├── messages/          # DMs, similar to Facebook?
├── media/             # Photos, videos
├── posts_1.json       # Feed posts?
├── stories.json       # Stories?
├── profile.json       # Account info
└── ...
```

### Agent Conversation Example
```
Agent: I found a folder with these files: [list].
       This looks like an Instagram export. Is that correct?
User: Yes, from the data download feature.
Agent: I see a `messages/` folder. Exploring structure...
       Found 47 conversation folders. Each has `message_1.json`.
       The message format uses `sender_name` and `timestamp_ms`.
       Similar to Facebook but with different field names.
       Should I create an InstagramParser based on this discovery?
User: Yes, go ahead.
Agent: [Creates parser, tests with sample, reports results]
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
# Gemini conversation
curl -X POST http://localhost:3002/api/import/file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/path/to/conversation.json"}'

# Instagram folder (to be discovered)
curl -X POST http://localhost:3002/api/import/file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj"}'
```

---

## End of Handoff

**Status**: Multi-format import working (OpenAI, Gemini, txt/md)
**Next**: AUI agent for format discovery with Instagram export test
**Blockers**: None
