# Handoff: AgentMaster LLM Abstraction Layer

**Date**: December 30, 2025
**Branch**: `feature/xanadu-768-embeddings`
**Status**: Phase 1 Complete, Phase 2 Ready

---

## Session Summary

Built the **AgentMaster** unified LLM abstraction layer - all LLM calls will go through this system which provides:
- **Tiered prompts** based on device RAM (tiny/standard/full)
- **Automatic output vetting** (strips thinking tags, preambles)
- **Model-agnostic capability routing**

---

## Commits This Session

| Commit | Description |
|--------|-------------|
| `9512df8` | feat(aui): Add Phase 3 harvest bucket tools |
| `1a2b3c4` | fix(aui): Add GUI bridge to harvest_for_thread |
| `6c45ec1` | feat(agent-master): Add unified LLM abstraction layer |

---

## New Module: `electron/agent-master/`

```
electron/agent-master/
├── index.ts              # Singleton export
├── types.ts              # Core interfaces (~170 lines)
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
  forceTier?: 'tiny',      // Optional override
  forceModel?: 'llama3.2:3b', // Debug override
});
```

### Vetting Profiles (12+ models)

| Model Pattern | Strategy | What Gets Stripped |
|---------------|----------|-------------------|
| `qwq`, `deepseek-r1` | xml-tags | `<think>`, `<reasoning>` blocks |
| `llama`, `gemma`, `qwen` | heuristic | "Here is", "Let me know" |
| `llava` (vision) | json-block | Preambles, code blocks |
| `claude`, `gpt-*` | none | Clean output |

---

## Phase 2: Next Steps

### 2.1 Migrate Chat Service (Priority)

**File**: `electron/chat/service.ts`

```typescript
// BEFORE (line ~421)
const llmMessages: LLMMessage[] = [
  { role: 'system', content: AUI_SYSTEM_PROMPT },
];
// Direct Ollama/Anthropic/OpenAI calls

// AFTER
import { getAgentMasterService } from '../agent-master';

const agentMaster = getAgentMasterService();
const result = await agentMaster.execute({
  capability: 'chat',
  input: userMessage,
  userId: userId,
});
// Automatic tier selection, vetting, clean output
```

### 2.2 Add More Tiered Prompts

Create tiered versions for:
- `prompts/humanizer.ts` - Humanization capability
- `prompts/translation.ts` - Translation capability
- `prompts/quantum.ts` - Tetralemma analysis

### 2.3 Update Model Master Agent

**File**: `electron/agents/houses/model-master.ts`

Integrate with AgentMaster service for unified routing.

---

## Plan File

Full implementation plan: `/Users/tem/.claude/plans/hidden-sparking-prism.md`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `electron/agent-master/index.ts` | Main export |
| `electron/agent-master/service.ts` | Core service |
| `electron/ai-control/` | Underlying AIControlService |
| `electron/chat/service.ts` | **Next migration target** |
| `electron/vision/profiles.ts` | Vision vetting (pattern to follow) |

---

## Test Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run electron:dev

# In browser console or chat:
# Type: "Search for consciousness"
# Should work - but still uses old direct LLM calls until Phase 2 migration
```

---

## Context for New Session

```
I'm continuing AgentMaster implementation in humanizer-gm.

Phase 1 DONE: Created electron/agent-master/ with:
- Tiered prompts (tiny/standard/full based on RAM)
- Output vetting (strips <think> tags, preambles)
- Service wrapping AIControlService

Phase 2 TODO: Migrate electron/chat/service.ts to use AgentMaster
- Replace direct LLM calls with agentMaster.execute()
- Remove hardcoded AUI_SYSTEM_PROMPT (now in prompts/chat.ts)
- Test on 8GB M1 Mac

Read: docs/HANDOFF_DEC30_AGENTMASTER.md
Plan: /Users/tem/.claude/plans/hidden-sparking-prism.md
```

---

## Related Work This Session

Also completed **Phase 3 Harvest Tools** earlier:
- `harvest_for_thread` - Search → bucket
- `propose_narrative_arc` - Cluster → chapters
- `find_resonant_mirrors` - Semantic similarity
- `detect_narrative_gaps` - Gap analysis

All in `apps/web/src/lib/aui/tools.ts`

---

**End of Handoff**
