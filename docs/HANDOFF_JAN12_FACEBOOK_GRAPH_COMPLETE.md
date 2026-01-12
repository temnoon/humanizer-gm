# Handoff - January 12, 2026 (Session 9)

## For Next Session

**Retrieve ChromaDB context:**
```
mcp__chromadb-memory__search_by_tag(["jan-12-2026-s9"])
```

---

## Completed This Session

| Commit | Description |
|--------|-------------|
| (pending) | fix(graph): Facebook graph API + full-width layout + person context |

### Facebook Graph - FULLY WORKING

**API Fixes:**
- Fixed `/api/facebook/graph/top-connections` - Was returning empty (queried `is_own_content=0` but all data has `is_own_content=1`)
- Now extracts people from `context.targetAuthor` JSON field and title patterns
- Returns 930 unique people with 3,684 relationships

**UI Improvements:**
- Full-width layout (breaks out of centered container with `margin-left: calc(-50vw + 50%)`)
- Search filter with highlighting (matching nodes glow, others dim)
- Click-to-dismiss detail panel (click background or × button)
- Person context panel loads interaction history on node selection

**New API Endpoint:**
```
GET /api/facebook/graph/person/:name/context
```
Returns:
- Total interactions
- First/last interaction dates
- Breakdown by type (commented, shared, etc.)
- Recent interaction previews with text snippets

---

## STRATEGIC ROADMAP: Facebook Data Processing

The user has 17 years of Facebook data (2008-2025). Here's the complete picture:

### Data Already Parsed & Indexed

| Data Type | Count | Status | Location |
|-----------|-------|--------|----------|
| Posts | 11,105 | ✅ Indexed + embedded | `content_items` table |
| Comments | 9,190 | ✅ Indexed + embedded | `content_items` table |
| Reactions | 55,009 | ⚠️ Saved but NOT linked | `reactions` table |
| Media | 1,229 | ✅ Indexed | `media_items` table |
| Embeddings | 16,048 | ✅ 768-dim nomic-embed | `vec_content_items` |
| Messenger | 26,391 messages | ⚠️ Parser exists, NOT imported | N/A |

### Data Available But NOT Parsed

Located at: `/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4/`

| Category | Files | Contents | Priority |
|----------|-------|----------|----------|
| **Friends** | `connections/friends/your_friends.json` | 2,625 friends WITH timestamps | HIGH |
| **Removed Friends** | `connections/friends/removed_friends.json` | Unfriended people | HIGH |
| **Friend Requests** | `connections/friends/*.json` | Sent, received, rejected | MEDIUM |
| **Events** | `your_facebook_activity/events/*.json` | Events attended, hosted, invited | HIGH |
| **Advertisers** | `ads_information/advertisers_using_your_activity_or_information.json` (139KB) | Who's targeting you | HIGH |
| **Ad Preferences** | `ads_information/ad_preferences.json` (153KB) | Interest categories | MEDIUM |
| **Ad Interactions** | `ads_information/advertisers_you've_interacted_with.json` | Ads clicked | LOW |

### Data Structures

**Friends (your_friends.json):**
```json
{
  "friends_v2": [
    { "name": "Person Name", "timestamp": 1758115568 }
  ]
}
```

**Reactions (likes_and_reactions_*.json):**
```json
[
  {
    "timestamp": 1234567890,
    "data": [{ "reaction": { "reaction": "LIKE", "actor": "Tem Noon" }}],
    "title": "Tem Noon liked a link."
  }
]
```

**Advertisers:**
```json
{
  "label_values": [
    { "label": "A list uploaded...", "vec": [
      { "value": "LiveRamp" },
      { "value": "Oracle Data Cloud" },
      { "value": "Macy's" }
    ]}
  ]
}
```

---

## IMPLEMENTATION PHASES

### Phase 1: Parse Additional Metadata (3-4 hours)

**Create parsers for:**

1. **FriendsParser** - Parse `your_friends.json`
   - Extract friend names + friendship dates
   - Store in new `fb_friends` table
   - Enable "when did I become friends with X" queries

2. **EventsParser** - Parse events folder
   - `your_events.json` - Events you created
   - `event_invitations.json` - Events invited to
   - `your_event_responses.json` - Going/Maybe/Declined
   - Store in `fb_events` table with attendee links

3. **AdvertisersParser** - Parse ads_information
   - Extract advertiser names and categories
   - Store in `fb_advertisers` table
   - Enable "who's tracking me" dashboard

**New Tables Needed (Schema v10):**
```sql
CREATE TABLE fb_friends (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  friendship_date INTEGER,
  removed_date INTEGER,
  status TEXT DEFAULT 'friend' -- friend, removed, blocked
);

CREATE TABLE fb_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_time INTEGER,
  end_time INTEGER,
  place TEXT,
  description TEXT,
  host TEXT,
  response TEXT -- going, maybe, declined, invited
);

CREATE TABLE fb_advertisers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  first_seen INTEGER
);
```

### Phase 2: Link Reactions to Posts (2-3 hours)

