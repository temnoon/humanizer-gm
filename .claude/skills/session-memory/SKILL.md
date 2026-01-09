---
description: Session memory management via ChromaDB. Auto-invoke at session start, when user references past work, asks to "continue", or says "what did we do". Also invoke at session end for summary storage.
user-invocable: true
---

# Session Memory Protocol

## Session Start Checklist

When a session begins, retrieve context:

```
1. recall_memory("session summaries from last 2 days", 5)
2. search_by_tag(["in-progress", "blocked"])
3. retrieve_memory("current priorities humanizer", 3)
```

### Briefing Format

```markdown
## Session Briefing

**Last Session**: [timestamp from most recent session-summary]

**Recent Accomplishments**:
- [Key achievement 1]
- [Key achievement 2]

**In Progress**:
- [Feature/work]: [status]

**Blockers**: [None | List issues]

**Next Steps**: [Based on last session notes]
```

## Session End Protocol

Store summary with proper tagging:

```json
{
  "content": "Session summary: [what was accomplished]...",
  "metadata": {
    "tags": "session-summary,[primary-area],[status]",
    "type": "session-summary",
    "timestamp": "[ISO 8601: YYYY-MM-DDTHH:MM:SSZ]"
  }
}
```

## Tag Conventions

### Primary Categories
- `frontend` - React, UI components, styling
- `backend` - FastAPI, database, services
- `electron` - Desktop app, IPC, main process
- `aui` - Agentic UI, tools, chat
- `archive` - Import, parsing, storage
- `book` - Book building, chapters, rendering

### Type Tags
- `feature` - New functionality
- `bug` - Issue fixes
- `refactor` - Code restructuring
- `experiment` - Exploratory work
- `handoff` - Session handoff notes

### Status Tags
- `in-progress` - Work ongoing
- `complete` - Finished
- `blocked` - Waiting on something

## Memory Search Patterns

### Find related work
```
retrieve_memory("[topic] implementation", 5)
search_by_tag(["[area]", "[type]"])
```

### Find timeline
```
recall_by_timeframe("2025-01-01", "2025-01-08")
```

### Find decisions
```
retrieve_memory("[topic] decision architecture", 5)
search_by_tag(["architecture", "decision"])
```

## Context Efficiency

Memory agent saves tokens by:
1. Multi-query searches → single synthesized report
2. Processing many memories → returning only relevant ones
3. Pattern recognition across memories → insights for main agent

**Rule**: Main agent should NEVER do raw memory searches. Always delegate to memory-agent for efficiency.
