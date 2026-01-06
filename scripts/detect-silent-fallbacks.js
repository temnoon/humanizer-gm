#!/usr/bin/env node
/**
 * Silent Fallback Detection Script
 *
 * Detects potentially dangerous `|| []` and `|| {}` patterns in TypeScript/JavaScript files.
 * These patterns can mask data layer failures and corrupt book data.
 *
 * Usage:
 *   node scripts/detect-silent-fallbacks.js [path]
 *
 * Categories:
 *   - DATA_OPERATION: Operations on API/storage responses - MUST FIX
 *   - DISPLAY_DEFAULT: UI display defaults - OK
 *   - NEEDS_REVIEW: Ambiguous, needs human review
 *
 * Per FALLBACK POLICY in TECHNICAL_DEBT.md:
 *   - Production fallbacks FORBIDDEN
 *   - Development fallbacks ALLOWED with explicit `import.meta.env.DEV` guard
 */

const fs = require('fs');
const path = require('path');

const TARGET_DIR = process.argv[2] || 'apps/web/src';

// Patterns that indicate data operations (dangerous)
const DATA_PATTERNS = [
  /response\.\w+\s*\|\|\s*\[/g,
  /result\.\w+\s*\|\|\s*\[/g,
  /data\.\w+\s*\|\|\s*\[/g,
  /\.passages\s*\|\|\s*\[/g,
  /\.chapters\s*\|\|\s*\[/g,
  /\.books\s*\|\|\s*\[/g,
  /\.buckets\s*\|\|\s*\[/g,
  /getAll\w+\(\)\s*\|\|\s*\[/g,
  /fetch\w+\(\)\s*\|\|\s*\[/g,
  /load\w+\(\)\s*\|\|\s*\[/g,
];

// Patterns that are likely display defaults (OK)
const DISPLAY_PATTERNS = [
  /\.name\s*\|\|\s*['"`]/g,
  /\.title\s*\|\|\s*['"`]/g,
  /\.label\s*\|\|\s*['"`]/g,
  /\|\|\s*['"`]Unknown['"`]/g,
  /\|\|\s*['"`]Untitled['"`]/g,
  /\|\|\s*0\b/g,
  /\|\|\s*''|""/g,
];

// Generic pattern to catch all
const GENERIC_PATTERN = /\|\|\s*\[\s*\]|\|\|\s*\{\s*\}/g;

function walkDir(dir, callback) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'dist') {
        walkDir(filePath, callback);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      callback(filePath);
    }
  });
}

function analyzeLine(line, lineNum) {
  const findings = [];

  // Check for generic || [] or || {} patterns
  const matches = line.match(GENERIC_PATTERN);
  if (matches) {
    // Check if it's a display default (OK)
    const isDisplayDefault = DISPLAY_PATTERNS.some(p => p.test(line));
    if (isDisplayDefault) {
      return findings; // Skip display defaults
    }

    // Check if it's a data operation (dangerous)
    const isDataOperation = DATA_PATTERNS.some(p => {
      p.lastIndex = 0; // Reset regex
      return p.test(line);
    });

    const category = isDataOperation ? 'DATA_OPERATION' : 'NEEDS_REVIEW';
    findings.push({
      line: lineNum,
      content: line.trim(),
      category,
      pattern: matches[0],
    });
  }

  return findings;
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings = [];

  lines.forEach((line, index) => {
    const lineFindings = analyzeLine(line, index + 1);
    lineFindings.forEach(f => {
      findings.push({ ...f, file: filePath });
    });
  });

  return findings;
}

// Main
console.log('Silent Fallback Detection');
console.log('=' .repeat(60));
console.log(`Scanning: ${TARGET_DIR}`);
console.log('');

const allFindings = [];

try {
  walkDir(TARGET_DIR, (filePath) => {
    const findings = analyzeFile(filePath);
    allFindings.push(...findings);
  });
} catch (err) {
  console.error(`Error scanning directory: ${err.message}`);
  process.exit(1);
}

// Group by category
const byCategory = {
  DATA_OPERATION: [],
  NEEDS_REVIEW: [],
};

allFindings.forEach(f => {
  if (byCategory[f.category]) {
    byCategory[f.category].push(f);
  }
});

// Report DATA_OPERATION (dangerous)
console.log('DANGEROUS - Data Operations (MUST FIX)');
console.log('-'.repeat(60));
if (byCategory.DATA_OPERATION.length === 0) {
  console.log('  None found');
} else {
  byCategory.DATA_OPERATION.forEach(f => {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    ${f.content.substring(0, 100)}${f.content.length > 100 ? '...' : ''}`);
  });
}
console.log('');

// Report NEEDS_REVIEW
console.log('NEEDS REVIEW - Ambiguous Patterns');
console.log('-'.repeat(60));
if (byCategory.NEEDS_REVIEW.length === 0) {
  console.log('  None found');
} else {
  byCategory.NEEDS_REVIEW.forEach(f => {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    ${f.content.substring(0, 100)}${f.content.length > 100 ? '...' : ''}`);
  });
}
console.log('');

// Summary
console.log('=' .repeat(60));
console.log('Summary:');
console.log(`  DATA_OPERATION (dangerous): ${byCategory.DATA_OPERATION.length}`);
console.log(`  NEEDS_REVIEW: ${byCategory.NEEDS_REVIEW.length}`);
console.log(`  Total: ${allFindings.length}`);
console.log('');
console.log('See TECHNICAL_DEBT.md FALLBACK POLICY for fix guidelines.');
