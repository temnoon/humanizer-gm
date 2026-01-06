#!/usr/bin/env python3
"""
Batch Image Analysis Script
Analyzes images in the archive using the gallery API with direct image paths.

Usage:
    python3 scripts/batch-analyze-images.py [batch_size] [max_images]

    batch_size: images per API call (default: 5)
    max_images: total images to process (default: 0 = all)

Run in background:
    nohup python3 scripts/batch-analyze-images.py 5 0 > image-analysis.log 2>&1 &
"""

import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# Configuration
ARCHIVE_ROOT = "/Users/tem/openai-export-parser/output_v13_final"
DB_PATH = f"{ARCHIVE_ROOT}/.embeddings.db"
API_URL = "http://localhost:3002/api/gallery/analyze"
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}

def get_analyzed_paths():
    """Get set of already-analyzed image paths."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.execute("SELECT file_path FROM image_analysis")
    paths = {row[0] for row in cursor.fetchall()}
    conn.close()
    return paths

def find_unanalyzed_images(analyzed_paths, max_count=0):
    """Find images that haven't been analyzed yet."""
    unanalyzed = []

    for root, dirs, files in os.walk(ARCHIVE_ROOT):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]

        for file in files:
            ext = Path(file).suffix.lower()
            if ext in IMAGE_EXTENSIONS:
                full_path = os.path.join(root, file)
                if full_path not in analyzed_paths:
                    unanalyzed.append(full_path)
                    if max_count > 0 and len(unanalyzed) >= max_count:
                        return unanalyzed

    return unanalyzed

def analyze_batch(image_paths):
    """Send batch to API for analysis."""
    payload = json.dumps({
        "images": image_paths,
        "limit": len(image_paths)
    }).encode("utf-8")

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def main():
    batch_size = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    max_images = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    print("=" * 50)
    print("Batch Image Analysis")
    print("=" * 50)
    print(f"Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Archive: {ARCHIVE_ROOT}")
    print(f"Batch size: {batch_size}")
    print(f"Max images: {max_images if max_images > 0 else 'unlimited'}")
    print()

    # Get already analyzed
    print("Loading analyzed images from database...")
    analyzed = get_analyzed_paths()
    print(f"Already analyzed: {len(analyzed)}")

    # Find unanalyzed
    print("Scanning for unanalyzed images...")
    unanalyzed = find_unanalyzed_images(analyzed, max_images)
    print(f"Found unanalyzed: {len(unanalyzed)}")
    print()

    if not unanalyzed:
        print("No unanalyzed images found. Done!")
        return

    # Process in batches
    total_processed = 0
    total_errors = 0
    batch_num = 0

    for i in range(0, len(unanalyzed), batch_size):
        batch_num += 1
        batch = unanalyzed[i:i + batch_size]

        print(f"--- Batch {batch_num} ({len(batch)} images) ---")
        for img in batch:
            print(f"  {os.path.basename(img)}")

        start = time.time()
        result = analyze_batch(batch)
        elapsed = time.time() - start

        if "error" in result:
            print(f"Error: {result['error']}")
            total_errors += len(batch)
        else:
            analyzed_count = result.get("analyzed", 0)
            total_processed += analyzed_count
            print(f"Processed: {analyzed_count} in {elapsed:.1f}s")

            # Show any per-image errors
            for r in result.get("results", []):
                if not r.get("success"):
                    print(f"  Failed: {os.path.basename(r['path'])}: {r.get('error')}")

        print()

        # Brief pause between batches
        time.sleep(1)

    # Summary
    print("=" * 50)
    print("Summary")
    print("=" * 50)
    print(f"Finished: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Total processed: {total_processed}")
    print(f"Total errors: {total_errors}")

    # Final count
    final_analyzed = len(get_analyzed_paths())
    print(f"Total in database: {final_analyzed}")

if __name__ == "__main__":
    main()