**Problem:** 55,009 reactions exist but aren't linked to the posts they react to.

**Solution:**
1. Parse reaction titles for post references
2. Match to `content_items` by timestamp + author
3. Create `content_reactions` junction table
4. Enable queries like "posts I liked that friends also liked"

```sql
CREATE TABLE content_reactions (
  content_id TEXT REFERENCES content_items(id),
  reactor_name TEXT,
  reaction_type TEXT, -- LIKE, LOVE, HAHA, WOW, SAD, ANGRY
  timestamp INTEGER,
  PRIMARY KEY (content_id, reactor_name, timestamp)
);
```

### Phase 3: Build Filter UI (4-6 hours)

**Enhance FacebookFeedView with:**

1. **Date filters**
   - By period (birthday quarters)
   - Date range picker
   - Year selector

2. **Relationship filters**
   - Posts by specific friends
   - Posts mentioning friends
   - Posts friends reacted to

3. **Engagement filters**
   - Most commented
   - Most reacted
   - Posts I liked

4. **Content type filters**
   - Posts vs comments
   - With media vs text only
   - By reaction type

### Phase 4: Privacy Dashboard (2-3 hours)

**Show users:**
- Advertisers targeting them (with counts)
- Categories they're classified into
- Ad interactions history
- Data broker connections (LiveRamp, Oracle, etc.)

### Phase 5: Embed Transcripts + Unify Search (2-3 hours)

**Current gaps:**
- Transcripts saved but NOT embedded (0 in `transcript_embeddings`)
- Image descriptions analyzed but NOT embedded (9 only)
- Unified search exists but needs transcript integration

**Solution:**
1. Auto-embed transcripts after whisper transcription
2. Add to unified search endpoint
3. Make transcripts harvestable for book building

---

## KEY FILES REFERENCE

### Facebook Routes & Parsers
- `electron/archive-server/routes/facebook.ts` - API endpoints (graph, media, periods)
- `electron/archive-server/services/facebook/FacebookFullParser.ts` - Main orchestrator
- `electron/archive-server/services/facebook/PostsParser.ts` - Posts
- `electron/archive-server/services/facebook/CommentsParser.ts` - Comments
- `electron/archive-server/services/facebook/ReactionsParser.ts` - Reactions (needs linking)
- `electron/archive-server/services/facebook/MessengerParser.ts` - Messenger (not imported)

### Graph Visualization
- `apps/web/src/components/graph/SocialGraphView.tsx` - D3 force-directed graph
- `apps/web/src/styles/features/views.css` - Graph CSS (lines 1820-2350)
- `apps/web/src/styles/features/media.css` - Full-width override

### Feed & Filters
- `apps/web/src/components/archive/FacebookFeedView.tsx` - Feed UI
- `apps/web/src/components/archive/FacebookView.tsx` - Tab container

### Embeddings
- `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` - DB layer
- `electron/archive-server/routes/embeddings.ts` - API endpoints

---

## COMMANDS

```bash
# Development
npm run electron:dev

# Test graph endpoints
curl http://localhost:3002/api/facebook/graph/stats
curl "http://localhost:3002/api/facebook/graph/top-connections?limit=10"
curl "http://localhost:3002/api/facebook/graph/person/Suzy%20Life/context"

# Test content
curl "http://localhost:3002/api/content/items?source=facebook&limit=10"

# Check database stats
curl http://localhost:3002/api/embeddings/stats

# Database location
/Users/tem/openai-export-parser/output_v13_final/.embeddings.db

# Facebook export location
/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4/
```

---

## GRAPH IMPLEMENTATION DETAILS

### Why Graph Was Broken
The original queries filtered by `is_own_content = 0` expecting other people's content. But ALL content has `is_own_content = 1` because the parser marks everything as "your content" (posts you wrote, comments you wrote).

**The actual relationship data is in:**
1. `context` JSON field: `{"contextType":"other_post","targetAuthor":"Person Name","action":"commented"}`
2. `title` field patterns: `"Tem Noon shared a link to Person's timeline."`

### Current Graph Data Flow
```
GET /api/facebook/graph/top-connections
  → Query content_items WHERE context IS NOT NULL
  → Parse context.targetAuthor from JSON
  → Parse "to X's timeline" from title
  → Group by person, count interactions
  → Return as TopConnection[]

SocialGraphView.tsx
  → Fetch top-connections + stats
  → Build D3 force simulation with nodes + links
  → "You" node fixed at center
  → Other nodes positioned by force simulation
  → Search filter dims non-matching nodes
  → Click node → fetch /graph/person/:name/context
  → Show interaction history in detail panel
```

---

## SESSION SUMMARY

**Graph is now production-ready:**
- Full-width visualization with 930 nodes
- Search/filter by name
- Click node for detailed interaction history
- Dismissible detail panel
- Zoom/pan controls

**Next priority:** Parse friends.json for friendship dates, then build richer queries like "when did we become friends" and "mutual connections."

**Vision:** Enable users to explore their 17 years of Facebook data through intuitive filters, visualizations, and semantic search - all locally, privately, without data leaving their machine.

