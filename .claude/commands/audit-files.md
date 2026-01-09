---
description: Run file size audit to identify files needing modularization
---

Run a comprehensive audit of file sizes in the project. Identify files that exceed Claude Code's readable thresholds.

## Audit Commands

Execute these in order:

```bash
# 1. Find all large CSS files (>20KB)
echo "=== CSS FILES OVER 20KB ===" 
find apps/web/src -name "*.css" -size +20k -exec ls -lh {} \; 2>/dev/null

# 2. Find all large TSX/TS files (>50KB)
echo "=== TSX/TS FILES OVER 50KB ==="
find apps/web/src -name "*.tsx" -o -name "*.ts" | xargs ls -lh 2>/dev/null | awk '$5 ~ /[0-9]+K/ { split($5,a,"K"); if(a[1]>50) print }'

# 3. Count lines in largest files
echo "=== LINE COUNTS (TOP 20) ==="
find apps/web/src -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \) -exec wc -l {} \; 2>/dev/null | sort -rn | head -20
```

## After Running

Summarize findings in this format:

### 🚨 Critical (Cannot be read by Claude Code)
| File | Size | Lines | Priority |
|------|------|-------|----------|

### ⚠️ Warning (Should be split soon)
| File | Size | Lines |
|------|------|-------|

### Recommended Actions
1. [Most urgent file] - [suggested split strategy]
2. [Second file] - [strategy]

If critical files exist, ask: "Should I invoke the modularizer-agent to create a split plan for [file]?"
