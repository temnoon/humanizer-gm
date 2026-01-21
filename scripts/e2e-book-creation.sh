#!/bin/bash
#
# E2E Book Creation Test Script
#
# Validates the full API-first workflow for Book Studio:
# 1. Create book
# 2. Search archive for content (UCG semantic search)
# 3. Harvest cards from search results
# 4. Run research phase (server-side)
# 5. Compute clusters (server-side)
# 6. Generate outline (server-side)
# 7. Create chapters from outline
# 8. Assign cards to chapters (server-side)
# 9. Verify final state
#
# Prerequisites:
# - npm run electron:dev running
# - jq installed (brew install jq)
# - Archive with indexed content
#
# Usage:
#   ./scripts/e2e-book-creation.sh
#   ./scripts/e2e-book-creation.sh --cleanup  # Delete test book after
#   ./scripts/e2e-book-creation.sh --verbose  # Show full API responses
#

set -e

# Configuration
BOOK_STUDIO_API="http://127.0.0.1:3004"
ARCHIVE_API="http://127.0.0.1:3002"
VERBOSE=false
CLEANUP=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --verbose)
      VERBOSE=true
      shift
      ;;
    --cleanup)
      CLEANUP=true
      shift
      ;;
    *)
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_step() {
  echo -e "\n${BLUE}=== $1 ===${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_info() {
  echo -e "${YELLOW}→ $1${NC}"
}

log_verbose() {
  if [ "$VERBOSE" = true ]; then
    echo -e "${NC}$1${NC}"
  fi
}

check_response() {
  local response="$1"
  local check_field="$2"
  local error_msg="$3"

  if [ -z "$response" ] || [ "$response" = "null" ]; then
    log_error "$error_msg (empty response)"
    exit 1
  fi

  if [ -n "$check_field" ]; then
    local value=$(echo "$response" | jq -r "$check_field" 2>/dev/null)
    if [ -z "$value" ] || [ "$value" = "null" ]; then
      log_error "$error_msg"
      log_verbose "Response: $response"
      exit 1
    fi
  fi
}

# Check prerequisites
log_step "Checking Prerequisites"

if ! command -v jq &> /dev/null; then
  log_error "jq is required but not installed. Install with: brew install jq"
  exit 1
fi
log_success "jq is installed"

# Check Book Studio server
BOOK_HEALTH=$(curl -s "$BOOK_STUDIO_API/api/health" 2>/dev/null || echo "")
if [ -z "$BOOK_HEALTH" ] || [ "$(echo "$BOOK_HEALTH" | jq -r '.status' 2>/dev/null)" != "ok" ]; then
  log_error "Book Studio server not responding at $BOOK_STUDIO_API"
  log_info "Start with: npm run electron:dev"
  exit 1
fi
log_success "Book Studio server is running (port 3004)"

# Check Archive server
ARCHIVE_HEALTH=$(curl -s "$ARCHIVE_API/api/health" 2>/dev/null || echo "")
if [ -z "$ARCHIVE_HEALTH" ] || [ "$(echo "$ARCHIVE_HEALTH" | jq -r '.status' 2>/dev/null)" != "ok" ]; then
  log_error "Archive server not responding at $ARCHIVE_API"
  exit 1
fi
log_success "Archive server is running (port 3002)"

echo ""
echo "=========================================="
echo "  E2E Book Creation Test"
echo "  $(date)"
echo "=========================================="

# Step 1: Create a book
log_step "Step 1: Create Book"

BOOK_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/books" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "E2E API Test Book",
    "description": "Created entirely via API - testing server-side business logic"
  }')

log_verbose "Response: $BOOK_RESPONSE"

BOOK_ID=$(echo "$BOOK_RESPONSE" | jq -r '.book.id')
check_response "$BOOK_ID" "" "Failed to create book"

log_success "Book created: $BOOK_ID"
log_info "Title: E2E API Test Book"

# Step 2: Search archive for content
log_step "Step 2: Search Archive for Content"

# Try semantic search first, fall back to regular search
SEARCH_RESPONSE=$(curl -s -X POST "$ARCHIVE_API/api/ucg/search/semantic" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "philosophy consciousness meaning existence",
    "limit": 30
  }' 2>/dev/null || echo "")

# Check if semantic search returned results
RESULT_COUNT=$(echo "$SEARCH_RESPONSE" | jq '.results | length' 2>/dev/null || echo "0")

