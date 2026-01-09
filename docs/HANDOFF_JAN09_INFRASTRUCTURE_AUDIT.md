# HANDOFF: Infrastructure Audit & Claude Code Enhancement

**Date**: January 9, 2026
**From**: Claude Desktop Session (context exhausted during infrastructure research)
**To**: New Claude Desktop Session → Then Claude Code
**Priority**: P0 - Critical Infrastructure

---

## Executive Summary

A comprehensive Claude Code infrastructure overhaul was initiated to address:
1. **Critical file size violations** preventing Claude Code from reading key files
2. **New House Agent** (Modularizer) for ongoing file size governance
3. **New Skills** for file modularization, CSS compliance, and Claude Agent SDK
4. **Refactoring plans** for the two emergency files

**Status**: Infrastructure files CREATED, actual refactoring NOT YET EXECUTED.

---

## The Problem

Two files in `humanizer-gm` exceed Claude Code's direct-read limit (~100KB):

| File | Size | Lines (est.) | Impact |
|------|------|--------------|--------|
| `apps/web/src/index.css` | **418 KB** | ~12,000 | Cannot read; must grep fragments |
| `apps/web/src/Studio.tsx` | **184 KB** | ~5,000 | Cannot read; loses architectural context |

**Consequence**: Every time Claude Code needs to modify these files, it:
- Wastes tokens on failed read attempts
- Falls back to fragmented grep searches
- Loses holistic understanding of the code
- Makes changes without full context (risk of breaking things)

---

## What Was Created (Complete)

### New Agent: `.claude/agents/modularizer-agent.md`
- Guards file size thresholds (CSS: 200 lines, TSX: 300 lines)
- Provides split strategies for both CSS and React components
- Integrates with audit system
- REQUIRED signoff for any file split/merge operations

### New Skills (4):

| Location | Purpose |
|----------|---------|
| `.claude/skills/file-modularization/SKILL.md` | Patterns, thresholds, extraction algorithms |
| `.claude/skills/claude-agent-sdk/SKILL.md` | SDK migration guide (v0.2.2), new features |
| `.claude/skills/css-compliance/SKILL.md` | CSS variable enforcement, BEM naming |
| `.claude/skills/session-memory/SKILL.md` | ChromaDB session protocols |

### New Commands (2):

| Command | Purpose |
|---------|---------|
| `.claude/commands/audit-files.md` | Run file size audit across project |
| `.claude/commands/audit-css.md` | CSS compliance + size audit |

### Detailed Refactoring Plans:

| Document | Contents |
|----------|----------|
| `.claude/refactoring/CSS_MODULARIZATION_PLAN.md` | 6-phase plan with grep commands, target structure, import order |
| `.claude/refactoring/STUDIO_MODULARIZATION_PLAN.md` | 8-phase plan for React component extraction |

---

## What Needs To Be Done

### Phase 1: Audit (Claude Desktop - THIS SESSION)

Run these commands to understand the exact structure of the monolithic files:

```bash
# CSS Structure Analysis
cd ~/humanizer_root/humanizer-gm

# 1. Find all CSS custom properties (variables)
echo "=== CSS VARIABLES ===" 
grep -n ":root\|--[a-z]" apps/web/src/index.css | head -50

# 2. Find section comments (natural break points)
echo "=== SECTION COMMENTS ==="
grep -n "/\*.*\*/" apps/web/src/index.css | head -100

# 3. Count styles by selector prefix
echo "=== SELECTOR PREFIXES ==="
for prefix in book archive aui studio workspace tool btn form modal nav card; do
  count=$(grep -c "\.$prefix" apps/web/src/index.css 2>/dev/null || echo 0)
  echo "$prefix: $count occurrences"
done

# 4. Find @keyframes (easy first extraction)
echo "=== KEYFRAMES ==="
grep -n "@keyframes" apps/web/src/index.css

# 5. Find @media queries
echo "=== MEDIA QUERIES ==="
grep -n "@media" apps/web/src/index.css | wc -l
```

```bash
# Studio.tsx Structure Analysis

# 1. Find all function/component definitions
echo "=== COMPONENTS/FUNCTIONS ==="
grep -n "^function\|^const.*=.*=>\|^export function\|^export const" apps/web/src/Studio.tsx | head -50

# 2. Count hooks
echo "=== HOOK COUNTS ==="
echo "useState: $(grep -c 'useState' apps/web/src/Studio.tsx)"
echo "useEffect: $(grep -c 'useEffect' apps/web/src/Studio.tsx)"
echo "useCallback: $(grep -c 'useCallback' apps/web/src/Studio.tsx)"
echo "useMemo: $(grep -c 'useMemo' apps/web/src/Studio.tsx)"
echo "useContext: $(grep -c 'useContext' apps/web/src/Studio.tsx)"

# 3. Find type definitions
echo "=== TYPE DEFINITIONS ==="
grep -n "^type\|^interface\|^export type\|^export interface" apps/web/src/Studio.tsx

# 4. Count imports (complexity indicator)
echo "=== IMPORT COUNT ==="
grep -c "^import" apps/web/src/Studio.tsx
```

