# Handoff: Books Tab Active Button Text Color Mystery

**Date**: January 10, 2026
**Status**: SOLVED
**Branch**: main

---

## The Mystery

Active buttons in BookProjectDetail (Sources/Thinking/Drafts tabs) showed WHITE text in sepia and light modes, making them unreadable on the light amber accent background. Dark mode worked correctly.

CSS changes to `.book-project__tab.active` were not affecting the text color, even with hardcoded hex colors and `!important` declarations.

---

## The Solution

**We were editing the wrong CSS class.**

DevTools inspection revealed the actual element used `.book-nav__tab--active` (BEM modifier syntax), NOT `.book-project__tab.active`.

| What We Thought | What It Actually Was |
|-----------------|----------------------|
| `.book-project__tab.active` in `books-tab.css` | `.book-nav__tab--active` in `book-nav.css` |

The culprit was in `book-nav.css` line 101:
```css
.book-nav__tab--active {
  background: var(--studio-accent);
  border-color: var(--studio-accent);
  color: white;  /* THE BUG */
}
```

---

## Files Fixed

### `apps/web/src/styles/features/book-nav.css`
- Line 101: `.book-nav__tab--active` - `color: white` → `color: var(--studio-text)`
- Line 227: `.book-nav__thinking-btn` - `color: white` → `color: var(--studio-text)`
- Line 380: `.book-nav__chapter-fill` - `color: white` → `color: var(--studio-text)`

### `apps/web/src/styles/features/books-tab.css`
- Cleaned up debug code (red outline, `!important`, theme-specific overrides)
- `.book-project__tab.active` now uses `color: var(--studio-text)`

---

## Lesson Learned

**Always inspect the actual element in DevTools first.** Class names can be similar but different:
- `.book-project__tab.active` (class + class)
- `.book-nav__tab--active` (BEM modifier)

The time spent editing the wrong CSS file could have been avoided with a 30-second DevTools inspection.

---

## Related Work (Same Session)

Successfully fixed with `color: var(--studio-text)`:
- Gallery view tabs (`views.css`)
- Social/Facebook view tabs and filters (`views.css`)
- User dropdown dark mode (`auth.css`)

---

**End of Handoff**
