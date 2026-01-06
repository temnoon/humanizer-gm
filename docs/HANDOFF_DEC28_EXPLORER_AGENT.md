# HANDOFF: Explorer Agent - AUI Format Discovery

**Date**: December 28, 2025 (Session 4 continued)
**Branch**: `feature/subjective-intentional-constraint`
**Project**: humanizer-gm (Golden Master)
**Status**: Explorer Agent working, Instagram detection successful

---

## What Was Built This Session

### 1. Explorer Agent (House of Explorer)

New house agent for agentic format discovery:

**File**: `electron/agents/houses/explorer.ts`

```typescript
const ExplorerAgent = {
  id: 'explorer',
  name: 'The Explorer',
  house: 'explorer',
  capabilities: [
    'explore-structure',    // Recursive folder exploration
    'detect-format',        // Format hypothesis generation
    'probe-file',          // JSON/file structure probing
    'query-user',          // Interactive clarification
    'learn-format',        // Pattern learning
    'recommend-parser',    // Parser recommendation
  ],
};
```

### 2. Known Format Signatures

Pre-configured detection for:
- **instagram-export** - `your_instagram_activity/`, `messages/inbox`
- **facebook-export** - `messages/inbox/`, `posts/`
- **openai-export** - `conversations.json`, `mapping` key
- **gemini-export** - `source: "Gemini"`, `content.parts`
- **claude-export** - `conversations.json` + `users.json`

### 3. Discovery Session API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/import/discover` | POST | Start discovery session |
| `/api/import/discover/:id` | GET | Get session status |
| `/api/import/discover/:id/respond` | POST | User responds to query |
| `/api/import/discover/:id/confirm` | POST | Confirm format |
| `/api/import/explore` | POST | Quick structure explore |

### 4. Schema Fix

Fixed table name conflict:
- `media_items` (v7 Xanadu) vs Facebook media
- Renamed Facebook table to `facebook_media`

---

## Test Results

### Instagram Export Detection

```bash
curl -X POST http://localhost:3002/api/import/discover \
  -H 'Content-Type: application/json' \
  -d '{"path": "/Users/tem/Downloads/instagram-temnoon-2025-11-18-9eN6zwBj"}'
```

**Response**:
```json
{
  "sessionId": "discovery-1766964678039",
  "status": "awaiting-input",
  "hypotheses": [
    {"formatName": "instagram-export", "confidence": 0.486, "parser": "instagram"},
    {"formatName": "facebook-export", "confidence": 0.455, "parser": "facebook"},
    {"formatName": "openai-export", "confidence": 0.36, "parser": "openai"}
  ],
  "query": {
    "question": "What type of export is this?",
    "options": ["instagram-export", "facebook-export", "openai-export"]
  },
  "structure": {
    "name": "instagram-temnoon-2025-11-18-9eN6zwBj",
    "folderCount": 8,
    "topFolders": ["ads_information", "connections", "media", "personal_information"]
  }
}
```

**User Confirms**:
```bash
curl -X POST ".../respond" -d '{"response": "instagram-export"}'
```

**Result**:
```json
{
  "status": "confirmed",
  "result": {"formatName": "instagram-export", "parser": "instagram"}
}
```

---

## Files Created/Modified

| File | Status | Purpose |
|------|--------|---------|
| `electron/agents/houses/explorer.ts` | **Created** | Explorer Agent |
| `electron/agents/houses/index.ts` | Modified | Export Explorer |
| `electron/agents/runtime/types.ts` | Modified | Add 'explorer' HouseType |
| `electron/archive-server/routes/import.ts` | Modified | Explorer API routes |
| `electron/archive-server/services/facebook/MediaItemsDatabase.ts` | Modified | Rename table to facebook_media |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Explorer Agent                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. EXPLORE                    2. DETECT                         │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ Folder Structure │─────────▶│ Known Formats   │               │
│  │ - maxDepth: 3    │          │ - Instagram     │               │
│  │ - maxFiles: 100  │          │ - Facebook      │               │
│  │ - Patterns       │          │ - OpenAI        │               │
│  └─────────────────┘          │ - Gemini        │               │
│                                │ - Claude        │               │
│                                └────────┬────────┘               │
│                                         │                         │
│  3. PROBE                              ▼                         │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ JSON Structure   │◀─────────│ Hypotheses      │               │
│  │ - keys[]        │          │ - confidence    │               │
│  │ - sampleValues  │          │ - evidence      │               │
│  │ - arrayLength   │          │ - parser        │               │
│  └─────────────────┘          └────────┬────────┘               │
│                                         │                         │
│  4. QUERY                              ▼                         │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ User Response   │◀─────────│ Discovery       │               │
│  │ - "Yes"        │          │ Session         │               │
│  │ - Select option │          │ - queries[]     │               │
│  │ - Custom input  │          │ - samples[]     │               │
│  └────────┬────────┘          └────────┬────────┘               │
│           │                             │                         │
│           ▼                             ▼                         │
│  5. LEARN                      6. RESULT                         │
│  ┌─────────────────┐          ┌─────────────────┐               │
│  │ Pattern Storage  │          │ Confirmed       │               │
│  │ - learnedFormats│          │ - formatName    │               │
│  │ - signatures    │          │ - parser        │               │
│  └─────────────────┘          │ - config        │               │
│                                └─────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Next Steps

### 1. Create InstagramParser

Since Instagram uses the same Meta Messenger format as Facebook:
```typescript
// Could extend/wrap FacebookParser
class InstagramParser extends FacebookParser {
  // Override path patterns for Instagram structure
  protected getMessagePaths(): string[] {
    return [
      'your_instagram_activity/messages/inbox',
      'your_instagram_activity/messages/message_requests',
    ];
  }
}
```

### 2. Wire Explorer to Import UI

Add discovery mode to ImportView.tsx:
- Show hypothesis cards with confidence bars
- Let user select/confirm format
- Show structure preview

### 3. Learned Format Persistence

Currently in-memory. Add SQLite persistence:
```sql
CREATE TABLE learned_formats (
  id TEXT PRIMARY KEY,
  name TEXT,
  signatures TEXT,  -- JSON
  parser_name TEXT,
  learned_at REAL,
  success_count INTEGER
);
```

---

## Quick Commands

### Test Discovery
```bash
# Start discovery
curl -X POST http://localhost:3002/api/import/discover \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/unknown/export"}'

# Quick explore
curl -X POST http://localhost:3002/api/import/explore \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/folder", "maxDepth": 2}'
```

### Start Development
```bash
cd /Users/tem/humanizer_root/humanizer-gm
ARCHIVE_PATH=/Users/tem/humanizer_root/test-archive npm run electron:dev
```

---

## End of Handoff

**Status**: Explorer Agent working, Instagram detection successful
**Next**: Create InstagramParser, wire to UI
**Blockers**: None

