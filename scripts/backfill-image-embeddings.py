#!/usr/bin/env python3
"""
Backfill Embeddings for Existing Image Descriptions

This script finds all image_analysis records that don't have corresponding
description embeddings and creates them using Ollama nomic-embed-text.

Usage:
    python3 scripts/backfill-image-embeddings.py [batch_size]

    batch_size: Number of descriptions to process (default: 100, 0 for all)

Example:
    python3 scripts/backfill-image-embeddings.py 50
"""

import json
import os
import sqlite3
import struct
import sys
import time
import urllib.request
import uuid

# Configuration
DB_PATH = "/Users/tem/openai-export-parser/output_v13_final/.embeddings.db"
OLLAMA_EMBED_URL = "http://localhost:11434/api/embed"
EMBEDDING_MODEL = "nomic-embed-text"
EMBEDDING_DIM = 768


def embed_text(text: str) -> list[float]:
    """Get 768-dim embedding from Ollama nomic-embed-text."""
    payload = json.dumps({
        "model": EMBEDDING_MODEL,
        "input": text
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_EMBED_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    embeddings = result.get("embeddings", [])
    if not embeddings:
        raise ValueError("No embeddings returned from Ollama")

    return embeddings[0]


def float_list_to_blob(floats: list[float]) -> bytes:
    """Convert list of floats to binary blob for SQLite."""
    return struct.pack(f'{len(floats)}f', *floats)


def get_descriptions_without_embeddings(conn: sqlite3.Connection, limit: int) -> list[dict]:
    """Get image analyses that don't have description embeddings yet."""
    cursor = conn.execute("""
        SELECT ia.id, ia.description, ia.source
        FROM image_analysis ia
        LEFT JOIN image_description_embeddings ide ON ide.image_analysis_id = ia.id
        WHERE ia.description IS NOT NULL
          AND ia.description != ''
          AND ide.id IS NULL
        LIMIT ?
    """, (limit,))

    return [
        {"id": row[0], "description": row[1], "source": row[2]}
        for row in cursor.fetchall()
    ]


def insert_description_embedding(
    conn: sqlite3.Connection,
    image_analysis_id: str,
    text: str,
    embedding: list[float],
    source: str
) -> None:
    """Insert a new description embedding."""
    embed_id = str(uuid.uuid4())
    embedding_blob = float_list_to_blob(embedding)
    created_at = time.time()

    # Insert into image_description_embeddings
    conn.execute("""
        INSERT INTO image_description_embeddings
        (id, image_analysis_id, text, embedding, model, dimensions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        embed_id,
        image_analysis_id,
        text,
        embedding_blob,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        created_at
    ))

    # Also insert into vec0 table for similarity search
    # Note: This requires sqlite-vec extension to be loaded
    try:
        conn.execute("""
            INSERT INTO vec_image_descriptions
            (id, image_analysis_id, source, embedding)
            VALUES (?, ?, ?, ?)
        """, (embed_id, image_analysis_id, source, embedding_blob))
    except sqlite3.OperationalError as e:
        if "no such table" in str(e):
            print("WARNING: vec_image_descriptions table not found. Vector search won't work.")
            print("         Run the Electron app to create the table via migration.")
        else:
            raise


def ensure_tables_exist(conn: sqlite3.Connection) -> None:
    """Create the image_description_embeddings table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS image_description_embeddings (
            id TEXT PRIMARY KEY,
            image_analysis_id TEXT NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            model TEXT NOT NULL DEFAULT 'nomic-embed-text',
            dimensions INTEGER NOT NULL DEFAULT 768,
            created_at REAL NOT NULL,
            FOREIGN KEY (image_analysis_id) REFERENCES image_analysis(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_image_desc_embeddings_analysis
        ON image_description_embeddings(image_analysis_id)
    """)

    conn.commit()
    print("Ensured image_description_embeddings table exists")


def main():
    batch_size = 100
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        batch_size = int(sys.argv[1])

    print("=" * 60)
    print("Backfill Image Description Embeddings")
    print("=" * 60)
    print(f"Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Database: {DB_PATH}")
    print(f"Model: {EMBEDDING_MODEL} ({EMBEDDING_DIM}-dim)")
    print(f"Batch size: {batch_size if batch_size > 0 else 'unlimited'}")
    print()

    # Check Ollama is running
    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/tags",
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = [m["name"] for m in data.get("models", [])]
            if EMBEDDING_MODEL not in models and f"{EMBEDDING_MODEL}:latest" not in models:
                print(f"ERROR: {EMBEDDING_MODEL} not installed in Ollama")
                print(f"Install with: ollama pull {EMBEDDING_MODEL}")
                return
    except Exception as e:
        print(f"ERROR: Could not connect to Ollama: {e}")
        print("Make sure Ollama is running: ollama serve")
        return

    # Connect to database
    conn = sqlite3.connect(DB_PATH)

    # Ensure tables exist
    ensure_tables_exist(conn)

    # Get descriptions without embeddings
    limit = batch_size if batch_size > 0 else 10000
    descriptions = get_descriptions_without_embeddings(conn, limit)

    print(f"Found {len(descriptions)} descriptions to embed")
    print()

    if not descriptions:
        print("No descriptions need embedding. Done!")
        conn.close()
        return

    # Process each description
    processed = 0
    errors = 0

    for i, item in enumerate(descriptions, 1):
        desc_preview = item["description"][:60] + "..." if len(item["description"]) > 60 else item["description"]
        print(f"[{i}/{len(descriptions)}] {item['id'][:8]}... | {desc_preview}")

        try:
            # Get embedding
            embedding = embed_text(item["description"])

            # Validate dimension
            if len(embedding) != EMBEDDING_DIM:
                raise ValueError(f"Expected {EMBEDDING_DIM}-dim, got {len(embedding)}")

            # Insert
            insert_description_embedding(
                conn,
                item["id"],
                item["description"],
                embedding,
                item["source"]
            )

            conn.commit()
            processed += 1

        except Exception as e:
            print(f"    ERROR: {e}")
            errors += 1

        # Brief pause to avoid overwhelming Ollama
        time.sleep(0.05)

    conn.close()

    # Summary
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Finished: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Processed: {processed}")
    print(f"Errors: {errors}")
    print()

    # Verify
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute("SELECT COUNT(*) FROM image_description_embeddings")
    total = cursor.fetchone()[0]
    conn.close()
    print(f"Total description embeddings in database: {total}")


if __name__ == "__main__":
    main()
