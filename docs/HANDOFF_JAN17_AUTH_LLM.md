# Handoff: Full Production Auth + Cloud LLM Access

**Date:** January 17, 2026
**Branch:** main (humanizer-gm)
**Status:** Phase 1-2 COMPLETE, Phase 3 ~80% complete

---

## Session 2 Progress (Latest)

### Phase 1.6 Complete ✅
**File:** `electron/main.ts`

- Wired `initBookStudioAuth(jwtSecret)` before server startup
- JWT secret is auto-generated on first run (production) and stored in electron-store
- Dev mode supports explicit `JWT_SECRET` env var
- Production uses secure 256-bit random secret

### Phase 2: Cloud LLM Providers COMPLETE ✅

#### 2.1 New Provider Implementations
**New Files:**
- `electron/npe-local/services/llm/cloudflare.ts` - Cloudflare Workers AI (`@cf/` prefix models)
- `electron/npe-local/services/llm/openrouter.ts` - OpenRouter aggregator (100+ models)
- `electron/npe-local/services/llm/together.ts` - Together.ai (open-source models)

Each provider implements the `LLMProvider` interface with:
- `call(request)` - Chat completion
- `isAvailable()` - Check API key configured
- `generateText()` - Simple text generation

#### 2.2 Model Router Enhanced
**File:** `electron/npe-local/services/llm/types.ts`

Updated `getProviderType()` to detect:
- `@cf/` prefix → Cloudflare
- `openrouter/` or `provider/model` format → OpenRouter
- `together/` prefix → Together.ai

Updated `APIKeyConfig` interface with new providers:
- `cloudflare`, `openrouter`, `together`

#### 2.3 Fallback Router
**New File:** `electron/npe-local/services/llm/fallback-router.ts`

- Tries providers in priority order (local first, then cloud)
- Tracks failures with exponential backoff (1min cooldown, 5min after 3 failures)
- Automatic failover on errors
- Configurable timeout per attempt (default 30s)
- `FallbackRouter` class and `createFallbackRouter()` factory

#### 2.4 Cost Tracking
**New File:** `electron/npe-local/services/llm/cost-tracker.ts`

- Per-model pricing table (OpenAI, Anthropic, Together, etc.)
- Records usage (input/output tokens)
- Calculates estimated costs
- Daily/monthly summaries
- Projected monthly cost extrapolation
- `formatCost()` and `formatTokens()` utilities

### Phase 3: API Key Management (~80%)

#### 3.1 Secure Storage ✅
**New File:** `electron/ai-control/secure-storage.ts`

- Uses Electron `safeStorage` for OS-level encryption (Keychain on macOS)
- Keys encrypted at rest, only decrypted when needed
- Plaintext fallback for development/testing
- Validates key format per provider
- Migration support from plaintext configs

#### 3.2 API Key Settings UI ⏳
**Not yet implemented** - React component needed

#### 3.3 IPC Handlers ✅
**New File:** `electron/ipc/ai-config.ts`

Handlers registered:
- `ai-config:get-providers` - List all providers with status
- `ai-config:set-api-key` - Store key securely + enable provider
- `ai-config:remove-key` - Remove key + disable provider
- `ai-config:validate-key` - Test key with provider API
- `ai-config:get-usage` - Daily/monthly usage stats
- `ai-config:get-model-config` - Get current config
- `ai-config:set-model-config` - Update preferences
- `ai-config:get-health` - Provider health/availability

#### 3.4 Preload Bridge ✅
**File:** `electron/preload.ts`

Added `aiConfig` bridge exposing all IPC handlers to renderer.

**File:** `electron/preload/types/core.ts`

Added types:
- `AIConfigAPI` interface
- `ProviderStatus` type
- `UsageStats` type

---

## Files Changed Summary (Session 2)

### New Files (6)
```
electron/npe-local/services/llm/cloudflare.ts
electron/npe-local/services/llm/openrouter.ts
electron/npe-local/services/llm/together.ts
electron/npe-local/services/llm/fallback-router.ts
electron/npe-local/services/llm/cost-tracker.ts
electron/ai-control/secure-storage.ts
electron/ipc/ai-config.ts
```

