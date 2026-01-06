#!/bin/bash
# Test Ollama vision directly

TEST_IMG="/Users/tem/openai-export-parser/output_v13_final/2023-11-11_Content_Creation_with_ChatGPT_01268/media/b82c8fa2f85c_image.jpg"

echo "Testing vision model with: $TEST_IMG"
echo "File size: $(ls -lh "$TEST_IMG" | awk '{print $5}')"
echo ""
echo "Calling Ollama qwen3-vl:8b..."

IMG_B64=$(base64 -i "$TEST_IMG")

time curl -s http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"qwen3-vl:8b\",
    \"prompt\": \"Describe this image briefly in 2 sentences.\",
    \"images\": [\"$IMG_B64\"],
    \"stream\": false
  }" --max-time 120 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response', d))"
