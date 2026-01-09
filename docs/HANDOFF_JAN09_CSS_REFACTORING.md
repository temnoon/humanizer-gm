# Handoff: CSS Refactoring - Ready to Extract

**Date**: January 9, 2026
**Status**: Phase 1-2 COMPLETE. Phase 3 (Extraction) READY TO START.
**Predecessor**: HANDOFF_JAN09_INFRASTRUCTURE_AUDIT.md

---

## Current State

### Completed (by Claude Desktop)

| Phase | Status | Details |
|-------|--------|---------|
| Phase 1: Audit | COMPLETE | `AUDIT_RESULTS_JAN09.md` has line-by-line breakdown |
| Phase 2: Directories | COMPLETE | `styles/` and `studio/` directories created |
| Documentation | COMPLETE | Plans, agent, skills all written |

### Files Still At Original Size

| File | Lines | Target |
|------|-------|--------|
| `apps/web/src/index.css` | 18,546 | ~50 (imports only) |
| `apps/web/src/Studio.tsx` | 4,811 | ~150 (shell only) |

### Uncommitted Changes

```
?? .claude/agents/modularizer-agent.md
?? .claude/commands/
?? .claude/refactoring/
?? .claude/skills/
?? docs/HANDOFF_JAN09_INFRASTRUCTURE_AUDIT.md
M  .claude/agents/stylist-agent.md
```

---

## CSS Extraction Order (From Audit)

| Priority | Section | Lines | Target File |
|----------|---------|-------|-------------|
| 1 | THEME SYSTEM | 6416-6631 (~215) | `styles/features/theme.css` |
| 2 | MARKDOWN STYLES | 8510-8854 (~344) | `styles/features/markdown.css` |
| 3 | BUTTONS | 100-143 (~43) | `styles/components/buttons.css` |
| 4 | AUI CHAT | 5259-5921 (~662) | `styles/features/aui.css` |
| 5 | ELECTRON | 16487-16568 (~81) | `styles/utilities/electron.css` |

---

## Next Steps

### 1. Commit Infrastructure (Optional but Recommended)

```bash
git add .claude/agents/modularizer-agent.md .claude/commands/ .claude/refactoring/ .claude/skills/ docs/HANDOFF_JAN09_INFRASTRUCTURE_AUDIT.md
git commit -m "refactor: Add modularization infrastructure (agent, skills, plans)"
```

### 2. Extract Theme System (FIRST SAFE EXTRACTION)

The audit recommends starting with THEME SYSTEM (lines 6416-6631):
- Self-contained section
- Uses CSS variables
- ~215 lines
- Lowest risk of cascade breaks

```bash
# Extract lines 6416-6631 from index.css
sed -n '6416,6631p' apps/web/src/index.css > apps/web/src/styles/features/theme.css

# Add import to index.css (at appropriate position)
# Then remove the extracted lines from index.css

# Build to verify
cd apps/web && npm run build
```

### 3. Repeat for Each Section

After each extraction:
1. Add `@import` to index.css
2. Remove extracted lines from index.css
3. Run `npm run build`
4. Visual test
5. Commit: `refactor(css): extract theme.css from index.css`

---

## Key Files to Read

| File | Purpose |
|------|---------|
| `.claude/refactoring/AUDIT_RESULTS_JAN09.md` | Complete section breakdown with line numbers |
| `.claude/refactoring/CSS_MODULARIZATION_PLAN.md` | Full extraction methodology |
| `.claude/agents/modularizer-agent.md` | New agent for file size governance |

---

## Directory Structure (Ready)

```
apps/web/src/
├── styles/                 (CREATED - empty)
│   ├── base/
│   ├── layout/
│   ├── components/
│   ├── features/          <- theme.css goes here
│   └── utilities/
├── studio/                 (CREATED - empty)
│   ├── hooks/
│   ├── components/
│   └── contexts/
├── index.css               (18,546 lines - TO BE REDUCED)
└── Studio.tsx              (4,811 lines - LATER PHASE)
```

---

## Success Criteria

- [ ] Each extracted CSS file < 200 lines
- [ ] index.css becomes imports-only (~50 lines)
- [ ] Build passes after each extraction
- [ ] No visual regressions
- [ ] All files readable by Claude Code

---

## Risk Notes

1. **CSS Cascade Order**: Extract in the order listed - later sections may depend on earlier ones
2. **Media Queries**: Some sections contain embedded `@media` - keep them with their parent section
3. **Dark Mode**: Theme section includes dark mode variables - extract together

---

**Ready for extraction. Start with THEME SYSTEM (lines 6416-6631).**
