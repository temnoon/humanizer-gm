#!/usr/bin/env npx ts-node
/**
 * Cleanup Junk Embeddings Script
 *
 * Run with: npx ts-node scripts/cleanup-junk-embeddings.ts [--dry-run]
 *
 * Removes junk from vec_messages:
 * - Tool role messages
 * - Very short content (<30 chars)
 * - Image placeholders (<<ImageDisplayed>>)
 * - Error tracebacks
 * - Click/scroll commands
 * - Search() calls
 * - JSON objects
 * - Fetch errors
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { join } from 'path';

const ARCHIVE_PATH = '/Users/tem/openai-export-parser/output_v13_final';
const DB_PATH = join(ARCHIVE_PATH, '.embeddings.db');

// Check for dry-run flag
const dryRun = process.argv.includes('--dry-run');

console.log(`\n=== Cleanup Junk Embeddings ===`);
console.log(`Database: ${DB_PATH}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete)'}\n`);

// Open database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Load sqlite-vec extension
try {
  sqliteVec.load(db);
  console.log('sqlite-vec extension loaded\n');
} catch (err) {
  console.error('Failed to load sqlite-vec:', err);
  process.exit(1);
}

// Get total before cleanup
const totalBefore = (db.prepare('SELECT COUNT(*) as count FROM vec_messages').get() as { count: number }).count;
console.log(`Total embeddings before: ${totalBefore.toLocaleString()}\n`);

// Define junk patterns
const patterns: Array<{ name: string; description: string; condition: string }> = [
  { name: 'tool_role', description: 'Tool role messages', condition: "role = 'tool'" },
  { name: 'very_short', description: 'Very short (<30 chars)', condition: 'LENGTH(content) < 30' },
  { name: 'image_placeholder', description: '<<ImageDisplayed>> placeholders', condition: "content LIKE '%<<ImageDisplay%'" },
  { name: 'error_traceback', description: 'Error tracebacks', condition: "content LIKE '%Traceback%'" },
  { name: 'click_commands', description: 'click()/mclick() commands', condition: "content LIKE 'click(%' OR content LIKE 'mclick(%'" },
  { name: 'scroll_commands', description: 'scroll() commands', condition: "content LIKE 'scroll(%'" },
  { name: 'search_calls', description: 'search() calls', condition: "content LIKE 'search(\"%'" },
  { name: 'json_objects', description: 'JSON object content', condition: "content LIKE '{\"query\":%' OR content LIKE '{\"type\":%'" },
  { name: 'error_messages', description: 'Short error messages', condition: "content LIKE 'Error %' AND LENGTH(content) < 200" },
  { name: 'fetch_errors', description: 'Fetch/timeout errors', condition: "content LIKE '%Failed to fetch%' OR content LIKE '%Timeout fetching%'" },
];

let totalRemoved = 0;

console.log('Pattern analysis:');
console.log('-'.repeat(60));

for (const pattern of patterns) {
  // Count matches
  const countSql = `
    SELECT COUNT(*) as count FROM vec_messages v
    JOIN messages m ON v.message_id = m.id
    WHERE ${pattern.condition}
  `;
  const count = (db.prepare(countSql).get() as { count: number }).count;

  console.log(`${pattern.description.padEnd(35)} ${count.toLocaleString().padStart(8)}`);

  if (!dryRun && count > 0) {
    // Delete matching embeddings
    const deleteSql = `
      DELETE FROM vec_messages WHERE id IN (
        SELECT v.id FROM vec_messages v
        JOIN messages m ON v.message_id = m.id
        WHERE ${pattern.condition}
      )
    `;
    const result = db.prepare(deleteSql).run();
    totalRemoved += result.changes;
  } else {
    totalRemoved += count;
  }
}

console.log('-'.repeat(60));
console.log(`${'TOTAL TO REMOVE'.padEnd(35)} ${totalRemoved.toLocaleString().padStart(8)}`);

// Get total after cleanup
if (!dryRun) {
  const totalAfter = (db.prepare('SELECT COUNT(*) as count FROM vec_messages').get() as { count: number }).count;
  console.log(`\nTotal embeddings after: ${totalAfter.toLocaleString()}`);
  console.log(`Removed: ${(totalBefore - totalAfter).toLocaleString()} embeddings`);
} else {
  console.log(`\nWould remove: ${totalRemoved.toLocaleString()} embeddings`);
  console.log(`Would remain: ${(totalBefore - totalRemoved).toLocaleString()} embeddings`);
  console.log(`\nRun without --dry-run to actually delete.`);
}

db.close();
console.log('\nDone!\n');