if [ "$RESULT_COUNT" = "0" ] || [ -z "$RESULT_COUNT" ]; then
  log_info "Semantic search returned no results, trying keyword search..."

  SEARCH_RESPONSE=$(curl -s "$ARCHIVE_API/api/ucg/search?q=philosophy&limit=30" 2>/dev/null || echo "")
  RESULT_COUNT=$(echo "$SEARCH_RESPONSE" | jq '.results | length' 2>/dev/null || echo "0")
fi

if [ "$RESULT_COUNT" = "0" ] || [ -z "$RESULT_COUNT" ]; then
  log_info "No search results found. Creating synthetic cards for testing..."

  # Create synthetic test cards
  SYNTHETIC_CARDS='[
    {
      "sourceId": "test-1",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "Consciousness is the fundamental mystery of existence. How does subjective experience arise from objective matter? This is the hard problem that philosophers and scientists continue to grapple with.",
      "title": "On Consciousness"
    },
    {
      "sourceId": "test-2",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "The meaning of life cannot be found in external achievements alone. True fulfillment comes from understanding our place in the universe and connecting with something greater than ourselves.",
      "title": "Finding Meaning"
    },
    {
      "sourceId": "test-3",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "Philosophy teaches us to question everything, even our most basic assumptions. Through careful reasoning and reflection, we can approach truth and wisdom.",
      "title": "The Value of Philosophy"
    },
    {
      "sourceId": "test-4",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "The nature of reality has puzzled thinkers for millennia. Is the physical world all there is, or does mind play a fundamental role in the fabric of existence?",
      "title": "Reality and Mind"
    },
    {
      "sourceId": "test-5",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "Free will remains one of the most debated concepts in philosophy. Are our choices truly free, or are they determined by prior causes stretching back to the beginning of time?",
      "title": "On Free Will"
    },
    {
      "sourceId": "test-6",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "Ethics provides a framework for understanding right and wrong. Without moral philosophy, we would lack the tools to navigate complex decisions about how to treat others.",
      "title": "The Importance of Ethics"
    },
    {
      "sourceId": "test-7",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "Knowledge itself is a mysterious thing. How do we know what we know? Can we ever be certain about anything? These epistemological questions underlie all other inquiry.",
      "title": "What is Knowledge?"
    },
    {
      "sourceId": "test-8",
      "sourceType": "test",
      "source": "e2e-test",
      "content": "The self is perhaps the most intimate mystery we face. What makes me me? Is there a continuous self that persists through time, or is identity an illusion?",
      "title": "The Self and Identity"
    }
  ]'

  RESULT_COUNT=8
