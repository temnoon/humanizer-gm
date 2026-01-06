# Technical Debt Tracker

Last Updated: 2026-01-06
Total Items: 7

## FALLBACK POLICY (ESTABLISHED January 6, 2026)

**Principle**: Operations must fail explicitly, not silently degrade.

### Production Fallbacks (FORBIDDEN)

The following patterns are **BANNED** from production code:

1. **Silent API fallbacks**: `try semantic catch { use text }` → **NO**
2. **Default empty collections without state**: `data || []` → **NO**
3. **Storage backend fallbacks**: `xanadu || localStorage` → **NO**
4. **Operation degradation as success**: `success: true` for partial failure → **NO**

### Development Fallbacks (ALLOWED WITH GUARDS)

Acceptable **ONLY** with explicit dev-mode check:

```typescript
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  console.warn('[DEV] Using fallback...');
  return fallbackImpl();
}
throw new Error('Production path requires X');
```

### Why This Matters (User's Words)

> "The user cannot be fooled. This will be released as open source, so any LLM 'tricks' where results that 'seem' to work will doom the perception of the software by eroding trust that our front-end claims are not doing what they say they are."

---

## Production Readiness Checklist

Before shipping Book Making MVP:

- [x] DEBT-001 fixed (commit 2a00f23): Remove semantic→text fallback
- [x] DEBT-002 fixed (commit 2a00f23): Validate content before saving
- [x] DEBT-003 fixed (commit 2a00f23): Show error in UI for full content load
- [x] P1 pyramid chunk fix (commit 1755866): Use conversation-wide chunk index
- [x] P2 bookType persistence (commit 1755866): Paper vs book survives reload
- [x] P0 AUIContext type errors (commit ddc2b38): Build passes cleanly
- [ ] Zero silent fallbacks in book-making pipeline
- [ ] All user operations return explicit success/error states
- [ ] Error messages include actionable next steps
- [ ] localStorage only used for UI preferences (not book data)
- [ ] Health check tool can diagnose all common failure modes

---

## Critical Anti-Pattern: Silent Fallback Degradation

**Priority**: URGENT - This pattern silently compromises book content quality without user notification.

---

## By Severity

### BLOCKING (Prevents Milestone Completion)

#### DEBT-001: Silent Semantic Search Fallback
- **Location**: `apps/web/src/lib/aui/tools.ts:969-1010`
- **Type**: silent-error
- **Severity**: BLOCKING
- **Blocks**: Cloud Archives, Book Making MVP
- **Created**: Unknown (existing codebase)
- **Effort**: medium (2-4 hours)
- **Description**: `executeSearchArchive()` silently falls back from semantic to text search on failure
- **Current Behavior**:
  1. Tries semantic search via `/api/embeddings/search/messages`
  2. On failure, falls back to `/api/conversations?search=...`
  3. Text search returns conversation METADATA only (no message content)
  4. Returns fake content: `[Conversation: ${title}] - Use semantic search for full message content`
  5. Harvest tools save this broken data to passages
  6. User's book contains placeholder text instead of real content
- **Why Problematic**: Users unknowingly create books with broken/empty passages
- **Fix**:
  ```typescript
  if (!response.ok) {
    return {
      success: false,
      error: 'Semantic search failed. Embeddings may not be built yet. Use check_archive_health to diagnose.',
      teaching: {
        whatHappened: 'Semantic search requires embeddings to be built',
        guiPath: ['Archive panel', 'Explore tab', 'Build Embeddings button'],
        why: 'Run build_embeddings tool to enable semantic search'
      }
    };
  }
  ```

#### DEBT-002: Harvest Tool Saves Degraded Content
- **Location**: `apps/web/src/lib/aui/tools.ts:3052-3158`
- **Type**: silent-error
- **Severity**: BLOCKING
- **Blocks**: Book Making MVP
- **Created**: Unknown (existing codebase)
- **Effort**: small (1-2 hours)
- **Description**: `executeHarvestArchive()` blindly saves search results without validating content presence
- **Current Behavior**:
  1. Calls `executeSearchArchive()` which may return degraded text results
  2. Adds passages with `content: result.content` without validation
  3. If content is placeholder text, passages are corrupted
  4. No warning shown to user
- **Why Problematic**: Book passages contain worthless placeholder text like `[Conversation: Title] - Use semantic search for full message content`
- **Fix**:
  ```typescript
  // Before adding passage, validate content
  if (result.content.startsWith('[Conversation:') || result.content.includes('Use semantic search')) {
    return {
      success: false,
      error: 'Search returned conversation metadata instead of content. Build embeddings first.',
      data: { searchType: data.searchType },
    };
  }
  ```

#### DEBT-003: HarvestQueuePanel Full Content Load Fails Silently
- **Location**: `apps/web/src/components/tools/HarvestQueuePanel.tsx:74-108`
- **Type**: silent-error
- **Severity**: BLOCKING
- **Blocks**: Book Making MVP
- **Created**: Unknown (existing codebase)
- **Effort**: small (1 hour)
- **Description**: PassageCard tries to load full conversation on expand but silently fails if API error
- **Current Behavior**:
  1. User clicks "Load full conversation"
  2. Fetches `/api/conversations/${conversationId}`
  3. If 404 or error, just logs warning to console
  4. User sees truncated indexed text forever
  5. No error message shown in UI
