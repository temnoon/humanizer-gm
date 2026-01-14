# Book Studio Vision Document

**Date:** January 14, 2026
**Status:** Brainstorm Complete - Ready for Prototype

---

## Core Philosophy

> "We are creating an experience for the user that must be as enjoyable as holding a finished product."

The Book Studio serves the **creative journey**, not just the output. Publication is one exit, not the only exit. A family history for 12 people is as valid as bestseller aspirations.

### What We're NOT Building

- A template-driven "choose your memoir type" wizard
- A prescriptive linear workflow
- An opinionated tool that knows what kind of book you should make
- A system that assumes publication as the goal

### What We ARE Building

A **vision-agnostic creative substrate** that enables:
- Picture books with short captions
- Philosophical evolution from 20 years of Facebook
- Biography of a parent
- Technical textbooks
- Children's books
- Family histories
- And anything else the user envisions

---

## Design Principles

### 1. Vision-Agnostic
No assumed book type, structure, or purpose. Each person means something different when they say "I'm writing the book I've been thinking about my whole life."

### 2. Workspace Over Workflow
**Workflow** (anti-pattern): "First harvest, then curate, then outline, then draft..."
**Workspace** (our approach): "Here are your materials. Here are your tools. Make your book."

The pipeline from the original handoff:
```
Source Discovery → Harvesting → Curation → Outlining → Drafting → Review → Export
```
...is too linear. These activities happen in any order, repeatedly, overlapping.

### 3. Accessible Over Visible
Distraction-free by default, rich on demand. Tools are summoned, not constantly present.

### 4. Book State as Anchor
Always know what you're building, what chapter you're in, how far along you are. This is the one persistent visible element.

```
┌─────────────────────────────────────────────────────────┐
│ [Book Title] ▾  Ch.4 ▾  │ ⌘K search  │ 12,847 words   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│              [Primary Focus Area]                       │
│                                                         │
│              One mode, full attention                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Tools appear contextually when needed                   │
└─────────────────────────────────────────────────────────┘
```

### 5. Configurable Presence
User controls how "helpful" the tool is. Interruption levels from zero to full.

### 6. Progress Awareness
"What task we are on, how far we've come, how far to go" - subtly visible, always accessible.

---

## Content Discovery

### Search Must Be Hybrid
Semantic search alone has problems:
- Short prompts produce poor results
- Tangential noise (image descriptions, code samples)
- Users don't understand text vs semantic difference

**Solution:**
```
┌─────────────────────────────────────────────────────────┐
│ Search: [                                    ] [Go]     │
│                                                         │
│ ○ Text match  ○ Semantic  ● Smart (both)               │
│                                                         │
│ Content types: ☑ Posts ☑ Notes ☐ Images ☐ Messages     │
│ Time range:   [All time ▾]                             │
└─────────────────────────────────────────────────────────┘
```

### Discovery Modes
All should be available:
- **Semantic search**: "Find posts about loss"
- **Timeline browsing**: "What was I posting in summer 2018?"
- **Resonance/similarity**: "Find more like this" (semantic anchor pattern)
- **Thematic clustering**: "Show me all the threads/themes"
- **Simple text search**: Sometimes the most effective

### Semantic Anchor Pattern
Instead of typing "posts about loss", select an existing passage and ask "find more like this" - much better embedding match than free-text queries.

---

## The Harvest Card

When content is found, it becomes a **card** - an enriched reference:

```
┌─────────────────────────────────────────────────────────┐
│ HARVEST CARD                                    [×]     │
├─────────────────────────────────────────────────────────┤
│ Facebook post · June 14, 2019                          │
│                                                         │
│ "After dad's funeral, I sat in his truck for an hour.  │
│  The smell of sawdust and coffee. I wasn't ready to    │
│  drive it home yet."                                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ My notes:                                              │
│ [Perfect opening for the woodshop chapter. Raw emotion │
│  but not overwrought.]                                 │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ 🤖 AI context: (toggle ▾)                              │
│ "This passage resonates with the themes of inheritance │
│  and craft you're developing in Ch.3. The sensory      │
│  details (sawdust, coffee) could anchor the reader     │
│  in physical memory before the philosophical turn."    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [Move to Ch.3 ▾]  [Duplicate]  [Archive]               │
└─────────────────────────────────────────────────────────┘
```

