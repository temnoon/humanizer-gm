#!/usr/bin/env python3
"""Test Ollama vision model directly"""

import base64
import json
import sys
import time
import urllib.request

OLLAMA_URL = "http://localhost:11434/api/generate"
TEST_IMG = "/Users/tem/openai-export-parser/output_v13_final/2023-11-11_Content_Creation_with_ChatGPT_01268/media/b82c8fa2f85c_image.jpg"

def test_vision():
    print(f"Testing vision model with: {TEST_IMG}")

    # Read and encode image
    with open(TEST_IMG, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    print(f"Image base64 size: {len(img_b64)} chars")
    print("Calling Ollama qwen3-vl:8b...")

    payload = json.dumps({
        "model": "qwen3-vl:8b",
        "prompt": "Describe this image briefly in 2 sentences.",
        "images": [img_b64],
        "stream": False
    }).encode("utf-8")

    start = time.time()

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - start
            print(f"\nTime: {elapsed:.1f}s")
            print(f"Response: {result.get('response', result)}")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_vision()
