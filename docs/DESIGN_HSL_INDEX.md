# HSL-Based Button Contrast System - Complete Research Package

**Status**: Research Complete and Ready for Review  
**Date**: January 9, 2026  
**Recommendation**: Implement Option A

---

## Document Index

### Start Here

1. **DESIGN_HSL_README.md** (Main Overview)
   - What this solves
   - Key benefits
   - Research findings
   - Next steps
   - FAQ

### For Different Audiences

2. **DESIGN_HSL_QUICK_REFERENCE.md** (Developers)
   - Minimal code changes
   - Find & replace commands
   - Verification checklist
   - One-liner summary

3. **DESIGN_HSL_CONTRAST_SUMMARY.md** (Decision Makers)
   - Executive summary
   - Key decisions made
   - Risk assessment
   - Timeline and effort

4. **DESIGN_HSL_CONTRAST_PROPOSAL.md** (Technical Deep Dive)
   - Full technical proposal
   - Two implementation options
   - CSS color-contrast() research
   - Manual HSL calculation approach

5. **DESIGN_CONTRAST_ANALYSIS.md** (Visual Comparison)
   - Before/after contrast ratios
   - Current hardcoded approach (problems)
   - Proposed HSL solution (benefits)
   - Before vs. after code examples

6. **DESIGN_HSL_ARCHITECTURE.md** (System Design)
   - System architecture diagram
   - Data flow examples (Sepia & Dark themes)
   - Variable inheritance chain
   - Before vs. after architecture
   - File structure and computed values

7. **DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md** (Step-by-Step)
   - Exact line-by-line changes
   - All 6 files documented
   - Verification commands
   - Testing checklist
   - Rollback plan

---

## Reading Guide by Role

### I'm a Designer/Brand Manager
Read in this order:
1. DESIGN_HSL_README.md - Understand the problem and solution
2. DESIGN_HSL_CONTRAST_SUMMARY.md - See the decisions and impact
3. DESIGN_CONTRAST_ANALYSIS.md - Visualize before/after

### I'm a Developer Implementing This
Read in this order:
1. DESIGN_HSL_QUICK_REFERENCE.md - Get the gist
2. DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md - Do the work
3. DESIGN_HSL_ARCHITECTURE.md - Understand how it fits together

### I'm a Tech Lead/Architect
Read in this order:
1. DESIGN_HSL_README.md - Overall approach
2. DESIGN_HSL_CONTRAST_PROPOSAL.md - Technical options
3. DESIGN_HSL_ARCHITECTURE.md - System design
4. DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md - Effort estimate

### I'm Doing Code Review
Read in this order:
1. DESIGN_HSL_QUICK_REFERENCE.md - What changed
2. DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md - Check against this
3. DESIGN_CONTRAST_ANALYSIS.md - Verify contrast ratios

### I'm Writing WCAG Tests
Read in this order:
1. DESIGN_CONTRAST_ANALYSIS.md - Expected ratios per theme
2. DESIGN_HSL_ARCHITECTURE.md - Computed values matrix
3. DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md - Testing checklist

---

## Key Findings Summary

1. **Problem**: Hardcoded white text on mid-tone accent backgrounds
   - Creates contrast issues in some themes
   - Violates CSS compliance rules
   - Requires three different accent colors (inconsistent)

2. **Research**: CSS `color-contrast()` function not yet ready
   - No browser support
   - Can't use this year
   - Will be available 2026+

3. **Solution**: HSL decomposition
   - Separate accent into hue (38), saturation (90%), lightness (per theme)
   - Text color from semantic system (always correct)
   - Single source of truth for brand color

4. **Impact**: No breaking changes
   - CSS-only modification
   - Backwards compatible
   - ~50-70 lines across 6 files
   - 45 minutes implementation + testing

---

## Files That Change

| File | Type | Size |
|------|------|------|
| `/packages/ui/styles/tokens.css` | Modify | +3 lines |
| `/apps/web/src/styles/features/theme.css` | Modify | +12 lines |
| `/apps/web/src/styles/features/views.css` | Modify | 15-20 edits |
| `/apps/web/src/styles/features/aui.css` | Modify | 8-12 edits |
| `/apps/web/src/styles/features/book-nav.css` | Modify | 5-8 edits |
| `/apps/web/src/styles/features/panels.css` | Modify | 3-5 edits |

---

## Contrast Improvement

Before and after WCAG AA compliance:

| Theme | Before Ratio | After Ratio | Status |
|-------|---|---|---|
| Sepia | 6.0:1 | 7.8:1 | Improved |
| Light | 8.1:1 | 8.1:1 | Same (already good) |
| Dark | 6.5:1 | 8.5:1 | Improved |

All after values exceed WCAG AAA (7:1).

---

## Decision Made

**Chose Option A**: Explicit Lightness + Theme-Specific Text Color

**Why**:
- More maintainable than automatic darkening
- Easier to audit for WCAG compliance
- Works in all browsers today
- Aligns with existing HSL token system

---

## Next Steps

1. **Review**: Stakeholder review of this proposal
2. **Approve**: Confirm approach with code owner
3. **Implement**: Follow DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md
4. **Test**: Verify in all 3 themes, run WCAG checker
5. **Merge**: Deploy (low risk - CSS only)

---

## Questions?

| Question | Answer Location |
|----------|-----------------|
| What problem does this solve? | DESIGN_HSL_README.md |
| How do I implement this? | DESIGN_HSL_QUICK_REFERENCE.md |
| What are the design decisions? | DESIGN_HSL_CONTRAST_SUMMARY.md |
| What are the technical details? | DESIGN_HSL_CONTRAST_PROPOSAL.md |
| Show me before/after comparison | DESIGN_CONTRAST_ANALYSIS.md |
| How does the system work? | DESIGN_HSL_ARCHITECTURE.md |
| Line-by-line implementation? | DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md |

---

## Document Statistics

- **Total documents**: 7 research + design docs
- **Total lines**: ~2,500+ lines of detailed documentation
- **Time to read all**: ~30-45 minutes
- **Time to implement**: ~45 minutes
- **Time to test**: ~15 minutes

---

## Approval Checklist

- [ ] Reviewed DESIGN_HSL_README.md
- [ ] Reviewed DESIGN_HSL_CONTRAST_SUMMARY.md (for decision makers)
- [ ] Reviewed DESIGN_HSL_IMPLEMENTATION_CHECKLIST.md (for effort)
- [ ] Confirmed Option A approach aligns with brand intent
- [ ] Approved to proceed with implementation

---

**Research Status**: COMPLETE - Ready for implementation

For questions or clarifications, refer to the appropriate document above.