- **Why Problematic**: Users don't know if the full content is missing or if fetch failed
- **Fix**:
  ```typescript
  } catch (err) {
    console.warn('[PassageCard] Failed to load full content:', err);
    // SHOW ERROR TO USER
    setFullContent(`[Error loading full conversation: ${err.message}. The indexed text shown above may be all that's available.]`);
  }
  ```

---

### LIMITING (Reduces Capability or Performance)

#### DEBT-004: Default Empty Arrays/Objects Mask Missing Data
- **Location**: Multiple files (see grep results)
- **Type**: fallback
- **Severity**: LIMITING
- **Blocks**: Data Quality Assurance
- **Created**: Pattern throughout codebase
- **Effort**: large (8+ hours to audit and fix all instances)
- **Description**: Pattern of `|| []` and `|| {}` returns empty defaults instead of signaling missing data
- **Examples**:
  - `apps/web/src/lib/aui/tools.ts:713`: `context.activeProject.chapters || context.activeProject.drafts?.chapters || []`
  - `apps/web/src/lib/aui/tools.ts:979`: `(data.conversations || []).slice(0, limit)`
  - `apps/web/src/lib/aui/tools.ts:1016`: `(data.results || [])`
  - `apps/web/src/lib/bookshelf/BookshelfContext.tsx:370`: `(book.personaRefs || [])`
  - `apps/web/src/lib/bookshelf/BookshelfContext.tsx:756`: `chapter?.versions || []`
- **Why Problematic**:
  - Makes it impossible to distinguish "no data exists" from "data fetch failed"
  - Downstream code treats empty results as legitimate
  - Users see empty lists without knowing why
- **Fix Strategy**:
  1. Audit each `|| []` / `|| {}` usage
  2. Determine if it's masking a potential error
  3. For data operations, return explicit error states
  4. For display operations, show "No data" vs "Failed to load data"
- **Recommended Approach**:
  ```typescript
  // BEFORE
  const results = (data.results || []).filter(...)

  // AFTER
  if (!data.results) {
    return { success: false, error: 'Search returned no results field. API may have changed.' };
  }
  const results = data.results.filter(...)
  ```

#### DEBT-005: Optional Chaining Silences Undefined Access
- **Location**: Multiple files (see grep results)
- **Type**: fallback
- **Severity**: LIMITING
- **Blocks**: Error Detection
- **Created**: Pattern throughout codebase
- **Effort**: large (8+ hours)
- **Description**: Excessive `?.` chaining returns undefined instead of signaling structural problems
- **Examples**:
  - `apps/web/src/components/tools/HarvestQueuePanel.tsx:62`: `passage.curation?.status || 'candidate'`
  - `apps/web/src/components/tools/HarvestQueuePanel.tsx:64-66`: Three `?.` chains for conversation metadata
  - `apps/web/src/lib/aui/tools.ts:3569`: `context.getPassages?.() || []`
- **Why Problematic**:
  - Masks type mismatches and schema changes
  - Makes debugging harder (where did undefined come from?)
  - Can cascade into downstream errors far from root cause
- **Fix Strategy**:
  1. For critical paths (book making, harvest), validate structure explicitly
  2. Add type guards at API boundaries
  3. Use discriminated unions for success/error states
- **Recommended Pattern**:
  ```typescript
  // BEFORE
  const status = passage.curation?.status || 'candidate';

  // AFTER
  if (!passage.curation) {
    console.warn('[Harvest] Passage missing curation metadata:', passage.id);
  }
  const status = passage.curation?.status ?? 'candidate'; // Use ?? for intentional defaults
  ```

---

### COSMETIC (Polish, Not Critical)

#### DEBT-006: Try/Catch Blocks That Only Log
- **Location**: `apps/web/src/lib/aui/tools.ts:196-207`
- **Type**: silent-error
- **Severity**: COSMETIC
- **Blocks**: Developer Experience
- **Created**: Unknown
- **Effort**: small (30 minutes)
- **Description**: `parseToolUses()` catches JSON parse errors but only logs warning
- **Current Behavior**:
  ```typescript
  } catch (e) {
    console.warn('Failed to parse tool JSON:', paramsStr, e);
  }
  ```
- **Why Problematic**:
  - Tool invocations fail silently
  - Users see no error, wonder why tool didn't execute
  - Developer has to check console
- **Fix**: Return parse errors to caller so AUI can show user what went wrong
  ```typescript
  } catch (e) {
    uses.push({
      name,
      params: {},
      raw,
      parseError: e instanceof Error ? e.message : 'JSON parse failed'
    });
  }
  ```

#### DEBT-007: Missing Error Handling for sqlite-vec Load
- **Location**: `electron/archive-server/services/embeddings/EmbeddingDatabase.ts:81-101`
- **Type**: silent-error
- **Severity**: COSMETIC
- **Blocks**: Semantic Search Setup Experience
- **Created**: Unknown
- **Effort**: small (1 hour)
- **Description**: Constructor tries multiple paths for sqlite-vec but doesn't inform user of consequences if all fail
- **Current Behavior**:
  - Falls back through multiple load attempts
  - Only logs warnings to console
  - `vecLoaded` flag set to false
  - Database continues to operate but semantic search won't work
- **Why Problematic**:
  - User tries to build embeddings
  - Gets cryptic errors later when vec operations fail
  - No clear indication at startup that semantic search is unavailable
- **Fix**: Throw descriptive error or surface warning to UI
  ```typescript
  if (!this.vecLoaded) {
    const errorMsg = 'sqlite-vec extension failed to load. Semantic search will not be available. Ensure sqlite-vec is properly installed.';
    console.error('[EmbeddingDatabase]', errorMsg);
    // Option 1: Throw and prevent database creation
    // throw new Error(errorMsg);
    // Option 2: Surface to health check
    this.healthWarning = errorMsg;
  }
  ```

---

## By Milestone

### Local Development (MVP)
- DEBT-006 (cosmetic): Tool parse errors only logged
- DEBT-007 (cosmetic): sqlite-vec load warnings buried

### Book Making MVP (CURRENT MILESTONE)
- **DEBT-001** (BLOCKING): Silent semantic fallback corrupts passages
- **DEBT-002** (BLOCKING): Harvest saves degraded content
- **DEBT-003** (BLOCKING): Full content load fails silently

### Cloud Archives
- **DEBT-001** (BLOCKING): Must fix before multi-user (data quality)
- DEBT-004 (limiting): Empty defaults mask errors across API boundaries
- DEBT-005 (limiting): Optional chaining hides schema issues

---

## Patterns to Track

### Recurring: Default Empty Collections
**Locations**: 31 instances found via grep
**Risk**: Makes debugging impossible, users see empty states without knowing why
**Action**: Audit each instance, convert critical paths to explicit error handling

### Recurring: Optional Chaining
**Locations**: 9+ instances in harvest/passage code
**Risk**: Cascading undefined errors, hard to debug
**Action**: Add validation at API boundaries, use discriminated unions

### Recurring: Silent Catch Blocks
**Locations**: JSON parsing, API calls, file operations
**Risk**: Operations fail invisibly
**Action**: Return errors to caller, show to user

---

## Immediate Actions (Next Session)

1. ✅ **DEBT-001 FIXED** (commit 2a00f23): Semantic→text fallback removed
2. ✅ **DEBT-002 FIXED** (commit 2a00f23): Content validation before saving
3. ✅ **DEBT-003 FIXED** (commit 2a00f23): UI error shown for full content load
4. **IN PROGRESS**: Complete Xanadu migration (localStorage → SQLite for book data)
5. **TODO**: Add ESLint rule to flag `|| []` in data operations
6. **TODO**: Audit all 97 instances of `|| []` / `|| {}` patterns

---

## Error Handling Philosophy (Proposed)

**Principle**: User-visible operations must never fail silently.

**Rules**:
1. **No silent fallbacks**: If primary operation fails, tell the user
2. **Distinguish states**: "No data" vs "Failed to load" vs "Not available yet"
3. **Actionable errors**: Every error must suggest next step
4. **Fail early**: Catch problems at API boundary, not deep in rendering
5. **Use `teaching` field**: All AUI errors include `teaching.whatHappened` + `teaching.why`

**Pattern**:
```typescript
// BAD
try {
  const data = await api();
  return data.results || [];
} catch (e) {
  return [];
}

