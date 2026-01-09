---
description: Run CSS compliance and size audit
---

Run the stylist-agent quick scan commands to check for CSS violations and file sizes.

## Size Audit

```bash
# CSS file sizes
echo "=== CSS FILE SIZES ==="
find apps/web/src -name "*.css" -exec ls -lh {} \; 2>/dev/null | sort -k5 -rh

# Line counts
echo "=== CSS LINE COUNTS ==="
find apps/web/src -name "*.css" -exec wc -l {} \; 2>/dev/null | sort -rn
```

## Compliance Audit

```bash
# Count inline styles in TSX
echo "=== INLINE STYLES IN TSX ==="
grep -r "style={{" --include="*.tsx" apps/web/src 2>/dev/null | wc -l

# Hardcoded hex colors in CSS
echo "=== HARDCODED HEX IN CSS ==="
grep -rE "#[0-9a-fA-F]{3,8}" --include="*.css" apps/web/src 2>/dev/null | wc -l

# Hardcoded hex in TSX
echo "=== HARDCODED HEX IN TSX ==="
grep -rE "color:\s*['\"]#|background:\s*['\"]#" --include="*.tsx" apps/web/src 2>/dev/null | wc -l
```

## After Running

Provide summary:

### File Size Status
- **Critical**: [files >200KB]
- **Warning**: [files 50-200KB]
- **OK**: [count of files under limits]

### Compliance Violations
- Inline styles: [count]
- Hardcoded hex (CSS): [count]  
- Hardcoded hex (TSX): [count]

### Top 5 Offenders
List the files with most violations.

If CSS file is over 100KB, recommend: "This CSS file cannot be read fully by Claude Code. Run `/audit-files` and consider immediate modularization."
