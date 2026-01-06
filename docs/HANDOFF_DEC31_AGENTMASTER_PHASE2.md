# Handoff: AgentMaster Phase 2 Complete + AUI Integration

**Date**: December 31, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Phase 2 Complete, AUI routing through AgentMaster, ready for debugging

---

## Session Summary

Completed **AgentMaster Phase 2** - full integration with real LLM providers and AUI chat routing:

1. **Real Provider Implementations** - Ollama, Anthropic, OpenAI now work
2. **AUI Routes Through AgentMaster** - Tiered prompts + output vetting active
3. **Workspace Context Wired** - Buffer content, view mode passed to LLM
4. **Tool Validation Relaxed** - Shorter text now accepted for testing

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `aca2c64` | feat(ai-control): Implement real LLM provider calls |
| `5e11a7f` | feat(agent-master): Add tier override IPC handlers |
| `504e5e0` | feat(aui): Wire workspace context and relax validation |

---

## Architecture After Phase 2

```
User types in AUI chat
    │
    ▼
AUIContext.sendMessage()
    │
    ├── Check: window.isElectron?
    │
    ▼ YES
electronAPI.chat.sendMessage(content, { context: workspaceContext })
    │
    ▼
electron/main.ts IPC handler
    │
    ▼
ChatService.sendMessage()
    │
    ▼
ChatService.callLLM()
    │
    ▼
AgentMaster.execute({ capability: 'chat', input, messages })
    │
    ├── 1. Select tiered prompt (tiny/standard/full based on RAM)
    ├── 2. Build AIRequest with system prompt + conversation history
    │
    ▼
AIControlService.call()
    │
    ├── 3. Route to best provider/model
    ├── 4. callProvider() [Ollama/Anthropic/OpenAI]
    │
    ▼
filterOutput() [VettingRegistry]
    │
    ├── 5. Strip <think> tags, preambles, closings
    │
    ▼
Clean response back to AUI
```

---

## Key Files Modified

### New Files
| File | Purpose |
|------|---------|
| `electron/ai-control/providers.ts` | Real LLM provider implementations (~350 lines) |

### Modified Files
| File | Changes |
|------|---------|
| `electron/ai-control/router.ts` | `AIControlService.call()` now uses real providers |
| `electron/chat/service.ts` | `callLLM()` routes through AgentMaster |
| `electron/chat/types.ts` | Added `teaching` field, `userId` to config |
| `electron/agent-master/types.ts` | Added `ConversationMessage`, `messages` field |
| `electron/agent-master/service.ts` | Passes conversation history to AIControlService |
| `electron/main.ts` | Added AgentMaster IPC handlers |
| `electron/preload.ts` | Exposed `agentMaster` API to renderer |
| `apps/web/src/lib/aui/AUIContext.tsx` | Routes through Electron, builds workspace context |
| `electron/npe-local/routes/transformations.ts` | Relaxed validation (10 chars, 3 words) |
| `electron/npe-local/routes/detection.ts` | Relaxed validation (20 chars, 5 words) |

---

## Current State

### Working
- AgentMaster receives requests from AUI ✓
- Tiered prompt selection based on device RAM ✓
- Real provider calls (Ollama confirmed working) ✓
- Output vetting (stripping thinking tags) ✓
- Tier override from dev console ✓
- Workspace context building ✓

### Console Commands (Dev Tools)
```javascript
// Check current profile
await electronAPI.agentMaster.getProfile()
// → { tier: 'full', ramGB: 32, ... }

// Simulate 8GB device
await electronAPI.agentMaster.setTier('tiny')

// Simulate 16GB device
await electronAPI.agentMaster.setTier('standard')

// Back to auto-detection
await electronAPI.agentMaster.clearOverride()
```

### Terminal Output (Confirms Working)
```
[AgentMaster] chat: full tier, llama3.2:3b, 17951ms
[AgentMaster] chat: full tier, llama3.2:3b, 12970ms
```

---

## Known Issues / Debug Points

### 1. AUI Response Display
The AUI chat was showing "Chat service error" because of type mismatch:
- **Fixed**: `sendMessage` returns `ChatMessage[]`, not `{ success: boolean }`
- **File**: `apps/web/src/lib/aui/AUIContext.tsx` lines 430-441

### 2. Tool Output Appearing in Chat
User reported: "AUI tool use appearing in user chat window"
- This needs investigation - tool results may not be properly separated from chat content
- **File to check**: `apps/web/src/lib/aui/tools.ts` - `executeAllTools()` function

### 3. Archive Server 500 Errors
```
/api/archives:1 Failed to load resource: 500
```
- Separate from AgentMaster work
- **File**: `electron/archive-server/`

---

## Tiered Prompts Reference

| Tier | RAM | Tokens | Prompt File |
|------|-----|--------|-------------|
| tiny | <8GB | ~400 | `electron/agent-master/prompts/chat.ts` |
| standard | 8-16GB | ~1200 | Same file |
| full | >16GB | ~3500 | Same file |

---

## Vetting Profiles Reference

| Model | Strategy | What's Stripped |
|-------|----------|-----------------|
| qwq, deepseek-r1 | xml-tags | `<think>`, `<reasoning>` |
| llama, gemma, qwen | heuristic | "Here is", "Let me know" |
| llava | json-block | Preambles, code blocks |
| claude, gpt-* | none | Clean output |

---

## Next Steps (Phase 3)

### 3.1 Debug AUI Issues
- Investigate tool output appearing in chat
- Verify workspace context is reaching the LLM
- Test tier switching affects prompt size

### 3.2 Pyramid Summary System (User Request)
User wants:
- Apex summaries (~100 tokens) always available to agent
- Generate on-demand, then cache with `{ model, timestamp, content }`
- Multiple models can contribute summaries
- This becomes the agent's "memory"

### 3.3 Add More Tiered Prompts
- `prompts/humanizer.ts`
- `prompts/translation.ts`
- `prompts/quantum.ts`

### 3.4 Admin Prompt Editor
User requested UI to view/edit prompts without code changes.

---

## Test Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# In browser dev console:
await electronAPI.agentMaster.setTier('tiny')
# Then chat - terminal should show: [AgentMaster] chat: tiny tier, ...
```

---

## Context for New Session

```
AgentMaster Phase 2 COMPLETE in humanizer-gm.

What's Done:
- Real LLM providers in electron/ai-control/providers.ts
- AUI routes through Electron → AgentMaster → Provider
- Tiered prompts working (tiny/standard/full)
- Output vetting working (strips <think> tags)
- Tier override from dev console
- Workspace context passed to LLM
- Relaxed tool validation for testing

What Needs Debug:
- Tool output may be appearing in chat window
- Verify responses display correctly in AUI
- Test tier switching actually changes prompt size

User Requests for Future:
- Pyramid apex summaries as agent memory
- Admin UI for prompt editing

Read: docs/HANDOFF_DEC31_AGENTMASTER_PHASE2.md
Branch: feature/xanadu-768-embeddings
```

---

**End of Handoff**
