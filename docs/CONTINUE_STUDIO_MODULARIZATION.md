# Continue Studio.tsx Modularization

**Copy this entire prompt to restart Claude Code and continue the refactoring.**

---

## Context

I'm modularizing `apps/web/src/Studio.tsx` which was 4,811 lines. So far I've reduced it to 1,955 lines (59.4%). The work is documented in `docs/HANDOFF_JAN09_STUDIO_MODULARIZATION.md`.

## Current State

Studio.tsx has 3 remaining sections:

1. **WORKSPACE** (lines 74-1078, ~1004 lines) - Main editor panel with edit mode, navigation, keyboard shortcuts
2. **AUI CHAT** (lines 1079-1454, ~375 lines) - Floating chat bubble component
3. **STUDIO** (lines 1455-1955, ~500 lines) - StudioContent orchestrator (KEEP THIS)

## Task

Complete the Studio.tsx modularization:

1. **Extract WORKSPACE** (~1004 lines) to `components/workspace/MainWorkspace.tsx`
   - This is the main content editing panel
   - Uses hooks: useBuffers, useTheme, useBookshelf, useSplitMode, useHighlights
   - Has keyboard shortcuts (Cmd+E, Cmd+S, Cmd+B, Cmd+1/2/3)
   - Update workspace/index.ts to export it
   - Update Studio.tsx to import from workspace module

2. **Extract AUI CHAT** (~375 lines) to `components/aui/AUIFloatingChat.tsx`
   - Floating draggable chat bubble (different from existing AUIChatTab.tsx)
   - Uses useBookshelf, executeAllTools, buildAUIContext
   - Update aui module exports (create index.ts if needed)
   - Update Studio.tsx to import it

3. **Clean up Studio.tsx imports**
   - Remove imports only used by extracted components
   - Final Studio.tsx should be ~500 lines (just StudioContent + providers)

## Extraction Pattern

```bash
# 1. Find section boundaries
grep -n "^// ═" apps/web/src/Studio.tsx

# 2. Create new file with imports header, then append component
sed -n 'START,ENDp' apps/web/src/Studio.tsx >> target.tsx

# 3. Add export keywords
sed -i '' 's/^function ComponentName/export function ComponentName/' target.tsx
sed -i '' 's/^interface ComponentProps/export interface ComponentProps/' target.tsx

# 4. Update module index.ts
# 5. Update Studio.tsx imports
# 6. Remove inline definition
sed -i '' 'START,ENDd' apps/web/src/Studio.tsx

# 7. Build and verify
npm run build

# 8. Commit
git add -A && git commit -m "refactor(studio): extract ComponentName to path"
```

## Success Criteria

- [ ] Studio.tsx is ~500 lines (just StudioContent orchestrator)
- [ ] All extracted components build successfully
- [ ] No runtime errors
- [ ] Update handoff document with completion status

## Commands

```bash
cd /Users/tem/humanizer_root/humanizer-gm
npm run build  # Verify build
wc -l apps/web/src/Studio.tsx  # Check line count
```

---

**Start by reading the handoff: `docs/HANDOFF_JAN09_STUDIO_MODULARIZATION.md`**
