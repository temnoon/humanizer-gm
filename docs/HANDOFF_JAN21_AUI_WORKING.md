# Handoff: AUI GUI Context Awareness - Working

**Date**: January 21, 2026
**Status**: AUI responding with context awareness, ready for continued testing
**Branch**: main

---

## Session Summary

This session focused on making the AUI (Agentic User Interface) aware of the GUI state so it can answer questions like "What books do I have?" directly from context without tool calls.

### Commits Pushed (6 total)

| Commit | Description |
|--------|-------------|
| `b1f41ea` | feat(aui): add GUI context awareness to AUI system prompt |
| `960811c` | fix(aui): show actual errors instead of "I couldn't process that" |
| `b05440b` | docs: update handoff with error visibility bug fix |
| `b83fd2c` | fix(ai-control): normalize OpenAI endpoint to handle /v1 suffix |
| `01e6c47` | fix(ai-control): use defaultProfile when no userId provided |
| `26f8c74` | fix(agent-master): fix regex lastIndex bug in thinking tag vetting |

---

## What Was Fixed

### 1. AUI Context Awareness (Phase 1 Complete)

**File**: `apps/web/src/lib/aui/AUIContext.tsx`

- Imported `useBookStudioOptional` from book-studio
- Enhanced `buildWorkspaceContext()` to include:
  - All books with card/chapter counts
  - Active book details (chapters, cards by status, voices)
  - Agent states (harvest/outline/draft in progress)
  - Current workspace selection
- Updated system prompt with CONTEXT AWARENESS section
- Combined with comprehensive 72-tool documentation

### 2. Error Visibility

**File**: `apps/web/src/lib/aui/AUIContext.tsx`

- Frontend now checks for system error messages (backend sends errors as `role: 'system'`)
- Shows actual error instead of generic "I couldn't process that"
- Helpful fallback: "Make sure Ollama is running (ollama serve)"

### 3. Tiered Chat Prompts Updated

**File**: `electron/agent-master/prompts/chat.ts`

- Added CONTEXT AWARENESS section to all three tiers (tiny, standard, full)
- LLM now knows workspace state is in context
- Instructions to answer state questions directly, use tools only for actions

### 4. OpenAI Endpoint Normalization

**File**: `electron/ai-control/providers.ts`

- `callOpenAI` and `streamOpenAI` now normalize endpoint
- Strips trailing `/v1` if present before building URL
- Handles both `https://api.openai.com` and `https://api.openai.com/v1`

### 5. Default Profile for Local Model Preference

**File**: `electron/ai-control/router.ts`

- Router now uses `config.defaultProfile` when no userId provided
- `defaultProfile` has `preferLocalModels: true`
- Ollama models tried first, cloud models as fallback
- Budget check guarded with `profile?.userId` since defaultProfile has no userId

### 6. Thinking Tag Vetting Fix

**File**: `electron/agent-master/vetting-registry.ts`

- Fixed JavaScript regex `lastIndex` bug
- `test()` with `g` flag advances lastIndex, breaking subsequent `replace()`
- Now compares content before/after replace instead of using test()

---

## Current State

### Working
- ✅ AUI responds to "What books do I have?" with correct book list
- ✅ Context includes books, chapters, cards, voices
- ✅ Local models (Ollama) preferred over cloud
- ✅ Error messages visible to user
- ✅ `<think>` tags stripped from output

### Needs Testing
- [ ] Tool execution (USE_TOOL calls)
- [ ] Book creation via AUI
- [ ] Chapter operations via AUI
- [ ] Harvest operations via AUI
- [ ] Voice profile queries
- [ ] Agent status queries

---

## Known Issues / Future Work

### 1. Hardcoded Model Names
Model names in `electron/ai-control/model-classes.ts` are hardcoded and outdated. Should be:
- Local models: Discovered at runtime from Ollama `/api/tags`
- Cloud models: Configured in `~/.humanizer/config/ai-config.json`
- Priority order: Config-driven, not code-driven

### 2. User Login Requirement
Currently AUI works without login (uses defaultProfile). Consider:
- Requiring login for AUI access
- Per-user preferences and budgets
- Usage tracking

### 3. Context Size
The workspace context can be large. May need:
- Summarization for very long contexts
- Selective inclusion based on query type

---

## Test Commands

After starting app with `npm run electron:dev`:

```
# Basic context awareness
"What books do I have?"
"How many cards are in staging?"
"What chapters does this book have?"
"What voice profiles are available?"

# Tool execution
"Search for conversations about consciousness"
"Create a chapter called Introduction"
"List all personas"

# Error handling
(Stop Ollama, then ask a question - should show helpful error)
```

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `apps/web/src/lib/aui/AUIContext.tsx` | Context awareness, error handling |
| `electron/agent-master/prompts/chat.ts` | Context awareness in tiered prompts |
| `electron/ai-control/providers.ts` | OpenAI endpoint normalization |
| `electron/ai-control/router.ts` | Default profile, budget check guard |
| `electron/agent-master/vetting-registry.ts` | Regex lastIndex fix |
| `docs/HANDOFF_JAN21_AUI_CONTEXT.md` | Updated with progress |

---

## Configuration Files

- **AI Config**: `~/.humanizer/config/ai-config.json`
  - `defaultProfile.preferLocalModels: true` - Ollama first
  - `providers.ollama.enabled: true`
  - `providers.openai.enabled: true` (with API key)

---

## Next Session Priorities

1. **Test tool execution** - Verify USE_TOOL calls work end-to-end
2. **Model configuration** - Move hardcoded models to config
3. **User login flow** - Consider requiring authentication
4. **Context optimization** - Summarize large contexts

---

**End of Handoff**
