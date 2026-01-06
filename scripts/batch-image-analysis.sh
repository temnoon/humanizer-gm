#!/bin/bash
# Batch Image Analysis Script
# Processes unanalyzed images in batches via the gallery API
#
# Usage: ./scripts/batch-image-analysis.sh [batch_size] [max_batches]
#   batch_size: images per batch (default: 10)
#   max_batches: max batches to run (default: unlimited, use 0)
#
# Run in background: nohup ./scripts/batch-image-analysis.sh 10 0 > image-analysis.log 2>&1 &

BATCH_SIZE=${1:-10}
MAX_BATCHES=${2:-0}
API_URL="http://localhost:3002/api/gallery"

echo "=== Batch Image Analysis ==="
echo "Started: $(date)"
echo "Batch size: $BATCH_SIZE"
echo "Max batches: $MAX_BATCHES (0 = unlimited)"
echo ""

# Check if services are running
if ! curl -s "$API_URL/analysis/stats" > /dev/null 2>&1; then
    echo "ERROR: Archive server not running on port 3002"
    exit 1
fi

if ! curl -s "http://localhost:11434/api/tags" > /dev/null 2>&1; then
    echo "ERROR: Ollama not running on port 11434"
    exit 1
fi

# Get initial stats
INITIAL=$(curl -s "$API_URL/analysis/stats" | grep -o '"total":[0-9]*' | cut -d: -f2)
echo "Initial analyzed images: $INITIAL"
echo ""

batch_count=0
total_processed=0

while true; do
    batch_count=$((batch_count + 1))

    # Check max batches
    if [ "$MAX_BATCHES" -gt 0 ] && [ "$batch_count" -gt "$MAX_BATCHES" ]; then
        echo "Reached max batches ($MAX_BATCHES). Stopping."
        break
    fi

    echo "--- Batch $batch_count ($(date '+%H:%M:%S')) ---"

    # Run batch analysis
    RESULT=$(curl -s -X POST "$API_URL/analyze" \
        -H "Content-Type: application/json" \
        -d "{\"limit\": $BATCH_SIZE}" \
        --max-time 600)

    # Check result
    if echo "$RESULT" | grep -q '"analyzed":0'; then
        echo "No more unanalyzed images found. Done!"
        break
    fi

    if echo "$RESULT" | grep -q '"error"'; then
        echo "Error: $RESULT"
        echo "Waiting 30s before retry..."
        sleep 30
        continue
    fi

    # Extract count from result
    ANALYZED=$(echo "$RESULT" | grep -o '"analyzed":[0-9]*' | cut -d: -f2)
    if [ -n "$ANALYZED" ]; then
        total_processed=$((total_processed + ANALYZED))
        echo "Processed: $ANALYZED images (total this run: $total_processed)"
    else
        echo "Result: $RESULT"
    fi

    # Brief pause between batches
    sleep 2
done

# Final stats
FINAL=$(curl -s "$API_URL/analysis/stats" | grep -o '"total":[0-9]*' | cut -d: -f2)
echo ""
echo "=== Complete ==="
echo "Finished: $(date)"
echo "Started with: $INITIAL analyzed"
echo "Ended with: $FINAL analyzed"
echo "This run processed: $total_processed images"