**Card contents:**
- Source attribution (where, when)
- Content preview
- User's notes (why it matters)
- Optional AI context (configurable verbosity)
- Actions: move to chapter, duplicate, archive back

---

## Staging Area

The staging area is a collection of harvest cards. Multiple views of the same data:

```
Views: [Grid] [Timeline] [Canvas] [AI Clusters]
```

- **Grid**: Simple card layout
- **Timeline**: Chronological ordering (often crucial)
- **Canvas**: Kanban-style spatial arrangement
- **AI Clusters**: Suggested groupings based on themes

---

## Archive-to-Book Relationships

The archive can serve as:
- **Quarry**: Raw stone to carve - extract, transform, reshape
- **Museum collection**: Already exists, just arranging and presenting
- **Conversation partner**: Dialogue with it, it reveals what the book wants to be
- **Memory palace**: Navigation aid - archive is map, book is journey

Each metaphor is valid for different users, different books, different moments.

**Spectrum of use:**
```
Pure preservation ←──────────────────→ Heavy transformation
│                                        │
│ "This passage is perfect as-is"        │ "Archive reminded me of something new"
│                                        │
No LLM ←────────────────────────────────→ Full AI collaboration
```

The tool is comfortable at every point on these spectrums simultaneously.

---

## Chapter Creation

Chapters can emerge from:
1. **Clusters**: AI groups cards, you approve "this is Chapter 3"
2. **Top-down outline**: Define chapters first, fill them later
3. **Emergent from writing**: Boundaries reveal themselves as you write
4. **Key passages**: A single powerful passage seeds the chapter

**Fluidity is key**: Easy to create, split, combine, reorder. Chapters are suggestions until they're not.

---

## Book Length Calibration

Users have no calibration for book length. Help with:
- **Word count targets**: "A typical memoir is 60-80K words"
- **Comparable books**: "Similar length to [Book X]"
- **Flexible scope**: Let material determine length
- **Reading time estimates**: "At current length, this is a 4-hour read"

---

## Writing Modes

```
[Flow] ←─────────────────────→ [Assist] ←────────────────────→ [Full]
  │                               │                               │
  Zero interruption              Grammar only                   Everything
  "Vomit draft"                  Catch errors                   Voice, expansion, AI
```

The "vomit draft" (Anne Lamott's "shitty first draft") is a valid technique. No judgment, no interruption, just flow.

**AI assistance options (user-controlled):**
- Grammar/spelling only
- Voice consistency checking
- First draft generation from cards
- Expansion/compression on demand

---

## Review Process

### V1 Scope
- **Self-review tools**: Word frequency, readability scores, pacing analysis
- **AI editorial feedback**: Structural/narrative observations
- **Export for human readers**: Simple sharing mechanism

### Future Roadmap
- Professional editing integration
- Cloudflare-based collaboration
- Gutenberg AI curators
- Email feedback integration

---

## Export Formats

### V1 Priority
1. **PDF** (must have) - Universal, printable
2. **Markdown** (must have) - Plain text, further processing
3. **EPUB** (should have) - E-reader format
4. **Print-ready** (nice to have) - KDP/IngramSpark templates

---

## Project Management

**Model:** Multiple books, one active at a time.

Users can switch between projects, but the workspace is always focused on one book. Simpler UX, clearer context.

---

## Notification System

User-configurable interruption levels:

1. **Semantic suggestions**: "This reminds me of a post from 2019..."
2. **Style nudges**: "This paragraph sounds different from your voice"
3. **Nothing unsolicited**: Only speak when spoken to
4. **Task completion only**: Notify when explicit tasks finish

Default: Task completion only. Power users can enable more assistance.

---

## Open Questions for Prototyping

1. **Card persistence**: Where do cards live? Local storage? Book file?
2. **Archive read pattern**: How does sandbox read humanizer-gm archives?
3. **AI model routing**: Which models for which tasks?
4. **Version control granularity**: Per-chapter? Per-draft? Per-edit?
5. **Collaboration model**: How do beta readers interact?

---

## Next Steps

1. Create `humanizer-sandbox` repo
2. Set up read-only archive access
3. Prototype the card system
4. Prototype the staging area views
5. Prototype the book anchor header

**Key constraint**: No changes to humanizer-gm until patterns are proven.

---

**Document Status:** Brainstorm complete. Ready for prototype phase.