else
  log_success "Found $RESULT_COUNT results from archive search"
  log_verbose "Response: $(echo "$SEARCH_RESPONSE" | jq '.results[0]' 2>/dev/null)"

  # Transform search results into card format
  SYNTHETIC_CARDS=$(echo "$SEARCH_RESPONSE" | jq '[.results[] | {
    sourceId: (.node.id // .id // ("search-" + (. | @base64 | .[0:8]))),
    sourceType: "ucg",
    source: "archive",
    content: (.node.content.text // .content // .text // ""),
    title: (.node.content.title // .title // null),
    similarity: (.similarity // .score // null)
  }] | map(select(.content != "" and (.content | length) > 50))')

  RESULT_COUNT=$(echo "$SYNTHETIC_CARDS" | jq 'length')
fi

log_success "Prepared $RESULT_COUNT cards for harvest"

# Step 3: Harvest cards
log_step "Step 3: Harvest Cards"

HARVEST_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/cards/batch" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"cards\":$SYNTHETIC_CARDS}")

log_verbose "Response: $HARVEST_RESPONSE"

HARVESTED_COUNT=$(echo "$HARVEST_RESPONSE" | jq '.cards | length' 2>/dev/null || echo "0")

if [ "$HARVESTED_COUNT" = "0" ]; then
  # Check for error
  ERROR=$(echo "$HARVEST_RESPONSE" | jq -r '.error' 2>/dev/null)
  if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    log_error "Harvest failed: $ERROR"
    exit 1
  fi
fi

log_success "Harvested $HARVESTED_COUNT cards"

# Step 4: Run research phase
log_step "Step 4: Run Research Phase (Server-Side)"

RESEARCH_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/outline-compute/$BOOK_ID/research" \
  -H "Content-Type: application/json")

log_verbose "Response: $RESEARCH_RESPONSE"

# Check for success
SUCCESS=$(echo "$RESEARCH_RESPONSE" | jq -r '.success' 2>/dev/null)
if [ "$SUCCESS" != "true" ]; then
  ERROR=$(echo "$RESEARCH_RESPONSE" | jq -r '.error // .details // "Unknown error"' 2>/dev/null)
  log_error "Research failed: $ERROR"
  exit 1
fi

THEMES_COUNT=$(echo "$RESEARCH_RESPONSE" | jq '.research.themes | length' 2>/dev/null || echo "0")
ARCS_COUNT=$(echo "$RESEARCH_RESPONSE" | jq '.research.arcs | length' 2>/dev/null || echo "0")
CONFIDENCE=$(echo "$RESEARCH_RESPONSE" | jq '.research.confidence' 2>/dev/null || echo "0")

log_success "Research completed"
log_info "Themes found: $THEMES_COUNT"
log_info "Arcs found: $ARCS_COUNT"
log_info "Confidence: $CONFIDENCE"

# Show themes if verbose
if [ "$VERBOSE" = true ]; then
  echo "Themes:"
  echo "$RESEARCH_RESPONSE" | jq '.research.themes[] | "  - " + .name' -r 2>/dev/null || true
fi

# Step 5: Compute clusters
log_step "Step 5: Compute Clusters (Server-Side)"

CLUSTERS_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/clusters/compute" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"options\":{\"save\":true}}")

log_verbose "Response: $CLUSTERS_RESPONSE"

SUCCESS=$(echo "$CLUSTERS_RESPONSE" | jq -r '.success' 2>/dev/null)
if [ "$SUCCESS" != "true" ]; then
  ERROR=$(echo "$CLUSTERS_RESPONSE" | jq -r '.error // "Unknown error"' 2>/dev/null)
  log_error "Clustering failed: $ERROR"
  exit 1
fi

CLUSTER_COUNT=$(echo "$CLUSTERS_RESPONSE" | jq '.result.clusters | length' 2>/dev/null || echo "0")
UNCLUSTERED=$(echo "$CLUSTERS_RESPONSE" | jq '.result.stats.unclustered' 2>/dev/null || echo "0")

log_success "Computed $CLUSTER_COUNT clusters"
log_info "Unclustered cards: $UNCLUSTERED"

# Show cluster names if verbose
if [ "$VERBOSE" = true ]; then
  echo "Clusters:"
  echo "$CLUSTERS_RESPONSE" | jq '.result.clusters[] | "  - " + .name + " (" + (.cardIds | length | tostring) + " cards)"' -r 2>/dev/null || true
fi

# Step 6: Generate outline
log_step "Step 6: Generate Outline (Server-Side)"

OUTLINE_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/outline-compute/generate" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"maxSections\":5}")

log_verbose "Response: $OUTLINE_RESPONSE"

SUCCESS=$(echo "$OUTLINE_RESPONSE" | jq -r '.success' 2>/dev/null)
if [ "$SUCCESS" != "true" ]; then
  ERROR=$(echo "$OUTLINE_RESPONSE" | jq -r '.error // .details // "Unknown error"' 2>/dev/null)
  log_error "Outline generation failed: $ERROR"
  exit 1
fi

SECTION_COUNT=$(echo "$OUTLINE_RESPONSE" | jq '.outline.structure.items | length' 2>/dev/null || echo "0")
OUTLINE_ID=$(echo "$OUTLINE_RESPONSE" | jq -r '.outline.id' 2>/dev/null || echo "")

log_success "Generated outline with $SECTION_COUNT sections"
log_info "Outline ID: $OUTLINE_ID"

# Show section titles
echo "Sections:"
echo "$OUTLINE_RESPONSE" | jq '.outline.structure.items[] | "  " + ((.order // 0) | tostring) + ". " + .text' -r 2>/dev/null || true

# Step 7: Create chapters from outline
log_step "Step 7: Create Chapters from Outline"

# Extract chapter data from outline
CHAPTERS_DATA=$(echo "$OUTLINE_RESPONSE" | jq '[.outline.structure.items[] | {title: .text, order: .order}]')

CHAPTERS_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/chapters/batch" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"chapters\":$CHAPTERS_DATA}")

log_verbose "Response: $CHAPTERS_RESPONSE"

CHAPTERS_CREATED=$(echo "$CHAPTERS_RESPONSE" | jq '.chapters | length' 2>/dev/null || echo "0")

if [ "$CHAPTERS_CREATED" = "0" ]; then
  ERROR=$(echo "$CHAPTERS_RESPONSE" | jq -r '.error' 2>/dev/null)
  if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    log_error "Failed to create chapters: $ERROR"
    exit 1
  fi
