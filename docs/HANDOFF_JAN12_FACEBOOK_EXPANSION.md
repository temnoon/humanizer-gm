# Handoff: Facebook Data Expansion - Jan 12, 2026

## Session Summary

Began implementing Facebook data expansion to include Groups, Messenger, and Advertisers display. Groups backend is complete, UI tabs pending.

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `e0f89d5` | Fix workspace routing - Facebook content uses MainWorkspace for proper paragraph formatting, added lightbox |
| `5fff76f` | Groups parser, database schema v16, API routes |

---

## What's Complete

### Groups Backend (100%)
1. **GroupsParser.ts** - `electron/archive-server/services/facebook/GroupsParser.ts`
   - Parses `group_posts_and_comments.json` (posts in groups)
   - Parses `your_comments_in_groups.json` (your comments)
   - Parses `your_group_membership_activity.json` (join history)
   - Extracts group names, timestamps, external URLs
   - Handles Facebook Unicode encoding

2. **Database Schema v16** - `electron/archive-server/services/embeddings/EmbeddingDatabase.ts`
   ```sql
   fb_groups (id, name, joined_at, post_count, comment_count, last_activity)
   fb_group_content (id, group_id, type, text, timestamp, original_author, external_urls, title)
   ```

3. **API Routes** - `electron/archive-server/routes/facebook.ts` (lines 2516-2790)
   - `GET /api/facebook/groups` - List groups with search/sort
   - `GET /api/facebook/groups/stats` - Summary statistics
   - `GET /api/facebook/groups/:id` - Single group details
   - `GET /api/facebook/groups/:id/content` - Posts/comments for group
   - `POST /api/facebook/groups/import` - Import from export path

---

## What's Pending

### 1. Groups UI Tab
**File:** `apps/web/src/components/archive/FacebookView.tsx`
- Add 'groups' to ViewMode type
- Add groups state and loading functions
- Add Groups tab button and view

### 2. Messenger Integration
**Status:** Parser EXISTS, not wired into import
**File:** `electron/archive-server/services/facebook/MessengerParser.ts` (complete)
**Tasks:**
- Wire into FacebookFullParser.ts import pipeline
- Import ALL 1,762 threads (user preference)
- Add Messenger UI tab

### 3. Advertisers Display
**Status:** Data already indexed (2,449 advertisers), API routes exist
**Tasks:**
- Add Advertisers UI tab with detailed timeline view
- Show interaction timeline per advertiser
- First seen / last seen dates
- Data broker highlighting

---

## Test Commands

### Test Groups Import
```bash
curl -X POST http://localhost:3002/api/facebook/groups/import \
  -H "Content-Type: application/json" \
  -d '{"exportPath": "/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4"}'
```

### Verify Groups Data
```bash
curl http://localhost:3002/api/facebook/groups/stats
curl http://localhost:3002/api/facebook/groups?limit=10
```

---

## Key Files

| File | Purpose |
|------|---------|
| `electron/archive-server/services/facebook/GroupsParser.ts` | Parse groups JSON |
| `electron/archive-server/services/facebook/MessengerParser.ts` | Parse messenger (EXISTS) |
| `electron/archive-server/services/facebook/index.ts` | Exports all parsers |
| `electron/archive-server/routes/facebook.ts` | All Facebook API routes |
| `electron/archive-server/services/embeddings/EmbeddingDatabase.ts` | Schema + migrations |
| `apps/web/src/components/archive/FacebookView.tsx` | UI component (needs tabs) |

---

## Facebook Export Data Summary

From user's export at `/Users/tem/humanizer_root/archives/facebook/facebook-temnoon-2025-11-18-5XY1dvj4/`:

| Data Type | Count | Status |
|-----------|-------|--------|
| Posts | 9,909 | Indexed |
| Comments | 9,190 | Indexed |
| Friends | 2,625 | Indexed |
| Advertisers | 2,449 | Indexed, needs UI |
| Reactions | 55,009 | Indexed |
| Media | 1,229 | Indexed |
| Messenger Threads | 1,762 | Parser ready, not imported |
| Groups Posts | ~433KB | Parser ready, not imported |
| Groups Comments | ~540KB | Parser ready, not imported |

---

## Plan File

Full implementation plan at: `/Users/tem/.claude/plans/delegated-snuggling-swing.md`

---

## To Resume

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# Then in next session:
# 1. Test groups import with curl command above
# 2. Add Groups tab to FacebookView.tsx
# 3. Wire MessengerParser into import pipeline
# 4. Add Messenger tab
# 5. Add Advertisers tab
```

---

## ChromaDB Tags
- `jan-12-2026-facebook-expansion`
- `groups-implementation`
- `facebook-data`
