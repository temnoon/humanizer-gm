# Handoff: Book Studio API Consolidation - Phase 4 In Progress

**Date**: January 21, 2026
**Status**: Phase 4 partially complete, ready for continuation
**Priority**: CRITICAL - MVP Blocker

---

## Work Completed

### Phase 1-3: Backend Complete ✅

All backend work is done:
- Database migrations 7-11
- Services: HarvestService, DraftService, VoiceService, EmbeddingService
- Routes: harvest.ts, draft.ts, voice.ts (30 endpoints total)
- Middleware: validation.ts, error-handler.ts
- Security fixes applied and reviewed

### Phase 4: Frontend Migration 🔄 IN PROGRESS

**Completed:**
1. ✅ Explored frontend structure
2. ✅ Updated `api-client.ts` with new API calls

**In Progress:**
3. 🔄 Updated `BookStudioProvider.tsx` imports (partial)

**Remaining:**
4. Complete `BookStudioProvider.tsx` updates
5. Update `useBookStudioApi.ts` hooks (if needed)
6. Update frontend views (Staging, Outline, Writing)
7. Stylist and Accessibility Agent review

---

## Key Changes Made to api-client.ts

**File**: `apps/web/src/lib/book-studio/api-client.ts`

### New Types Added (lines ~120-200):

```typescript
// Harvest types
export interface HarvestSearchResult { ... }
export interface HarvestHistoryEntry { ... }
export interface HarvestInstruction { ... }

// Draft types
export interface DraftVersion { ... }
export interface DraftComparison { ... }

// Voice types
export interface VoiceProfile { ... }
export interface VoiceApplicationResult { ... }
```

### New API Methods Added to BookStudioApiClient:

**Harvest API** (10 methods):
- `harvestSearch(params)` - Search archive
- `harvestCommit(params)` - Commit results as cards
- `getHarvestHistory(bookId, options)` - Get history
- `harvestIterate(harvestId, adjustments, notes)` - Iterate on harvest
- `getHarvestSuggestions(bookId)` - Get suggestions
- `getHarvestInstructions(bookId, chapterId?)` - List instructions
- `createHarvestInstruction(instruction)` - Create instruction
- `deleteHarvestInstruction(instructionId)` - Delete instruction
- `toggleHarvestInstruction(instructionId, active)` - Toggle instruction

**Draft API** (10 methods):
- `generateDraft(params)` - Generate via Ollama
- `saveDraft(params)` - Save manual draft
- `getDraftVersions(chapterId)` - List versions
- `getDraftVersion(versionId)` - Get specific version
- `getLatestDraft(chapterId)` - Get latest
- `compareDrafts(v1, v2)` - Compare versions
- `reviewDraft(versionId, status, notes?)` - Update review status
- `scoreDraft(versionId, score)` - Set quality score
- `acceptDraft(versionId)` - Accept and copy to chapter
- `deleteDraft(versionId)` - Delete version
- `checkDraftHealth()` - Check Ollama availability

**Voice API** (9 methods):
- `extractVoice(params)` - Extract from cards
- `listVoices(bookId)` - List all voices
- `getVoice(voiceId)` - Get specific voice
- `createVoice(params)` - Create manual voice
- `updateVoice(voiceId, updates)` - Update voice
- `deleteVoice(voiceId)` - Delete voice
- `setPrimaryVoice(voiceId)` - Set as primary
- `applyVoice(params)` - Apply to transform content
- `getVoiceFeatures(voiceId)` - Get extracted features

---

## BookStudioProvider.tsx Updates Started

**File**: `apps/web/src/lib/book-studio/BookStudioProvider.tsx`

### Imports Updated:
```typescript
import {
  apiClient,
  type HarvestSearchResult,
  type DraftVersion,
  type VoiceProfile,
} from './api-client'
```

### Next Steps for Provider:

1. **Add Voice Agent State and Types:**
```typescript
export interface VoiceAgentState {
  voices: VoiceProfile[]
  primaryVoiceId: string | null
  isExtracting: boolean
  isApplying: boolean
  error: string | null
}
```

2. **Update Context Type** to include voice operations:
```typescript
voice: {
  state: VoiceAgentState
  extract: (cardIds: string[], name?: string) => Promise<VoiceProfile>
  list: () => Promise<VoiceProfile[]>
  apply: (voiceId: string, content: string) => Promise<string>
  setPrimary: (voiceId: string) => Promise<void>
}
```

3. **Update Draft Agent** to use API instead of direct Ollama:
- Replace `electronAPI.ollama.generate()` with `apiClient.generateDraft()`
- Use draft versioning for history

4. **Optionally update Harvest Agent** to use new consolidated API:
- Current harvest-api.ts works, but could use `apiClient.harvestSearch()` for consistency

---

## Files Reference

### Updated Files:
```
apps/web/src/lib/book-studio/
├── api-client.ts           # ✅ NEW: 29 new API methods + 7 new types
└── BookStudioProvider.tsx  # 🔄 PARTIAL: Imports updated, needs agent updates
```

### Files to Update:
```
apps/web/src/lib/book-studio/
├── useBookStudioApi.ts     # May not need changes (basic CRUD only)
├── types.ts                # May need voice-related type exports
└── index.ts                # May need new exports

apps/web/src/components/book-maker/views/
├── StagingView.tsx         # May need voice UI integration
├── OutlineView.tsx         # Minimal changes expected
└── WritingView.tsx         # Update draft generation to use API
```

---

## Resume Instructions

1. **Continue BookStudioProvider.tsx updates:**
   - Add VoiceAgentState type and initial state
   - Add voice agent operations (extract, list, apply, setPrimary)
   - Update draft.generate() to use apiClient.generateDraft()
   - Update context value to include voice agent

2. **Update WritingView.tsx:**
   - The draft generation UI should work with new API
   - Consider showing draft versions list

3. **Test TypeScript compilation:**
```bash
npx tsc --noEmit -p /Users/tem/humanizer_root/humanizer-gm/apps/web/tsconfig.json
```

4. **Request Stylist/Accessibility review** for any UI changes

---

## TypeScript Status

✅ Frontend compiles successfully after api-client.ts changes.

---

**End of Handoff**