### Phase 2: Create Directory Structure (Claude Desktop)

Based on audit results, create the target directories:

```bash
# CSS modular structure
mkdir -p apps/web/src/styles/{base,layout,components,features,utilities}

# Studio component structure  
mkdir -p apps/web/src/studio/{hooks,components,contexts}
```

### Phase 3: Extract Safest Pieces First (Claude Code)

**CSS - Start with these (lowest risk)**:
1. `@keyframes` → `styles/utilities/animations.css`
2. CSS variables (`:root`) → `styles/base/variables.css`
3. Reset/normalize styles → `styles/base/reset.css`

**Studio.tsx - Start with these**:
1. Type definitions → `studio/types.ts`
2. Context provider → `studio/StudioContext.tsx`
3. Individual hooks → `studio/hooks/useXxx.ts`

### Phase 4: Incremental Migration (Claude Code)

After each extraction:
1. Run `npm run build` to verify no breaks
2. Visual test in dev mode
3. Commit with message: `refactor(css): extract [file] from index.css`

---

## Claude Agent SDK Updates (Reference)

The previous session researched SDK updates. Key findings:

**Package renamed**: `@anthropic-ai/claude-code` → `@anthropic-ai/claude-agent-sdk`

**New features available**:
- Structured outputs (beta) - guaranteed JSON schema conformance
- Interleaved thinking (beta) - reasoning between tool calls
- Web search tool - built-in search capability
- Files API (beta) - upload/reference files
- MCP connector (beta) - remote MCP server integration

**Action needed**: Verify `package.json` has correct dependency version.

---

## Files to Read for Context

Before starting audit, these files provide full context:

1. **Refactoring Plans** (read these first):
   - `.claude/refactoring/CSS_MODULARIZATION_PLAN.md`
   - `.claude/refactoring/STUDIO_MODULARIZATION_PLAN.md`

2. **New Agent**:
   - `.claude/agents/modularizer-agent.md`

3. **New Skills**:
   - `.claude/skills/file-modularization/SKILL.md`
   - `.claude/skills/claude-agent-sdk/SKILL.md`

4. **Project Context**:
   - `CLAUDE.md` (main project guide)
   - `TECHNICAL_DEBT.md` (existing debt tracking)

---

## Success Criteria

### For This Audit Session:
- [ ] Audit commands executed, output captured
- [ ] Directory structures created
- [ ] Extraction order prioritized based on actual file contents
- [ ] Any blockers or complications identified

### For Claude Code Session:
- [ ] First safe extractions completed (keyframes, variables)
- [ ] Build passes after each extraction
- [ ] No visual regressions
- [ ] Commit history shows incremental progress

### Overall Goal:
- [ ] All CSS files < 200 lines
- [ ] All TSX files < 300 lines
- [ ] Claude Code can read any project file directly
- [ ] Modularizer agent actively preventing future violations

---

## Prompt for Claude Code (After Audit)

Once audit is complete, use this prompt to initialize Claude Code:

```
I've completed an infrastructure overhaul for the humanizer-gm project. Please familiarize yourself with the new capabilities:

1. **New Agent**: Read `.claude/agents/modularizer-agent.md` - this agent now guards file sizes

2. **New Skills**: 
   - `.claude/skills/file-modularization/SKILL.md`
   - `.claude/skills/css-compliance/SKILL.md`
   - `.claude/skills/claude-agent-sdk/SKILL.md`

3. **Refactoring Plans** (CRITICAL):
   - `.claude/refactoring/CSS_MODULARIZATION_PLAN.md`
   - `.claude/refactoring/STUDIO_MODULARIZATION_PLAN.md`

4. **New Commands**: `/audit-files` and `/audit-css`

The audit revealed [INSERT AUDIT FINDINGS HERE].

Priority extraction order:
1. [Based on audit]
2. [Based on audit]
3. [Based on audit]

Begin with the safest extraction: [SPECIFIC FILE/SECTION].
```

---

## Notes from Previous Session

- The session ran out of context while creating infrastructure files
- All `.claude/` infrastructure files were successfully written
- The actual refactoring was NOT started
- Memory agent file is comprehensive (~500 lines) - shows the depth of infrastructure created
- CSS compliance skill already documents required variables

---

**End of Handoff**
