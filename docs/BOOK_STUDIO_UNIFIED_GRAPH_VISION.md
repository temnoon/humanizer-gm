# Book Studio: Unified Graph Vision

**Created**: January 16, 2026
**Status**: Architectural Vision (Post-Launch)
**Priority**: Phase 2+ (after launch)

---

## Core Insight

A book is a node. A finished book should be indistinguishable from any other source node in the archive. It can be searched, embedded, harvested from. The graph recurses.

```
Archive Node (conversation, document)
    ↓ harvest
Card (selected noema)
    ↓ curate
Chapter (structured noema)
    ↓ compose
Book (coherent corpus)
    ↓ publish
Canonical Node (new source in the graph)
```

---

## Current State (Launch)

Two separate databases:

| Database | Location | Contents |
|----------|----------|----------|
| Archive | `archive-server` | Conversations, documents, 72K embeddings |
| Book Studio | `book-studio-server` | Books, chapters, cards |

Cards have `source_id` linking to archive nodes. No unified graph yet.

---

## Unified Graph Schema (Future)

```sql
-- Everything is a node
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- conversation, message, document, card, chapter, book
  content TEXT,
  embedding BLOB,      -- Same model across all node types
  corpus_state TEXT,   -- draft, canonical, published (for derived nodes)
  created_at INTEGER,
  updated_at INTEGER
);

-- Relationships between nodes
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  edge_type TEXT NOT NULL,  -- harvested_from, contains, derived_from, similar_to
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  metadata JSON,
  created_at INTEGER,
  FOREIGN KEY (from_id) REFERENCES nodes(id),
  FOREIGN KEY (to_id) REFERENCES nodes(id)
);

-- Indexes for graph traversal
CREATE INDEX idx_edges_from ON edges(from_id);
CREATE INDEX idx_edges_to ON edges(to_id);
CREATE INDEX idx_edges_type ON edges(edge_type);
```

---

## Embedding Strategy

Same embedding model for everything (coherent semantic space):

1. **Card-level** - Harvested content, matches archive model
2. **Chapter-level** - Centroid of card embeddings OR fresh embed of compiled text
3. **Book-level** - Thematic signature for cross-book search

Benefits:
- "Find conversations similar to Chapter 3"
- "Find books related to this new conversation"
- Unified semantic search across all content

---

## Corpus States

```
draft → canonical → published → [archived]
```

- **Draft**: Mutable, private, work in progress
- **Canonical**: Frozen, ready for transformation
- **Published**: Released, becomes harvestable source node
- **Transformations**: Derived nodes from canonical
  - `book_789_es` (Spanish translation)
  - `book_789_eli5` (simplified)
  - `book_789_summary` (condensed)

---

## Implementation Phases

### Phase 1: Embed Cards (Post-Launch Week 1)
- Compute embedding when card harvested
- Store in `cards.embedding`
- Enable "find similar cards" within book

### Phase 2: Unified Search API (Week 2)
- Search endpoint queries both databases
- Results from conversations AND cards/chapters/books
- Same semantic space = coherent results

### Phase 3: Graph Layer (Week 3)
- Add `edges` table
- Track: harvested_from, contains, derived_from, similar_to
- Enable "show everything connected to this book"

### Phase 4: Canonical Corpus (Week 4)
- Add `corpus_state` to books
- Published books become source nodes
- "Harvest from books" in CommandPalette

### Phase 5: Post-Social View (Week 5+)
- Subjective graph visualization
- Your curation = your view of the field
- Curator agent surfaces patterns

---

## The Ontological Structure

```
World (Being)
    ↓ experience
Archive (captured noema - Level 1)
    ↓ harvest + curate
Books (structured noema - Level 2)
    ↓ model
Mind's Graph (subjective view - Level 3)
```

The Mind's Graph is emergent from:
- Which nodes harvested
- Which edges created
- Which books written
- Pattern of attention over time

The AI Curator reflects the mind back to itself, surfacing patterns: "You've been circling this theme for three years. Here are the 47 connected nodes."

---

## Open Questions

1. **Single DB vs Federated**: Lean toward separate DBs with unified view layer
2. **Embedding model**: Must match archive for cross-search
3. **When does book become source**: On publish? On canonical freeze?
4. **Curator role**: Active (suggests) vs Passive (responds)?

---

## Philosophy

This is a **personal semantic web** where:
- Nodes = thoughts and experiences
- Edges = acts of mind connecting them
- Book Suite = tools for sculpting Rho from lived experience

The post-social network: each person is a book (or several), with the AI Curator as helpful editor. Harvesting the archive, sculpting meaning.

---

**End of Vision Document**
