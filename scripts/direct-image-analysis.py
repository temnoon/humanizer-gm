#!/usr/bin/env python3
"""
Direct Image Analysis Script
Calls Ollama vision model directly and stores results in SQLite.
Bypasses the slow/timing-out archive server endpoint.

Usage:
    python3 scripts/direct-image-analysis.py [max_images] [--continue]

    max_images: total images to process (default: 10, use 0 for all)
    --continue: continue from where we left off

Run in background:
    nohup python3 scripts/direct-image-analysis.py 0 --continue > image-analysis.log 2>&1 &
"""

import base64
import json
import os
import sqlite3
import sys
import time
import urllib.request
import uuid
from pathlib import Path

# Configuration
ARCHIVE_ROOT = "/Users/tem/openai-export-parser/output_v13_final"
DB_PATH = f"{ARCHIVE_ROOT}/.embeddings.db"
OLLAMA_URL = "http://localhost:11434/api/generate"
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}

ANALYSIS_PROMPT = """Analyze this image comprehensively. Return a JSON object with these fields:
{
  "description": "2-3 sentence description of what's shown",
  "categories": ["array", "of", "category", "tags"],
  "objects": ["main", "objects", "detected"],
  "scene": "scene type (indoor/outdoor/studio/nature/urban/etc)",
  "mood": "emotional tone (happy/serene/dramatic/professional/casual/etc)"
}

Return only valid JSON, no explanation."""

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

def analyze_image_with_ollama(image_path):
    """Call Ollama vision model to analyze an image."""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    payload = json.dumps({
        "model": "qwen3-vl:8b",
        "prompt": ANALYSIS_PROMPT,
        "images": [img_b64],
        "stream": False,
        "options": {"temperature": 0.3}
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    start = time.time()
    with urllib.request.urlopen(req, timeout=180) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    elapsed = time.time() - start

    response_text = result.get("response", "")

    # Parse JSON from response
    try:
        # Clean up markdown code blocks if present
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```")[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
        analysis = json.loads(cleaned)
    except json.JSONDecodeError:
        # Fallback to simple extraction
        analysis = {
            "description": response_text[:500],
            "categories": [],
            "objects": [],
            "scene": "unknown",
            "mood": "neutral"
        }

    return {
        "description": analysis.get("description", ""),
        "categories": analysis.get("categories", []),
        "objects": analysis.get("objects", []),
        "scene": analysis.get("scene", "unknown"),
        "mood": analysis.get("mood", "neutral"),
        "processing_time_ms": int(elapsed * 1000)
    }

def save_to_database(image_path, analysis):
    """Save analysis results to SQLite database."""
    conn = sqlite3.connect(DB_PATH)

    # Determine source from path
    source = "chatgpt"
    if "facebook" in image_path.lower():
        source = "facebook"

    conn.execute("""
        INSERT OR REPLACE INTO image_analysis
        (id, file_path, source, description, categories, objects, scene, mood,
         model_used, confidence, processing_time_ms, analyzed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        str(uuid.uuid4()),
        image_path,
        source,
        analysis["description"],
        json.dumps(analysis["categories"]),
        json.dumps(analysis["objects"]),
        analysis["scene"],
        analysis["mood"],
        "qwen3-vl:8b",
        0.75,
        analysis["processing_time_ms"],
        time.time(),
        time.time()
    ))

    conn.commit()
    conn.close()

def main():
    max_images = 10
    continue_mode = "--continue" in sys.argv

    # Parse max_images from args
    for arg in sys.argv[1:]:
        if arg.isdigit():
            max_images = int(arg)
            break

    print("=" * 60)
    print("Direct Image Analysis (Ollama qwen3-vl:8b)")
    print("=" * 60)
    print(f"Started: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Archive: {ARCHIVE_ROOT}")
    print(f"Max images: {max_images if max_images > 0 else 'unlimited'}")
    print()

    # Get already analyzed
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

    # Process images
    processed = 0
    errors = 0

    for i, image_path in enumerate(unanalyzed, 1):
        filename = os.path.basename(image_path)
        print(f"[{i}/{len(unanalyzed)}] {filename[:60]}...")

        try:
            start = time.time()
            analysis = analyze_image_with_ollama(image_path)
            save_to_database(image_path, analysis)
            elapsed = time.time() - start

            processed += 1
            desc_preview = analysis["description"][:80] + "..." if len(analysis["description"]) > 80 else analysis["description"]
            print(f"    {elapsed:.1f}s | {analysis['scene']}/{analysis['mood']} | {desc_preview}")

        except Exception as e:
            errors += 1
            print(f"    ERROR: {e}")

        # Brief pause between images
        time.sleep(0.5)

    # Summary
    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Finished: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Processed: {processed}")
    print(f"Errors: {errors}")
    print(f"Total in database: {len(get_analyzed_paths())}")

if __name__ == "__main__":
    main()
