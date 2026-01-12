# Handoff - January 11, 2026 (Session 8)

## For Next Session

**Retrieve ChromaDB context:**
```
mcp__chromadb-memory__search_by_tag(["jan-11-2026-s8"])
```

---

## Completed This Session

| Commit | Description |
|--------|-------------|
| `baa06a4` | fix(transcript): panel visibility, positioning, file path extraction |
| `0766e2d` | style(transcript): add visible text selection highlight |
| `0f26a42` | fix(transcript): dark mode buttons and feed video support |

### Transcript Panel - FULLY WORKING
- Microphone button appears on videos (Gallery AND Feed)
- Click opens floating TranscriptPanel at (100,100)
- Panel is draggable by header
- Transcribe button calls whisper API
- Copy/Download buttons work
- Text selection works with blue highlight
- Dark mode styling fixed
- Closes on X or button re-click

---

## STRATEGIC TASKS FOR NEXT SESSIONS

The user outlined several interconnected goals. Here they are structured into logical phases:

---

### PHASE 1: Fix Facebook Graph Display (BLOCKING)

**Problem:** After refactor, Facebook graph visualization is not working.

**Files to investigate:**
- `apps/web/src/components/graph/SocialGraphView.tsx` - D3 force-directed graph
- `apps/web/src/components/archive/NetworkGraphView.tsx` - Alternative view
- Check how graph is triggered in Studio.tsx

**Debug steps:**
1. Check browser console for errors when opening graph view
2. Verify API endpoint `/api/facebook/graph/*` is responding
3. Check if graph data is being fetched properly

---

### PHASE 2: Facebook Metadata Filters (HIGH VALUE)

**Goal:** Powerful, intuitive filters using ALL available Facebook metadata.

**Available metadata (from Nov 28-29 imports):**
| Data Type | Count | Status |
|-----------|-------|--------|
| Posts | 11,105 | Indexed |
| Comments | 9,190 | Indexed |
| Reactions | 55,009 | Saved but NOT linked |
| Media | 1,229 | Indexed |
| Messenger threads | 704 | Parser built, not imported |
| Messenger messages | 26,391 | Parser built, not imported |

**Filter dimensions to implement:**
1. **Date filters** - By period (birthday quarters), date range, year
2. **Reaction filters** - Posts I liked, posts others liked, reaction types (like/love/wow/haha/sad/angry)
3. **Engagement filters** - Most commented, most reacted, viral posts
4. **Relationship filters** - Posts by specific people, posts mentioning people
5. **Content type** - Posts vs comments, with media vs text only
6. **Sentiment/tone** - Using existing embeddings for semantic filtering

**Key files for filter UI:**
- `apps/web/src/components/archive/FacebookFeedView.tsx` (existing filters)
- Previous work: See ChromaDB memories tagged `facebook, filters`

**API endpoints needed:**
- Extend `/api/content/items` with reaction filters
- Build `/api/facebook/reactions/link` to connect reactions to posts
- Add `/api/facebook/stats/engagement` for engagement metrics

---

### PHASE 3: Transcript Embedding for Book Harvesting

**Problem:** Video transcripts are stored but NOT embedded for semantic search.

**Current state:**
- Transcripts saved via `/api/facebook/transcription/transcribe`
- Stored in database with mediaId
- NOT generating embeddings
- Cannot be harvested for book building

**Solution needed:**
1. After transcription completes, auto-embed the transcript text
2. Add transcript content to unified search
3. Make transcripts harvestable via AUI `harvest_archive` tool

**Files to modify:**
- `electron/archive-server/routes/facebook.ts` - transcription endpoint
- `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` - add transcript embedding
- `apps/web/src/lib/aui/tools.ts` - update harvest_archive

---

### PHASE 4: Universal Text Content (Xanadu Integration)

**Goal:** Unify ALL text sources into a single searchable corpus.

**Text sources to unify:**
| Source | Status | Embedding Status |
|--------|--------|------------------|
| AI conversations (OpenAI/Claude) | Indexed | 36,255 embeddings |
| Facebook posts/comments | Indexed | 16,048 embeddings |
| Video transcripts | Saved | NOT embedded |
| Image descriptions | 9 analyzed | NOT embedded |
| PDF documents | Parser exists | Needs testing |
| Local documents | Parser exists | Needs testing |

