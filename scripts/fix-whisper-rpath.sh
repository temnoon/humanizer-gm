#!/bin/bash
# Fix rpath for @kutalia/whisper-node-addon on macOS
# The package has hardcoded rpaths from the CI build that don't work locally

WHISPER_DIR="node_modules/@kutalia/whisper-node-addon/dist"

# Create darwin-arm64 symlink if needed
if [ -d "$WHISPER_DIR/mac-arm64" ] && [ ! -e "$WHISPER_DIR/darwin-arm64" ]; then
  ln -sf mac-arm64 "$WHISPER_DIR/darwin-arm64"
  echo "Created darwin-arm64 symlink"
fi

# Fix rpaths for arm64 (Apple Silicon)
if [ -d "$WHISPER_DIR/mac-arm64" ]; then
  cd "$WHISPER_DIR/mac-arm64"

  # Add @loader_path to whisper.node
  install_name_tool -add_rpath "@loader_path" whisper.node 2>/dev/null || true

  # Add @loader_path to all dylibs
  for lib in *.dylib; do
    install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true
  done

  echo "Fixed rpath for mac-arm64"
fi

# Fix rpaths for x64 (Intel)
if [ -d "$WHISPER_DIR/mac-x64" ]; then
  cd "$WHISPER_DIR/mac-x64"

  install_name_tool -add_rpath "@loader_path" whisper.node 2>/dev/null || true

  for lib in *.dylib; do
    install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true
  done

  echo "Fixed rpath for mac-x64"
fi

echo "Whisper rpath fix complete"
