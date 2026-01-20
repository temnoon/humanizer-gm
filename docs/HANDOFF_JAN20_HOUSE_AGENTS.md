# Handoff: House Agents & Security Fixes

**Date:** January 20, 2026
**Branch:** main
**Status:** Complete - Pushed to origin

---

## Summary

Registered 5 house agents for book production, audited 167 silent catch blocks (fixed 3), and hardened URL sanitization.

---

## Commits

| Hash | Description |
|------|-------------|
| `54e07f6` | fix: harden URL sanitization with whitelist approach |
| `acc78b1` | feat: register house agents and fix critical silent catches |
| `708951d` | feat: UCG platform adapters, catuskoti filter system |
| `826fd1e` | feat: multi-user security hardening and WCAG accessibility |

---

## House Agents Registered

All 5 book production agents now active in `electron/agents/index.ts`:

```typescript
await registry.register(getModelMasterAgent());
await registry.register(getProjectManagerAgent());
await registry.register(getCuratorAgent());
await registry.register(getBuilderAgent());
await registry.register(getHarvesterAgent());
await registry.register(getReviewerAgent());
```

### Agent Responsibilities

| Agent | Purpose |
|-------|---------|
| Project Manager | Lifecycle orchestration (planning → mastering) |
| Curator | Quality assessment, gem discovery, redundancy detection |
| Builder | Chapter composition, transitions, voice consistency |
| Harvester | Archive search, connection discovery, source diversity |
| Reviewer | Quality reviews, humanization checks, signoff |

---

## Silent Catch Audit

**Total reviewed:** 167 instances
**Fixed:** 3 critical issues
**Acceptable:** 164 (fallbacks, retries, documented)

### Fixed

| File | Line | Issue |
|------|------|-------|
| `ToolsPanel.tsx` | 112-113 | Personas/styles load failures |
| `AUIContext.tsx` | 709 | Archive conversation failures |
| `AdminConfigPanel.tsx` | 61 | Encryption status failures |

### Categories (Acceptable)

- `response.json().catch(() => ({}))` - JSON parsing fallbacks
- localStorage guards returning defaults
- Polling errors that retry automatically
- Service availability checks returning false

---

## URL Sanitization Hardening

**File:** `apps/web/src/lib/book-studio/sanitize.ts`

### Changes

1. **Whitelist approach** - Only http/https allowed
2. **Blocked protocols** - data:, blob:, file:, vbscript:, javascript:
3. **Development logging** - Blocked URLs logged for debugging
4. **New function** - `sanitizeImageUrl()` for image src validation

### Security Rationale

- data: URIs can inject HTML/scripts
- blob: URIs contain arbitrary content
- file: could access local filesystem
- Logging aids security auditing

---

## Remaining Tasks

| Task | Effort | Description |
|------|--------|-------------|
| BookEditor TODOs | 4h | Transform API, selection toolbar, metrics sidebar |
| UCG Import TODOs | 3h | Format inspection, embedding generation, stats |

---

## Context Restore

Search ChromaDB for:
- `"house-agents architecture jan-2026"`
- `"security sanitization jan-2026"`
- `"handoff jan-2026 house-agents"`
