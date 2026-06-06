#!/bin/bash
# Build vietnormalizer package (no upload).
# Run from repository root: ./scripts/build.sh

set -e

echo "🧹 Cleaning previous builds..."
rm -rf build/ dist/ *.egg-info

echo "📦 Building package..."
python3 -m build

echo ""
echo "✅ Build complete. Files in dist/:"
ls -lh dist/