**Xanadu concept:** The "768-dimension" embedding space as universal semantic layer.

**Implementation:**
1. All text content → nomic-embed-text → 768-dim vector
2. Unified search across ALL sources
3. Single "harvest" interface for book building

**Existing work:**
- Jan 10, 2026: Built `/api/embeddings/search/unified` endpoint
- Searches both `vec_messages` AND `vec_content_items`
- Needs extension for transcripts and image descriptions

---

### PHASE 5: Semantic Search Enhancement

**Goal:** Bring all data together through embeddings.

**Current embedding state:**
| Table | Count | Notes |
|-------|-------|-------|
| vec_messages | 36,255 | AI conversations |
| vec_content_items | 16,048 | Facebook (84% coverage) |
| image_description_embeddings | 9 | Only 9 images analyzed |
| transcript_embeddings | 0 | NOT YET IMPLEMENTED |

**Unified search endpoint:** `POST /api/embeddings/search/unified`
- Already searches messages + content
- Needs: transcripts, image descriptions

**AUI integration:**
- `search_archive` tool uses unified endpoint
- `harvest_archive` may need similar update

---

## DEPENDENCY ORDER

```
Phase 1: Fix Graph (unblocks visualization work)
    ↓
Phase 2: Metadata Filters (uses graph data, reactions)
    ↓
Phase 3: Transcript Embedding (enables unified search)
    ↓
Phase 4: Universal Text (Xanadu - depends on all embeddings)
    ↓
Phase 5: Semantic Search Enhancement (final unification)
```

---

## UNPROCESSED FACEBOOK METADATA

From ChromaDB memory (Nov 28, 2025):

**55,009 reactions** saved but need linking:
```sql
-- reactions table exists but posts don't reference it
-- Need to build reverse index: reaction → post
```

**Reaction types available:**
- LIKE, LOVE, HAHA, WOW, SAD, ANGRY
- Each has: actor (who reacted), timestamp, target_id

**Files with reaction data:**
```
/your_facebook_activity/likes_and_reactions/posts_and_comments.json
/your_facebook_activity/likes_and_reactions/pages.json
```

**Friend data:**
```
/friends_and_followers/friends.json
/friends_and_followers/friend_requests_received.json
/friends_and_followers/removed_friends.json
```

---

## KEY FILES REFERENCE

### Facebook Data Layer
- `electron/archive-server/services/facebook/FacebookFullParser.ts` - Main importer
- `electron/archive-server/services/facebook/ReactionsParser.ts` - Parses reactions
- `electron/archive-server/services/facebook/MessengerParser.ts` - Messenger (not yet imported)
- `electron/archive-server/routes/facebook.ts` - API endpoints

### Embeddings
- `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` - DB layer
- `electron/archive-server/routes/embeddings.ts` - API endpoints
- Schema v9: `vec_messages`, `vec_content_items`, `image_description_embeddings`

### Graph Visualization
- `apps/web/src/components/graph/SocialGraphView.tsx` - D3 force graph
- `apps/web/src/components/archive/NetworkGraphView.tsx` - Alternative

### Transcript System
- `apps/web/src/components/media/TranscriptPanel.tsx` - UI component
- `electron/archive-server/routes/facebook.ts` - `/api/facebook/transcription/*`

---

## COMMANDS

```bash
# Development
npm run electron:dev

# Test Facebook API
curl http://localhost:3002/api/facebook/periods
curl "http://localhost:3002/api/content/items?source=facebook&limit=10"

# Test unified search
curl -X POST http://localhost:3002/api/embeddings/search/unified \
  -H "Content-Type: application/json" \
  -d '{"query": "art", "limit": 10}'

# Check embedding stats
curl http://localhost:3002/api/embeddings/stats
```

---

## SESSION SUMMARY

**Transcript Panel:** Fully working for Gallery and Feed videos. Users can transcribe, copy, download, and select text. Dark mode styled correctly.

**Next priority:** Fix Facebook graph display, then implement powerful metadata filters.

**Strategic vision:** Unify ALL text content (AI chats, Facebook, transcripts, images, documents) into semantic search space for book harvesting.