fi

log_success "Created $CHAPTERS_CREATED chapters"

# Step 8: Assign cards to chapters
log_step "Step 8: Assign Cards to Chapters (Server-Side)"

ASSIGN_RESPONSE=$(curl -s -X POST "$BOOK_STUDIO_API/api/cards/assign-to-chapters" \
  -H "Content-Type: application/json" \
  -d "{\"bookId\":\"$BOOK_ID\",\"options\":{\"autoApply\":true}}")

log_verbose "Response: $ASSIGN_RESPONSE"

SUCCESS=$(echo "$ASSIGN_RESPONSE" | jq -r '.success' 2>/dev/null)
if [ "$SUCCESS" != "true" ]; then
  ERROR=$(echo "$ASSIGN_RESPONSE" | jq -r '.error // .message // "Unknown error"' 2>/dev/null)
  # Not all cards need to be assigned, so this might be a warning
  log_info "Assignment note: $ERROR"
else
  PROPOSALS_COUNT=$(echo "$ASSIGN_RESPONSE" | jq '.batch.proposals | length' 2>/dev/null || echo "0")
  APPLIED_COUNT=$(echo "$ASSIGN_RESPONSE" | jq '.appliedCount // 0' 2>/dev/null || echo "0")

  log_success "Generated $PROPOSALS_COUNT assignment proposals"
  log_info "Auto-applied: $APPLIED_COUNT"
fi

# Step 9: Verify final state
log_step "Step 9: Verify Final State"

FINAL_STATE=$(curl -s "$BOOK_STUDIO_API/api/books/$BOOK_ID")

log_verbose "Response: $FINAL_STATE"

BOOK_TITLE=$(echo "$FINAL_STATE" | jq -r '.book.title')
CHAPTERS_COUNT=$(echo "$FINAL_STATE" | jq '.chapters | length')
STAGING_COUNT=$(echo "$FINAL_STATE" | jq '.cardCounts.staging // 0')
PLACED_COUNT=$(echo "$FINAL_STATE" | jq '.cardCounts.placed // 0')
TOTAL_CARDS=$((STAGING_COUNT + PLACED_COUNT))

echo ""
echo "=========================================="
echo "  Final Book State"
echo "=========================================="
echo "  Book ID: $BOOK_ID"
echo "  Title: $BOOK_TITLE"
echo "  Chapters: $CHAPTERS_COUNT"
echo "  Total Cards: $TOTAL_CARDS"
echo "    - Staging: $STAGING_COUNT"
echo "    - Placed: $PLACED_COUNT"
echo "=========================================="

# Validation summary
echo ""
log_step "Validation Summary"

PASS=true

if [ "$CHAPTERS_COUNT" -gt 0 ]; then
  log_success "Chapters created: $CHAPTERS_COUNT"
else
  log_error "No chapters created"
  PASS=false
fi

if [ "$TOTAL_CARDS" -gt 0 ]; then
  log_success "Cards harvested: $TOTAL_CARDS"
else
  log_error "No cards harvested"
  PASS=false
fi

if [ "$PLACED_COUNT" -gt 0 ]; then
  log_success "Cards assigned to chapters: $PLACED_COUNT"
else
  log_info "Warning: No cards were auto-assigned (may need manual assignment)"
fi

if [ "$THEMES_COUNT" -gt 0 ]; then
  log_success "Themes extracted: $THEMES_COUNT"
else
  log_info "Warning: No themes found"
fi

if [ "$CLUSTER_COUNT" -gt 0 ]; then
  log_success "Clusters computed: $CLUSTER_COUNT"
else
  log_info "Warning: No clusters formed"
fi

# Cleanup if requested
if [ "$CLEANUP" = true ]; then
  log_step "Cleanup"

  DELETE_RESPONSE=$(curl -s -X DELETE "$BOOK_STUDIO_API/api/books/$BOOK_ID")
  DELETE_SUCCESS=$(echo "$DELETE_RESPONSE" | jq -r '.success' 2>/dev/null)

  if [ "$DELETE_SUCCESS" = "true" ]; then
    log_success "Test book deleted"
  else
    log_error "Failed to delete test book"
  fi
fi

echo ""
echo "=========================================="
if [ "$PASS" = true ]; then
  echo -e "  ${GREEN}E2E TEST PASSED${NC}"
else
  echo -e "  ${RED}E2E TEST FAILED${NC}"
fi
echo "=========================================="
echo ""

if [ "$PASS" = false ]; then
  exit 1
fi