### Modified Files (6)
```
electron/main.ts                             # JWT init, AI config handlers
electron/npe-local/services/llm/types.ts     # New providers + config
electron/npe-local/services/llm/index.ts     # Exports + factory
electron/ai-control/index.ts                 # Secure storage exports
electron/preload.ts                          # aiConfig bridge
electron/preload/types/core.ts               # AI config types
electron/preload/types/index.ts              # Type exports
```

---

## Remaining Work

### Phase 3 Remaining (~20%)
1. **API Key Settings UI** (`apps/web/src/components/settings/ApiKeySettings.tsx`)
   - List providers with status indicators
   - Add/update/remove API keys
   - Show validation status
   - Display usage stats

### Phase 4: Billing & Subscription
1. **Usage Tracking Service** (`electron/services/usage-tracker.ts`)
   - Persist usage to disk
   - Sync with NPE-API for cloud billing
2. **Tier Access Hook** (`apps/web/src/hooks/useTierAccess.ts`)
   - Check user tier from AuthContext
   - Gate cloud LLM access by subscription level
3. **Upgrade Prompts**
   - Show modal when hitting quota
   - Link to Stripe checkout

---

## Testing Notes

### Test Providers (when keys configured):
```bash
# Test Cloudflare AI
curl -X POST http://localhost:3003/api/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"@cf/meta/llama-3.1-8b-instruct","prompt":"Hello"}'

# Test OpenRouter
curl -X POST http://localhost:3003/api/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-3.5-sonnet","prompt":"Hello"}'

# Test Together
curl -X POST http://localhost:3003/api/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"together/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo","prompt":"Hello"}'
```

### Test Secure Storage (in Electron):
```javascript
// In renderer via preload
const providers = await window.electronAPI.aiConfig.getProviders();
console.log(providers); // Shows configured/encrypted status

// Set a key
await window.electronAPI.aiConfig.setApiKey('openrouter', 'sk-or-...');

// Validate
const result = await window.electronAPI.aiConfig.validateKey('openrouter');
console.log(result); // { valid: true/false, error?: string }
```

### Dev Mode
- Book Studio auth skipped unless `JWT_SECRET` env var set
- Secure storage falls back to plaintext if safeStorage unavailable
- All providers accessible in dev mode

---

## Architecture Notes

### Provider Priority (Fallback Router)
1. **Ollama** - Local, free, fastest if available
2. **Together** - Fast, cheap open-source models
3. **Cloudflare** - Edge inference, free tier
4. **OpenRouter** - Aggregator with many options
5. **OpenAI** - Premium fallback
6. **Anthropic** - Premium fallback

### Secure Storage Flow
1. UI calls `aiConfig.setApiKey(provider, key)`
2. IPC handler validates key format
3. `SecureAPIKeyStorage` encrypts with `safeStorage`
4. Encrypted key written to `~/.humanizer/secure/api-keys.enc.json`
5. On retrieval, key is decrypted and cached in memory

### Cost Tracking Flow
1. LLM provider makes successful call
2. `recordUsage()` called with model + tokens
3. Cost calculated from `MODEL_PRICING` table
4. Usage stored in memory (30-day retention)
5. IPC exposes `getUsage()` for UI

---

## Next Session

**Start with:**
1. Create `ApiKeySettings.tsx` component (Phase 3.2)
2. Begin Phase 4.1 (usage tracking persistence)

**Key files to read:**
- `electron/ipc/ai-config.ts` (understand IPC interface)
- `electron/preload/types/core.ts` (TypeScript types)
- `apps/web/src/components/settings/` (existing settings patterns)

---

## Completed Phases Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 1.1 | Database schema migration | ✅ |
| 1.2 | JWT auth middleware | ✅ |
| 1.3 | Route auth updates | ✅ |
| 1.4 | WebSocket authentication | ✅ |
| 1.5 | API client auth headers | ✅ |
| 1.6 | JWT secret configuration | ✅ |
| 2.1 | Cloud LLM providers | ✅ |
| 2.2 | Model router enhancement | ✅ |
| 2.3 | Fallback router | ✅ |
| 2.4 | Cost tracking | ✅ |
| 3.1 | Secure API key storage | ✅ |
| 3.2 | API key settings UI | ⏳ |
| 3.3 | IPC handlers | ✅ |
| 3.4 | Preload bridge | ✅ |
| 4.1 | Usage tracking service | ⏳ |
| 4.2 | Tier access hook | ⏳ |
| 4.3 | Upgrade prompts | ⏳ |

**Overall: ~75% complete**

---

**End of Handoff**
