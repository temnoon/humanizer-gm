# New Machine Import Guide

**Date**: December 30, 2025
**App Version**: Humanizer Desktop (Electron)
**Target Platform**: macOS arm64

---

## Overview

This guide documents how to set up Humanizer on a fresh machine and import all your personal data (ChatGPT conversations, Facebook posts/comments/media).

---

## Prerequisites

### 1. System Requirements

| Requirement | Specification |
|-------------|---------------|
| macOS | 13.0+ (Ventura or newer) |
| Architecture | Apple Silicon (arm64) |
| RAM | 8GB minimum, 16GB recommended |
| Storage | 1GB for app + space for archives |

### 2. Required Software

| Software | Purpose | Install Command |
|----------|---------|-----------------|
| Node.js 22 | Runtime | `nvm install 22 && nvm use 22` |
| Ollama | Local LLM inference | [Download](https://ollama.ai) |
| nomic-embed-text | Embedding model | `ollama pull nomic-embed-text` |
| qwen3-vl:8b | Vision model (optional) | `ollama pull qwen3-vl:8b` |

### 3. Verify Ollama

```bash
# Start Ollama (run in background)
ollama serve &

# Verify models are available
curl http://localhost:11434/api/tags | jq '.models[].name'
```

---

## Installation

### Option A: Production Build

```bash
# Download DMG from releases
open Humanizer-1.0.0-arm64.dmg

# Drag to Applications
# Open Humanizer.app
```

### Option B: Development Build

```bash
cd /path/to/humanizer-gm
nvm use 22
npm install
npm run electron:dev
```

---

## Data Exports You Need

### ChatGPT (OpenAI)

1. Go to [chat.openai.com](https://chat.openai.com)
2. Settings → Data controls → Export data
3. Wait for email with download link
4. Download ZIP file (e.g., `conversations.zip`)

### Facebook

1. Go to [facebook.com/dyi](https://facebook.com/dyi)
2. Request "Download Your Information"
3. Select format: **JSON** (not HTML)
4. Select date range: All time
5. Wait for export (can take hours for large accounts)
6. Download and extract to a folder

---

## Import Procedures

### ChatGPT Import (Working)

1. Open Humanizer app
2. Go to **Import** tab
3. Click **ChatGPT**
4. Select your `conversations.zip` file
5. Wait for import to complete
6. Data appears in **Archive** tab

**API Alternative**:
```bash
curl -X POST http://localhost:3002/api/import/openai \
  -F "file=@/path/to/conversations.zip"
```

### Facebook Import (API Only - UI Coming Soon)

Currently requires API call - UI integration pending.

**Step 1: Prepare Export Path**
```bash
# Your Facebook export should have this structure:
/path/to/facebook-export/
├── your_facebook_activity/
│   ├── posts/
│   ├── comments/
│   └── ...
├── messages/
├── photos_and_videos/
└── ...
```

**Step 2: Run Import via API**
```bash
curl -X POST http://localhost:3002/api/facebook/graph/import \
  -H "Content-Type: application/json" \
  -d '{
    "exportPath": "/path/to/facebook-export"
  }'
```

**Step 3: Monitor Progress**
- Watch console logs for progress
- Import generates embeddings automatically
- Typical timing: ~10 min for 10K posts

**Step 4: Verify Data**
```bash
# Check periods were created
curl http://localhost:3002/api/facebook/periods | jq '.periods | length'

# Check posts are searchable
curl -X POST http://localhost:3002/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "birthday party", "limit": 5}'
```

### Other Import Types

| Type | Status | Method |
|------|--------|--------|
| Claude | Not implemented | - |
| Gemini | Working | Import tab → Gemini |
| PDF | Working | Import tab → PDF |
| Folder | Working | Import tab → Folder |
| Paste | Working | Import tab → Paste text |

---

## Post-Import Verification

### 1. Check Archive Health

```bash
curl http://localhost:3002/api/embeddings/health | jq
```

Expected output:
```json
{
  "ready": true,
  "stats": {
    "conversations": 1234,
    "messages": 56789,
    "chunks": 0,
    "clusters": 0,
    "anchors": 0
  },
  "services": {
    "ollama": true,
    "modelLoaded": true,
    "indexing": false
  },
  "issues": []
}
```

### 2. Test Semantic Search

```bash
curl -X POST http://localhost:3002/api/embeddings/search/messages \
  -H "Content-Type: application/json" \
  -d '{"query": "your search query", "limit": 10}'
```

### 3. Check Facebook Data

```bash
# Periods (quarterly buckets)
curl http://localhost:3002/api/facebook/periods

# Recent posts
curl "http://localhost:3002/api/content/items?source=facebook&limit=10"

# Media gallery
curl http://localhost:3002/api/gallery/files
```

---

## Troubleshooting

### "Ollama not running"

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# If not, start it
ollama serve
```

### "No embedding model"

```bash
ollama pull nomic-embed-text
```

### "Facebook import fails"

Check folder structure matches expected format:
```bash
ls -la /path/to/facebook-export/your_facebook_activity/
# Should show: posts/, comments/, etc.
```

### "Empty Facebook tab in app"

This means Facebook data wasn't imported yet:
1. Run the import API command above
2. Or wait for UI integration (see `HANDOFF_DEC30_FACEBOOK_IMPORT_UI.md`)

### Embedding context length errors

Some very long posts (18K+ chars) exceed model context. These get zero vectors and are searchable by metadata only. This is expected behavior.

---

## Architecture Reference

### Servers (Auto-started by Electron)

| Server | Port | Purpose |
|--------|------|---------|
| Archive Server | 3002 | Conversations, search, embeddings |
| NPE-Local | 3003 | AI detection, transformations |
| Ollama | 11434 | LLM inference (external) |

### Key Directories

```
~/.humanizer/               # User data root (configurable)
├── archives/               # Imported data
│   ├── chatgpt/           # OpenAI conversations
│   └── facebook/          # Facebook posts/comments/media
├── .embeddings.db         # SQLite + sqlite-vec for semantic search
└── queue/                 # Background job queue
```

### Database Schema (v9)

| Table | Purpose |
|-------|---------|
| conversations | ChatGPT conversations |
| messages | ChatGPT messages |
| embeddings | 768-dim nomic-embed-text vectors |
| facebook_posts | Facebook posts |
| facebook_comments | Facebook comments |
| facebook_media | Facebook photos/videos |
| image_analysis | Vision model descriptions |
| image_description_embeddings | Semantic search for images |

---

## Quick Start Checklist

- [ ] Ollama installed and running
- [ ] nomic-embed-text model pulled
- [ ] Humanizer app installed
- [ ] ChatGPT export downloaded
- [ ] Facebook export downloaded (JSON format)
- [ ] ChatGPT import completed
- [ ] Facebook import completed (via API)
- [ ] Semantic search working
- [ ] Archive health check passes

---

## Next Steps

Once imports are complete:

1. **Explore Archive** - Browse conversations by date, search by content
2. **Semantic Search** - Find similar conversations across sources
3. **Image Gallery** - Browse Facebook photos with AI descriptions
4. **Analysis** - Use AI detection and transformation tools

---

## Support

- See `CLAUDE.md` for development documentation
- See `HANDOFF_DEC30_FACEBOOK_IMPORT_UI.md` for Facebook UI status
- Report issues at repository

---

**End of Guide**
