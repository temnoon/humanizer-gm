#!/bin/bash
#
# Humanizer macOS Build & Notarization Script
#
# Usage:
#   ./scripts/build-mac.sh              # Build without notarization (local testing)
#   ./scripts/build-mac.sh --notarize   # Build with notarization (for distribution)
#
# Prerequisites:
#   1. Apple Developer account ($99/year)
#   2. Developer ID Application certificate installed in Keychain
#   3. App-specific password for notarization
#
# Setup (one-time):
#   1. Install certificate:
#      - Open Xcode > Settings > Accounts > Manage Certificates
#      - Click + and create "Developer ID Application" certificate
#      - Or download from developer.apple.com and double-click to install
#
#   2. Get your Team ID:
#      - Go to developer.apple.com/account
#      - Look for "Team ID" in membership details (10 characters)
#
#   3. Create app-specific password:
#      - Go to appleid.apple.com/account/manage
#      - Sign in > App-Specific Passwords > Generate
#      - Name it "Humanizer Notarization"
#      - Save the generated password
#
#   4. Store credentials (choose one method):
#
#      Method A - Environment file (recommended for local dev):
#        Create ~/.humanizer-credentials:
#          export APPLE_ID="your.email@example.com"
#          export APPLE_TEAM_ID="ABC1234567"
#          export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
#
#      Method B - Keychain (more secure):
#        security add-generic-password -a "your.email@example.com" \
#          -w "xxxx-xxxx-xxxx-xxxx" -s "APPLE_APP_PASSWORD"
#
#      Method C - CI/CD environment variables
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔨 Humanizer macOS Build${NC}"
echo "=========================="
echo ""

# Check for notarization flag
NOTARIZE=false
if [[ "$1" == "--notarize" ]]; then
  NOTARIZE=true
fi

# Load credentials from file if it exists
if [[ -f ~/.humanizer-credentials ]]; then
  echo -e "${GREEN}✓${NC} Loading credentials from ~/.humanizer-credentials"
  source ~/.humanizer-credentials
fi

# Check for Developer ID certificate
echo -e "\n${YELLOW}Checking signing identity...${NC}"
IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1)

if [[ -z "$IDENTITY" ]]; then
  echo -e "${RED}❌ No Developer ID Application certificate found${NC}"
  echo ""
  echo "To fix this:"
  echo "  1. Open Xcode > Settings > Accounts"
  echo "  2. Select your Apple ID"
  echo "  3. Click 'Manage Certificates'"
  echo "  4. Click + and create 'Developer ID Application'"
  echo ""
  echo "Or download from https://developer.apple.com/account/resources/certificates"
  exit 1
else
  echo -e "${GREEN}✓${NC} Found signing identity:"
  echo "  $IDENTITY"
fi

# Check notarization credentials if requested
if [[ "$NOTARIZE" == true ]]; then
  echo -e "\n${YELLOW}Checking notarization credentials...${NC}"
  
  MISSING=""
  [[ -z "$APPLE_ID" ]] && MISSING="$MISSING APPLE_ID"
  [[ -z "$APPLE_TEAM_ID" ]] && MISSING="$MISSING APPLE_TEAM_ID"
  [[ -z "$APPLE_APP_PASSWORD" ]] && MISSING="$MISSING APPLE_APP_PASSWORD"
  
  if [[ -n "$MISSING" ]]; then
    echo -e "${RED}❌ Missing environment variables:${NC}$MISSING"
    echo ""
    echo "Set these in ~/.humanizer-credentials or as environment variables"
    exit 1
  fi
  
  echo -e "${GREEN}✓${NC} Notarization credentials configured"
  echo "  Apple ID: $APPLE_ID"
  echo "  Team ID: $APPLE_TEAM_ID"
fi

# Build the app
echo -e "\n${YELLOW}Building web app...${NC}"
npm run build --workspace=apps/web

echo -e "\n${YELLOW}Building Electron...${NC}"
npm run build:electron

echo -e "\n${YELLOW}Packaging with electron-builder...${NC}"
if [[ "$NOTARIZE" == true ]]; then
  echo -e "${GREEN}→ Notarization enabled${NC}"
  electron-builder --mac
else
  echo -e "${YELLOW}→ Notarization skipped (use --notarize to enable)${NC}"
  # Temporarily disable notarize in build
  SKIP_NOTARIZE=true electron-builder --mac
fi

echo -e "\n${GREEN}✅ Build complete!${NC}"
echo ""
echo "Output: $PROJECT_DIR/release/"
ls -la "$PROJECT_DIR/release/"*.dmg 2>/dev/null || echo "(no DMG files found)"

if [[ "$NOTARIZE" == true ]]; then
  echo ""
  echo -e "${GREEN}Your DMG is signed and notarized - ready for distribution!${NC}"
else
  echo ""
  echo -e "${YELLOW}Note: This build is NOT notarized.${NC}"
  echo "Users will see a security warning when opening it."
  echo "Run with --notarize flag for distribution builds."
fi
