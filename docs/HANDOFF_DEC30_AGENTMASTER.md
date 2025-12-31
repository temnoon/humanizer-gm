# Handoff: AgentMaster LLM Abstraction Layer

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Phase 1 & 2 Complete, Phase 3 Ready

---

## Session Summary

Built the **AgentMaster** unified LLM abstraction layer - all LLM calls now go through this system which provides:
- **Tiered prompts** based on device RAM (tiny/standard/full)
- **Automatic output vetting** (strips thinking tags, preambles)
- **Model-agnostic capability routing**
- **Real provider calls** (Ollama, Anthropic, OpenAI implemented)

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `9512df8` | feat(aui): Add Phase 3 harvest bucket tools |
| `6c45ec1` | feat(agent-master): Add unified LLM abstraction layer |
| `pending` | feat(ai-control): Add real provider implementations |
| `pending` | refactor(chat): Migrate to AgentMaster |

---

## Phase 1 Complete: AgentMaster Foundation

### New Module: `electron/agent-master/`

```
electron/agent-master/
├── index.ts              # Singleton export
├── types.ts              # Core interfaces (~180 lines)
├── service.ts            # Main service wrapping AIControlService (~200 lines)
├── device-profile.ts     # RAM detection → tier (~100 lines)
├── prompt-engine.ts      # Tier selection, interpolation (~200 lines)
├── vetting-registry.ts   # Model profiles, output filtering (~400 lines)
└── prompts/
    └── chat.ts           # Tiered AUI prompts (~300 lines)
```

### Key Types

```typescript
type MemoryTier = 'tiny' | 'standard' | 'full';

// Device auto-detection
<8GB RAM  → 'tiny'     // ~400 token prompts
8-16GB   → 'standard' // ~1200 token prompts
>16GB    → 'full'     // ~3500 token prompts

// Usage
const agentMaster = getAgentMasterService();
const result = await agentMaster.execute({
  capability: 'chat',
  input: 'user message',
  messages: conversationHistory,  // NEW: conversation support
  forceTier?: 'tiny',
  forceModel?: 'llama3.2:3b',
});
```

---

## Phase 2 Complete: Chat Service Migration

### What Changed

**`electron/ai-control/providers.ts`** (NEW ~350 lines)
- Implemented real LLM provider calls
- `callOllama()`, `callAnthropic()`, `callOpenAI()`
- `streamOllama()`, `streamAnthropic()`, `streamOpenAI()`
- Unified `callProvider()` and `streamProvider()` dispatchers

**`electron/ai-control/router.ts`**
- Updated `AIControlService.call()` to use real providers (was returning stub)
- Updated `AIControlService.stream()` for real streaming
- Added `buildMessages()` to construct LLM message arrays

**`electron/chat/service.ts`**
- Replaced `callLLM()` to use `agentMaster.execute()`
- Removed direct Ollama/Anthropic/OpenAI calls
- Marked `AUI_SYSTEM_PROMPT` as deprecated (now in prompts/chat.ts)
- Added conversation history support via `messages` parameter

**`electron/chat/types.ts`**
- Added `teaching` field to `LLMResponse`
- Added `userId` to `ChatServiceConfig`

**`electron/agent-master/types.ts`**
- Added `ConversationMessage` interface
- Added `messages` field to `AgentMasterRequest`

---

## Phase 3: Next Steps

### 3.1 Test on 8GB M1 Mac
```bash
npm run electron:dev
# Chat should auto-select 'standard' tier with smaller prompts
```

### 3.2 Add More Tiered Prompts

Create tiered versions for other capabilities:
- `prompts/humanizer.ts` - Humanization
- `prompts/translation.ts` - Translation
- `prompts/quantum.ts` - Tetralemma analysis

### 3.3 Update Model Master Agent

**File**: `electron/agents/houses/model-master.ts`

Integrate with AgentMaster service for unified routing.

---

## Vetting Profiles (12+ models)

| Model Pattern | Strategy | What Gets Stripped |
|---------------|----------|-------------------|
| `qwq`, `deepseek-r1` | xml-tags | `<think>`, `<reasoning>` blocks |
| `llama`, `gemma`, `qwen` | heuristic | "Here is", "Let me know" |
| `llava` (vision) | json-block | Preambles, code blocks |
| `claude`, `gpt-*` | none | Clean output |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `electron/agent-master/index.ts` | Main AgentMaster export |
| `electron/agent-master/service.ts` | Core service |
| `electron/agent-master/prompts/chat.ts` | Tiered AUI prompts |
| `electron/ai-control/providers.ts` | LLM provider implementations |
| `electron/ai-control/router.ts` | AIControlService with real calls |
| `electron/chat/service.ts` | Chat service (now uses AgentMaster) |

---

## Test Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# In chat:
# Type: "Search for consciousness"
# Now uses AgentMaster → tiered prompts → automatic vetting
```

---

## Architecture After Phase 2

```
ChatService.sendMessage()
    │
    └── callLLM()
          │
          ├── Build conversation history
          │
          └── agentMaster.execute({
                capability: 'chat',
                input: userMessage,
                messages: history,
              })
                │
                ├── Select tiered prompt (tiny/standard/full)
                │
                ├── Build AIRequest with system prompt + messages
                │
                └── AIControlService.call()
                      │
                      ├── Route to best provider/model
                      │
                      └── callProvider() [Ollama/Anthropic/OpenAI]
                            │
                            └── filterOutput() [strip thinking tags, preambles]
                                  │
                                  └── Clean response to user
```

---

## Context for New Session

```
AgentMaster Phase 1 & 2 DONE in humanizer-gm.

Phase 1: Created electron/agent-master/ with:
- Tiered prompts (tiny/standard/full based on RAM)
- Output vetting (strips <think> tags, preambles)
- 12+ model vetting profiles

Phase 2: Migrated chat to AgentMaster:
- electron/ai-control/providers.ts (real LLM calls)
- electron/chat/service.ts (uses agentMaster.execute())
- Conversation history support

Phase 3 TODO:
- Test on 8GB M1 Mac with tiered prompts
- Add more tiered prompts (humanizer, translation)

Read: docs/HANDOFF_DEC30_AGENTMASTER.md
```

---

**End of Handoff**