// GOOD
try {
  const response = await api();
  if (!response.ok) {
    return {
      success: false,
      error: `API returned ${response.status}: ${response.statusText}`,
      teaching: {
        whatHappened: 'The operation failed because...',
        guiPath: ['Where to go fix it'],
        why: 'Why this matters to the user'
      }
    };
  }
  const data = await response.json();
  if (!data.results) {
    return { success: false, error: 'API returned no results field' };
  }
  return { success: true, data: data.results };
} catch (e) {
  return {
    success: false,
    error: e instanceof Error ? e.message : 'Unknown error',
    teaching: {
      whatHappened: 'Operation failed unexpectedly',
      why: 'This could mean the service is unavailable or data is corrupted'
    }
  };
}
```

---

## Success Criteria

- [ ] All BLOCKING debt items fixed before Book Making MVP ships
- [ ] Zero instances of "silent fallback to degraded data" in book pipeline
- [ ] All user-facing operations return explicit success/error states
- [ ] Error messages include actionable next steps
- [ ] Health check tool can diagnose all common failure modes

---

## Notes

- This audit focused on **book-making pipeline** as requested
- Silent fallback anti-pattern is pervasive and urgent
- Pattern originated from defensive programming but creates worse UX than explicit errors
- Recommend: Add linting rule to flag `|| []` in data operations
- Consider: Discriminated unions for all API responses (`{ success: true, data } | { success: false, error }`)
