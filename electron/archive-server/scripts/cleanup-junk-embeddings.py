#!/usr/bin/env python3
"""
Cleanup Junk Embeddings Script

Run with: python3 cleanup-junk-embeddings.py [--execute]

By default runs in preview mode. Add --execute to actually delete.

Works by deleting from vec_messages shadow tables directly,
bypassing the need for the sqlite-vec extension.
"""

import sqlite3
import sys
from pathlib import Path

ARCHIVE_PATH = Path("/Users/tem/openai-export-parser/output_v13_final")
DB_PATH = ARCHIVE_PATH / ".embeddings.db"

# Check for execute flag
execute = "--execute" in sys.argv

print("\n=== Cleanup Junk Embeddings ===")
print(f"Database: {DB_PATH}")
print(f"Mode: {'EXECUTE (will delete)' if execute else 'PREVIEW (dry run)'}\n")

# Open database
conn = sqlite3.connect(str(DB_PATH))
cursor = conn.cursor()

# Get total before cleanup (count from shadow table)
cursor.execute("SELECT COUNT(*) FROM vec_messages_rowids")
total_before = cursor.fetchone()[0]
print(f"Total embeddings before: {total_before:,}\n")

# Define junk patterns - these query the messages table
patterns = [
    ("Tool role messages", "role = 'tool'"),
    ("Very short (<30 chars)", "LENGTH(content) < 30"),
    ("<<ImageDisplayed>> placeholders", "content LIKE '%<<ImageDisplay%'"),
    ("Error tracebacks", "content LIKE '%Traceback%'"),
    ("click()/mclick() commands", "content LIKE 'click(%' OR content LIKE 'mclick(%'"),
    ("scroll() commands", "content LIKE 'scroll(%'"),
    ("search() calls", "content LIKE 'search(\"%'"),
    ("JSON object content", "content LIKE '{\"query\":%' OR content LIKE '{\"type\":%'"),
    ("Short error messages", "content LIKE 'Error %' AND LENGTH(content) < 200"),
    ("Fetch/timeout errors", "content LIKE '%Failed to fetch%' OR content LIKE '%Timeout fetching%'"),
]

# Shadow tables to clean
SHADOW_TABLES = [
    "vec_messages_rowids",
    "vec_messages_chunks",
    "vec_messages_vector_chunks00",
    "vec_messages_metadatachunks00",
    "vec_messages_metadatachunks01",
    "vec_messages_metadatachunks02",
    "vec_messages_metadatatext00",
    "vec_messages_metadatatext01",
    "vec_messages_metadatatext02",
]

# vec_messages_metadatatext01 contains the message_id
# We need to find rowids for junk message_ids

print("Pattern analysis:")
print("-" * 60)

junk_message_ids = set()

for description, condition in patterns:
    # Get junk message IDs
    query = f"SELECT id FROM messages WHERE {condition}"
    cursor.execute(query)
    matches = cursor.fetchall()
    count = len(matches)
    print(f"{description:<35} {count:>8,}")

    for (msg_id,) in matches:
        junk_message_ids.add(msg_id)

print("-" * 60)
print(f"{'UNIQUE JUNK MESSAGES':<35} {len(junk_message_ids):>8,}")

# Find corresponding rowids in vec_messages shadow tables
print("\nFinding corresponding embedding rowids...")
rowids_to_delete = set()

# Query in batches to avoid huge IN clauses
junk_list = list(junk_message_ids)
batch_size = 500

for i in range(0, len(junk_list), batch_size):
    batch = junk_list[i:i + batch_size]
    placeholders = ",".join("?" * len(batch))
    # metadatatext01 contains message_id
    cursor.execute(f"""
        SELECT rowid FROM vec_messages_metadatatext01
        WHERE data IN ({placeholders})
    """, batch)
    for (rowid,) in cursor.fetchall():
        rowids_to_delete.add(rowid)

print(f"Found {len(rowids_to_delete):,} embedding rowids to delete")

if execute and rowids_to_delete:
    print("\nDeleting from shadow tables...")

    # Delete from each shadow table
    rowid_list = list(rowids_to_delete)

    for table in SHADOW_TABLES:
        deleted = 0
        for i in range(0, len(rowid_list), batch_size):
            batch = rowid_list[i:i + batch_size]
            placeholders = ",".join("?" * len(batch))
            cursor.execute(f"DELETE FROM {table} WHERE rowid IN ({placeholders})", batch)
            deleted += cursor.rowcount
        print(f"  {table}: {deleted:,} rows deleted")

    conn.commit()

    # Get total after cleanup
    cursor.execute("SELECT COUNT(*) FROM vec_messages_rowids")
    total_after = cursor.fetchone()[0]

    print(f"\nTotal embeddings after: {total_after:,}")
    print(f"Removed: {total_before - total_after:,} embeddings")
else:
    print(f"\nWould remove: {len(rowids_to_delete):,} embeddings")
    print(f"Would remain: {total_before - len(rowids_to_delete):,} embeddings")
    if not execute:
        print("\nRun with --execute to actually delete.")

conn.close()
print("\nDone!\n")
